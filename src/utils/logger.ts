import winston from 'winston';
import path from 'path';
import config from '../config'; // Assuming config is default exported

const { combine, timestamp, printf, colorize, json, errors } = winston.format;

// Define custom format
const customFormat = printf(({ level, message, context, timestamp, stack, ...metadata }: winston.Logform.TransformableInfo) => {
  let log = `${timestamp} [${context || 'App'}] ${level}: ${message}`;
  
  // Include stack trace for errors
  if (stack) {
    log += `\nStack: ${stack}`;
  }

  // Include any additional metadata if present
  const metaString = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  if (metaString && metaString !== '{}') {
     // Avoid printing empty metadata objects
     log += `\nMetadata: ${metaString}`;
  }

  return log;
});

// Define transports based on config
const transports: winston.transport[] = [];

// Define a type for the transport to satisfy the compiler for the forEach loop
type WinstonTransport = winston.transport & { level?: string };

if (config.logging.console) {
  transports.push(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        errors({ stack: true }), // Ensure stack traces are captured
        customFormat // Use simple format for console
      ),
      level: config.logging.level,
    })
  );
}

if (config.logging.logToFile) {
  const logFilePath = path.join(config.logging.logDir, config.logging.logFile);
  transports.push(
    new winston.transports.File({
      filename: logFilePath,
      format: combine(
        timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        errors({ stack: true }), // Ensure stack traces are captured
        json() // Use JSON format for file logs
      ),
      level: config.logging.level,
    })
  );
}

// Create the main logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  transports: transports,
  exitOnError: false, // Do not exit on handled exceptions
});

/**
 * Creates a child logger with a specific context label.
 * @param context - The context label for the logger.
 * @returns A Winston logger instance with the specified context.
 */
export function createContextLogger(context: string): winston.Logger {
  return logger.child({ context });
}

/**
 * Initializes and returns the main logger instance.
 * Typically called once at application startup.
 * @param cfg - Optional logging configuration override.
 * @returns The main Winston logger instance.
 */
export function initializeLogger(cfg = config.logging): winston.Logger {
    // Reconfigure transports if needed (e.g., if config changed after initial load)
    logger.transports.forEach((t: WinstonTransport) => (t.level = cfg.level));
    // Add more reconfiguration logic if needed based on cfg changes
    logger.info(`Logger initialized with level: ${cfg.level}`);
    return logger;
}

// Export the main logger instance directly if needed elsewhere
export default logger;