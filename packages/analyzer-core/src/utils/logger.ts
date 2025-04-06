import winston from 'winston'; // Use default import for value and types
import path from 'path';
import { config } from '../config/index.js'; // Use named import as config doesn't have a default export

const logsDir = path.resolve(process.cwd(), 'logs'); // Default to 'logs' directory, LOG_DIR not in config

// Ensure logs directory exists (optional, Winston can create files but not dirs)
// import fs from 'fs'; // If needed later
// if (!fs.existsSync(logsDir)) {
//   fs.mkdirSync(logsDir, { recursive: true });
// }

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom format for console logging
const consoleFormat = printf(({ level, message, timestamp, context, stack, ...metadata }: any) => { // Add : any for implicit type
  let log = `${timestamp} [${context || 'App'}] ${level}: ${message}`;
  // Include stack trace for errors if available
  if (stack) {
    log += `\n${stack}`;
  }
  // Include metadata if any exists
  const meta = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  if (meta && meta !== '{}') {
    // Avoid printing empty metadata objects
    log += ` ${meta}`;
  }
  return log;
});

// Custom format for file logging
const fileFormat = combine(
  timestamp(),
  errors({ stack: true }), // Log stack traces
  json() // Log in JSON format
);

const logger: winston.Logger = winston.createLogger({ // Use imported winston
  level: config.logLevel || 'info', // Use imported config
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }), // ISO 8601 format
    errors({ stack: true }) // Ensure errors format includes stack trace
  ),
  transports: [
    // Console Transport
    new winston.transports.Console({
      format: combine(
        colorize(), // Add colors to console output
        consoleFormat // Use the custom console format
      ),
      handleExceptions: true, // Log uncaught exceptions
      handleRejections: true, // Log unhandled promise rejections
    }),
    // File Transport - All Logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat, // Use JSON format for files
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
    // File Transport - Error Logs
    new winston.transports.File({
      level: 'error',
      filename: path.join(logsDir, 'error.log'),
      format: fileFormat, // Use JSON format for error file
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      tailable: true,
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

/**
 * Creates a child logger with a specific context label.
 * @param context - The context label (e.g., 'AstParser', 'Neo4jClient').
 * @returns A child logger instance.
 */
const createContextLogger = (context: string): winston.Logger => {
  // Ensure child logger inherits the level set on the parent
  return logger.child({ context });
};

// Export using ESM syntax
export { logger, createContextLogger };