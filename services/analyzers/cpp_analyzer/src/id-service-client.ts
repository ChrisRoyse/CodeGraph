/**
 * ID Service Client for the C++ Analyzer
 *
 * This module provides a client for the ID Service gRPC API.
 */

import path from 'path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Configure logging
const logger = {
  info: (message: string) => console.log(`[INFO] ${message}`),
  error: (message: string) => console.error(`[ERROR] ${message}`),
  debug: (message: string) => console.debug(`[DEBUG] ${message}`)
};

// Path to the proto file
const PROTO_PATH = path.resolve(process.cwd(), 'shared/proto/id_service.proto');

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
  private channel: grpc.Channel;

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
    const idService = (protoDescriptor as any).bmcp.id_service;

    // Create the gRPC channel and stub
    this.channel = grpc.createChannel(`${host}:${port}`, grpc.credentials.createInsecure());
    this.stub = new idService.IdService(this.channel);

    logger.info(`Connected to ID Service at ${host}:${port}`);
  }

  /**
   * Generate a canonical ID and GID for an entity
   * 
   * @param filePath Path to the file containing the entity
   * @param entityType Type of entity (Class, Method, Struct, etc.)
   * @param name Name of the entity
   * @param parentCanonicalId Canonical ID of the parent entity (optional)
   * @param paramTypes Parameter types (optional)
   * @param languageHint Language hint to help with ID generation (optional, defaults to "cpp")
   * @returns Promise resolving to a tuple of [canonicalId, gid]
   */
  async generateId(
    filePath: string,
    entityType: string,
    name: string,
    parentCanonicalId: string = "",
    paramTypes: string[] = [],
    languageHint: string = "cpp"
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
   * Generate canonical IDs and GIDs for an entity
   * 
   * @param filePath Path to the file containing the entity
   * @param entityType Type of entity (Class, Method, Struct, etc.)
   * @param name Name of the entity
   * @param parentCanonicalId Canonical ID of the parent entity (optional)
   * @param paramTypes Parameter types (optional)
   * @param languageHint Language hint to help with ID generation (optional, defaults to "cpp")
   * @returns Promise resolving to an object with canonicalId and gid
   */
  async generateIds(
    filePath: string,
    entityType: string,
    name: string,
    parentCanonicalId: string = "",
    paramTypes: string[] = [],
    languageHint: string = "cpp"
  ): Promise<IdGenerationResponse> {
    const [canonicalId, gid] = await this.generateId(
      filePath,
      entityType,
      name,
      parentCanonicalId,
      paramTypes,
      languageHint
    );
    
    return { canonicalId, gid };
  }

  /**
   * Close the gRPC channel
   */
  close(): void {
    grpc.closeClient(this.channel);
  }
}