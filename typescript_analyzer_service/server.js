// typescript_analyzer_service/server.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript; // Revert to accessing the .typescript property
// Assuming analyzer.ts is compiled to dist/analyzer.js
// Import the entire module to avoid potential destructuring conflicts
const analyzerModule = require('./dist/analyzer');
// Assuming analyzer.ts is compiled to dist/analyzer.js
// Removed duplicate require statement below

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
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer; // Use the package name defined in proto

// --- Service Implementation ---

// Initialize the parser once
const parser = new Parser();
try {
    parser.setLanguage(TypeScript);
    console.log("[TS Analyzer] Tree-sitter TypeScript language loaded successfully.");
} catch (err) {
    console.error("[TS Analyzer] Error loading Tree-sitter TypeScript language:", err);
    // Depending on recovery strategy, might exit or prevent service start
    process.exit(1);
}


const analyzeCode = (call, callback) => {
  const filePath = call.request.file_path;
  const sourceCode = call.request.code_content; // Renamed from file_content for clarity
  const language = call.request.language; // e.g., 'typescript'

  console.log(`[TS Analyzer] Received analysis request for: ${filePath} (Language: ${language})`);

  if (!sourceCode) {
      console.warn(`[TS Analyzer] No code content provided for ${filePath}. Skipping analysis.`);
      return callback(null, {
          nodes: [],
          relationships: [],
          status: "SUCCESS", // Or perhaps a specific status like "NO_CONTENT"
          message: `No code content provided for ${filePath}.`
      });
  }

  try {
    console.log(`[TS Analyzer] Parsing ${filePath}...`);
    const tree = parser.parse(sourceCode);
    const rootNode = tree.rootNode;
    console.log(`[TS Analyzer] Parsing complete. Starting analysis for ${filePath}...`);

    // Call the modular analyze function from the compiled analyzer.js
    // Access the analyze function via the imported module object
    const analysisData = analyzerModule.analyze(rootNode, filePath, sourceCode);

    console.log(`[TS Analyzer] Analysis finished for ${filePath}. Nodes: ${analysisData.nodes.length}, Relationships: ${analysisData.relationships.length}`);

    // Construct the protobuf response
    // The structure returned by analyze should match the AnalysisResult proto message
    const result = {
        nodes: analysisData.nodes,
        relationships: analysisData.relationships,
        status: "SUCCESS", // Indicate successful analysis
        message: `Analysis successful for ${filePath}`
    };

    callback(null, result);

  } catch (e) {
    console.error(`[TS Analyzer] Error during analysis for ${filePath}:`, e);
    // Send back a gRPC error status
    callback({
      code: grpc.status.INTERNAL,
      details: `Internal error during analysis for ${filePath}: ${e.message}`
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
  const port = process.env.GRPC_PORT || '50058'; // Default to 50058
  const server = getServer();
  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error(`[TS Analyzer] Server error: ${err.message}`);
        process.exit(1);
      } else {
        console.log(`[TS Analyzer] Server running at http://0.0.0.0:${port}`);
        server.start();
      }
    }
  );
  console.log(`[TS Analyzer] gRPC server started on port ${port}`);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[TS Analyzer] Received SIGTERM. Shutting down...');
    server.tryShutdown(() => {
      console.log('[TS Analyzer] Server shut down.');
      process.exit(0);
    });
  });
}