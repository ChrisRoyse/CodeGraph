import { AnalyzerService, AnalysisOptions } from '../analyzer/analyzer-service';
import { createContextLogger } from '../utils/logger';
import path from 'path';
import neo4jClient from '../database/neo4j-client'; // Import client for closing connection

const logger = createContextLogger('AnalyzeCmd');

// Define a type for the raw CLI options received from commander
interface RawCliOptions {
    extensions?: string;
    ignore?: string; // Commander uses the long option name here
    updateSchema?: boolean;
    resetDb?: boolean; // Commander uses camelCase for flags
}


/**
 * Executes the analysis process based on CLI arguments.
 * @param directory - The directory path to analyze.
 * @param options - Raw CLI options from commander.
 */
export async function analyzeCommand(directory: string, options: RawCliOptions): Promise<void> {
    logger.info(`Received analyze command for directory: ${directory}`);
    logger.debug('Raw CLI Options:', options);

    // Resolve the directory path to ensure it's absolute
    const absoluteDirectoryPath = path.resolve(directory);

    // Map CLI options to AnalyzerService options, handling potential type issues
    const analysisOptions: AnalysisOptions = {
        extensions: options.extensions ? options.extensions.split(',').map((ext: string) => ext.trim()) : undefined,
        ignorePatterns: options.ignore ? options.ignore.split(',').map((p: string) => p.trim()) : undefined,
        resetDatabase: options.resetDb || false, // Use camelCase name from commander
        updateSchema: options.updateSchema || false, // Pass the new option
        // maxDepth and followSymlinks will use config defaults if not provided via CLI
    };
     logger.debug('Parsed Analysis Options:', analysisOptions);


    const analyzerService = new AnalyzerService(analysisOptions);

    try {
        await analyzerService.analyze(absoluteDirectoryPath);
        logger.info('Analysis command finished successfully.');
    } catch (error) {
        // Log the error object itself for more detail if available
        logger.error('Analysis command failed.', { error: error instanceof Error ? error.message : error });
        // Ensure process exits with error code if analysis fails
        process.exitCode = 1;
    } finally {
        // Ensure the database connection is closed gracefully
        await neo4jClient.close();
    }
}