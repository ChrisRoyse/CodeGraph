/**
 * Shared models for the SQL Analyzer
 */

export interface AnalysisNode {
  type: string;
  name: string;
  path: string;
  parent_canonical_id: string;
  canonical_id?: string;
  gid?: string;
  properties?: Record<string, any>;
}

export interface AnalysisRelationship {
  source_gid: string;
  target_canonical_id: string;
  type: string;
  properties: Record<string, any>;
}

export interface AnalysisNodeStub {
  gid: string;
  canonical_id: string;
  name: string;
  file_path: string;
  language: string;
  labels: string[];
  properties: Record<string, any>;
}

export interface AnalysisRelationshipStub {
  source_gid: string;
  target_canonical_id: string;
  type: string;
  properties: Record<string, any>;
}

export interface AnalyzerResultPayload {
  file_path: string;
  language: string;
  error?: string;
  nodes_upserted: AnalysisNodeStub[];
  relationships_upserted: AnalysisRelationshipStub[];
  nodes_deleted: string[];
  relationships_deleted: Record<string, string>[];
}

// SQL-specific entity types
export enum SqlEntityType {
  File = 'File',
  Table = 'Table',
  Column = 'Column',
  View = 'View',
  Function = 'Function',
  Procedure = 'Procedure',
  Index = 'Index',
  Constraint = 'Constraint',
  ForeignKey = 'ForeignKey',
  PrimaryKey = 'PrimaryKey',
  Trigger = 'Trigger'
}

// SQL-specific relationship types
export enum SqlRelationshipType {
  DEFINES_COLUMN = ':DEFINES_COLUMN',
  DEPENDS_ON = ':DEPENDS_ON',
  REFERENCES = ':REFERENCES',
  HAS_INDEX = ':HAS_INDEX',
  HAS_CONSTRAINT = ':HAS_CONSTRAINT',
  TRIGGERS_ON = ':TRIGGERS_ON'
}

// SQL column data types
export interface SqlColumnProperties {
  data_type: string;
  nullable?: boolean;
  default_value?: string;
  primary_key?: boolean;
  unique?: boolean;
  auto_increment?: boolean;
}

// SQL foreign key properties
export interface SqlForeignKeyProperties {
  referenced_table: string;
  referenced_column: string;
  on_delete?: string;
  on_update?: string;
}