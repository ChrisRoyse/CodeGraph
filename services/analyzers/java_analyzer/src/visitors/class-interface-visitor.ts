/**
 * Class and Interface Visitor for Java Analyzer
 * 
 * This module provides the visitor for class, interface, enum, and annotation entities in Java code.
 */

import { BaseVisitor } from './base-visitor';
import { JavaEntityType, JavaRelationshipType } from '../models';
import { 
  SyntaxNode, 
  findNodesOfType, 
  hasModifier, 
  getAnnotations, 
  isTest 
} from '../ast-visitor-utils';

/**
 * Visitor for class, interface, enum, and annotation entities in Java code
 */
export class ClassInterfaceVisitor extends BaseVisitor {
  private currentClass: string = '';

  /**
   * Visit the root node of a Java file
   * 
   * @param rootNode The root node of the Java file
   */
  public async visit(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process classes
      const classNodes = findNodesOfType(rootNode, 'class_declaration');
      for (const classNode of classNodes) {
        await this.processClass(classNode);
      }
      
      // Process interfaces
      const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
      for (const interfaceNode of interfaceNodes) {
        await this.processInterface(interfaceNode);
      }
      
      // Process enums
      const enumNodes = findNodesOfType(rootNode, 'enum_declaration');
      for (const enumNode of enumNodes) {
        await this.processEnum(enumNode);
      }
      
      // Process annotations
      const annotationNodes = findNodesOfType(rootNode, 'annotation_type_declaration');
      for (const annotationNode of annotationNodes) {
        await this.processAnnotationType(annotationNode);
      }
    } catch (error) {
      this.logError('Error in ClassInterfaceVisitor', error);
    }
  }

  /**
   * Process a class declaration
   * 
   * @param classNode The class declaration node
   */
  private async processClass(classNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = classNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const className = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentClass = className;
      
      const isPublic = hasModifier(classNode, 'public', this.sourceCode);
      const isAbstract = hasModifier(classNode, 'abstract', this.sourceCode);
      const isFinal = hasModifier(classNode, 'final', this.sourceCode);
      const isStatic = hasModifier(classNode, 'static', this.sourceCode);
      const annotations = getAnnotations(classNode, this.sourceCode);
      const isTestClass = isTest(classNode, this.sourceCode) || 
                          className.includes('Test') || 
                          this.filePath.includes('test');
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Class,
        className,
        fileCanonicalId,
        [],
        'java'
      );
      
      // Add class node
      this.addNode({
        type: JavaEntityType.Class,
        name: className,
        path: this.filePath,
        parent_canonical_id: fileCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          package_name: this.packageName,
          is_public: isPublic,
          is_abstract: isAbstract,
          is_final: isFinal,
          is_static: isStatic,
          annotations,
          is_test: isTestClass,
          line_number: classNode.startPosition.row + 1,
          column_number: classNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and class
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing class', error);
    }
  }

  /**
   * Process an interface declaration
   * 
   * @param interfaceNode The interface declaration node
   */
  private async processInterface(interfaceNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = interfaceNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const interfaceName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentClass = interfaceName;
      
      const isPublic = hasModifier(interfaceNode, 'public', this.sourceCode);
      const annotations = getAnnotations(interfaceNode, this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Interface,
        interfaceName,
        fileCanonicalId,
        [],
        'java'
      );
      
      // Add interface node
      this.addNode({
        type: JavaEntityType.Interface,
        name: interfaceName,
        path: this.filePath,
        parent_canonical_id: fileCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          package_name: this.packageName,
          is_public: isPublic,
          annotations,
          line_number: interfaceNode.startPosition.row + 1,
          column_number: interfaceNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and interface
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing interface', error);
    }
  }

  /**
   * Process an enum declaration
   * 
   * @param enumNode The enum declaration node
   */
  private async processEnum(enumNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = enumNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const enumName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentClass = enumName;
      
      const isPublic = hasModifier(enumNode, 'public', this.sourceCode);
      const annotations = getAnnotations(enumNode, this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Enum,
        enumName,
        fileCanonicalId,
        [],
        'java'
      );
      
      // Add enum node
      this.addNode({
        type: JavaEntityType.Enum,
        name: enumName,
        path: this.filePath,
        parent_canonical_id: fileCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          package_name: this.packageName,
          is_public: isPublic,
          annotations,
          line_number: enumNode.startPosition.row + 1,
          column_number: enumNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and enum
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process enum constants
      await this.processEnumConstants(enumNode, canonicalId);
    } catch (error) {
      this.logError('Error processing enum', error);
    }
  }

  /**
   * Process an annotation type declaration
   * 
   * @param annotationNode The annotation type declaration node
   */
  private async processAnnotationType(annotationNode: SyntaxNode): Promise<void> {
    try {
      const nameNode = annotationNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const annotationName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      this.currentClass = annotationName;
      
      const isPublic = hasModifier(annotationNode, 'public', this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        this.filePath.split('/').pop() || '',
        '',
        [],
        'java'
      );
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Annotation,
        annotationName,
        fileCanonicalId,
        [],
        'java'
      );
      
      // Add annotation node
      this.addNode({
        type: JavaEntityType.Annotation,
        name: annotationName,
        path: this.filePath,
        parent_canonical_id: fileCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          package_name: this.packageName,
          is_public: isPublic,
          line_number: annotationNode.startPosition.row + 1,
          column_number: annotationNode.startPosition.column + 1
        }
      });
      
      // Add relationship between file and annotation
      this.addRelationship({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process annotation members
      await this.processAnnotationMembers(annotationNode, canonicalId);
    } catch (error) {
      this.logError('Error processing annotation type', error);
    }
  }

  /**
   * Process enum constants
   * 
   * @param enumNode The enum node
   * @param parentCanonicalId The canonical ID of the parent enum
   */
  private async processEnumConstants(enumNode: SyntaxNode, parentCanonicalId: string): Promise<void> {
    try {
      const bodyNode = enumNode.children.find((child: SyntaxNode) => 
        child.type === 'enum_body'
      );
      
      if (!bodyNode) return;
      
      const constantNodes = findNodesOfType(bodyNode, 'enum_constant');
      
      for (const constantNode of constantNodes) {
        const nameNode = constantNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const constantName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        const annotations = getAnnotations(constantNode, this.sourceCode);
        
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          JavaEntityType.EnumConstant,
          constantName,
          parentCanonicalId,
          [],
          'java'
        );
        
        // Add enum constant node
        this.addNode({
          type: JavaEntityType.EnumConstant,
          name: constantName,
          path: this.filePath,
          parent_canonical_id: parentCanonicalId,
          canonical_id: canonicalId,
          gid,
          properties: {
            annotations,
            line_number: constantNode.startPosition.row + 1,
            column_number: constantNode.startPosition.column + 1
          }
        });
        
        // Add relationship between enum and constant
        this.addRelationship({
          source_gid: gid,
          target_canonical_id: parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      this.logError('Error processing enum constants', error);
    }
  }

  /**
   * Process annotation members
   * 
   * @param annotationNode The annotation node
   * @param parentCanonicalId The canonical ID of the parent annotation
   */
  private async processAnnotationMembers(annotationNode: SyntaxNode, parentCanonicalId: string): Promise<void> {
    try {
      const bodyNode = annotationNode.children.find((child: SyntaxNode) => 
        child.type === 'annotation_type_body'
      );
      
      if (!bodyNode) return;
      
      const memberNodes = findNodesOfType(bodyNode, 'annotation_type_element_declaration');
      
      for (const memberNode of memberNodes) {
        const nameNode = memberNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const memberName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        const returnTypeNode = memberNode.children.find((child: SyntaxNode) => 
          child.type === 'type_identifier' || 
          child.type === 'primitive_type'
        );
        
        const returnType = returnTypeNode ? 
          this.sourceCode.substring(returnTypeNode.startIndex, returnTypeNode.endIndex).trim() : 
          'void';
        
        const annotations = getAnnotations(memberNode, this.sourceCode);
        
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          JavaEntityType.AnnotationMember,
          memberName,
          parentCanonicalId,
          [],
          'java'
        );
        
        // Add annotation member node
        this.addNode({
          type: JavaEntityType.AnnotationMember,
          name: memberName,
          path: this.filePath,
          parent_canonical_id: parentCanonicalId,
          canonical_id: canonicalId,
          gid,
          properties: {
            return_type: returnType,
            annotations,
            line_number: memberNode.startPosition.row + 1,
            column_number: memberNode.startPosition.column + 1
          }
        });
        
        // Add relationship between annotation and member
        this.addRelationship({
          source_gid: gid,
          target_canonical_id: parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      this.logError('Error processing annotation members', error);
    }
  }
}