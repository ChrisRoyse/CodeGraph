/**
 * @file Converts Java source code to IR elements and potential relationships using Tree-sitter.
 */

import Parser from 'tree-sitter';
import Java from 'tree-sitter-java'; // Ensure this package is installed

import {
  FileIr,
  Language,
  IrElement,
  PotentialRelationship,
  ElementType,
  RelationshipType,
  Location,
  Position,
  CanonicalId,
  FunctionProperties,
  ParameterDetail,
  ClassProperties,
  VariableProperties,
  ImportProperties,
  FunctionCallProperties,
  InstantiationProperties,
} from '../schema.js';
import { ILanguageConverter } from '../source-to-ir-converter.js';
import { addIdToElement } from '../ir-utils.js'; // Import the ID generation utility

// Helper function to get text content of a node
function getNodeText(node: Parser.SyntaxNode, sourceCode: string): string {
  return sourceCode.substring(node.startIndex, node.endIndex);
}

// Helper function to convert Tree-sitter point to IR Position (1-based line)
function tsPointToPosition(point: Parser.Point): Position {
  return { line: point.row + 1, column: point.column };
}

// Helper function to get the Location of a node
function getNodeLocation(node: Parser.SyntaxNode): Location {
  return {
    start: tsPointToPosition(node.startPosition),
    end: tsPointToPosition(node.endPosition),
  };
}

// Helper function to extract modifier text
function getModifiers(node: Parser.SyntaxNode | null): string[] {
    if (!node) return [];
    return node.children.map(child => child.text); // Assuming modifiers node contains keyword children
}


/**
 * Converts Java source code to an Intermediate Representation (IR) FileIr object.
 * Parses the code using Tree-sitter to identify classes, methods, fields, imports,
 * method calls, and instantiations.
 *
 * @param sourceCode The Java source code content.
 * @param filePath The project-relative path to the source file.
 * @param projectId A unique identifier for the project.
 * @returns A promise that resolves to the FileIr object representing the parsed file.
 */
