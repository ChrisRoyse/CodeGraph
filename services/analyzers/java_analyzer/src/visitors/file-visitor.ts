/**
 * File Visitor for Java Analyzer
 * 
 * This module provides the visitor for file entities in Java code.
 */

import { BaseVisitor } from './base-visitor';
import { JavaEntityType, JavaRelationshipType } from '../models';
import { SyntaxNode, findNodesOfType } from '../ast-visitor-utils';

/**
 * Visitor for file entities in Java code
 */
export class FileVisitor extends BaseVisitor {
  /**
   * Visit the root node of a Java file
   * 
   * @param rootNode The root node of the Java file
   */
  public async visit(rootNode: SyntaxNode): Promise<void> {
    try {
      await this.processFile(rootNode);
      await this.processPackage(rootNode);
    } catch (error) {
      this.logError('Error in FileVisitor', error);
    }
  }

  /**
   * Process a Java file
   * 
   * @param rootNode The root node of the Java file
   */
  private async processFile(rootNode: SyntaxNode): Promise<void> {
    try {
      const fileName = this.filePath.split('/').pop() || '';
      
      // Determine if this is a test file
      const isTestFile = fileName.includes('Test') || 
                         fileName.includes('test') || 
                         this.filePath.includes('/test/') || 
                         this.filePath.includes('/tests/');
      
      // Generate file ID
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        fileName,
        '',
        [],
        'java'
      );
      
      // Add file node
      this.addNode({
        type: JavaEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid,
        properties: {
          package_name: this.packageName,
          is_test: isTestFile,
          language: 'java'
        }
      });
    } catch (error) {
      this.logError('Error processing file', error);
    }
  }

  /**
   * Process a package declaration
   * 
   * @param rootNode The root node of the Java file
   */
  private async processPackage(rootNode: SyntaxNode): Promise<void> {
    try {
      // Find package declaration
      const packageNodes = findNodesOfType(rootNode, 'package_declaration');
      
      if (packageNodes.length === 0) {
        // Default package
        this.packageName = '';
        return;
      }
      
      const packageNode = packageNodes[0];
      
      // Find the name node (qualified identifier)
      const nameNode = packageNode.children.find((child: SyntaxNode) => 
        child.type === 'scoped_identifier' || 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const packageName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.packageName = packageName;
      
      // Generate file ID
      const [fileCanonicalId, fileGid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      // Generate package ID
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        '',
        JavaEntityType.Package,
        packageName,
        '',
        [],
        'java'
      );
      
      // Add package node
      this.addNode({
        type: JavaEntityType.Package,
        name: packageName,
        path: '',
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid,
        properties: {
          line_number: packageNode.startPosition.row + 1,
          column_number: packageNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and package
      this.addRelationship({
        source_gid: fileGid,
        target_canonical_id: canonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process package hierarchy
      await this.processPackageHierarchy(packageName, canonicalId);
    } catch (error) {
      this.logError('Error processing package', error);
    }
  }

  /**
   * Process package hierarchy
   * 
   * @param packageName The full package name
   * @param leafPackageCanonicalId The canonical ID of the leaf package
   */
  private async processPackageHierarchy(packageName: string, leafPackageCanonicalId: string): Promise<void> {
    try {
      const parts = packageName.split('.');
      
      if (parts.length <= 1) {
        // No hierarchy to process
        return;
      }
      
      let currentPackage = '';
      let parentCanonicalId = '';
      
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        
        if (currentPackage) {
          currentPackage += '.' + part;
        } else {
          currentPackage = part;
        }
        
        // Generate package ID
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          '',
          JavaEntityType.Package,
          currentPackage,
          '',
          [],
          'java'
        );
        
        // Add package node
        this.addNode({
          type: JavaEntityType.Package,
          name: currentPackage,
          path: '',
          parent_canonical_id: parentCanonicalId,
          canonical_id: canonicalId,
          gid,
          properties: {}
        });
        
        // If we have a parent, add relationship
        if (parentCanonicalId) {
          this.addRelationship({
            source_gid: gid,
            target_canonical_id: parentCanonicalId,
            type: JavaRelationshipType.BELONGS_TO,
            properties: {}
          });
        }
        
        parentCanonicalId = canonicalId;
      }
      
      // Add relationship between leaf package and its parent
      if (parentCanonicalId) {
        // Get the leaf package's GID
        const [_, leafPackageGid] = await this.idServiceClient.generateId(
          '',
          JavaEntityType.Package,
          packageName,
          '',
          [],
          'java'
        );
        
        this.addRelationship({
          source_gid: leafPackageGid,
          target_canonical_id: parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      this.logError('Error processing package hierarchy', error);
    }
  }
}