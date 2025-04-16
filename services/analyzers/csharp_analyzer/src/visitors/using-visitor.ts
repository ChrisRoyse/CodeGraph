/**
 * Using Visitor for C# Analyzer
 * 
 * This module provides a visitor for C# using directives.
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
 * Visitor for C# using directives
 */
export class UsingVisitor extends BaseVisitor {
  /**
   * Process using directives in the file
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) {
        return [[], []];
      }
      
      await this.processUsings();
      
      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error in UsingVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process using directives
   */
  private async processUsings(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const usingQuery = `(using_directive name: (_) @using_namespace)`;
      const query = this.csharpParser.getLanguage().query(usingQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'using_namespace') {
            const node = capture.node;
            const namespace = utils.getUsingNamespace(node);
            
            if (!namespace) continue;
            
            // Generate ID for the using directive
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Using,
              namespace
            );
            
            // Add using node
            this.nodes.push({
              type: CSharpEntityType.Using,
              name: namespace,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                namespace: namespace,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between file and using
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.IMPORTS,
              properties: {}
            });
            
            // Store using info for relationship creation
            this.entityMap.set(`using:${namespace}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing using directives: ${error}`);
    }
  }
}