import type { default as TreeSitterParser } from 'tree-sitter'; // Import the type
// Grammar is loaded by ParserFactory
// import Python from 'tree-sitter-python';
import path from 'path';
import { createContextLogger } from '../utils/logger.js';
import { ParserError } from '../utils/errors.js';
import { LanguageParser } from './types.js'; // Import from types.ts where it's defined
import { AstNode, RelationshipInfo, InstanceCounter, FileNode } from './types.js';
import { generateEntityId, generateInstanceId, generateRelationshipId } from './parser-utils.js';
import { Language } from '../types/index.js';

const logger = createContextLogger('PythonParser');

/**
 * @class PythonParser
 * @implements {LanguageParser}
 * @description Parses Python source code using Tree-sitter to generate AST nodes and relationships.
 */
export class PythonParser implements LanguageParser {
    private sharedParser: TreeSitterParser;

    /**
     * Creates an instance of PythonParser.
     * @param {Parser} [parserInstance] - An optional pre-configured Tree-sitter parser instance.
     *                                     If not provided, a new one will be created.
     */
    constructor(sharedParser: TreeSitterParser) {
        this.sharedParser = sharedParser; // Store the shared parser instance
        // No need to set language here; AnalyzerService does it before calling parse
        logger.debug('PythonParser initialized with shared Tree-sitter parser.');
    }

    /**
     * Parses Python file content using Tree-sitter.
     * @param {string} filePath - The relative path to the file being parsed.
     * @param {string} fileContent - The source code content.
     * @returns {{ nodes: AstNode[], relationships: RelationshipInfo[] }} Parsed nodes and relationships.
     * @throws {ParserError} If parsing fails.
     */
    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const nodes: AstNode[] = [];
        const relationships: RelationshipInfo[] = [];
        const instanceCounter: InstanceCounter = { count: 0 };
        const now = new Date().toISOString();
        const relativeFilePath = path.normalize(filePath).replace(/\\/g, '/'); // Ensure consistent format

        logger.debug(`Starting Tree-sitter parsing for: ${relativeFilePath}`);

        let tree: TreeSitterParser.Tree;
        try {
            tree = this.sharedParser.parse(fileContent); // Use the shared parser
        } catch (error: any) {
            logger.error(`Tree-sitter failed to parse ${relativeFilePath}: ${error.message}`);
            throw new ParserError(`Tree-sitter parsing failed for ${relativeFilePath}`, { originalError: error });
        }

        // --- 1. Create File Node ---
        const fileEntityId = generateEntityId('file', relativeFilePath);
        const fileNode: FileNode = {
            id: generateInstanceId(instanceCounter, 'file', relativeFilePath),
            entityId: fileEntityId,
            kind: 'File',
            labels: ['File'],
            name: path.basename(relativeFilePath),
            filePath: relativeFilePath,
            startLine: 1,
            endLine: tree.rootNode.endPosition.row + 1,
            startColumn: 0,
            endColumn: 0, // File node spans the whole file conceptually
            language: Language.Python.toLowerCase(),
            properties: {
                path: relativeFilePath,
                language: Language.Python.toLowerCase(),
                lines_of_code: tree.rootNode.endPosition.row + 1,
            },
            loc: tree.rootNode.endPosition.row + 1,
            createdAt: now,
        };
        nodes.push(fileNode);
        logger.debug(`Created FileNode: ${fileNode.entityId}`);

        // --- 2. Traverse AST ---
        const traverse = (node: TreeSitterParser.SyntaxNode, parentNode: AstNode | null, scopeStack: string[]) => {
            let currentScope = [...scopeStack];
            let createdNode: AstNode | null = null;

            try {
                switch (node.type) {
                    case 'function_definition':
                        createdNode = this.handleFunctionDefinition(node, relativeFilePath, fileNode, parentNode, currentScope, nodes, relationships, instanceCounter, now);
                        if (createdNode) {
                            currentScope.push(createdNode.name); // Push function name onto scope
                        }
                        break;
                    case 'class_definition':
                        createdNode = this.handleClassDefinition(node, relativeFilePath, fileNode, parentNode, currentScope, nodes, relationships, instanceCounter, now);
                        if (createdNode) {
                            currentScope.push(createdNode.name); // Push class name onto scope
                        }
                        break;
                    case 'import_statement':
                    case 'import_from_statement':
                        this.handleImport(node, fileNode, relationships, instanceCounter, now);
                        break;
                    case 'call':
                        this.handleCall(node, fileNode, parentNode, relationships, instanceCounter, now);
                        break;
                    case 'assignment':
                         // Basic variable handling (can be enhanced)
                         createdNode = this.handleAssignment(node, relativeFilePath, fileNode, parentNode, currentScope, nodes, relationships, instanceCounter, now);
                         break;
                    // Add more cases for other relevant Python constructs (decorators, variables, etc.)
                }
            } catch (error: any) {
                 logger.warn(`Error processing node type ${node.type} at ${relativeFilePath}:${node.startPosition.row + 1}:${node.startPosition.column}: ${error.message}`, { nodeText: node.text.substring(0, 100) });
            }

            // Recurse through children
            for (const child of node.namedChildren) {
                traverse(child, createdNode ?? parentNode, currentScope); // Pass the newly created node as parent if applicable
            }
        };

