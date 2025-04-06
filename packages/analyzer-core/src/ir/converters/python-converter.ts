/**
 * @file Converts Python source code into Intermediate Representation (IR) entities using Tree-sitter.
 */

import type { SyntaxNode } from 'tree-sitter'; // Keep type import
import {
  FileIr,
  IrElement,
  ElementType,
  PotentialRelationship,
  RelationshipType,
  Language as IrLanguage, // Alias IR schema language
  Location,
  Position,
  CanonicalId,
  // Import specific property interfaces
  ImportsProperties, // Renamed
  ApiFetchProperties,
  DatabaseQueryProperties,
  ClassProperties,
  CallsProperties, // Renamed
  UsesAnnotationProperties, // Renamed
  ModuleProperties, // Added for Module element
  FunctionProperties,
  VariableProperties,
  ParameterDetail,
  ApiRouteDefinitionProperties,
} from '../schema.js';
import { addIdToElement, generateCanonicalId } from '../ir-utils.js';
import { createContextLogger } from '../../utils/logger.js';
import path from 'path';
// Import ParserFactory and the correct Language enum
import { ParserFactory } from '../../analyzer/parsers/parser-factory.js';
import { Language as AnalyzerLanguage } from '../../types/index.js';

const logger = createContextLogger('PythonConverterTreeSitter');

// --- Helper Functions ---
function getNodeText(node: SyntaxNode | null, code: string): string {
    if (!node) return ''; // Handle null node
    return code.substring(node.startIndex, node.endIndex);
}

function getNodeLocation(node: SyntaxNode): Location {
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
  };
}

