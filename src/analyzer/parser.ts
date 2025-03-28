import { Project, SourceFile, Node, ts } from 'ts-morph';
import path from 'path';
import fs from 'fs/promises'; // Use promises API for async file operations
import fsSync from 'fs'; // Import synchronous fs for statSync
import os from 'os'; // For temporary directory
import crypto from 'crypto'; // For unique temp file names
import { createContextLogger } from '../utils/logger';
import { ParserError, FileSystemError } from '../utils/errors';
import { FileInfo } from '../scanner/file-scanner';
import config from '../config';
import winston from 'winston'; // Import winston type for logger context

// Import parsing/analysis helpers
import { parseClasses } from './parsers/class-parser';
import { parseInterfaces } from './parsers/interface-parser';
import { parseFunctions } from './parsers/function-parser';
import { parseVariables } from './parsers/variable-parser';
import { parseModules } from './parsers/module-parser';
import { parseTypeAliases } from './parsers/type-alias-parser';
import DomainAnalyzer from './domain-analyzer';

// Import analysis helpers
import { analyzeCalls } from './analysis/call-analyzer';
import { analyzeUsage } from './analysis/usage-analyzer';
import { analyzeControlFlow } from './analysis/control-flow-analyzer';
import { analyzeAssignments } from './analysis/assignment-analyzer';


const logger = createContextLogger('AstParser');
const TEMP_DIR = path.resolve(process.cwd(), './analysis-data/temp');

// --- Interfaces ---

/**
 * Represents a node in the abstract syntax tree (AST) mapped to a graph node.
 * Contains information about the code element's identity, location, type, and extracted metadata.
 */
export interface AstNode {
  /** Unique instance ID generated during parsing (file-specific). */
  id: string;
  /** Stable, globally unique identifier for the code entity (e.g., 'class:path/to/file:ClassName'). */
  entityId: string;
  /** The kind of code element (e.g., 'Class', 'Function', 'File'). */
  kind: string;
  /** The name of the code element (e.g., function name, class name). */
  name: string;
  /** Absolute path to the file containing this node. */
  filePath: string;
  /** Start line number (1-based). */
  startLine: number;
  /** End line number (1-based). */
  endLine: number;
  /** Start column number (0-based). */
  startColumn: number;
  /** End column number (0-based, exclusive). */
  endColumn: number;
  /** Access modifier ('public', 'private', 'protected'). */
  visibility?: 'public' | 'private' | 'protected';
  /** Indicates if the element is static. */
  isStatic?: boolean;
  /** Indicates if the function/method is async. */
  isAsync?: boolean;
  /** The type signature of the element (e.g., variable type, parameter type). */
  type?: string;
  /** Indicates if a parameter is optional. */
  isOptional?: boolean;
  /** Indicates if a parameter is a rest parameter (...args). */
  isRestParameter?: boolean;
  /** The return type of a function or method. */
  returnType?: string;
  /** List of parameters for a function or method. */
  parameterTypes?: { name: string; type: string }[];
  /** List of properties for a class or interface. */
  memberProperties?: {
      name: string;
      type: string;
      visibility?: 'public' | 'private' | 'protected';
      isStatic?: boolean;
      isReadonly?: boolean;
      startLine: number;
      endLine: number;
      documentation?: string;
  }[];
  /** Extracted documentation (e.g., from JSDoc). */
  documentation?: string;
  /** Inferred semantic role (e.g., 'Controller', 'Service', 'Util'). */
  semanticRole?: string;
  /** Calculated complexity score (e.g., cyclomatic complexity). */
  complexity?: number;
  /** Indicates if a function is pure (no side effects). */
  purity?: boolean;
  /** Raw JSDoc comment text. */
  docComment?: string;
  /** LLM-generated natural language description. */
  naturalLanguageDescription?: string;
  /** Inferred domain concept (e.g., 'Authentication', 'Billing'). */
  domain?: string;
  /** Vector embedding representing the node's semantics. */
  embedding?: number[]; // Added embedding property
  /** LLM-generated summary or analysis. */
  llmSummary?: Record<string, any>;
  /** Additional properties used for specific graph queries or analyses. */
  queryProperties?: {
    isEntryPoint?: boolean;
    isDataStructure?: boolean;
    dependencyCount?: number;
    complexityScore?: number;
    modificationFrequency?: number;
  };
  /** ISO timestamp of when the node was created/updated in the graph. */
  createdAt: string;
}

/**
 * Represents a relationship between two AstNodes in the graph.
 */