        traverse(tree.rootNode, fileNode, [relativeFilePath]); // Start traversal with file scope

        logger.info(`Finished Tree-sitter parsing for ${relativeFilePath}. Nodes: ${nodes.length}, Relationships: ${relationships.length}`);
        return Promise.resolve({ nodes, relationships }); // Wrap result in a resolved promise
    }

    // --- Node Handling Methods ---

    /**
     * Handles function and method definitions.
     */
    private handleFunctionDefinition(
        node: TreeSitterParser.SyntaxNode,
        filePath: string,
        fileNode: FileNode,
        parentNode: AstNode | null,
        scopeStack: string[],
        nodes: AstNode[],
        relationships: RelationshipInfo[],
        instanceCounter: InstanceCounter,
        now: string
    ): AstNode | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;
        const functionName = nameNode.text;

        const isAsync = node.children.some(child => child.type === 'async');
        const isMethod = parentNode?.kind === 'Class'; // Simple check, might need refinement for nested functions

        const fqn = [...scopeStack, functionName].join(isMethod ? '.' : ':'); // Use '.' for methods within classes
        const entityId = generateEntityId(isMethod ? 'method' : 'function', fqn);

        const signatureNode = node.childForFieldName('parameters');
        const returnTypeNode = node.childForFieldName('return_type'); // Might be null

        const funcNode: AstNode = {
            id: generateInstanceId(instanceCounter, isMethod ? 'method' : 'function', fqn, { line: node.startPosition.row + 1, column: node.startPosition.column }),
            entityId: entityId,
            kind: isMethod ? 'Method' : 'Function',
            labels: isMethod ? ['Function', 'Method'] : ['Function'],
            name: functionName,
            filePath: filePath,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            language: Language.Python.toLowerCase(),
            signature: signatureNode?.text, // Raw signature text
            returnType: returnTypeNode?.text, // Raw return type text
            isAsync: isAsync,
            parentId: parentNode?.entityId,
            properties: {
                name: functionName,
                fqn: fqn,
                file_path: filePath,
                start_line: node.startPosition.row + 1,
                end_line: node.endPosition.row + 1,
                signature: signatureNode?.text,
                return_type: returnTypeNode?.text,
                is_method: isMethod,
                is_async: isAsync,
                is_constructor: isMethod && functionName === '__init__',
                // scope: parentNode?.name ?? 'file', // Simplified scope
            },
            createdAt: now,
        };
        nodes.push(funcNode);

        // Relationship: DEFINED_IN (Function/Method -> File/Class)
        const parentEntityId = parentNode?.entityId ?? fileNode.entityId;
        const definedInRel = this.createRelationship('DEFINED_IN', funcNode.entityId, parentEntityId, instanceCounter, now);
        relationships.push(definedInRel);

        // Handle Parameters
        if (signatureNode) {
            this.handleParameters(signatureNode, funcNode, filePath, nodes, relationships, instanceCounter, now);
        }


        logger.debug(`Created ${funcNode.kind}Node: ${funcNode.entityId}`);
        return funcNode;
    }

    /**
     * Handles class definitions.
     */
    private handleClassDefinition(
        node: TreeSitterParser.SyntaxNode,
        filePath: string,
        fileNode: FileNode,
        parentNode: AstNode | null, // Parent could be file or another class (nested)
        scopeStack: string[],
        nodes: AstNode[],
        relationships: RelationshipInfo[],
        instanceCounter: InstanceCounter,
        now: string
    ): AstNode | null {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return null;
        const className = nameNode.text;

        const fqn = [...scopeStack, className].join(':'); // Classes usually use ':' separator in FQN
        const entityId = generateEntityId('class', fqn);

        const classNode: AstNode = {
            id: generateInstanceId(instanceCounter, 'class', fqn, { line: node.startPosition.row + 1, column: node.startPosition.column }),
            entityId: entityId,
            kind: 'Class',
            labels: ['Class'],
            name: className,
            filePath: filePath,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            startColumn: node.startPosition.column,
            endColumn: node.endPosition.column,
            language: Language.Python.toLowerCase(),
            parentId: parentNode?.entityId, // Could be nested
            properties: {
                name: className,
                fqn: fqn,
                file_path: filePath,
                start_line: node.startPosition.row + 1,
                end_line: node.endPosition.row + 1,
                // scope: parentNode?.name ?? 'file', // Simplified scope
            },
            createdAt: now,
        };
        nodes.push(classNode);

        // Relationship: DEFINED_IN (Class -> File or Outer Class)
        const parentEntityId = parentNode?.entityId ?? fileNode.entityId;
        const definedInRel = this.createRelationship('DEFINED_IN', classNode.entityId, parentEntityId, instanceCounter, now);
        relationships.push(definedInRel);

        // Handle Inheritance (Superclasses)
        const superclassesNode = node.childForFieldName('superclasses'); // This is argument_list
        if (superclassesNode) {
            for (const baseClassNode of superclassesNode.namedChildren) {
                // We only know the name here, resolution happens later
                const baseClassName = baseClassNode.text;
                // Create a placeholder relationship, targetId will be resolved later
                const extendsRel = this.createRelationship(
                    'EXTENDS',
                    classNode.entityId,
                    `placeholder:class:${baseClassName}`, // Placeholder ID
                    instanceCounter,
                    now,
                    { baseClassName: baseClassName } // Store name for resolver
                );
                relationships.push(extendsRel);
            }
        }


        logger.debug(`Created ClassNode: ${classNode.entityId}`);
        return classNode;
    }

     /**
      * Handles parameters within a function/method signature.
      */
     private handleParameters(
         parametersNode: TreeSitterParser.SyntaxNode,
         ownerNode: AstNode, // The Function or Method node
         filePath: string,
         nodes: AstNode[],
         relationships: RelationshipInfo[],
         instanceCounter: InstanceCounter,
         now: string
     ): void {
         let paramIndex = 0;
         // Iterate through parameter nodes (e.g., identifier, default_parameter, typed_parameter)
         for (const paramWrapper of parametersNode.children) {
             let paramNode = paramWrapper;
             let paramNameNode: TreeSitterParser.SyntaxNode | null = null;
             let typeNode: TreeSitterParser.SyntaxNode | null = null;

             // Find the actual identifier node within potentially nested structures
             if (paramNode.type === 'identifier') {
                 paramNameNode = paramNode;
             } else if (paramNode.type === 'default_parameter' || paramNode.type === 'typed_parameter' || paramNode.type === 'typed_default_parameter') {
                 paramNameNode = paramNode.childForFieldName('name');
                 typeNode = paramNode.childForFieldName('type');
             } else if (paramNode.type === 'list_splat_pattern' || paramNode.type === 'dictionary_splat_pattern') {
                 // Handle *args, **kwargs - find the identifier within
                 paramNameNode = paramNode.firstNamedChild; // Usually the identifier
             } else {
                 // Skip non-parameter nodes like commas, parentheses
                 continue;
             }


             if (paramNameNode) {
                 const paramName = paramNameNode.text;
                 const paramFqn = `${ownerNode.properties?.fqn ?? ownerNode.name}#${paramName}`; // Parameter FQN convention
                 const paramEntityId = generateEntityId('parameter', paramFqn);

                 const parameterAstNode: AstNode = {
                     id: generateInstanceId(instanceCounter, 'parameter', paramFqn, { line: paramNameNode.startPosition.row + 1, column: paramNameNode.startPosition.column }),
                     entityId: paramEntityId,
                     kind: 'Parameter',
                     labels: ['Parameter'],
                     name: paramName,
                     filePath: filePath, // Parameter belongs to the file of its function
                     startLine: paramNameNode.startPosition.row + 1,
                     endLine: paramNameNode.endPosition.row + 1,
                     startColumn: paramNameNode.startPosition.column,
                     endColumn: paramNameNode.endPosition.column,
                     language: Language.Python.toLowerCase(),
                     dataType: typeNode?.text ?? 'unknown', // Store raw type hint text
                     parentId: ownerNode.entityId,
                     properties: {
                         name: paramName,
                         fqn: paramFqn,
                         data_type: typeNode?.text ?? 'unknown',
                         index: paramIndex,
                         // scope: ownerNode.name,
                     },
                     createdAt: now,
                 };
                 nodes.push(parameterAstNode);

                 // Relationship: HAS_PARAMETER (Function/Method -> Parameter)
                 const hasParamRel = this.createRelationship('HAS_PARAMETER', ownerNode.entityId, paramEntityId, instanceCounter, now, { index: paramIndex });
                 relationships.push(hasParamRel);

                 paramIndex++;
                 logger.debug(`Created ParameterNode: ${parameterAstNode.entityId} for ${ownerNode.entityId}`);
             }
         }
     }


    /**
     * Handles import statements (`import x` and `from y import x`).
     */
    private handleImport(
        node: TreeSitterParser.SyntaxNode,
        fileNode: FileNode,
        relationships: RelationshipInfo[],
        instanceCounter: InstanceCounter,
        now: string
    ): void {
        let importSource: string | null = null;
        const importedNames: { name: string, alias?: string }[] = [];

        if (node.type === 'import_statement') {
            // Handles 'import module' or 'import module as alias'
            const dottedNameNodes = node.children.filter(c => c.type === 'dotted_name');
            for (const dottedNameNode of dottedNameNodes) {
                 // Check for alias
                 const aliasNode = dottedNameNode.nextNamedSibling;
                 if (aliasNode && aliasNode.type === 'aliased_import' && aliasNode.childForFieldName('alias')) {
                     importedNames.push({ name: dottedNameNode.text, alias: aliasNode.childForFieldName('alias')?.text });
                 } else {
                     importedNames.push({ name: dottedNameNode.text });
                 }
            }
            importSource = importedNames[0]?.name.split('.')[0] ?? null; // Handle potential undefined

        } else if (node.type === 'import_from_statement') {
            // Handles 'from module import name' or 'from module import name as alias'
            const moduleNameNode = node.childForFieldName('module_name');
            importSource = moduleNameNode?.text ?? null;

            const nameNodes = node.children.filter(c => c.type === 'dotted_name' || c.type === 'aliased_import' || c.type === 'wildcard_import');
             for (const nameNode of nameNodes) {
                 if (nameNode.type === 'dotted_name') {
                     importedNames.push({ name: nameNode.text });
                 } else if (nameNode.type === 'aliased_import') {
                     const originalNameNode = nameNode.childForFieldName('name');
                     const aliasNode = nameNode.childForFieldName('alias');
                     if (originalNameNode && aliasNode) {
                         importedNames.push({ name: originalNameNode.text, alias: aliasNode.text });
                     } else if (originalNameNode) {
                          importedNames.push({ name: originalNameNode.text }); // Should not happen often without alias, but handle
                     }
                 } else if (nameNode.type === 'wildcard_import') {
                     importedNames.push({ name: '*' });
                 }
             }
        }

        if (importSource) {
            for (const imp of importedNames) {
                // Create a placeholder relationship. Target resolution happens later.
                // Target ID needs a convention, e.g., 'placeholder:module:moduleName' or 'placeholder:symbol:moduleName.symbolName'
                const targetPlaceholder = imp.name === '*' ? `placeholder:module:${importSource}` : `placeholder:symbol:${importSource}.${imp.name}`;
                const importRel = this.createRelationship(
                    'IMPORTS',
                    fileNode.entityId,
                    targetPlaceholder,
                    instanceCounter,
                    now,
                    {
                        importedName: imp.name,
                        alias: imp.alias,
                        sourceModule: importSource,
                        isWildcard: imp.name === '*',
                        importStatementText: node.text.substring(0, 200) // Store part of the statement for context
                    }
                );
                relationships.push(importRel);
                logger.debug(`Created IMPORTS relationship: ${fileNode.entityId} -> ${targetPlaceholder}`);
            }
        } else {
             logger.warn(`Could not determine import source for node type ${node.type} at ${fileNode.filePath}:${node.startPosition.row + 1}`, { nodeText: node.text });
        }
    }

    /**
     * Handles function/method calls.
     */
    private handleCall(
        node: TreeSitterParser.SyntaxNode,
        fileNode: FileNode,
        parentNode: AstNode | null, // The containing function/method/class/file
        relationships: RelationshipInfo[],
        instanceCounter: InstanceCounter,
        now: string
    ): void {
        const functionIdentifierNode = node.childForFieldName('function');
        if (!functionIdentifierNode || !parentNode) return; // Need a caller context

        const calledName = functionIdentifierNode.text; // This might be complex (e.g., obj.method)

        // Simple case: direct function call (e.g., my_func())
        // Complex cases (obj.method(), Class.method()) require resolution later
        let targetPlaceholder: string;
        if (functionIdentifierNode.type === 'identifier') {
            targetPlaceholder = `placeholder:call:${calledName}`; // Placeholder for simple name
        } else if (functionIdentifierNode.type === 'attribute') {
            // obj.method - calledName will be like 'obj.method'
            targetPlaceholder = `placeholder:call:${calledName}`; // Placeholder for attribute access
        } else {
             logger.debug(`Unhandled call type: ${functionIdentifierNode.type} for ${calledName}`);
             return; // Don't create relationship for unhandled types for now
        }


        const callRel = this.createRelationship(
            'CALLS',
            parentNode.entityId, // Source is the containing scope (function/method/file)
            targetPlaceholder,
            instanceCounter,
            now,
            {
                calledName: calledName, // Store the potentially complex name
                lineNumber: node.startPosition.row + 1,
            }
        );
        relationships.push(callRel);
        logger.debug(`Created CALLS relationship: ${parentNode.entityId} -> ${targetPlaceholder} (${calledName})`);
    }

     /**
      * Handles variable assignments (basic).
      */
     private handleAssignment(
         node: TreeSitterParser.SyntaxNode,
         filePath: string,
         fileNode: FileNode,
         parentNode: AstNode | null,
         scopeStack: string[],
         nodes: AstNode[],
         relationships: RelationshipInfo[],
         instanceCounter: InstanceCounter,
         now: string
     ): AstNode | null {
         const leftNode = node.childForFieldName('left');
         // Handle simple identifier assignment for now: var = ...
         if (!leftNode || leftNode.type !== 'identifier') {
             return null;
         }
         const varName = leftNode.text;
         const scopeKind = parentNode?.kind ?? 'File';
         const scopePrefix = scopeKind === 'Class' ? '.' : ':'; // Convention for FQN separator

         const fqn = [...scopeStack, varName].join(scopePrefix);
         const entityId = generateEntityId('variable', fqn);

         // Check if variable already exists in this scope (simple check by FQN)
         // This prevents creating duplicate nodes for re-assignments within the same scope traversal
         if (nodes.some(n => n.entityId === entityId)) {
             // logger.debug(`Variable ${fqn} already exists, skipping node creation.`);
             return nodes.find(n => n.entityId === entityId) || null; // Return existing node
         }


         const varNode: AstNode = {
             id: generateInstanceId(instanceCounter, 'variable', fqn, { line: node.startPosition.row + 1, column: node.startPosition.column }),
             entityId: entityId,
             kind: 'Variable',
             labels: ['Variable'],
             name: varName,
             filePath: filePath,
             startLine: node.startPosition.row + 1,
             endLine: node.endPosition.row + 1,
             startColumn: node.startPosition.column,
             endColumn: node.endPosition.column,
             language: Language.Python.toLowerCase(),
             parentId: parentNode?.entityId,
             dataType: 'unknown', // Type inference is complex, maybe handle later or via type hints
             scope: parentNode?.name ?? 'file', // Simplified scope name
             properties: {
                 name: varName,
                 fqn: fqn,
                 file_path: filePath,
                 start_line: node.startPosition.row + 1,
                 end_line: node.endPosition.row + 1,
                 data_type: 'unknown',
                 scope: parentNode?.name ?? 'file',
             },
             createdAt: now,
         };
         nodes.push(varNode);

         // Relationship: DEFINED_IN (Variable -> File/Function/Method/Class)
         const parentEntityId = parentNode?.entityId ?? fileNode.entityId;
         const definedInRel = this.createRelationship('DEFINED_IN', varNode.entityId, parentEntityId, instanceCounter, now);
         relationships.push(definedInRel);

         logger.debug(`Created VariableNode: ${varNode.entityId}`);
         return varNode;
     }


    // --- Helper Methods ---

    /**
     * Creates a RelationshipInfo object.
     */
    private createRelationship(
        type: string,
        sourceId: string,
        targetId: string,
        instanceCounter: InstanceCounter,
        now: string,
        properties: Record<string, any> = {}
    ): RelationshipInfo {
        const relInstanceId = generateInstanceId(instanceCounter, type.toLowerCase(), `${sourceId}->${targetId}`);
        // Entity ID generation might need refinement for placeholders
        const relEntityId = `${type}:${sourceId}->${targetId}`;

        return {
            id: relInstanceId,
            entityId: relEntityId, // Keep old entityId for now
            relationshipId: generateRelationshipId(sourceId, targetId, type), // Generate the new ID
            type: type,
            sourceId: sourceId,
            targetId: targetId, // Might be a placeholder ID initially
            properties: properties,
            createdAt: now,
            weight: 1, // Default weight
        };
    }
}