'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const Parser = require('tree-sitter');
const SQL = require('@derekstride/tree-sitter-sql');

// Define the path to the common analyzer proto file relative to this script's location
const PROTO_PATH = path.join(__dirname, './protobufs/analyzer.proto'); // Correct path inside container relative to /app
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
function analyzeCode(call, callback) {
  const fileContent = call.request.file_content;
  const filePath = call.request.file_path;
  const language = call.request.language; // Should be 'sql'

  console.log(`Received request to analyze ${language} code (path: ${filePath || 'N/A'})`);

  if (language !== 'sql') {
      console.error(`Error: Service only handles 'sql', received '${language}'`);
      return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: `Unsupported language: ${language}. This service only handles 'sql'.`
      });
  }

  if (typeof fileContent !== 'string') {
      console.error('Error: Missing or invalid fileContent');
      return callback({
          code: grpc.status.INVALID_ARGUMENT,
          details: 'Missing or invalid file_content in request.'
      });
  }

  try {
    // Parse the SQL code using tree-sitter
    console.log('Parsing SQL content...');
    const tree = parser.parse(fileContent);
    console.log('Parsing complete.');

    // Placeholder: Return the S-expression of the root node
    const analysisResult = tree.rootNode ? tree.rootNode.toString() : '(parse_error)';

    // Construct the gRPC response
    callback(null, {
        status: "SUCCESS", // Indicate successful parsing attempt
        message: analysisResult // Send S-expression as placeholder result
    });
    console.log(`Successfully processed request for ${filePath || 'N/A'}`);

  } catch (error) {
    console.error('Error analyzing SQL:', error);
    callback({
      code: grpc.status.INTERNAL,
      details: `Failed to analyze SQL code: ${error instanceof Error ? error.message : String(error)}`
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
  server.addService(analyzerProto.AnalyzerService.service, { AnalyzeCode: analyzeCode });

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