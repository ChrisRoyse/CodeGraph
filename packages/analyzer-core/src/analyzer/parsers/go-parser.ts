// src/analyzer/parsers/go-parser.ts
import type { default as TreeSitterParser } from 'tree-sitter'; // Import the type
// Grammar is loaded by ParserFactory
// import Go from 'tree-sitter-go';
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js'; // Corrected path
import { ParserError } from '../../utils/errors.js'; // Corrected path
import { FileInfo } from '../../scanner/file-scanner.js'; // Corrected path
import { AstNode, RelationshipInfo, LanguageParser, InstanceCounter, PackageClauseNode, ImportSpecNode, GoFunctionNode, GoMethodNode, GoStructNode, GoInterfaceNode } from '../types.js'; // Import LanguageParser
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId, generateRelationshipId } from '../parser-utils.js';

const logger = createContextLogger('GoParser');

// Helper to get node text safely
function getNodeText(node: TreeSitterParser.SyntaxNode | null | undefined): string {
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: TreeSitterParser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } {
    return {
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column, endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class GoAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode;
    private now: string = new Date().toISOString();
    private currentPackage: string | null = null;
    private currentReceiverType: string | null = null; // For methods

    constructor(private filepath: string) {
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath);
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId, kind: 'File', name: filename, filePath: filepath,
            startLine: 1, endLine: 0, startColumn: 0, endColumn: 0,
            language: 'Go', createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    // Corrected visit method: process node, then always recurse unless stopped
    visit(node: TreeSitterParser.SyntaxNode) {
        const stopRecursion = this.visitNode(node); // Process the current node first

        if (!stopRecursion) { // Only recurse if the handler didn't stop it
            for (const child of node.namedChildren) {
                this.visit(child);
            }
        }

        if (node.type === 'source_file') { // Root node type for Go
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    // Helper to decide if recursion should stop for certain node types
    private shouldStopRecursion(node: TreeSitterParser.SyntaxNode): boolean {
        // Stop recursion after handling the entire import block here
        return node.type === 'import_declaration';
    }

    private visitNode(node: TreeSitterParser.SyntaxNode): boolean {
        try {
            switch (node.type) {
                case 'package_clause':
                    this.visitPackageClause(node);
                    return false;
                case 'import_declaration':
                    this.visitImportDeclaration(node);
                    return true; // Stop recursion for imports here
                // case 'import_spec': // Removed - handled by visitImportDeclaration
                //     break;
                case 'function_declaration':
                    this.visitFunctionDeclaration(node);
                    return false;
                case 'method_declaration':
                    this.visitMethodDeclaration(node);
                    return false;
                case 'type_alias':
                case 'type_spec': // Handle type specs (like structs) which might not be definitions
                case 'type_definition':
                    this.visitTypeDefinition(node);
                    return false;
                // Removed var_declaration handling for now
                // case 'short_var_declaration':
                // case 'var_declaration':
                //     this.visitVarDeclaration(node);
                //     return false;
                default:
                    return false; // Allow recursion for unhandled types
            }
        } catch (error: any) {
             logger.warn(`[GoAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
             return false; // Allow recursion even on error
        }
    }

    private visitPackageClause(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        let nameNode: TreeSitterParser.SyntaxNode | null = node.childForFieldName('name');
        if (!nameNode) {
            const foundNode = node.children.find(c => c.type === 'package_identifier');
            nameNode = foundNode ?? null;
        }
        const name = getNodeText(nameNode);
        if (!name) {
             logger.warn(`[GoAstVisitor] Could not find name for package_clause at ${this.filepath}:${location.startLine}`);
             return;
        }
        this.currentPackage = name;

        const entityId = generateEntityId('packageclause', `${this.filepath}:${name}`);

        const packageNode: PackageClauseNode = {
            id: generateInstanceId(this.instanceCounter, 'package', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'PackageClause', name: name,
            filePath: this.filepath, language: 'Go', ...location, createdAt: this.now,
        };
        this.nodes.push(packageNode);

        const relEntityId = generateEntityId('declares_package', `${this.fileNode.entityId}:${entityId}`);
        const rel: RelationshipInfo = {
            id: generateInstanceId(this.instanceCounter, 'declares_package', `${this.fileNode.id}:${packageNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DECLARES_PACKAGE'),
            type: 'DECLARES_PACKAGE',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        };
        this.relationships.push(rel);
    }

    // Visit the import declaration block (e.g., import "fmt" or import (...))
    private visitImportDeclaration(node: TreeSitterParser.SyntaxNode) {
        // Find all import_spec nodes within this declaration
        const importSpecs = node.descendantsOfType('import_spec');
        for (const importSpecNode of importSpecs) {
            this.visitImportSpec(importSpecNode);
        }
    }


    private visitImportSpec(node: TreeSitterParser.SyntaxNode) {
        // This method is now only called by visitImportDeclaration
        const location = getNodeLocation(node);
        const pathNode = node.childForFieldName('path');
        const importPath = getNodeText(pathNode).replace(/"/g, ''); // Remove quotes
        const aliasNode = node.childForFieldName('name'); // Alias comes before path in Go grammar
        const alias = aliasNode ? getNodeText(aliasNode) : undefined;

        if (!importPath) return;

        const entityId = generateEntityId('importspec', `${this.filepath}:${importPath}:${location.startLine}`);
        const importNode: ImportSpecNode = {
            id: generateInstanceId(this.instanceCounter, 'import', importPath, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'ImportSpec', name: importPath,
            filePath: this.filepath, language: 'Go', ...location, createdAt: this.now,
            properties: { importPath, alias }
        };
        this.nodes.push(importNode);

        // Relationship: File -> GO_IMPORTS -> ImportSpec
        const relEntityId = generateEntityId('go_imports', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'go_imports', `${this.fileNode.id}:${importNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'GO_IMPORTS'),
            type: 'GO_IMPORTS',
            sourceId: this.fileNode.entityId, targetId: entityId, // Target is the import spec node for now
            createdAt: this.now, weight: 5,
        });
    }

    private visitFunctionDeclaration(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        this.createGoFunctionNode(name, node, location);
        // TODO: Visit body for calls
    }

    private visitMethodDeclaration(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const receiverNode = node.childForFieldName('receiver');
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name || !receiverNode) return;

        // Try to find the receiver type (simplistic)
        const receiverTypeNode = receiverNode.namedChild(0)?.childForFieldName('type');
        const receiverTypeName = getNodeText(receiverTypeNode);
        if (!receiverTypeName) return;

        const receiverQualifiedName = this.currentPackage ? `${this.currentPackage}.${receiverTypeName}` : receiverTypeName;
        const receiverEntityId = generateEntityId('gostruct', receiverQualifiedName); // Assume receiver is a struct for now

        const qualifiedName = `${receiverTypeName}.${name}`; // Method name qualified by receiver type
        const methodEntityId = generateEntityId('gomethod', qualifiedName);

        const methodNode: GoMethodNode = {
            id: generateInstanceId(this.instanceCounter, 'gomethod', name, { line: location.startLine, column: location.startColumn }),
            entityId: methodEntityId, kind: 'GoMethod', name: name,
            filePath: this.filepath, language: 'Go', ...location, createdAt: this.now,
            parentId: receiverEntityId, // Link to the receiver struct/type
            properties: { receiverType: receiverTypeName }
            // TODO: Extract parameters, return type
        };
        this.nodes.push(methodNode);

        // Relationship: Struct -> HAS_METHOD -> Method
        const relEntityId = generateEntityId('has_method', `${receiverEntityId}:${methodEntityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_method', `${receiverEntityId}:${methodNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(receiverEntityId, methodEntityId, 'HAS_METHOD'),
            type: 'HAS_METHOD', // Reusing HAS_METHOD
            sourceId: receiverEntityId, targetId: methodEntityId,
            createdAt: this.now, weight: 8,
        });
        // TODO: Visit parameters
        // TODO: Visit body for calls
    }

    private visitTypeDefinition(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const typeNode = node.childForFieldName('type');
        const name = getNodeText(nameNode);
        if (!name || !typeNode) return;

        // --- TEMPORARY DEBUG LOG ---
        logger.debug(`[GoAstVisitor] visitTypeDefinition Name: ${name}, TypeNode Type: ${typeNode.type}`);
        // --- END TEMPORARY DEBUG LOG ---

        // Ensure qualified name includes package, consistent with method receiver lookup
        const qualifiedName = this.currentPackage ? `${this.currentPackage}.${name}` : name;
        let kind: 'GoStruct' | 'GoInterface' | 'TypeAlias' = 'TypeAlias'; // Default
        let entityIdPrefix = 'typealias';

        if (typeNode.type === 'struct_type') {
            kind = 'GoStruct';
            entityIdPrefix = 'gostruct';
        } else if (typeNode.type === 'interface_type') {
            kind = 'GoInterface';
            entityIdPrefix = 'gointerface';
        }

        // Use the package-qualified name for entity ID generation
        const entityId = generateEntityId(entityIdPrefix, qualifiedName);
        const typeDefNode: AstNode = {
            id: generateInstanceId(this.instanceCounter, entityIdPrefix, name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: kind, name: name,
            filePath: this.filepath, language: 'Go', ...location, createdAt: this.now,
            properties: { qualifiedName }
            // TODO: Extract fields for structs/methods for interfaces if not handled by recursion
        };
        this.nodes.push(typeDefNode);
        // Add relationship File -> DEFINES_STRUCT/DEFINES_INTERFACE -> GoStruct/GoInterface
        if (kind === 'GoStruct' || kind === 'GoInterface') {
            const relKind = kind === 'GoStruct' ? 'DEFINES_STRUCT' : 'DEFINES_INTERFACE';
            const relEntityId = generateEntityId(relKind.toLowerCase(), `${this.fileNode.entityId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, relKind.toLowerCase(), `${this.fileNode.id}:${typeDefNode.id}`),
                entityId: relEntityId,
                relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, relKind),
                type: relKind,
                sourceId: this.fileNode.entityId, targetId: entityId,
                createdAt: this.now, weight: 9,
            });
        }
        // TODO: Add relationship File -> DEFINES_STRUCT/DEFINES_INTERFACE -> GoStruct/GoInterface
    }

    // Removed visitVarDeclaration as it wasn't correctly identifying function literals in this fixture

    // Helper to create GoFunctionNode (used by func declaration and func literal assignment)
    private createGoFunctionNode(name: string, node: TreeSitterParser.SyntaxNode, location: { startLine: number, endLine: number, startColumn: number, endColumn: number }) {
        const qualifiedName = this.currentPackage ? `${this.currentPackage}.${name}` : name;
        const entityId = generateEntityId('gofunction', qualifiedName);

        // Use the location of the name identifier, but potentially the end line of the whole node (func literal or declaration)
        const endLine = getNodeLocation(node).endLine;

        const funcNode: GoFunctionNode = {
            id: generateInstanceId(this.instanceCounter, 'gofunction', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'GoFunction', name: name,
            filePath: this.filepath, language: 'Go',
            startLine: location.startLine, endLine: endLine, // Use calculated end line
            startColumn: location.startColumn, endColumn: location.endColumn, // Use name location end column for now
            createdAt: this.now,
            properties: { qualifiedName }
            // TODO: Extract parameters, return type from node or its children
        };
        this.nodes.push(funcNode);

        // Add relationship File -> DEFINES_FUNCTION -> GoFunction
         const relEntityId = generateEntityId('defines_function', `${this.fileNode.entityId}:${entityId}`);
         this.relationships.push({
             id: generateInstanceId(this.instanceCounter, 'defines_function', `${this.fileNode.id}:${funcNode.id}`),
             entityId: relEntityId,
             relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_FUNCTION'),
             type: 'DEFINES_FUNCTION',
             sourceId: this.fileNode.entityId, targetId: entityId,
             createdAt: this.now, weight: 8,
         });
    }
}

/**
 * Parses Go files using Tree-sitter.
 */
export class GoParser implements LanguageParser {
    private sharedParser: TreeSitterParser;

    constructor(sharedParser: TreeSitterParser) {
        this.sharedParser = sharedParser; // Store shared parser
        // Language is set by AnalyzerService
        logger.debug('GoParser initialized with shared Tree-sitter parser.');
    }

    /**
     * Parses Go file content using Tree-sitter.
     * @param filePath - The absolute path to the file being parsed.
     * @param fileContent - The source code content.
     * @returns {Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }>} Parsed nodes and relationships.
     * @throws {ParserError} If parsing fails.
     */
    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        logger.info(`[GoParser] Parsing Go file: ${path.basename(normalizedFilePath)}`);

        try {
            // Assume sharedParser has Go language set by AnalyzerService
            const tree = this.sharedParser.parse(fileContent);
            const visitor = new GoAstVisitor(normalizedFilePath);
            visitor.visit(tree.rootNode);

            logger.info(`[GoParser] Parsed ${path.basename(normalizedFilePath)}. Nodes: ${visitor.nodes.length}, Rels: ${visitor.relationships.length}.`);
            return {
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

        } catch (error: any) {
            logger.error(`[GoParser] Error parsing ${normalizedFilePath}`, {
                 errorMessage: error.message,
                 stack: error.stack?.substring(0, 500)
            });
            // Return empty result on error
            return { nodes: [], relationships: [] };
            // Or rethrow: throw new ParserError(`Failed Go parsing for ${normalizedFilePath}`, { originalError: error });
        }
    }
}