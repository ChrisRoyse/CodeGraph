/**
 * ID Service Client for the JavaScript/TypeScript Analyzer
 *
 * This module provides a client for the ID Service gRPC API.
 */

// @ts-ignore

import path from 'path';
import * as grpc from '@grpc/grpc-js';
// @ts-ignore

import * as protoLoader from '@grpc/proto-loader';

// @ts-ignore

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

// Path to the proto file
const PROTO_PATH = path.resolve(process.cwd(), 'shared/proto/id_service.proto');

// @ts-ignore

// Interface for ID generation parameters
export interface IdGenerationParams {
  filePath: string;
  entityType: string;
  name: string;
  parentCanonicalId?: string;
  paramTypes?: string[];
  languageHint?: string;
}

// Interface for ID generation response
export interface IdGenerationResponse {
  canonicalId: string;
  gid: string;
}

/**
 * Client for the ID Service gRPC API
 */
export class IdServiceClient {
  private stub: any;

  /**
   * Initialize the ID Service client
   * 
   * @param host ID Service host
   * @param port ID Service port
   */
  constructor(host: string, port: string) {
    // Load the proto definition
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });

    // Create the gRPC service definition
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    // @ts-ignore
    const idService = protoDescriptor.bmcp.id_service as any;

    // Create the gRPC stub (client)
    // The channel is implicitly managed by the client constructor in @grpc/grpc-js
    this.stub = new idService.IdService(`${host}:${port}`, grpc.credentials.createInsecure());

    logger.info(`Connected to ID Service at ${host}:${port}`);
  }

  /**
   * Generate a canonical ID and GID for an entity
   * 
   * @param filePath Path to the file containing the entity
   * @param entityType Type of entity (Function, Class, Method, etc.)
   * @param name Name of the entity
   * @param parentCanonicalId Canonical ID of the parent entity (optional)
   * @param paramTypes Parameter types for functions/methods (optional)
   * @param languageHint Language hint to help with ID generation (optional)
   * @returns Promise resolving to a tuple of [canonicalId, gid]
   */
  async generateId(
    filePath: string,
    entityType: string,
    name: string,
    parentCanonicalId: string = "",
    paramTypes: string[] = [],
    languageHint: string = "javascript"
  ): Promise<[string, string]> {
    return new Promise((resolve, reject) => {
      try {
        // Create the request
        const request = {
          file_path: filePath,
          entity_type: entityType,
          name: name,
          parent_canonical_id: parentCanonicalId,
          param_types: paramTypes,
          language_hint: languageHint
        };

        // Call the RPC
        this.stub.generateId(request, (err: Error | null, response: any) => {
          if (err) {
            logger.error(`Error calling ID Service: ${err.message}`);
            reject(err);
            return;
          }

          resolve([response.canonical_id, response.gid]);
        });
      } catch (error) {
        logger.error(`Error generating ID: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Close the gRPC channel
   */
  close(): void {
    // Attempt to close the client stub if possible (method might vary)
    if (this.stub && typeof this.stub.close === 'function') {
      this.stub.close();
    } else {
      logger.info('Client does not have a close method or stub is undefined.');
      // Older versions or different patterns might require channel.close() - investigate if needed
    }
  }
}