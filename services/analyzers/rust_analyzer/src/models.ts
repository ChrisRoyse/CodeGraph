/**
 * Models for Rust Analyzer
 *
 * This module provides the data models used by the Rust analyzer.
 */

/**
 * Entity types for Rust code elements
 */
export enum RustEntityType {
  File = 'File',
  Module = 'Module',
  Struct = 'Struct',
  Enum = 'Enum',
  EnumVariant = 'EnumVariant',
  Trait = 'Trait',
  Impl = 'Impl',
  Function = 'Function',
  Method = 'Method',
  Macro = 'Macro',
  Use = 'Use',
  Parameter = 'Parameter',
  Field = 'Field',
  Constant = 'Constant',
  TypeAlias = 'TypeAlias'
}

/**
 * Relationship types between Rust code elements
 */
export enum RustRelationshipType {
  CONTAINS = 'CONTAINS',
  IMPORTS = 'IMPORTS',
  IMPLEMENTS = 'IMPLEMENTS',
  CALLS = 'CALLS',
  EXPANDS = 'EXPANDS',
  REFERENCES = 'REFERENCES',
  USES_TYPE = 'USES_TYPE'
}

/**
 * Analysis node representing a Rust code element
 */
export interface AnalysisNode {
  type: RustEntityType;
  name: string;
  path: string;
  parent_canonical_id: string;
  canonical_id: string;
  gid: string;
  properties: {
    [key: string]: any;
  };
}

/**
 * Analysis relationship between Rust code elements
 */
export interface AnalysisRelationship {
  source_gid: string;
  target_canonical_id: string;
  type: RustRelationshipType;
  properties: {
    [key: string]: any;
  };
}