/**
 * Class and Interface Visitor for C# Analyzer
 * 
 * This module provides a visitor for C# classes and interfaces.
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
 * Visitor for C# classes and interfaces
 */
export class ClassInterfaceVisitor extends BaseVisitor {
  /**
   * Process classes and interfaces in the file
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      if (!this.tree || !this.namespaceCanonicalId || !this.fileGid) {
        return [[], []];
      }
      
      await this.processClasses();
      await this.processInterfaces();
      
      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error in ClassInterfaceVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process class declarations
   */
  private async processClasses(): Promise<void> {
    try {
      if (!this.tree || !this.namespaceCanonicalId || !this.fileGid) return;
      
      const classQuery = `(class_declaration name: (identifier) @class_name)`;
      const query = this.csharpParser.getLanguage().query(classQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'class_name') {
            const node = capture.node.parent;
            const className = utils.getClassName(node);
            
            if (!className) continue;
            
            // Generate ID for the class
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Class,
              className,
              this.namespaceCanonicalId
            );
            
            // Check for modifiers
            const isPublic = this.hasModifier(node, 'public');
            const isAbstract = this.hasModifier(node, 'abstract');
            const isStatic = this.hasModifier(node, 'static');
            const isSealed = this.hasModifier(node, 'sealed');
            const isPartial = this.hasModifier(node, 'partial');
            const baseClass = utils.getBaseClass(node);
            const implementedInterfaces = utils.getImplementedInterfaces(node);
            
            // Add class node
            this.nodes.push({
              type: CSharpEntityType.Class,
              name: className,
              path: this.filePath,
              parent_canonical_id: this.namespaceCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: className,
                namespace_name: this.namespaceName,
                is_public: isPublic,
                is_abstract: isAbstract,
                is_static: isStatic,
                is_sealed: isSealed,
                is_partial: isPartial,
                extends_class: baseClass,
                implements_interfaces: implementedInterfaces,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between namespace and class
            if (this.namespaceGid) {
              this.relationships.push({
                source_gid: this.namespaceGid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store class info for relationship creation
            this.entityMap.set(`class:${className}`, { canonicalId, gid });
            
            // If the class extends another class, store that relationship
            if (baseClass) {
              this.relationships.push({
                source_gid: gid,
                target_canonical_id: `${this.filePath}::Class::${baseClass}`,
                type: CSharpRelationshipType.EXTENDS,
                properties: {}
              });
            }
            
            // If the class implements interfaces, store those relationships
            if (implementedInterfaces && implementedInterfaces.length > 0) {
              for (const interfaceName of implementedInterfaces) {
                this.relationships.push({
                  source_gid: gid,
                  target_canonical_id: `${this.filePath}::Interface::${interfaceName}`,
                  type: CSharpRelationshipType.IMPLEMENTS,
                  properties: {}
                });
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing classes: ${error}`);
    }
  }

  /**
   * Process interface declarations
   */
  private async processInterfaces(): Promise<void> {
    try {
      if (!this.tree || !this.namespaceCanonicalId) return;
      
      const interfaceQuery = `(interface_declaration name: (identifier) @interface_name)`;
      const query = this.csharpParser.getLanguage().query(interfaceQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'interface_name') {
            const node = capture.node.parent;
            const interfaceName = utils.getInterfaceName(node);
            
            if (!interfaceName) continue;
            
            // Skip if already processed in processClasses
            if (this.entityMap.has(`interface:${interfaceName}`)) continue;
            
            // Generate ID for the interface
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Interface,
              interfaceName,
              this.namespaceCanonicalId
            );
            
            // Check for modifiers
            const isPublic = this.hasModifier(node, 'public');
            
            // Add interface node
            this.nodes.push({
              type: CSharpEntityType.Interface,
              name: interfaceName,
              path: this.filePath,
              parent_canonical_id: this.namespaceCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: interfaceName,
                namespace_name: this.namespaceName,
                is_public: isPublic,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between namespace and interface
            if (this.namespaceGid) {
              this.relationships.push({
                source_gid: this.namespaceGid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store interface info for relationship creation
            this.entityMap.set(`interface:${interfaceName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing interfaces: ${error}`);
    }
  }
}