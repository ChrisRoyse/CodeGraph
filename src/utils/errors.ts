/**
 * Base class for custom application errors
 */
export class AppError extends Error {
  public readonly context?: Record<string, any>;

  constructor(message: string, context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error specific to database operations
 */
export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

/**
 * Error specific to file system operations
 */
export class FileSystemError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

/**
 * Error specific to parsing operations
 */
export class ParserError extends AppError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, context);
  }
}

// Add more specific error types as needed