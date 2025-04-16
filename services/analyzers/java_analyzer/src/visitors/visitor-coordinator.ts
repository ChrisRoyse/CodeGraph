/**
 * Visitor Coordinator for Java Analyzer
 *
 * This module provides the coordinator for all Java entity visitors.
 */

// Add Node.js require type declaration
declare function require(id: string): any;

import { SyntaxNode } from '../ast-visitor-utils';
import { FileVisitor } from './file-visitor';
import { ImportVisitor } from './import-visitor';
import { ClassInterfaceVisitor } from './class-interface-visitor';
import { MemberVisitor } from './member-visitor';
import { RelationshipVisitor } from './relationship-visitor';
import { HintVisitor } from './hint-visitor';
import { JavaEntityType } from '../models';
import { findNodesOfType } from '../ast-visitor-utils';

/**
 * Coordinator for all Java entity visitors
 */
export class VisitorCoordinator {
  private filePath: string;
  private sourceCode: string;
  private packageName: string = '';
  private idServiceClient: any;
  private nodes: any[] = [];
  private relationships: any[] = [];

  /**
   * Initialize the visitor coordinator
   * 
   * @param filePath Path to the Java file
   * @param sourceCode Source code content
   * @param idServiceClient ID Service client
   */
  constructor(
    filePath: string,
    sourceCode: string,
    idServiceClient: any
  ) {
    this.filePath = filePath;
    this.sourceCode = sourceCode;
    this.idServiceClient = idServiceClient;
  }

  /**
   * Visit the Java file and extract all entities and relationships
   * 
   * @returns An object containing the extracted nodes and relationships
   */
  public async visit(): Promise<{ nodes: any[], relationships: any[] }> {
    try {
      // Parse the source code into an AST
      // In a production environment, these would be proper imports at the top of the file
      // We're using dynamic requires here for simplicity
      const Parser = require('tree-sitter');
      const Java = require('tree-sitter-java');
      
      const parser = new Parser();
      parser.setLanguage(Java);
      
      const rootNode = parser.parse(this.sourceCode).rootNode;
      
      // Visit file and package
      const fileVisitor = new FileVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships
      );
      
      await fileVisitor.visit(rootNode);
      
      // Update package name from file visitor
      this.packageName = fileVisitor['packageName'];
      
      // Visit imports
      const importVisitor = new ImportVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships
      );
      
      await importVisitor.visit(rootNode);
      
      // Visit classes, interfaces, enums, and annotations
      const classInterfaceVisitor = new ClassInterfaceVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships
      );
      
      await classInterfaceVisitor.visit(rootNode);
      
      // Visit methods, constructors, and fields for each class, interface, enum, and annotation
      await this.visitMembers(rootNode);
      
      // Visit relationships
      const relationshipVisitor = new RelationshipVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships
      );
      
      await relationshipVisitor.visit(rootNode);
      
      // Visit hint comments to extract manual relationship hints
      const hintVisitor = new HintVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships
      );
      
      await hintVisitor.visit(rootNode);
      
      return {
        nodes: this.nodes,
        relationships: this.relationships
      };
    } catch (error: any) {
      console.error(`Error in VisitorCoordinator: ${error.message || error}`);
      if (error.stack) {
        console.error(error.stack);
      }
      
      return {
        nodes: this.nodes,
        relationships: this.relationships
      };
    }
  }

  /**
   * Visit members (methods, constructors, fields) for each class, interface, enum, and annotation
   * 
   * @param rootNode The root node of the Java file
   */
  private async visitMembers(rootNode: SyntaxNode): Promise<void> {
    try {
      // Process classes
      const classNodes = findNodesOfType(rootNode, 'class_declaration');
      for (const classNode of classNodes) {
        await this.visitClassMembers(classNode, JavaEntityType.Class);
      }
      
      // Process interfaces
      const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
      for (const interfaceNode of interfaceNodes) {
        await this.visitClassMembers(interfaceNode, JavaEntityType.Interface);
      }
      
      // Process enums
      const enumNodes = findNodesOfType(rootNode, 'enum_declaration');
      for (const enumNode of enumNodes) {
        await this.visitClassMembers(enumNode, JavaEntityType.Enum);
      }
      
      // Process annotations
      const annotationNodes = findNodesOfType(rootNode, 'annotation_type_declaration');
      for (const annotationNode of annotationNodes) {
        await this.visitClassMembers(annotationNode, JavaEntityType.Annotation);
      }
    } catch (error: any) {
      console.error(`Error visiting members: ${error.message || error}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }

  /**
   * Visit members of a class, interface, enum, or annotation
   * 
   * @param node The class, interface, enum, or annotation node
   * @param entityType The type of the entity
   */
  private async visitClassMembers(node: SyntaxNode, entityType: JavaEntityType): Promise<void> {
    try {
      // Get the name of the class, interface, enum, or annotation
      const nameNode = node.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const entityName = this.sourceCode.substring(nameNode.startIndex, nameNode.endIndex).trim();
      
      // Find the body node
      const bodyNode = node.children.find((child: SyntaxNode) => 
        child.type === 'class_body' || 
        child.type === 'interface_body' || 
        child.type === 'enum_body' || 
        child.type === 'annotation_type_body'
      );
      
      if (!bodyNode) return;
      
      // Get the canonical ID of the entity
      const [canonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        entityType,
        entityName,
        '',
        [],
        'java'
      );
      
      // Visit members
      const memberVisitor = new MemberVisitor(
        this.filePath,
        this.sourceCode,
        this.packageName,
        this.idServiceClient,
        this.nodes,
        this.relationships,
        entityType,
        entityName,
        canonicalId
      );
      
      await memberVisitor.visit(bodyNode);
    } catch (error: any) {
      console.error(`Error visiting class members: ${error.message || error}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }
}