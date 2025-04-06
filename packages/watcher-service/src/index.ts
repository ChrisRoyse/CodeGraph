// packages/watcher-service/src/index.ts
import chokidar from 'chokidar';
import path from 'path';
import {
    createContextLogger,
    AnalyzerService,
    StorageManager,
    Neo4jClient,
    config as analyzerConfig, // Use core config for ignore patterns etc.
    AppError,
    Neo4jError
} from '@bmcp/analyzer-core';
import debounce from 'lodash.debounce'; // Using lodash debounce for simplicity
import type { DebouncedFunc } from 'lodash'; // Import the type for debounced functions

const logger = createContextLogger('WatcherService');

// Define a type for the processing queue item
interface QueueItem {
    eventType: 'add' | 'change' | 'unlink';
    filePath: string;
}

export class WatcherService {
    private watcher: chokidar.FSWatcher | null = null;
    private directoryToWatch: string;
    private storageManager: StorageManager;
    private analyzerService: AnalyzerService; // Use class name as type
    private neo4jClient: Neo4jClient; // Use class name as type
    private isProcessing: boolean = false;
    private processingQueue: QueueItem[] = [];
    private debounceTime: number; // milliseconds

    constructor(
        directoryToWatch: string,
        storageManager: StorageManager, // Assuming StorageManager class is the type
        analyzerService: AnalyzerService, // Use class name as type
        neo4jClient: Neo4jClient, // Use class name as type
        debounceTimeMs: number = 1000 // Default debounce time
    ) {
        this.directoryToWatch = path.resolve(directoryToWatch);
        this.storageManager = storageManager;
        this.analyzerService = analyzerService;
        this.neo4jClient = neo4jClient; // Store the client
        this.debounceTime = debounceTimeMs;

        // Debounce the processing function
        this.processQueueDebounced = debounce(this.processQueueInternal, this.debounceTime);

        logger.info(`WatcherService initialized for directory: ${this.directoryToWatch}`);
    }

    start(): void {
        if (this.watcher) {
            logger.warn('Watcher is already running.');
            return;
        }

        logger.info(`Starting watcher on: ${this.directoryToWatch}`);
        this.watcher = chokidar.watch(this.directoryToWatch, {
            ignored: analyzerConfig.ignorePatterns, // Use ignore patterns from core config
            persistent: true,
            ignoreInitial: true, // Don't trigger events for existing files on startup
            awaitWriteFinish: { // Helps avoid issues with large files or slow writes
                stabilityThreshold: 2000,
                pollInterval: 100
            }
        });

        this.watcher
            .on('add', (filePath) => this.handleEvent('add', filePath))
            .on('change', (filePath) => this.handleEvent('change', filePath))
            .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
            .on('error', (error) => logger.error(`Watcher error: ${error}`))
            .on('ready', () => logger.info('Initial scan complete. Ready for changes.'));
    }

    stop(): Promise<void> {
        if (!this.watcher) {
            logger.warn('Watcher is not running.');
            return Promise.resolve();
        }

        logger.info('Stopping watcher...');
        const promise = this.watcher.close();
        this.watcher = null;
        // Clear queue on stop? Or process remaining? For now, clear.
        this.processingQueue = [];
        this.processQueueDebounced.cancel(); // Cancel any pending debounced calls
        logger.info('Watcher stopped.');
        return promise;
    }

    private handleEvent(eventType: 'add' | 'change' | 'unlink', filePath: string): void {
        const normalizedPath = path.normalize(filePath);
        logger.info(`[Queue] Event triggered: ${eventType} for ${normalizedPath}`);
        // Add to queue
        this.processingQueue.push({ eventType, filePath: normalizedPath });
        // Trigger debounced processing
        this.processQueueDebounced();
    }

    // Debounced function reference with explicit type
    private processQueueDebounced: DebouncedFunc<() => Promise<void>>;

    private async processQueueInternal(): Promise<void> {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return; // Don't process if already processing or queue is empty
        }

        this.isProcessing = true;
        logger.info(`Processing ${this.processingQueue.length} queued events...`);

        // Take a snapshot of the queue to process
        const itemsToProcess = [...this.processingQueue];
        this.processingQueue = []; // Clear the main queue

        // Consolidate events: If a file is added/changed then deleted, just process delete.
        // If changed multiple times, just process the latest change.
        const consolidatedEvents = new Map<string, QueueItem>();
        for (const item of itemsToProcess) {
            const existing = consolidatedEvents.get(item.filePath);
            if (item.eventType === 'unlink') {
                consolidatedEvents.set(item.filePath, item); // Unlink overrides everything
            } else if (!existing || existing.eventType !== 'unlink') {
                // Add or Change overrides previous Add/Change, but not Unlink
                consolidatedEvents.set(item.filePath, item);
            }
        }

