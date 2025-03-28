import { FileScanner, FileInfo, ScanResult } from '../scanner/file-scanner';
// Import BatchedParserResult and SingleFileParseResult etc.
import { AstParser, BatchedParserResult, AstNode, RelationshipInfo, SingleFileParseResult } from './parser';
import { RelationshipResolver } from './relationship-resolver';
import { StorageManager } from './storage-manager';
import { createContextLogger } from '../utils/logger';
import config from '../config';
import { AppError, FileSystemError } from '../utils/errors';
import fs from 'fs/promises';
import path from 'path';
import SemanticAnalyzer from './semantic-analyzer';
import schemaManager from '../database/schema'; // Import schemaManager
import vectorService from '../vector/vector-service'; // Import VectorService singleton
import type { VectorDocument } from '../vector/vector-service'; // Import VectorDocument type

const logger = createContextLogger('AnalyzerService');
const TEMP_DIR = path.resolve(process.cwd(), './analysis-data/temp'); // Consistent temp dir path

// Define relationship types considered semantically rich enough for embedding
const SEMANTIC_RELATIONSHIP_TYPES_FOR_EMBEDDING = [
    'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'MUTATES_STATE', 'HANDLES_ERROR',
    'CROSS_FILE_CALLS', 'CROSS_FILE_USES', 'CROSS_FILE_EXTENDS', 'CROSS_FILE_IMPLEMENTS', 'CROSS_FILE_MUTATES_STATE'
];

// Define relationship types that take precedence over 'CONTAINS'
const SPECIFIC_RELATIONSHIP_TYPES = [
    'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'IMPORTS', 'EXPORTS', 'MUTATES_STATE', 'HANDLES_ERROR',
    'CROSS_FILE_CALLS', 'CROSS_FILE_USES', 'CROSS_FILE_EXTENDS', 'CROSS_FILE_IMPLEMENTS', 'CROSS_FILE_MUTATES_STATE', 'CROSS_FILE_IMPORTS'
];


export interface AnalysisOptions {
    extensions?: string[];
    ignorePatterns?: string[];
    maxDepth?: number;
    followSymlinks?: boolean;
    resetDatabase?: boolean;
    updateSchema?: boolean; // Added option
    // Add options for semantic analysis, history tracking later
}

export class AnalyzerService {
    private fileScanner: FileScanner;
    private parser: AstParser;
    private relationshipResolver: RelationshipResolver;
    private storageManager: StorageManager;
    // Store options passed to constructor
    private analysisOptions: AnalysisOptions;

    constructor(options: AnalysisOptions = {}) {
        this.analysisOptions = options; // Store options
        this.fileScanner = new FileScanner({
            extensions: options.extensions || config.files.extensions,
            ignorePatterns: options.ignorePatterns || config.files.ignorePatterns,
            maxDepth: options.maxDepth,
            followSymlinks: options.followSymlinks,
        });
        this.parser = new AstParser({ /* Pass options if needed */ });
        this.relationshipResolver = new RelationshipResolver();
        this.storageManager = new StorageManager();

        logger.info('AnalyzerService initialized');
    }

