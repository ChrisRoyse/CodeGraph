// src/analyzer/analyzer-service.ts
import fs from 'fs/promises'; // Use fs promises for reading files
import path from 'path';
import { FileScanner, FileInfo } from '../scanner/file-scanner.js';
import { ParserFactory } from './parsers/parser-factory.js';
import type { default as TreeSitterParser } from 'tree-sitter'; // Need the type for the shared parser instance
import { RelationshipResolver } from './relationship-resolver.js';
// import { ResolverOrchestrator } from './relationship-resolver.js'; // Removed legacy import
import { StorageManager, EntityIdMap } from './storage-manager.js';
import { AstNode, RelationshipInfo, LanguageParser } from './types.js';
import { Language } from '../types/index.js';
import { createContextLogger } from '../utils/logger.js'; // Removed incorrect Logger import
import { config } from '../config/index.js'; // Ensure named import is used
import { Neo4jClient } from '../database/neo4j-client.js';
import { Neo4jError } from '../utils/errors.js';
import { getLanguageFromFileInfo } from './parser-utils.js';
// Import specific parser implementations (adjust paths/names as needed)
import { TypeScriptParser } from './parsers/typescript-parser.js'; // Re-added .js extension per TS error
import { PythonParser } from './python-parser.js'; // Path from open tabs
import { SqlParser } from './parsers/sql-parser.js';
import { GoParser } from './parsers/go-parser.js';
import { JavaParser } from './parsers/java-parser.js';
import { CSharpParser } from './parsers/csharp-parser.js';
import { CCppParser } from './parsers/c-cpp-parser.js'; // Corrected import name

// --- IR Imports ---
import { convertSourceToIr } from '../ir/source-to-ir-converter.js';
import { analyzeIr, IrAnalysisResult } from '../ir/ir-analyzer.js';
import { addIdToElement } from '../ir/ir-utils.js'; // Renamed import
import { FileIr, IrElement, PotentialRelationship, Language as IrLanguage } from '../ir/schema.js'; // Updated imports
// --- End IR Imports ---

// [Duplicate IR Imports Removed]

const logger = createContextLogger('AnalyzerService');

/**
 * Orchestrates the code analysis process: scanning, parsing, resolving, and storing.
 */
export class AnalyzerService {
    // Removed parser property
    // Removed analysisParser property
    private relationshipResolver: RelationshipResolver | null = null;
    private storageManager: StorageManager;
    private neo4jClient: Neo4jClient;
    // Removed ParserFactory instance variable, methods are static now
    // Accept dependencies via constructor
    constructor(neo4jClient: Neo4jClient, storageManager: StorageManager) {
        // Removed analysisParser instantiation
        this.neo4jClient = neo4jClient;
        this.storageManager = storageManager;
        // Removed ParserFactory instantiation
        logger.info('AnalyzerService constructed with injected dependencies. Call initialize() before use.');
    }

    /**
     * Initializes the AnalyzerService, ensuring the Tree-sitter parser is ready.
     * Must be called before calling analyze() or analyzeSingleFile().
     */
    async initialize(): Promise<void> {
        // Ensure ParserFactory (static) is initialized
        try {
            logger.info('Initializing ParserFactory...');
            // ParserFactory initialization is now handled internally by its static client instance.
            // No explicit initialization call needed here.
            // Removed logic related to instance parserFactory
            logger.info('AnalyzerService initialized successfully.');
        } catch (error) {
            logger.error('Failed to initialize AnalyzerService:', error);
            throw new Error('AnalyzerService initialization failed.');
        }
    }

