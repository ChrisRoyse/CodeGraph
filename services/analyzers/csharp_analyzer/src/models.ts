/**
 * Models for C# Analyzer
 *
 * This module provides the data models used by the C# analyzer.
 */

/**
 * Entity types for C# code elements
 */
export enum CSharpEntityType {
  File = 'File',
  Namespace = 'Namespace',
  Class = 'Class',
  Interface = 'Interface',
  Method = 'Method',
  Property = 'Property',
  Field = 'Field',
  Event = 'Event',
  Attribute = 'Attribute',
  Using = 'Using',
  Parameter = 'Parameter',
  Enum = 'Enum',
  EnumMember = 'EnumMember',
  Struct = 'Struct',
  Delegate = 'Delegate',
  Constructor = 'Constructor'
}

/**
 * Relationship types between C# code elements
 */
export enum CSharpRelationshipType {
  CONTAINS = 'CONTAINS',
  CALLS = 'CALLS',
  IMPORTS = 'IMPORTS',
  IMPLEMENTS = 'IMPLEMENTS',
  EXTENDS = 'EXTENDS',
  ANNOTATED_WITH = 'ANNOTATED_WITH',
  USES_TYPE = 'USES_TYPE',
  DEPENDS_ON = 'DEPENDS_ON',
  RETURNS = 'RETURNS',
  OVERRIDES = 'OVERRIDES',
  REFERENCES = 'REFERENCES'
}

/**
 * Analysis node representing a C# code element
 */
export interface AnalysisNode {
  type: CSharpEntityType;
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
 * Analysis relationship between C# code elements
 */
export interface AnalysisRelationship {
  source_gid: string;
  target_canonical_id: string;
  type: CSharpRelationshipType;
  properties: {
    [key: string]: any;
  };
}

/**
 * Payload for analyzer results
 */
export interface AnalyzerResultPayload {
  nodes: AnalysisNode[];
  relationships: AnalysisRelationship[];
  source: string;
  timestamp: number;
}

/**
 * Message from RabbitMQ
 */
export interface RabbitMQMessage {
  content: any; // Using any instead of Buffer to avoid type issues
  fields: {
    deliveryTag: number;
    redelivered: boolean;
    exchange: string;
    routingKey: string;
  };
  properties: {
    contentType?: string;
    contentEncoding?: string;
    headers?: Record<string, any>;
    deliveryMode?: number;
    priority?: number;
    correlationId?: string;
    replyTo?: string;
    expiration?: string;
    messageId?: string;
    timestamp?: number;
    type?: string;
    userId?: string;
    appId?: string;
    clusterId?: string;
  };
}

/**
 * File change event
 */
export interface FileChangeEvent {
  path: string;
  type: 'added' | 'modified' | 'deleted';
  timestamp: number;
}