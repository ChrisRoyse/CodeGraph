/**
 * Relationship Visitor for C# Analyzer
 * 
 * This module provides a visitor for extracting relationships between C# entities.
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
 * Visitor for C# relationships
 */
export class RelationshipVisitor extends BaseVisitor {
  /**
   * Process relationships in the file
   */
  public async visit(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      if (!this.tree) {
        return [[], []];
      }
      
      await this.processMethodCalls();
      await this.processTypeUsage();
      await this.processDependencyInjection();
      await this.processAttributes();
      
      return [[], this.relationships];
    } catch (error) {
      logger.error(`Error in RelationshipVisitor for ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process method calls
   */
  private async processMethodCalls(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const methodCallQuery = `(invocation_expression 
        function: [
          (member_access_expression name: (identifier) @method_name)
          (identifier) @method_name
        ]
      )`;
      
      const query = this.csharpParser.getLanguage().query(methodCallQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'method_name') {
            const node = capture.node;
            const methodName = node.text;
            
            if (!methodName) continue;
            
            // Find the parent method that contains this call
            let parentNode = node.parent;
            let callerMethodName = '';
            let callerClassName = '';
            
            while (parentNode) {
              if (parentNode.type === 'method_declaration') {
                callerMethodName = utils.getMethodName(parentNode) || '';
                
                // Find the class containing this method
                let classNode = parentNode.parent;
                while (classNode) {
                  if (classNode.type === 'class_declaration') {
                    callerClassName = utils.getClassName(classNode) || '';
                    break;
                  }
                  classNode = classNode.parent;
                }
                
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!callerMethodName || !callerClassName) continue;
            
            // Find the caller method in the entity map
            const callerEntity = this.entityMap.get(`method:${callerClassName}.${callerMethodName}`);
            if (!callerEntity) continue;
            
            // Try to find the target method in the entity map
            // This is a simplification - in a real implementation, we would need to resolve
            // the full method name including class name based on imports and context
            for (const [key, entity] of this.entityMap.entries()) {
              if (key.startsWith('method:') && key.endsWith(`.${methodName}`)) {
                this.relationships.push({
                  source_gid: callerEntity.gid,
                  target_canonical_id: entity.canonicalId,
                  type: CSharpRelationshipType.CALLS,
                  properties: {
                    line_number: this.getLineNumber(node),
                    column_number: this.getColumnNumber(node),
                  }
                });
                
                break;
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing method calls: ${error}`);
    }
  }

  /**
   * Process type usage
   */
  private async processTypeUsage(): Promise<void> {
    try {
      if (!this.tree) return;
      
      // Look for variable declarations with type annotations
      const typeUsageQuery = `(
        (variable_declaration type: (identifier) @type_name)
        (parameter type: (identifier) @type_name)
        (property_declaration type: (identifier) @type_name)
        (field_declaration type: (identifier) @type_name)
        (method_declaration type: (identifier) @type_name)
      )`;
      
      const query = this.csharpParser.getLanguage().query(typeUsageQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'type_name') {
            const node = capture.node;
            const typeName = node.text;
            
            if (!typeName) continue;
            
            // Find the parent entity that uses this type
            let parentNode = node.parent;
            let userEntityType = '';
            let userEntityName = '';
            let userClassName = '';
            
            while (parentNode) {
              if (parentNode.type === 'method_declaration') {
                userEntityType = CSharpEntityType.Method;
                userEntityName = utils.getMethodName(parentNode) || '';
                
                // Find the class containing this method
                let classNode = parentNode.parent;
                while (classNode) {
                  if (classNode.type === 'class_declaration') {
                    userClassName = utils.getClassName(classNode) || '';
                    break;
                  }
                  classNode = classNode.parent;
                }
                
                break;
              } else if (parentNode.type === 'property_declaration') {
                userEntityType = CSharpEntityType.Property;
                userEntityName = utils.getPropertyName(parentNode) || '';
                
                // Find the class containing this property
                let classNode = parentNode.parent;
                while (classNode) {
                  if (classNode.type === 'class_declaration') {
                    userClassName = utils.getClassName(classNode) || '';
                    break;
                  }
                  classNode = classNode.parent;
                }
                
                break;
              } else if (parentNode.type === 'field_declaration') {
                userEntityType = CSharpEntityType.Field;
                // Field name is more complex to extract, we'll skip for now
                break;
              } else if (parentNode.type === 'class_declaration') {
                userEntityType = CSharpEntityType.Class;
                userEntityName = utils.getClassName(parentNode) || '';
                userClassName = userEntityName;
                break;
              }
              
              parentNode = parentNode.parent;
            }
            
            if (!userEntityType || !userEntityName) continue;
            
            // Find the user entity in the entity map
            let userEntityKey = '';
            if (userEntityType === CSharpEntityType.Method || userEntityType === CSharpEntityType.Property) {
              userEntityKey = `${userEntityType.toLowerCase()}:${userClassName}.${userEntityName}`;
            } else {
              userEntityKey = `${userEntityType.toLowerCase()}:${userEntityName}`;
            }
            
            const userEntity = this.entityMap.get(userEntityKey);
            if (!userEntity) continue;
            
            // Try to find the target type in the entity map
            const targetEntity = this.entityMap.get(`class:${typeName}`) || 
                                this.entityMap.get(`interface:${typeName}`);
            
            if (targetEntity) {
              this.relationships.push({
                source_gid: userEntity.gid,
                target_canonical_id: targetEntity.canonicalId,
                type: CSharpRelationshipType.USES_TYPE,
                properties: {
                  line_number: this.getLineNumber(node),
                  column_number: this.getColumnNumber(node),
                }
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing type usage: ${error}`);
    }
  }

  /**
   * Process dependency injection
   */
  private async processDependencyInjection(): Promise<void> {
    try {
      if (!this.tree) return;
      
      // Look for constructor parameters as a simple heuristic for DI
      const diQuery = `(constructor_declaration 
        parameters: (parameter_list 
          (parameter type: (identifier) @injected_type)
        )
      )`;
      
      const query = this.csharpParser.getLanguage().query(diQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'injected_type') {
            const node = capture.node;
            const typeName = node.text;
            
            if (!typeName) continue;
            
            // Find the class that contains this constructor
            let classNode = node.parent;
            let className = '';
            
            while (classNode) {
              if (classNode.type === 'class_declaration') {
                className = utils.getClassName(classNode) || '';
                break;
              }
              classNode = classNode.parent;
            }
            
            if (!className) continue;
            
            // Find the class entity in the entity map
            const classEntity = this.entityMap.get(`class:${className}`);
            if (!classEntity) continue;
            
            // Try to find the injected type in the entity map
            const targetEntity = this.entityMap.get(`class:${typeName}`) || 
                                this.entityMap.get(`interface:${typeName}`);
            
            if (targetEntity) {
              this.relationships.push({
                source_gid: classEntity.gid,
                target_canonical_id: targetEntity.canonicalId,
                type: CSharpRelationshipType.DEPENDS_ON,
                properties: {
                  line_number: this.getLineNumber(node),
                  column_number: this.getColumnNumber(node),
                  via_constructor: true
                }
              });
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing dependency injection: ${error}`);
    }
  }

  /**
   * Process attributes and their relationships
   */
  private async processAttributes(): Promise<void> {
    try {
      if (!this.tree) return;
      
      // Get all nodes with attributes
      const nodesWithAttributes = [];
      
      // Find classes with attributes
      const classQuery = `(class_declaration) @class`;
      const classQueryObj = this.csharpParser.getLanguage().query(classQuery);
      const classMatches = classQueryObj.matches(this.tree.rootNode);
      
      for (const match of classMatches) {
        for (const capture of match.captures) {
          if (capture.name === 'class') {
            const node = capture.node;
            const className = utils.getClassName(node);
            if (!className) continue;
            
            const classEntity = this.entityMap.get(`class:${className}`);
            if (!classEntity) continue;
            
            const attributes = utils.getAttributes(node);
            if (attributes.length > 0) {
              nodesWithAttributes.push({
                node,
                gid: classEntity.gid
              });
            }
          }
        }
      }
      
      // Find methods with attributes
      const methodQuery = `(method_declaration) @method`;
      const methodQueryObj = this.csharpParser.getLanguage().query(methodQuery);
      const methodMatches = methodQueryObj.matches(this.tree.rootNode);
      
      for (const match of methodMatches) {
        for (const capture of match.captures) {
          if (capture.name === 'method') {
            const node = capture.node;
            const methodName = utils.getMethodName(node);
            if (!methodName) continue;
            
            // Find the class containing this method
            let classNode = node.parent;
            let className = '';
            
            while (classNode) {
              if (classNode.type === 'class_declaration') {
                className = utils.getClassName(classNode) || '';
                break;
              }
              classNode = classNode.parent;
            }
            
            if (!className) continue;
            
            const methodEntity = this.entityMap.get(`method:${className}.${methodName}`);
            if (!methodEntity) continue;
            
            const attributes = utils.getAttributes(node);
            if (attributes.length > 0) {
              nodesWithAttributes.push({
                node,
                gid: methodEntity.gid
              });
            }
          }
        }
      }
      
      // Find properties with attributes
      const propertyQuery = `(property_declaration) @property`;
      const propertyQueryObj = this.csharpParser.getLanguage().query(propertyQuery);
      const propertyMatches = propertyQueryObj.matches(this.tree.rootNode);
      
      for (const match of propertyMatches) {
        for (const capture of match.captures) {
          if (capture.name === 'property') {
            const node = capture.node;
            const propertyName = utils.getPropertyName(node);
            if (!propertyName) continue;
            
            // Find the class containing this property
            let classNode = node.parent;
            let className = '';
            
            while (classNode) {
              if (classNode.type === 'class_declaration') {
                className = utils.getClassName(classNode) || '';
                break;
              }
              classNode = classNode.parent;
            }
            
            if (!className) continue;
            
            const propertyEntity = this.entityMap.get(`property:${className}.${propertyName}`);
            if (!propertyEntity) continue;
            
            const attributes = utils.getAttributes(node);
            if (attributes.length > 0) {
              nodesWithAttributes.push({
                node,
                gid: propertyEntity.gid
              });
            }
          }
        }
      }
      
      // Process attribute relationships
      const attributeRelationships = utils.processAttributesRelationships(nodesWithAttributes, this.entityMap);
      this.relationships.push(...attributeRelationships);
      
    } catch (error) {
      logger.error(`Error processing attributes: ${error}`);
    }
    try {
      if (!this.tree) return;
      
      // Look for attribute usage
      const attributeQuery = `(attribute
        name: (identifier) @attribute_name
      )`;
      
      const query = this.csharpParser.getLanguage().query(attributeQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'attribute_name') {
            const node = capture.node;
            const attributeName = node.text;
            
            if (!attributeName) continue;
            
            // Find the parent entity that has this attribute
            let parentNode = node.parent;
            let targetEntityType = '';
            let targetEntityName = '';
            let targetClassName = '';
            
            while (parentNode) {
              if (parentNode.type === 'attribute_list') {
                // Move up to find the decorated entity
                let decoratedNode = parentNode.parent;
                
                if (decoratedNode) {
                  if (decoratedNode.type === 'method_declaration') {
                    targetEntityType = CSharpEntityType.Method;
                    targetEntityName = utils.getMethodName(decoratedNode) || '';
                    
                    // Find the class containing this method
                    let classNode = decoratedNode.parent;
                    while (classNode) {
                      if (classNode.type === 'class_declaration') {
                        targetClassName = utils.getClassName(classNode) || '';
                        break;
                      }
                      classNode = classNode.parent;
                    }
                  } else if (decoratedNode.type === 'property_declaration') {
                    targetEntityType = CSharpEntityType.Property;
                    targetEntityName = utils.getPropertyName(decoratedNode) || '';
                    
                    // Find the class containing this property
                    let classNode = decoratedNode.parent;
                    while (classNode) {
                      if (classNode.type === 'class_declaration') {
                        targetClassName = utils.getClassName(classNode) || '';
                        break;
                      }
                      classNode = classNode.parent;
                    }
                  } else if (decoratedNode.type === 'class_declaration') {
                    targetEntityType = CSharpEntityType.Class;
                    targetEntityName = utils.getClassName(decoratedNode) || '';
                    targetClassName = targetEntityName;
                  } else if (decoratedNode.type === 'interface_declaration') {
                    targetEntityType = CSharpEntityType.Interface;
                    targetEntityName = utils.getInterfaceName(decoratedNode) || '';
                    targetClassName = targetEntityName;
                  }
                }
                
                break;
              }
              
              parentNode = parentNode.parent;
            }
            
            if (!targetEntityType || !targetEntityName) continue;
            
            // Find the target entity in the entity map
            let targetEntityKey = '';
            if (targetEntityType === CSharpEntityType.Method || targetEntityType === CSharpEntityType.Property) {
              targetEntityKey = `${targetEntityType.toLowerCase()}:${targetClassName}.${targetEntityName}`;
            } else {
              targetEntityKey = `${targetEntityType.toLowerCase()}:${targetEntityName}`;
            }
            
            const targetEntity = this.entityMap.get(targetEntityKey);
            if (!targetEntity) continue;
            
            // Try to find the attribute in the entity map or create a canonical ID for it
            const attributeCanonicalId = `Attribute::${attributeName}`;
            
            this.relationships.push({
              source_gid: targetEntity.gid,
              target_canonical_id: attributeCanonicalId,
              type: CSharpRelationshipType.ANNOTATED_WITH,
              properties: {
                line_number: this.getLineNumber(node),
                column_number: this.getColumnNumber(node),
              }
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing attributes: ${error}`);
    }
  }
}