export const convertJavaToIr: ILanguageConverter = async (
  sourceCode: string,
  filePath: string,
  projectId: string = 'unknown-project', // Use provided or default project ID
): Promise<FileIr> => {
  // Parser.init() is typically not needed; initialization happens implicitly
  const parser = new Parser();
  parser.setLanguage(Java as any); // Cast to 'any' to resolve potential type mismatch

  const tree = parser.parse(sourceCode);
  const rootNode = tree.rootNode;

  const elements: IrElement[] = [];
  const potentialRelationships: PotentialRelationship[] = [];

  // Generate File ID consistently
  const fileId: CanonicalId = `connectome://${projectId}/file:${filePath.replace(/\\/g, '/')}`;

  // --- Traversal Logic ---
  function traverse(node: Parser.SyntaxNode, parentClassId?: CanonicalId, currentScopeId: CanonicalId = fileId) {
    let nextScopeId = currentScopeId; // ID of the element that contains subsequent relationships

    try { // Add error handling for robustness during traversal
        switch (node.type) {
            case 'class_declaration': {
                const nameNode = node.childForFieldName('name');
                if (nameNode) {
                    const className = getNodeText(nameNode, sourceCode);
                    const classLocation = getNodeLocation(node); // Location of the whole class block
                    const nameLocation = getNodeLocation(nameNode); // More precise location for the name

                    const properties: ClassProperties = {
                        // TODO: Parse extends/implements if needed
                    };

                    const elementDraft: Omit<IrElement, 'id'> = {
                        filePath: filePath,
                        type: 'Class',
                        name: className,
                        location: nameLocation, // Use name location for the element itself
                        properties: properties,
                        rawSignature: (getNodeText(node, sourceCode).split('{')[0] ?? '').trim(), // Get declaration part safely
                    };
                    const classElement = addIdToElement(elementDraft, projectId);
                    elements.push(classElement);
                    parentClassId = classElement.id;
                    nextScopeId = classElement.id; // Relationships inside class but outside methods belong to class
                }
                break;
            }

            case 'method_declaration': {
                const nameNode = node.childForFieldName('name');
                const typeNode = node.childForFieldName('type'); // Return type
                const paramsNode = node.childForFieldName('parameters');
                const modifiersNode = node.childForFieldName('modifiers');
                const modifiers = getModifiers(modifiersNode);

                if (nameNode && typeNode && paramsNode) {
                    const methodName = getNodeText(nameNode, sourceCode);
                    const returnType = getNodeText(typeNode, sourceCode);
                    const methodLocation = getNodeLocation(node);
                    const nameLocation = getNodeLocation(nameNode);

                    const parameters: ParameterDetail[] = paramsNode.namedChildren
                        .filter(p => p.type === 'formal_parameter')
                        .map((paramNode, index) => {
                            const paramTypeNode = paramNode.childForFieldName('type');
                            const paramNameNode = paramNode.childForFieldName('name');
                            return {
                                name: paramNameNode ? getNodeText(paramNameNode, sourceCode) : `param${index}`,
                                type: paramTypeNode ? getNodeText(paramTypeNode, sourceCode) : 'unknown',
                                position: index,
                            };
                        });

                    const properties: FunctionProperties = {
                        parentId: parentClassId, // Link method to its class
                        returnType: returnType,
                        parameters: parameters,
                        isStatic: modifiers.includes('static'),
                        accessModifier: modifiers.find(m => ['public', 'private', 'protected'].includes(m)) as FunctionProperties['accessModifier'] ?? undefined, // Default to undefined if none found
                        // signature: // Could construct a more detailed signature string
                    };

                    const elementDraft: Omit<IrElement, 'id'> = {
                        filePath: filePath,
                        type: 'Function',
                        name: methodName,
                        location: nameLocation,
                        properties: properties,
                        rawSignature: (getNodeText(node, sourceCode).split('{')[0] ?? '').trim(),
                    };
                    const methodElement = addIdToElement(elementDraft, projectId);
                    elements.push(methodElement);
                    nextScopeId = methodElement.id; // Relationships inside this method originate from it
                }
                break;
            }

             case 'field_declaration': {
                const typeNode = node.childForFieldName('type');
                const modifiersNode = node.childForFieldName('modifiers');
                const modifiers = getModifiers(modifiersNode);

                if (typeNode) {
                    const dataType = getNodeText(typeNode, sourceCode);
                    // A field declaration can declare multiple variables (e.g., int i, j;)
                    const declarators = node.children.filter(c => c.type === 'variable_declarator');

                    for (const declarator of declarators) {
                        const nameNode = declarator.childForFieldName('name');
                        if (nameNode) {
                            const fieldName = getNodeText(nameNode, sourceCode);
                            const nameLocation = getNodeLocation(nameNode);

                            const properties: VariableProperties = {
                                parentId: parentClassId, // Link field to its class
                                dataType: dataType,
                                isStatic: modifiers.includes('static'),
                                isConstant: modifiers.includes('final'),
                                accessModifier: modifiers.find(m => ['public', 'private', 'protected'].includes(m)) as VariableProperties['accessModifier'] ?? undefined, // Default to undefined if none found
                            };

                            const elementDraft: Omit<IrElement, 'id'> = {
                                filePath: filePath,
                                type: 'Variable',
                                name: fieldName,
                                location: nameLocation,
                                properties: properties,
                                rawSignature: getNodeText(node, sourceCode).replace(';', '').trim(),
                            };
                            const fieldElement = addIdToElement(elementDraft, projectId);
                            elements.push(fieldElement);
                            // Note: Initializers are children of the declarator, traversal will handle calls within them
                        }
                    }
                }
                break;
            }

            case 'import_declaration': {
                const nameNode = node.childForFieldName('name'); // This gets the package/class name
                if (nameNode) {
                    const moduleSpecifier = getNodeText(nameNode, sourceCode);
                    const isStatic = node.children.some(c => c.type === 'static'); // Check for static imports
                    const isWildcard = node.children.some(c => c.type === 'asterisk'); // Check for wildcard imports

                    const properties: ImportProperties = {
                        moduleSpecifier: moduleSpecifier,
                        // importedEntityName could be derived if not wildcard, but complex for Java's structure
                    };

                    const relationship: PotentialRelationship = {
                        sourceId: fileId, // Imports belong to the file scope
                        type: 'Import',
                        targetPattern: moduleSpecifier + (isWildcard ? '.*' : ''),
                        location: getNodeLocation(node),
                        properties: properties,
                        rawReference: getNodeText(node, sourceCode),
                    };
                    potentialRelationships.push(relationship);
                }
                break;
            }

            case 'method_invocation': {
                const nameNode = node.childForFieldName('name');
                const objectNode = node.childForFieldName('object'); // e.g., `System.out` or `processor`
                const argsNode = node.childForFieldName('arguments');

                if (nameNode) {
                    const methodName = getNodeText(nameNode, sourceCode);
                    let targetPattern = methodName;
                    if (objectNode) {
                        // Construct a qualified name if possible (e.g., System.out.println, processor.process)
                        // This might require more sophisticated type resolution for accuracy
                        targetPattern = `${getNodeText(objectNode, sourceCode)}.${methodName}`;
                    }

                    const properties: FunctionCallProperties = {
                        // arguments: argsNode ? argsNode.namedChildren.map(arg => getNodeText(arg, sourceCode)) : [], // Can be complex
                    };

                    const relationship: PotentialRelationship = {
                        sourceId: currentScopeId, // Call originates from the current method/class scope
                        type: 'FunctionCall',
                        targetPattern: targetPattern,
                        location: getNodeLocation(node),
                        properties: properties,
                        rawReference: getNodeText(node, sourceCode),
                    };
                    potentialRelationships.push(relationship);
                }
                break;
            }

            case 'object_creation_expression': { // Handles 'new ClassName(...)'
                const typeNode = node.childForFieldName('type');
                const argsNode = node.childForFieldName('arguments');

                if (typeNode) {
                    const className = getNodeText(typeNode, sourceCode);

                    const properties: InstantiationProperties = {
                        // arguments: argsNode ? argsNode.namedChildren.map(arg => getNodeText(arg, sourceCode)) : [],
                    };

                    const relationship: PotentialRelationship = {
                        sourceId: currentScopeId, // Instantiation happens in the current scope
                        type: 'Instantiation',
                        targetPattern: className, // Target is the class being instantiated
                        location: getNodeLocation(node),
                        properties: properties,
                        rawReference: getNodeText(node, sourceCode),
                    };
                    potentialRelationships.push(relationship);
                }
                break;
            }
        }
    } catch (error) {
        console.error(`Error processing node type ${node.type} at ${filePath}:${node.startPosition.row + 1}:${node.startPosition.column}:`, error);
        // Optionally skip this node or re-throw, depending on desired robustness
    }


    // --- Recursion ---
    // Pass down the parentClassId and the determined nextScopeId
    for (const child of node.children) {
      traverse(child, parentClassId, nextScopeId);
    }
  }

  // Start traversal from the root
  traverse(rootNode, undefined, fileId);

  // --- Final Assembly ---
  const fileIr: FileIr = {
    schemaVersion: '1.0',
    projectId: projectId,
    fileId: fileId,
    filePath: filePath,
    language: Language.Java,
    elements: elements,
    potentialRelationships: potentialRelationships,
  };

  return Promise.resolve(fileIr);
};