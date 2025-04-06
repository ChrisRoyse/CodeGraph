// packages/analyzer-core/src/analyzer/parser.ts
import path from 'path';
import * as crypto from 'crypto';
import fs from 'fs/promises';
import { Project, ScriptKind, SourceFile as TsMorphSourceFile } from 'ts-morph';
import ts from 'typescript';
// Import types directly from tree-sitter
import type { default as TreeSitterParser, Language as TreeSitterLanguageType } from 'tree-sitter';
import { FileInfo } from '../scanner/file-scanner.js';
import { Language } from '../types/index.js';
import { AstNode, RelationshipInfo, SingleFileParseResult, FileNode, ParserContext } from './types.js';
import { PythonParser } from './python-parser.js'; // Corrected import name
import { CCppParser } from './parsers/c-cpp-parser.js';
import { JavaParser } from './parsers/java-parser.js';
import { GoParser } from './parsers/go-parser.js';
import { CSharpParser } from './parsers/csharp-parser.js';
import { SqlParser } from './parsers/sql-parser.js';
import { parseFunctions } from './parsers/function-parser.js';
import { parseClasses } from './parsers/class-parser.js';
import { parseVariables } from './parsers/variable-parser.js';
import { parseInterfaces } from './parsers/interface-parser.js';
import { parseTypeAliases } from './parsers/type-alias-parser.js';
import { parseJsx } from './parsers/jsx-parser.js';
import { parseImports } from './parsers/import-parser.js';
import { createContextLogger } from '../utils/logger.js';
import { ParserError } from '../utils/errors.js';
import { config } from '../config/index.js'; // Add .js extension back
import { generateEntityId, generateInstanceId, getTempFilePath, generateRelationshipId } from './parser-utils.js';
import { SymbolTable } from './analysis/symbol-table.js';

const logger = createContextLogger('Parser');

/**
 * Orchestrates the parsing process for different languages.
 */
export class Parser {
    private tsProject: Project;
    // private pythonParser: PythonParser; // Removed: ParserFactory handles specific parsers
    private cppParser: CCppParser | null = null;
    private javaParser: JavaParser | null = null;
    private goParser: GoParser | null = null;
    private csharpParser: CSharpParser | null = null;
    private symbolTable: SymbolTable; // Keep declaration here
    private tsResults: Map<string, SingleFileParseResult> = new Map();
    // Stores paths to temp JSON files containing *structured* SingleFileParseResult data
    private tempJsonResultPaths: Set<string> = new Set();
    private sharedParser: TreeSitterParser | null = null;

    constructor() {
        this.symbolTable = new SymbolTable(); // Initialize symbolTable first
        this.tsProject = new Project({ tsConfigFilePath: 'tsconfig.json' });
        // Language parsers are now initialized in setSharedParser
        logger.info('Parser constructed.');
    }

    setSharedParser(parser: TreeSitterParser): void {
        this.sharedParser = parser;
        // Initialize language-specific parsers now that we have the shared TreeSitterParser
        this.cppParser = new CCppParser(parser);
        this.javaParser = new JavaParser(parser);
        this.goParser = new GoParser(parser);
        this.csharpParser = new CSharpParser(parser);
        // TODO: Instantiate SqlParser if needed
        logger.info('Shared TreeSitterParser instance set and language parsers initialized.');
    }

