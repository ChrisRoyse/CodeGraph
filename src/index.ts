import { Command } from 'commander';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
// import { initializeLogger } from './utils/logger'; // To be created
import { initializeLogger, createContextLogger } from './utils/logger';
// import { analyzeCommand } from './cli/analyze'; // To be created
import { analyzeCommand } from './cli/analyze';
import config from './config';

// Load environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const envPath = path.resolve(process.cwd(), `.env.${NODE_ENV}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback to .env
}

// Initialize Logger (placeholder)
const logger = initializeLogger(config.logging);
// console.log('Logger initialization placeholder'); // Temporary console log

const program = new Command();

program
  .name('amcp-rebuilt')
  .description('Codebase analysis tool generating a Neo4j graph')
  .version('1.0.0');

// Placeholder for analyze command
program
    .command('analyze <directory>')
    .description('Analyze a directory and generate a code graph')
    .option('-e, --extensions <exts>', 'Comma-separated file extensions to include (e.g., .ts,.js)', '.ts,.tsx,.js,.jsx')
    .option('-i, --ignore <patterns>', 'Comma-separated glob patterns to ignore (e.g., node_modules,dist)', 'node_modules,dist,build,.git,.vscode')
    .option('--update-schema', 'Drop existing defined constraints/indexes before applying schema', false)
    .option('--reset-db', 'Reset the database before analysis', false)
    .action(async (directory: string, options: any) => {
        // Pass options directly, analyzeCommand will handle defaults/parsing
        await analyzeCommand(directory, options);
    });


async function main() {
  try {
    logger.info('Starting CLI', { context: 'App' }); // Add context
    await program.parseAsync(process.argv);
    logger.info('CLI finished', { context: 'App' }); // Add context
  } catch (error) {
    console.error('CLI Error:', error);
    logger.error('CLI Error:', { error, context: 'App' }); // Add context
    process.exit(1);
  }
}

main();