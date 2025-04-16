/**
 * Import Visitor for Java Analyzer
 * 
 * This module provides the visitor for import statements in Java code.
 */

import { BaseVisitor } from './base-visitor';
import { JavaEntityType, JavaRelationshipType } from '../models';
import { SyntaxNode, findNodesOfType } from '../ast-visitor-utils';

/**
 * Visitor for import statements in Java code
 */
export class ImportVisitor extends BaseVisitor {
  /**
   * Visit the root node of a Java file
   * 
   * @param rootNode The root node of the Java file
   */
  public async visit(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process imports
      const importNodes = findNodesOfType(rootNode, 'import_declaration');
      for (const importNode of importNodes) {
        await this.processImport(importNode);
      }
    } catch (error) {
      this.logError('Error in ImportVisitor', error);
    }
  }

  /**
   * Process an import declaration
   * 
   * @param importNode The import declaration node
   */
  private async processImport(importNode: SyntaxNode): Promise<void> {
    try {
      // Find the name node (qualified identifier)
      const nameNode = importNode.children.find((child: SyntaxNode) => 
        child.type === 'scoped_identifier' || 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const importPath = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      
      // Check if it's a static import
      const isStatic = importNode.children.some((child: SyntaxNode) => 
        child.type === 'static' || 
        (child.type === 'identifier' && 
         this.sourceCode.substring(child.startIndex, child.endIndex).trim() === 'static')
      );
      
      // Check if it's a wildcard import
      const isWildcard = importPath.endsWith('.*');
      
      // Get the imported type or package
      let importedType = importPath;
      let importedPackage = '';
      
      if (isWildcard) {
        // For wildcard imports, we just have a package
        importedPackage = importPath.substring(0, importPath.length - 2);
        importedType = '';
      } else {
        // For specific imports, we have both package and type
        const lastDotIndex = importPath.lastIndexOf('.');
        if (lastDotIndex > 0) {
          importedPackage = importPath.substring(0, lastDotIndex);
          importedType = importPath.substring(lastDotIndex + 1);
        } else {
          // Default package
          importedPackage = '';
          importedType = importPath;
        }
      }
      
      // Get the file canonical ID
      const [fileCanonicalId, fileGid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      // Add import node
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Import,
        importPath,
        fileCanonicalId,
        [],
        'java'
      );
      
      this.addNode({
        type: JavaEntityType.Import,
        name: importPath,
        path: this.filePath,
        parent_canonical_id: fileCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          is_static: isStatic,
          is_wildcard: isWildcard,
          imported_type: importedType,
          imported_package: importedPackage,
          line_number: importNode.startPosition.row + 1,
          column_number: importNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and import
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Add relationship between import and imported type (if not wildcard)
      if (!isWildcard && importedType) {
        // Determine the entity type of the imported item
        // This is a best guess since we don't have full type information
        let entityType = JavaEntityType.Class;
        
        // Some heuristics to guess the entity type
        if (importedType.startsWith('I') && importedType.length > 1 && 
            importedType.charAt(1) === importedType.charAt(1).toUpperCase()) {
          // Interface naming convention (e.g., IMyInterface)
          entityType = JavaEntityType.Interface;
        } else if (importedType.endsWith('Exception') || importedType.endsWith('Error')) {
          // Exception classes
          entityType = JavaEntityType.Class;
        } else if (importedType.endsWith('Enum')) {
          // Enum naming convention
          entityType = JavaEntityType.Enum;
        } else if (importedType.endsWith('Annotation')) {
          // Annotation naming convention
          entityType = JavaEntityType.Annotation;
        }
        
        // Generate ID for the imported type
        const [targetCanonicalId] = await this.idServiceClient.generateId(
          '',
          entityType,
          importedType,
          '',
          [],
          'java'
        );
        
        // Add IMPORTS relationship
        this.addRelationship({
          source_gid: fileGid,
          target_canonical_id: targetCanonicalId,
          type: JavaRelationshipType.IMPORTS,
          properties: {
            import_path: importPath,
            is_static: isStatic
          }
        });
      }
    } catch (error) {
      this.logError('Error processing import', error);
    }
  }
}