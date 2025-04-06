/**
 * @file Converts SQL source code into Intermediate Representation (IR) entities using Tree-sitter.
 */

import { SyntaxNode, Query } from 'tree-sitter'; // Import Query as value, keep SyntaxNode as type
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
  DatabaseTableProperties,
  DatabaseColumnProperties,
  DatabaseQueryProperties,
  ParameterDetail, // Ensure ParameterDetail is imported
} from '../schema.js';
import { addIdToElement, generateCanonicalId } from '../ir-utils.js';
import { createContextLogger } from '../../utils/logger.js';
import path from 'path';
// Import ParserFactory and the correct Language enum
import { ParserFactory } from '../../analyzer/parsers/parser-factory.js';
import { Language as AnalyzerLanguage } from '../../types/index.js';
// Import getGrammar as it's needed for Query compilation
import { getGrammar } from '@bmcp/grammar-loader';


const logger = createContextLogger('SqlConverterTreeSitter');

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

// More specific node text extraction, handling potential schema prefixes
function getQualifiedName(node: SyntaxNode | null, code: string): { name: string; schema?: string } | null {
    if (!node) return null;

    // Simple identifier case
    if (node.type === 'identifier') {
        return { name: getNodeText(node, code) };
    }

    // Handle qualified names like schema.table or schema.function
    if (node.type === 'qualified_name' || node.type === 'table_name' || node.type === 'function_name') { // Adjust based on grammar specifics
        const parts = node.children.filter(c => c.type === 'identifier').map(c => getNodeText(c, code));
        if (parts.length === 1) {
            const name = parts[0];
            return name ? { name } : null;
        } else if (parts.length > 1) {
            // Assuming the last part is the name and the preceding part is the schema
            const name = parts[parts.length - 1];
            const schema = parts[parts.length - 2];
            // Ensure name is valid, schema is optional but should be string if present
            return name ? { name, schema: schema ?? undefined } : null;
        }
    }

    // Fallback for unexpected structures, log a warning
    logger.warn(`Unexpected node type '${node.type}' encountered when extracting qualified name. Text: ${getNodeText(node, code)}`);
    // Attempt a simple text extraction as a last resort
    const text = getNodeText(node, code);
    const parts = text.split('.');
     if (parts.length === 1) {
        const name = parts[0];
        return name ? { name } : null;
    } else if (parts.length > 1) {
        const name = parts[parts.length - 1];
        const schema = parts[parts.length - 2];
        return name ? { name, schema: schema ?? undefined } : null;
    }

    return null; // Could not determine name
}

// Define the query string (outside the function for clarity)
const TABLE_QUERY_STRING = `
; Query to find table references in various SQL statements

; Table references in FROM/JOIN clauses
(table_reference
  (qualified_name
    schema: (identifier)? @schema
    name: (identifier) @table) @qualified_name
  ; (alias (identifier) @alias)? ; Alias capture if needed later
) @table_ref_context

; Target table in UPDATE statements
(update_statement
  target: (table_name
    (qualified_name
      schema: (identifier)? @schema
      name: (identifier) @table) @qualified_name
  )
) @update_context

; Target table in INSERT statements
(insert_statement
  target: (table_name
    (qualified_name
      schema: (identifier)? @schema
      name: (identifier) @table) @qualified_name
  )
) @insert_context

; Target table in DELETE statements (assuming FROM clause is used)
(delete_statement
  (from_clause
    (table_reference
      (qualified_name
        schema: (identifier)? @schema
        name: (identifier) @table) @qualified_name
      ; (alias (identifier) @alias)?
    )
  )
) @delete_context

; Target table in DROP TABLE statements
(drop_table_statement
  name: (table_name
    (qualified_name
      schema: (identifier)? @schema
      name: (identifier) @table) @qualified_name
  )
) @drop_context

; Simple identifier as table name (fallback for simpler cases if qualified_name isn't used)
(table_reference (identifier) @table) @table_ref_simple_context
(update_statement target: (table_name (identifier) @table)) @update_simple_context
(insert_statement target: (table_name (identifier) @table)) @insert_simple_context
(drop_table_statement name: (table_name (identifier) @table)) @drop_simple_context
`;

