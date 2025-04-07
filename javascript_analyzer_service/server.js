// javascript_analyzer_service/server.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
// Tree-sitter imports (will be used later)
// const Parser = require('tree-sitter');
// const JavaScript = require('tree-sitter-javascript');

const PROTO_PATH = '/app/protobufs/analyzer.proto'; // Use absolute path inside container
const GENERATED_PATH = path.join(__dirname, 'generated/src'); // Adjust if needed

// Load the protobuf
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  // Ensure paths are correct for protoLoader to find imported protos if any
  // includeDirs: [path.join(__dirname, '../protobufs')]
});

// Dynamically load the generated code (adjust package name if needed)
// This assumes the output structure from grpc-tools matches
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer; // Use the package name defined in proto

// --- Service Implementation ---
const analyzeCode = (call, callback) => {
  console.log(`[JS Analyzer] Received analysis request for: ${call.request.file_path} (Language: ${call.request.language})`);

  // --- Placeholder for Tree-sitter Parsing ---
  try {
    // Example setup (actual parsing logic to be added later)
    // const parser = new Parser();
    // parser.setLanguage(JavaScript);
    // const sourceCode = call.request.file_content;
    // const tree = parser.parse(sourceCode);
    // const rootNode = tree.rootNode;
    console.log(`[JS Analyzer] Stub analysis for ${call.request.file_path}...`);
    // TODO: Implement actual Tree-sitter parsing and CPG generation
    // TODO: Generate persistent entity IDs
    // TODO: Convert CPG data to standardized Protobuf format
    // TODO: Implement gRPC client to send results to Neo4j Ingestion Service

    // For now, just return success
    callback(null, {
      status: "SUCCESS", // Or "DISPATCHED"
      message: `Successfully received analysis request for ${call.request.file_path}`
    });
  } catch (e) {
    console.error(`[JS Analyzer] Error during stub analysis for ${call.request.file_path}:`, e);
    callback({
      code: grpc.status.INTERNAL,
      details: `Internal error during analysis: ${e.message}`
    });
  }
};


// --- Server Setup ---
const getServer = () => {
  const server = new grpc.Server();
  // Add the main AnalyzerService
  server.addService(analyzerProto.AnalyzerService.service, { analyzeCode });
  return server;
};

if (require.main === module) {
  const port = process.env.GRPC_PORT || '50057'; // Default to 50057
  const server = getServer();
  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[JS Analyzer] Server error: ${err.message}`);
        process.exit(1);
      } else {
        console.log(`[JS Analyzer] Server running at http://0.0.0.0:${port}`);
        server.start();
      }
    }
  );
  console.log(`[JS Analyzer] gRPC server started on port ${port}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[JS Analyzer] Received SIGTERM. Shutting down...');
    server.tryShutdown(() => {
      console.log('[JS Analyzer] Server shut down.');
      process.exit(0);
    });
  });
}