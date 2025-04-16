/**
 * AST Visitor for JavaScript/TypeScript Analyzer
 * 
 * This module provides functionality to traverse JavaScript and TypeScript ASTs
 * and extract code structure information.
 */

import * as fs from 'fs';
import * as path from 'path';
import Parser from 'tree-sitter';
// @ts-ignore

import JavaScript from 'tree-sitter-javascript';
// @ts-ignore

import { TypeScript } from 'tree-sitter-typescript';
// @ts-ignore

import { IdServiceClient } from './id-service-client';
import { AnalysisNode, AnalysisRelationship } from './models';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

/**
 * AST Visitor for JavaScript and TypeScript files
 */
export class JsAstVisitor {
  private filePath: string;
  private idServiceClient: IdServiceClient;
  private nodes: AnalysisNode[] = [];
  private relationships: AnalysisRelationship[] = [];
  private currentClass: string | null = null;
  private currentClassCanonicalId: string | null = null;
  private currentFunction: string | null = null;
  private currentFunctionGid: string | null = null;
  private fileCanonicalId: string | null = null;
  private fileGid: string | null = null;
  private jsParser: Parser;
  private tsParser: Parser;
  private tree: Parser.Tree | null = null;
  private content: string = '';
  private isTypeScript: boolean = false;
  // Optimization: cache for ID service calls
  private _idCache: Map<string, [string, string]>;
/**
 * Initialize the AST visitor
 *
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 */
constructor(filePath: string, idServiceClient: IdServiceClient) {
  this.filePath = filePath;
  this.idServiceClient = idServiceClient;

  // Optimization: cache for ID service calls
  this._idCache = new Map<string, [string, string]>();

  // Initialize parsers
  this.jsParser = new Parser();
  this.jsParser.setLanguage(JavaScript);

  this.tsParser = new Parser();
  this.tsParser.setLanguage(TypeScript);

  // Determine if the file is TypeScript
  this.isTypeScript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

  /**
   * Parse the file and traverse the AST
   */
  async analyze(): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
    try {
      // Read the file content
      this.content = fs.readFileSync(this.filePath, 'utf8');

      // Parse the file
      const parser = this.isTypeScript ? this.tsParser : this.jsParser;
      this.tree = parser.parse(this.content);

      // Generate ID for the file
      const fileName = path.basename(this.filePath);
      const cacheKey = JSON.stringify([this.filePath, 'File', fileName, '', undefined, undefined]);
      let canonicalId: string, gid: string;
      if (this._idCache.has(cacheKey)) {
        [canonicalId, gid] = this._idCache.get(cacheKey)!;
      } else {
        [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          'File',
          fileName
        );
        this._idCache.set(cacheKey, [canonicalId, gid]);
      }
      this.fileCanonicalId = canonicalId;
      this.fileGid = gid;

      // Add file node
      this.nodes.push({
        type: 'File',
        name: fileName,
        path: this.filePath,
        parent_canonical_id: '',
        canonical_id: canonicalId,
        gid: gid
      });

      // Parse bmcp hint comments for manual relationships
      await this.parseHintComments();

      // Traverse the AST
      await this.traverseNode(this.tree.rootNode);

      return [this.nodes, this.relationships];
    } catch (error) {
      logger.error(`Error analyzing file ${this.filePath}: ${error}`);
      return [[], []];
    }
  }