/**
 * Parses SQL code using Tree-sitter and converts it into a FileIr object.
 *
 * @param sourceCode The SQL source code string.
 * @param filePath The path to the source file.
 * @param projectId The project identifier.
 * @returns A Promise resolving to a FileIr object.
 */
export async function convertToIr(sourceCode: string, filePath: string, projectId: string): Promise<FileIr> {
  // Construct fileId directly according to the canonical format
  const cleanedFilePath = filePath.replace(/\\/g, '/'); // Ensure forward slashes
  const fileId: CanonicalId = `connectome://${projectId}/file:${cleanedFilePath}`;
  const analyzerLanguage = AnalyzerLanguage.SQL; // Use AnalyzerLanguage for factory call
  const irLanguage = IrLanguage.SQL; // Use IrLanguage for schema properties and final object

  if (!sourceCode?.trim()) {
    return {
        schemaVersion: '1.0.0', projectId, fileId, filePath, // Corrected schemaVersion
        language: irLanguage, elements: [], potentialRelationships: [] // Use aliased IR Language
    };
  }

  const partialElements: Omit<IrElement, 'id'>[] = []; // Store elements before ID generation
  const potentialRelationships: PotentialRelationship[] = [];
  let elementsWithIds: IrElement[] = [];

  try {
    // Use ParserFactory to get the AST
    logger.debug(`Requesting parsing for ${filePath} (SQL) via ParserFactory...`);
    const rootNode = await ParserFactory.parse(analyzerLanguage, sourceCode, filePath);

    // Handle parsing failure
    if (!rootNode) {
        logger.error(`Parsing failed for ${filePath}. ParserFactory returned null.`);
        return { schemaVersion: '1.0.0', projectId, fileId, filePath, language: irLanguage, elements: [], potentialRelationships: [] }; // Use irLanguage
    }
    logger.debug(`Successfully received AST for ${filePath} from ParserFactory.`);

    // Need to load grammar separately for Tree-sitter Query compilation
    // TODO: Consider if Query compilation can move to parser-service or be cached
    const sqlGrammar = getGrammar('SQL'); // Still need grammar for Query
    const tableQuery = new Query(sqlGrammar, TABLE_QUERY_STRING); // Compile the query once

    logger.debug(`Starting SQL IR conversion for: ${filePath}`);

    // Temporary storage for column data before parent IDs are known
    const columnDataToLink: { columnElement: Omit<IrElement, 'id'>; parentTableName: string }[] = [];

    // --- Tree Traversal Logic ---
    function traverse(node: SyntaxNode) {
        try {
            switch (node.type) {
                case 'create_table_statement': {
                    const tableElement = createPartialTableElement(node, filePath, sourceCode);
                    if (tableElement) {
                        partialElements.push(tableElement);
                        // Extract columns and store them temporarily for linking later
                        const columnElements = extractColumnElements(node, filePath, sourceCode, tableElement.name);
                        columnDataToLink.push(...columnElements);
                    }
                    return; // Don't recurse further into CREATE TABLE structure here
                }
                case 'select_statement':
                case 'insert_statement':
                case 'update_statement':
                case 'delete_statement':
                case 'drop_table_statement': // Handle DDL like DROP
                // Add other DML/DDL statements as needed (e.g., ALTER TABLE, CREATE INDEX)
                {
                    const queryRel = createPotentialQueryRelationship(node, fileId, filePath, sourceCode, tableQuery); // Pass compiled query
                    if (queryRel) {
                        potentialRelationships.push(queryRel);
                    }
                    return; // Don't recurse further into these statements for now
                }
                default:
                    // Default: Recurse into children
                    node.children.forEach(traverse);
            }
        } catch (error) {
            logger.error(`Error processing SQL node type ${node.type} at ${filePath}:${node.startPosition.row + 1}:`, error);
        }
    }

    traverse(rootNode);
    // --- End Traversal Logic ---

    if (partialElements.length === 0 && potentialRelationships.length === 0 && rootNode.text.trim().length > 0) {
         logger.warn(`SQL converter did not extract any elements or relationships from non-empty file: ${filePath}. Check grammar node types and parsing logic.`);
    }

    // --- Post-Traversal ID Generation & Linking ---
    // 1. Generate IDs for all top-level elements (Tables in this case)
    elementsWithIds = partialElements.map(el => addIdToElement(el, projectId));

    // 2. Create column elements with correct parentId and generate their IDs
    const finalColumnElements: IrElement[] = [];
    columnDataToLink.forEach(({ columnElement, parentTableName }) => {
        const parentTable = elementsWithIds.find(el => el.type === 'DatabaseTable' && el.name === parentTableName);
        if (parentTable) {
            (columnElement.properties as DatabaseColumnProperties).parentId = parentTable.id;
            // Now generate the ID for the column element itself
            const columnWithId = addIdToElement(columnElement, projectId);
            finalColumnElements.push(columnWithId);
        } else {
            // Log the warning but do not add a placeholder ID.
            // The parentId property will remain undefined in the properties object.
            // The column element will still be added, but without a valid parent link.
            logger.warn(`Could not find parent table ID for column '${columnElement.name}' (expected table: '${parentTableName}') in ${filePath}. ParentId will be missing.`);
            // Still generate the ID for the column itself, even without a parent link.
            const columnWithId = addIdToElement(columnElement, projectId);
            finalColumnElements.push(columnWithId);
        }
    });

    // 3. Combine table and column elements
    elementsWithIds.push(...finalColumnElements);


} catch (error: any) {
  logger.error(`Failed to convert SQL file ${filePath}: ${error.message}`, { error });
  // Return minimal FileIr on error
  return {
      schemaVersion: '1.0.0', projectId, fileId, filePath, // Corrected schemaVersion
      language: irLanguage, elements: [], potentialRelationships: [] // Use aliased IR Language
  };
}

  // Construct the final FileIr object
  const fileIr: FileIr = {
    schemaVersion: '1.0.0', // Corrected schemaVersion
    projectId: projectId,
    fileId: fileId,
    filePath: filePath,
    language: irLanguage, // Use the IR Language enum here
    elements: elementsWithIds,
    potentialRelationships: potentialRelationships,
  };

  return fileIr;
}

