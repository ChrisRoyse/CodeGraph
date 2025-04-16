/**
 * Relationship Visitor for Java Analyzer
 * 
 * This module provides the visitor for extracting relationships between Java entities.
 */

import { BaseVisitor } from './base-visitor';
import { JavaEntityType, JavaRelationshipType } from '../models';
import { 
  SyntaxNode, 
  findNodesOfType, 
  getExtendedClass,
  getImplementedInterfaces,
  processMethodCalls,
  processTypeUses,
  processClassRelationships,
  processAnnotations
} from '../ast-visitor-utils';

/**
 * Visitor for extracting relationships between Java entities
 */
export class RelationshipVisitor extends BaseVisitor {
  /**
   * Visit the root node of a Java file
   * 
   * @param rootNode The root node of the Java file
   */
  public async visit(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process class relationships (extends, implements)
      await this.processClassHierarchyRelationships(rootNode);
      
      // Process method calls
      await this.processMethodCallRelationships(rootNode);
      
      // Process type uses
      await this.processTypeUseRelationships(rootNode);
      
      // Process annotations
      await this.processAnnotationRelationships(rootNode);
    } catch (error) {
      this.logError('Error in RelationshipVisitor', error);
    }
  }

  /**
   * Process class hierarchy relationships (extends, implements)
   * 
   * @param rootNode The root node of the Java file
   */
  private async processClassHierarchyRelationships(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process class extends/implements relationships
      const classNodes = findNodesOfType(rootNode, 'class_declaration');
      for (const classNode of classNodes) {
        const nameNode = classNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const className = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Process extends relationship
        const extendedClass = getExtendedClass(classNode, this.sourceCode);
        if (extendedClass && extendedClass !== 'Object') {
          await this.processExtendsRelationship(className, extendedClass);
        }
        
        // Process implements relationships
        const implementedInterfaces = getImplementedInterfaces(classNode, this.sourceCode);
        for (const interfaceName of implementedInterfaces) {
          await this.processImplementsRelationship(className, interfaceName);
        }
      }
      
      // Process interface extends relationships
      const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
      for (const interfaceNode of interfaceNodes) {
        const nameNode = interfaceNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const interfaceName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Interfaces can extend other interfaces
        const extendedInterfaces = getImplementedInterfaces(interfaceNode, this.sourceCode);
        for (const extendedInterface of extendedInterfaces) {
          await this.processInterfaceExtendsRelationship(interfaceName, extendedInterface);
        }
      }
    } catch (error) {
      this.logError('Error processing class hierarchy relationships', error);
    }
  }

  /**
   * Process extends relationship between a class and its superclass
   * 
   * @param className The name of the class
   * @param superClassName The name of the superclass
   */
  private async processExtendsRelationship(className: string, superClassName: string): Promise<void> {
    try {
      const [sourceCanonicalId, sourceGid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Class,
        className,
        '',
        [],
        'java'
      );
      
      const [targetCanonicalId] = await this.idServiceClient.generateId(
        '',
        JavaEntityType.Class,
        superClassName,
        '',
        [],
        'java'
      );
      
      this.addRelationship({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: JavaRelationshipType.EXTENDS,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing extends relationship', error);
    }
  }

  /**
   * Process implements relationship between a class and an interface
   * 
   * @param className The name of the class
   * @param interfaceName The name of the interface
   */
  private async processImplementsRelationship(className: string, interfaceName: string): Promise<void> {
    try {
      const [sourceCanonicalId, sourceGid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Class,
        className,
        '',
        [],
        'java'
      );
      
      const [targetCanonicalId] = await this.idServiceClient.generateId(
        '',
        JavaEntityType.Interface,
        interfaceName,
        '',
        [],
        'java'
      );
      
      this.addRelationship({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: JavaRelationshipType.IMPLEMENTS,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing implements relationship', error);
    }
  }

  /**
   * Process extends relationship between an interface and another interface
   * 
   * @param interfaceName The name of the interface
   * @param extendedInterfaceName The name of the extended interface
   */
  private async processInterfaceExtendsRelationship(interfaceName: string, extendedInterfaceName: string): Promise<void> {
    try {
      const [sourceCanonicalId, sourceGid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Interface,
        interfaceName,
        '',
        [],
        'java'
      );
      
      const [targetCanonicalId] = await this.idServiceClient.generateId(
        '',
        JavaEntityType.Interface,
        extendedInterfaceName,
        '',
        [],
        'java'
      );
      
      this.addRelationship({
        source_gid: sourceGid,
        target_canonical_id: targetCanonicalId,
        type: JavaRelationshipType.EXTENDS,
        properties: {}
      });
    } catch (error) {
      this.logError('Error processing interface extends relationship', error);
    }
  }

  /**
   * Process method call relationships
   * 
   * @param rootNode The root node of the Java file
   */
  private async processMethodCallRelationships(rootNode: SyntaxNode): Promise<void> {
    try {
      // Find all method declarations
      const methodNodes = findNodesOfType(rootNode, 'method_declaration');
      
      for (const methodNode of methodNodes) {
        // Get the method name
        const nameNode = methodNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const methodName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Get the parent class/interface name
        let parentNode = methodNode.parent;
        while (parentNode && 
               parentNode.type !== 'class_declaration' && 
               parentNode.type !== 'interface_declaration' &&
               parentNode.type !== 'enum_declaration') {
          parentNode = parentNode.parent;
        }
        
        if (!parentNode) continue;
        
        const parentNameNode = parentNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!parentNameNode) continue;
        
        const parentName = this.sourceCode.substring(parentNameNode.startIndex, parentNameNode.endIndex).trim();
        
        // Process method calls within this method
        await processMethodCalls(
          methodNode,
          this.sourceCode,
          this.filePath,
          parentName,
          this.idServiceClient,
          this.relationships
        );
      }
      
      // Also process method calls in constructors
      const constructorNodes = findNodesOfType(rootNode, 'constructor_declaration');
      
      for (const constructorNode of constructorNodes) {
        // Get the constructor name
        const nameNode = constructorNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const constructorName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Process method calls within this constructor
        await processMethodCalls(
          constructorNode,
          this.sourceCode,
          this.filePath,
          constructorName,
          this.idServiceClient,
          this.relationships
        );
      }
    } catch (error) {
      this.logError('Error processing method call relationships', error);
    }
  }

  /**
   * Process type use relationships
   * 
   * @param rootNode The root node of the Java file
   */
  private async processTypeUseRelationships(rootNode: SyntaxNode): Promise<void> {
    try {
      // Find all class, interface, and enum declarations
      const classNodes = findNodesOfType(rootNode, 'class_declaration');
      const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
      const enumNodes = findNodesOfType(rootNode, 'enum_declaration');
      
      const typeNodes = [...classNodes, ...interfaceNodes, ...enumNodes];
      
      for (const typeNode of typeNodes) {
        // Get the type name
        const nameNode = typeNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const typeName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        // Process type uses within this type
        await processTypeUses(
          typeNode,
          this.sourceCode,
          this.filePath,
          typeName,
          this.idServiceClient,
          this.relationships
        );
      }
    } catch (error) {
      this.logError('Error processing type use relationships', error);
    }
  }

  /**
   * Process annotation relationships
   * 
   * @param rootNode The root node of the Java file
   */
  private async processAnnotationRelationships(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process class annotations
      const classNodes = findNodesOfType(rootNode, 'class_declaration');
      for (const classNode of classNodes) {
        const nameNode = classNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const className = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        await processAnnotations(
          classNode,
          this.sourceCode,
          this.filePath,
          className,
          JavaEntityType.Class,
          this.idServiceClient,
          this.relationships
        );
      }
      
      // Process interface annotations
      const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
      for (const interfaceNode of interfaceNodes) {
        const nameNode = interfaceNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const interfaceName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        await processAnnotations(
          interfaceNode,
          this.sourceCode,
          this.filePath,
          interfaceName,
          JavaEntityType.Interface,
          this.idServiceClient,
          this.relationships
        );
      }
      
      // Process method annotations
      const methodNodes = findNodesOfType(rootNode, 'method_declaration');
      for (const methodNode of methodNodes) {
        const nameNode = methodNode.children.find((child: SyntaxNode) => 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const methodName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
        
        await processAnnotations(
          methodNode,
          this.sourceCode,
          this.filePath,
          methodName,
          JavaEntityType.Method,
          this.idServiceClient,
          this.relationships
        );
      }
      
      // Process field annotations
      const fieldNodes = findNodesOfType(rootNode, 'field_declaration');
      for (const fieldNode of fieldNodes) {
        const declaratorNodes = findNodesOfType(fieldNode, 'variable_declarator');
        
        for (const declaratorNode of declaratorNodes) {
          const nameNode = declaratorNode.children.find((child: SyntaxNode) => 
            child.type === 'identifier'
          );
          
          if (!nameNode) continue;
          
          const fieldName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
          
          await processAnnotations(
            fieldNode,
            this.sourceCode,
            this.filePath,
            fieldName,
            JavaEntityType.Field,
            this.idServiceClient,
            this.relationships
          );
        }
      }
    } catch (error) {
      this.logError('Error processing annotation relationships', error);
    }
  }
}