  /**
   * Parse bmcp hint comments in the file content and add relationships
   */
  private async parseHintComments(): Promise<void> {
    // Regex for // bmcp:<hint-type> <target>
    const hintRegex = /\/\/\s*bmcp:(call-target|imports|uses-type)\s+([^\n]+)/g;
    let match: RegExpExecArray | null;
    while ((match = hintRegex.exec(this.content)) !== null) {
      const hintType = match[1];
      const target = match[2].trim();

      // For demo, associate all hints with the file node (could be improved to associate with nearest entity)
      const sourceGid = this.fileGid;

      let relationshipType = '';
      switch (hintType) {
        case 'call-target':
          relationshipType = ':CALLS';
          break;
        case 'imports':
          relationshipType = ':IMPORTS';
          break;
        case 'uses-type':
          relationshipType = ':USES_TYPE';
          break;
        default:
          continue;
      }

      // Generate a canonical ID for the target (simple string, could be improved)
      const targetCanonicalId = `manual::${hintType}::${target}`;

      this.relationships.push({
        source_gid: sourceGid || '',
        target_canonical_id: targetCanonicalId,
        type: relationshipType,
        properties: {
          manual_hint: true,
          hint_type: hintType
        }
      });
    }
  }

  /**
   * Traverse a node in the AST
   * 
   * @param node The node to traverse
   */
  private async traverseNode(node: Parser.SyntaxNode): Promise<void> {
    // Process the current node based on its type
    switch (node.type) {
      case 'class_declaration':
        await this.visitClassDeclaration(node);
        break;
      case 'function_declaration':
        await this.visitFunctionDeclaration(node);
        break;
      case 'method_definition':
        await this.visitMethodDefinition(node);
        break;
      case 'arrow_function':
        await this.visitArrowFunction(node);
        break;
      case 'variable_declaration':
        await this.visitVariableDeclaration(node);
        break;
      case 'import_statement':
        await this.visitImportStatement(node);
        break;
      case 'export_statement':
        await this.visitExportStatement(node);
        break;
      case 'call_expression':
        await this.visitCallExpression(node);
        break;
    }

    // Recursively traverse child nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        await this.traverseNode(child);
      }
    }
  }

  /**
   * Visit a class declaration node
   * 
   * @param node The class declaration node
   */
  private async visitClassDeclaration(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Get the class name
      const nameNode = (node as any).childForFieldName('name');
      if (!nameNode) return;

      const className = nameNode.text;
      const prevClass = this.currentClass;
      const prevClassCanonicalId = this.currentClassCanonicalId;

      // Set current class context
      this.currentClass = className;

      // Generate ID for the class
      const classCacheKey = JSON.stringify([this.filePath, 'Class', className, this.fileCanonicalId || '', undefined, undefined]);
      let canonicalId: string, gid: string;
      if (this._idCache.has(classCacheKey)) {
        [canonicalId, gid] = this._idCache.get(classCacheKey)!;
      } else {
        [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          'Class',
          className,
          this.fileCanonicalId || ''
        );
        this._idCache.set(classCacheKey, [canonicalId, gid]);
      }
      this.currentClassCanonicalId = canonicalId;

      // Add class node
      this.nodes.push({
        type: 'Class',
        name: className,
        path: this.filePath,
        parent_canonical_id: this.fileCanonicalId || '',
        canonical_id: canonicalId,
        gid: gid
      });

      // Check for class inheritance
      const extendsNode = (node as any).childForFieldName('extends');
      if (extendsNode) {
        const superClassName = extendsNode.text;
        // Create a simple canonical ID for the super class
        const targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Class::${superClassName}`;
        
        // Add inheritance relationship
        this.relationships.push({
          source_gid: gid,
          target_canonical_id: targetCanonicalId,
          type: ':EXTENDS',
          properties: {}
        });
      }

      // Restore previous class context after processing all children
      this.currentClass = prevClass;
      this.currentClassCanonicalId = prevClassCanonicalId;
    } catch (error) {
      logger.error(`Error processing class declaration: ${error}`);
    }
  }

  /**
   * Visit a function declaration node
   * 
   * @param node The function declaration node
   */
  private async visitFunctionDeclaration(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Get the function name
      const nameNode = (node as any).childForFieldName('name');
      if (!nameNode) return;

      const functionName = nameNode.text;
      const prevFunction = this.currentFunction;
      const prevFunctionGid = this.currentFunctionGid;

      // Get parameter types
      const paramTypes: string[] = [];
      const paramsNode = (node as any).childForFieldName('parameters');
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const param = paramsNode.namedChild(i);
          if (param) {
            paramTypes.push(param.text);
          }
        }
      }

      // Generate ID for the function
      const funcCacheKey = JSON.stringify([this.filePath, 'Function', functionName, this.fileCanonicalId || '', paramTypes, this.isTypeScript ? 'typescript' : 'javascript']);
      let canonicalId: string, gid: string;
      if (this._idCache.has(funcCacheKey)) {
        [canonicalId, gid] = this._idCache.get(funcCacheKey)!;
      } else {
        [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          'Function',
          functionName,
          this.fileCanonicalId || '',
          paramTypes,
          this.isTypeScript ? 'typescript' : 'javascript'
        );
        this._idCache.set(funcCacheKey, [canonicalId, gid]);
      }

      // Set current function context
      this.currentFunction = functionName;
      this.currentFunctionGid = gid;

      // Add function node
      this.nodes.push({
        type: 'Function',
        name: functionName,
        path: this.filePath,
        parent_canonical_id: this.fileCanonicalId || '',
        param_types: paramTypes,
        canonical_id: canonicalId,
        gid: gid
      });

      // Restore previous function context after processing all children
      this.currentFunction = prevFunction;
      this.currentFunctionGid = prevFunctionGid;
    } catch (error) {
      logger.error(`Error processing function declaration: ${error}`);
    }
  }

  /**
   * Visit a method definition node
   * 
   * @param node The method definition node
   */
  private async visitMethodDefinition(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Skip if not in a class
      if (!this.currentClass || !this.currentClassCanonicalId) return;

      // Get the method name
      const nameNode = (node as any).childForFieldName('name');
      if (!nameNode) return;

      const methodName = nameNode.text;
      const prevFunction = this.currentFunction;
      const prevFunctionGid = this.currentFunctionGid;

      // Get parameter types
      const paramTypes: string[] = [];
      const paramsNode = (node as any).childForFieldName('parameters');
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const param = paramsNode.namedChild(i);
          if (param) {
            paramTypes.push(param.text);
          }
        }
      }

      // Generate ID for the method
      const methodCacheKey = JSON.stringify([this.filePath, 'Method', methodName, this.currentClassCanonicalId, paramTypes, this.isTypeScript ? 'typescript' : 'javascript']);
      let canonicalId: string, gid: string;
      if (this._idCache.has(methodCacheKey)) {
        [canonicalId, gid] = this._idCache.get(methodCacheKey)!;
      } else {
        [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          'Method',
          methodName,
          this.currentClassCanonicalId,
          paramTypes,
          this.isTypeScript ? 'typescript' : 'javascript'
        );
        this._idCache.set(methodCacheKey, [canonicalId, gid]);
      }

      // Set current function context
      this.currentFunction = methodName;
      this.currentFunctionGid = gid;

      // Add method node
      this.nodes.push({
        type: 'Method',
        name: methodName,
        path: this.filePath,
        parent_canonical_id: this.currentClassCanonicalId,
        param_types: paramTypes,
        canonical_id: canonicalId,
        gid: gid
      });

      // Restore previous function context after processing all children
      this.currentFunction = prevFunction;
      this.currentFunctionGid = prevFunctionGid;
    } catch (error) {
      logger.error(`Error processing method definition: ${error}`);
    }
  }

  /**
   * Visit an arrow function node
   * 
   * @param node The arrow function node
   */
  private async visitArrowFunction(node: Parser.SyntaxNode): Promise<void> {
    // Arrow functions are often anonymous or assigned to variables
    // We'll handle them in variable declarations
  }

  /**
   * Visit a variable declaration node
   * 
   * @param node The variable declaration node
   */
  private async visitVariableDeclaration(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Process each variable declarator
      for (let i = 0; i < node.namedChildCount; i++) {
        const declarator = node.namedChild(i);
        if (!declarator || declarator.type !== 'variable_declarator') continue;

        // Get the variable name
        const nameNode = (declarator as any).childForFieldName('name');
        if (!nameNode) continue;

        const variableName = nameNode.text;

        // Check if the variable is assigned an arrow function or function expression
        const valueNode = (declarator as any).childForFieldName('value');
        const isFunction = valueNode && 
          (valueNode.type === 'arrow_function' || valueNode.type === 'function');

        // Generate ID for the variable
        const entityType = isFunction ? 'Function' : 'Variable';
        const parentId = this.currentClassCanonicalId || this.fileCanonicalId || '';

        // Get parameter types if it's a function
        const paramTypes: string[] = [];
        if (isFunction && valueNode) {
          const paramsNode = (valueNode as any).childForFieldName('parameters');
          if (paramsNode) {
            for (let j = 0; j < paramsNode.namedChildCount; j++) {
              const param = paramsNode.namedChild(j);
              if (param) {
                paramTypes.push(param.text);
              }
            }
          }
        }

        // Generate ID
        const [canonicalId, gid] = await this.idServiceClient.generateId(
          this.filePath,
          entityType,
          variableName,
          parentId,
          isFunction ? paramTypes : undefined,
          this.isTypeScript ? 'typescript' : 'javascript'
        );

        // Add variable node
        this.nodes.push({
          type: entityType,
          name: variableName,
          path: this.filePath,
          parent_canonical_id: parentId,
          param_types: isFunction ? paramTypes : undefined,
          canonical_id: canonicalId,
          gid: gid
        });

        // If it's a function, set it as the current function for child nodes
        if (isFunction && valueNode) {
          const prevFunction = this.currentFunction;
          const prevFunctionGid = this.currentFunctionGid;

          this.currentFunction = variableName;
          this.currentFunctionGid = gid;

          // Process the function body
          await this.traverseNode(valueNode);

          // Restore previous function context
          this.currentFunction = prevFunction;
          this.currentFunctionGid = prevFunctionGid;
        }
      }
    } catch (error) {
      logger.error(`Error processing variable declaration: ${error}`);
    }
  }

  /**
   * Visit an import statement node
   * 
   * @param node The import statement node
   */
  private async visitImportStatement(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Skip if no current function or file
      if (!this.currentFunctionGid && !this.fileGid) return;

      const sourceGid = this.currentFunctionGid || this.fileGid;
      if (!sourceGid) return;

      // Get the source module
      const sourceNode = (node as any).childForFieldName('source');
      if (!sourceNode) return;

      // Remove quotes from the source
      const moduleName = sourceNode.text.replace(/['"]/g, '');

      // Process each imported name
      const clauseNode = (node as any).childForFieldName('clause');
      if (clauseNode) {
        // Handle named imports
        for (let i = 0; i < clauseNode.namedChildCount; i++) {
          const specifier = clauseNode.namedChild(i);
          if (!specifier) continue;

          let importedName = '';
          let alias = '';

          // Handle different import specifier types
          if (specifier.type === 'import_specifier') {
            const nameNode = (specifier as any).childForFieldName('name');
            const aliasNode = (specifier as any).childForFieldName('alias');
            
            importedName = nameNode ? nameNode.text : '';
            alias = aliasNode ? aliasNode.text : importedName;
          } else if (specifier.type === 'namespace_import') {
            const nameNode = (specifier as any).childForFieldName('name');
            importedName = '*';
            alias = nameNode ? nameNode.text : '*';
          }

          if (importedName) {
            // Create a simple canonical ID for the imported entity
            const targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Module::${moduleName}::Entity::${importedName}`;
            
            // Add import relationship
            this.relationships.push({
              source_gid: sourceGid,
              target_canonical_id: targetCanonicalId,
              type: ':IMPORTS',
              properties: { alias, from_module: moduleName }
            });
          }
        }
      } else {
        // Handle default import
        const nameNode = (node as any).childForFieldName('name');
        if (nameNode) {
          const importedName = 'default';
          const alias = nameNode.text;
          
          // Create a simple canonical ID for the imported module
          const targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Module::${moduleName}::Entity::${importedName}`;
          
          // Add import relationship
          this.relationships.push({
            source_gid: sourceGid,
            target_canonical_id: targetCanonicalId,
            type: ':IMPORTS',
            properties: { alias, from_module: moduleName }
          });
        }
      }
    } catch (error) {
      logger.error(`Error processing import statement: ${error}`);
    }
  }

  /**
   * Visit an export statement node
   * 
   * @param node The export statement node
   */
  private async visitExportStatement(node: Parser.SyntaxNode): Promise<void> {
    // For now, we're not tracking exports as relationships
    // This could be added in a future enhancement
  }

  /**
   * Visit a call expression node
   * 
   * @param node The call expression node
   */
  private async visitCallExpression(node: Parser.SyntaxNode): Promise<void> {
    try {
      // Skip if not in a function
      if (!this.currentFunctionGid) return;

      // Get the function being called
      const functionNode = (node as any).childForFieldName('function');
      if (!functionNode) return;

      // Check if it's a require call
      if (functionNode.type === 'identifier' && functionNode.text === 'require') {
        // Get the argument (module name)
        const argsNode = (node as any).childForFieldName('arguments');
        if (!argsNode || argsNode.namedChildCount === 0) return;

        const moduleNode = argsNode.namedChild(0);
        if (!moduleNode || moduleNode.type !== 'string') return;

        // Remove quotes from the module name
        const moduleName = moduleNode.text.replace(/['"]/g, '');

        // Create a simple canonical ID for the required module
        const targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Module::${moduleName}`;
        
        // Add require relationship
        this.relationships.push({
          source_gid: this.currentFunctionGid,
          target_canonical_id: targetCanonicalId,
          type: ':IMPORTS',
          properties: { method: 'require' }
        });
      } else {
        // Handle other function calls
        let funcName = '';
        let targetCanonicalId = '';

        // Handle different function call types
        if (functionNode.type === 'identifier') {
          // Simple function call: func()
          funcName = functionNode.text;
          targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Function::${funcName}`;
        } else if (functionNode.type === 'member_expression') {
          // Method call: obj.method()
          const objectNode = (functionNode as any).childForFieldName('object');
          const propertyNode = (functionNode as any).childForFieldName('property');
          
          if (objectNode && propertyNode) {
            const objName = objectNode.text;
            const methodName = propertyNode.text;
            
            targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Object::${objName}::Method::${methodName}`;
          } else {
            // More complex member expression, just use the text
            targetCanonicalId = `${this.isTypeScript ? 'typescript' : 'javascript'}::Function::${functionNode.text}`;
          }
        } else {
          // Complex call expression, skip
          return;
        }

        // Add call relationship
        this.relationships.push({
          source_gid: this.currentFunctionGid,
          target_canonical_id: targetCanonicalId,
          type: ':CALLS',
          properties: {}
        });
      }
    } catch (error) {
      logger.error(`Error processing call expression: ${error}`);
    }
  }
}

/**
 * Analyze a JavaScript or TypeScript file
 * 
 * @param filePath Path to the file to analyze
 * @param idServiceClient Client for the ID Service
 * @returns Promise resolving to a tuple of [nodes, relationships]
 */
export async function analyzeJsFile(
  filePath: string,
  idServiceClient: IdServiceClient
): Promise<[AnalysisNode[], AnalysisRelationship[]]> {
  try {
    const visitor = new JsAstVisitor(filePath, idServiceClient);
    return await visitor.analyze();
  } catch (error) {
    logger.error(`Error analyzing file ${filePath}: ${error}`);
    return [[], []];
  }
}