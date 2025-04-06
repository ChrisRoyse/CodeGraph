import { Command } from 'commander';
import path from 'path';
import axios from 'axios'; // Import axios for HTTP requests
import {
    createContextLogger,
    config, // Keep config for defaults
    AppError // Keep AppError for error handling
} from '@bmcp/analyzer-core';
// Removed Neo4jClient, SchemaManager, StorageManager, AnalyzerService imports


const logger = createContextLogger('AnalyzeCmd');

interface AnalyzeOptions {
    extensions?: string;
    ignore?: string; // Commander uses the long option name here
    updateSchema?: boolean; // Keep for potential future use or direct DB interaction if needed
    resetDb?: boolean; // Keep for potential future use or direct DB interaction if needed
    // Add Neo4j connection options (might be needed if CLI interacts directly with DB for reset/schema)
    neo4jUrl?: string;
    neo4jUser?: string;
    neo4jPassword?: string;
    neo4jDatabase?: string;
}

export function registerAnalyzeCommand(program: Command): void {
    program
        .command('analyze <directory>')
        .description('Analyze a project directory by sending a request to the API Gateway.')
        .option('-e, --extensions <exts>', `Comma-separated list of file extensions to include (default: ${config.supportedExtensions.join(',')})`) // Note: These options are now informational for the CLI user, the gateway/analyzers handle actual filtering
        .option('-i, --ignore <patterns>', 'Comma-separated glob patterns to ignore (appends to default ignores)') // Note: Informational
        .option('--update-schema', 'Force update Neo4j schema (constraints/indexes) before analysis', false) // Note: This action would need a separate gateway endpoint or direct DB interaction
        .option('--reset-db', 'WARNING: Deletes ALL nodes and relationships before analysis', false) // Note: This action would need a separate gateway endpoint or direct DB interaction
        // Define Neo4j connection options (kept for potential direct DB actions like reset/schema)
        .option('--neo4j-url <url>', 'Neo4j connection URL')
        .option('--neo4j-user <user>', 'Neo4j username')
        .option('--neo4j-password <password>', 'Neo4j password')
        .option('--neo4j-database <database>', 'Neo4j database name')
        .action(async (directory: string, options: AnalyzeOptions) => {
            logger.info(`Received analyze command for directory: ${directory}`);
            // Directory path is the primary argument
            // Use the relative path provided by the user, assuming it's relative to the project root
            const relativeDirPath = directory;
            // TODO: Make gateway URL configurable (e.g., via env var or config file)
            const gatewayUrl = 'http://localhost:8000/analyze-local'; // API Gateway endpoint

            // --- Handle direct DB operations if requested ---
            // Note: These operations bypass the main analysis pipeline via the gateway
            // and interact directly with Neo4j. This might be refactored later.
            if (options.resetDb || options.updateSchema) {
                 logger.warn('Direct database operations (--reset-db, --update-schema) are currently handled by the CLI directly, not via the API Gateway.');
                 // Dynamically import Neo4jClient only if needed
                 const { Neo4jClient } = await import('@bmcp/analyzer-core');
                 const neo4jClient = new Neo4jClient({
                     uri: options.neo4jUrl,
                     username: options.neo4jUser,
                     password: options.neo4jPassword,
                     database: options.neo4jDatabase,
                 });
                 let connected = false;
                 try {
                     await neo4jClient.initializeDriver('CLI-Schema');
                     connected = true;
                     const { SchemaManager } = await import('@bmcp/analyzer-core');
                     const schemaManager = new SchemaManager(neo4jClient);

                     if (options.resetDb) {
                         logger.warn('Resetting database: Deleting ALL nodes and relationships...');
                         await schemaManager.resetDatabase();
                         logger.info('Database reset complete.');
                     }
                     if (options.updateSchema || options.resetDb) {
                         logger.info('Applying Neo4j schema (constraints and indexes)...');
                         await schemaManager.applySchema(true);
                         logger.info('Schema application complete.');
                     }
                 } catch (dbError: any) {
                     logger.error(`Direct database operation failed: ${dbError.message}`, { stack: dbError.stack });
                     process.exitCode = 1;
                     return; // Stop if DB ops fail
                 } finally {
                     if (connected) {
                         await neo4jClient.closeDriver('CLI-Schema');
                         logger.info('Direct Neo4j connection closed.');
                     }
                 }
                 // Decide if analysis should proceed after reset/schema update, or if it's a separate action.
                 // For now, let's assume it proceeds.
                 logger.info('Proceeding with analysis request to API Gateway...');
            }

            // --- Call API Gateway for Analysis ---
            logger.info(`Sending analysis request for directory: ${relativeDirPath} to ${gatewayUrl}`);
            try {
                // Make HTTP POST request to the API Gateway's local analysis endpoint
                const response = await axios.post(gatewayUrl, {
                    directory_path: relativeDirPath // Send the relative path
                }, {
                    timeout: 600000 // Set a longer timeout (e.g., 10 minutes) as analysis can take time
                });

                logger.info(`API Gateway response status: ${response.status}`);
                logger.info(`API Gateway response data:`, response.data);

                if (response.status >= 200 && response.status < 300) {
                    logger.info('Analysis request successfully dispatched by API Gateway.');
                    if (response.data?.errors?.length > 0) {
                         logger.warn('Some files failed to dispatch for analysis by the gateway:', response.data.errors);
                         // Consider setting exit code to indicate partial failure?
                    }
                } else {
                    // Throw an error if the gateway indicates failure
                    throw new Error(`API Gateway returned error status ${response.status}: ${response.data?.detail || JSON.stringify(response.data)}`);
                }

            } catch (error: any) {
                 if (axios.isAxiosError(error)) {
                    logger.error(`Error calling API Gateway at ${gatewayUrl}: ${error.message}`, {
                        status: error.response?.status,
                        data: error.response?.data,
                        code: error.code,
                    });
                     // Provide more specific feedback based on error type
                    if (error.code === 'ECONNREFUSED') {
                         logger.error('Connection refused. Is the API Gateway service running in Docker (docker-compose up)?');
                    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                         logger.error('Request timed out. The analysis might be taking longer than expected or the gateway/analyzers might be unresponsive.');
                    } else if (error.response) {
                         // Handle API errors (4xx, 5xx) returned by the gateway
                         logger.error(`API Gateway Error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
                    } else if (error.request) {
                         // Handle network errors (no response received)
                         logger.error('Network error: No response received from API Gateway.');
                    }
                 } else {
                    // Handle non-Axios errors
                    logger.error(`Analysis request failed: ${error.message}`, { stack: error.stack });
                 }
                process.exitCode = 1; // Indicate failure
            }
        });
}