        const finalItems = Array.from(consolidatedEvents.values());
        logger.info(`Consolidated ${itemsToProcess.length} events into ${finalItems.length} final operations.`);


        for (const item of finalItems) {
            try {
                logger.info(`Processing ${item.eventType}: ${item.filePath}`);
                switch (item.eventType) {
                    case 'add':
                    case 'change':
                        await this.handleFileAddOrChange(item.filePath);
                        break;
                    case 'unlink':
                        await this.handleFileUnlink(item.filePath);
                        break;
                }
            } catch (error: any) {
                logger.error(`Error processing ${item.eventType} for ${item.filePath}: ${error.message}`, { stack: error.stack });
                // Decide if we should stop processing or continue with the next item
            }
        }

        this.isProcessing = false;
        logger.info('Finished processing batch.');

        // If new items arrived while processing, trigger again
        if (this.processingQueue.length > 0) {
            logger.info('New items arrived during processing, scheduling next batch.');
            this.processQueueDebounced();
        }
    }

    private async handleFileAddOrChange(filePath: string): Promise<void> {
        logger.info(`Handling add/change for: ${filePath}`);
        let oldEntityIds: string[] = [];

        try {
            // 1. Get old entity IDs before deleting/re-analyzing (for change events)
            const entityIdMap = await this.storageManager.loadEntityIdMap();
            const relativePath = path.relative(this.directoryToWatch, filePath).replace(/\\/g, '/');
            oldEntityIds = entityIdMap[relativePath] || [];

            if (oldEntityIds.length > 0) {
                 logger.info(`Found ${oldEntityIds.length} existing entity IDs for ${relativePath}. Deleting them first.`);
                 await this.storageManager.deleteNodesAndRelationships(oldEntityIds);
                 logger.info(`Successfully deleted old entities for ${relativePath}.`);
            } else {
                 logger.info(`No existing entity IDs found in cache for ${relativePath}. Proceeding with analysis.`);
            }

            // 2. Analyze the new/changed file
            // analyzeSingleFile handles parsing, storing nodes/rels, and updating the entity map
            logger.info(`Analyzing file: ${filePath}`);
            // Pass the base directory for consistent relative path calculation
            const newEntityIds = await this.analyzerService.analyzeSingleFile(filePath, this.directoryToWatch);
            logger.info(`Analysis complete for ${filePath}. Generated ${newEntityIds.length} new entity IDs.`);

            // 3. Trigger re-analysis for files importing this one
            await this._findAndQueueImporters(filePath);

        } catch (error: any) {
            logger.error(`Failed to handle add/change for ${filePath}: ${error.message}`, { stack: error.stack });
            // If deletion succeeded but analysis failed, the entity map might be out of sync.
            // Consider adding error handling to potentially restore old IDs or mark file as needing full re-analysis.
            // For now, just log the error.
        }
    }

    private async handleFileUnlink(filePath: string): Promise<void> {
        logger.info(`Handling unlink for: ${filePath}`);
        try {
            // 1. Load the current map
            const entityIdMap = await this.storageManager.loadEntityIdMap();
            const relativePath = path.relative(this.directoryToWatch, filePath).replace(/\\/g, '/');

            // 2. Find entity IDs associated with the deleted file
            const entityIdsToDelete = entityIdMap[relativePath];

            // Find importers *before* deleting the nodes/relationships
            await this._findAndQueueImporters(filePath);

            if (entityIdsToDelete && entityIdsToDelete.length > 0) {
                // Note: _findAndQueueImporters was already called above, before the if block

                logger.info(`Found ${entityIdsToDelete.length} entity IDs for deleted file ${relativePath}. Deleting from Neo4j...`);
                // 3. Delete nodes and relationships from Neo4j
                await this.storageManager.deleteNodesAndRelationships(entityIdsToDelete);
                logger.info(`Successfully deleted entities for ${relativePath} from Neo4j.`);

                // 4. Remove the entry from the map
                delete entityIdMap[relativePath];

                // 5. Save the updated map
                await this.storageManager.saveEntityIdMap(entityIdMap);
                logger.info(`Removed entry for ${relativePath} from entity ID map cache.`);

                 // 6. Importers have already been queued by _findAndQueueImporters
                 logger.info(`Queued importers of ${relativePath} for re-analysis.`);

            } else {
                logger.warn(`No entity IDs found in cache for deleted file: ${relativePath}. No deletion performed.`);
            }
        } catch (error: any) {
            logger.error(`Failed to handle unlink for ${filePath}: ${error.message}`, { stack: error.stack });
            // Re-throw or handle as appropriate
        }
    }

    /**
     * Finds files that import entities from the given file path and queues them for re-analysis.
     * @param targetFilePath The absolute path of the file that was changed or deleted.
     */
    private async _findAndQueueImporters(targetFilePath: string): Promise<void> {
        const normalizedTarget = targetFilePath.replace(/\\/g, '/');
        logger.info(`Finding importers for: ${normalizedTarget}`);
        // This query assumes an IMPORTS relationship exists from a File node
        // to any node defined within the target file.
        // Adjust relationship type (:IMPORTS) and node properties (.filePath) if needed.
        const cypher = `
            MATCH (importer:File)-[:IMPORTS]->(imported)
            WHERE imported.filePath = $targetPath
            RETURN DISTINCT importer.filePath AS importerPath
        `;
        let connectionInitialized = false;
        try {
            // Use the shared Neo4j client instance passed in the constructor
            await this.neo4jClient.initializeDriver('WatcherService-FindImporters');
            connectionInitialized = true;

            // Use runTransaction as runQuery might not exist or handle results the same way
            // Explicitly type the result to help TypeScript understand its shape
            const result: any = await this.neo4jClient.runTransaction(cypher, { targetPath: normalizedTarget }, 'READ', 'WatcherService-FindImporters');

            // Ensure result and records exist before mapping
            // Add type annotation for 'p' in filter
            // Ensure result and result.records exist before mapping, and type 'p'
            // Ensure result and result.records exist before mapping, and type 'p' more robustly
            const records = result?.records ?? []; // Use nullish coalescing for safety
            const importerPaths: string[] = records.map((record: any) => record.get('importerPath'))
                                                   .filter((p: any): p is string => typeof p === 'string');


            if (importerPaths.length > 0) {
                logger.info(`Found ${importerPaths.length} files importing from ${normalizedTarget}. Queuing for re-analysis:`);
                const filesToQueue: QueueItem[] = [];
                for (const importerPath of importerPaths) {
                    if (!importerPath || typeof importerPath !== 'string') {
                        logger.warn(`Found invalid importer path: ${importerPath}`);
                        continue;
                    }
                    // Ensure the path is absolute and normalized before queueing
                    const absoluteImporterPath = path.resolve(importerPath); // Assuming paths in DB might be relative/mixed
                    const normalizedImporterPath = path.normalize(absoluteImporterPath);

                    // Avoid queueing the file that just changed/deleted itself again immediately
                    // Also avoid queueing files outside the watched directory scope
                    if (normalizedImporterPath !== path.normalize(targetFilePath) && normalizedImporterPath.startsWith(this.directoryToWatch)) {
                        logger.info(`  - Queuing: ${normalizedImporterPath}`);
                        // Queue as a 'change' event to trigger re-analysis
                        filesToQueue.push({ eventType: 'change', filePath: normalizedImporterPath });
                    } else {
                         logger.debug(`  - Skipping queueing (self or outside watch dir): ${normalizedImporterPath}`);
                    }
                }
                // Add unique items to the main queue without triggering debounce immediately for each
                if (filesToQueue.length > 0) {
                     // Avoid adding duplicates already in the queue or being processed
                    const currentQueuePaths = new Set(this.processingQueue.map(item => item.filePath));
                    // Also check against items currently being processed in this batch (finalItems)
                    // This requires passing finalItems or making it accessible, which complicates things.
                    // For now, rely on the debounce and consolidation logic to handle potential near-duplicates.
                    const uniqueNewItems = filesToQueue.filter(item => !currentQueuePaths.has(item.filePath));


                    if (uniqueNewItems.length > 0) {
                        this.processingQueue.push(...uniqueNewItems);
                        logger.info(`Added ${uniqueNewItems.length} unique importers to the queue.`);
                        // Trigger debounce after adding all importers for this target file
                        this.processQueueDebounced();
                    } else {
                         logger.info('All found importers were already in the queue.');
                    }
                }
            } else {
                logger.info(`No files found importing from ${normalizedTarget}.`);
            }
        } catch (error: any) {
             logger.error(`Failed to find or queue importers for ${normalizedTarget}: ${error.message}`, { stack: error.stack });
            // Decide how to handle this - potentially retry or log for manual intervention
        } finally {
             if (connectionInitialized) {
                 // Close driver connection if it was opened specifically for this operation
                 // Consider a more robust connection management strategy if needed
                 await this.neo4jClient.closeDriver('WatcherService-FindImporters');
             }
        }
    }
}
