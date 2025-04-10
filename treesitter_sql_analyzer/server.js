'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const Parser = require('tree-sitter');
const SQL = require('@derekstride/tree-sitter-sql');
const { analyze } = require('./analyzer'); // Import the core analyzer logic
const { sha256 } = require('./id_generator'); // Import hashing function
const { sendAnalysisData } = require('./api_client'); // Import API client function

// Define the path to the common analyzer proto file
// Using absolute path to ensure reliability in container environment
const PROTO_PATH = '/app/protobufs/analyzer.proto'; // Absolute path inside container
const GRPC_PORT = process.env.GRPC_PORT || '50054'; // Default port if not set

console.log(`Loading proto definition from: ${PROTO_PATH}`);

// Load the protobuf
const packageDefinition = protoLoader.loadSync(
  PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer;

// Initialize the tree-sitter parser with the SQL language
let parser;
try {
    parser = new Parser();
    parser.setLanguage(SQL);
    console.log('Tree-sitter SQL parser initialized successfully.');
} catch (initError) {
    console.error('Failed to initialize tree-sitter parser:', initError);
    process.exit(1); // Exit if parser can't be initialized
}


/**
 * gRPC service implementation for AnalyzeCode
 * @param {Object} call - The gRPC call object containing the request.
 * @param {function} callback - The callback function to send the response.
 */
async function analyzeCode(call, callback) { // Make async
  const sourceCode = call.request.file_content; // Revert to file_content
  const filePath = call.request.file_path;
  const language = call.request.language; // Should be 'sql'

  console.log(`[SQL Analyzer] Received file_content type: ${typeof sourceCode}, length: ${sourceCode?.length ?? 'N/A'}`); // Update log message
  // console.log(`[SQL Analyzer] Received code snippet: ${sourceCode?.substring(0, 100)}`);

  console.log(`Received request to analyze ${language} code (path: ${filePath || 'N/A'})`);

  if (language !== 'sql') {
      console.error(`Error: Service only handles 'sql', received '${language}'`);
      return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: `Unsupported language: ${language}. This service only handles 'sql'.`
      });
  }

  if (typeof sourceCode !== 'string') {
      console.error('[SQL Analyzer] Error: Missing or invalid file_content'); // Update log message
      return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: 'Missing or invalid file_content in request.' // Update error detail
      });
  }

  // fileId is no longer needed as we send data via API
  try {
    // Removed duplicate fileId declaration
    // 1. Calculate code hash
    const codeHash = sha256(sourceCode);
    console.log(`[SQL Analyzer] Code hash for ${filePath}: ${codeHash.substring(0, 10)}...`);

    // DB interaction removed - fileId is no longer needed

    // 3. Parse SQL code
    console.log('[SQL Analyzer] Parsing SQL content...');
    const tree = parser.parse(sourceCode);
    console.log('[SQL Analyzer] Parsing complete.');

    // 4. Analyze the tree (needs refactoring)
    // TODO: Refactor analyze function in analyzer.js for SQL
    console.log('[SQL Analyzer] Analyzing syntax tree...');
    const { nodes, relationships } = analyze(tree.rootNode, filePath, sourceCode); // Use correct camelCase keys
    console.log(`[SQL Analyzer] Analysis complete. Nodes: ${nodes?.length ?? 0}, Relationships: ${relationships?.length ?? 0}`);

    // 5. Format and send results via API
    const analysisPayload = {
        nodes: nodes, // Use corrected variable name
        relationships: relationships // Use corrected variable name
    };
    await sendAnalysisData(analysisPayload);
    console.log(`[SQL Analyzer] Successfully sent analysis results via API for ${filePath}.`);

    // 6. Return simple StatusResponse
    callback(null, {
        status: "SUCCESS",
        message: `Analysis complete and results sent for ${filePath}`
    });
    console.log(`[SQL Analyzer] Successfully processed request for ${filePath || 'N/A'}.`);

  } catch (error) {
    console.error(`[SQL Analyzer] Error during analysis or API submission for ${filePath}:`, error);
    callback({
      code: grpc.status.INTERNAL,
      details: `Internal error during SQL analysis or API submission: ${error instanceof Error ? error.message : String(error)}`
    });
  }
}

/**
 * Starts the gRPC server.
 */
function main() {
  const server = new grpc.Server();
  // Add the service implementation to the server
  // Ensure the service name matches the one in analyzer.proto
  // Case-sensitive method name must match the implementation function
  server.addService(analyzerProto.AnalyzerService.service, { analyzeCode: analyzeCode });

  // Define the server address and port
  const serverAddress = `0.0.0.0:${GRPC_PORT}`;

  // Bind the server to the address and start listening
  server.bindAsync(serverAddress, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error(`Server error: ${err.message}`);
      process.exit(1); // Exit if server fails to bind
    }
    console.log(`SQL Analyzer gRPC server listening on ${serverAddress}`);
    server.start();
  });
}

main();