// --- Helper Functions for SQL Parsing ---

function createPartialTableElement(node: SyntaxNode, filePath: string, sourceCode: string): Omit<IrElement, 'id'> | null {
    // Grammar specific: Find the table name identifier/qualified_name
    // Look for the identifier immediately following 'TABLE' keyword, potentially qualified
    const tableKeyword = node.children.find(c => c.type === 'TABLE');
    let tableNameNode: SyntaxNode | null = null;
    if (tableKeyword?.nextNamedSibling) {
         tableNameNode = tableKeyword.nextNamedSibling; // This should be the table name node
    } else {
        // Fallback: Search for common name node types if direct sibling fails
        tableNameNode = node.namedChildren.find(c => c.type === 'identifier' || c.type === 'table_name' || c.type === 'qualified_name') ?? null;
    }


    if (!tableNameNode) {
        logger.warn(`Could not find table name in CREATE TABLE statement at ${filePath}:${node.startPosition.row + 1}`);
        return null;
    }

    const qualifiedName = getQualifiedName(tableNameNode, sourceCode);
    if (!qualifiedName) {
         logger.warn(`Could not parse table name from node type ${tableNameNode.type} at ${filePath}:${node.startPosition.row + 1}`);
         return null;
    }

    const tableName = qualifiedName.name;
    const schemaName = qualifiedName.schema;
    const location = getNodeLocation(node);
    const properties: DatabaseTableProperties = {
      language: IrLanguage.SQL, // Use aliased IrLanguage for schema properties
      schemaName: schemaName,
      rawSignature: sourceCode.substring(node.startIndex, node.endIndex), // Keep rawSignature here
    };

    return {
        type: 'DatabaseTable',
        name: tableName,
        filePath: filePath,
        location: location,
        properties: properties,
        // rawSignature is correctly inside properties
    };
}