    /**
     * Runs the full analysis pipeline for a given directory.
     * Clears the entity ID cache before starting.
     * @param directory - The root directory to analyze.
     */
    async analyze(directory: string): Promise<void> {
        await this.initialize(); // Ensure service is initialized
        // Removed check for this.parser

        logger.info(`Starting analysis for directory: ${directory}`);
        const absoluteDirectory = path.resolve(directory);
        let scanner: FileScanner;

        // --- Old Tree-sitter based accumulators (commented out/replaced) ---
        // Initialize accumulators for all nodes and relationships
        // let allNodes: AstNode[] = [];
        // let allRelationships: RelationshipInfo[] = [];
        // --- End Old Accumulators ---
        let allElements: IrElement[] = []; // Accumulator for new IR elements
        let allPotentialRelationships: PotentialRelationship[] = []; // Accumulator for potential relationships
        const projectId = path.basename(absoluteDirectory); // Use directory name as placeholder project ID

        try {
            // 0. Clear Entity ID Cache for full analysis run
            logger.info('Clearing persistent entity ID cache...');
            await this.storageManager.clearEntityIdMap();

            // Instantiate FileScanner here with directory and config
            // Use config.supportedExtensions and config.ignorePatterns directly
            scanner = new FileScanner(absoluteDirectory, config.supportedExtensions, config.ignorePatterns);

            // 1. Scan Files
            logger.info('Scanning files...');
            const files: FileInfo[] = await scanner.scan(); // No argument needed
            if (files.length === 0) {
                logger.warn('No files found to analyze.');
                return;
            }
            logger.info(`Found ${files.length} files.`);

            // --- New IR Conversion Step ---
            logger.info('Converting files to Intermediate Representation (IR)...');
            for (const file of files) {
                const langEnum = getLanguageFromFileInfo(file);
                const irLang = mapToIrLanguage(langEnum); // Map local Language enum to IR Language enum

                if (!irLang) {
                    logger.warn(`Skipping file with unknown or unsupported language for IR conversion: ${file.path}`);
                    continue;
                }

                try {
                    const fileContent = await fs.readFile(file.path, 'utf-8');
                    logger.debug(`Converting file to IR: ${file.path}`);

                    // Convert source to FileIr object
                    // Pass the derived projectId
                    const fileIr = await convertSourceToIr(fileContent, file.path, irLang, projectId);

                    // Generate and add IDs to each element within the FileIr
                    const elementsWithIds: IrElement[] = fileIr.elements.map(element => {
                        try {
                            // addIdToElement modifies the object in place and returns it
                            // Pass the derived projectId
                            return addIdToElement(element, projectId);
                        } catch (idError: any) {
                            logger.error(`Failed to generate ID for an element in ${file.path}: ${idError.message}`, { elementName: element.name });
                            return null; // Mark element as failed for ID generation
                        }
                    }).filter((element): element is IrElement => element !== null); // Filter out elements where ID generation failed

                    allElements.push(...elementsWithIds);
                    // Add potential relationships, ensuring sourceIds match generated element IDs
                    // (Assuming addIdToElement correctly mutated the elements array)
                    allPotentialRelationships.push(...fileIr.potentialRelationships);

                    logger.debug(`Processed ${file.path}: ${elementsWithIds.length} elements with IDs, ${fileIr.potentialRelationships.length} potential relationships.`);

                } catch (fileConvertError: any) {
                    logger.error(`Failed to convert file ${file.path} to IR: ${fileConvertError.message}`, { stack: fileConvertError.stack });
                    // Continue with the next file
                }
            }
            logger.info(`Total collected from IR conversion: ${allElements.length} elements, ${allPotentialRelationships.length} potential relationships.`);
            // --- End New IR Conversion Step ---


            // --- Old Tree-sitter Parsing Logic (Commented Out) ---
            /*
            logger.info('Parsing files by language...');
            const filesByLanguage = new Map<Language, FileInfo[]>();
             for (const file of files) {
                 const langEnum = getLanguageFromFileInfo(file);
                 if (langEnum && langEnum !== Language.Unknown) {
                     file.language = langEnum;
                     if (!filesByLanguage.has(langEnum)) {
                         filesByLanguage.set(langEnum, []);
                     }
                     filesByLanguage.get(langEnum)!.push(file);
                 } else {
                     logger.warn(`Skipping file with unknown or unsupported language type: ${file.path}`);
                 }
             }
             // Iterate over language groups and parse
             for (const [lang, filesForLang] of filesByLanguage.entries()) {
                 if (!filesForLang || filesForLang.length === 0) continue;

                 logger.info(`Preparing to parse ${filesForLang.length} ${lang} files...`);
                 let languageParserInstance: LanguageParser | null = null;
                 try {
                     // 1. Get shared parser instance and language grammar
                     const sharedParser: TreeSitterParser = await ParserFactory.getParser();
                     const loadedGrammarObject = await ParserFactory.getLanguage(lang);

                     // *** Add Detailed Logging for SQL Grammar Object ***
                     if (lang === Language.SQL) {
                         logger.info(`[AnalyzerService Debug] Loaded SQL grammar object type: ${typeof loadedGrammarObject}`);
                         if (loadedGrammarObject && typeof loadedGrammarObject === 'object') {
                             logger.info(`[AnalyzerService Debug] SQL grammar object keys: ${Object.keys(loadedGrammarObject)}`);
                         } else {
                              logger.info(`[AnalyzerService Debug] SQL grammar object is not an object or is null/undefined.`);
                         }
                     }
                     // *** End Detailed Logging ***

                     // Assume ParserFactory.getLanguage returns the correct grammar object directly
                     const finalGrammar = loadedGrammarObject;
                         : loadedGrammarObject;

                     if (!finalGrammar) {
                         throw new Error(`Final grammar object resolved to null/undefined for language ${lang}.`);
                     }

                     // Use the potentially nested grammar object
                     sharedParser.setLanguage(finalGrammar); // Configure the shared parser

                     // 2. Instantiate the correct LanguageParser implementation
                     switch (lang) {
                         case Language.TypeScript:
                         case Language.JavaScript:
                         case Language.TSX:
                             languageParserInstance = new TypeScriptParser(sharedParser); // Pass shared parser
                             break;
                         case Language.Python:
                             languageParserInstance = new PythonParser(sharedParser); // Pass shared parser
                             break;
                         case Language.SQL:
                             languageParserInstance = new SqlParser(sharedParser); // Pass shared parser
                             break;
                         case Language.Go:
                             languageParserInstance = new GoParser(sharedParser); // Pass shared parser
                             break;
                         case Language.Java:
                             languageParserInstance = new JavaParser(sharedParser); // Pass shared parser
                             break;
                         case Language.CSharp:
                             languageParserInstance = new CSharpParser(sharedParser); // Pass shared parser
                             break;
                         case Language.C:
                         case Language.CPP:
                             languageParserInstance = new CCppParser(sharedParser); // Use corrected class name
                             break;
                         default:
                             logger.warn(`No specific LanguageParser implemented for ${lang}. Skipping files.`);
                             continue; // Skip to the next language group
                     }

                     // 3. Parse each file in the group using the instance
                     logger.info(`Parsing ${filesForLang.length} ${lang} files...`);
                     if (!languageParserInstance) {
                         logger.error(`Parser instance for ${lang} was unexpectedly null. Skipping files.`);
                         continue; // Skip this language group if parser instance is null
                     }
                     for (const file of filesForLang) {
                         try {
                             const fileContent = await fs.readFile(file.path, 'utf-8'); // Use fs.readFile
                             logger.debug(`Parsing file: ${file.path}`);
                             // Now languageParserInstance is guaranteed non-null here
                             const { nodes: parsedNodes, relationships: parsedRelationships } = await languageParserInstance.parse(file.path, fileContent);
                             allNodes.push(...parsedNodes);
                             allRelationships.push(...parsedRelationships);
                             logger.debug(`Parsed ${file.path}: ${parsedNodes.length} nodes, ${parsedRelationships.length} relationships`);
                         } catch (fileParseError: any) {
                             logger.error(`Failed to parse file ${file.path}: ${fileParseError.message}`, { stack: fileParseError.stack });
                             // Continue with the next file
                         }
                     }
                 } catch (langError: any) {
                     logger.error(`Failed to get/set grammar or instantiate parser for language ${lang}: ${langError.message}`, { stack: langError.stack });
                     // Optionally continue with other languages or re-throw
                 }
             }
             logger.info(`Total collected from parsing: ${allNodes.length} nodes and ${allRelationships.length} relationships.`);
            */
            // --- End Old Tree-sitter Parsing Logic ---

            if (allElements.length === 0 && allPotentialRelationships.length === 0) {
                logger.warn('No IR entities were generated during conversion. Aborting further analysis.');
                return;
            }

            // --- New IR Analysis Step ---
            logger.info('Analyzing IR entities for relationships and generating Cypher...');
            const analysisResult: IrAnalysisResult = analyzeIr(allElements, allPotentialRelationships); // Pass both arrays
            logger.info(`IR Analysis generated ${analysisResult.nodeQueries.length} node queries and ${analysisResult.relationshipQueries.length} relationship queries.`);
            // ResolverOrchestrator logic removed as it's legacy code
            // --- End Old Relationship Resolution (Orchestrator) ---

            // --- Old Relationship Resolution (Pass 2 - Commented Out) ---

            // 4. Resolve Relationships (Pass 2)
            // 4. Resolve Relationships (Pass 2 - Optional/Simplified)
            // TODO: Re-evaluate the need for RelationshipResolver pass 2.
            // The orchestrator might handle most cases. If still needed, adapt it.
            // For now, we'll comment out the old Pass 2 logic.
            logger.info('Skipping legacy RelationshipResolver (Pass 2) - relying on Orchestrator.');
            /* // Correctly comment out the entire block
            logger.info('Resolving relationships (Pass 2)...');
            // const tsProject: Project = this.analysisParser.getTsProject(); // Removed dependency
            this.relationshipResolver = new RelationshipResolver(allNodes, allRelationships); // Error: allNodes/allRelationships undefined here
            // Assuming resolveRelationships returns an object { nodes: ..., relationships: ... }
            // Need to adapt RelationshipResolver if it depended on tsProject or AnalysisParser internals
            const pass2Result = await this.relationshipResolver.resolveRelationships(); // Pass necessary context if needed
            const pass2Relationships = pass2Result.relationships;
            logger.info(`Resolved ${pass2Relationships.length} relationships in Pass 2.`);

            const pass2Relationships: RelationshipInfo[] = []; // Assume no Pass 2 for now

            const finalNodes = allNodes; // Error: allNodes undefined here
            // Combine relationships (Pass 1 + Orchestrator + Pass 2)
            // Orchestrator relationships are already persisted, so only combine Pass 1 and Pass 2 (if any)
            const combinedRelationships = [...allRelationships, ...pass2Relationships]; // Error: allRelationships undefined here
            const uniqueRelationships = Array.from(new Map(combinedRelationships.map(r => [r.entityId, r])).values());
            logger.info(`Total unique relationships for storage (excluding Orchestrator): ${uniqueRelationships.length}`);
            */
            // --- End Old Relationship Resolution ---


            // 5. Store Results (Using generated Cypher from IR Analysis)

            logger.info('Storing analysis results...');
            // Ensure driver is initialized before storing
            await this.neo4jClient.initializeDriver('AnalyzerService-Store');

            // Execute Node Queries
            logger.info(`Executing ${analysisResult.nodeQueries.length} node queries...`);
            // TODO: Implement batching if neo4jClient supports it or if needed for performance
            for (const query of analysisResult.nodeQueries) {
                try {
                    // Use runTransaction for executing queries
                    await this.neo4jClient.runTransaction(query, {}, 'WRITE', 'AnalyzerService-NodeStore');
                } catch (queryError: any) {
                    logger.error(`Failed to execute node query: ${query}\nError: ${queryError.message}`, { stack: queryError.stack });
                    // Decide whether to continue or abort on error
                }
            }

            // Execute Relationship Queries
            logger.info(`Executing ${analysisResult.relationshipQueries.length} relationship queries...`);
            for (const query of analysisResult.relationshipQueries) {
                try {
                     // Use runTransaction for executing queries
                    await this.neo4jClient.runTransaction(query, {}, 'WRITE', 'AnalyzerService-RelStore');
                } catch (queryError: any) {
                    logger.error(`Failed to execute relationship query: ${query}\nError: ${queryError.message}`, { stack: queryError.stack });
                    // Decide whether to continue or abort on error
                }
            }

            // 5b. Collect and Save Entity IDs
            logger.info('Collecting and saving element IDs to persistent cache...');
            const entityIdMap: EntityIdMap = {};
            // Use the aggregated elements list
            for (const element of allElements) {
                // Ensure filePath is correctly populated on the element
                if (!element.filePath) {
                    logger.warn(`Element ${element.id} (${element.name}) is missing filePath. Skipping ID map entry.`);
                    continue;
                }
                const relativePath = path.relative(absoluteDirectory, element.filePath).replace(/\\/g, '/'); // Ensure forward slashes
                if (!entityIdMap[relativePath]) {
                    entityIdMap[relativePath] = [];
                }
                entityIdMap[relativePath].push(element.id); // Use the element's CanonicalId
            }
            await this.storageManager.saveEntityIdMap(entityIdMap);

            logger.info('Analysis results stored successfully.');

        } catch (error: any) {
            logger.error(`Analysis failed: ${error.message}`, { stack: error.stack });
            throw error; // Re-throw the error for higher-level handling
        } finally {
            // 6. Cleanup & Disconnect
            logger.info('Closing Neo4j driver...');
            await this.neo4jClient.closeDriver('AnalyzerService-Cleanup');
            logger.info('Analysis complete.');
        }
    }

