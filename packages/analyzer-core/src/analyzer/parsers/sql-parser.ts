// src/analyzer/parsers/sql-parser.ts
import type { default as TreeSitterParser } from 'tree-sitter'; // Import the type
// Removed static import for tree-sitter-sql
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js';
import { ParserError } from '../../utils/errors.js';
import { FileInfo } from '../../scanner/file-scanner.js';
import { AstNode, RelationshipInfo, LanguageParser, InstanceCounter, SQLTableNode, SQLColumnNode, SQLViewNode, SQLStatementNode } from '../types.js'; // Import LanguageParser
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId, generateRelationshipId } from '../parser-utils.js';

const logger = createContextLogger('SqlParser');

// Helper to get node text safely
function getNodeText(node: TreeSitterParser.SyntaxNode | null | undefined): string { // Use TreeSitterParser namespace
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: TreeSitterParser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } { // Use TreeSitterParser namespace
    return {
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column, endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class SqlAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode;
    private now: string = new Date().toISOString();
    private currentSchema: string | null = null; // Track current schema context if applicable

    constructor(private filepath: string) {
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath);
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId, kind: 'File', name: filename, filePath: filepath,
            startLine: 1, endLine: 0, startColumn: 0, endColumn: 0,
            language: 'SQL', createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    visit(node: TreeSitterParser.SyntaxNode) { // Use TreeSitterParser namespace
        for (const child of node.namedChildren) {
            this.visitNode(child);
            // Selectively recurse
            if (['create_table_statement', 'create_view_statement', 'select_statement', 'insert_statement', 'update_statement', 'delete_statement'].includes(child.type)) {
                 this.visit(child);
             }
        }
         if (node.type === 'source_file') { // Assuming root is source_file for tree-sitter-sql
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    private visitNode(node: TreeSitterParser.SyntaxNode) { // Use TreeSitterParser namespace
        try {
            switch (node.type) {
                case 'create_table_statement':
                    this.visitCreateTable(node);
                    break;
                case 'create_view_statement':
                    this.visitCreateView(node);
                    break;
                // DML Statements (Capture basic info)
                case 'select_statement':
                case 'insert_statement':
                case 'update_statement':
                case 'delete_statement':
                    this.visitDMLStatement(node);
                    break;
                // Potentially add CREATE SCHEMA, CREATE FUNCTION, CREATE PROCEDURE later
            }
        } catch (error: any) {
             logger.warn(`[SqlAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
        }
    }

    private visitCreateTable(node: TreeSitterParser.SyntaxNode) { // Use TreeSitterParser namespace
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name'); // Adjust field name based on grammar
        const tableName = getNodeText(nameNode);
        if (!tableName) return;

        // Basic schema handling - assumes schema.table format if present
        const schemaName = tableName.includes('.') ? tableName.split('.')[0] : this.currentSchema;
        const simpleTableName = tableName.includes('.') ? tableName.split('.')[1] : tableName;
        if (!simpleTableName) return; // Add check for undefined simple name

        const qualifiedName = schemaName ? `${schemaName}.${simpleTableName}` : simpleTableName;
        const entityId = generateEntityId('sqltable', qualifiedName);

        const tableNode: SQLTableNode = {
            id: generateInstanceId(this.instanceCounter, 'sqltable', simpleTableName, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'SQLTable', name: simpleTableName,
            filePath: this.filepath, language: 'SQL', ...location, createdAt: this.now,
            properties: { qualifiedName, schema: schemaName }
        };
        this.nodes.push(tableNode);

        // Relationship: File -> DEFINES_TABLE -> SQLTable
        const relEntityId = generateEntityId('defines_table', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'defines_table', `${this.fileNode.id}:${tableNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_TABLE'),
            type: 'DEFINES_TABLE',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // Visit columns within the table definition
        const columnDefs = node.descendantsOfType('column_definition'); // Adjust type based on grammar
        for (const colDef of columnDefs) {
            this.visitColumnDefinition(colDef, entityId); // Pass table entityId as parentId
        }
    }

     private visitColumnDefinition(node: TreeSitterParser.SyntaxNode, parentTableId: string) { // Use TreeSitterParser namespace
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name'); // Adjust field name
        const typeNode = node.childForFieldName('type'); // Adjust field name
        const name = getNodeText(nameNode);
        const dataType = getNodeText(typeNode);
        if (!name) return;

        const entityId = generateEntityId('sqlcolumn', `${parentTableId}.${name}`);
        const columnNode: SQLColumnNode = {
            id: generateInstanceId(this.instanceCounter, 'sqlcolumn', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'SQLColumn', name: name,
            filePath: this.filepath, language: 'SQL', ...location, createdAt: this.now,
            parentId: parentTableId,
            properties: { dataType }
        };
        this.nodes.push(columnNode);

        // Relationship: SQLTable -> HAS_COLUMN -> SQLColumn
        const relEntityId = generateEntityId('has_column', `${parentTableId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_column', `${parentTableId}:${columnNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(parentTableId, entityId, 'HAS_COLUMN'),
            type: 'HAS_COLUMN',
            sourceId: parentTableId, targetId: entityId,
            createdAt: this.now, weight: 8,
        });
    }

    private visitCreateView(node: TreeSitterParser.SyntaxNode) { // Use TreeSitterParser namespace
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name'); // Adjust field name
        const viewName = getNodeText(nameNode);
        if (!viewName) return;

        const schemaName = viewName.includes('.') ? viewName.split('.')[0] : this.currentSchema;
        const simpleViewName = viewName.includes('.') ? viewName.split('.')[1] : viewName;
        if (!simpleViewName) return; // Add check for undefined simple name

        const qualifiedName = schemaName ? `${schemaName}.${simpleViewName}` : simpleViewName;
        const entityId = generateEntityId('sqlview', qualifiedName);

        const viewNode: SQLViewNode = {
            id: generateInstanceId(this.instanceCounter, 'sqlview', simpleViewName, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'SQLView', name: simpleViewName,
            filePath: this.filepath, language: 'SQL', ...location, createdAt: this.now,
            properties: { qualifiedName, schema: schemaName, queryText: getNodeText(node.childForFieldName('query')) } // Store query text
        };
        this.nodes.push(viewNode);

        // Relationship: File -> DEFINES_VIEW -> SQLView
        const relEntityId = generateEntityId('defines_view', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'defines_view', `${this.fileNode.id}:${viewNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_VIEW'),
            type: 'DEFINES_VIEW',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });
        // Pass 2 will analyze queryText to create REFERENCES_TABLE/VIEW relationships
    }

    private visitDMLStatement(node: TreeSitterParser.SyntaxNode) { // Use TreeSitterParser namespace
        const location = getNodeLocation(node);
        let kind: SQLStatementNode['kind'] = 'SQLSelectStatement'; // Default
        if (node.type.startsWith('insert')) kind = 'SQLInsertStatement';
        else if (node.type.startsWith('update')) kind = 'SQLUpdateStatement';
        else if (node.type.startsWith('delete')) kind = 'SQLDeleteStatement';

        const statementText = getNodeText(node);
        const name = `${kind}_${location.startLine}`; // Simple name based on type and line
        const entityId = generateEntityId(kind.toLowerCase(), `${this.filepath}:${location.startLine}:${location.startColumn}`);

        const stmtNode: SQLStatementNode = {
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: kind, name: name,
            filePath: this.filepath, language: 'SQL', ...location, createdAt: this.now,
            properties: { queryText: statementText } // Store full query text
        };
        this.nodes.push(stmtNode);
        // Pass 2 will analyze queryText to create REFERENCES_TABLE/VIEW relationships
    }
}

/**
 * Parses SQL files using Tree-sitter.
 */
export class SqlParser implements LanguageParser {
    private sharedParser: TreeSitterParser;

    constructor(sharedParser: TreeSitterParser) {
        this.sharedParser = sharedParser; // Store the shared parser instance
        // Language is set by AnalyzerService before calling parse
        logger.debug('SqlParser initialized with shared Tree-sitter parser.');
    }

    /**
     * Parses SQL file content using Tree-sitter.
     * @param filePath - The absolute path to the file being parsed.
     * @param fileContent - The source code content.
     * @returns {Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }>} Parsed nodes and relationships.
     * @throws {ParserError} If parsing fails.
     */
    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        logger.info(`[SqlParser] Parsing SQL file: ${path.basename(normalizedFilePath)}`);

        try {
            // Assume sharedParser has SQL language set by AnalyzerService
            const tree = this.sharedParser.parse(fileContent);
            const visitor = new SqlAstVisitor(normalizedFilePath);
            visitor.visit(tree.rootNode);

            logger.info(`[SqlParser] Parsed ${path.basename(normalizedFilePath)}. Nodes: ${visitor.nodes.length}, Rels: ${visitor.relationships.length}.`);
            return {
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

        } catch (error: any) {
            logger.error(`[SqlParser] Error parsing ${normalizedFilePath}`, {
                 errorMessage: error.message,
                 stack: error.stack?.substring(0, 500)
            });
            // Return empty result on error
            return { nodes: [], relationships: [] };
            // Or rethrow: throw new ParserError(`Failed SQL parsing for ${normalizedFilePath}`, { originalError: error });
        }
    }
}