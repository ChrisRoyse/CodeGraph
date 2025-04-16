/**
 * Shared models for the Go Analyzer
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

// Go-specific entity types
export enum GoEntityType {
  File = 'File',
  Package = 'Package',
  Function = 'Function',
  Method = 'Method',
  Struct = 'Struct',
  Interface = 'Interface',
  Variable = 'Variable',
  Constant = 'Constant',
  Import = 'Import',
  Type = 'Type',
  Field = 'Field',
  Parameter = 'Parameter'
}

// Go-specific relationship types
export enum GoRelationshipType {
  CONTAINS = ':CONTAINS',
  CALLS = ':CALLS',
  IMPORTS = ':IMPORTS',
  IMPLEMENTS = ':IMPLEMENTS',
  EMBEDS = ':EMBEDS',
  USES_TYPE = ':USES_TYPE',
  BELONGS_TO = ':BELONGS_TO',
  EXTENDS = ':EXTENDS',
  RETURNS = ':RETURNS',
  DEFINES = ':DEFINES'
}

// Go file properties
export interface GoFileProperties {
  package_name: string;
  imports?: string[];
  is_test?: boolean;
  line_count?: number;
}

// Go package properties
export interface GoPackageProperties {
  name: string;
  import_path?: string;
}

// Go function properties
export interface GoFunctionProperties {
  name: string;
  receiver_type?: string;
  parameters?: string[];
  return_types?: string[];
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}

// Go struct properties
export interface GoStructProperties {
  name: string;
  fields?: string[];
  embedded_types?: string[];
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}

// Go interface properties
export interface GoInterfaceProperties {
  name: string;
  methods?: string[];
  embedded_interfaces?: string[];
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}

// Go variable properties
export interface GoVariableProperties {
  name: string;
  type?: string;
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}

// Go constant properties
export interface GoConstantProperties {
  name: string;
  type?: string;
  value?: string;
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}

// Go import properties
export interface GoImportProperties {
  path: string;
  alias?: string;
  line_number?: number;
  column_number?: number;
}

// Go type properties
export interface GoTypeProperties {
  name: string;
  underlying_type: string;
  is_exported?: boolean;
  line_number?: number;
  column_number?: number;
}