export interface RelationshipInfo {
  /** Unique instance ID generated during parsing (file-specific). */
  id: string;
  /** Stable, globally unique identifier for the relationship (e.g., 'calls:functionA_entityId:functionB_entityId'). */
  entityId: string;
  /** The type of the relationship (e.g., 'CALLS', 'CONTAINS', 'IMPORTS'). */
  type: string;
  /** The entityId of the source AstNode. */
  sourceId: string;
  /** The entityId of the target AstNode. */
  targetId: string;
  /** Additional properties specific to the relationship type (e.g., 'isPlaceholder', 'targetName', 'embedding'). */
  properties?: Record<string, any> & { embedding?: number[] }; // Add embedding here
  /** A weight indicating the strength or importance of the relationship. */
  weight?: number;
  /** ISO timestamp of when the relationship was created/updated. */
  createdAt: string;
}

/**
 * Options for configuring the AstParser.
 */
export interface ParserOptions {
  /** TypeScript compiler options to use for parsing. */
  compilerOptions?: Record<string, any>;
  /** Whether to skip parsing files within node_modules directories. Defaults to true. */
  skipNodeModules?: boolean;
}

/**
 * Represents the result of parsing a single source file.
 */
export interface SingleFileParseResult {
    /** The absolute path of the parsed file. */
    filePath: string;
    /** Array of AstNode objects extracted from the file. */
    nodes: AstNode[];
    /** Array of RelationshipInfo objects extracted from the file. */
    relationships: RelationshipInfo[];
}

/**
 * Represents the result of the batch parsing process, which is a list of paths to temporary files
 * containing the SingleFileParseResult for each parsed file.
 */
export type BatchedParserResult = string[];

/**
 * Internal counter used for generating unique instance IDs within a single file parse.
 */
type InstanceCounter = { count: number };

/**
 * Context object passed down through parsing and analysis functions.
 * Provides access to shared resources and helper methods for a single file's processing.
 */
export interface ParserContext {
    /** The accumulating result object for the current file. */
    result: SingleFileParseResult;
    /** The AstNode representing the file being parsed. */
    fileNode: AstNode;
    /** The ts-morph SourceFile object. */
    sourceFile: SourceFile;
    /** The current ISO timestamp for createdAt properties. */
    now: string;
    /** Function to generate a unique instance ID (scoped to the current file parse). */
    generateId: (prefix: string, identifier: string, options?: { line?: number; column?: number }) => string;
    /** Function to generate a stable, globally unique entity ID. */
    generateEntityId: (prefix: string, qualifiedName: string) => string;
    /** Function to add a newly created AstNode to the result. */
    addNode: (node: AstNode) => void;
    /** Function to add a newly created RelationshipInfo to the result. */
    addRelationship: (relationship: RelationshipInfo) => void;
    /** Function to resolve a relative import path to an absolute path. */
    resolveImportPath: (sourcePath: string, importPath: string) => string;
    /** Logger instance for logging messages within the parser context. */
    logger: winston.Logger;
}


/**
 * Parses TypeScript/JavaScript files using ts-morph to extract AST nodes and relationships.
 * Manages a ts-morph project, delegates parsing to specialized sub-parsers,
 * and orchestrates analysis passes (calls, usage, etc.).
 * Saves intermediate results to temporary files for batch processing.
 */
export class AstParser {
  /** The ts-morph Project instance used for parsing. */
  private project: Project;
  /** Parser configuration options. */
  private options: Required<ParserOptions>;

  /**
   * Creates an instance of AstParser.
   * @param options - Optional configuration for the parser.
   */
  constructor(options: ParserOptions = {}) {
    this.options = {
      compilerOptions: options.compilerOptions || {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
        esModuleInterop: true, strict: true, jsx: ts.JsxEmit.React, allowJs: true, declaration: false,
        skipLibCheck: true, experimentalDecorators: true, emitDecoratorMetadata: true, resolveJsonModule: true,
        baseUrl: './', paths: { '@/*': ['src/*'] }, typeRoots: ['./node_modules/@types'],
      },
      skipNodeModules: options.skipNodeModules !== false,
    };
    this.project = new Project({
      compilerOptions: this.options.compilerOptions,
      skipAddingFilesFromTsConfig: true, // We add files manually
      skipFileDependencyResolution: false, // Allow ts-morph to resolve dependencies if needed
    });
    logger.debug('AST Parser initialized', { options: this.options });
  }

  /**
   * Ensures the temporary directory for intermediate results exists.
   */
  private async ensureTempDir(): Promise<void> {
      try {
          await fs.mkdir(TEMP_DIR, { recursive: true });
      } catch (error) {
          throw new FileSystemError(`Failed to create temporary directory: ${TEMP_DIR}`, { originalError: error });
      }
  }

