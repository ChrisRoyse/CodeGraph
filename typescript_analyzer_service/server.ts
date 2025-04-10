// typescript_analyzer_service/server.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import { Project } from "ts-morph"; // Import ts-morph
import { analyze } from './analyzer'; // Import the analyzer logic (will use ts-morph)
// import { getOrCreateFile, writeAnalysisResults } from './db_writer'; // Removed DB functions
import { sendAnalysisDataToApi } from './api_client'; // Import API client function
import { sha256 } from './id_generator'; // Import hashing function

// Define types based on the protobuf definition (adjust if necessary)
// Assuming StatusResponse and AnalyzeCodeRequest are correctly generated
// You might need to import these from the generated code path
interface AnalyzeCodeRequest {
    file_path: string;
    language: string;
    file_content: string; // Match proto definition
}

interface StatusResponse {
    status: string;
    message: string;
}

interface ServerError extends Error {
    code?: grpc.status;
    details?: string;
}

// --- Protobuf Loading ---
// Use absolute path inside container, assuming Dockerfile structure
const PROTO_PATH = '/app/protobufs/analyzer.proto';
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
// Ensure 'analyzer' matches the package name in your .proto file
const analyzerProto = grpc.loadPackageDefinition(packageDefinition).analyzer as any; // Use 'as any' for simplicity or generate proper types

// --- Service Implementation ---
const analyzeCode = async (
    call: grpc.ServerUnaryCall<AnalyzeCodeRequest, StatusResponse>,
    callback: grpc.sendUnaryData<StatusResponse>
) => {
  const filePath = call.request.file_path;
  const language = call.request.language; // Should be 'typescript' or 'tsx'
  const sourceCode = call.request.file_content; // Revert to file_content
  console.log(`[TS Analyzer] Received analysis request for: ${filePath} (Language: ${language})`);

  // let fileId: number | undefined; // Removed fileId
  try {
    // 1. Calculate code hash
    const codeHash = sha256(sourceCode);
    console.log(`[TS Analyzer] Code hash for ${filePath}: ${codeHash.substring(0, 10)}...`);

    // 2. DB interaction removed
    // fileId = await getOrCreateFile(filePath, language, codeHash);
    // console.log(`[TS Analyzer] Obtained file_id: ${fileId} for ${filePath}`);

    // 3. Parse code using ts-morph
  console.log(`[TS Analyzer] Received file_content type: ${typeof sourceCode}, length: ${sourceCode?.length ?? 'N/A'}`); // Update log message
  // console.log(`[TS Analyzer] Received code snippet: ${sourceCode?.substring(0, 100)}`);

  // Validate input
  if (typeof sourceCode !== 'string') {
    console.error('[TS Analyzer] Error: Missing or invalid file_content'); // Update log message
    const error: ServerError = {
        name: "InvalidArgumentError",
        message: 'Missing or invalid file_content in request.', // Update error detail
        code: grpc.status.INVALID_ARGUMENT,
        details: 'Missing or invalid file_content in request.' // Update error detail
    };
    return callback(error, null);
  }

    // Create a ts-morph project in memory
    const project = new Project({ useInMemoryFileSystem: true });
    const sourceFile = project.createSourceFile(filePath, sourceCode);
    console.log(`[TS Analyzer] Parsed AST using ts-morph for ${filePath}. Starting analysis...`);

    // 4. Call the analyzer logic (needs refactoring for ts-morph)
    // 4. Call the analyzer logic
    const { nodes, relationships } = await analyze(sourceFile, filePath); // Pass SourceFile, removed fileId
    console.log(`[TS Analyzer] AST analysis complete. Nodes: ${nodes?.length ?? 0}, Relationships: ${relationships?.length ?? 0}`);

    // 5. Send results to API Gateway (TODO: Implement API call)
    // 5. Send results to API Gateway
    const analysisLanguage = language === 'tsx' ? 'tsx' : 'typescript'; // Ensure correct language type
    await sendAnalysisDataToApi(analysisLanguage, filePath, nodes, relationships);
    console.log(`[TS Analyzer] Successfully sent analysis results via API for ${filePath}.`);

    // 6. Return simple StatusResponse
    callback(null, {
      status: "SUCCESS",
      message: `Analysis complete and results sent for ${filePath}` // Updated message
    });

  } catch (e: any) {
    console.error(`[TS Analyzer] Error during analysis or API submission for ${filePath}:`, e);
    const error: ServerError = {
        name: e.name || "Error",
        message: `Internal error during analysis or API submission: ${e.message || 'Unknown error'}`,
        code: grpc.status.INTERNAL,
        details: `Internal error during analysis or API submission: ${e.message || 'Unknown error'}`
    };
    callback(error, null);
  }
};


// --- Server Setup ---
const getServer = (): grpc.Server => {
  const server = new grpc.Server();
  // Add the main AnalyzerService
  // Ensure the service name matches the one in your proto definition
  server.addService(analyzerProto.AnalyzerService.service, { analyzeCode });
  return server;
};

if (require.main === module) {
  const port = process.env.GRPC_PORT || '50058'; // Default to 50058 for TS
  const server = getServer();
  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err: Error | null, port: number) => {
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