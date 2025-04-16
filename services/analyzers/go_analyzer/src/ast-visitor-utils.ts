/**
 * AST Visitor Utilities for Go Analyzer
 * 
 * This module provides additional functionality for the Go AST visitor.
 */

import * as path from 'path';
import { 
  AnalysisNode, 
  AnalysisRelationship, 
  GoEntityType, 
  GoRelationshipType
} from './models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Process function calls and create relationships
 * 
 * @param tree Tree-sitter tree
 * @param goParser Tree-sitter parser
 * @param functionCallQuery Query for function calls
 * @param entityMap Map of entities by name
 * @param fileGid GID of the current file
 * @returns Array of relationships
 */
export function processFunctionCalls(
  tree: any,
  goParser: any,
  functionCallQuery: string,
  entityMap: Map<string, { canonicalId: string, gid: string }>,
  fileGid: string
): AnalysisRelationship[] {
  const relationships: AnalysisRelationship[] = [];
  
  try {
    if (!tree) return relationships;
    
    const query = goParser.getLanguage().query(functionCallQuery);
    const matches = query.matches(tree.rootNode);
    
    for (const match of matches) {
      let functionName = '';
      let methodName = '';
      
      for (const capture of match.captures) {
        if (capture.name === 'function_name') {
          functionName = capture.node.text;
        } else if (capture.name === 'method_name') {
          methodName = capture.node.text;
        }
      }
      
      // Process function call
      if (functionName && !methodName) {
        const calledFunction = entityMap.get(`function:${functionName}`);
        if (calledFunction) {
          relationships.push({
            source_gid: fileGid,
            target_canonical_id: calledFunction.canonicalId,
            type: GoRelationshipType.CALLS,
            properties: {}
          });
        }
      }
      
      // Process method call (would need more context to determine the receiver type)
      // This is a simplified approach
      if (methodName) {
        // Try to find any method with this name
        for (const [key, value] of entityMap.entries()) {
          if (key.startsWith('method:') && key.endsWith(`.${methodName}`)) {
            relationships.push({
              source_gid: fileGid,
              target_canonical_id: value.canonicalId,
              type: GoRelationshipType.CALLS,
              properties: {}
            });
            break;
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing function calls: ${error}`);
  }
  
  return relationships;
}

/**
 * Process type uses and create relationships
 * 
 * @param tree Tree-sitter tree
 * @param goParser Tree-sitter parser
 * @param typeUseQuery Query for type uses
 * @param entityMap Map of entities by name
 * @param fileGid GID of the current file
 * @returns Array of relationships
 */
export function processTypeUses(
  tree: any,
  goParser: any,
  typeUseQuery: string,
  entityMap: Map<string, { canonicalId: string, gid: string }>,
  fileGid: string
): AnalysisRelationship[] {
  const relationships: AnalysisRelationship[] = [];
  
  try {
    if (!tree) return relationships;
    
    const query = goParser.getLanguage().query(typeUseQuery);
    const matches = query.matches(tree.rootNode);
    
    // Track processed types to avoid duplicates
    const processedTypes = new Set<string>();
    
    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'type_name') {
          const typeName = capture.node.text.replace(/^\*/, ''); // Remove pointer symbol if present
          
          // Skip if already processed
          if (processedTypes.has(typeName)) continue;
          processedTypes.add(typeName);
          
          // Check for struct
          const struct = entityMap.get(`struct:${typeName}`);
          if (struct) {
            relationships.push({
              source_gid: fileGid,
              target_canonical_id: struct.canonicalId,
              type: GoRelationshipType.USES_TYPE,
              properties: {}
            });
            continue;
          }
          
          // Check for interface
          const iface = entityMap.get(`interface:${typeName}`);
          if (iface) {
            relationships.push({
              source_gid: fileGid,
              target_canonical_id: iface.canonicalId,
              type: GoRelationshipType.USES_TYPE,
              properties: {}
            });
            continue;
          }
          
          // Check for type
          const type = entityMap.get(`type:${typeName}`);
          if (type) {
            relationships.push({
              source_gid: fileGid,
              target_canonical_id: type.canonicalId,
              type: GoRelationshipType.USES_TYPE,
              properties: {}
            });
          }
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing type uses: ${error}`);
  }
  
  return relationships;
}

/**
 * Process struct embedding and create relationships
 * 
 * @param structNodes Array of struct nodes
 * @param entityMap Map of entities by name
 * @returns Array of relationships
 */
export function processStructEmbedding(
  structNodes: AnalysisNode[],
  entityMap: Map<string, { canonicalId: string, gid: string }>
): AnalysisRelationship[] {
  const relationships: AnalysisRelationship[] = [];
  
  try {
    for (const structNode of structNodes) {
      if (structNode.type !== GoEntityType.Struct || !structNode.gid) continue;
      
      const properties = structNode.properties as any;
      if (!properties || !properties.embedded_types || !Array.isArray(properties.embedded_types)) continue;
      
      for (const embeddedType of properties.embedded_types) {
        // Check for embedded struct
        const struct = entityMap.get(`struct:${embeddedType}`);
        if (struct) {
          relationships.push({
            source_gid: structNode.gid,
            target_canonical_id: struct.canonicalId,
            type: GoRelationshipType.EMBEDS,
            properties: {}
          });
          continue;
        }
        
        // Check for embedded interface
        const iface = entityMap.get(`interface:${embeddedType}`);
        if (iface) {
          relationships.push({
            source_gid: structNode.gid,
            target_canonical_id: iface.canonicalId,
            type: GoRelationshipType.IMPLEMENTS,
            properties: {}
          });
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing struct embedding: ${error}`);
  }
  
  return relationships;
}

/**
 * Process interface embedding and create relationships
 * 
 * @param interfaceNodes Array of interface nodes
 * @param entityMap Map of entities by name
 * @returns Array of relationships
 */
export function processInterfaceEmbedding(
  interfaceNodes: AnalysisNode[],
  entityMap: Map<string, { canonicalId: string, gid: string }>
): AnalysisRelationship[] {
  const relationships: AnalysisRelationship[] = [];
  
  try {
    for (const interfaceNode of interfaceNodes) {
      if (interfaceNode.type !== GoEntityType.Interface || !interfaceNode.gid) continue;
      
      const properties = interfaceNode.properties as any;
      if (!properties || !properties.embedded_interfaces || !Array.isArray(properties.embedded_interfaces)) continue;
      
      for (const embeddedInterface of properties.embedded_interfaces) {
        const iface = entityMap.get(`interface:${embeddedInterface}`);
        if (iface) {
          relationships.push({
            source_gid: interfaceNode.gid,
            target_canonical_id: iface.canonicalId,
            type: GoRelationshipType.EXTENDS,
            properties: {}
          });
        }
      }
    }
  } catch (error) {
    logger.error(`Error processing interface embedding: ${error}`);
  }
  
  return relationships;
}

/**
 * Format analysis results into the standard payload format
 * 
 * @param filePath Path to the analyzed file
 * @param nodes Array of analysis nodes
 * @param relationships Array of analysis relationships
 * @returns Analyzer result payload
 */
export function formatAnalysisResults(
  filePath: string,
  nodes: AnalysisNode[],
  relationships: AnalysisRelationship[]
): any {
  // Convert nodes to node stubs
  const nodeStubs = nodes.map(node => ({
    gid: node.gid || '',
    canonical_id: node.canonical_id || '',
    name: node.name,
    file_path: node.path,
    language: 'go',
    labels: [node.type],
    properties: node.properties || {}
  }));
  
  // Convert relationships to relationship stubs
  const relationshipStubs = relationships.map(rel => ({
    source_gid: rel.source_gid,
    target_canonical_id: rel.target_canonical_id,
    type: rel.type,
    properties: rel.properties
  }));
  
  // Create the payload
  return {
    file_path: filePath,
    language: 'go',
    nodes_upserted: nodeStubs,
    relationships_upserted: relationshipStubs,
    nodes_deleted: [],
    relationships_deleted: []
  };
}

/**
 * Extract canonical IDs from a file path
 * 
 * @param filePath Path to the file
 * @returns Object with file and package canonical IDs
 */
export function extractCanonicalIds(filePath: string): { fileCanonicalId: string, packageCanonicalId: string } {
  const fileName = path.basename(filePath);
  const packageName = path.basename(path.dirname(filePath));
  
  const fileCanonicalId = `${filePath}::File::${fileName}`;
  const packageCanonicalId = `${filePath}::Package::${packageName}`;
  
  return { fileCanonicalId, packageCanonicalId };
}