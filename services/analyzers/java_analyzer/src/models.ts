/**
 * Data models for Java Analyzer
 * 
 * This module defines the data structures and types used by the Java Analyzer.
 */

/**
 * Java entity types
 */
export enum JavaEntityType {
  File = 'File',
  Package = 'Package',
  Import = 'Import',
  Class = 'Class',
  Interface = 'Interface',
  Enum = 'Enum',
  Annotation = 'Annotation',
  Method = 'Method',
  Constructor = 'Constructor',
  Field = 'Field',
  Parameter = 'Parameter',
  LocalVariable = 'LocalVariable',
  EnumConstant = 'EnumConstant',
  AnnotationMember = 'AnnotationMember'
}

/**
 * Java relationship types
 */
export enum JavaRelationshipType {
  CONTAINS = 'CONTAINS',
  IMPORTS = 'IMPORTS',
  EXTENDS = 'EXTENDS',
  IMPLEMENTS = 'IMPLEMENTS',
  CALLS = 'CALLS',
  USES_TYPE = 'USES_TYPE',
  DEPENDS_ON = 'DEPENDS_ON',
  ANNOTATED_WITH = 'ANNOTATED_WITH',
  THROWS = 'THROWS',
  OVERRIDES = 'OVERRIDES',
  BELONGS_TO = 'BELONGS_TO'
}

/**
 * Hint relationship types
 */
export enum HintType {
  CALL_TARGET = 'call-target',
  IMPORTS = 'imports',
  USES_TYPE = 'uses-type'
}

/**
 * Properties for Java entities
 */
export interface JavaEntityProperties {
  [key: string]: any;
  name?: string;
  package_name?: string;
  is_public?: boolean;
  is_protected?: boolean;
  is_private?: boolean;
  is_static?: boolean;
  is_final?: boolean;
  is_abstract?: boolean;
  is_interface?: boolean;
  is_enum?: boolean;
  is_annotation?: boolean;
  extends_class?: string;
  implements_interfaces?: string[];
  return_type?: string;
  parameters?: string[];
  parameter_types?: string[];
  type?: string;
  is_constructor?: boolean;
  annotations?: string[];
  line_number?: number;
  column_number?: number;
  inferred?: boolean;
  extension?: string;
  is_test?: boolean;
}

/**
 * Properties for Java relationships
 */
export interface JavaRelationshipProperties {
  [key: string]: any;
}

/**
 * Analysis node representing a Java entity
 */
export interface AnalysisNode {
  type: JavaEntityType;
  name: string;
  path: string;
  parent_canonical_id: string;
  canonical_id: string;
  gid: string;
  properties: JavaEntityProperties;
}

/**
 * Analysis relationship between Java entities
 */
export interface AnalysisRelationship {
  source_gid: string;
  target_canonical_id: string;
  type: JavaRelationshipType;
  properties: JavaRelationshipProperties;
}

/**
 * Parsed hint comment
 */
export interface HintComment {
  type: HintType;
  target: string;
}

/**
 * Analysis relationship stub derived from a hint comment
 */
export interface AnalysisRelationshipStub {
  source_gid: string;
  target_canonical_id: string;
  type: JavaRelationshipType;
  properties: JavaRelationshipProperties;
}

/**
 * Analysis result format
 */
export interface AnalysisResult {
  file_path: string;
  language: string;
  nodes_upserted: AnalysisNode[];
  relationships_upserted: AnalysisRelationship[];
  nodes_deleted?: string[];
  relationships_deleted?: string[];
  error?: string;
}