    /**
     * Reads all nodes from temporary parse result files.
     */
    private async loadAllNodes(tempFilePaths: string[]): Promise<AstNode[]> {
        logger.info(`Loading nodes from ${tempFilePaths.length} temporary files...`);
        let allNodes: AstNode[] = [];
        for (const filePath of tempFilePaths) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                // Use safe parsing
                const result: Partial<SingleFileParseResult> = JSON.parse(content);
                if (result.nodes && Array.isArray(result.nodes)) {
                    allNodes = allNodes.concat(result.nodes);
                } else {
                     logger.warn(`No valid nodes array found in temp file: ${filePath}`);
                }
            } catch (error) {
                logger.warn(`Failed to read or parse temp file for nodes: ${filePath}`, { error });
            }
        }
        logger.info(`Loaded ${allNodes.length} nodes total.`);
        return allNodes;
    }

    /**
     * Reads relationships from temporary files in batches.
     */
    private async* streamRelationships(tempFilePaths: string[], batchSize: number): AsyncGenerator<RelationshipInfo[]> {
        logger.info(`Streaming relationships from ${tempFilePaths.length} files in batches of ${batchSize}...`);
        let currentBatch: RelationshipInfo[] = [];

        for (const filePath of tempFilePaths) {
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                 // Use safe parsing
                const result: Partial<SingleFileParseResult> = JSON.parse(content);
                if (result.relationships && Array.isArray(result.relationships)) {
                    for (const rel of result.relationships) {
                        currentBatch.push(rel);
                        if (currentBatch.length >= batchSize) {
                            yield currentBatch;
                            currentBatch = [];
                        }
                    }
                } else {
                     logger.warn(`No valid relationships array found in temp file: ${filePath}`);
                }
            } catch (error) {
                logger.warn(`Failed to read or parse temp file for relationships: ${filePath}`, { error });
            }
        }

        // Yield any remaining relationships in the last batch
        if (currentBatch.length > 0) {
            yield currentBatch;
        }
        logger.info('Finished streaming relationships.');
    }

     /**
     * Cleans up temporary analysis files.
     */
    private async cleanupTempFiles(tempFilePaths: string[]): Promise<void> {
        logger.info(`Cleaning up ${tempFilePaths.length} temporary files...`);
        let deletedCount = 0;
        for (const filePath of tempFilePaths) {
            try {
                await fs.unlink(filePath);
                deletedCount++;
            } catch (error) {
                logger.warn(`Failed to delete temporary file: ${filePath}`, { error });
            }
        }
         logger.info(`Cleaned up ${deletedCount} temporary files.`);
         // Optionally remove the temp directory itself if empty, but be cautious
         try {
             await fs.rmdir(TEMP_DIR);
             logger.info(`Removed temporary directory: ${TEMP_DIR}`);
         } catch (error: any) {
             // Ignore errors if directory is not empty or doesn't exist
             if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') {
                  logger.warn(`Could not remove temporary directory: ${TEMP_DIR}`, { error });
             }
         }
    }


    async analyze(directoryPath: string): Promise<void> {
        const startTime = Date.now();
        logger.info(`Starting analysis of directory: ${directoryPath}`);
        let tempFilePaths: string[] = []; // Keep track of temp files
        let nodeEmbeddingCount = 0; // Counter for node embeddings
        let relationshipEmbeddingCount = 0; // Counter for relationship embeddings
        let relationshipsFilteredOut = 0; // Counter for filtered relationships

        try {
            // 0. Initialize Schema (potentially dropping old elements)
            await schemaManager.initializeSchema(this.analysisOptions.updateSchema);

            // 1. Reset database data if requested
            if (this.analysisOptions.resetDatabase) {
                logger.info('Resetting database data before analysis...');
                // Reset only graph database
                await this.storageManager.resetDatabase();
                // Note: In-memory ChromaDB resets automatically on process restart
                logger.info('Graph database data reset complete.');
            }

            // 2. Scan for files
            logger.info('Scanning directory for files...');
            const scanResult = await this.fileScanner.scan(directoryPath);
            logger.info(`Found ${scanResult.files.length} files to analyze.`);
            if (scanResult.errors.length > 0) {
                logger.warn(`Scanner encountered ${scanResult.errors.length} errors.`);
            }
            if (scanResult.files.length === 0) {
                logger.info('No files found matching criteria. Analysis complete.');
                return;
            }

            // 3. Parse files (generates temp files)
            logger.info(`Parsing ${scanResult.files.length} files...`);
            tempFilePaths = await this.parser.parseFiles(scanResult.files); // Returns list of temp file paths

            // 4. Load all nodes
            const allNodes = await this.loadAllNodes(tempFilePaths);
            if (allNodes.length === 0 && tempFilePaths.length > 0) {
                 logger.warn("Parsing generated temp files but no nodes were loaded. Check parser logic and temp file content.");
            }

            // 5. Apply Semantic Analysis (Placeholder - operates on in-memory nodes)
            logger.info('Applying semantic analysis...');
            let enhancedNodes = SemanticAnalyzer.analyzeNodes(allNodes); // Pass all loaded nodes
            logger.info('Semantic analysis complete.');

            // --- STEP 5.5: Generate and Add Node Embeddings ---
            logger.info('Generating embeddings for relevant nodes...');
            await vectorService.ensureEmbedderReady(); // Ensure embedder is ready
            for (const node of enhancedNodes) {
                let textToEmbed: string | null = null;
                if (['Function', 'Method', 'Class', 'Interface'].includes(node.kind)) {
                    const signature = node.parameterTypes
                        ? `(${node.parameterTypes.map(p => `${p.name}: ${p.type}`).join(', ')}) => ${node.returnType || 'void'}`
                        : '';
                    textToEmbed = `${node.name}${signature}\n${node.documentation || node.docComment || ''}`.trim();
                } else if (['Variable', 'Parameter'].includes(node.kind)) {
                    textToEmbed = `${node.name}: ${node.type || 'any'}\n${node.documentation || node.docComment || ''}`.trim();
                }
                if (textToEmbed) {
                    const embedding = await vectorService.generateEmbedding(textToEmbed);
                    if (embedding) {
                        node.embedding = embedding;
                        nodeEmbeddingCount++;
                    } else {
                        logger.warn(`Failed to generate embedding for node: ${node.entityId}`);
                    }
                }
            }
            logger.info(`Generated embeddings for ${nodeEmbeddingCount} nodes.`);
            // --- END NODE EMBEDDING STEP ---

            // 6. Save all nodes (now potentially with embeddings)
            logger.info('Saving all nodes...');
            await this.storageManager.saveNodes(enhancedNodes); // Save enhanced nodes
            logger.info('Node saving complete.');

            // 7. Build resolver index AFTER nodes are saved
            this.relationshipResolver.buildIndexes(enhancedNodes); // Use enhancedNodes
            // Create a map for quick node lookup by entityId
            const nodeMap = new Map(enhancedNodes.map(node => [node.entityId, node]));

            // 8. Process relationships in batches (filter, embed, save)
            logger.info('Resolving, filtering, embedding, and saving relationships in batches...');
            let totalRelationshipsProcessed = 0;
            let batchCounter = 0;
            for await (const relationshipBatch of this.streamRelationships(tempFilePaths, config.analysis.batchSize)) {
                 batchCounter++;
                 logger.debug(`Processing relationship batch ${batchCounter} (${relationshipBatch.length} relationships)...`);
                 // Resolve relationships against the index of ALL nodes
                 const resolvedBatch = this.relationshipResolver.resolve(relationshipBatch);

                 // --- Filter out redundant CONTAINS relationships ---
                 const specificPairs = new Set<string>();
                 resolvedBatch.forEach(rel => {
                     if (SPECIFIC_RELATIONSHIP_TYPES.includes(rel.type)) {
                         specificPairs.add(`${rel.sourceId}:${rel.targetId}`);
                     }
                 });

                 const filteredBatch = resolvedBatch.filter(rel => {
                     if (rel.type === 'CONTAINS') {
                         const pairKey = `${rel.sourceId}:${rel.targetId}`;
                         if (specificPairs.has(pairKey)) {
                             relationshipsFilteredOut++;
                             logger.debug(`Filtering out CONTAINS relationship overridden by specific type: ${rel.entityId} (${pairKey})`);
                             return false; // Filter out this CONTAINS relationship
                         }
                     }
                     return true; // Keep non-CONTAINS or CONTAINS without a specific override
                 });
                 // --- End Filtering ---

                 // --- Generate Embeddings for Filtered Relationships (Selective) ---
                 for (const rel of filteredBatch) { // Iterate over the filtered batch
                     if (SEMANTIC_RELATIONSHIP_TYPES_FOR_EMBEDDING.includes(rel.type)) {
                         const sourceNode = nodeMap.get(rel.sourceId);
                         const targetNode = nodeMap.get(rel.targetId);
                         if (sourceNode && targetNode) {
                             const textToEmbed = `Source: ${sourceNode.kind} ${sourceNode.name} | Type: ${rel.type} | Target: ${targetNode.kind} ${targetNode.name}`;
                             const embedding = await vectorService.generateEmbedding(textToEmbed);
                             if (embedding) {
                                 rel.properties = rel.properties || {};
                                 rel.properties.embedding = embedding;
                                 relationshipEmbeddingCount++;
                             } else {
                                  logger.warn(`Failed to generate embedding for relationship: ${rel.entityId}`);
                             }
                         } else {
                              logger.warn(`Could not find source/target node for relationship embedding: ${rel.entityId}`);
                         }
                     }
                 }
                 // --- End Relationship Embedding ---

                 if (filteredBatch.length > 0) {
                    await this.storageManager.saveRelationships(filteredBatch); // Save filtered batch
                    totalRelationshipsProcessed += filteredBatch.length;
                 } else {
                     logger.debug(`Batch ${batchCounter} had no relationships left after filtering to save.`);
                 }
            }
             logger.info(`Processed and saved ${totalRelationshipsProcessed} relationships. Filtered out ${relationshipsFilteredOut} redundant CONTAINS relationships.`);


            const duration = (Date.now() - startTime) / 1000;
            logger.info(`Analysis completed successfully in ${duration.toFixed(2)} seconds.`);
            console.log(`\nAnalysis Summary:`);
            console.log(`- Files Scanned: ${scanResult.files.length}`);
            console.log(`- Nodes Created/Updated: ${enhancedNodes.length}`);
            console.log(`- Relationships Created/Updated: ${totalRelationshipsProcessed}`);
            console.log(`- Node Embeddings Generated: ${nodeEmbeddingCount}`);
            console.log(`- Relationship Embeddings Generated: ${relationshipEmbeddingCount}`);
            console.log(`- Redundant CONTAINS Filtered: ${relationshipsFilteredOut}`);
            console.log(`- Duration: ${duration.toFixed(2)}s`);

        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Analysis failed', { error: err.message, stack: err.stack });
            throw new AppError(`Analysis failed: ${err.message}`, { originalError: err });
        } finally {
             // 9. Cleanup temporary files (adjusted step number)
             if (tempFilePaths.length > 0) {
                 await this.cleanupTempFiles(tempFilePaths);
             }
        }
    }
}
