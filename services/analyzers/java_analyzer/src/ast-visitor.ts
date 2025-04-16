/**
 * AST Visitor for Java Analyzer
 * 
 * This module provides the main AST visitor for Java code analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Parser from 'tree-sitter';
import * as Java from 'tree-sitter-java';
import { IdServiceClient } from './id-service-client';
import { 
  JavaEntityType, 
  JavaRelationshipType, 
  AnalysisNode, 
  AnalysisRelationship, 
  AnalysisResult 
} from './models';
import {
  SyntaxNode,
  getNodeText,
  getQualifiedName,
  getSimpleName,
  getPackageName,
  hasModifier,
  getModifiers,
  getReturnType,
  getParameterTypes,
  getParameterNames,
  getAnnotations,
  isTest,
  extractPackageName,
  processMethodCalls,
  processTypeUses,
  processClassRelationships,
  processAnnotations,
  formatAnalysisResults,
  findNodesOfType
} from './ast-visitor-utils';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Java AST Visitor
 * 
 * Analyzes Java source code and extracts entities and relationships.
 */
export class JavaAstVisitor {
  private parser: Parser;
  private filePath: string;
  private sourceCode: string;
  private packageName: string = '';
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private idServiceClient: IdServiceClient;
  private currentClass: string = '';
  private currentMethod: string = '';

