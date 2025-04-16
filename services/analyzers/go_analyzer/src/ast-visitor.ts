/**
 * AST Visitor for Go Analyzer
 * 
 * This module provides functionality to traverse Go ASTs
 * and extract code structure information.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
import Go from 'tree-sitter-go';
import { IdServiceClient } from './id-service-client';
import { 
  AnalysisNode, 
  AnalysisRelationship, 
  GoEntityType, 
  GoRelationshipType,
  GoFileProperties,
  GoFunctionProperties,
  GoStructProperties,
  GoInterfaceProperties,
  GoVariableProperties,
  GoConstantProperties,
  GoImportProperties,
  GoTypeProperties
} from './models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * Analyze a Go file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeGoFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new GoAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing Go file ${filePath}: ${error}`);
    return [[], []];
  }
}

/**
 * AST Visitor for Go files
 */
class GoAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private packageCanonicalId: string | null = null;
  private packageGid: string | null = null;
  private goParser: Parser;
  private tree: Parser.Tree | null = null;
  private content: string = '';
  
  // Map to track entities by name for relationship creation
  private entityMap: Map<string, { canonicalId: string, gid: string }> = new Map();
  
  // Queries for finding specific Go constructs
  private packageQuery: string;
  private importQuery: string;
  private functionQuery: string;
  private methodQuery: string;
  private structQuery: string;
  private interfaceQuery: string;
  private functionCallQuery: string;

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
    this.goParser = new Parser();
    this.goParser.setLanguage(Go);
    
    // Initialize queries for finding Go constructs
    this.packageQuery = `
      (package_clause
        (package_identifier) @package_name)
    `;
    
    this.importQuery = `
      (import_declaration
        (import_spec_list
          (import_spec
            [(package_identifier) @import_alias]
            (interpreted_string_literal) @import_path)))
    `;
    
    this.functionQuery = `
      (function_declaration
        name: (identifier) @function_name
        parameters: (parameter_list) @params
        result: [(parameter_list) @return_params (type_identifier) @return_type]?)
    `;
    
    this.methodQuery = `
      (method_declaration
        receiver: (parameter_list
          (parameter_declaration
            type: [(type_identifier) @receiver_type (pointer_type) @receiver_type]))
        name: (identifier) @method_name
        parameters: (parameter_list) @params
        result: [(parameter_list) @return_params (type_identifier) @return_type]?)
    `;
    
    this.structQuery = `
      (type_declaration
        (type_spec
          name: (type_identifier) @struct_name
          type: (struct_type
            (field_declaration_list) @struct_fields)))
    `;
    
    this.interfaceQuery = `
      (type_declaration
        (type_spec
          name: (type_identifier) @interface_name
          type: (interface_type
            (method_spec_list) @interface_methods)))
    `;
    
    this.functionCallQuery = `
      (call_expression
        function: [(identifier) @function_name
                  (selector_expression
                    field: (identifier) @method_name)])
    `;
  }

  /**
   * Parse the file and analyze the Go AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      this.tree = this.goParser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        GoEntityType.File,
        fileName
      );
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Process package declaration
      await this.processPackage();

      // Add file node
      this.nodes.push({
        type: GoEntityType.File,
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          extension: path.extname(this.filePath).toLowerCase(),
          package_name: this.getPackageName(),
          is_test: fileName.endsWith('_test.go')
        }
      });

      // Process Go constructs
      await this.processImports();
      await this.processFunctions();
      await this.processMethods();
      await this.processStructs();
      await this.processInterfaces();
      
      // Process relationships
      await this.processFunctionCalls();

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Get the package name from the file
   */
  private getPackageName(): string {
    if (!this.tree) return '';
    
    const query = this.goParser.getLanguage().query(this.packageQuery);
    const matches = query.matches(this.tree.rootNode);
    
    for (const match of matches) {
      for (const capture of match.captures) {
        if (capture.name === 'package_name') {
          return capture.node.text;
        }
      }
    }
    
    return '';
  }

  /**
   * Process package declaration
   */
  private async processPackage(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const packageName = this.getPackageName();
      if (!packageName) return;
      
      // Generate ID for the package
      const [canonicalId, gid] = await this.idServiceClient.generateId(
        this.filePath,
        GoEntityType.Package,
        packageName
      );
      
      this.packageCanonicalId = canonicalId;
      this.packageGid = gid;
      
      // Add package node
      this.nodes.push({
        type: GoEntityType.Package,
        name: packageName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid,
        properties: {
          name: packageName
        }
      });
      
      // Add relationship between file and package
      this.relationships.push({
        source_gid: this.fileGid,
        target_canonical_id: canonicalId,
        type: GoRelationshipType.BELONGS_TO,
        properties: {}
      });
      
      // Store package info for relationship creation
      this.entityMap.set(`package:${packageName}`, { canonicalId, gid });
    } catch (error) {
      logger.error(`Error processing package: ${error}`);
    }
  }

  /**
   * Process import declarations
   */
  private async processImports(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid) return;
      
      const query = this.goParser.getLanguage().query(this.importQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let importPath = '';
        let importAlias = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'import_path') {
            // Remove quotes from the import path
            importPath = capture.node.text.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
          } else if (capture.name === 'import_alias') {
            importAlias = capture.node.text;
          }
        }
        
        if (importPath) {
          // Generate a name for the import
          const importName = importAlias || path.basename(importPath);
          
          // Generate ID for the import
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            GoEntityType.Import,
            importName,
            this.fileCanonicalId
          );
          
          // Add import node
          this.nodes.push({
            type: GoEntityType.Import,
            name: importName,
            path: this.filePath,
            parent_canonical_id: this.fileCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              path: importPath,
              alias: importAlias || undefined
            }
          });
          
          // Add relationship between file and import
          this.relationships.push({
            source_gid: this.fileGid,
            target_canonical_id: canonicalId,
            type: GoRelationshipType.IMPORTS,
            properties: {}
          });
          
          // Store import info for relationship creation
          this.entityMap.set(`import:${importName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing imports: ${error}`);
    }
  }

  /**
   * Process function declarations
   */
  private async processFunctions(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid || !this.packageCanonicalId || !this.packageGid) return;
      
      const query = this.goParser.getLanguage().query(this.functionQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let functionName = '';
        let params = '';
        let returnType = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'function_name') {
            functionName = capture.node.text;
          } else if (capture.name === 'params') {
            params = capture.node.text;
          } else if (capture.name === 'return_type' || capture.name === 'return_params') {
            returnType = capture.node.text;
          }
        }
        
        if (functionName) {
          // Check if function is exported (starts with uppercase)
          const isExported = /^[A-Z]/.test(functionName);
          
          // Extract parameter types
          const paramTypes = this.extractParameterTypes(params);
          
          // Extract return types
          const returnTypes = this.extractReturnTypes(returnType);
          
          // Generate ID for the function
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            GoEntityType.Function,
            functionName,
            this.packageCanonicalId,
            paramTypes
          );
          
          // Add function node
          this.nodes.push({
            type: GoEntityType.Function,
            name: functionName,
            path: this.filePath,
            parent_canonical_id: this.packageCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: functionName,
              parameters: paramTypes,
              return_types: returnTypes,
              is_exported: isExported
            }
          });
          
          // Add relationship between package and function
          this.relationships.push({
            source_gid: this.packageGid,
            target_canonical_id: canonicalId,
            type: GoRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Store function info for relationship creation
          this.entityMap.set(`function:${functionName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing functions: ${error}`);
    }
  }

  /**
   * Process method declarations
   */
  private async processMethods(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid || !this.packageCanonicalId || !this.packageGid) return;
      
      const query = this.goParser.getLanguage().query(this.methodQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let methodName = '';
        let receiverType = '';
        let params = '';
        let returnType = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'method_name') {
            methodName = capture.node.text;
          } else if (capture.name === 'receiver_type') {
            // Remove pointer symbol if present
            receiverType = capture.node.text.replace(/^\*/, '');
          } else if (capture.name === 'params') {
            params = capture.node.text;
          } else if (capture.name === 'return_type' || capture.name === 'return_params') {
            returnType = capture.node.text;
          }
        }
        
        if (methodName && receiverType) {
          // Check if method is exported (starts with uppercase)
          const isExported = /^[A-Z]/.test(methodName);
          
          // Extract parameter types
          const paramTypes = this.extractParameterTypes(params);
          
          // Extract return types
          const returnTypes = this.extractReturnTypes(returnType);
          
          // Generate ID for the method
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            GoEntityType.Method,
            methodName,
            this.packageCanonicalId,
            [receiverType, ...paramTypes]
          );
          
          // Add method node
          this.nodes.push({
            type: GoEntityType.Method,
            name: methodName,
            path: this.filePath,
            parent_canonical_id: this.packageCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: methodName,
              receiver_type: receiverType,
              parameters: paramTypes,
              return_types: returnTypes,
              is_exported: isExported
            }
          });
          
          // Add relationship between package and method
          this.relationships.push({
            source_gid: this.packageGid,
            target_canonical_id: canonicalId,
            type: GoRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Store method info for relationship creation
          this.entityMap.set(`method:${receiverType}.${methodName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing methods: ${error}`);
    }
  }

  /**
   * Process struct declarations
   */
  private async processStructs(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid || !this.packageCanonicalId || !this.packageGid) return;
      
      const query = this.goParser.getLanguage().query(this.structQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let structName = '';
        let structFields = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'struct_name') {
            structName = capture.node.text;
          } else if (capture.name === 'struct_fields') {
            structFields = capture.node;
          }
        }
        
        if (structName) {
          // Check if struct is exported (starts with uppercase)
          const isExported = /^[A-Z]/.test(structName);
          
          // Extract fields and embedded types
          const fields: string[] = [];
          const embeddedTypes: string[] = [];
          
          if (structFields) {
            // Process field declarations
            for (let i = 0; i < structFields.namedChildCount; i++) {
              const fieldDecl = structFields.namedChild(i);
              if (fieldDecl && fieldDecl.type === 'field_declaration') {
                const nameNode = fieldDecl.namedChild(0);
                const typeNode = fieldDecl.namedChild(1);
                
                if (nameNode && typeNode) {
                  // Regular field with name and type
                  fields.push(`${nameNode.text} ${typeNode.text}`);
                } else if (typeNode) {
                  // Embedded type (no name)
                  const typeName = typeNode.text.replace(/^\*/, ''); // Remove pointer symbol if present
                  embeddedTypes.push(typeName);
                }
              }
            }
          }
          
          // Generate ID for the struct
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            GoEntityType.Struct,
            structName,
            this.packageCanonicalId
          );
          
          // Add struct node
          this.nodes.push({
            type: GoEntityType.Struct,
            name: structName,
            path: this.filePath,
            parent_canonical_id: this.packageCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: structName,
              fields: fields,
              embedded_types: embeddedTypes,
              is_exported: isExported
            }
          });
          
          // Add relationship between package and struct
          this.relationships.push({
            source_gid: this.packageGid,
            target_canonical_id: canonicalId,
            type: GoRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Store struct info for relationship creation
          this.entityMap.set(`struct:${structName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing structs: ${error}`);
    }
  }

  /**
   * Process interface declarations
   */
  private async processInterfaces(): Promise<void> {
    try {
      if (!this.tree || !this.fileCanonicalId || !this.fileGid || !this.packageCanonicalId || !this.packageGid) return;
      
      const query = this.goParser.getLanguage().query(this.interfaceQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let interfaceName = '';
        let interfaceMethods = null;
        
        for (const capture of match.captures) {
          if (capture.name === 'interface_name') {
            interfaceName = capture.node.text;
          } else if (capture.name === 'interface_methods') {
            interfaceMethods = capture.node;
          }
        }
        
        if (interfaceName) {
          // Check if interface is exported (starts with uppercase)
          const isExported = /^[A-Z]/.test(interfaceName);
          
          // Extract methods and embedded interfaces
          const methods: string[] = [];
          const embeddedInterfaces: string[] = [];
          
          if (interfaceMethods) {
            // Process method specs
            for (let i = 0; i < interfaceMethods.namedChildCount; i++) {
              const methodSpec = interfaceMethods.namedChild(i);
              if (methodSpec) {
                if (methodSpec.type === 'method_spec') {
                  // Regular method with name and signature
                  methods.push(methodSpec.text);
                } else if (methodSpec.type === 'interface_type_name') {
                  // Embedded interface
                  embeddedInterfaces.push(methodSpec.text);
                }
              }
            }
          }
          
          // Generate ID for the interface
          const [canonicalId, gid] = await this.idServiceClient.generateId(
            this.filePath,
            GoEntityType.Interface,
            interfaceName,
            this.packageCanonicalId
          );
          
          // Add interface node
          this.nodes.push({
            type: GoEntityType.Interface,
            name: interfaceName,
            path: this.filePath,
            parent_canonical_id: this.packageCanonicalId,
            canonical_id: canonicalId,
            gid: gid,
            properties: {
              name: interfaceName,
              methods: methods,
              embedded_interfaces: embeddedInterfaces,
              is_exported: isExported
            }
          });
          
          // Add relationship between package and interface
          this.relationships.push({
            source_gid: this.packageGid,
            target_canonical_id: canonicalId,
            type: GoRelationshipType.CONTAINS,
            properties: {}
          });
          
          // Store interface info for relationship creation
          this.entityMap.set(`interface:${interfaceName}`, { canonicalId, gid });
        }
      }
    } catch (error) {
      logger.error(`Error processing interfaces: ${error}`);
    }
  }

  /**
   * Process function calls
   */
  private async processFunctionCalls(): Promise<void> {
    try {
      if (!this.tree || !this.fileGid) return;
      
      const query = this.goParser.getLanguage().query(this.functionCallQuery);
      const matches = query.matches(this.tree.rootNode);
      
      for (const match of matches) {
        let functionName = '';
        let methodName = '';
        
        for (const capture of match.captures) {
          if (capture.name === 'function_name') {
            functionName = capture.node.text;
          } else if (capture.name === 'method_name') {
            methodName = capture.node.text;
          }
        }
        
        // Process function call
        if (functionName && !methodName) {
          const calledFunction = this.entityMap.get(`function:${functionName}`);
          if (calledFunction) {
            this.relationships.push({
              source_gid: this.fileGid,
              target_canonical_id: calledFunction.canonicalId,
              type: GoRelationshipType.CALLS,
              properties: {}
            });
          }
        }
        
        // Process method call (simplified approach)
        if (methodName) {
          // Try to find any method with this name
          for (const [key, value] of this.entityMap.entries()) {
            if (key.startsWith('method:') && key.endsWith(`.${methodName}`)) {
              this.relationships.push({
                source_gid: this.fileGid,
                target_canonical_id: value.canonicalId,
                type: GoRelationshipType.CALLS,
                properties: {}
              });
              break;
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error processing function calls: ${error}`);
    }
  }

  /**
   * Extract parameter types from a parameter list
   */
  private extractParameterTypes(params: string): string[] {
    // Simple extraction for now
    return params
      .replace(/[()]/g, '')
      .split(',')
      .map(param => param.trim())
      .filter(param => param.length > 0)
      .map(param => {
        const parts = param.split(' ');
        return parts.length > 1 ? parts[1] : parts[0];
      });
  }

  /**
   * Extract return types from a return type or parameter list
   */
  private extractReturnTypes(returnType: string): string[] {
    if (!returnType) return [];
    
    // Simple extraction for now
    return returnType
      .replace(/[()]/g, '')
      .split(',')
      .map(type => type.trim())
      .filter(type => type.length > 0);
  }
}