// Extracts text from string literal nodes, removing quotes and handling f-strings simply
function getStringLiteralValue(node: SyntaxNode | null, sourceCode: string): string | null {
    if (!node) return null; // Handle null node
    if (node.type === 'string') {
        // Handle potential prefixes (f, r, u, b) and triple quotes
        const text = getNodeText(node, sourceCode);
        // Improved regex to handle prefixes and quotes more reliably
        const match = text.match(/^[a-zA-Z]*?(['"]{1,3})(.*)\1$/s);
        // Ensure match[2] is not undefined before returning
        // If match or match[2] is null/undefined, return null instead of text
        return match?.[2] ?? null; // Corrected: Return null if undefined
    }
    // Basic f-string handling: return the raw content including expressions
    if (node.type === 'concatenated_string') {
         // Join parts of concatenated strings
         return node.children
             .map(child => getStringLiteralValue(child, sourceCode))
             .filter((s): s is string => s !== null) // Type guard for filter
             .join('');
    }
    return null;
}

// Extracts arguments from a decorator or function call
function extractArguments(node: SyntaxNode, sourceCode: string): string[] {
    const argListNode = node.childForFieldName('arguments');
    if (!argListNode) return [];

    // Handle argument_list or generator_expression etc.
    return argListNode.children
        .filter(child => child.type !== '(' && child.type !== ')' && child.type !== ',')
        .map(arg => getNodeText(arg, sourceCode));
}

// Extracts parameter details from function/method definition
function extractParameters(node: SyntaxNode, sourceCode: string): ParameterDetail[] {
    const paramsNode = node.childForFieldName('parameters');
    if (!paramsNode) return [];

    const parameters: ParameterDetail[] = [];
    let position = 0;

    paramsNode.children.forEach(param => {
        let name: string | undefined;
        let type: string | undefined;

        if (param.type === 'identifier') { // Simple parameter
            name = getNodeText(param, sourceCode);
        } else if (param.type === 'typed_parameter') { // param: type
            const identifier = param.children.find(c => c.type === 'identifier');
            const typeNode = param.childForFieldName('type');
            name = identifier ? getNodeText(identifier, sourceCode) : undefined;
            type = typeNode ? getNodeText(typeNode, sourceCode) : undefined;
        } else if (param.type === 'default_parameter') { // param=value or param: type=value
            const identifierOrTyped = param.children[0];
            if (identifierOrTyped?.type === 'identifier') {
                name = getNodeText(identifierOrTyped, sourceCode);
            } else if (identifierOrTyped?.type === 'typed_parameter') {
                const identifier = identifierOrTyped.children.find(c => c.type === 'identifier');
                const typeNode = identifierOrTyped.childForFieldName('type');
                name = identifier ? getNodeText(identifier, sourceCode) : undefined;
                type = typeNode ? getNodeText(typeNode, sourceCode) : undefined;
            }
        }
        // Add handling for *args, **kwargs, tuple parameters etc. if needed

        if (name && name !== 'self' && name !== 'cls') { // Exclude self/cls
            parameters.push({ name, type, position });
            position++;
        }
    });

    return parameters;
}

// Extracts the full dotted name from attribute or identifier nodes
function getFullDottedName(node: SyntaxNode | null, sourceCode: string): string | null {
    if (!node) return null;
    if (node.type === 'identifier') {
        return getNodeText(node, sourceCode);
    }
    if (node.type === 'attribute') {
        const objectName = getFullDottedName(node.childForFieldName('object'), sourceCode);
        const attributeNode = node.childForFieldName('attribute'); // Get node first
        const attributeName = attributeNode ? getNodeText(attributeNode, sourceCode) : null; // Check if node exists
        return objectName && attributeName ? `${objectName}.${attributeName}` : attributeName; // Check attributeName too
    }
    // Handle other potential structures like subscript_expression if necessary
    return getNodeText(node, sourceCode); // Fallback
}

// Extracts import details
interface ImportDetail {
    sourceModule: string;
    importedName?: string; // The original name being imported
    alias?: string;        // The local name (alias)
}

function extractImportDetails(node: SyntaxNode, sourceCode: string): ImportDetail[] {
    const details: ImportDetail[] = [];

    if (node.type === 'import_statement') {
        // Handles: import module | import module as alias | import mod1, mod2 as alias2
        node.descendantsOfType('dotted_name').forEach(nameNode => {
            // Ensure we are processing the module name, not the alias identifier
            if (nameNode.parent?.type === 'aliased_import' && nameNode.parent.childForFieldName('alias') === nameNode) {
                return; // Skip alias identifiers
            }
            const sourceModule = getNodeText(nameNode, sourceCode);
            let alias: string | undefined;
            // Check if the direct parent is aliased_import to get the alias
            if (nameNode.parent?.type === 'aliased_import') {
                 alias = nameNode.parent.childForFieldName('alias')?.text;
            }
            details.push({ sourceModule, alias });
        });

    } else if (node.type === 'import_from_statement') {
        // Handles: from module import name | from module import name as alias | from module import * | from module import (name1, name2 as alias2)
        const moduleNameNode = node.childForFieldName('module_name');
        const sourceModule = moduleNameNode ? getNodeText(moduleNameNode, sourceCode) : 'unknown_module';

        if (node.descendantsOfType('wildcard_import').length > 0) {
            details.push({ sourceModule, importedName: '*' });
        } else {
            const processedNames = new Set<string>(); // Track processed non-aliased names to avoid duplicates

            // Process aliased imports first
            node.descendantsOfType('aliased_import').forEach(aliasNode => {
                const nameNode = aliasNode.childForFieldName('name');
                const aliasIdNode = aliasNode.childForFieldName('alias');
                if (nameNode) {
                    const importedName = getNodeText(nameNode, sourceCode);
                    const alias = aliasIdNode ? getNodeText(aliasIdNode, sourceCode) : undefined;
                    details.push({ sourceModule, importedName, alias });
                    processedNames.add(importedName); // Mark as processed
                }
            });

            // Find potential import list containers (import_list or parenthesized_import_list)
            const listContainers = node.children.filter(c => c.type === 'import_list' || c.type === 'parenthesized_import_list');

            if (listContainers.length > 0) {
                 listContainers.forEach(container => {
                     // Get the actual list node (might be the container itself or nested)
                     const listNode = container.type === 'parenthesized_import_list' ? container.namedChildren.find(nc => nc.type === 'import_list') : container;
                     listNode?.namedChildren.forEach(child => {
                         // Process only non-aliased dotted_names within the list
                         if (child.type === 'dotted_name' && child.parent?.type !== 'aliased_import') {
                             const importedName = getNodeText(child, sourceCode);
                             if (!processedNames.has(importedName)) { // Check if not already processed via alias
                                 details.push({ sourceModule, importedName });
                                 processedNames.add(importedName);
                             }
                         }
                     });
                 });
            } else {
                 // Handle single non-aliased import directly after 'import' keyword (if not already processed as alias)
                 // Find the 'import' keyword node first
                 const importKeywordNode = node.children.find(c => c.type === 'import');
                 // The imported name should be the next named sibling after 'import'
                 let potentialNameNode = importKeywordNode?.nextNamedSibling;
                 // If it's an aliased import, the actual name is the first child of the aliased_import node
                 if (potentialNameNode?.type === 'aliased_import') {
                     potentialNameNode = potentialNameNode.childForFieldName('name');
                 }

                 if (potentialNameNode?.type === 'dotted_name') {
                      const importedName = getNodeText(potentialNameNode, sourceCode);
                       if (!processedNames.has(importedName)) {
                           details.push({ sourceModule, importedName });
                       }
                 }
            }
        }
    }
    return details;
}


/**
 * Parses Python code using Tree-sitter and converts it into a FileIr object.
 */
export async function convertToIr(sourceCode: string, filePath: string, projectId: string): Promise<FileIr> { // Added projectId argument
  // const projectId = path.basename(path.dirname(filePath)) || 'unknown_project'; // Removed internal calculation
  const cleanedFilePath = filePath.replace(/\\/g, '/');
  const fileId: CanonicalId = `connectome://${projectId}/file:${cleanedFilePath}`; // Use passed projectId
  const analyzerLanguage = AnalyzerLanguage.Python; // Use AnalyzerLanguage for factory call
  const irLanguage = IrLanguage.Python; // Use IrLanguage for final IR object

  if (!sourceCode?.trim()) {
    return { schemaVersion: '1.0.0', projectId, fileId, filePath, language: irLanguage, elements: [], potentialRelationships: [] }; // Use irLanguage
  }

  const elements: IrElement[] = [];
  const potentialRelationships: PotentialRelationship[] = [];

  try {
    // Use ParserFactory to get the AST
    logger.debug(`Requesting parsing for ${filePath} (Python) via ParserFactory...`);
    const rootNode = await ParserFactory.parse(analyzerLanguage, sourceCode, filePath);

    // Handle parsing failure
    if (!rootNode) {
        logger.error(`Parsing failed for ${filePath}. ParserFactory returned null.`);
        return { schemaVersion: '1.0.0', projectId, fileId, filePath, language: irLanguage, elements: [], potentialRelationships: [] }; // Use irLanguage
    }
    logger.debug(`Successfully received AST for ${filePath} from ParserFactory.`);

    logger.debug(`Starting Python IR conversion for: ${filePath}`);

    // --- AST Traversal ---
    const contextStack: { elementId: CanonicalId; type: ElementType, parentId?: CanonicalId }[] = [{ elementId: fileId, type: 'File' }]; // Start with file context

    function traverse(node: SyntaxNode, isClassMember = false) {
        let element: Omit<IrElement, 'id'> | null = null;
        let relationship: PotentialRelationship | null = null;
        let relationships: PotentialRelationship[] = [];
        let skipChildren = false;
        let newContextPushed = false;
        // Context is guaranteed to exist because we push the file context initially and only pop when newContextPushed is true
        const context = contextStack[contextStack.length - 1]!; // Use non-null assertion
        const currentElementId = context.elementId;

        try {
            switch (node.type) {
                case 'module':
                    // Optional: Create Module element if needed, otherwise file context is used.
                    // const moduleElement: Omit<IrElement, 'id'> = { type: 'Module', name: path.basename(filePath, '.py'), filePath, location: getNodeLocation(node), properties: { language: analyzerLanguage } as ModuleProperties }; // Use analyzerLanguage if needed here
                    // const moduleElementWithId = addIdToElement(moduleElement, projectId);
                    // elements.push(moduleElementWithId);
                    // contextStack.push({ elementId: moduleElementWithId.id, type: 'Module', parentId: fileId });
                    // newContextPushed = true;
                    break;

                case 'function_definition': {
                    const nameNode = node.childForFieldName('name');
                    const name = nameNode ? getNodeText(nameNode, sourceCode) : 'anonymous_function';
                    const parameters = extractParameters(node, sourceCode);
                    const signature = `(${parameters.map(p => p.name).join(', ')})`; // Removed function name from signature
                    const isAsync = node.children.some(c => c.type === 'async');
                    const elementType: ElementType = 'Function'; // Methods are represented as Functions with a parentId

                    const properties: FunctionProperties = {
                        language: irLanguage, // Use irLanguage for schema properties
                        signature: signature,
                        parameters: parameters,
                        parentId: isClassMember ? context.elementId : undefined, // Link method to class using context ID
                        isAsync: isAsync,
                        rawSignature: node.text.substring(0, node.text.indexOf(':')).trim(), // Moved rawSignature here
                    };
                    element = { type: elementType, name, filePath, location: getNodeLocation(node), properties };

                    // Generate ID for the function element *before* using it in relationships
                    const funcElementId = generateCanonicalId(element, projectId);

                    // Check for decorators (like @app.route)
                    const decorators = node.children.filter(c => c.type === 'decorator');
                    decorators.forEach(decoratorNode => {
                        const decoratorName = getFullDottedName(decoratorNode.childForFieldName('decorator'), sourceCode);
                        const decoratorArgs = extractArguments(decoratorNode, sourceCode);

                        // Specific handling for Flask/FastAPI route decorators
                        if (decoratorName === 'app.route' || decoratorName === 'app.get' || decoratorName === 'app.post' /* etc. */) {
                            const firstArgNode = decoratorNode.descendantsOfType('string')[0]; // More robust way to find first string arg
                            // Add null check for firstArgNode before passing to getStringLiteralValue
                            const pathPattern = decoratorArgs[0] ? getStringLiteralValue(firstArgNode ?? null, sourceCode) ?? decoratorArgs[0] : '/';
                            const httpMethodMatch = decoratorName.match(/\.(get|post|put|delete|patch)$/i);
                            const httpMethod = httpMethodMatch?.[1]?.toUpperCase() ?? 'GET'; // Default GET for .route, added safe access

                            // Create the route element
                            const routeName = `${httpMethod}:${pathPattern}`;
                            const routeElementPartial: Omit<IrElement, 'id'> = {
                                type: 'ApiRouteDefinition',
                                name: routeName,
                                filePath,
                                location: getNodeLocation(decoratorNode),
                                properties: {
                                    language: irLanguage, // Use irLanguage for schema properties
                                    httpMethod: httpMethod,
                                    pathPattern: pathPattern,
                                    handlerId: funcElementId, // Link route def to the function element ID
                                    rawSignature: decoratorNode.text, // Moved rawSignature here
                                } as ApiRouteDefinitionProperties
                            };
                            // Generate ID for the route element
                            // const routeElementId = generateCanonicalId(routeElementPartial, projectId); // ID generated by addIdToElement
                            const routeElementWithId = addIdToElement(routeElementPartial, projectId);
                            elements.push(routeElementWithId); // Add route element immediately

                            // Add relationship from function to the decorator usage
                            relationships.push({
                                sourceId: funcElementId, // Function ID
                                type: 'UsesAnnotation', targetPattern: decoratorName, // Renamed type
                                location: getNodeLocation(decoratorNode),
                                properties: {
                                    annotationName: decoratorName,
                                    arguments: decoratorArgs,
                                    rawReference: decoratorNode.text, // Moved rawReference here
                                } as UsesAnnotationProperties, // Corrected type cast
                            });

                        } else {
                             // Generic annotation usage relationship
                             if (decoratorName) {
                                relationships.push({
                                    sourceId: funcElementId, // Function ID
                                    type: 'UsesAnnotation', targetPattern: decoratorName,
                                    location: getNodeLocation(decoratorNode),
                                    properties: {
                                        annotationName: decoratorName,
                                        arguments: decoratorArgs,
                                        rawReference: decoratorNode.text,
                                    } as UsesAnnotationProperties,
                                });
                             }
                        }
                    });
                    break;
                }

                case 'class_definition': {
                    const nameNode = node.childForFieldName('name');
                    const name = nameNode ? getNodeText(nameNode, sourceCode) : 'anonymous_class';
                    const properties: ClassProperties = {
                        language: irLanguage, // Use irLanguage for schema properties
                        rawSignature: node.text.substring(0, node.text.indexOf(':')).trim(), // Moved rawSignature here
                        // TODO: Add extends/implements resolution
                    };
                    element = { type: 'Class', name, filePath, location: getNodeLocation(node), properties };
                    break;
                }

                case 'assignment': // Covers simple variable assignment
                case 'expression_statement': // Might contain assignment
                {
                     let assignmentNode = node.type === 'assignment' ? node : null;
                     if (!assignmentNode && node.firstChild?.type === 'assignment') {
                         assignmentNode = node.firstChild;
                     }

                     if (assignmentNode) {
                         const leftNode = assignmentNode.childForFieldName('left');
                         const rightNode = assignmentNode.childForFieldName('right');
                         const variableName = leftNode ? getNodeText(leftNode, sourceCode) : null;

                         if (variableName && leftNode?.type === 'identifier') {
                             // Basic variable creation - could be refined for scope
                             const properties: VariableProperties = {
                                 language: irLanguage, // Use irLanguage for schema properties
                                 parentId: isClassMember ? context.elementId : undefined, // Use context ID
                                 rawSignature: node.text, // Moved rawSignature here
                                 // TODO: Infer type from rightNode if possible
                             };
                             element = { type: 'Variable', name: variableName, filePath, location: getNodeLocation(assignmentNode), properties }; // Use assignmentNode location
                         }
                         // TODO: Handle attribute assignment (self.x = ...) -> Writes relationship
                         // TODO: Handle tuple assignment (a, b = ...)
                     }
                     break;
                }


                case 'import_statement':
                case 'import_from_statement': {
                    const importDetailsList = extractImportDetails(node, sourceCode);
                    importDetailsList.forEach(importDetails => {
                        relationships.push({
                            sourceId: fileId, type: 'Imports', targetPattern: importDetails.sourceModule, // Renamed type
                            location: getNodeLocation(node),
                            properties: {
                                moduleSpecifier: importDetails.sourceModule,
                                importedEntityName: importDetails.importedName,
                                alias: importDetails.alias,
                                rawReference: node.text, // Moved rawReference here
                            } as ImportsProperties, // Corrected type cast
                        });
                    });
                    skipChildren = true;
                    break;
                }

                case 'call': { // Python call expression
                    const funcNode = node.childForFieldName('function');
                    const targetPattern = getFullDottedName(funcNode, sourceCode);
                    const args = extractArguments(node, sourceCode);
                    const location = getNodeLocation(node);

                    if (targetPattern) {
                        // Basic check for database calls (e.g., cursor.execute)
                        if (targetPattern.endsWith('.execute') && args.length > 0) {
                            const queryArg = args[0]; // Assuming query is the first arg
                            const queryProps: DatabaseQueryProperties = {
                                rawSql: queryArg, // Store the raw SQL string/variable name
                                queryType: 'UNKNOWN', // Could try basic keyword detection
                                rawReference: node.text, // Moved rawReference here
                            };
                             relationship = {
                                sourceId: currentElementId, type: 'DatabaseQuery', targetPattern: 'DATABASE', // Generic target for now
                                location, properties: queryProps
                            };
                        } else {
                            // Default to function call
                            relationship = {
                                sourceId: currentElementId, type: 'Calls', targetPattern, location, // Renamed type
                                properties: {
                                    // arguments: args, // Optional
                                    rawReference: node.text, // Moved rawReference here
                                } as CallsProperties, // Corrected type cast
                            };
                        }
                    }
                    break;
                }
            }

            // --- Add Element ---
            if (element) {
                const elementWithId = addIdToElement(element, projectId);
                elements.push(elementWithId);
                // Only push context if it's a class or function/method
                if (element.type === 'Class' || element.type === 'Function' || element.type === 'Method') {
                    // Add parentId from the current context when pushing new context
                    contextStack.push({ elementId: elementWithId.id, type: element.type, parentId: context.elementId }); // Use non-null assertion
                    newContextPushed = true;
                }
            }

            // --- Add Relationships ---
             if (relationship) {
                potentialRelationships.push(relationship);
            }
            if (relationships.length > 0) {
                potentialRelationships.push(...relationships);
            }


            // --- Recurse ---
            if (!skipChildren) {
                // Determine if children are class members
                const passIsClassMember = (element?.type === 'Class') || (isClassMember && context.type === 'Class'); // Use non-null assertion
                node.children.forEach(child => traverse(child, passIsClassMember));
            }

            // --- Pop Context ---
            if (newContextPushed) {
                contextStack.pop();
            }

        } catch (error) {
            logger.error(`Error processing Python node type ${node.type} at ${filePath}:${node.startPosition.row + 1}:`, error);
        }
    }

    traverse(rootNode); // Start traversal

  } catch (error: any) {
    logger.error(`Failed to convert Python file ${filePath}: ${error.message}`, { error });
    // Return minimal FileIr on error
    return { schemaVersion: '1.0.0', projectId, fileId, filePath, language: irLanguage, elements: [], potentialRelationships: [] }; // Use irLanguage
  }

  // Construct the final FileIr object
  const fileIr: FileIr = {
    schemaVersion: '1.0.0',
    projectId: projectId,
    fileId: fileId,
    filePath: filePath,
    language: irLanguage, // Use irLanguage for final object
    elements: elements,
    potentialRelationships: potentialRelationships,
  };

  return fileIr;
}