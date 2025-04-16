/**
 * Member Visitor for Java Analyzer
 * 
 * This module provides the visitor for method, constructor, and field entities in Java code.
 */

import { BaseVisitor } from './base-visitor';
import { JavaEntityType, JavaRelationshipType } from '../models';
import { 
  SyntaxNode, 
  findNodesOfType, 
  hasModifier, 
  getAnnotations, 
  isTest,
  getReturnType,
  getParameterTypes,
  getParameterNames
} from '../ast-visitor-utils';

/**
 * Visitor for method, constructor, and field entities in Java code
 */
export class MemberVisitor extends BaseVisitor {
  private currentClass: string = '';
  private currentMethod: string = '';
  private parentType: JavaEntityType = JavaEntityType.Class;
  private parentCanonicalId: string = '';

  /**
   * Initialize the member visitor
   * 
   * @param filePath Path to the Java file
   * @param sourceCode Source code content
   * @param packageName Package name
   * @param idServiceClient ID Service client
   * @param nodes Nodes array to populate
   * @param relationships Relationships array to populate
   * @param parentType Type of the parent entity
   * @param parentName Name of the parent entity
   * @param parentCanonicalId Canonical ID of the parent entity
   */
  constructor(
    filePath: string,
    sourceCode: string,
    packageName: string,
    idServiceClient: any,
    nodes: any[],
    relationships: any[],
    parentType: JavaEntityType,
    parentName: string,
    parentCanonicalId: string
  ) {
    super(filePath, sourceCode, packageName, idServiceClient, nodes, relationships);
    this.parentType = parentType;
    this.currentClass = parentName;
    this.parentCanonicalId = parentCanonicalId;
  }

  /**
   * Visit the body node of a class, interface, enum, or annotation
   * 
   * @param bodyNode The body node of the parent entity
   */
  public async visit(bodyNode: SyntaxNode): Promise<void> {
    try {
      if (!bodyNode) return;
      
      // Process methods
      const methodNodes = findNodesOfType(bodyNode, 'method_declaration');
      for (const methodNode of methodNodes) {
        await this.processMethod(methodNode);
      }
      
      // Process constructors (only for classes and enums)
      if (this.parentType === JavaEntityType.Class || this.parentType === JavaEntityType.Enum) {
        const constructorNodes = findNodesOfType(bodyNode, 'constructor_declaration');
        for (const constructorNode of constructorNodes) {
          await this.processConstructor(constructorNode);
        }
      }
      
      // Process fields
      const fieldNodes = findNodesOfType(bodyNode, 'field_declaration');
      for (const fieldNode of fieldNodes) {
        await this.processField(fieldNode);
      }
    } catch (error) {
      this.logError('Error in MemberVisitor', error);
    }
  }

  /**
   * Process a method declaration
   * 
   * @param methodNode The method node
   */
  private async processMethod(methodNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = methodNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const methodName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentMethod = methodName;
      
      const returnType = getReturnType(methodNode, this.sourceCode);
      const parameterTypes = getParameterTypes(methodNode, this.sourceCode);
      const parameterNames = getParameterNames(methodNode, this.sourceCode);
      
      const isPublic = hasModifier(methodNode, 'public', this.sourceCode);
      const isPrivate = hasModifier(methodNode, 'private', this.sourceCode);
      const isProtected = hasModifier(methodNode, 'protected', this.sourceCode);
      const isStatic = hasModifier(methodNode, 'static', this.sourceCode);
      const isFinal = hasModifier(methodNode, 'final', this.sourceCode);
      const isAbstract = hasModifier(methodNode, 'abstract', this.sourceCode) || 
                         this.parentType === JavaEntityType.Interface;
      
      const annotations = getAnnotations(methodNode, this.sourceCode);
      const isTestMethod = isTest(methodNode, this.sourceCode);
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Method,
        methodName,
        this.parentCanonicalId,
        parameterTypes,
        'java'
      );
      
