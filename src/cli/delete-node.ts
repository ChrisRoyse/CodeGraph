// src/cli/delete-node.ts
import { Command } from 'commander';
// Revert back to workspace alias
import { Neo4jClient, createContextLogger, config } from '@bmcp/analyzer-core';

const logger = createContextLogger('DeleteNodeCmd');

interface DeleteNodeOptions {
    filePath: string;
    // Add Neo4j connection options if needed, or rely on core config
    neo4jUrl?: string;
    neo4jUser?: string;
    neo4jPassword?: string;
    neo4jDatabase?: string;
}

export function registerDeleteNodeCommand(program: Command): void {
    program
        .command('delete-node')
        .description('Deletes nodes and relationships associated with a specific file path from Neo4j.')
        .requiredOption('--filePath <path>', 'Absolute path of the file whose data should be deleted')
        // Optionally allow overriding Neo4j connection details
        .option('--neo4j-url <url>', 'Neo4j connection URL')
        .option('--neo4j-user <user>', 'Neo4j username')
        .option('--neo4j-password <password>', 'Neo4j password')
        .option('--neo4j-database <database>', 'Neo4j database name')
        .action(async (options: DeleteNodeOptions) => {
            logger.info(`Received delete-node command for filePath: ${options.filePath}`);

            if (!options.filePath) {
                logger.error('Error: --filePath option is required.');
                process.exit(1);
            }

            // Normalize the file path (important for matching)
            const normalizedFilePath = options.filePath.replace(/\\/g, '/');
            logger.info(`Normalized filePath: ${normalizedFilePath}`);

            // Use provided Neo4j options or defaults from config
            const neo4jClient = new Neo4jClient({
                uri: options.neo4jUrl, // Uses core config default if undefined
                username: options.neo4jUser,
                password: options.neo4jPassword,
                database: options.neo4jDatabase,
            });
            let connected = false;

            try {
                await neo4jClient.initializeDriver('DeleteNodeCmd');
                connected = true;
                logger.info('Neo4j connection established.');

                const query = 'MATCH (n {filePath: $filePath}) DETACH DELETE n';
                const params = { filePath: normalizedFilePath };

                logger.info(`Executing deletion query for: ${normalizedFilePath}`);
                const result = await neo4jClient.runTransaction(query, params, 'WRITE');
                // Neo4j driver v5 summary doesn't directly expose nodes_deleted easily in the default summary.
                // We can infer success if no error was thrown.
                logger.info(`Deletion query completed successfully for: ${normalizedFilePath}.`); // Confirmation log

            } catch (error: any) {
                logger.error(`Command failed: ${error.message}`, { stack: error.stack });
                process.exitCode = 1; // Indicate failure
            } finally {
                if (connected) {
                    logger.info('Closing Neo4j connection...');
                    await neo4jClient.closeDriver('DeleteNodeCmd');
                    logger.info('Neo4j connection closed.');
                }
            }
        });
}