// Import IR schema types, alias Language as IrLanguage
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
  FunctionProperties,
  ClassProperties,
  InterfaceProperties,
  VariableProperties,
  ImportsProperties,
  ApiFetchProperties,
  CallsProperties,
  ParameterDetail,
  InheritsProperties, // Assuming BaseRelationshipProperties is sufficient
  ImplementsProperties, // Assuming BaseRelationshipProperties is sufficient
} from '../schema.js';
// Import the Language enum used by the core analyzer/parser factory
import { Language as AnalyzerLanguage } from '../../types/index.js';
import { addIdToElement, generateCanonicalId } from '../ir-utils.js'; // Use ESM import
// Import types separately
import type Parser from 'tree-sitter';
import type { SyntaxNode } from 'tree-sitter';
import path from 'path'; // Use ESM import
// Import ParserFactory instead of direct parser/grammar loader
import { ParserFactory } from '../../analyzer/parsers/parser-factory.js';

// --- Helper Functions ---

/** Gets the text content of a syntax node. */
function getNodeText(node: SyntaxNode, sourceCode: string): string { // Use imported SyntaxNode type
  return sourceCode.substring(node.startIndex, node.endIndex);
}

/** Gets the start and end position (1-based line, 0-based column) of a node. */
function getNodeLocation(node: SyntaxNode): Location { // Use imported SyntaxNode type
  return {
    start: { line: node.startPosition.row + 1, column: node.startPosition.column },
    end: { line: node.endPosition.row + 1, column: node.endPosition.column },
  };
}

