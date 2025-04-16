/**
 * AST Visitor for SQL Analyzer
 * 
 * This module provides functionality to traverse SQL ASTs
 * and extract code structure information.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import SQL from '@derekstride/tree-sitter-sql';
import { IdServiceClient } from './id-service-client';
import { AnalysisNode, AnalysisRelationship, SqlEntityType, SqlRelationshipType, SqlColumnProperties, SqlForeignKeyProperties } from './models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * AST Visitor for SQL files
 */
export class SqlAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private sqlParser: Parser;
  private tree: Parser.Tree | null = null;
  private content: string = '';
  
  // Map to track tables by name for relationship creation
  private tableMap: Map<string, { canonicalId: string, gid: string }> = new Map();
  
  // Queries for finding specific SQL constructs
  private tableQuery: string;
  private columnQuery: string;
  private viewQuery: string;
  private functionQuery: string;
  private procedureQuery: string;
  private foreignKeyQuery: string;

  /**
   * Initialize the AST visitor
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;

    // Initialize parser
    this.sqlParser = new Parser();
    this.sqlParser.setLanguage(SQL);
    
    // Initialize queries for finding SQL constructs
    this.tableQuery = `
      (create_table_statement
        name: (identifier) @table_name)
    `;
    
    this.columnQuery = `
      (create_table_statement
        name: (identifier) @table_name
        (column_definition
          name: (identifier) @column_name
          type: (data_type) @data_type))
    `;
    
    this.viewQuery = `
      (create_view_statement
        name: (identifier) @view_name)
    `;
    
    this.functionQuery = `
      (create_function_statement
        name: (identifier) @function_name)
    `;
    
    this.procedureQuery = `
      (create_procedure_statement
        name: (identifier) @procedure_name)
    `;
    
    this.foreignKeyQuery = `
      (create_table_statement
        name: (identifier) @table_name
        (foreign_key_constraint
          columns: (column_name_list) @local_columns
          foreign_table: (identifier) @foreign_table
          foreign_columns: (column_name_list) @foreign_columns))
    `;
  }

  /**
   * Parse the file and analyze the SQL AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.sqlParser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        SqlEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Add file node
      this.nodes.push({
        type: SqlEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid
      });

      // Process SQL constructs
      await this.processTables();
      await this.processColumns();
      await this.processViews();
      await this.processFunctions();
      await this.processProcedures();
      await this.processForeignKeys();

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process CREATE TABLE statements
   */
  private async processTables(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;

      // Create a query to find all CREATE TABLE statements
      const query = this.sqlParser.getLanguage().query(this.tableQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'table_name') {
            const tableName = capture.node.text;
            
            // Generate ID for the table
            const [canonicalId, gid] = await this.idServiceClient.generateId(
              this.filePath,
              SqlEntityType.Table,
              tableName,
              this.fileCanonicalId
            );
            
            // Add table node
            this.nodes.push({
              type: SqlEntityType.Table,
              name: tableName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid
            });
            
            // Store table info for relationship creation
            this.tableMap.set(tableName, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing tables: ${error}`);
    }
  }

  /**
   * Process column definitions in CREATE TABLE statements
   */
  private async processColumns(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId) return;

      // Create a query to find all column definitions
      const query = this.sqlParser.getLanguage().query(this.columnQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        let tableName = '';
        let columnName = '';
        let dataType = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'table_name') {
            tableName = capture.node.text;
          } else if (capture.name === 'column_name') {
            columnName = capture.node.text;
          } else if (capture.name === 'data_type') {
            dataType = capture.node.text;
          }
        }
        
        if (tableName && columnName) {
          const tableInfo = this.tableMap.get(tableName);
          
          if (tableInfo) {
            // Generate ID for the column
            const [canonicalId, gid] = await this.idServiceClient.generateId(
              this.filePath,
              SqlEntityType.Column,
              columnName,
              tableInfo.canonicalId
            );
            
            // Create column properties
            const columnProperties: SqlColumnProperties = {
              data_type: dataType
            };
            
            // Check for constraints in the column definition
            // This is a simplified approach - in a real implementation,
            // we would parse the full column definition for constraints
            const isPrimaryKey = this.content.includes(`${columnName} ${dataType} PRIMARY KEY`);
            const isNotNull = this.content.includes(`${columnName} ${dataType} NOT NULL`);
            const isUnique = this.content.includes(`${columnName} ${dataType} UNIQUE`);
            
            if (isPrimaryKey) {
              columnProperties.primary_key = true;
            }
            
            if (isNotNull) {
              columnProperties.nullable = false;
            } else {
              columnProperties.nullable = true;
            }
            
            if (isUnique) {
              columnProperties.unique = true;
            }
            
            // Add column node
            this.nodes.push({
              type: SqlEntityType.Column,
              name: columnName,
              path: this.filePath,
              parent_canonical_id: tableInfo.canonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: columnProperties
            });
            
            // Add relationship between table and column
            this.relationships.push({
              source_gid: tableInfo.gid,
              target_canonical_id: canonicalId,
              type: SqlRelationshipType.DEFINES_COLUMN,
              properties: {}
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing columns: ${error}`);
    }
  }

  /**
   * Process CREATE VIEW statements
   */
  private async processViews(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;

      // Create a query to find all CREATE VIEW statements
      const query = this.sqlParser.getLanguage().query(this.viewQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'view_name') {
            const viewName = capture.node.text;
            
            // Generate ID for the view
            const [canonicalId, gid] = await this.idServiceClient.generateId(
              this.filePath,
              SqlEntityType.View,
              viewName,
              this.fileCanonicalId
            );
            
            // Add view node
            this.nodes.push({
              type: SqlEntityType.View,
              name: viewName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid
            });
            
            // Find table dependencies in the view definition
            // This is a simplified approach - in a real implementation,
            // we would parse the full view definition for dependencies
            for (const [tableName, tableInfo] of this.tableMap.entries()) {
              // Check if the view definition contains the table name
              // This is a simple heuristic and might produce false positives
              const viewNode = capture.node.parent;
              if (viewNode && viewNode.text.includes(tableName)) {
                // Add dependency relationship
                this.relationships.push({
                  source_gid: gid,
                  target_canonical_id: tableInfo.canonicalId,
                  type: SqlRelationshipType.DEPENDS_ON,
                  properties: {}
                });
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing views: ${error}`);
    }
  }

  /**
   * Process CREATE FUNCTION statements
   */
  private async processFunctions(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;

      // Create a query to find all CREATE FUNCTION statements
      const query = this.sqlParser.getLanguage().query(this.functionQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'function_name') {
            const functionName = capture.node.text;
            
            // Generate ID for the function
            const [canonicalId, gid] = await this.idServiceClient.generateId(
              this.filePath,
              SqlEntityType.Function,
              functionName,
              this.fileCanonicalId
            );
            
            // Add function node
            this.nodes.push({
              type: SqlEntityType.Function,
              name: functionName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing functions: ${error}`);
    }
  }

  /**
   * Process CREATE PROCEDURE statements
   */
  private async processProcedures(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;

      // Create a query to find all CREATE PROCEDURE statements
      const query = this.sqlParser.getLanguage().query(this.procedureQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'procedure_name') {
            const procedureName = capture.node.text;
            
            // Generate ID for the procedure
            const [canonicalId, gid] = await this.idServiceClient.generateId(
              this.filePath,
              SqlEntityType.Procedure,
              procedureName,
              this.fileCanonicalId
            );
            
            // Add procedure node
            this.nodes.push({
              type: SqlEntityType.Procedure,
              name: procedureName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing procedures: ${error}`);
    }
  }

  /**
   * Process foreign key constraints
   */
  private async processForeignKeys(): Promise<void> {
    try {
      if (!this.tree) return;

      // Create a query to find all foreign key constraints
      const query = this.sqlParser.getLanguage().query(this.foreignKeyQuery);
      const matches = query.matches(this.tree.rootNode);

      for (const match of matches) {
        let tableName = '';
        let localColumns = '';
        let foreignTable = '';
        let foreignColumns = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'table_name') {
            tableName = capture.node.text;
          } else if (capture.name === 'local_columns') {
            localColumns = capture.node.text;
          } else if (capture.name === 'foreign_table') {
            foreignTable = capture.node.text;
          } else if (capture.name === 'foreign_columns') {
            foreignColumns = capture.node.text;
          }
        }
        
        if (tableName && foreignTable) {
          const tableInfo = this.tableMap.get(tableName);
          const foreignTableInfo = this.tableMap.get(foreignTable);
          
          if (tableInfo && foreignTableInfo) {
            // Parse column lists
            const localColumnList = localColumns.split(',').map(col => col.trim());
            const foreignColumnList = foreignColumns.split(',').map(col => col.trim());
            
            // For each local column, create a relationship to the corresponding foreign column
            for (let i = 0; i < localColumnList.length && i < foreignColumnList.length; i++) {
              // Add foreign key relationship
              this.relationships.push({
                source_gid: tableInfo.gid,
                target_canonical_id: foreignTableInfo.canonicalId,
                type: SqlRelationshipType.REFERENCES,
                properties: {
                  local_column: localColumnList[i],
                  foreign_column: foreignColumnList[i]
                }
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing foreign keys: ${error}`);
    }
  }
}

/**
 * Analyze a SQL file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeSqlFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new SqlAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing file ${filePath}: ${error}`);
    return [[], []];
  }
}