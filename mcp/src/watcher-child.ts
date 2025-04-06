// mcp/src/watcher-child.ts
import path from 'path';
import * as chokidar from 'chokidar';
import { fileURLToPath } from 'url';
import {
    // Revert back to workspace alias
    Neo4jClient,
    FileInfo, // Import FileInfo type
    StorageManager,
    Parser,
    AstNode, RelationshipInfo, SingleFileParseResult, ParserContext, // Added ParserContext
    AnalyzerService, // Assuming AnalyzerService is exported from the core index
    createContextLogger, // Assuming createContextLogger is exported
    config as analyzerConfig, // Assuming config is exported
    AppError // Assuming AppError is exported
} from '@bmcp/analyzer-core';

console.error('[Watcher Child] Process started.');

// --- Configuration (Passed from parent process) ---
const args = process.argv.slice(2);
if (args.length < 5) {
    console.error('[Watcher Child] Error: Missing required arguments (directory, neo4jUrl, neo4jUser, neo4jPass, neo4jDb). Exiting.');
    process.exit(1);
}
const watchedDirectory = path.resolve(args[0]!).replace(/\\/g, '/');
 // Add non-null assertion
const neo4jUrl = args[1];
const neo4jUser = args[2];
const neo4jPassword = args[3];
const neo4jDatabase = args[4];

console.error(`[Watcher Child] Watching directory: ${watchedDirectory}`);
console.error(`[Watcher Child] Neo4j URL: ${neo4jUrl}`); // Be careful logging credentials

// --- Instantiate actual components ---
// Pass credentials explicitly if Neo4jClient constructor requires them
// or ensure the core config loaded via '@bmcp/analyzer-core' has them.
// Assuming constructor uses core config for now.
const neo4jClient = new Neo4jClient();
const storageManager = new StorageManager(neo4jClient);
const parser = new Parser();
// --- End Instantiation ---


// --- File System Watching Logic ---
const watcherIgnorePatterns: string[] = [
    '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
    '**/*___jb_tmp___', '**/*~', '**/*.log', '**/*.lock'
    // Add more patterns from config if needed
];
const watcherSupportedExtensions: string[] = [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.c', '.h', '.cpp', '.hpp',
    '.cc', '.hh', '.java', '.cs', '.go'
];

let watcherInstance: chokidar.FSWatcher | null = null;

try {
    console.error(`[Watcher Child] Initializing chokidar...`);
    watcherInstance = chokidar.watch(watchedDirectory, {
        ignored: watcherIgnorePatterns,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 1500,
            pollInterval: 100
        },
        depth: 99
    });

    watcherInstance
        .on('add', (filePath: string) => handleFileChange('add', filePath))
        .on('change', (filePath: string) => handleFileChange('change', filePath))
        .on('unlink', (filePath: string) => handleFileChange('unlink', filePath))
        .on('error', (error: unknown) => { // Type is unknown
            if (error instanceof Error) {
                console.error(`[Watcher Child] Chokidar error: ${error.message}`);
            } else {
                console.error(`[Watcher Child] Chokidar unknown error: ${error}`);
            }
        })
        .on('ready', () => console.error(`[Watcher Child] Initial scan complete for ${watchedDirectory}. Ready for changes.`));

    console.error(`[Watcher Child] Watcher started successfully.`);

} catch (error: any) {
    console.error(`[Watcher Child] Failed to start chokidar watcher: ${error.message}`);
    process.exit(1); // Exit if watcher fails to start
}

// --- Event Handlers ---

async function handleFileChange(eventType: 'add' | 'change' | 'unlink', filePath: string) {
    const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
    const fileExtension = path.extname(normalizedPath);

    console.error(`[Watcher Child] Detected ${eventType}: ${normalizedPath}`);

    if (!watcherSupportedExtensions.includes(fileExtension)) {
        console.error(`[Watcher Child] Ignoring change for unsupported extension: ${fileExtension}`);
        return;
    }

    // TODO: Add debounce/queueing mechanism here to handle rapid changes gracefully

    if (eventType === 'add' || eventType === 'change') {
        await processFileUpdate(normalizedPath);
    } else if (eventType === 'unlink') {
        await processFileDeletion(normalizedPath);
    }
}