  /**
   * Initialize the Java AST visitor
   * 
   * @param filePath Path to the Java file
   * @param idServiceClient ID Service client
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;
    this.parser = new Parser();
    this.parser.setLanguage(Java);
    this.sourceCode = fs.readFileSync(filePath, 'utf8');
  }

  /**
   * Analyze the Java file
   * 
   * @returns Promise resolving to the analysis result
   */
  async analyze(): Promise<AnalysisResult> {
    try {
      // Parse the source code
      const tree = this.parser.parse(this.sourceCode);
      const rootNode = tree.rootNode;

      // Extract package name
      this.packageName = extractPackageName(rootNode, this.sourceCode);
      
      // Process file entity
      await this.processFileEntity();
      
      // Process package entity
      if (this.packageName) {
        await this.processPackageEntity();
      }
      
      // Process imports
      await this.processImports(rootNode);
      
      // Process classes, interfaces, and enums
      await this.processClassesAndInterfaces(rootNode);
      
      // Process relationships
      await this.processRelationships(rootNode);
      
      // Return the analysis result
      return formatAnalysisResults(
        this.filePath,
        this.nodes,
        this.relationships
      );
    } catch (error) {
      logger.error(`Error analyzing Java file: ${error instanceof Error ? error.message : String(error)}`);
      return formatAnalysisResults(
        this.filePath,
        [],
        [],
        `Error analyzing Java file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Process the file entity
   */
  private async processFileEntity(): Promise<void> {
    try {
      const fileName = path.basename(this.filePath);
      const extension = path.extname(this.filePath).substring(1);
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        fileName,
        '',
        [],
        'java'
      );
      
      this.nodes.push({
        type: JavaEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid,
        properties: {
          extension,
          is_test: fileName.includes('Test') || fileName.includes('test')
        }
      });
    } catch (error) {
      logger.error(`Error processing file entity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process the package entity
   */
  private async processPackageEntity(): Promise<void> {
    try {
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        path.basename(this.filePath),
        '',
        [],
        'java'
      );
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        '',
        JavaEntityType.Package,
        this.packageName,
        '',
        [],
        'java'
      );
      
      // Add package node
      this.nodes.push({
        type: JavaEntityType.Package,
        name: this.packageName,
        path: '',
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid,
        properties: {}
      });
      
      // Add relationship between file and package
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.CONTAINS,
        properties: {}
      });
    } catch (error) {
      logger.error(`Error processing package entity: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process imports
   * 
   * @param rootNode The root AST node
   */
  private async processImports(rootNode: SyntaxNode): Promise<void> {
    try {
      const importNodes = findNodesOfType(rootNode, 'import_declaration');
      
      for (const importNode of importNodes) {
        const nameNode = importNode.children.find((child: SyntaxNode) => 
          child.type === 'scoped_identifier' || 
          child.type === 'identifier'
        );
        
        if (!nameNode) continue;
        
        const importName = getNodeText(nameNode, this.sourceCode).trim();
        const isStatic = importNode.children.some((child: SyntaxNode) => 
          child.type === 'static' || 
          getNodeText(child, this.sourceCode).trim() === 'static'
        );
        
        const [fileCanonicalId] = await this.idServiceClient.generateId(
          this.filePath,
          JavaEntityType.File,
          path.basename(this.filePath),
          '',
          [],
          'java'
        );
        
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          '',
          JavaEntityType.Import,
          importName,
          fileCanonicalId,
          [],
          'java'
        );
        
        // Add import node
        this.nodes.push({
          type: JavaEntityType.Import,
          name: importName,
          path: '',
          parent_canonical_id: fileCanonicalId,
          canonical_id: canonicalId,
          gid,
          properties: {
            is_static: isStatic
          }
        });
        
        // Add relationship between file and import
        this.relationships.push({
          source_gid: gid,
          target_canonical_id: fileCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      logger.error(`Error processing imports: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process classes, interfaces, and enums
   * 
   * @param rootNode The root AST node
   */
  private async processClassesAndInterfaces(rootNode: SyntaxNode): Promise<void> {
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
      logger.error(`Error processing classes and interfaces: ${error instanceof Error ? error.message : String(error)}`);
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
      
      const className = getNodeText(nameNode, this.sourceCode).trim();
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
        path.basename(this.filePath),
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
      this.nodes.push({
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
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process class members
      await this.processClassMembers(classNode, canonicalId);
    } catch (error) {
      logger.error(`Error processing class: ${error instanceof Error ? error.message : String(error)}`);
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
      
      const interfaceName = getNodeText(nameNode, this.sourceCode).trim();
      this.currentClass = interfaceName;
      
      const isPublic = hasModifier(interfaceNode, 'public', this.sourceCode);
      const annotations = getAnnotations(interfaceNode, this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        path.basename(this.filePath),
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
      this.nodes.push({
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
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process interface members
      await this.processInterfaceMembers(interfaceNode, canonicalId);
    } catch (error) {
      logger.error(`Error processing interface: ${error instanceof Error ? error.message : String(error)}`);
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
      
      const enumName = getNodeText(nameNode, this.sourceCode).trim();
      this.currentClass = enumName;
      
      const isPublic = hasModifier(enumNode, 'public', this.sourceCode);
      const annotations = getAnnotations(enumNode, this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        path.basename(this.filePath),
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
      this.nodes.push({
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
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process enum constants
      await this.processEnumConstants(enumNode, canonicalId);
      
      // Process enum methods
      await this.processClassMembers(enumNode, canonicalId);
    } catch (error) {
      logger.error(`Error processing enum: ${error instanceof Error ? error.message : String(error)}`);
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
      
      const annotationName = getNodeText(nameNode, this.sourceCode).trim();
      this.currentClass = annotationName;
      
      const isPublic = hasModifier(annotationNode, 'public', this.sourceCode);
      
      const [fileCanonicalId] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.File,
        path.basename(this.filePath),
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
      this.nodes.push({
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
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: fileCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process annotation members
      await this.processAnnotationMembers(annotationNode, canonicalId);
    } catch (error) {
      logger.error(`Error processing annotation type: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process class members (methods, constructors, fields)
   * 
   * @param classNode The class node
   * @param parentCanonicalId The canonical ID of the parent class
   */
  private async processClassMembers(classNode: SyntaxNode, parentCanonicalId: string): Promise<void> {
    try {
      const bodyNode = classNode.children.find((child: SyntaxNode) => 
        child.type === 'class_body'
      );
      
      if (!bodyNode) return;
      
      // Process methods
      const methodNodes = findNodesOfType(bodyNode, 'method_declaration');
      for (const methodNode of methodNodes) {
        await this.processMethod(methodNode, parentCanonicalId);
      }
      
      // Process constructors
      const constructorNodes = findNodesOfType(bodyNode, 'constructor_declaration');
      for (const constructorNode of constructorNodes) {
        await this.processConstructor(constructorNode, parentCanonicalId);
      }
      
      // Process fields
      const fieldNodes = findNodesOfType(bodyNode, 'field_declaration');
      for (const fieldNode of fieldNodes) {
        await this.processField(fieldNode, parentCanonicalId);
      }
    } catch (error) {
      logger.error(`Error processing class members: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process interface members (methods, fields)
   * 
   * @param interfaceNode The interface node
   * @param parentCanonicalId The canonical ID of the parent interface
   */
  private async processInterfaceMembers(interfaceNode: SyntaxNode, parentCanonicalId: string): Promise<void> {
    try {
      const bodyNode = interfaceNode.children.find((child: SyntaxNode) => 
        child.type === 'interface_body'
      );
      
      if (!bodyNode) return;
      
      // Process methods
      const methodNodes = findNodesOfType(bodyNode, 'method_declaration');
      for (const methodNode of methodNodes) {
        await this.processMethod(methodNode, parentCanonicalId, true);
      }
      
      // Process fields (constants)
      const fieldNodes = findNodesOfType(bodyNode, 'field_declaration');
      for (const fieldNode of fieldNodes) {
        await this.processField(fieldNode, parentCanonicalId, true);
      }
    } catch (error) {
      logger.error(`Error processing interface members: ${error instanceof Error ? error.message : String(error)}`);
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
        
        const constantName = getNodeText(nameNode, this.sourceCode).trim();
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
        this.nodes.push({
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
        this.relationships.push({
          source_gid: gid,
          target_canonical_id: parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      logger.error(`Error processing enum constants: ${error instanceof Error ? error.message : String(error)}`);
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
        
        const memberName = getNodeText(nameNode, this.sourceCode).trim();
        const returnTypeNode = memberNode.children.find((child: SyntaxNode) => 
          child.type === 'type_identifier' || 
          child.type === 'primitive_type'
        );
        
        const returnType = returnTypeNode ? 
          getNodeText(returnTypeNode, this.sourceCode).trim() : 
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
        this.nodes.push({
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
        this.relationships.push({
          source_gid: gid,
          target_canonical_id: parentCanonicalId,
          type: JavaRelationshipType.BELONGS_TO,
          properties: {}
        });
      }
    } catch (error) {
      logger.error(`Error processing annotation members: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a method declaration
   * 
   * @param methodNode The method node
   * @param parentCanonicalId The canonical ID of the parent class/interface
   * @param isInterface Whether the method is in an interface
   */
  private async processMethod(
    methodNode: SyntaxNode, 
    parentCanonicalId: string, 
    isInterface: boolean = false
  ): Promise<void> {
    try {
      const nameNode = methodNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const methodName = getNodeText(nameNode, this.sourceCode).trim();
      this.currentMethod = methodName;
      
      const returnType = getReturnType(methodNode, this.sourceCode);
      const parameterTypes = getParameterTypes(methodNode, this.sourceCode);
      const parameterNames = getParameterNames(methodNode, this.sourceCode);
      
      const isPublic = hasModifier(methodNode, 'public', this.sourceCode);
      const isPrivate = hasModifier(methodNode, 'private', this.sourceCode);
      const isProtected = hasModifier(methodNode, 'protected', this.sourceCode);
      const isStatic = hasModifier(methodNode, 'static', this.sourceCode);
      const isFinal = hasModifier(methodNode, 'final', this.sourceCode);
      const isAbstract = hasModifier(methodNode, 'abstract', this.sourceCode) || isInterface;
      
      const annotations = getAnnotations(methodNode, this.sourceCode);
      const isTestMethod = isTest(methodNode, this.sourceCode);
      
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        JavaEntityType.Method,
        methodName,
        parentCanonicalId,
        parameterTypes,
        'java'
      );
      
      // Add method node
      this.nodes.push({
        type: JavaEntityType.Method,
        name: methodName,
        path: this.filePath,
        parent_canonical_id: parentCanonicalId,
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
      this.relationships.push({
        source_gid: gid,
        target_canonical_id: parentCanonicalId,
        type: JavaRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Process method parameters
      await this.processMethodParameters(methodNode, canonicalId);
    } catch (error) {
      logger.error(`Error processing method: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Process a constructor declaration
   * 
   * @param constructorNode The constructor node
   * @param parentCanonicalId The canonical ID of the parent class
   */
  private async processConstructor(constructorNode: SyntaxNode, parentCanonicalId: string): Promise<void> {
    try {
      const nameNode = constructorNode.children.find((child: SyntaxNode) => 
        child.type === 'identifier'
      );
      
      if (!nameNode) return;
      
      const constructorName = getNodeText(nameNode, this.sourceCode).trim();
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
        parentCanonicalId,
        parameterTypes,
        'java'
      );
      
      // Add constructor node
      this.nodes.push({
        type: JavaEntityType.Constructor,
        name: constructorName,
        path: this.filePath,
        parent_canonical_id: parentCanonicalId,
        canonical_id: canonicalId,
        gid,
        properties: {
          parameter_types: parameterTypes,