    async parseFileGroup(files: FileInfo[]): Promise<void> {
        const parser = this.sharedParser;
        if (!parser) throw new ParserError('Shared parser instance not set.');
        if (files.length === 0) return;

        const firstFile = files[0];
        if (!firstFile || !firstFile.language) {
             logger.error(`First file in group lacks language information.`);
             return;
        }
        const langEnum = firstFile.language;
        logger.info(`Starting Pass 1 processing for ${files.length} ${langEnum} files...`);
        const parsePromises: Promise<void>[] = [];
        const tsFilesToAdd: string[] = [];

        for (const file of files) {
            let processPromise: Promise<void> | null = null;
            try {
                 switch (langEnum) {
                    case Language.Python:
                        // Python parsing is now handled by the generic LanguageParser case using ParserFactory
                        // processPromise = this.pythonParser.parseFile(file, this.symbolTable) // Removed old call
                        //     .then((tempPath: string | undefined) => { if (tempPath) this.tempJsonResultPaths.add(tempPath); })
                        //     .catch((err: Error) => { logger.error(`Python parsing failed for ${file.path}: ${err.message}`); });
                        // The actual parsing for Python will happen within the generic LanguageParser logic
                        // which should be added/refactored in this switch statement.
                        // For now, we'll let it fall through or add a placeholder.
                        logger.warn(`Python parsing logic needs integration into the generic parser flow.`);
                        processPromise = Promise.resolve(); // Placeholder
                        break;
                    // --- Placeholder cases ---
                    case Language.C: case Language.CPP: logger.warn(`C/C++ parsing logic needs refactoring.`); processPromise = Promise.resolve(); break;
                    case Language.Java: logger.warn(`Java parsing logic needs refactoring.`); processPromise = Promise.resolve(); break;
                    case Language.Go: logger.warn(`Go parsing logic needs refactoring.`); processPromise = Promise.resolve(); break;
                    case Language.CSharp: logger.warn(`C# parsing logic needs refactoring.`); processPromise = Promise.resolve(); break;
                    case Language.SQL: logger.warn(`SQL parsing logic needs integration.`); processPromise = Promise.resolve(); break;
                    // --- TS/JS Handling ---
                    case Language.TypeScript: case Language.TSX: case Language.JavaScript:
                        if (!this.tsProject.getSourceFile(file.path)) tsFilesToAdd.push(file.path);
                        processPromise = Promise.resolve(); break;
                    default: logger.warn(`Unsupported language group: ${langEnum}`); processPromise = Promise.resolve();
                }
            } catch (error: any) {
                 logger.error(`Error initiating processing for ${file.path}: ${error.message}`);
                 processPromise = Promise.resolve();
            }
             if (processPromise) {
                 parsePromises.push(processPromise.catch(err => { logger.error(`Unhandled error during processing for ${file.path}: ${err.message}`); }));
             }
        }

        if (tsFilesToAdd.length > 0) {
             this.tsProject.addSourceFilesAtPaths(tsFilesToAdd);
             logger.info(`Added ${tsFilesToAdd.length} TS/JS files to project.`);
             const addedSourceFiles = tsFilesToAdd.map(p => this.tsProject.getSourceFileOrThrow(p));
             await this._parseTsSourceFiles(addedSourceFiles);
        }

        await Promise.all(parsePromises);
        logger.info(`Pass 1 processing completed for ${langEnum} file group.`);
    }

    async parseSingleFile(fileInfo: FileInfo): Promise<SingleFileParseResult | null> {
        // Simplified - primarily handles TS/JS for watcher updates
        const parser = this.sharedParser;
        if (!parser) throw new ParserError('Shared parser instance not set.');
        const filePath = fileInfo.path;
        logger.info(`[parseSingleFile] Starting parsing for: ${fileInfo.name}`);
        try {
            let result: SingleFileParseResult | null = null;
            const langEnum = fileInfo.language;
            if (!langEnum) { logger.error(`[parseSingleFile] FileInfo lacks language: ${filePath}`); return null; }

            if ([Language.TypeScript, Language.TSX, Language.JavaScript].includes(langEnum as Language)) {
                 const sourceFile = this.tsProject.getSourceFile(filePath) ?? this.tsProject.addSourceFileAtPath(filePath);
                 if (sourceFile) {
                     await sourceFile.refreshFromFileSystem();
                     result = this._parseSingleTsSourceFile(sourceFile);
                     if (result) this.tsResults.set(filePath.replace(/\\/g, '/'), result);
                     else logger.warn(`[parseSingleFile] _parseSingleTsSourceFile returned null for: ${filePath}`);
                 } else { logger.error(`[parseSingleFile] Could not find/add source file: ${filePath}`); return null; }
            } else {
                logger.warn(`[parseSingleFile] Parsing non-TS files individually not fully implemented: ${filePath}`);
                // If needed, could call pythonParser.parseFile here and store path in tempJsonResultPaths
                return null;
            }
            return result;
        } catch (error: any) { logger.error(`[parseSingleFile] Failed: ${filePath}: ${error.message}`); return null; }
    }

