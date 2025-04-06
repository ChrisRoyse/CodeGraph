// Re-export necessary members for the public API using CommonJS
// Convert to ESM re-exports

// Database
export { Neo4jClient } from './database/neo4j-client.js';
export * from './database/schema.js'; // Spread schema types/interfaces

// Analyzer
export { AnalyzerService } from './analyzer/analyzer-service.js';
export { StorageManager } from './analyzer/storage-manager.js';
export type { EntityIdMap } from './analyzer/storage-manager.js'; // Explicit type export
export { Parser } from './analyzer/parser.js'; // Assuming Parser is exported
export * from './analyzer/types.js'; // Spread core types

// Config
export { config } from './config/index.js'; // Export named config

// Utils
export * from './utils/errors.js'; // Export all error classes
export { createContextLogger } from './utils/logger.js'; // Export specific logger function

// Scanner
export { FileScanner } from './scanner/file-scanner.js';
export type { FileInfo } from './scanner/file-scanner.js'; // Export type separately

// IR
export { convertSourceToIr } from './ir/source-to-ir-converter.js';
export { analyzeIr } from './ir/ir-analyzer.js';
export type { IrAnalysisResult } from './ir/ir-analyzer.js'; // Explicit type export
export { addIdToElement, generateCanonicalId } from './ir/ir-utils.js';
export * from './ir/schema.js'; // Spread IR schema types/enums