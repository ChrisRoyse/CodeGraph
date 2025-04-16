/**
 * Member Visitor for C# Analyzer
 * 
 * This module provides a visitor for C# class and interface members
 * (methods, properties, fields, events).
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
 * Visitor for C# class and interface members
 */
export class MemberVisitor extends BaseVisitor {
  /**
   * Process members in the file
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      if (!this.tree) {
        return [[], []];
      }
      
      await this.processMethods();
      await this.processProperties();
      await this.processFields();
      await this.processEvents();
      
      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error in MemberVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process method declarations
   */
  private async processMethods(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const methodQuery = `(method_declaration name: (identifier) @method_name)`;
      const query = this.csharpParser.getLanguage().query(methodQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'method_name') {
            const node = capture.node.parent;
            const methodName = utils.getMethodName(node);
            
            if (!methodName) continue;
            
            // Find the parent class or interface
            let parentNode = node.parent;
            let parentType = '';
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentType = CSharpEntityType.Class;
                parentName = utils.getClassName(parentNode) || '';
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              } else if (parentNode.type === 'interface_declaration') {
                parentType = CSharpEntityType.Interface;
                parentName = utils.getInterfaceName(parentNode) || '';
                const parentEntity = this.entityMap.get(`interface:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!parentCanonicalId) {
              // If no parent found, use namespace as parent
              parentCanonicalId = this.namespaceCanonicalId || '';
            }
            
            // Get method details
            const returnType = utils.getReturnType(node);
            const parameters = utils.getMethodParameters(node);
            const isPublic = this.hasModifier(node, 'public');
            const isStatic = this.hasModifier(node, 'static');
            const isAbstract = this.hasModifier(node, 'abstract');
            const isVirtual = this.hasModifier(node, 'virtual');
            const isOverride = this.hasModifier(node, 'override');
            const isAsync = this.hasModifier(node, 'async');
            const attributes = utils.extractAttributes(node);
            
            // Generate ID for the method
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Method,
              methodName,
              parentCanonicalId,
              parameters.map(p => p.type)
            );
            
            // Add method node
            this.nodes.push({
              type: CSharpEntityType.Method,
              name: methodName,
              path: this.filePath,
              parent_canonical_id: parentCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: methodName,
                return_type: returnType,
                parameters: parameters.map(p => p.name),
                parameter_types: parameters.map(p => p.type),
                is_public: isPublic,
                is_static: isStatic,
                is_abstract: isAbstract,
                is_virtual: isVirtual,
                is_override: isOverride,
                is_async: isAsync,
                attributes: attributes,
                parent_type: parentType,
                parent_name: parentName,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and method
            const parentEntity = this.entityMap.get(`${parentType.toLowerCase()}:${parentName}`);
            if (parentEntity) {
              this.relationships.push({
                source_gid: parentEntity.gid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store method info for relationship creation
            this.entityMap.set(`method:${parentName}.${methodName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing methods: ${error}`);
    }
  }

  /**
   * Process property declarations
   */
  private async processProperties(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const propertyQuery = `(property_declaration name: (identifier) @property_name)`;
      const query = this.csharpParser.getLanguage().query(propertyQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'property_name') {
            const node = capture.node.parent;
            const propertyName = utils.getPropertyName(node);
            
            if (!propertyName) continue;
            
            // Find the parent class or interface
            let parentNode = node.parent;
            let parentType = '';
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentType = CSharpEntityType.Class;
                parentName = utils.getClassName(parentNode) || '';
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              } else if (parentNode.type === 'interface_declaration') {
                parentType = CSharpEntityType.Interface;
                parentName = utils.getInterfaceName(parentNode) || '';
                const parentEntity = this.entityMap.get(`interface:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!parentCanonicalId) {
              // If no parent found, use namespace as parent
              parentCanonicalId = this.namespaceCanonicalId || '';
            }
            
            // Get property details
            const propertyType = utils.getPropertyType(node);
            const isPublic = this.hasModifier(node, 'public');
            const isStatic = this.hasModifier(node, 'static');
            const isVirtual = this.hasModifier(node, 'virtual');
            const isOverride = this.hasModifier(node, 'override');
            const attributes = utils.extractAttributes(node);
            
            // Generate ID for the property
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Property,
              propertyName,
              parentCanonicalId
            );
            
            // Add property node
            this.nodes.push({
              type: CSharpEntityType.Property,
              name: propertyName,
              path: this.filePath,
              parent_canonical_id: parentCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: propertyName,
                type: propertyType,
                is_public: isPublic,
                is_static: isStatic,
                is_virtual: isVirtual,
                is_override: isOverride,
                attributes: attributes,
                parent_type: parentType,
                parent_name: parentName,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and property
            const parentEntity = this.entityMap.get(`${parentType.toLowerCase()}:${parentName}`);
            if (parentEntity) {
              this.relationships.push({
                source_gid: parentEntity.gid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store property info for relationship creation
            this.entityMap.set(`property:${parentName}.${propertyName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing properties: ${error}`);
    }
  }

  /**
   * Process field declarations
   */
  private async processFields(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const fieldQuery = `(field_declaration declarator: (variable_declarator name: (identifier) @field_name))`;
      const query = this.csharpParser.getLanguage().query(fieldQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'field_name') {
            const node = capture.node;
            const fieldDeclaration = node.parent.parent;
            const fieldName = node.text;
            
            if (!fieldName) continue;
            
            // Find the parent class
            let parentNode = fieldDeclaration.parent;
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentName = utils.getClassName(parentNode) || '';
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!parentCanonicalId) {
              // If no parent found, use namespace as parent
              parentCanonicalId = this.namespaceCanonicalId || '';
            }
            
            // Get field details
            const isPublic = this.hasModifier(fieldDeclaration, 'public');
            const isStatic = this.hasModifier(fieldDeclaration, 'static');
            const isReadonly = this.hasModifier(fieldDeclaration, 'readonly');
            const isConst = this.hasModifier(fieldDeclaration, 'const');
            const attributes = utils.extractAttributes(fieldDeclaration);
            
            // Generate ID for the field
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Field,
              fieldName,
              parentCanonicalId
            );
            
            // Add field node
            this.nodes.push({
              type: CSharpEntityType.Field,
              name: fieldName,
              path: this.filePath,
              parent_canonical_id: parentCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: fieldName,
                is_public: isPublic,
                is_static: isStatic,
                is_readonly: isReadonly,
                is_const: isConst,
                attributes: attributes,
                parent_name: parentName,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and field
            const parentEntity = this.entityMap.get(`class:${parentName}`);
            if (parentEntity) {
              this.relationships.push({
                source_gid: parentEntity.gid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store field info for relationship creation
            this.entityMap.set(`field:${parentName}.${fieldName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing fields: ${error}`);
    }
  }

  /**
   * Process event declarations
   */
  private async processEvents(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const eventQuery = `(event_field_declaration name: (identifier) @event_name)`;
      const query = this.csharpParser.getLanguage().query(eventQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'event_name') {
            const node = capture.node;
            const eventDeclaration = node.parent;
            const eventName = node.text;
            
            if (!eventName) continue;
            
            // Find the parent class
            let parentNode = eventDeclaration.parent;
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentName = utils.getClassName(parentNode) || '';
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!parentCanonicalId) {
              // If no parent found, use namespace as parent
              parentCanonicalId = this.namespaceCanonicalId || '';
            }
            
            // Get event details
            const isPublic = this.hasModifier(eventDeclaration, 'public');
            const isStatic = this.hasModifier(eventDeclaration, 'static');
            const attributes = utils.extractAttributes(eventDeclaration);
            
            // Generate ID for the event
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Event,
              eventName,
              parentCanonicalId
            );
            
            // Add event node
            this.nodes.push({
              type: CSharpEntityType.Event,
              name: eventName,
              path: this.filePath,
              parent_canonical_id: parentCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: eventName,
                is_public: isPublic,
                is_static: isStatic,
                attributes: attributes,
                parent_name: parentName,
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and event
            const parentEntity = this.entityMap.get(`class:${parentName}`);
            if (parentEntity) {
              this.relationships.push({
                source_gid: parentEntity.gid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store event info for relationship creation
            this.entityMap.set(`event:${parentName}.${eventName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing events: ${error}`);
    }
  }
}