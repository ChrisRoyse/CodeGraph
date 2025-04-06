import { Command } from 'commander';
import path from 'path';
import {
// Revert back to workspace alias
    createContextLogger,
    AnalyzerService,
    Neo4jClient,
    SchemaManager,
    StorageManager, // Add missing import
    config,
 // Use original name
    AppError
} from '@bmcp/analyzer-core';


const logger = createContextLogger('AnalyzeCmd');

interface AnalyzeOptions {
    extensions?: string;
    ignore?: string; // Commander uses the long option name here
    updateSchema?: boolean;
    resetDb?: boolean; // Commander uses camelCase for flags
    // Add Neo4j connection options
    neo4jUrl?: string;
    neo4jUser?: string;
    neo4jPassword?: string;
    neo4jDatabase?: string;
}

export function registerAnalyzeCommand(program: Command): void {
    program
        .command('analyze <directory>')
        .description('Analyze a TypeScript/JavaScript project directory and store results in Neo4j.')
        .option('-e, --extensions <exts>', `Comma-separated list of file extensions to include (default: ${config.supportedExtensions.join(',')})`) // Use original name
        .option('-i, --ignore <patterns>', 'Comma-separated glob patterns to ignore (appends to default ignores)')
        .option('--update-schema', 'Force update Neo4j schema (constraints/indexes) before analysis', false)
        .option('--reset-db', 'WARNING: Deletes ALL nodes and relationships before analysis', false)
        // Define Neo4j connection options
        .option('--neo4j-url <url>', 'Neo4j connection URL')
        .option('--neo4j-user <user>', 'Neo4j username')
        .option('--neo4j-password <password>', 'Neo4j password')
        .option('--neo4j-database <database>', 'Neo4j database name')
        .action(async (directory: string, options: AnalyzeOptions) => {
            logger.info(`Received analyze command for directory: ${directory}`);
            // The directory argument received from the MCP server is already absolute.
            const absoluteDirPath = directory;

            const finalOptions = {
                ...options,
                extensions: options.extensions ? options.extensions.split(',').map(ext => ext.trim().startsWith('.') ? ext.trim() : `.${ext.trim()}`) : config.supportedExtensions, // Use original name
                ignorePatterns: config.ignorePatterns.concat(options.ignore ? options.ignore.split(',').map(p => p.trim()) : []), // Use original name
            };

            logger.debug('Effective options:', finalOptions);

            // Pass potential CLI overrides to the Neo4jClient constructor
            const neo4jClient = new Neo4jClient({
                uri: options.neo4jUrl, // Will be undefined if not passed, constructor handles default
                username: options.neo4jUser,
                password: options.neo4jPassword,
                database: options.neo4jDatabase,
            });
            let connected = false;

            try {
                // 1. Initialize Neo4j Connection
                await neo4jClient.initializeDriver('Analyzer'); // Use initializeDriver
                connected = true;
                logger.info('Neo4j connection established.');

                // 2. Handle Schema and Reset Options
                const schemaManager = new SchemaManager(neo4jClient);

                if (finalOptions.resetDb) {
                    logger.warn('Resetting database: Deleting ALL nodes and relationships...');
                    await schemaManager.resetDatabase();
                    logger.info('Database reset complete.');
                    // Schema will be applied next anyway
                }

                if (finalOptions.updateSchema || finalOptions.resetDb) {
                    logger.info('Applying Neo4j schema (constraints and indexes)...');
                    await schemaManager.applySchema(true); // Force update if requested or after reset
                    logger.info('Schema application complete.');
                } else {
                     // Optionally apply schema if it doesn't exist, without forcing
                     // await schemaManager.applySchema(false);
                     logger.debug('Skipping schema update (use --update-schema to force).');
                }


                // 3. Run Analysis
                // Create shared instances
                const storageManager = new StorageManager(neo4jClient); // Pass client
                const analyzerService = new AnalyzerService(neo4jClient, storageManager); // Inject dependencies
                logger.info(`Starting analysis of directory: ${absoluteDirPath}`);
                // Use the simplified analyze method
                await analyzerService.analyze(absoluteDirPath);

                logger.info('Analysis command finished successfully.');

            } catch (error: any) {
                logger.error(`Analysis command failed: ${error.message}`, { stack: error.stack });
                process.exitCode = 1; // Indicate failure
            } finally {
                // 4. Close Neo4j Connection
                if (connected) {
                    logger.info('Closing Neo4j connection...');
                    await neo4jClient.closeDriver('Analyzer'); // Use closeDriver
                    logger.info('Neo4j connection closed.');
                }
            }
        });
}
