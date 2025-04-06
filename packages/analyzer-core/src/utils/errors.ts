/**
 * Base class for custom application errors.
 */
export class AppError extends Error {
  public readonly originalError?: Error | unknown;
  public readonly context?: Record<string, any>;
  public readonly code?: string | number; // Optional code for specific errors

  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any>; code?: string | number } = {}) {
    super(message);
    this.name = this.constructor.name; // Set the error name to the class name
    this.originalError = options.originalError;
    this.context = options.context;
    this.code = options.code;

    // Capture stack trace (excluding constructor call)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Error related to file system operations.
 */
export class FileSystemError extends AppError {
  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any> } = {}) {
    super(message, options);
    this.name = 'FileSystemError';
  }
}

/**
 * Error related to parsing source code.
 */
export class ParserError extends AppError {
  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any> } = {}) {
    super(message, options);
    this.name = 'ParserError';
  }
}

/**
 * Error related to Neo4j database operations.
 */
export class Neo4jError extends AppError {
  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any>; code?: string | number } = {}) {
    super(message, options);
    this.name = 'Neo4jError';
  }
}

/**
 * Error related to configuration issues.
 */
export class ConfigError extends AppError {
  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any> } = {}) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/**
 * Error for unexpected states or logic failures.
 */
export class InternalError extends AppError {
  constructor(message: string, options: { originalError?: unknown; context?: Record<string, any> } = {}) {
    super(`Internal Error: ${message}`, options);
    this.name = 'InternalError';
  }
}
