/**
 * File Visitor for C# Analyzer
 * 
 * This module provides a visitor for C# files.
 */

import * as path from 'path';
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
 * Visitor for C# files
 */
export class FileVisitor extends BaseVisitor {
  /**
   * Process the file and create file node
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Parse the file
      if (!this.parseFile()) {
        return [[], []];
      }

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const { canonicalId, gid } = await this.idServiceClient.generateIds(
        this.filePath,
        CSharpEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Process namespace declaration
      await this.processNamespace();

      // Add file node
      this.nodes.push({
        type: CSharpEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          extension: path.extname(this.filePath).toLowerCase(),
          namespace_name: this.namespaceName,
          is_test: fileName.endsWith('Test.cs') || fileName.endsWith('Tests.cs')
        }
      });

      // Store file info for relationship creation
      this.entityMap.set(`file:${fileName}`, { canonicalId, gid });

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error in FileVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process namespace declaration
   */
  private async processNamespace(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const namespaceQuery = `(namespace_declaration name: (_) @namespace_name)`;
      const query = this.csharpParser.getLanguage().query(namespaceQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'namespace_name') {
            const node = capture.node;
            const namespaceName = utils.getNamespace(node);
            this.namespaceName = namespaceName || utils.extractNamespace(this.filePath, null);
            
            if (!this.namespaceName) continue;
            
            // Generate ID for the namespace
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Namespace,
              this.namespaceName
            );
            
            this.namespaceCanonicalId = canonicalId;
            this.namespaceGid = gid;
            
            // Add namespace node
            this.nodes.push({
              type: CSharpEntityType.Namespace,
              name: this.namespaceName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: this.namespaceName
              }
            });
            
            // Add relationship between file and namespace
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.CONTAINS,
              properties: {}
            });
            
            // Store namespace info for relationship creation
            this.entityMap.set(`namespace:${this.namespaceName}`, { canonicalId, gid });
            break;
          }
        }
      }
      
      // If no namespace found, try to infer from file path
      if (!this.namespaceName) {
        this.namespaceName = utils.extractNamespace(this.filePath, null);
        
        if (this.namespaceName) {
          // Generate ID for the inferred namespace
          const { canonicalId, gid } = await this.idServiceClient.generateIds(
            this.filePath,
            CSharpEntityType.Namespace,
            this.namespaceName
          );
          
          this.namespaceCanonicalId = canonicalId;
          this.namespaceGid = gid;
          
          // Add namespace node
          this.nodes.push({
            type: CSharpEntityType.Namespace,
            name: this.namespaceName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId || '',
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: this.namespaceName,
              inferred: true
            }
          });
          
          // Add relationship between file and namespace
          if (this.fileGid) {
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.CONTAINS,
              properties: {}
            });
          }
          
          // Store namespace info for relationship creation
          this.entityMap.set(`namespace:${this.namespaceName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing namespace: ${error}`);
    }
  }
}