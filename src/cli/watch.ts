import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
// Revert back to workspace aliases
import {
    createContextLogger,
    config as analyzerConfig,
    AppError,
    AnalyzerService,
    Neo4jClient,
    StorageManager
} from '@bmcp/analyzer-core';
import { WatcherService } from '@bmcp/watcher-service'; // Uncomment watcher import


const logger = createContextLogger('WatchCmd');

interface WatchOptions {
    // Add Neo4j connection options if needed, or rely on core config
    neo4jUrl?: string;
    neo4jUser?: string;
    neo4jPassword?: string;
    neo4jDatabase?: string;
    // Potentially add options to override ignore patterns or debounce time?
}

export function registerWatchCommand(program: Command): void {
    program
        .command('watch <directory>')
        .description('Watch a directory for file changes and update the Neo4j graph incrementally.')
        // Define Neo4j connection options (similar to analyze command)
        .option('--neo4j-url <url>', 'Neo4j connection URL')
        .option('--neo4j-user <user>', 'Neo4j username')
        .option('--neo4j-password <password>', 'Neo4j password')
        .option('--neo4j-database <database>', 'Neo4j database name')
        .action(async (directory: string, options: WatchOptions) => {
            logger.info(`Received watch command for directory: ${directory}`);
            const absoluteDirectory = path.resolve(directory);

            // Use provided Neo4j options or defaults from config
            const neo4jClient = new Neo4jClient({
                uri: options.neo4jUrl,
                username: options.neo4jUser,
                password: options.neo4jPassword,
                database: options.neo4jDatabase,
            });

            try {
                // Ensure connection works before starting watcher
                await neo4jClient.initializeDriver('WatcherCmd-Init');
                logger.info('Neo4j connection verified.');
                await neo4jClient.closeDriver('WatcherCmd-Init'); // Close initial check connection

                // Instantiate services needed by the watcher
                // Note: AnalyzerService constructor creates its own Neo4jClient and StorageManager
                // We might want to refactor to pass instances if shared state/connection pooling is desired.
                // For now, let WatcherService create its own dependencies based on the pattern.
                const storageManager = new StorageManager(neo4jClient); // Re-use client for storage
                const analyzerService = new AnalyzerService(neo4jClient, storageManager); // Inject shared dependencies

                const watcherService = new WatcherService( // Uncomment instantiation
                    absoluteDirectory,
                    storageManager, // Pass storage manager
                    analyzerService, // Pass analyzer service
                    neo4jClient // Pass client for deletions
                );

                logger.info(`Starting watcher for directory: ${absoluteDirectory}`);
                watcherService.start(); // Uncomment start call


                // Keep the process running while watching
                logger.info('Watcher started. Press CTRL+C to stop.');
                // Add graceful shutdown handling
                process.on('SIGINT', async () => {
                    logger.info('Received SIGINT. Shutting down watcher...');
                    await watcherService.stop(); // Uncomment stop call
                    logger.info('Watcher stopped. Exiting.');
                    process.exit(0);
                });
                process.on('SIGTERM', async () => {
                     logger.info('Received SIGTERM. Shutting down watcher...');
                     await watcherService.stop(); // Uncomment stop call
                     logger.info('Watcher stopped. Exiting.');
                     process.exit(0);
                 });

                // Prevent the command from exiting immediately
                // This is a common pattern for long-running CLI commands
                await new Promise(() => {}); // Keep alive indefinitely until SIGINT/SIGTERM

            } catch (error: any) {
                logger.error(`Watcher command failed to start: ${error.message}`, { stack: error.stack });
                process.exitCode = 1; // Indicate failure
                // Ensure driver is closed if initialization failed partially
                await neo4jClient.closeDriver('WatcherCmd-Error');
            }
        });
}