function extractColumnElements(tableNode: SyntaxNode, filePath: string, sourceCode: string, parentTableName: string): { columnElement: Omit<IrElement, 'id'>; parentTableName: string }[] {
    const columnData: { columnElement: Omit<IrElement, 'id'>; parentTableName: string }[] = [];
    // Grammar specific: Find column definition nodes within the table definition's body
    // This might be inside a 'table_constraint' or directly within the create_table_statement body
    const columnDefinitionNodes = tableNode.descendantsOfType('column_definition');

    columnDefinitionNodes.forEach(colNode => {
        const colNameNode = colNode.children.find(c => c.type === 'identifier'); // Column name
        const colTypeNode = colNode.children.find(c => c.type === 'data_type'); // Data type node

        if (colNameNode && colTypeNode) {
            const colName = getNodeText(colNameNode, sourceCode);
            const colType = getNodeText(colTypeNode, sourceCode);
            const location = getNodeLocation(colNode);

            // Extract constraints
            const constraints: string[] = [];
            let isPrimaryKey = false;
            let isForeignKey = false; // TODO: Implement FK parsing if needed
            let referencesTable: CanonicalId | undefined = undefined;
            let referencesColumn: CanonicalId | undefined = undefined;

            const constraintNodes = colNode.children.filter(c => c.type === 'column_constraint');
            constraintNodes.forEach(constraintNode => {
                const constraintText = getNodeText(constraintNode, sourceCode).toUpperCase();
                constraints.push(constraintText); // Store the raw constraint text

                if (constraintText.includes('PRIMARY KEY')) {
                    isPrimaryKey = true;
                }
                if (constraintText.includes('NOT NULL')) {
                    // Already captured in constraints array
                }
                if (constraintText.includes('UNIQUE')) {
                     // Already captured in constraints array
                }
                // Add more specific constraint parsing if needed (e.g., CHECK, DEFAULT)
                // TODO: Parse FOREIGN KEY REFERENCES clause
                // if (constraintNode.descendantsOfType('references_clause').length > 0) {
                //     isForeignKey = true;
                //     // Extract referenced table and column - requires more detailed grammar inspection
                //     // referencesTable = ...
                //     // referencesColumn = ...
                // }
            });

            // Check for table-level primary key constraints affecting this column
            const tableConstraints = tableNode.descendantsOfType('table_constraint');
            tableConstraints.forEach(tcNode => {
                if (tcNode.text.toUpperCase().includes('PRIMARY KEY')) {
                    const pkColumnList = tcNode.descendantsOfType('identifier');
                    if (pkColumnList.some(pkCol => getNodeText(pkCol, sourceCode) === colName)) {
                        isPrimaryKey = true;
                        if (!constraints.some(c => c.includes('PRIMARY KEY'))) {
                             constraints.push('PRIMARY KEY (Table Level)'); // Indicate it's from table constraint
                        }
                    }
                }
                 // TODO: Parse table-level FOREIGN KEY constraints
            });


            const properties: DatabaseColumnProperties = {
                language: IrLanguage.SQL, // Use aliased IrLanguage for schema properties
                dataType: colType,
                isPrimaryKey: isPrimaryKey,
                isForeignKey: isForeignKey,
                referencesTable: referencesTable,
                referencesColumn: referencesColumn,
                constraints: constraints,
                parentId: 'placeholder', // Will be replaced after table ID is generated
                rawSignature: getNodeText(colNode, sourceCode), // Keep rawSignature here
            };

            columnData.push({
                columnElement: {
                    type: 'DatabaseColumn',
                    name: colName,
                    filePath: filePath,
                    location: location,
                    properties: properties,
                    // rawSignature is correctly inside properties
                },
                parentTableName: parentTableName
            });
        } else {
             logger.warn(`Could not extract name or type for column definition at ${filePath}:${colNode.startPosition.row + 1}. Node text: ${getNodeText(colNode, sourceCode)}`);
        }
    });
    return columnData;
}


