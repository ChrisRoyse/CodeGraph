// javascript_analyzer_service/server.js
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
// Tree-sitter imports
const Parser = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const { analyze } = require('./analyzer'); // Import the core analyzer logic
const { sendAnalysisData } = require('./api_client'); // Import API client function
const { sha256 } = require('./id_generator'); // Import hashing function
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

// Dynamically load the generated code
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer;

// Global parser instance
let parser = null;

/**
 * Initialize the Tree-sitter parser with JavaScript language
 * Based on research, proper initialization requires async handling of language loading
 * @returns {Promise<boolean>} True if initialization was successful
 */
function initializeParser() {
  try {
    parser = new Parser();
    // JavaScript is a module that exports the language directly, not a function
    parser.setLanguage(JavaScript);
    console.log('[JS Analyzer] Global Tree-sitter parser initialized successfully.');
    return Promise.resolve(true);
  } catch (error) {
    console.error('[JS Analyzer] Failed to initialize tree-sitter parser:', error);
    return Promise.reject(error);
  }
}

// --- Service Implementation ---
const analyzeCode = async (call, callback) => {
  const filePath = call.request.file_path;
  const language = call.request.language;
  const sourceCode = call.request.file_content;
  console.log(`[JS Analyzer] Received analysis request for: ${filePath} (Language: ${language})`);
  console.log(`[JS Analyzer] Received file_content type: ${typeof sourceCode}, length: ${sourceCode?.length ?? 'N/A'}`);

  // --- Database Interaction & Analysis ---
  // fileId is no longer needed as we send data via API
  try {
    // Check if parser is initialized
    if (!parser) {
      console.error('[JS Analyzer] Error: Parser not initialized');
      return callback({
        code: grpc.status.FAILED_PRECONDITION,
        details: 'Tree-sitter parser not initialized.'
      });
    }

    // Validate input
    if (typeof sourceCode !== 'string') {
      console.error('[JS Analyzer] Error: Missing or invalid file_content');
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Missing or invalid file_content in request.'
      });
    }

    // 1. Calculate code hash
    const codeHash = sha256(sourceCode);
    console.log(`[JS Analyzer] Code hash for ${filePath}: ${codeHash.substring(0, 10)}...`);

    // Step 2 (Get/Create File in DB) is removed.

    // 2. Parse code with error handling (renumbered)
    let tree;
    try {
      tree = parser.parse(sourceCode);
      if (!tree || !tree.rootNode) {
        throw new Error('Failed to generate valid syntax tree');
      }
      console.log(`[JS Analyzer] Parsed AST for ${filePath}. Starting analysis...`);
    } catch (parseError) {
      console.error(`[JS Analyzer] Error parsing ${filePath}:`, parseError);
      return callback({
        code: grpc.status.INTERNAL,
        details: `Failed to parse JavaScript code: ${parseError.message}`
      });
    }

    // 3. Call the analyzer logic (renumbered)
    // Note: analyze now returns { nodes, relationships }
    const analysisResult = analyze(tree.rootNode, filePath, sourceCode);
    console.log(`[JS Analyzer] AST analysis complete. Nodes: ${analysisResult.nodes?.length ?? 0}, Relationships: ${analysisResult.relationships?.length ?? 0}`);


    // 4. Send results to API Gateway (renumbered)
    const success = await sendAnalysisData(analysisResult, filePath);
    if (!success) {
      // Error is logged within sendAnalysisData, but we should report failure back
      return callback({
        code: grpc.status.INTERNAL,
        details: `Failed to send analysis data to API Gateway for ${filePath}. Check service logs.`
      });
    }
    console.log(`[JS Analyzer] Successfully sent analysis results via API for ${filePath}.`);

    // 5. Return simple StatusResponse (renumbered)
    callback(null, {
      status: "SUCCESS",
      message: `Analysis complete and sent for ${filePath}`
    });
  } catch (e) {
    console.error(`[JS Analyzer] Error during analysis or API send for ${filePath}:`, e);
    callback({
      code: grpc.status.INTERNAL,
      details: `Internal error during analysis or API send: ${e.message}`
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
  const port = process.env.GRPC_PORT || '50057';
  
  // Initialize parser before starting server
  initializeParser()
    .then(() => {
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
    })
    .catch(error => {
      console.error('[JS Analyzer] Failed to initialize parser:', error);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[JS Analyzer] Received SIGTERM. Shutting down...');
    server.tryShutdown(() => {
      console.log('[JS Analyzer] Server shut down.');
      process.exit(0);
    });
  });
}