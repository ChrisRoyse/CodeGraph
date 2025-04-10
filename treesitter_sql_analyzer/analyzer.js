'use strict';

const path = require('path');
const Parser = require('tree-sitter');
const SQL = require('@derekstride/tree-sitter-sql');
const idGen = require('./id_generator'); // Import ID generation functions

// --- Helper Functions ---

function pointToLocation(point) {
    // Tree-sitter points are 0-based row/column
    return { line: point.row + 1, column: point.column + 1 };
}

function getNodeText(node, sourceCode) {
    if (!node) return '';
    return sourceCode.substring(node.startIndex, node.endIndex);
}

function getCodeLocation(node, filePath) {
    if (!node) {
        // Fallback or default location if node is somehow null/undefined
        return { file_path: filePath, start_line: 0, start_column: 0, end_line: 0, end_column: 0 };
    }
    const start = pointToLocation(node.startPosition);
    const end = pointToLocation(node.endPosition);
    return {
        file_path: filePath,
        start_line: start.line,
        start_column: start.column,
        end_line: end.line,
        end_column: end.column,
    };
}


/**
 * Analyzes the Tree-sitter syntax tree for SQL code.
 * @param {Parser.SyntaxNode} rootNode - The root node of the AST.
 * @param {string} filePath - The path of the analyzed file.
 * @param {string} sourceCode - The content of the analyzed file.
 * @returns {{nodes: Array<object>, relationships: Array<object>}} - The analysis results formatted for the API Gateway.
 */
