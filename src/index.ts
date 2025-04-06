#!/usr/bin/env node

import { Command } from 'commander';
import { registerAnalyzeCommand } from './cli/analyze.js';
import { registerDeleteNodeCommand } from './cli/delete-node.js'; // Import the new command
import { registerWatchCommand } from './cli/watch.js'; // Import the watch command
// Revert back to workspace alias
import { createContextLogger, AppError } from '@bmcp/analyzer-core';
// Import package.json to get version (requires appropriate tsconfig settings)
// If using ES Modules, need to handle JSON imports correctly
// Option 1: Assert type (requires "resolveJsonModule": true, "esModuleInterop": true in tsconfig)
// import pkg from '../package.json' assert { type: 'json' };
// Option 2: Read file and parse (more robust)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const logger = createContextLogger('App');

// Function to read and parse package.json
function getPackageVersion(): string {
    try {
        // Handle ES Module __dirname equivalent
        const __filename = fileURLToPath(import.meta.url);
        // When running from dist/index.js, __dirname is dist. package.json is one level up.
        const distDir = path.dirname(__filename);
        const pkgPath = path.resolve(distDir, '../package.json'); // Go up one level from dist
        const pkgData = fs.readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgData);
        return pkg.version || '0.0.0';
    } catch (error) {
        logger.warn('Could not read package.json for version.', { error });
        return '0.0.0';
    }
}

async function main() {
    logger.info('Starting CLI application...');

    const program = new Command();

    program
        .name('code-analyzer-cli') // Replace with your actual CLI name
        .version(getPackageVersion(), '-v, --version', 'Output the current version')
        .description('A CLI tool to analyze codebases and store insights in Neo4j.');

    // Register commands
    registerAnalyzeCommand(program);
    registerDeleteNodeCommand(program); // Register the new command
    registerWatchCommand(program); // Register the watch command
    // Register other commands here if needed

    program.on('command:*', () => {
        logger.error(`Invalid command: ${program.args.join(' ')}\nSee --help for a list of available commands.`);
        process.exit(1);
    });

    try {
        await program.parseAsync(process.argv);
        logger.info('CLI finished.');
    } catch (error: unknown) {
 // Keep type as unknown
        // Use type guards to safely access properties
        if (error instanceof AppError) {
 // Check if it's our custom AppError
            // Explicitly cast error to AppError to access properties
            logger.error(`Command failed: ${(error as AppError).message}`, {
                name: (error as AppError).name,
                context: (error as AppError).context,
                code: (error as AppError).code,
                // Avoid logging originalError stack twice if logger already handles it
                // originalError: error.originalError instanceof Error ? error.originalError.message : error.originalError
            });
        } else if (error instanceof Error) {
            // Check if it's a standard Error
            // Log unexpected errors
            logger.error(`An unexpected error occurred: ${error.message}`, { stack: error.stack });
        } else {
            // Log non-error exceptions
            logger.error('An unexpected non-error exception occurred.', { error });
        }
        process.exitCode = 1; // Ensure failure exit code
    }
}

main();