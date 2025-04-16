/**
 * AST Visitor for C# Analyzer
 * 
 * This module provides functionality to traverse C# ASTs
 * and extract code structure information.
 */

// @ts-ignore
import * as fs from 'fs';
// @ts-ignore
import * as path from 'path';
// @ts-ignore
import Parser from 'tree-sitter';
// @ts-ignore
import CSharp from 'tree-sitter-c-sharp';
import { IdServiceClient } from './id-service-client';
import {
  AnalysisNode, 
  AnalysisRelationship, 
  CSharpEntityType, 
  CSharpRelationshipType
} from './models';
import * as utils from './ast-visitor-utils';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Analyze a C# file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeCSharpFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new CSharpAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing C# file ${filePath}: ${error}`);
    return [[], []];
  }
}

/**
 * AST Visitor for C# files
 */
class CSharpAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private namespaceCanonicalId: string | null = null;
  private namespaceGid: string | null = null;
  private namespaceName: string = '';
  private csharpParser: Parser;
  private tree: Parser.Tree | null = null;
  private content: string = '';
  
  // Map to track entities by name for relationship creation
  private entityMap: Map<string, { canonicalId: string, gid: string }> = new Map();
  
  // Queries for finding specific C# constructs
  private namespaceQuery = `(namespace_declaration name: (_) @namespace_name)`;
  private usingQuery = `(using_directive name: (_) @using_namespace)`;
  private classQuery = `(class_declaration name: (identifier) @class_name)`;
  private interfaceQuery = `(interface_declaration name: (identifier) @interface_name)`;
  private methodQuery = `(method_declaration name: (identifier) @method_name)`;
  private constructorQuery = `(constructor_declaration name: (identifier) @constructor_name)`;
  private propertyQuery = `(property_declaration name: (identifier) @property_name)`;
  private fieldQuery = `(field_declaration declarator: (variable_declarator name: (identifier) @field_name))`;
  private eventQuery = `(event_field_declaration name: (identifier) @event_name)`;
  private attributeQuery = `(attribute name: (identifier) @attribute_name)`;
  private methodCallQuery = `(invocation_expression name: (identifier) @method_name)`;
  private typeUseQuery = `(type_identifier) @type_name`;

  /**
   * Initialize the AST visitor
   * 
   * @param filePath Path to the file to analyze
   * @param idServiceClient Client for the ID Service
   */
  constructor(filePath: string, idServiceClient: IdServiceClient) {
    this.filePath = filePath;
    this.idServiceClient = idServiceClient;

    // Initialize parser
    this.csharpParser = new Parser();
    this.csharpParser.setLanguage(CSharp);
  }

  /**
   * Parse the file and analyze the C# AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.csharpParser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const { canonicalId, gid } = await this.idServiceClient.generateIds(
        this.filePath,
        CSharpEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Process namespace declaration
      await this.processNamespace();

      // Add file node
      this.nodes.push({
        type: CSharpEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          extension: path.extname(this.filePath).toLowerCase(),
          namespace_name: this.namespaceName,
          is_test: fileName.endsWith('Test.cs') || fileName.endsWith('Tests.cs')
        }
      });

      // Process C# constructs
      await this.processUsings();
      await this.processClasses();
      await this.processInterfaces();
      await this.processMethods();
      await this.processConstructors();
      await this.processProperties();
      await this.processFields();
      await this.processEvents();
      await this.processAttributes();
      
      // Process relationships
      await this.processRelationships();

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Process namespace declaration
   */
  private async processNamespace(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const query = this.csharpParser.getLanguage().query(this.namespaceQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'namespace_name') {
            const node = capture.node;
            const namespaceName = utils.getNamespace(node);
            this.namespaceName = namespaceName || utils.extractNamespace(this.filePath, null);
            
            if (!this.namespaceName) continue;
            
            // Generate ID for the namespace
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Namespace,
              this.namespaceName
            );
            
            this.namespaceCanonicalId = canonicalId;
            this.namespaceGid = gid;
            
            // Add namespace node
            this.nodes.push({
              type: CSharpEntityType.Namespace,
              name: this.namespaceName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: this.namespaceName
              }
            });
            
            // Add relationship between file and namespace
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.CONTAINS,
              properties: {}
            });
            
            // Store namespace info for relationship creation
            this.entityMap.set(`namespace:${this.namespaceName}`, { canonicalId, gid });
            break;
          }
        }
      }
      
      // If no namespace found, try to infer from file path
      if (!this.namespaceName) {
        this.namespaceName = utils.extractNamespace(this.filePath, null);
        
        if (this.namespaceName) {
          // Generate ID for the inferred namespace
          const { canonicalId, gid } = await this.idServiceClient.generateIds(
            this.filePath,
            CSharpEntityType.Namespace,
            this.namespaceName
          );
          
          this.namespaceCanonicalId = canonicalId;
          this.namespaceGid = gid;
          
          // Add namespace node
          this.nodes.push({
            type: CSharpEntityType.Namespace,
            name: this.namespaceName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId || '',
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: this.namespaceName,
              inferred: true
            }
          });
          
          // Add relationship between file and namespace
          if (this.fileGid) {
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.CONTAINS,
              properties: {}
            });
          }
          
          // Store namespace info for relationship creation
          this.entityMap.set(`namespace:${this.namespaceName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing namespace: ${error}`);
    }
  }

  /**
   * Process using directives
   */
  private async processUsings(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const query = this.csharpParser.getLanguage().query(this.usingQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'using_namespace') {
            const node = capture.node;
            const namespace = utils.getUsingNamespace(node);
            
            if (!namespace) continue;
            
            // Generate ID for the using directive
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Using,
              namespace
            );
            
            // Add using node
            this.nodes.push({
              type: CSharpEntityType.Using,
              name: namespace,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                namespace: namespace,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
              }
            });
            
            // Add relationship between file and using
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: canonicalId,
              type: CSharpRelationshipType.IMPORTS,
              properties: {}
            });
            
            // Store using info for relationship creation
            this.entityMap.set(`using:${namespace}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing using directives: ${error}`);
    }
  }

  /**
   * Process class declarations
   */
  private async processClasses(): Promise<void> {
    try {
      if (!this.tree || !this.namespaceCanonicalId || !this.fileGid) return;
      
      const query = this.csharpParser.getLanguage().query(this.classQuery);
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
            const isPublic = utils.hasModifier(node, 'public');
            const isAbstract = utils.hasModifier(node, 'abstract');
            const isStatic = utils.hasModifier(node, 'static');
            const isSealed = utils.hasModifier(node, 'sealed');
            const isPartial = utils.hasModifier(node, 'partial');
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
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
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
      
      const query = this.csharpParser.getLanguage().query(this.interfaceQuery);
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
            const isPublic = utils.hasModifier(node, 'public');
            
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
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
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

  /**
   * Process method declarations
   */
  private async processMethods(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const query = this.csharpParser.getLanguage().query(this.methodQuery);
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
                parentName = utils.getClassName(parentNode);
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              } else if (parentNode.type === 'interface_declaration') {
                parentType = CSharpEntityType.Interface;
                parentName = utils.getInterfaceName(parentNode);
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
            const isPublic = utils.hasModifier(node, 'public');
            const isStatic = utils.hasModifier(node, 'static');
            const isAbstract = utils.hasModifier(node, 'abstract');
            const isVirtual = utils.hasModifier(node, 'virtual');
            const isOverride = utils.hasModifier(node, 'override');
            const isAsync = utils.hasModifier(node, 'async');
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
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
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
   * Process constructor declarations
   */
  private async processConstructors(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const query = this.csharpParser.getLanguage().query(this.constructorQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'constructor_name') {
            const node = capture.node.parent;
            const constructorName = capture.node.text;
            
            if (!constructorName) continue;
            
            // Find the parent class
            let parentNode = node.parent;
            let className = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                className = utils.getClassName(parentNode);
                const parentEntity = this.entityMap.get(`class:${className}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              }
              parentNode = parentNode.parent;
            }
            
            if (!parentCanonicalId || !className) {
              // If no parent found, use namespace as parent
              parentCanonicalId = this.namespaceCanonicalId || '';
              className = constructorName; // Constructor name should match class name
            }
            
            // Get constructor details
            const parameters = utils.getMethodParameters(node);
            const isPublic = utils.hasModifier(node, 'public');
            const isStatic = utils.hasModifier(node, 'static');
            const attributes = utils.extractAttributes(node);
            
            // Generate ID for the constructor
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Method, // Constructors are treated as methods
              constructorName,
              parentCanonicalId,
              parameters.map(p => p.type)
            );
            
            // Add constructor node
            this.nodes.push({
              type: CSharpEntityType.Method,
              name: constructorName,
              path: this.filePath,
              parent_canonical_id: parentCanonicalId,
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: constructorName,
                is_constructor: true,
                parameters: parameters.map(p => p.name),
                parameter_types: parameters.map(p => p.type),
                is_public: isPublic,
                is_static: isStatic,
                attributes: attributes,
                parent_type: CSharpEntityType.Class,
                parent_name: className,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and constructor
            const parentEntity = this.entityMap.get(`class:${className}`);
            if (parentEntity) {
              this.relationships.push({
                source_gid: parentEntity.gid,
                target_canonical_id: canonicalId,
                type: CSharpRelationshipType.CONTAINS,
                properties: {}
              });
            }
            
            // Store constructor info for relationship creation
            this.entityMap.set(`constructor:${className}.${constructorName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing constructors: ${error}`);
    }
  }

  /**
   * Process property declarations
   */
  private async processProperties(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const query = this.csharpParser.getLanguage().query(this.propertyQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'property_name') {
            const node = capture.node.parent;
            const propertyName = capture.node.text;
            
            if (!propertyName) continue;
            
            // Find the parent class or interface
            let parentNode = node.parent;
            let parentType = '';
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentType = CSharpEntityType.Class;
                parentName = utils.getClassName(parentNode);
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              } else if (parentNode.type === 'interface_declaration') {
                parentType = CSharpEntityType.Interface;
                parentName = utils.getInterfaceName(parentNode);
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
            const isPublic = utils.hasModifier(node, 'public');
            const isStatic = utils.hasModifier(node, 'static');
            const isVirtual = utils.hasModifier(node, 'virtual');
            const isOverride = utils.hasModifier(node, 'override');
            const attributes = utils.extractAttributes(node);
            
            // Check for getter and setter
            const accessorList = node.childForFieldName('accessors');
            let hasGetter = false;
            let hasSetter = false;
            
            if (accessorList) {
              for (let i = 0; i < accessorList.childCount; i++) {
                const accessor = accessorList.child(i);
                if (accessor.type === 'accessor_declaration') {
                  const nameNode = accessor.childForFieldName('name');
                  if (nameNode) {
                    if (nameNode.text === 'get') {
                      hasGetter = true;
                    } else if (nameNode.text === 'set') {
                      hasSetter = true;
                    }
                  }
                }
              }
            }
            
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
                has_getter: hasGetter,
                has_setter: hasSetter,
                is_public: isPublic,
                is_static: isStatic,
                is_virtual: isVirtual,
                is_override: isOverride,
                attributes: attributes,
                parent_type: parentType,
                parent_name: parentName,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
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
      
      const query = this.csharpParser.getLanguage().query(this.fieldQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'field_name') {
            const node = capture.node.parent.parent; // field_declaration -> variable_declarator -> identifier
            const fieldName = capture.node.text;
            
            if (!fieldName) continue;
            
            // Find the parent class
            let parentNode = node.parent;
            let parentType = '';
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentType = CSharpEntityType.Class;
                parentName = utils.getClassName(parentNode);
                const parentEntity = this.entityMap.get(`class:${parentName}`);
                if (parentEntity) {
                  parentCanonicalId = parentEntity.canonicalId;
                }
                break;
              } else if (parentNode.type === 'struct_declaration') {
                parentType = CSharpEntityType.Class; // Treat structs as classes for now
                parentName = utils.getNodeName(parentNode); // Use generic getNodeName instead of getStructName
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
            // Extract field type from the field declaration
            const declarationNode = node.parent;
            const typeNode = declarationNode.childForFieldName('type');
            const fieldType = typeNode ? typeNode.text : '';
            
            const isPublic = utils.hasModifier(node.parent, 'public');
            const isStatic = utils.hasModifier(node.parent, 'static');
            const isReadonly = utils.hasModifier(node.parent, 'readonly');
            const isConst = utils.hasModifier(node.parent, 'const');
            const attributes = utils.extractAttributes(node.parent);
            
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
                type: fieldType,
                is_public: isPublic,
                is_static: isStatic,
                is_readonly: isReadonly,
                is_const: isConst,
                attributes: attributes,
                parent_type: parentType,
                parent_name: parentName,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and field
            const parentEntity = this.entityMap.get(`${parentType.toLowerCase()}:${parentName}`);
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
      
      const query = this.csharpParser.getLanguage().query(this.eventQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'event_name') {
            const node = capture.node.parent;
            const eventName = capture.node.text;
            
            if (!eventName) continue;
            
            // Find the parent class
            let parentNode = node.parent;
            let parentType = '';
            let parentName = '';
            let parentCanonicalId = '';
            
            while (parentNode) {
              if (parentNode.type === 'class_declaration') {
                parentType = CSharpEntityType.Class;
                parentName = utils.getClassName(parentNode);
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
            const typeNode = node.childForFieldName('type');
            const eventType = typeNode ? typeNode.text : '';
            const isPublic = utils.hasModifier(node, 'public');
            const isStatic = utils.hasModifier(node, 'static');
            const attributes = utils.extractAttributes(node);
            
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
                type: eventType,
                is_public: isPublic,
                is_static: isStatic,
                attributes: attributes,
                parent_type: parentType,
                parent_name: parentName,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
              }
            });
            
            // Add relationship between parent and event
            const parentEntity = this.entityMap.get(`${parentType.toLowerCase()}:${parentName}`);
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

  /**
   * Process attribute declarations
   */
  private async processAttributes(): Promise<void> {
    try {
      if (!this.tree) return;
      
      const query = this.csharpParser.getLanguage().query(this.attributeQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === 'attribute_name') {
            const node = capture.node.parent;
            const attributeName = capture.node.text;
            
            if (!attributeName) continue;
            
            // Generate ID for the attribute
            const { canonicalId, gid } = await this.idServiceClient.generateIds(
              this.filePath,
              CSharpEntityType.Attribute,
              attributeName
            );
            
            // Get attribute details
            const argumentsNode = node.childForFieldName('arguments');
            const argsList = [];
            
            if (argumentsNode) {
              for (let i = 0; i < argumentsNode.childCount; i++) {
                const argNode = argumentsNode.child(i);
                if (argNode) {
                  argsList.push(argNode.text);
                }
              }
            }
            
            // Add attribute node
            this.nodes.push({
              type: CSharpEntityType.Attribute,
              name: attributeName,
              path: this.filePath,
              parent_canonical_id: this.fileCanonicalId || '',
              canonical_id: canonicalId,
              gid: gid,
              properties: {
                name: attributeName,
                arguments: argsList,
                line_number: utils.getLineNumber(node),
                column_number: utils.getColumnNumber(node),
              }
            });
            
            // Store attribute info for relationship creation
            this.entityMap.set(`attribute:${attributeName}`, { canonicalId, gid });
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing attributes: ${error}`);
    }
  }

  /**
   * Process relationships between entities
   */
  private async processRelationships(): Promise<void> {
    try {
      if (!this.tree || !this.fileGid) return;
      
      // Collect method nodes for relationship processing
      const methodNodes = this.nodes
        .filter(node => node.type === CSharpEntityType.Method)
        .map(node => {
          return {
            node: this.findNodeByName(this.tree!.rootNode, node.name, 'method_declaration'),
            gid: node.gid
          };
        })
        .filter(item => item.node !== null);
      
      // Process method calls
      const methodCallRelationships = utils.processMethodCalls(methodNodes, this.entityMap);
      this.relationships.push(...methodCallRelationships);
      
      // Process type uses
      const typeUseRelationships = utils.processTypeUses(methodNodes, this.entityMap);
      this.relationships.push(...typeUseRelationships);
      
      // Process class relationships (extends, implements)
      const classNodes = this.nodes
        .filter(node => node.type === CSharpEntityType.Class)
        .map(node => {
          return {
            node: this.findNodeByName(this.tree!.rootNode, node.name, 'class_declaration'),
            gid: node.gid
          };
        })
        .filter(item => item.node !== null);
      
      const classRelationships = utils.processClassRelationships(classNodes, this.entityMap);
      this.relationships.push(...classRelationships);
      
      // Process attribute usage
      const nodesWithAttributes = this.nodes
        .filter(node => {
          const props = node.properties as any;
          return props && props.attributes && props.attributes.length > 0;
        })
        .map(node => {
          let nodeType = '';
          switch (node.type) {
            case CSharpEntityType.Class:
              nodeType = 'class_declaration';
              break;
            case CSharpEntityType.Method:
              nodeType = 'method_declaration';
              break;
            case CSharpEntityType.Property:
              nodeType = 'property_declaration';
              break;
            default:
              nodeType = '';
          }
          
          return {
            node: this.findNodeByName(this.tree!.rootNode, node.name, nodeType),
            gid: node.gid
          };
        })
        .filter(item => item.node !== null);
      
      const attributeRelationships = utils.processAttributesRelationships(nodesWithAttributes, this.entityMap);
      this.relationships.push(...attributeRelationships);
    } catch (error) {
      logger.error(`Error processing relationships: ${error}`);
    }
  }
  
  /**
   * Find a node by name and type in the AST
   *
   * @param rootNode Root node to start search from
   * @param name Name to search for
   * @param nodeType Type of node to search for
   * @returns Found node or null
   */
  private findNodeByName(rootNode: any, name: string, nodeType: string): any {
    if (!rootNode) return null;
    
    // Check if this node matches
    if (rootNode.type === nodeType) {
      const nodeName = nodeType === 'class_declaration' ? utils.getClassName(rootNode) :
                       nodeType === 'method_declaration' ? utils.getMethodName(rootNode) :
                       nodeType === 'property_declaration' ? utils.getPropertyName(rootNode) : '';
      
      if (nodeName === name) {
        return rootNode;
      }
    }
    
    // Recursively check children
    for (let i = 0; i < rootNode.childCount; i++) {
      const result = this.findNodeByName(rootNode.child(i), name, nodeType);
      if (result) return result;
    }
    
    return null;
  }
}