function analyze(rootNode, filePath, sourceCode) { // Removed fileId parameter
    const nodes_data = [];
    const relationships_data = [];
    const defined_node_ids_in_run = new Set(); // Track added Global IDs for this run
    const tableDefinitions = new Map(); // Store table Global IDs by name for linking columns/references

    // --- Helper: Create Node Data ---
    const createNode = (nodeType, name, syntaxNode, canonicalIdentifier, properties = {}) => {
        const location = getCodeLocation(syntaxNode, filePath);
        const globalId = idGen.generateGlobalId(nodeType, filePath, canonicalIdentifier); // Use nodeType parameter

        if (defined_node_ids_in_run.has(globalId)) {
            console.debug(`[SQL Analyzer] Skipping duplicate node addition for ID: ${globalId} (Type: ${nodeType}, Name: ${name})`);
            return globalId; // Return existing ID but don't add again
        }
        defined_node_ids_in_run.add(globalId);

        // Renamed keys to match API schema (camelCase, uniqueId, type, etc.)
        // Match the Pydantic Node model in api_gateway/ingestion_schemas.py
        const nodeData = {
            uniqueId: globalId,
            name: name,
            filePath: location.file_path, // Corrected: Use camelCase key from schema
            startLine: location.start_line, // Corrected: Use camelCase key from schema
            endLine: location.end_line, // Corrected: Use camelCase key from schema
            language: 'sql', // Add missing language field
            labels: [nodeType], // Use labels array instead of type string
            // Removed extra fields: startColumn, endColumn, properties
        };
        nodes_data.push(nodeData); // Add to the correctly named array
        return globalId;
    };

     // --- Helper: Create Relationship Data ---
     const createRelationship = (sourceNodeId, targetIdentifier, relationshipType, locationSyntaxNode, properties = {}) => {
        if (!sourceNodeId || !relationshipType) {
            console.warn(`[SQL Analyzer] Skipping relationship due to missing required fields: ${relationshipType} (Source: ${sourceNodeId}, TargetId: ${targetIdentifier})`);
            return;
        }
        const location = getCodeLocation(locationSyntaxNode, filePath);
        // Renamed keys to match API schema (camelCase, sourceId, type, etc.)
        // Match the Pydantic RelationshipStub model
        relationships_data.push({
            sourceId: sourceNodeId,
            targetIdentifier: targetIdentifier,
            type: relationshipType,
            properties: properties,
            // Removed extra fields: startLine, startColumn, endLine, endColumn
        });
    };

    // --- 1. Create File Node ---
    const normalizedFilePath = idGen.normalizePath(filePath);
    const fileCanonicalId = idGen.createCanonicalFile(normalizedFilePath);
    // Pass rootNode which should be the program node for SQL files
    const fileNodeId = createNode("File", path.basename(filePath), rootNode, fileCanonicalId, { full_path: normalizedFilePath });

    if (!fileNodeId) {
        console.error("[SQL Analyzer] Failed to create the root File node. Aborting analysis.");
        return { nodes: [], relationships: [] }; // Use correct key names
    }

    // --- 2. Traverse Tree and Identify Elements ---
    function traverse(node) {
        const nodeType = node.type;
        const nodeLocation = getCodeLocation(node, filePath);
        const nodeText = getNodeText(node, sourceCode);

        // --- Identify CREATE TABLE statements ---
        if (nodeType === 'create_table_statement') {
            const tableNameNode = node.childForFieldName('name');
            if (tableNameNode) {
                const tableName = getNodeText(tableNameNode, sourceCode);
                const tableCanonicalId = idGen.createCanonicalTable(tableName);
                const tableGlobalId = createNode(
                    'Table', // Normalized type
                    tableName,
                    tableNameNode, // Node for location is the name identifier
                    tableCanonicalId,
                    { statement_type: 'CREATE' } // Add property
                );

                if (tableGlobalId) {
                    tableDefinitions.set(tableName, tableGlobalId); // Store for column linking
                    // Create relationship: File CONTAINS Table
                    createRelationship(fileNodeId, tableCanonicalId, 'CONTAINS', node); // Location is the whole statement

                    // --- Identify Column Definitions within this table ---
                    let columnListNode = node.childForFieldName('columns') || node.descendantsOfType('column_definition');
                    if (Array.isArray(columnListNode)) {
                        columnListNode.forEach(colDefNode => processColumnDefinition(colDefNode, tableGlobalId, tableName));
                    } else if (columnListNode?.namedChildren) {
                         columnListNode.namedChildren.forEach(child => {
                             if (child.type === 'column_definition') {
                                processColumnDefinition(child, tableGlobalId, tableName);
                             }
                         });
                    } else if (node.namedChildren) {
                         node.namedChildren.forEach(child => {
                             if (child.type === 'column_definition') {
                                processColumnDefinition(child, tableGlobalId, tableName);
                             }
                         });
                    }
                }
            }
        }

        // --- Identify Table and Column References (Simplified) ---
        // This is complex; focusing on simple identifiers for now
        if (nodeType === 'identifier' || nodeType === 'object_reference') {
             // Basic check: if it's likely a table name (e.g., in FROM/JOIN/UPDATE)
             // or a column name (e.g., in SELECT list, WHERE clause).
             // This needs significant refinement for accuracy.
             const identifierText = getNodeText(node, sourceCode);
             let parent = node.parent;
             let isLikelyTable = false;
             let isLikelyColumn = false;
             let operation = 'UNKNOWN';

             while(parent) {
                 if (['from_clause', 'join_clause', 'update_statement', 'insert_statement', 'delete_statement'].includes(parent.type)) {
                     isLikelyTable = true;
                     operation = parent.type.split('_')[0].toUpperCase();
                     break;
                 }
                 if (['select_clause_element', 'where_clause', 'set_clause', 'order_by_clause'].includes(parent.type)) {
                     isLikelyColumn = true;
                      operation = parent.type.split('_')[0].toUpperCase();
                     break;
                 }
                 if (parent.type.endsWith('_statement')) break; // Stop at statement boundary
                 parent = parent.parent;
             }

             if (isLikelyTable) {
                 const refCanonicalId = `REF:TABLE:${identifierText}@${nodeLocation.start_line}:${nodeLocation.start_column}`;
                 const refGlobalId = createNode('QueryTableReference', identifierText, node, refCanonicalId, { operation });
                 if (refGlobalId) {
                     // Create unresolved reference relationship
                     createRelationship(refGlobalId, identifierText, 'REFERENCES_TABLE', node);
                 }
             } else if (isLikelyColumn) {
                 // Extract potential table qualifier if present (e.g., table.column)
                 let tableNameHint = null;
                 if (node.previousSibling?.type === '.' && node.previousSibling?.previousSibling?.type === 'identifier') {
                     tableNameHint = getNodeText(node.previousSibling.previousSibling, sourceCode);
                 } else if (nodeType === 'object_reference' && node.childForFieldName('object')) {
                      tableNameHint = getNodeText(node.childForFieldName('object'), sourceCode);
                 }

                 const refCanonicalId = `REF:COLUMN:${tableNameHint ?? '?'}.${identifierText}@${nodeLocation.start_line}:${nodeLocation.start_column}`;
                 const refGlobalId = createNode('QueryColumnReference', identifierText, node, refCanonicalId, { operation, table_hint: tableNameHint });
                 if (refGlobalId) {
                     // Create unresolved reference relationship
                     // Target identifier needs table context for better resolution
                     const targetIdentifier = tableNameHint ? `${tableNameHint}.${identifierText}` : identifierText;
                     createRelationship(refGlobalId, targetIdentifier, 'REFERENCES_COLUMN', node);
                 }
             }
        }

        // Recursively traverse children
        for (const child of node.namedChildren) {
            traverse(child);
        }
    }

    function processColumnDefinition(colDefNode, tableGlobalId, tableName) {
        const columnNameNode = colDefNode.childForFieldName('name');
        const columnTypeNode = colDefNode.childForFieldName('type'); // Or 'data_type'

        if (columnNameNode) {
            const columnName = getNodeText(columnNameNode, sourceCode);
            const columnType = columnTypeNode ? getNodeText(columnTypeNode, sourceCode) : 'UNKNOWN';
            const columnCanonicalId = idGen.createCanonicalColumn(tableName, columnName);
            const columnLocation = getCodeLocation(columnNameNode, filePath);
            const columnSnippet = getNodeText(colDefNode, sourceCode);

            const columnGlobalId = createNode(
                'Column', // Normalized type
                columnName,
                columnNameNode, // Node for location
                columnCanonicalId,
                { data_type: columnType, table_name: tableName }
            );

            if (columnGlobalId && tableGlobalId) {
                // Create relationship: Table CONTAINS Column
                createRelationship(tableGlobalId, columnCanonicalId, 'CONTAINS', colDefNode);
            }
        }
    }

    // Start traversal from the root
    if (rootNode) {
        traverse(rootNode);
    } else {
        console.error("[SQL Analyzer] Root node is null, cannot traverse.");
    }


    console.log(`[SQL Analyzer] Analysis complete for ${filePath}. Found ${nodes_data.length} nodes and ${relationships_data.length} relationships.`);

    // Return object with keys matching the API schema
    return { nodes: nodes_data, relationships: relationships_data };
}

module.exports = { analyze };