/**
 * ID Logic Module for CodeGraph ID Service
 * 
 * This module contains the core logic for generating and parsing Canonical IDs and GIDs.
 * It implements the specifications from the implementation plan and provides helper functions
 * for path normalization, entity type handling, name sanitization, and parameter formatting.
 */

import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Supported entity types in the system
 */
export enum EntityType {
  FILE = 'File',
  FUNCTION = 'Function',
  CLASS = 'Class',
  METHOD = 'Method',
  PROPERTY = 'Property',
  VARIABLE = 'Variable',
  PARAMETER = 'Parameter',
  MODULE = 'Module',
  NAMESPACE = 'Namespace',
  INTERFACE = 'Interface',
  ENUM = 'Enum',
  TYPE = 'Type',
  TABLE = 'Table',
  COLUMN = 'Column',
  VIEW = 'View',
  COMPONENT = 'Component',
  HOOK = 'Hook',
  ELEMENT = 'Element',
  RULE = 'Rule',
  STRUCT = 'Struct',
  TRAIT = 'Trait',
}

/**
 * Language prefixes for different programming languages
 */
export const LANGUAGE_PREFIXES: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  java: 'java',
  go: 'go',
  rust: 'rs',
  csharp: 'cs',
  cpp: 'cpp',
  sql: 'sql',
  html: 'html',
  css: 'css',
  jsx: 'jsx',
  tsx: 'tsx',
};

/**
 * Default language prefix if none is specified
 */
export const DEFAULT_LANGUAGE_PREFIX = 'js';

/**
 * Interface for ID generation parameters
 */
export interface IdGenerationParams {
  filePath: string;
  entityType: string;
  name: string;
  parentCanonicalId?: string;
  paramTypes?: string[];
  languageHint?: string;
}

/**
 * Interface for parsed ID components
 */
export interface ParsedId {
  filePath: string;
  entityType: string;
  name: string;
  parentCanonicalId?: string;
  paramTypes?: string[];
  canonicalId?: string;
  languagePrefix?: string;
  gid?: string;
}

/**
 * Normalizes a file path to use forward slashes and remove any leading/trailing slashes
 * 
 * @param filePath The file path to normalize
 * @returns The normalized file path
 */
export function normalizePath(filePath: string): string {
  // Convert backslashes to forward slashes
  let normalized = filePath.replace(/\\/g, '/');
  
  // Remove leading and trailing slashes
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  
  // Normalize any double slashes in the middle
  normalized = normalized.replace(/\/+/g, '/');
  
  return normalized;
}

/**
 * Validates and normalizes an entity type
 *
 * @param entityType The entity type to validate
 * @returns The normalized entity type
 * @throws Error if the entity type is invalid
 */
export function validateEntityType(entityType: string): string {
  if (!entityType) {
    throw new Error('Entity type cannot be empty');
  }
  
  // Convert to title case if not already
  const normalizedType = entityType.charAt(0).toUpperCase() + entityType.slice(1).toLowerCase();
  
  // Check if it's a valid entity type
  const validTypes = Object.values(EntityType);
  if (!validTypes.includes(normalizedType as EntityType)) {
    throw new Error(`Invalid entity type: ${entityType}. Must be one of: ${validTypes.join(', ')}`);
  }
  
  return normalizedType;
}

/**
 * Sanitizes a name for use in an ID
 * 
 * @param name The name to sanitize
 * @returns The sanitized name
 */
export function sanitizeName(name: string): string {
  // Replace invalid characters with underscores
  return name.replace(/[^\w\d_$]/g, '_');
}

/**
 * Formats parameter types for inclusion in a canonical ID
 * 
 * @param paramTypes Array of parameter types
 * @returns Formatted parameter string
 */
export function formatParameters(paramTypes: string[] | undefined): string {
  if (!paramTypes || paramTypes.length === 0) {
    return '';
  }
  
  // Join parameter types with commas and wrap in parentheses
  return `(${paramTypes.join(',')})`;
}

/**
 * Determines the language prefix based on file extension or language hint
 * 
 * @param filePath The file path
 * @param languageHint Optional language hint
 * @returns The language prefix
 */
export function determineLanguagePrefix(filePath: string, languageHint?: string): string {
  if (languageHint) {
    const hint = languageHint.toLowerCase();
    if (LANGUAGE_PREFIXES[hint]) {
      return LANGUAGE_PREFIXES[hint];
    }
  }
  
  // Extract extension from file path
  const ext = path.extname(filePath).toLowerCase().substring(1);
  
  // Map common extensions to language prefixes
  switch (ext) {
    case 'js':
      return 'js';
    case 'ts':
    case 'tsx':
      return 'ts';
    case 'py':
      return 'py';
    case 'java':
      return 'java';
    case 'go':
      return 'go';
    case 'rs':
      return 'rs';
    case 'cs':
      return 'cs';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'c++':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'sql':
      return 'sql';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
      return 'css';
    case 'jsx':
      return 'jsx';
    default:
      return DEFAULT_LANGUAGE_PREFIX;
  }
}

/**
 * Generates a canonical ID from the provided parameters
 * 
 * @param params The ID generation parameters
 * @returns The canonical ID
 */
export function generateCanonicalId(params: IdGenerationParams): string {
  const { filePath, entityType, name, parentCanonicalId, paramTypes } = params;
  
  // Normalize inputs
  const normalizedPath = normalizePath(filePath);
  const normalizedType = validateEntityType(entityType);
  const sanitizedName = sanitizeName(name);
  const formattedParams = formatParameters(paramTypes);
  
  // Build the canonical ID
  let canonicalId = `${normalizedPath}::${normalizedType}::${sanitizedName}`;
  
  // Add parameters if present
  if (formattedParams) {
    canonicalId += formattedParams;
  }
  
  // Add parent context if present
  if (parentCanonicalId) {
    canonicalId = `${parentCanonicalId}::${normalizedType}::${sanitizedName}`;
    
    // Add parameters if present
    if (formattedParams) {
      canonicalId += formattedParams;
    }
  }
  
  return canonicalId;
}

