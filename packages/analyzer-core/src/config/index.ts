import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') }); // Keep using dotenv for env loading

/**
 * Defines the structure of the application configuration.
 */
interface Config {
  /** The logging level (e.g., 'debug', 'info', 'warn', 'error'). */
  logLevel: string;
  /** Neo4j database connection URL. */
  neo4jUrl: string;
  /** Neo4j database username. */
  neo4jUser: string;
  /** Neo4j database password. */
  neo4jPassword: string;
  /** Neo4j database name. */
  neo4jDatabase: string;
  /** Batch size for writing nodes/relationships to Neo4j. */
  storageBatchSize: number;
  /** Directory to store temporary analysis files. */
  tempDir: string;
  /** Glob patterns for files/directories to ignore during scanning. */
  ignorePatterns: string[];
  /** Supported file extensions for parsing. */
  supportedExtensions: string[];
    /** Base directory used for analysis (needed for relative path calculations). */
    analysisDirectory: string; // Added for watcher/single file analysis
}

const config: Config = {
  logLevel: process.env.LOG_LEVEL || 'info',
  neo4jUrl: process.env.NEO4J_URL || 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || 'password', // Replace with your default password
  neo4jDatabase: process.env.NEO4J_DATABASE || 'codegraph',
  storageBatchSize: parseInt(process.env.STORAGE_BATCH_SIZE || '100', 10),
  tempDir: path.resolve(process.cwd(), process.env.TEMP_DIR || './analysis-data/temp'),
  ignorePatterns: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**', // Next.js build output
    '**/.svelte-kit/**', // SvelteKit build output
    '**/.venv/**', // Python virtualenv
    '**/venv/**', // Python virtualenv
    '**/env/**', // Python virtualenv
    '**/__pycache__/**', // Python cache
    '**/*.pyc', // Python compiled files
    '**/bin/**', // Common build output (e.g., C#)
    '**/obj/**', // Common build output (e.g., C#)
    '**/*.class', // Java compiled files
    '**/target/**', // Java/Maven build output
    '**/*.log',
    '**/*.lock',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/*.test.tsx', // Ignore React test files
    '**/*.spec.tsx', // Ignore React spec files
    '**/*.test.js',  // Ignore JS test files
    '**/*.spec.js',  // Ignore JS spec files
    // '**/__tests__/**', // Line removed
    '**/playwright-report/**', // Ignore playwright report artifacts
    '**/public/**', // Ignore public assets directory

    '.DS_Store', // macOS specific
  ],
  supportedExtensions: [
 // Corrected array syntax
    '.ts', '.tsx', '.js', '.jsx', // TS/JS/JSX
    '.py', // Python
    '.c', '.h', '.cpp', '.hpp', '.cc', '.hh', // C/C++
    '.java',                   // Java
    '.cs',                       // C#
    '.go',                       // Go
    '.sql'                       // SQL
  ],
    analysisDirectory: path.resolve(process.cwd()), // Default to current working directory

};

// Basic validation (optional but recommended)
if (isNaN(config.storageBatchSize) || config.storageBatchSize <= 0) {
  console.warn(`Invalid STORAGE_BATCH_SIZE found, defaulting to 100. Value: ${process.env.STORAGE_BATCH_SIZE}`);
  config.storageBatchSize = 100;
}

// Export using ESM syntax
export { config }; // Export named config