function createPotentialQueryRelationship(node: SyntaxNode, sourceId: CanonicalId, filePath: string, sourceCode: string, tableQuery: Query): PotentialRelationship | null { // Add query parameter
    const location = getNodeLocation(node);
    const queryType = mapSqlNodeTypeToQueryType(node.type);
    const rawSql = getNodeText(node, sourceCode);

    // Use Tree-sitter query to find involved table names
    const involvedTablesSet = new Set<string>();
    const matches = tableQuery.matches(node); // Execute query on the current statement node

    matches.forEach(match => {
        // Find the schema and table captures within this specific match
        const schemaCapture = match.captures.find(c => c.name === 'schema');
        const tableCapture = match.captures.find(c => c.name === 'table');

        if (tableCapture) {
            const tableName = getNodeText(tableCapture.node, sourceCode);
            const schemaName = schemaCapture ? getNodeText(schemaCapture.node, sourceCode) : undefined;
            const qualifiedTableName = schemaName ? `${schemaName}.${tableName}` : tableName;

            // Add the qualified name directly. The query is designed to capture tables in valid contexts.
            involvedTablesSet.add(qualifiedTableName);
        }
        // We rely on the query structure to only capture relevant table names.
    });

     // Remove potential duplicates: If 'schema.table' exists, remove 'table'. If only 'table' exists, keep it.
    const filteredTables = Array.from(involvedTablesSet).filter((tableName, _index, selfSet) => {
        const parts = tableName.split('.');
        if (parts.length === 1) {
            // This is an unqualified name (e.g., 'table'). Keep it ONLY if no qualified version exists.
            const unqualifiedName = parts[0];
            // Check if any other name in the set ends with '.unqualifiedName'
            return !selfSet.some(otherName => {
                const otherParts = otherName.split('.');
                // Ensure we are comparing against the table part of a qualified name
                return otherParts.length > 1 && otherParts[otherParts.length - 1] === unqualifiedName;
            });
        }
        // This is a qualified name (e.g., 'schema.table'). Always keep it.
        return true;
    });


    const involvedTables = filteredTables; // Assign the filtered list

    // TODO: Extract involved columns if needed (more complex parsing)
    // const involvedColumns = node.descendantsOfType('identifier')... filter appropriately ...

    const properties: DatabaseQueryProperties = {
        queryType: queryType,
        rawSql: rawSql,
        targetTables: involvedTables, // Renamed property
        // targetColumns: [], // Placeholder for renamed property
        rawReference: (rawSql ?? '').substring(0, 100) + ((rawSql?.length ?? 0) > 100 ? '...' : ''), // Moved rawReference here
    };

    // Use involved tables as the target pattern for resolution
    const targetPattern = involvedTables.join(',');

    if (!targetPattern && queryType !== 'UNKNOWN' && queryType !== 'DDL') { // Don't warn for DDL if no table found (e.g., CREATE DATABASE)
        logger.warn(`Could not determine target tables for ${queryType} query at ${filePath}:${location.start.line}. Raw SQL: ${rawSql.substring(0, 50)}...`);
        // Decide whether to still create the relationship or skip it
        // return null; // Option: Skip if no tables found for known query types
    }


    return {
        sourceId: sourceId, // Use the file ID as the source for standalone SQL
        type: 'DatabaseQuery',
        targetPattern: targetPattern || 'UNKNOWN_TABLE', // Provide a fallback pattern
        location: location,
        properties: properties,
        // rawReference is correctly inside properties
    };
}

function mapSqlNodeTypeToQueryType(nodeType: string): DatabaseQueryProperties['queryType'] {
    switch (nodeType) {
        case 'select_statement': return 'SELECT';
        case 'insert_statement': return 'INSERT';
        case 'update_statement': return 'UPDATE';
        case 'delete_statement': return 'DELETE';
        // DDL types
        case 'create_table_statement': // Handled separately for elements, but could also be a DDL query type
        case 'alter_table_statement':
        case 'drop_table_statement':
        case 'create_index_statement':
        case 'drop_index_statement':
            return 'DDL';
        default: return 'UNKNOWN';
    }
}