  /**
   * Generates a unique temporary file path based on the source file path.
   * @param sourceFilePath - The absolute path of the source file.
   * @returns The absolute path for the temporary JSON file.
   */
  private getTempFilePath(sourceFilePath: string): string {
      const hash = crypto.createHash('sha256').update(sourceFilePath).digest('hex');
      return path.join(TEMP_DIR, `${hash}.json`);
  }

  /**
   * Parses a single file, extracts nodes and relationships, and saves the result to a temporary file.
   * @param fileInfo - Information about the file to parse.
   * @returns The path to the temporary file containing the parse result, or null if skipped/failed.
   */
  async parseFile(fileInfo: FileInfo): Promise<string | null> {
    const { path: filePath } = fileInfo;
    logger.info(`Parsing file: ${filePath}`);
    try {
      const instanceCounter: InstanceCounter = { count: 0 };

      if (this.options.skipNodeModules && filePath.includes('node_modules')) {
        logger.debug(`Skipping node_modules file: ${filePath}`);
        return null;
      }

      // Add or retrieve the source file from the ts-morph project
      let sourceFile: SourceFile | undefined = this.project.getSourceFile(filePath);
      if (!sourceFile) {
          try {
              // Use addSourceFileAtPathIfExists for robustness, though addSourceFileAtPath is usually fine
              sourceFile = this.project.addSourceFileAtPath(filePath);
              logger.debug(`Added source file: ${filePath}`);
          } catch (error) {
              const err = error instanceof Error ? error : new Error(String(error));
              // Log error but potentially continue if only some files fail to load
              logger.error(`Failed to add source file: ${filePath}`, { error: err.message });
              return null; // Skip this file if it cannot be added
              // throw new ParserError(`Failed to add source file: ${filePath}`, { originalError: err.message });
          }
      }

      if (!sourceFile) {
           logger.error(`Source file object could not be obtained: ${filePath}`);
           return null;
      }

      // Perform the actual parsing of the source file content
      const result = await this.parseSourceFile(sourceFile, instanceCounter);

      // Save the results to a temporary file
      const tempFilePath = this.getTempFilePath(filePath);
      await fs.writeFile(tempFilePath, JSON.stringify(result, null, 2));

      logger.info(`Parsing completed for file: ${filePath}. Result saved to ${path.basename(tempFilePath)}`, {
          nodeCount: result.nodes.length, relationshipCount: result.relationships.length
      });

      return tempFilePath;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to parse file: ${filePath}`, { error: err });
      // Re-throw as a ParserError for consistent error handling upstream
      throw new ParserError(`Failed to parse file: ${filePath}`, { originalError: err.message });
    }
  }

  /**
   * Parses multiple files in batch, saving individual results to temporary files.
   * @param files - An array of FileInfo objects representing the files to parse.
   * @returns A promise resolving to an array of paths to the temporary result files.
   */
  async parseFiles(files: FileInfo[]): Promise<BatchedParserResult> {
    logger.info(`Parsing ${files.length} files...`);
    await this.ensureTempDir();

    const tempFilePaths: string[] = [];

    // Add all source files to the project first to potentially help with cross-file type resolution
    for (const file of files) {
        if (this.options.skipNodeModules && file.path.includes('node_modules')) continue;
        if (!this.project.getSourceFile(file.path)) {
            try {
                this.project.addSourceFileAtPath(file.path);
            } catch (error) {
                logger.warn(`Failed to add source file initially, will skip: ${file.path}`, { error });
            }
        }
    }
    logger.info(`Added ${this.project.getSourceFiles().length} source files to the project.`);

    // Parse each file individually
    // Consider parallelizing this loop using Promise.all if performance becomes an issue
    for (const file of files) {
      // Skip files that couldn't be added earlier
      if (!this.project.getSourceFile(file.path)) continue;

      try {
        const tempPath = await this.parseFile(file);
        if (tempPath) {
            tempFilePaths.push(tempPath);
        }
      } catch (error) {
        // Log error from parseFile but continue with other files
        logger.warn(`Skipping file due to error during parsing: ${file.path}`, { error });
      }
    }

    // Clear project files after parsing is complete to free up memory
    this.project.getSourceFiles().forEach(sf => this.project.removeSourceFile(sf));
    logger.debug('Cleared ts-morph project source files.');

    logger.info(`Parsing phase completed. Generated ${tempFilePaths.length} temporary result files.`);
    return tempFilePaths;
  }

  /**
   * Parses the content of a single ts-morph SourceFile.
   * Creates File and Directory nodes, then delegates to specialized parsers and analyzers.
   * @param sourceFile - The ts-morph SourceFile object.
   * @param instanceCounter - Counter for generating unique instance IDs within this file.
   * @returns The parse result containing nodes and relationships for this file.
   */
  private async parseSourceFile(sourceFile: SourceFile, instanceCounter: InstanceCounter): Promise<SingleFileParseResult> {
    const filePath = sourceFile.getFilePath();
    const fileName = path.basename(filePath);
    const now = new Date().toISOString();
    logger.debug(`Parsing source file content: ${fileName}`);

    const result: SingleFileParseResult = { filePath, nodes: [], relationships: [] };

    // Create context for helper functions, passing necessary methods and data
    const context: ParserContext = {
        result, sourceFile, now,
        generateId: (prefix, identifier, options) => this._generateId(instanceCounter, prefix, identifier, options),
        generateEntityId: this.generateEntityId.bind(this),
        addNode: (node) => this.addNode(result, node),
        addRelationship: (rel) => this.addRelationship(result, rel),
        resolveImportPath: this.resolveImportPath.bind(this),
        logger: logger,
        fileNode: {} as AstNode // Placeholder, will be replaced below
    };

    try {
      // --- Create File Node ---
      const fileEntityId = context.generateEntityId('file', filePath);
      const fileNode: AstNode = {
        id: context.generateId('file', filePath),
        entityId: fileEntityId,
        kind: 'File', name: fileName, filePath,
        startLine: 0, // File node represents the whole file
        endLine: sourceFile.getEndLineNumber(),
        startColumn: 0,
        endColumn: 0, // End column not applicable for file
        createdAt: now,
        domain: DomainAnalyzer.inferDomain({ filePath, kind: 'File', name: fileName } as any), // Infer domain
      };
      context.fileNode = fileNode; // Assign the created file node to the context
      context.addNode(fileNode);

      // --- Create Directory Node & CONTAINS Relationship ---
      const dirPath = path.dirname(filePath);
      const dirName = path.basename(dirPath) || dirPath; // Handle root directory case
      const directoryEntityId = context.generateEntityId('directory', dirPath);

      // Check if directory node already exists in this file's result (unlikely but safe)
      let directoryNode = result.nodes.find(n => n.entityId === directoryEntityId);
      if (!directoryNode) {
          directoryNode = {
            id: context.generateId('directory', dirPath),
            entityId: directoryEntityId,
            kind: 'Directory', name: dirName, filePath: dirPath,
            startLine: 0, endLine: 0, startColumn: 0, endColumn: 0,
            createdAt: now,
            domain: DomainAnalyzer.inferDomain({ filePath: dirPath, kind: 'Directory', name: dirName } as any), // Infer domain
          };
          context.addNode(directoryNode);
      }

      // Add relationship: Directory -> CONTAINS -> File
      const containsRelEntityId = context.generateEntityId('contains', `${directoryEntityId}:${fileEntityId}`);
      context.addRelationship({
        id: context.generateId('contains', `${directoryNode.id}:${fileNode.id}`),
        entityId: containsRelEntityId, type: 'CONTAINS',
        sourceId: directoryEntityId, targetId: fileEntityId,
        weight: 1, createdAt: now,
      });

      // --- Delegate Parsing to Helpers ---
      // These functions will add nodes and relationships to context.result
      parseClasses(context);
      parseInterfaces(context);
      parseFunctions(context);
      parseVariables(context);
      parseModules(context);
      parseTypeAliases(context);

      // --- Delegate Body Analysis ---
      // Analyze bodies of functions/methods found during parsing
      // Note: Analysis helpers might need access to the full list of nodes later for resolution
      // For now, they operate within the context of their parent node (function/method)
      result.nodes.forEach(parentNode => {
          if (parentNode.kind === 'Function' || parentNode.kind === 'Method') {
              // Find the corresponding ts-morph node to get the body
              // Use getFirstDescendant and add type Node to callback parameter
              const tsMorphNode = sourceFile.getFirstDescendant(
                  (node: Node) => (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) &&
                            node.getStart() === (parentNode.startColumn + sourceFile.getLineAndColumnAtPos(parentNode.startLine).column) // Approximate check - might need refinement
              );
              let body: Node | undefined = undefined;
              // Use specific type guards to safely access getBody()
              if (tsMorphNode) {
                  if (Node.isFunctionDeclaration(tsMorphNode) || Node.isMethodDeclaration(tsMorphNode) || Node.isFunctionExpression(tsMorphNode)) {
                      body = tsMorphNode.getBody();
                  } else if (Node.isArrowFunction(tsMorphNode)) {
                      body = tsMorphNode.getBody(); // Arrow functions also have getBody()
                  }
              }

              if (body) {
                  analyzeCalls(body, parentNode, context);
                  analyzeUsage(body, parentNode, context);
                  analyzeControlFlow(body, parentNode, context);
                  // analyzeAssignments(body, parentNode, context); // If needed
              }
          }
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Error parsing source file content: ${filePath}`, { error: err });
      // Return potentially partial results if an error occurs mid-parse
      return result;
    }
  }

  // --- Helper Methods ---

  /** Adds a node to the result object for the current file. */
  private addNode(result: SingleFileParseResult, node: AstNode): void {
      // Optional: Add validation or checks before pushing
      result.nodes.push(node);
  }

  /** Adds a relationship to the result object for the current file. */
  private addRelationship(result: SingleFileParseResult, relationship: RelationshipInfo): void {
      // Optional: Add validation or checks before pushing
      result.relationships.push(relationship);
  }

  /**
   * Resolves a relative import path to an absolute path, attempting to find the correct file extension.
   * @param sourcePath - The absolute path of the file containing the import.
   * @param importPath - The relative or module path string from the import statement.
   * @returns The resolved absolute path or the original importPath if it's likely a node module.
   */
  private resolveImportPath(sourcePath: string, importPath: string): string {
    // If it's not a relative path, assume it's a node module or alias (handled later)
    if (!importPath.startsWith('.')) return importPath;

    const sourceDir = path.dirname(sourcePath);
    let resolvedPath = path.resolve(sourceDir, importPath);

    // Attempt to resolve extension if missing
    if (!path.extname(resolvedPath)) {
        const extensions = ['.ts', '.tsx', '.js', '.jsx', '.json'];
        let found = false;
        // Check for file with extension
        for (const ext of extensions) {
            try {
                if (fsSync.statSync(resolvedPath + ext).isFile()) {
                     resolvedPath += ext; found = true; break;
                }
            } catch { /* Ignore */ }
        }
         // Check for index file in directory
         if (!found) { // Removed redundant !path.extname check
             for (const ext of extensions) {
                 const indexPath = path.join(resolvedPath, `index${ext}`);
                 try {
                     if (fsSync.statSync(indexPath).isFile()) {
                         resolvedPath = indexPath; found = true; break; // Added found = true
                     }
                 } catch { /* Ignore */ }
             }
         }
         // If still not found, return the original resolved path without extension
         // The relationship resolver might handle this later based on available nodes
    }
    // Normalize path separators
    return resolvedPath.replace(/\\/g, '/');
  }

  /**
   * Generates a stable, unique identifier for a code entity based on its type and qualified name.
   * @param prefix - The type of the entity (e.g., 'class', 'function').
   * @param qualifiedName - A unique name within the project context (e.g., 'path/to/file:ClassName').
   * @returns The generated entity ID.
   */
  private generateEntityId(prefix: string, qualifiedName: string): string {
    // Normalize path separators and sanitize characters
    const safeIdentifier = qualifiedName.replace(/\\/g, '/').replace(/[^a-zA-Z0-9_.:/-]/g, '_');
    return `${prefix}:${safeIdentifier}`;
  }

  /**
   * Generates a unique instance ID for a node or relationship within the context of a single file parse.
   * Uses a counter to ensure uniqueness within the file. Includes position info if available.
   * @param instanceCounter - The counter object for the current file parse.
   * @param prefix - The type of the element (e.g., 'class', 'function', 'calls').
   * @param identifier - A descriptive identifier (e.g., qualified name, source:target).
   * @param options - Optional line and column numbers for added uniqueness.
   * @returns The generated instance ID.
   */
  private _generateId(instanceCounter: InstanceCounter, prefix: string, identifier: string, options: { line?: number; column?: number } = {}): string {
    const safeIdentifier = identifier.replace(/\\/g, '/').replace(/[^a-zA-Z0-9_.:/-]/g, '_');
    let contextSuffix = '';
    // Always include line and column if available for max uniqueness
    if (options.line !== undefined) contextSuffix += `:L${options.line}`;
    if (options.column !== undefined) contextSuffix += `:C${options.column}`;
    const counter = ++instanceCounter.count; // Increment counter for uniqueness within the file
    const id = `${prefix}:${safeIdentifier}${contextSuffix}:${counter}`;
    return id;
  }
}

// Export singleton instance
export default new AstParser();