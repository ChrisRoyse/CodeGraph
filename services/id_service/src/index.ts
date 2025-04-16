/**
 * ID Service - gRPC server for centralized ID generation and parsing
 *
 * This service provides two main RPCs:
 * 1. GenerateId: Generates canonical IDs and GIDs for code entities
 * 2. ParseId: Parses IDs back into their component parts
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { generateId as generateIdLogic, parseId as parseIdLogic, IdGenerationParams } from './id-logic';

// Load environment variables from .env file
dotenv.config();

// Define interface types based on the proto definitions
interface GenerateIdRequest {
  file_path: string;
  entity_type: string;
  name: string;
  parent_canonical_id?: string;
  param_types?: string[];
  language_hint?: string;
}

interface GenerateIdResponse {
  canonical_id: string;
  gid: string;
}

interface ParseIdRequest {
  id_string: string;
}

interface ParseIdResponse {
  file_path: string;
  entity_type: string;
  name: string;
  parent_canonical_id?: string;
  param_types?: string[];
  canonical_id?: string;
  language_prefix?: string;
  gid?: string;
}

// Configuration from environment variables
const config = {
  host: process.env.ID_SERVICE_HOST || '0.0.0.0',
  port: process.env.ID_SERVICE_PORT || '50051',
  logLevel: process.env.LOG_LEVEL || 'info',
  protoPath: process.env.PROTO_PATH || path.resolve(__dirname, '../../../shared/proto/id_service.proto')
};

// Configure logger based on LOG_LEVEL
const logger = {
  debug: (message: string, ...args: any[]) => {
    if (['debug'].includes(config.logLevel)) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  },
  info: (message: string, ...args: any[]) => {
    if (['debug', 'info'].includes(config.logLevel)) {
      console.info(`[INFO] ${message}`, ...args);
    }
  },
  warn: (message: string, ...args: any[]) => {
    if (['debug', 'info', 'warn'].includes(config.logLevel)) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  },
  error: (message: string, ...args: any[]) => {
    console.error(`[ERROR] ${message}`, ...args);
  }
};

// Load the protobuf definition
logger.info(`Loading proto definition from ${config.protoPath}`);
const packageDefinition = protoLoader.loadSync(config.protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

// Create the gRPC service definition
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const idService = protoDescriptor.bmcp.id_service as any;

// Create a new gRPC server
const server = new grpc.Server();

/**
 * GenerateId RPC implementation
 *
 * Generates a canonical ID and GID for a given entity
 * This is a placeholder implementation that will be expanded in future steps
 */
function generateId(
  call: grpc.ServerUnaryCall<GenerateIdRequest, GenerateIdResponse>,
  callback: grpc.sendUnaryData<GenerateIdResponse>
): void {
  try {
    logger.debug('GenerateId called with request:', call.request);
    
    const { file_path, entity_type, name, parent_canonical_id, param_types, language_hint } = call.request;
    
    // Validate required fields
    if (!file_path || !entity_type || !name) {
      const error = new Error('Missing required fields: file_path, entity_type, and name are required');
      logger.error('Validation error:', error.message);
      const grpcError = new Error(error.message) as grpc.GrpcError;
      grpcError.code = grpc.status.INVALID_ARGUMENT;
      grpcError.name = 'InvalidArgumentError';
      callback(grpcError);
      return;
    }
    
    // Map the request to the parameters expected by the ID logic module
    const params: IdGenerationParams = {
      filePath: file_path,
      entityType: entity_type,
      name: name,
      parentCanonicalId: parent_canonical_id,
      paramTypes: param_types,
      languageHint: language_hint
    };
    
    // Generate the canonical ID and GID using the logic module
    const { canonicalId, gid } = generateIdLogic(params);
    
    const response: GenerateIdResponse = {
      canonical_id: canonicalId,
      gid: gid
    };
    
    logger.debug('GenerateId response:', response);
    callback(null, response);
  } catch (error) {
    logger.error('Error in GenerateId:', error);
    const errorMessage = `Internal server error: ${error instanceof Error ? error.message : String(error)}`;
    const grpcError = new Error(errorMessage) as grpc.GrpcError;
    grpcError.code = grpc.status.INTERNAL;
    grpcError.name = 'InternalError';
    callback(grpcError);
  }
}

/**
 * ParseId RPC implementation
 *
 * Parses a canonical ID or GID into its components
 * This is a placeholder implementation that will be expanded in future steps
 */
function parseId(
  call: grpc.ServerUnaryCall<ParseIdRequest, ParseIdResponse>,
  callback: grpc.sendUnaryData<ParseIdResponse>
): void {
  try {
    logger.debug('ParseId called with request:', call.request);
    
    const { id_string } = call.request;
    
    // Validate required fields
    if (!id_string) {
      const error = new Error('Missing required field: id_string is required');
      logger.error('Validation error:', error.message);
      const grpcError = new Error(error.message) as grpc.GrpcError;
      grpcError.code = grpc.status.INVALID_ARGUMENT;
      grpcError.name = 'InvalidArgumentError';
      callback(grpcError);
      return;
    }
    
    // Parse the ID string using the logic module
    const parsedId = parseIdLogic(id_string);
    
    // Map the parsed ID to the response format
    const response: ParseIdResponse = {
      file_path: parsedId.filePath || '',
      entity_type: parsedId.entityType || '',
      name: parsedId.name || '',
      parent_canonical_id: parsedId.parentCanonicalId,
      param_types: parsedId.paramTypes,
      canonical_id: parsedId.canonicalId,
      language_prefix: parsedId.languagePrefix,
      gid: parsedId.gid
    };
    
    logger.debug('ParseId response:', response);
    callback(null, response);
  } catch (error) {
    logger.error('Error in ParseId:', error);
    const errorMessage = `Internal server error: ${error instanceof Error ? error.message : String(error)}`;
    const grpcError = new Error(errorMessage) as grpc.GrpcError;
    grpcError.code = grpc.status.INTERNAL;
    grpcError.name = 'InternalError';
    callback(grpcError);
  }
}

// Register the service implementations
server.addService(idService.IdService.service, {
  generateId,
  parseId
});

// Start the server
logger.info(`Starting ID Service on ${config.host}:${config.port}`);
server.bindAsync(
  `${config.host}:${config.port}`,
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      logger.error('Failed to bind server:', err);
      process.exit(1);
    }
    
    logger.info(`ID Service running at ${config.host}:${port}`);
    server.start();
  }
);

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down ID Service...');
  server.tryShutdown(() => {
    logger.info('ID Service shut down successfully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down ID Service...');
  server.tryShutdown(() => {
    logger.info('ID Service shut down successfully');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  // Keep the process alive but log the error
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
  // Keep the process alive but log the error
});