      // Add method node
      this.addNode({
        type: JavaEntityType.Method,
        name: methodName,
        path: this.filePath,
        parent_canonical_id: this.parentCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          return_type: returnType,
          parameter_types: parameterTypes,
          parameter_names: parameterNames,
          is_public: isPublic,
          is_private: isPrivate,
          is_protected: isProtected,
          is_static: isStatic,
          is_final: isFinal,
          is_abstract: isAbstract,
          annotations,
          is_test: isTestMethod,
          line_number: methodNode.startPosition.row + 1,
          column_number: methodNode.startPosition.column + 1
        }
      });
      
      // Add relationship between class/interface and method
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: this.parentCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing method', error);
    }
  }

  /**
   * Process a constructor declaration
   * 
   * @param constructorNode The constructor node
   */
  private async processConstructor(constructorNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = constructorNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const constructorName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentMethod = constructorName;
      
      const parameterTypes = getParameterTypes(constructorNode, this.sourceCode);
      const parameterNames = getParameterNames(constructorNode, this.sourceCode);
      
      const isPublic = hasModifier(constructorNode, 'public', this.sourceCode);
      const isPrivate = hasModifier(constructorNode, 'private', this.sourceCode);
      const isProtected = hasModifier(constructorNode, 'protected', this.sourceCode);
      
      const annotations = getAnnotations(constructorNode, this.sourceCode);
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Constructor,
        constructorName,
        this.parentCanonicalId,
        parameterTypes,
        'java'
      );
      
      // Add constructor node
      this.addNode({
        type: JavaEntityType.Constructor,
        name: constructorName,
        path: this.filePath,
        parent_canonical_id: this.parentCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          parameter_types: parameterTypes,
          parameter_names: parameterNames,
          is_public: isPublic,
          is_private: isPrivate,
          is_protected: isProtected,
          is_constructor: true,
          annotations,
          line_number: constructorNode.startPosition.row + 1,
          column_number: constructorNode.startPosition.column + 1
        }
      });
      
      // Add relationship between class and constructor
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: this.parentCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing constructor', error);
    }
  }

  /**
   * Process a field declaration
   * 
   * @param fieldNode The field node
   * @param isInterfaceField Whether the field is in an interface (constant)
   */
  private async processField(fieldNode: SyntaxNode, isInterfaceField: boolean = false): Promise<void> {
    try {
      // A field declaration can have multiple variables
      const declaratorNodes = findNodesOfType(fieldNode, 'variable_declarator');
      
      for (const declaratorNode of declaratorNodes) {
        const nameNode = declaratorNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const fieldName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Find the type node
        const typeNode = fieldNode.children.find((child: SyntaxNode) => 
          child.type === 'type_identifier' || 
          child.type === 'primitive_type' ||
          child.type === 'array_type'
        );
        
        if (!typeNode) continue;
        
        const fieldType = this.sourceCode.substring(typeNode.startIndex, typeNode.endIndex).trim();
        
        const isPublic = hasModifier(fieldNode, 'public', this.sourceCode);
        const isPrivate = hasModifier(fieldNode, 'private', this.sourceCode);
        const isProtected = hasModifier(fieldNode, 'protected', this.sourceCode);
        const isStatic = hasModifier(fieldNode, 'static', this.sourceCode) || isInterfaceField;
        const isFinal = hasModifier(fieldNode, 'final', this.sourceCode) || isInterfaceField;
        
        const annotations = getAnnotations(fieldNode, this.sourceCode);
        
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          JavaEntityType.Field,
          fieldName,
          this.parentCanonicalId,
          [],
          'java'
        );
        
        // Add field node
        this.addNode({
          type: JavaEntityType.Field,
          name: fieldName,
          path: this.filePath,
          parent_canonical_id: this.parentCanonicalId,
          canonical_id: canonicalId,
          gid,
          properties: {
            field_type: fieldType,
            is_public: isPublic,
            is_private: isPrivate,
            is_protected: isProtected,
            is_static: isStatic,
            is_final: isFinal,
            annotations,
            line_number: declaratorNode.startPosition.row + 1,
            column_number: declaratorNode.startPosition.column + 1
          }
        });
        
        // Add relationship between class/interface and field
        this.addRelationship({
          source_gid: gid,
          target_canonical_id: this.parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      this.logError('Error processing field', error);
    }
  }
}