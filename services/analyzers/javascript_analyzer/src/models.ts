/**
 * Shared models for the JavaScript/TypeScript Analyzer
 */

export interface AnalysisNode {
  type: string;
  name: string;
  path: string;
  parent_canonical_id: string;
  canonical_id?: string;
  gid?: string;
  param_types?: string[];
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