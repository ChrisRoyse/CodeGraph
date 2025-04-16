/**
 * Shared models for the HTML/CSS Analyzer
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

// HTML/CSS-specific entity types
export enum HtmlEntityType {
  File = 'File',
  Element = 'Element',
  Attribute = 'Attribute',
  Script = 'Script',
  Style = 'Style'
}

export enum CssEntityType {
  File = 'File',
  Rule = 'Rule',
  Selector = 'Selector',
  Property = 'Property'
}

// HTML/CSS-specific relationship types
export enum HtmlRelationshipType {
  CONTAINS = ':CONTAINS',
  REFERENCES = ':REFERENCES',
  INCLUDES = ':INCLUDES',
  HAS_ATTRIBUTE = ':HAS_ATTRIBUTE'
}

export enum CssRelationshipType {
  STYLES = ':STYLES',
  CONTAINS = ':CONTAINS',
  DEFINES = ':DEFINES'
}

// HTML element properties
export interface HtmlElementProperties {
  tag_name: string;
  id?: string;
  class_list?: string[];
  line_number?: number;
  column_number?: number;
}

// HTML attribute properties
export interface HtmlAttributeProperties {
  name: string;
  value?: string;
}

// CSS rule properties
export interface CssRuleProperties {
  selector_text: string;
  specificity?: number;
  line_number?: number;
  column_number?: number;
}

// CSS property properties
export interface CssPropertyProperties {
  name: string;
  value: string;
  important?: boolean;
}