    /**
     * Analyzes a single file. Placeholder for watcher integration.
     * This method needs further implementation for parsing, resolving,
     * storing results, and updating the entity ID map for a single file.
     * @param filePath - The absolute path to the file to analyze.
     * @param analysisBaseDir - The root directory of the analysis context (e.g., the watched directory).
     * @returns A promise resolving to the list of entity IDs generated for the file.
     * @throws {Error} If the file analysis fails.
     */
    async analyzeSingleFile(filePath: string, analysisBaseDir: string): Promise<string[]> {
        await this.initialize(); // Ensure service is initialized

        const absoluteFilePath = path.resolve(filePath);
        logger.info(`Starting single-file analysis for: ${absoluteFilePath} (Base: ${analysisBaseDir})`);

        let newEntityIds: string[] = [];
        let connectionInitialized = false;
        // --- Old Tree-sitter based accumulators (commented out/replaced) ---
        // let nodes: AstNode[] = [];
        // let relationships: RelationshipInfo[] = [];
        // --- End Old Accumulators ---

        try {
            // 1. Determine File Language and Read Content
            const fileInfo: FileInfo = {
                path: absoluteFilePath,
                name: path.basename(absoluteFilePath),
                extension: path.extname(absoluteFilePath), // language property added below
            };
            const languageEnum = getLanguageFromFileInfo(fileInfo);

            const irLang = mapToIrLanguage(languageEnum); // Map to IR Language

            if (!irLang) {
                logger.warn(`[analyzeSingleFile] Unsupported or Unknown language type for IR conversion: ${absoluteFilePath}. Skipping.`);
                return [];
            }
            fileInfo.language = languageEnum; // Add language to FileInfo

            // 2. Parse Single File using appropriate LanguageParser
            logger.debug(`[analyzeSingleFile] Parsing ${languageEnum} file: ${absoluteFilePath}`);
            let languageParserInstance: LanguageParser | null = null;
            // let parseResult: { nodes: AstNode[], relationships: RelationshipInfo[] } = { nodes: [], relationships: [] };

            // --- New IR Conversion for Single File ---
            logger.info(`[analyzeSingleFile] Converting ${absoluteFilePath} to IR...`);
            try {
                // Read content first
                const fileContent = await fs.readFile(absoluteFilePath, 'utf-8');
                // Define projectId here, before it's used
                const projectId = path.basename(analysisBaseDir);

                 /* // Old Tree-sitter parsing setup and execution (Commented Out)
                  const sharedParser = await ParserFactory.getParser();
                  const grammar = await ParserFactory.getLanguage(languageEnum);
                  sharedParser.setLanguage(grammar);

                  // 2. Instantiate the correct LanguageParser implementation
                  switch (languageEnum) {
                      case Language.TypeScript:
                      case Language.JavaScript:
                      case Language.TSX:
                          languageParserInstance = new TypeScriptParser(sharedParser);
                          break;
                      case Language.Python:
                          languageParserInstance = new PythonParser(sharedParser);
                          break;
                      case Language.SQL:
                          languageParserInstance = new SqlParser(sharedParser);
                          break;
                      case Language.Go:
                          languageParserInstance = new GoParser(sharedParser);
                          break;
                      case Language.Java:
                          languageParserInstance = new JavaParser(sharedParser);
                          break;
                      case Language.CSharp:
                          languageParserInstance = new CSharpParser(sharedParser);
                          break;
                      case Language.C:
                      case Language.CPP:
                          languageParserInstance = new CCppParser(sharedParser); // Use corrected class name
                          break;
                      default:
                          throw new Error(`Unsupported language for single file analysis: ${languageEnum}`);
                  }

                  // 3. Parse
                  if (!languageParserInstance) {
                      // This case should ideally not be reached due to the switch statement logic, but added for type safety
                      throw new Error(`Parser instance for ${languageEnum} became null unexpectedly.`);
                  }
                  let parseResult = await languageParserInstance.parse(absoluteFilePath, fileContent);
                 */

                // Convert source to FileIr object
                // Pass the derived projectId
                const fileIr = await convertSourceToIr(fileContent, absoluteFilePath, irLang, projectId);
                // projectId is now defined above

                // Generate and add IDs to each element
                const elementsWithIds: IrElement[] = fileIr.elements.map(element => {
                    try {
                        return addIdToElement(element, projectId);
                    } catch (idError: any) {
                        logger.error(`[analyzeSingleFile] Failed to generate ID for an element in ${absoluteFilePath}: ${idError.message}`, { elementName: element.name });
                        return null;
                    }
                }).filter((element): element is IrElement => element !== null);

                logger.info(`[analyzeSingleFile] Processed ${absoluteFilePath}: ${elementsWithIds.length} elements, ${fileIr.potentialRelationships.length} potential relationships.`);
                newEntityIds = elementsWithIds.map(e => e.id);

                // TODO: Implement incremental IR analysis for single file
                // This would involve fetching relevant existing elements/relationships
                // and running analyzeIr with the combined data.
                // For now, just log the generated IDs.

                // TODO: Implement incremental IR analysis and Cypher generation for single file
                logger.warn(`[analyzeSingleFile] Incremental IR analysis and storage not yet implemented. Only performing conversion for ${absoluteFilePath}.`);

             } catch(parseError: any) {
                 logger.error(`[analyzeSingleFile] Failed during IR conversion for ${absoluteFilePath}: ${parseError.message}`, { stack: parseError.stack });
                 throw parseError; // Re-throw after logging
             }

             /* // Old node/relationship assignment and logging (commented out)
             let nodes = parseResult.nodes; // Error: parseResult undefined here
             let relationships = parseResult.relationships; // Pass 1 relationships
             logger.info(`[analyzeSingleFile] Parsed ${absoluteFilePath}: ${nodes.length} nodes, ${relationships.length} relationships`);

             if (nodes.length === 0) {
                 logger.warn(`[analyzeSingleFile] No nodes generated for ${absoluteFilePath}.`);
             }

             newEntityIds = nodes.map(n => n.entityId);
             */
             // --- End New IR Conversion for Single File ---

            // [Redundant assignment block removed as variables are commented out]

            // 3. Relationship Resolution (Simplified for single file) - Commented out
            // TODO: Implement incremental relationship resolution using Orchestrator if needed.
            // logger.warn(`[analyzeSingleFile] Incremental relationship resolution is not yet fully implemented. Only storing Pass 1 relationships for ${absoluteFilePath}.`);
            // const finalRelationships = relationships; // Error: relationships undefined here

            // 4. Store Results (Nodes and Pass 1 Relationships)
            /* // Correctly comment out the entire old storage block
            if (nodes.length > 0 || finalRelationships.length > 0) { // Error: nodes/finalRelationships undefined here
                logger.info(`[analyzeSingleFile] Storing results for: ${absoluteFilePath}`);
                await this.neo4jClient.initializeDriver('AnalyzerService-SingleFile');
                connectionInitialized = true;

                if (nodes.length > 0) {
                    await this.storageManager.saveNodesBatch(nodes);
                }

                if (finalRelationships.length > 0) {
                    const relationshipsByType: { [type: string]: RelationshipInfo[] } = {};
                    for (const rel of finalRelationships) {
                        if (!relationshipsByType[rel.type]) {
                            relationshipsByType[rel.type] = [];
                        }
                        relationshipsByType[rel.type]!.push(rel);
                    }
                    for (const type in relationshipsByType) {
                        const batch = relationshipsByType[type];
                        if (batch) {
                            await this.storageManager.saveRelationshipsBatch(type, batch);
                        }
                    }
                }
                logger.info(`[analyzeSingleFile] Results stored successfully for: ${absoluteFilePath}`);
            }
            */

            // TODO: Replace above storage logic with execution of Cypher queries
            // generated by an incremental version of `analyzeIr`.
            logger.warn(`[analyzeSingleFile] Storage logic needs update for IR-based Cypher queries.`);

            // 5. Update Entity ID Map
            logger.info(`[analyzeSingleFile] Updating persistent entity ID map for: ${absoluteFilePath}`);
            const currentMap = await this.storageManager.loadEntityIdMap();
            const relativePath = path.relative(analysisBaseDir, absoluteFilePath).replace(/\\/g, '/'); // Ensure forward slashes

            if (newEntityIds.length > 0) {
                currentMap[relativePath] = newEntityIds;
            } else {
                delete currentMap[relativePath];
            }
            await this.storageManager.saveEntityIdMap(currentMap);
            logger.info(`[analyzeSingleFile] Entity ID map updated for: ${relativePath}`);

            logger.info(`Finished single-file analysis for: ${absoluteFilePath}`);
            return newEntityIds;

        } catch (error: any) {
            logger.error(`Single-file analysis failed for ${absoluteFilePath}: ${error.message}`, { stack: error.stack });
            // Don't update the entity map on failure to avoid losing previous valid IDs
            throw error; // Re-throw the error
        } finally {
            if (connectionInitialized) {
                await this.neo4jClient.closeDriver('AnalyzerService-SingleFile');
            }
        }
    }
}

/**
 * Maps the internal Language enum to the IR Language enum.
 * @param lang The internal Language enum value.
 * @returns The corresponding IR Language enum value, or null if no mapping exists.
 */
function mapToIrLanguage(lang: Language | null | undefined): IrLanguage | null {
    if (!lang) return null;
    switch (lang) {
        case Language.TypeScript: return IrLanguage.TypeScript;
        case Language.JavaScript: return IrLanguage.JavaScript;
        case Language.TSX: return IrLanguage.TypeScript; // Map TSX to TypeScript for IR
        case Language.Python: return IrLanguage.Python;
        case Language.SQL: return IrLanguage.SQL;
        case Language.Java: return IrLanguage.Java;
        // Add mappings for C, CPP, CSharp, Go etc. if they are added to IrLanguage enum
        // case Language.C: return IrLanguage.C;
        // case Language.CPP: return IrLanguage.CPP;
        // case Language.CSharp: return IrLanguage.CSharp;
        // case Language.Go: return IrLanguage.Go;
        default: return null; // No mapping for Unknown or other languages yet
    }
}