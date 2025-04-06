'use strict';

/**
 * @fileoverview Main entry point for the @bmcp/parser-service child process.
 * Listens for IPC messages from the parent process to perform parsing tasks.
 */

// Use require for CJS compatibility
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

// Define the path to the protobuf definition relative to the project root
// Assumes the script is run from the project root (e.g., c:/code/bmcp)
const PROJECT_ROOT = path.resolve(__dirname, '../../..'); // Adjust based on actual dist structure if needed
const PROTO_PATH = path.join(PROJECT_ROOT, 'protobufs/analyzer.proto');

// Load the protobuf
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer as any; // Type assertion needed

// --- Removed local tree-sitter requires ---
console.log('Parser service child process started.');

// Check if process.send exists (it should in a child process)
if (!process.send) {
  console.error('Error: process.send is not available. This script must be run as a child process.');
  process.exit(1);
}

// Map language identifiers to their corresponding gRPC service addresses
// These should be loaded from environment variables set in docker-compose.yml
const analyzerServiceAddresses: { [key: string]: string | undefined } = {
  c: process.env.C_ANALYZER_ADDRESS, // e.g., 'c_analyzer:500XX'
  cpp: process.env.CPP_ANALYZER_ADDRESS, // e.g., 'cpp_analyzer:500XX'
  csharp: process.env.CSHARP_ANALYZER_ADDRESS,
  go: process.env.GO_ANALYZER_ADDRESS,
  java: process.env.JAVA_ANALYZER_ADDRESS, // Likely joern_analysis_service:50053 for now
  javascript: process.env.JAVASCRIPT_ANALYZER_ADDRESS,
  python: process.env.PYTHON_ANALYZER_ADDRESS,
  rust: process.env.RUST_ANALYZER_ADDRESS,
  sql: process.env.SQL_ANALYSIS_SERVICE_ADDRESS, // e.g., 'treesitter_sql_analyzer:50054'
  typescript: process.env.TYPESCRIPT_ANALYZER_ADDRESS,
  tsx: process.env.TSX_ANALYZER_ADDRESS, // Often same as typescript
};

// --- Removed local grammarMap ---

// Define interface for incoming messages (adjust as needed)
interface ParseRequestMessage {
    id: string | number;
    language: string;
    fileContent: string;
    filePath?: string; // Optional file path
}

process.on('message', async (message: ParseRequestMessage) => { // Use async for gRPC calls
  console.log('Parser service received message:', message);

  // Basic validation: Check if message is an object and has an id
  if (!message || typeof message !== 'object' || typeof message.id === 'undefined') {
    console.error('Invalid message received (missing or invalid id):', message);
    // Attempt to send an error back, using a placeholder id if necessary
    const id = (message && typeof message === 'object' && message.id) ? message.id : 'unknown';
    process.send!({ // Use non-null assertion as we checked process.send earlier
      id: id,
      status: 'error',
      error: { message: 'Invalid message format: Missing or invalid id.' },
    });
    return; // Stop processing this message
  }

  const messageId = message.id;

  try {
    // --- Parsing Logic ---
    // Validate required fields for parsing
    if (typeof message.language !== 'string' || !message.language) {
        throw new Error('Missing or invalid "language" property in message.');
    }
    if (typeof message.fileContent !== 'string') {
        // Allow empty string, but not missing or wrong type
        throw new Error('Missing or invalid "fileContent" property in message.');
    }

    const language = message.language.toLowerCase(); // Normalize language name
    const fileContent = message.fileContent;

    // 1. Find target analyzer service address
    const targetAddress = analyzerServiceAddresses[language];
    if (!targetAddress) {
        throw new Error(`No analyzer service configured for language: ${language}`);
    }
    console.log(`Routing analysis for ${language} to ${targetAddress}`);

    // 2. Create gRPC client
    // TODO: Consider client pooling/reuse for performance
    const client = new analyzerProto.AnalyzerService(
        targetAddress,
        grpc.credentials.createInsecure() // Use insecure channel for internal communication
    );

    // 3. Prepare gRPC request
    const grpcRequest = {
        file_path: message.filePath || '', // Send empty string if no path
        file_content: fileContent,
        language: language,
    };

    // 4. Make gRPC call (asynchronous)
    // The analyzer service is now responsible for sending results to the ingestor.
    // This service just confirms dispatch.
    await new Promise<void>((resolve, reject) => {
        client.AnalyzeCode(grpcRequest, (error: grpc.ServiceError | null, response: any) => {
            if (error) {
                console.error(`gRPC call to ${targetAddress} failed for message ${messageId}:`, error);
                // Propagate specific error details if possible
                return reject(new Error(`Analyzer service error for ${language}: ${error.details || error.message}`));
            }
            // We expect the analyzer service to handle sending data to the ingestor.
            // Log success or details from the analyzer's confirmation response if needed.
            console.log(`Analyzer service ${targetAddress} acknowledged request for message ${messageId}. Response:`, response);
            resolve();
        });
        // TODO: Add timeout for the gRPC call
    });

    // 5. Send success confirmation back to parent process
    const successResponse = {
      id: messageId,
      status: 'success',
      message: `Analysis request for ${language} dispatched to ${targetAddress}.`,
    };
    console.log(`Sending success confirmation for message ${messageId}`);
    process.send!(successResponse);

  } catch (err: unknown) { // Catch unknown type
    console.error(`Error processing message ${messageId}:`, err);

    // Send error response
    const errorResponse = {
      id: messageId,
      status: 'error',
      error: {
        message: err instanceof Error ? `Parsing failed: ${err.message}` : 'An unknown error occurred during parsing.',
        // Optionally include stack trace in development? Be cautious in production.
        // stack: process.env.NODE_ENV === 'development' && err instanceof Error ? err.stack : undefined,
      },
    };
    console.log(`Sending error response for message ${messageId}`);
    process.send!(errorResponse); // Use non-null assertion
  }
});

// Graceful shutdown handlers
process.on('disconnect', () => {
  console.log('Parser service disconnected from parent process. Exiting.');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Parser service received SIGINT. Exiting gracefully.');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Parser service received SIGTERM. Exiting gracefully.');
  process.exit(0);
});

// Catch unhandled exceptions to prevent the child process from crashing silently
process.on('uncaughtException', (err) => {
  console.error('Unhandled exception in parser service:', err);
  // Try to inform the parent process if possible
  if (process.send) {
    // We might not know the message ID that caused this
    process.send({
      id: 'unknown', // Or perhaps the last known message ID if tracked
      status: 'error',
      error: { message: `Unhandled exception: ${err.message}` },
    });
  }
  process.exit(1); // Exit with an error code
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled promise rejection in parser service:', reason);
   // Try to inform the parent process if possible
   if (process.send) {
    process.send({
      id: 'unknown',
      status: 'error',
      error: { message: `Unhandled promise rejection: ${reason}` },
    });
  }
  // Consider exiting, depending on whether these rejections are recoverable
  // process.exit(1);
});


console.log('Parser service initialized and listening for messages.');

// Export nothing - this file is executed directly as a child process entry point.
module.exports = {};