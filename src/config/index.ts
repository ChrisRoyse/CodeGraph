import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables (already done in index.ts, but good practice here too)
const NODE_ENV = process.env.NODE_ENV || 'development';
const envPath = path.resolve(process.cwd(), `.env.${NODE_ENV}`);
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config(); // Fallback to .env
}

/**
 * Configuration interface defining all available configuration options
 */
export interface Config {
  // Neo4j connection settings
  neo4j: {
    uri: string;
    username: string;
    password: string;
    database?: string;
    connectionPoolSize: number;
    maxTransactionRetryTime: number;
  };

  // Logging configuration
  logging: {
    level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
    format: 'json' | 'simple';
    logToFile: boolean;
    logDir: string;
    logFile: string;
    console: boolean;
  };

  // Analysis settings
  analysis: {
    batchSize: number; // How many files to parse/save concurrently
    maxDepth: number; // Max directory depth for scanning
    followSymlinks: boolean;
    // Add history tracking config later
  };

  // File pattern settings (used by scanner)
  files: {
    extensions: string[];
    ignorePatterns: string[];
  };

  // Add other sections as needed (e.g., server, history)
}

/**
 * Get a configuration value with type safety
 * @param key Environment variable key
 * @param defaultValue Default value if not found
 */
function getConfigValue<T>(key: string, defaultValue: T): T {
  const value = process.env[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }

  // Type conversion based on defaultValue type
  if (typeof defaultValue === 'number') {
    const num = Number(value);
    return isNaN(num) ? defaultValue : (num as unknown as T);
  } else if (typeof defaultValue === 'boolean') {
    return (value.toLowerCase() === 'true') as unknown as T;
  } else if (Array.isArray(defaultValue)) {
    // Assuming comma-separated strings for arrays
    return value.split(',').map(v => v.trim()) as unknown as T;
  }

  return value as unknown as T;
}

// Default ignore patterns including common system/dev folders
const defaultIgnorePatterns = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '.vscode',
  '.cache',
  'logs',
  'coverage',
  // Windows system/protected directories
  'MSOCache',
  'PerfLogs',
  'System Volume Information',
  '$Recycle.Bin',
  'Recovery',
  'ProgramData', // Be cautious if project might be inside ProgramData
  'Windows',
  // Add other specific problematic paths if needed
];

// Create and export the configuration object
const config: Config = {
  neo4j: {
    uri: getConfigValue('NEO4J_URI', 'bolt://localhost:7687'),
    username: getConfigValue('NEO4J_USERNAME', 'neo4j'),
    password: getConfigValue('NEO4J_PASSWORD', 'password'), // Ensure this is set in .env
    database: getConfigValue('NEO4J_DATABASE', 'codegraph-rebuilt'), // Use a new DB name
    connectionPoolSize: getConfigValue('NEO4J_CONNECTION_POOL_SIZE', 50),
    maxTransactionRetryTime: getConfigValue('NEO4J_MAX_TRANSACTION_RETRY_TIME', 30000), // 30 seconds
  },

  logging: {
    level: getConfigValue('LOG_LEVEL', 'info') as Config['logging']['level'],
    format: getConfigValue('LOG_FORMAT', 'simple') as Config['logging']['format'],
    logToFile: getConfigValue('LOG_TO_FILE', true),
    logDir: getConfigValue('LOG_DIR', './logs'),
    logFile: getConfigValue('LOG_FILE', 'amcp-rebuilt.log'),
    console: getConfigValue('LOG_CONSOLE', true),
  },

  analysis: {
    batchSize: getConfigValue('ANALYSIS_BATCH_SIZE', 100),
    maxDepth: getConfigValue('ANALYSIS_MAX_DEPTH', Infinity), // Scan all depths by default
    followSymlinks: getConfigValue('ANALYSIS_FOLLOW_SYMLINKS', false),
  },

  files: {
    extensions: getConfigValue('FILE_EXTENSIONS', ['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs']),
    ignorePatterns: getConfigValue('IGNORE_PATTERNS', defaultIgnorePatterns),
  },
};

// Ensure log directory exists if logging to file
if (config.logging.logToFile) {
  const logDirPath = path.resolve(process.cwd(), config.logging.logDir);
  if (!fs.existsSync(logDirPath)) {
    fs.mkdirSync(logDirPath, { recursive: true });
  }
}

export default config;