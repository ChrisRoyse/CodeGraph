/**
 * Attribute Visitor for C# Analyzer
 * 
 * This module provides a visitor for C# attributes (annotations).
 */

import { BaseVisitor } from './base-visitor';
import { 
  AnalysisNode, 
  AnalysisRelationship, 
  CSharpEntityType, 
  CSharpRelationshipType
} from '../models';
import * as utils from '../ast-visitor-utils';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Visitor for C# attributes
 */
export class AttributeVisitor extends BaseVisitor {
  /**
   * Process attributes in the file
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) {
        return [[], []];
      }
      
      await this.processAttributes();
      
      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error in AttributeVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process attribute declarations
   */
  private async processAttributes(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const attributeQuery = `(attribute name: (identifier) @attribute_name)`;
      const query = this.csharpParser.getLanguage().query(attributeQuery);
      const matches = query.matches(this.tree.rootNode);
      
      // Track processed attributes to avoid duplicates
      const processedAttributes = new Set<string>();
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'attribute_name') {
            const node = capture.node;
            const attributeName = node.text;
            
            if (!attributeName) continue;
            
            // Skip if already processed
            if (processedAttributes.has(attributeName)) continue;
            processedAttributes.add(attributeName);
            
            // Generate ID for the attribute
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Attribute,
              attributeName,
              this.namespaceCanonicalId || ''
            );
            
            // Add attribute node
            this.nodes.push({
              type: CSharpEntityType.Attribute,
              name: attributeName,
              path: this.filePath,
              parent_canonical_id: this.namespaceCanonicalId || '',
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: attributeName,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between namespace and attribute
            if (this.namespaceGid) {
              this.relationships.push({
                source_gid: this.namespaceGid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store attribute info for relationship creation
            this.entityMap.set(`attribute:${attributeName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing attributes: ${error}`);
    }
  }

  /**
   * Process attribute usage
   */
  public async processAttributeUsage(): Promise<AnalysisRelationship[]> {
    const relationships: AnalysisRelationship[] = [];
    
    try {
      // Find all nodes with attributes
      const nodesWithAttributes = this.nodes.filter(node => {
        const props = node.properties as any;
        return props && props.attributes && props.attributes.length > 0;
      });
      
      // Process each node with attributes
      for (const node of nodesWithAttributes) {
        if (!node.gid) continue;
        
        const properties = node.properties as any;
        if (!properties.attributes || !Array.isArray(properties.attributes)) continue;
        
        // Create relationships for each attribute
        for (const attributeName of properties.attributes) {
          const attributeEntity = this.entityMap.get(`attribute:${attributeName}`);
          if (attributeEntity) {
            relationships.push({
              source_gid: node.gid,
              target_canonical_id: attributeEntity.canonicalId,
              type: CSharpRelationshipType.ANNOTATED_WITH,
              properties: {}
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing attribute usage: ${error}`);
    }
    
    return relationships;
  }
}