/**
 * Generates a GID (Global ID) from a canonical ID and language hint
 * 
 * @param canonicalId The canonical ID
 * @param filePath The file path (for determining language)
 * @param languageHint Optional language hint
 * @returns The GID
 */
export function generateGid(canonicalId: string, filePath: string, languageHint?: string): string {
  // Determine language prefix
  const langPrefix = determineLanguagePrefix(filePath, languageHint);
  
  // Generate hash of canonical ID
  const hash = crypto.createHash('sha256').update(canonicalId).digest('hex').substring(0, 16);
  
  // Combine prefix and hash
  return `${langPrefix}_${hash}`;
}

/**
 * Generates both canonical ID and GID for an entity
 * 
 * @param params The ID generation parameters
 * @returns Object containing the canonical ID and GID
 */
export function generateId(params: IdGenerationParams): { canonicalId: string; gid: string } {
  // Validate required parameters
  if (!params.filePath) {
    throw new Error('File path is required');
  }
  if (!params.entityType) {
    throw new Error('Entity type is required');
  }
  if (!params.name) {
    throw new Error('Name is required');
  }
  
  // Generate canonical ID
  const canonicalId = generateCanonicalId(params);
  
  // Generate GID
  const gid = generateGid(canonicalId, params.filePath, params.languageHint);
  
  return { canonicalId, gid };
}

/**
 * Parses a canonical ID into its component parts
 *
 * @param canonicalId The canonical ID to parse
 * @returns The parsed components
 */
export function parseCanonicalId(canonicalId: string): ParsedId {
  if (!canonicalId) {
    throw new Error('Canonical ID is required');
  }
  
  // Split by :: delimiter
  const parts = canonicalId.split('::');
  
  if (parts.length < 3) {
    throw new Error(`Invalid canonical ID format: ${canonicalId}. Expected at least 3 parts separated by '::'`);
  }
  
  // Extract components
  let filePath: string;
  let entityType: string;
  let name: string;
  let parentCanonicalId: string | undefined;
  let paramTypes: string[] | undefined;
  
  // Handle different cases based on number of parts
  if (parts.length === 3) {
    // Simple case: filePath::entityType::name
    [filePath, entityType, name] = parts;
    
    // Check if name contains parameters
    const paramMatch = name.match(/^([^(]+)(\(.*\))$/);
    if (paramMatch) {
      name = paramMatch[1];
      const paramString = paramMatch[2].substring(1, paramMatch[2].length - 1);
      paramTypes = paramString ? paramString.split(',') : [];
    }
  } else {
    // Complex case with parent context: parent::entityType::name
    // or with parameters: filePath::entityType::name(param1,param2)
    
    // Check if the last part contains parameters
    const lastPart = parts[parts.length - 1];
    const paramMatch = lastPart.match(/^([^(]+)(\(.*\))$/);
    
    if (paramMatch) {
      // Has parameters
      name = paramMatch[1];
      const paramString = paramMatch[2].substring(1, paramMatch[2].length - 1);
      paramTypes = paramString ? paramString.split(',') : [];
      
      entityType = parts[parts.length - 2];
      
      // Reconstruct parent canonical ID if present
      if (parts.length > 3) {
        parentCanonicalId = parts.slice(0, parts.length - 2).join('::');
        filePath = parts[0]; // First part is always the file path
      } else {
        filePath = parts[0];
      }
    } else {
      // Has parent context but no parameters
      name = parts[parts.length - 1];
      entityType = parts[parts.length - 2];
      
      // Reconstruct parent canonical ID
      parentCanonicalId = parts.slice(0, parts.length - 2).join('::');
      filePath = parts[0]; // First part is always the file path
    }
  }
  
  return {
    filePath,
    entityType,
    name,
    parentCanonicalId,
    paramTypes,
    canonicalId
  };
}

/**
 * Parses a GID into its components
 * 
 * @param gid The GID to parse
 * @returns The parsed components or null if invalid format
 */
export function parseGid(gid: string): { languagePrefix: string; hash: string } | null {
  // Check if the GID has the expected format
  const match = gid.match(/^([a-z]+)_([0-9a-f]+)$/);
  
  if (!match) {
    return null;
  }
  
  return {
    languagePrefix: match[1],
    hash: match[2]
  };
}

/**
 * Parses an ID string (either canonical ID or GID)
 * 
 * @param idString The ID string to parse
 * @returns The parsed components
 */
export function parseId(idString: string): ParsedId {
  if (!idString) {
    throw new Error('ID string is required');
  }
  
  // Check if this is a GID (has a language prefix and underscore)
  const gidComponents = parseGid(idString);
  
  if (gidComponents) {
    // This is a GID, but we can't fully parse it without the original canonical ID
    // Return partial information
    return {
      filePath: '',
      entityType: '',
      name: '',
      languagePrefix: gidComponents.languagePrefix,
      gid: idString
    };
  } else {
    // Assume it's a canonical ID
    try {
      const parsedCanonical = parseCanonicalId(idString);
      
      // Generate the corresponding GID
      const gid = generateGid(idString, parsedCanonical.filePath);
      
      return {
        ...parsedCanonical,
        gid
      };
    } catch (error) {
      throw new Error(`Failed to parse ID string: ${idString}. Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}