/** Extracts text from string literal nodes, removing quotes. */
function getStringLiteralValue(node: SyntaxNode, sourceCode: string): string | null { // Use imported SyntaxNode type
    if (node.type === 'string' || node.type === 'template_string') {
        // Handle simple strings and template strings without substitutions
        if (node.descendantsOfType('template_substitution').length === 0) {
            return getNodeText(node, sourceCode).replace(/^['"`]|['"`]$/g, '');
        }
        // Basic handling for template strings with substitutions - return raw for now
        // TODO: Implement more sophisticated pattern extraction if needed
        return getNodeText(node, sourceCode);
    }
    return null;
}

/** Attempts to create a URL pattern from a node, handling template strings. */
function extractUrlPattern(node: SyntaxNode, sourceCode: string): string { // Use imported SyntaxNode type
    if (node.type === 'string') {
        return getNodeText(node, sourceCode).replace(/^['"`]|['"`]$/g, '');
    } else if (node.type === 'template_string') {
        let pattern = '';
        node.children.forEach(child => {
            if (child.type === 'template_substitution') {
                pattern += '{var}'; // Replace substitutions with a placeholder
            } else {
                // Append the literal part (stripping backticks if necessary)
                 pattern += child.text.replace(/^`|`$/g, '');
            }
        });
        return pattern;
    } else if (node.type === 'identifier') {
        // If it's just a variable, use its name as the pattern (less ideal)
        return `{${getNodeText(node, sourceCode)}}`;
    } else if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === '+') {
         // Handle simple string concatenation (recursive)
         const left = node.childForFieldName('left');
         const right = node.childForFieldName('right');
         let leftPattern = left ? extractUrlPattern(left, sourceCode) : '';
         let rightPattern = right ? extractUrlPattern(right, sourceCode) : '';
         // Avoid adding placeholders if parts are already patterns
         if (!leftPattern.startsWith('{') && left?.type !== 'string' && left?.type !== 'template_string') leftPattern = `{${leftPattern}}`;
         if (!rightPattern.startsWith('{') && right?.type !== 'string' && right?.type !== 'template_string') rightPattern = `{${rightPattern}}`;
         return leftPattern + rightPattern;
    }
    // Fallback for complex expressions
    return '{dynamic_url}';
}


// --- Partial Element/Relationship Creation Helpers ---

function createPartialFunctionElement(
    node: SyntaxNode, // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage, // Expect AnalyzerLanguage here
    elementType: 'Function' | 'Method' = 'Function', // Corrected type
    parentId?: CanonicalId // For methods within classes/interfaces
): Omit<IrElement, 'id'> {
  const location = getNodeLocation(node);
  const nameNode = node.childForFieldName('name');
  // Arrow functions might have name in parent VariableDeclarator
  let name = nameNode ? getNodeText(nameNode, sourceCode) : null;
  if (!name && (node.type === 'arrow_function' || node.type === 'function') && node.parent?.type === 'variable_declarator') {
      const parentNameNode = node.parent.childForFieldName('name');
      name = parentNameNode ? getNodeText(parentNameNode, sourceCode) : 'anonymous_function';
  }
  name = name || 'anonymous_function';


  const parametersNode = node.childForFieldName('parameters');
  const returnTypeNode = node.childForFieldName('return_type');
  const bodyNode = node.childForFieldName('body');

  // Parameter parsing
  const parameters: ParameterDetail[] = [];
  if (parametersNode) {
      // Filter children to only include actual parameter nodes before iterating
      const actualParamNodes = parametersNode.children.filter(
          p => ['required_parameter', 'optional_parameter', 'identifier', 'assignment_pattern', 'rest_pattern'].includes(p.type)
      );
      actualParamNodes.forEach((paramNode, index) => { // Index is now correct (0-based for actual params)
          let paramName: string | undefined;
          let paramType: string | undefined;
          let typeNode: SyntaxNode | null = null; // Keep track of the type node

          // Handle different parameter structures
          if (paramNode.type === 'required_parameter' || paramNode.type === 'optional_parameter') {
              const patternNode = paramNode.childForFieldName('pattern');
              typeNode = paramNode.childForFieldName('type');
              paramName = patternNode ? getNodeText(patternNode, sourceCode) : undefined;
              // paramType extracted below
          } else if (paramNode.type === 'identifier') { // Simple identifier parameter (often within parameters node directly)
              paramName = getNodeText(paramNode, sourceCode);
              // Type might be associated differently, look for type_annotation sibling? Less common directly here.
          } else if (paramNode.type === 'assignment_pattern') { // Parameter with default value
              const leftNode = paramNode.childForFieldName('left');
              paramName = leftNode ? getNodeText(leftNode, sourceCode) : undefined;
              // Type might be on the left node if it's a required_parameter structure inside
              if (leftNode?.type === 'required_parameter') {
                  typeNode = leftNode.childForFieldName('type');
              }
          } else if (paramNode.type === 'rest_pattern') {
              const identifier = paramNode.children.find(c => c.type === 'identifier');
              paramName = identifier ? getNodeText(identifier, sourceCode) : undefined;
              typeNode = paramNode.childForFieldName('type'); // Type for rest parameter
          }
          // Add more cases if needed (destructuring)

          // Extract and clean type text
          if (typeNode) {
              // Find the actual type identifier node (handles various type syntaxes)
              const typeIdentifierNode = typeNode.descendantsOfType('type_identifier')[0] ??
                                         typeNode.descendantsOfType('predefined_type')[0] ??
                                         typeNode.descendantsOfType('generic_type')[0] ?? // Handle generics like Array<string>
                                         typeNode.descendantsOfType('union_type')[0] ?? // Handle union types like string | number
                                         typeNode.descendantsOfType('intersection_type')[0] ?? // Handle intersection types
                                         typeNode; // Fallback to the whole type node if specific identifier not found
              paramType = getNodeText(typeIdentifierNode, sourceCode).trim();
          }


          if (paramName) {
              parameters.push({
                  name: paramName,
                  type: paramType, // Use cleaned type
                  position: index, // Use correct index
              });
          }
      });
  }

  // Check for 'async' keyword
 // Check for 'async' keyword more reliably by checking children
 const isAsync = node.children.some(child => child.type === 'async') ||
                 (node.type === 'arrow_function' && node.firstChild?.type === 'async') || // Check first child for arrow functions specifically
                 false;


  // Map AnalyzerLanguage to IrLanguage for the properties object
  const irLanguage = language === AnalyzerLanguage.TSX ? IrLanguage.TSX : IrLanguage.TypeScript;

  const properties: FunctionProperties = {
    language: irLanguage, // Use IrLanguage for schema properties
    // Construct signature from cleaned parameters and return type
    signature: `${name}(${parameters.map(p => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ')})${returnTypeNode ? `: ${getNodeText(returnTypeNode.descendantsOfType('type_identifier')[0] ?? returnTypeNode.descendantsOfType('predefined_type')[0] ?? returnTypeNode.descendantsOfType('generic_type')[0] ?? returnTypeNode.descendantsOfType('union_type')[0] ?? returnTypeNode.descendantsOfType('intersection_type')[0] ?? returnTypeNode, sourceCode).trim()}` : ''}`,
    parameters: parameters, // Use the updated parameters array
    // Clean return type as well
    returnType: returnTypeNode ? getNodeText(returnTypeNode.descendantsOfType('type_identifier')[0] ?? returnTypeNode.descendantsOfType('predefined_type')[0] ?? returnTypeNode.descendantsOfType('generic_type')[0] ?? returnTypeNode.descendantsOfType('union_type')[0] ?? returnTypeNode.descendantsOfType('intersection_type')[0] ?? returnTypeNode, sourceCode).trim() : undefined,
    isAsync: isAsync || (bodyNode?.descendantsOfType('await_expression').length ?? 0) > 0, // Check body too
    parentId: parentId,
    rawSignature: getNodeText(node, sourceCode).split('{')[0]?.trim(), // Ensure rawSignature is here
    // TODO: Add isStatic, accessModifier detection for methods if needed
  };

  return {
    type: elementType, // Use elementType parameter
    name: name,
    filePath: filePath,
    location: location,
    properties: properties,
    // rawSignature is now correctly inside properties
  };
}


function createPartialClassElement(
    node: SyntaxNode, // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage // Expect AnalyzerLanguage here
): Omit<IrElement, 'id'> {
  const location = getNodeLocation(node);
  const nameNode = node.childForFieldName('name');
  const name = nameNode ? getNodeText(nameNode, sourceCode) : 'anonymous_class';
  const irLanguage = language === AnalyzerLanguage.TSX ? IrLanguage.TSX : IrLanguage.TypeScript;

  const properties: ClassProperties = {
    language: irLanguage, // Use IrLanguage for schema properties
    rawSignature: getNodeText(node, sourceCode).split('{')[0]?.trim(), // Ensure rawSignature is here
    // extends/implements will be PotentialRelationships
  };

  return {
    type: 'Class',
    name: name,
    filePath: filePath,
    location: location,
    properties: properties,
    // rawSignature is now correctly inside properties
  };
}

function createPartialInterfaceElement(
    node: SyntaxNode, // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage // Expect AnalyzerLanguage here
): Omit<IrElement, 'id'> {
   const location = getNodeLocation(node);
   const nameNode = node.childForFieldName('name');
   const name = nameNode ? getNodeText(nameNode, sourceCode) : 'anonymous_interface';
   const irLanguage = language === AnalyzerLanguage.TSX ? IrLanguage.TSX : IrLanguage.TypeScript;

   const properties: InterfaceProperties = {
       language: irLanguage, // Use IrLanguage for schema properties
       rawSignature: getNodeText(node, sourceCode).split('{')[0]?.trim(), // Ensure rawSignature is here
       // extends will be PotentialRelationships
   };
   return {
     type: 'Interface',
     name: name,
     filePath: filePath,
     location: location,
     properties: properties,
     // rawSignature is now correctly inside properties
   };
 }

function createPartialVariableElements(
    node: SyntaxNode, // lexical_declaration or variable_declaration node // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage, // Expect AnalyzerLanguage here
    parentId?: CanonicalId // For class properties
): Omit<IrElement, 'id'>[] {
  const variables: Omit<IrElement, 'id'>[] = [];
  // Check declaration type (const, let, var)
  const declarationKeyword = node.firstChild?.text;
  const isConstant = declarationKeyword === 'const';
  const irLanguage = language === AnalyzerLanguage.TSX ? IrLanguage.TSX : IrLanguage.TypeScript;


  node.descendantsOfType('variable_declarator').forEach(declarator => {
    const nameNode = declarator.childForFieldName('name');
    const typeNode = declarator.childForFieldName('type'); // Explicit type annotation
    const valueNode = declarator.childForFieldName('value');

    if (nameNode) {
      const name = getNodeText(nameNode, sourceCode);
      const location = getNodeLocation(declarator); // Location of the specific declarator

      // Basic type inference from value
      let dataType = typeNode ? getNodeText(typeNode, sourceCode) : undefined;
      if (!dataType && valueNode) {
          if (valueNode.type === 'string' || valueNode.type === 'template_string') {
              dataType = 'string';
          } else if (valueNode.type === 'number') {
              dataType = 'number';
          } else if (valueNode.type === 'true' || valueNode.type === 'false') {
              dataType = 'boolean';
          } else if (valueNode.type === 'object') {
              dataType = 'object';
          } else if (valueNode.type === 'array') {
              dataType = 'array';
          } else if (valueNode.type === 'arrow_function' || valueNode.type === 'function') {
              // Handled separately by function creation logic if needed as element
              dataType = 'function'; // Simple type name
          } else if (valueNode.type === 'call_expression') {
              // Type is the result of the call, hard to determine statically
              dataType = 'any'; // Or attempt to resolve call target type later
          }
          // Add more inference rules as needed
      }


      // Check if the value is an arrow function or regular function
      // If so, a separate Function element might be created by the main traversal
      // We still create the variable element here.
      const isFunctionVariable = valueNode?.type === 'arrow_function' || valueNode?.type === 'function';


      const properties: VariableProperties = {
        language: irLanguage, // Use IrLanguage for schema properties
        dataType: dataType,
        isConstant: isConstant,
        parentId: parentId,
        rawSignature: getNodeText(declarator, sourceCode), // Ensure rawSignature is here
        // TODO: Add isStatic, accessModifier detection for class properties
      };

      variables.push({
        type: 'Variable',
        name: name,
        filePath: filePath,
        location: location,
        properties: properties,
        // rawSignature is now correctly inside properties
      });
    }
  });
  return variables;
}

function createPotentialImportRelationship(
    node: SyntaxNode, // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage, // Expect AnalyzerLanguage here
    sourceId: CanonicalId // ID of the file
): PotentialRelationship[] { // Always return array
  const location = getNodeLocation(node);
  const sourceNode = node.childForFieldName('source');
  const sourceModule = sourceNode ? getStringLiteralValue(sourceNode, sourceCode) ?? 'unknown_source' : 'unknown_source';

  const relationships: PotentialRelationship[] = [];
  let defaultImportName: string | undefined = undefined;
  const namedImportNodes: SyntaxNode[] = []; // Use imported SyntaxNode type
  let namespaceImportName: string | undefined = undefined;
  let isTypeImport = false; // Check for `import type`

  // Check for `import type` keyword
  if (node.children.some(c => c.type === 'type')) {
      isTypeImport = true;
  }

  // Find different import types
  node.children.forEach(child => {
      if (child.type === 'import_clause') {
          child.children.forEach(clauseChild => {
              if (clauseChild.type === 'identifier') { // Default import
                  defaultImportName = getNodeText(clauseChild, sourceCode);
              } else if (clauseChild.type === 'named_imports') { // { named1, named2 }
                  clauseChild.children.filter(imp => imp.type === 'import_specifier').forEach(spec => {
                      namedImportNodes.push(spec);
                  });
              } else if (clauseChild.type === 'namespace_import') { // * as namespace
                  const identifier = clauseChild.children.find(c => c.type === 'identifier');
                  if (identifier) {
                      namespaceImportName = getNodeText(identifier, sourceCode);
                  }
              }
          });
      }
  });

  // Create relationship for default import
  if (defaultImportName) {
      relationships.push({
          sourceId: sourceId,
          type: 'Imports',
          targetPattern: sourceModule,
          location: getNodeLocation(node.children.find(c => c.type === 'import_clause')?.children.find(cc => cc.type === 'identifier') ?? node), // Location of the default identifier
          properties: {
              moduleSpecifier: sourceModule,
              importedEntityName: 'default', // Indicate it's the default export
              alias: defaultImportName, // The local name used
              isTypeImport: isTypeImport,
              rawReference: `import ${defaultImportName} from '${sourceModule}'`, // Ensure rawReference is here
          } as ImportsProperties,
      });
  }

  // Create relationship for namespace import
  if (namespaceImportName) {
      relationships.push({
          sourceId: sourceId,
          type: 'Imports',
          targetPattern: sourceModule,
          location: getNodeLocation(node.children.find(c => c.type === 'import_clause')?.children.find(cc => cc.type === 'namespace_import') ?? node),
          properties: {
              moduleSpecifier: sourceModule,
              importedEntityName: '*', // Indicate namespace import
              alias: namespaceImportName,
              isTypeImport: isTypeImport,
              rawReference: `import * as ${namespaceImportName} from '${sourceModule}'`, // Ensure rawReference is here
          } as ImportsProperties,
      });
  }

  // Create separate relationships for each named import
  namedImportNodes.forEach(specNode => {
      const nameNode = specNode.childForFieldName('name');
      const aliasNode = specNode.childForFieldName('alias');
      const importedName = nameNode ? getNodeText(nameNode, sourceCode) : 'unknown';
      const alias = aliasNode ? getNodeText(aliasNode, sourceCode) : undefined;

      relationships.push({
          sourceId: sourceId,
          type: 'Imports',
          targetPattern: `${sourceModule}#${importedName}`, // Target the specific entity within the module
          location: getNodeLocation(specNode),
          properties: {
              moduleSpecifier: sourceModule,
              importedEntityName: importedName,
              alias: alias,
              isTypeImport: isTypeImport,
              rawReference: getNodeText(node, sourceCode), // Use the whole import statement node for rawReference
          } as ImportsProperties,
      });
  });

  // If no specific imports found (e.g., `import 'module';` for side effects)
  if (relationships.length === 0) {
      relationships.push({
          sourceId: sourceId,
          type: 'Imports',
          targetPattern: sourceModule,
          location: location,
          properties: {
              moduleSpecifier: sourceModule,
              isTypeImport: isTypeImport,
              rawReference: getNodeText(node, sourceCode), // Ensure rawReference is here
          } as ImportsProperties,
      });
  }


  // Always return an array, even if it's empty or has one element
  return relationships;
}


function createPotentialCallRelationship(
    node: SyntaxNode, // The call_expression node // Use imported SyntaxNode type
    filePath: string,
    sourceCode: string,
    language: AnalyzerLanguage, // Expect AnalyzerLanguage here
    sourceId: CanonicalId // ID of the containing function/method/file scope
): PotentialRelationship | null {
    const location = getNodeLocation(node);
    const functionNode = node.childForFieldName('function');
    const argsNode = node.childForFieldName('arguments');
    if (!functionNode) return null;

    const functionText = getNodeText(functionNode, sourceCode);
    const argumentNodes = argsNode?.children.filter(c => c.type !== '(' && c.type !== ')' && c.type !== ',') ?? [];

    let relationshipType: RelationshipType | undefined = undefined;
    let targetPattern: string | undefined = undefined;
    let properties: ApiFetchProperties | CallsProperties | Record<string, any> = {}; // Corrected type

    // --- API Call Detection (Fetch, Axios, etc.) ---
    let isApiCall = false;
    let httpMethod: ApiFetchProperties['httpMethod'] | undefined = 'GET'; // Default
    let urlPattern: string | undefined = undefined;
    let framework: string | undefined = undefined;

    // 1. Direct `fetch` call
    if (functionNode.type === 'identifier' && functionText === 'fetch') {
        isApiCall = true;
        framework = 'fetch';
        if (argumentNodes.length > 0) {
            if (argumentNodes[0]) {
                urlPattern = extractUrlPattern(argumentNodes[0], sourceCode);
            }
        }
        // Check second argument (options object) for method
        if (argumentNodes.length > 1 && argumentNodes[1]?.type === 'object') {
            argumentNodes[1].descendantsOfType('pair').forEach(pair => {
                const keyNode = pair.childForFieldName('key');
                const valueNode = pair.childForFieldName('value');
                if (keyNode && valueNode && getNodeText(keyNode, sourceCode) === 'method') {
                    const methodValue = getStringLiteralValue(valueNode, sourceCode);
                    if (methodValue) {
                        httpMethod = methodValue.toUpperCase() as ApiFetchProperties['httpMethod'];
                    }
                }
            });
        }
    }
    // 2. Member expression calls (e.g., `axios.get`, `http.request`)
    else if (functionNode.type === 'member_expression') {
        const objectNode = functionNode.childForFieldName('object');
        const propertyNode = functionNode.childForFieldName('property');
        if (objectNode && propertyNode) {
            const objectName = getNodeText(objectNode, sourceCode);
            const propertyName = getNodeText(propertyNode, sourceCode);
            targetPattern = `${objectName}.${propertyName}`; // Default target for method call

            // Axios detection
            if (objectName === 'axios' && ['get', 'post', 'put', 'delete', 'patch', 'request'].includes(propertyName.toLowerCase())) {
                 isApiCall = true;
                 framework = 'axios';
                 httpMethod = propertyName.toUpperCase() as ApiFetchProperties['httpMethod'];
                 if (propertyName === 'request' && argumentNodes.length > 0 && argumentNodes[0]?.type === 'object') {
                     // Method might be inside the config object for axios.request
                     argumentNodes[0].descendantsOfType('pair').forEach(pair => {
                         const keyNode = pair.childForFieldName('key');
                         const valueNode = pair.childForFieldName('value');
                         if (keyNode && valueNode && getNodeText(keyNode, sourceCode) === 'method') {
                             const methodValue = getStringLiteralValue(valueNode, sourceCode);
                             if (methodValue) httpMethod = methodValue.toUpperCase() as ApiFetchProperties['httpMethod'];
                         }
                         if (keyNode && valueNode && getNodeText(keyNode, sourceCode) === 'url') {
                             urlPattern = extractUrlPattern(valueNode, sourceCode);
                         }
                     });
                 } else if (argumentNodes.length > 0) {
                     if (argumentNodes[0]) {
                         urlPattern = extractUrlPattern(argumentNodes[0], sourceCode);
                     }
                 }
            }
            // Basic detection for other HTTP libraries (can be expanded)
            else if (objectName.toLowerCase().includes('http') || objectName.toLowerCase().includes('client')) {
                 // Could be an API call, but less certain without specific patterns
                 // Let's assume FunctionCall unless method name strongly suggests HTTP verb
                 if (['get', 'post', 'put', 'delete', 'patch'].includes(propertyName.toLowerCase())) {
                     // Tentatively mark as API call, might need refinement
                     isApiCall = true;
                     framework = 'http_lib'; // Generic
                     httpMethod = propertyName.toUpperCase() as ApiFetchProperties['httpMethod'];
                     if (argumentNodes.length > 0) {
                         if (argumentNodes[0]) {
                             urlPattern = extractUrlPattern(argumentNodes[0], sourceCode);
                         }
                     }
                 }
            }
        }
    }

    // --- Finalize Relationship ---
    if (isApiCall && urlPattern) {
        relationshipType = 'ApiFetch';
        targetPattern = urlPattern; // Target for API fetch is the URL pattern
        properties = {
            httpMethod: httpMethod || 'GET', // Ensure method is set
            urlPattern: urlPattern,
            framework: framework,
            rawReference: getNodeText(node, sourceCode), // Ensure rawReference is here
        } as ApiFetchProperties;
    } else {
        // Assume FunctionCall otherwise
        relationshipType = 'Calls';
        targetPattern = targetPattern || functionText; // Use member expression or simple function name
        properties = {
            // arguments: argumentNodes.map(arg => getNodeText(arg, sourceCode)), // Optional: capture args
            rawReference: getNodeText(node, sourceCode), // Ensure rawReference is here
        } as CallsProperties;
    }

    if (!targetPattern) {
        console.warn(`Could not determine target pattern for call expression at ${filePath}:${location.start.line}: ${getNodeText(node, sourceCode)}`);
        return null; // Cannot create relationship without a target
    }


    return {
      sourceId: sourceId,
      type: relationshipType!, // Assert non-null as it should be assigned in the blocks above
      targetPattern: targetPattern,
      location: location,
      properties: properties, // properties object already contains rawReference
    };
}


// --- Main Converter Function ---

/**
 * Converts TypeScript/TSX code source text into a FileIr object.
 *
 * @param sourceCode The source code string.
 * @param filePath The project-relative path to the file being analyzed.
 * @param projectId A unique identifier for the project.
 * @returns A Promise resolving to a FileIr object representing the code structure.
 */
export async function convertToIr(sourceCode: string, filePath: string, projectId: string): Promise<FileIr> {
  // Determine language using the AnalyzerLanguage enum for the ParserFactory call
  const containsJsx = /<[a-zA-Z][^>]*>/.test(sourceCode);
  const determinedAnalyzerLanguage = filePath.endsWith('.tsx') || containsJsx ? AnalyzerLanguage.TSX : AnalyzerLanguage.TypeScript;
  // Also determine the corresponding IrLanguage for the final FileIr object
  const determinedIrLanguage = filePath.endsWith('.tsx') || containsJsx ? IrLanguage.TSX : IrLanguage.TypeScript;

  // Use ParserFactory to get the AST, passing the AnalyzerLanguage
  console.log(`Requesting parsing for ${filePath} (${determinedAnalyzerLanguage}) via ParserFactory...`);
  const rootNode = await ParserFactory.parse(determinedAnalyzerLanguage, sourceCode, filePath);

  // Handle parsing failure from the service
  if (!rootNode) {
    console.error(`Parsing failed for ${filePath}. ParserFactory returned null.`);
    // Return a minimal FileIr indicating failure
    return {
      schemaVersion: '1.0.0',
      projectId: projectId,
      fileId: `connectome://${projectId}/file:${filePath}`,
      filePath: filePath,
      language: determinedIrLanguage, // Use IrLanguage here
      elements: [],
      potentialRelationships: [],
    };
  }
  console.log(`Successfully received AST for ${filePath} from ParserFactory.`);
  const elements: IrElement[] = []; // Store final elements with IDs
  const potentialRelationships: PotentialRelationship[] = [];
  // Use determinedAnalyzerLanguage for internal processing, determinedIrLanguage for final output

  // Construct fileId manually based on schema
  const fileId = `connectome://${projectId}/file:${filePath}`;

  // --- AST Traversal ---
  // Use a stack to keep track of the current container element (function, class, interface)
  const containerStack: IrElement[] = []; // Store full IrElements with IDs

  function traverse(node: SyntaxNode) { // Use imported SyntaxNode type
    try {
      let createdElement: Omit<IrElement, 'id'> | null = null; // Partial element before ID
      let createdElements: Omit<IrElement, 'id'>[] = [];
      let potentialRel: PotentialRelationship | PotentialRelationship[] | null = null;
      let skipChildren = false;
      let isContainer = false; // Flag if the created element is a container

      const currentContainer = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
      const currentContainerId = currentContainer?.id ?? fileId; // Use file ID if no container

      switch (node.type) {
        case 'function_declaration':
          createdElement = createPartialFunctionElement(node, filePath, sourceCode, determinedAnalyzerLanguage); // Pass AnalyzerLanguage
          isContainer = true;
          break;

        case 'arrow_function':
            // Only create element if it's NOT directly inside a variable declarator
            // (handled by lexical_declaration) but could be assigned elsewhere or IIFE.
            if (node.parent?.type !== 'variable_declarator') {
                 createdElement = createPartialFunctionElement(node, filePath, sourceCode, determinedAnalyzerLanguage); // Pass AnalyzerLanguage
                 isContainer = true;
            }
            break;

        case 'method_definition':
             // Parent ID should be the ID of the containing class/interface from the stack
             const parentClassOrInterfaceId = currentContainer?.type === 'Class' || currentContainer?.type === 'Interface' ? currentContainer.id : undefined;
             createdElement = createPartialFunctionElement(node, filePath, sourceCode, determinedAnalyzerLanguage, 'Method', parentClassOrInterfaceId); // Pass AnalyzerLanguage
             isContainer = true;
             break;

        case 'class_declaration': {
          createdElement = createPartialClassElement(node, filePath, sourceCode, determinedAnalyzerLanguage); // Pass AnalyzerLanguage
          isContainer = true;
          // Handle extends/implements as potential relationships *after* element ID is generated
          break; // Process relationships after adding element
        }

        case 'interface_declaration':
          createdElement = createPartialInterfaceElement(node, filePath, sourceCode, determinedAnalyzerLanguage); // Pass AnalyzerLanguage
          isContainer = true;
           // Handle extends as potential relationships *after* element ID is generated
          break; // Process relationships after adding element

        case 'lexical_declaration': // const, let
        case 'variable_declaration': // var
          const parentId = currentContainer?.type === 'Class' ? currentContainer.id : undefined; // Check if it's a class property
          createdElements = createPartialVariableElements(node, filePath, sourceCode, determinedAnalyzerLanguage, parentId); // Pass AnalyzerLanguage
          // Check if any variable is assigned a function, treat that variable declarator's scope as container
          createdElements.forEach((el, index) => {
              const declarator = node.descendantsOfType('variable_declarator')[index];
              const valueNode = declarator?.childForFieldName('value');
              if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function')) {
                  // If a variable holds a function, create a Function element too
                  const funcElement = createPartialFunctionElement(valueNode, filePath, sourceCode, determinedAnalyzerLanguage); // Pass AnalyzerLanguage
                  funcElement.name = el.name; // Assign variable name to function element
                  // Generate ID for the function element here
                  const funcElementWithId = addIdToElement(funcElement, projectId);
                  if (funcElementWithId) {
                      elements.push(funcElementWithId); // Add function element to the main list
                      // Mark the *function* element as a container for calls within it
                      containerStack.push(funcElementWithId); // Push function container
                  }
                  traverse(valueNode); // Traverse into the function body
                  containerStack.pop(); // Pop function container
                  skipChildren = true; // Already traversed function body
              }
          });

          break;

         case 'import_statement':
            potentialRel = createPotentialImportRelationship(node, filePath, sourceCode, determinedAnalyzerLanguage, fileId); // Pass AnalyzerLanguage
            skipChildren = true; // Don't traverse into import details further
            break;

         case 'call_expression':
            potentialRel = createPotentialCallRelationship(node, filePath, sourceCode, determinedAnalyzerLanguage, currentContainerId); // Pass AnalyzerLanguage
            // Don't skip children, allow traversal into arguments etc. if needed later
            break;
      }

      // --- Add Elements and Manage Container Stack ---
      let elementWithId: IrElement | null = null;

      if (createdElement) {
       // Generate ID here before adding to list and stack
       elementWithId = addIdToElement(createdElement, projectId);
       if (elementWithId) {
           elements.push(elementWithId);
           if (isContainer) {
             containerStack.push(elementWithId); // Push container onto stack
           }

        // Handle relationships originating *from* this newly created element (e.g., extends, implements)
           // Handle relationships originating *from* this newly created element (e.g., extends, implements)
           if (elementWithId.type === 'Class' && node.type === 'class_declaration') {
            const heritageNode = node.children.find(c => c.type === 'class_heritage');
            if (heritageNode) {
                const extendsClause = heritageNode.children.find(c => c.type === 'extends_clause');
                if (extendsClause && extendsClause.firstChild) {
                    potentialRelationships.push({
                       sourceId: elementWithId.id, // Use the generated ID
                        type: 'Inherits',
                        targetPattern: getNodeText(extendsClause.firstChild, sourceCode),
                        location: getNodeLocation(extendsClause.firstChild),
                        properties: {
                            rawReference: getNodeText(extendsClause, sourceCode) // Ensure rawReference is here
                        } as InheritsProperties, // Added type cast
                    });
                }
                heritageNode.children.filter(c => c.type === 'implements_clause').forEach(implClause => {
                    implClause.children.filter(c => c.type === 'type_identifier' || c.type === 'generic_type').forEach(typeNode => {
                        potentialRelationships.push({
                          sourceId: elementWithId!.id, // Use the generated ID (null check done before)
                            type: 'Implements',
                            targetPattern: getNodeText(typeNode, sourceCode),
                            location: getNodeLocation(typeNode),
                            properties: {
                                rawReference: getNodeText(implClause, sourceCode) // Ensure rawReference is here
                            } as ImplementsProperties, // Added type cast
                        });
                    });
                });
            }
           } else if (elementWithId.type === 'Interface' && node.type === 'interface_declaration') {
             const extendsClause = node.children.find(c => c.type === 'extends_clause');
             if (extendsClause) {
                  extendsClause.children.filter(c => c.type === 'type_identifier' || c.type === 'generic_type').forEach(typeNode => {
                      potentialRelationships.push({
                        sourceId: elementWithId!.id, // Use the generated ID (null check done before)
                          type: 'Inherits', // Interface extends Interface
                          targetPattern: getNodeText(typeNode, sourceCode),
                          location: getNodeLocation(typeNode),
                          properties: {
                              rawReference: getNodeText(extendsClause, sourceCode) // Ensure rawReference is here
                          } as InheritsProperties, // Added type cast
                      });
                  });
             }
           }
       } // end if elementWithId
     } // end if createdElement

     if (createdElements.length > 0) {
       // Add IDs to variable elements
       createdElements.forEach((el: Omit<IrElement, 'id'>) => { // Add explicit type for el
           const elWithId = addIdToElement(el, projectId);
           if (elWithId) elements.push(elWithId);
       });
     }

     // --- Add Relationships ---
     if (potentialRel) {
       if (Array.isArray(potentialRel)) {
           potentialRelationships.push(...potentialRel);
       } else {
           potentialRelationships.push(potentialRel);
       }
     }

     // --- Recursive Traversal ---
     if (!skipChildren) {
        node.children.forEach(child => traverse(child));
     }

     // --- Pop Container from Stack ---
     // Pop only if we pushed this element onto the stack earlier
     if (elementWithId && isContainer) {
       // Ensure the top of the stack is the element we are about to pop
       // Add null check for elementWithId here
      // Ensure elementWithId is not null and the stack is not empty before accessing properties
      const stackTop = containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
      if (elementWithId && stackTop && stackTop.id === elementWithId.id) {
          containerStack.pop(); // Pop container after processing its children
      } else if (elementWithId) { // Add null check for warning message
           console.warn(`Container stack mismatch when popping for ${elementWithId.id} at ${filePath}:${elementWithId.location.start.line}`);
       }
     }

    } catch (error) {
        const location = getNodeLocation(node);
        console.error(`Error processing node type ${node.type} at ${filePath}:${location.start.line}:${location.start.column}:`, error);
    }
  }

  traverse(rootNode); // Start traversal

  // --- Post-Traversal Cleanup (if any needed) ---
  // Relationship source IDs should now be correctly assigned during traversal.

  // Construct the final FileIr object
  const fileIr: FileIr = {
    schemaVersion: '1.0.0', // Updated version
    projectId: projectId,
    fileId: fileId,
    filePath: filePath,
    language: determinedIrLanguage, // Use IrLanguage for the final FileIr object
   elements: elements, // Use elements with IDs
    potentialRelationships: potentialRelationships,
  };

  return Promise.resolve(fileIr);
}