    async collectSingleFileResults(absoluteFilePath: string): Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }> {
        // Reads structured data from temp file if not found in memory (tsResults)
        const normalizedPath = absoluteFilePath.replace(/\\/g, '/');
        logger.debug(`[collectSingleFileResults] Collecting results for: ${normalizedPath}`);
        if (this.tsResults.has(normalizedPath)) {
            const result = this.tsResults.get(normalizedPath)!;
            this.tsResults.delete(normalizedPath);
            return { nodes: result.nodes || [], relationships: result.relationships || [] };
        } else {
            const tempPath = getTempFilePath(normalizedPath);
            if (this.tempJsonResultPaths.has(tempPath)) {
                 logger.info(`[collectSingleFileResults] Reading structured temp JSON: ${path.basename(tempPath)}`);
                 try {
                     const fileContent = await fs.readFile(tempPath, 'utf-8');
                     const result = JSON.parse(fileContent) as SingleFileParseResult; // Parse directly
                     this.tempJsonResultPaths.delete(tempPath);
                     await fs.unlink(tempPath);
                     return { nodes: result.nodes || [], relationships: result.relationships || [] };
                 } catch (error: any) {
                     logger.error(`[collectSingleFileResults] Failed read/parse structured temp file ${tempPath}: ${error.message}`);
                     this.tempJsonResultPaths.delete(tempPath);
                     try { await fs.unlink(tempPath); } catch { /* ignore */ }
                     return { nodes: [], relationships: [] };
                 }
            } else { return { nodes: [], relationships: [] }; }
        }
    }


     /**
     * Collects all nodes and relationships from temporary JSON files (non-TS)
     * and from in-memory TS results. Assumes JSON files contain structured data.
     * Uses Maps to ensure entityId uniqueness.
     * @returns An object containing arrays of all nodes and relationships.
     */
     async collectResults(): Promise<{ allNodes: AstNode[], allRelationships: RelationshipInfo[] }> {
        logger.info('Starting collection of Pass 1 results (JSON + TS)...');
        const nodeMap = new Map<string, AstNode>();
        const relationshipMap = new Map<string, RelationshipInfo>();

        // 1. Process results from temporary JSON files (Python, C++, etc.)
        logger.info(`Processing results from ${this.tempJsonResultPaths.size} temporary JSON files...`);
        const processedTempPaths = new Set<string>();

        for (const tempPath of this.tempJsonResultPaths) {
            try {
                logger.debug(`Reading structured temp result file: ${path.basename(tempPath)}`);
                const fileContent = await fs.readFile(tempPath, 'utf-8');
                // Parse directly into the expected structure
                const result = JSON.parse(fileContent) as SingleFileParseResult;

                if (!result || !Array.isArray(result.nodes) || !Array.isArray(result.relationships)) {
                    logger.warn(`Invalid structure in structured temp file ${tempPath}. Skipping.`);
                    continue;
                }

                // Merge nodes (already AstNode structure)
                for (const node of result.nodes) {
                    if (!node || !node.entityId) {
                        logger.warn(`Skipping node with missing entityId in ${tempPath}`);
                        continue;
                    }
                    if (typeof node.filePath !== 'string' || typeof node.name !== 'string' || typeof node.kind !== 'string') {
                         logger.warn(`Skipping node with missing or invalid core properties in ${tempPath}: ${node.entityId}`);
                         continue;
                    }
                    if (nodeMap.has(node.entityId)) {
                         logger.warn(`[collectResults-JSON] Overwriting node with duplicate entityId: ${node.entityId}`);
                    }
                    nodeMap.set(node.entityId, node);
                }
                // Merge relationships (already RelationshipInfo structure)
                for (const rel of result.relationships) {
                     // Ensure the relationship object has the required fields for RelationshipInfo
                     if (!rel || !rel.entityId || !rel.sourceId || !rel.targetId || typeof rel.type !== 'string') {
                         logger.warn(`Skipping relationship with missing IDs/type in ${tempPath}: ${JSON.stringify(rel)}`);
                         continue;
                     }
                     // Check if source and target nodes exist in our collected nodes
                     // This check is crucial because the python script might generate relationships
                     // pointing to FQNs that don't correspond to nodes it generated (e.g., built-ins like 'print')
                     if (!nodeMap.has(rel.sourceId) || !nodeMap.has(rel.targetId)) {
                         logger.warn(`Skipping relationship ${rel.entityId} because source (${rel.sourceId}) or target (${rel.targetId}) node not found in nodeMap.`);
                         continue;
                     }

                     if (relationshipMap.has(rel.entityId)) {
                         logger.warn(`[collectResults-JSON] Overwriting relationship with duplicate entityId: ${rel.entityId}`);
                     }
                     // Cast to RelationshipInfo as it should now conform
                     relationshipMap.set(rel.entityId, rel as RelationshipInfo);
                }
                processedTempPaths.add(tempPath);

            } catch (error: any) {
                logger.error(`Failed to read or parse structured temp file ${tempPath}: ${error.message}`);
                processedTempPaths.add(tempPath);
            }
        }

        // Cleanup processed temp files
        for (const tempPath of processedTempPaths) {
             try {
                 await fs.unlink(tempPath);
                 logger.debug(`Deleted temp file: ${path.basename(tempPath)}`);
             } catch (unlinkError: any) {
                 logger.warn(`Failed to delete temp file ${tempPath}: ${unlinkError.message}`);
             }
        }
        this.tempJsonResultPaths.clear();

        // 2. Add results from in-memory TS parsing
        logger.info(`Adding results from ${this.tsResults.size} parsed TS/JS files...`);
        for (const [filePath, result] of this.tsResults.entries()) {
            for (const node of result.nodes) {
                 if (!node || !node.entityId) continue;
                 if (nodeMap.has(node.entityId)) logger.warn(`[collectResults-TS] Overwriting node: ${node.entityId}`);
                 nodeMap.set(node.entityId, node);
            }
            for (const rel of result.relationships) {
                 if (!rel || !rel.entityId) continue;
                 if (relationshipMap.has(rel.entityId)) logger.warn(`[collectResults-TS] Overwriting relationship: ${rel.entityId}`);
                 relationshipMap.set(rel.entityId, rel);
            }
        }
        this.tsResults.clear();


        const allNodes = Array.from(nodeMap.values());
        const allRelationships = Array.from(relationshipMap.values());

        logger.info(`Collected ${allNodes.length} unique nodes and ${allRelationships.length} unique relationships from all sources.`);
        return { allNodes, allRelationships };
    }

    // Removed _structureNode and _structureRelationship helper methods

    private _parseSingleTsSourceFile(sourceFile: TsMorphSourceFile): SingleFileParseResult | null {
        const filePath = sourceFile.getFilePath().replace(/\\/g, '/');
        const now = new Date().toISOString();
        const instanceCounter = { count: 0 };
        logger.debug(`Parsing TS/JS file: ${filePath}`);

        const fileEntityId = generateEntityId('file', filePath);
        const fileNode: FileNode = {
            id: generateInstanceId(instanceCounter, 'file', path.basename(filePath)),
            entityId: fileEntityId,
            kind: 'File',
            labels: ['File'], // Add labels for TS nodes too
            name: path.basename(filePath),
            filePath: filePath,
            language: sourceFile.getScriptKind() === ScriptKind.JSX || sourceFile.getScriptKind() === ScriptKind.TSX ? Language.TSX : Language.TypeScript,
            startLine: 1,
            endLine: sourceFile.getEndLineNumber(),
            startColumn: 0,
            endColumn: 0,
            loc: sourceFile.getEndLineNumber(),
            createdAt: now,
        };

        const result: SingleFileParseResult = {
            filePath: filePath,
            nodes: [fileNode],
            relationships: [],
        };

        const addNode = (node: AstNode) => { result.nodes.push(node); };
        const addRelationship = (rel: RelationshipInfo) => { result.relationships.push(rel); };

        const context: ParserContext = {
            filePath: filePath,
            sourceFile: sourceFile,
            fileNode: fileNode,
            result: result,
            addNode: addNode,
            addRelationship: addRelationship,
            generateId: (prefix: string, identifier: string, options?: { line?: number; column?: number }) =>
                generateInstanceId(instanceCounter, prefix, identifier, options),
            generateEntityId: generateEntityId,
            generateRelationshipId: generateRelationshipId, // Add the missing function
            logger: createContextLogger(`Parser-${path.basename(filePath)}`),
            resolveImportPath: (source: string, imp: string) => { return imp; }, // Placeholder
            now: now,
        };

        try {
            parseImports(context);
            parseFunctions(context);
            parseClasses(context);
            parseVariables(context);
            parseInterfaces(context);
            parseTypeAliases(context);
            if (context.fileNode.language === Language.TSX) {
               parseJsx(context);
            }

            logger.debug(`Finished parsing TS/JS file: ${filePath}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}`);
            return result;

        } catch (error: any) {
            logger.error(`Error parsing TS/JS file ${filePath}: ${error.message}`, { stack: error.stack?.substring(0, 300) });
            return null;
        }
    }

    getTsProject(): Project {
        return this.tsProject;
    }

    private async _parseTsSourceFiles(sourceFiles: TsMorphSourceFile[]): Promise<void> {
        logger.info(`Starting parsing for ${sourceFiles.length} provided TS/JS source files.`);
        for (const sourceFile of sourceFiles) {
            const filePath = sourceFile.getFilePath().replace(/\\/g, '/');
            const result = this._parseSingleTsSourceFile(sourceFile);
            if (result) {
               this.tsResults.set(filePath, result);
            }
        }
        logger.info(`Finished parsing ${sourceFiles.length} provided TS/JS files.`);
    }
}

function ensureTsConfig(project: Project): void {
    const currentSettings = project.compilerOptions.get();
    if (!currentSettings.jsx) {
        project.compilerOptions.set({ jsx: ts.JsxEmit.React });
        logger.info('Set default JSX compiler option for ts-morph project.');
    }
}