async function processFileUpdate(filePath: string) {
    console.error(`[Watcher Child] Processing update for: ${filePath}`);
    let isDriverInitialized = false;
    try {
        // 1. Delete existing data for this file
        console.error(`[Watcher Child] Deleting existing data for ${filePath}...`);
        await neo4jClient.initializeDriver('Watcher-Delete');
        isDriverInitialized = true;
        await neo4jClient.runTransaction('MATCH (n {filePath: $filePath}) DETACH DELETE n', { filePath });
        console.error(`[Watcher Child] Existing data deleted.`);
        // await neo4jClient.closeDriver('Watcher-Delete'); // REMOVE - Let driver persist
        // isDriverInitialized = false; // No longer needed here

        // 2. Re-parse the single file
        console.error(`[Watcher Child] Parsing ${filePath}...`);
        // Construct FileInfo object
        const fileInfo: FileInfo = {
            path: filePath,
            name: path.basename(filePath),
            extension: path.extname(filePath).toLowerCase(),
        };
        const parseResult = await parser.parseSingleFile(fileInfo); // Pass FileInfo object

        if (!parseResult) {
            console.error(`[Watcher Child] Parsing failed or file unsupported for ${filePath}. Skipping save.`);
            return; // Don't proceed if parsing failed
        }

        // 3. Save new data
        if (parseResult.nodes.length > 0 || parseResult.relationships.length > 0) {
             await neo4jClient.initializeDriver('Watcher-Save'); // Reconnect for saving
             isDriverInitialized = true;

            if (parseResult.nodes.length > 0) {
                console.error(`[Watcher Child] Saving ${parseResult.nodes.length} nodes for ${filePath}...`);
                await storageManager.saveNodesBatch(parseResult.nodes);
            }
            if (parseResult.relationships.length > 0) {
                 console.error(`[Watcher Child] Saving ${parseResult.relationships.length} relationships for ${filePath}...`);
                // Group relationships by type before saving
                const relationshipsByType: { [type: string]: RelationshipInfo[] } = {};
                for (const rel of parseResult.relationships) {
                    if (!relationshipsByType[rel.type]) relationshipsByType[rel.type] = [];
                    relationshipsByType[rel.type]!.push(rel);
                }
                for (const type in relationshipsByType) {
                    await storageManager.saveRelationshipsBatch(type, relationshipsByType[type]!);
                }
            }
             // await neo4jClient.closeDriver('Watcher-Save'); // REMOVE - Let driver persist
             // isDriverInitialized = false; // No longer needed here
        } else {
             console.error(`[Watcher Child] No nodes or relationships parsed for ${filePath}. Nothing to save.`);
        }
        console.error(`[Watcher Child] Finished processing update for: ${filePath}`);

    } catch (error: any) {
        console.error(`[Watcher Child] Error processing update for ${filePath}: ${error.message}`);
    } finally {
        // Ensure driver is closed if an error occurred after initialization
        if (isDriverInitialized) {
            // await neo4jClient.closeDriver('Watcher-ErrorCleanup'); // REMOVE - Let driver persist through errors until shutdown
        }
    }
    // TODO: Trigger relationship re-resolution (complex part)
    console.error(`[Watcher Child] TODO: Implement relationship re-resolution triggered by change in ${filePath}`);
}

async function processFileDeletion(filePath: string) {
    console.error(`[Watcher Child] Processing deletion for: ${filePath}`);
    let isDriverInitialized = false;
    try {
        await neo4jClient.initializeDriver('Watcher-Delete');
        isDriverInitialized = true;
        await neo4jClient.runTransaction('MATCH (n {filePath: $filePath}) DETACH DELETE n', { filePath });
        console.error(`[Watcher Child] Deleted data for ${filePath}.`);
    } catch (error: any) {
        console.error(`[Watcher Child] Error deleting data for ${filePath}: ${error.message}`);
    } finally {
        if (isDriverInitialized) {
            await neo4jClient.closeDriver('Watcher-DeleteCleanup');
        }
    }
     // TODO: Handle dangling relationships?
}


// --- Graceful Shutdown ---
async function shutdown() {
    console.error('[Watcher Child] Shutting down...');
    if (watcherInstance) {
        await watcherInstance.close();
        console.error('[Watcher Child] Chokidar watcher closed.');
    }
    await neo4jClient.closeDriver('Watcher-Shutdown'); // Close Neo4j connection on shutdown
    console.error('[Watcher Child] Shutdown complete.');
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.error('[Watcher Child] Setup complete, waiting for events...');