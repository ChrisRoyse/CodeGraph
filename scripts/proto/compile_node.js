#!/usr/bin/env node
/**
 * Script to compile Protocol Buffer definitions into JavaScript/TypeScript code.
 * Uses grpc-tools to generate JavaScript and TypeScript definitions.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const glob = require('glob');

// Root directory of the project
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// Proto files directory
const PROTO_DIR = path.join(PROJECT_ROOT, 'shared', 'proto');

// Output directories for Node.js services
const OUTPUT_DIRS = {
  'api_gateway': path.join(PROJECT_ROOT, 'services', 'api_gateway', 'generated'),
  'file_watcher_service': path.join(PROJECT_ROOT, 'services', 'file_watcher_service', 'generated'),
  'javascript_analyzer': path.join(PROJECT_ROOT, 'services', 'analyzers', 'javascript_analyzer', 'generated'),
  'typescript_analyzer': path.join(PROJECT_ROOT, 'services', 'analyzers', 'typescript_analyzer', 'generated'),
  // Add more Node.js service directories as needed
};

/**
 * Ensure all output directories exist.
 */
function ensureOutputDirs() {
  Object.values(OUTPUT_DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
    // Ensure ts-proto subdirectory exists
    const tsProtoDir = path.join(dir, 'ts-proto');
    if (!fs.existsSync(tsProtoDir)) {
      fs.mkdirSync(tsProtoDir, { recursive: true });
      console.log(`Created directory: ${tsProtoDir}`);
    }
  });
}

/**
 * Compile all .proto files to JavaScript/TypeScript code.
 * @returns {boolean} Whether compilation was successful
 */
function compileProtoFiles() {
  const protoFiles = glob.sync(`${PROTO_DIR}/*.proto`);
  
  if (protoFiles.length === 0) {
    console.log(`No .proto files found in ${PROTO_DIR}`);
    return false;
  }
  
  console.log(`Found ${protoFiles.length} .proto files to compile`);
  
  // Compile each proto file for each service
  for (const [serviceName, outputDir] of Object.entries(OUTPUT_DIRS)) {
    console.log(`\nCompiling proto files for ${serviceName}...`);
    
    for (const protoFile of protoFiles) {
      const protoFilename = path.basename(protoFile);
      console.log(`  Compiling ${protoFilename}...`);
      
      try {
        // Use grpc_tools_node_protoc to compile the proto file
        // Construct path to the locally installed protoc binary relative to this script
        const protocPath = path.resolve(__dirname, 'node_modules', '.bin', 'grpc_tools_node_protoc');
        // Check if the binary exists, potentially adding .cmd for Windows compatibility
        const protocCmd = fs.existsSync(protocPath) ? protocPath : protocPath + '.cmd';

        const cmd = [
          `"${protocCmd}"`, // Enclose in quotes in case of spaces in path
          `--proto_path=${PROTO_DIR}`,
          `--js_out=import_style=commonjs,binary:${outputDir}`,
          `--grpc_out=grpc_js:${outputDir}`,
          `--plugin=protoc-gen-ts_proto=${path.resolve(__dirname, 'node_modules', '.bin', 'protoc-gen-ts_proto' + (process.platform === 'win32' ? '.cmd' : ''))}`,
          `--ts_proto_out=${outputDir}/ts-proto`,
          path.basename(protoFile) // Use filename relative to proto_path
        ].join(' ');
        
        execSync(cmd, { stdio: 'inherit' });
        console.log(`  Successfully compiled ${protoFilename}`);
      } catch (error) {
        console.error(`  Error compiling ${protoFilename}: ${error.message}`);
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Main function to compile proto files.
 */
function main() {
  console.log('Starting Node.js Protocol Buffer compilation...');
  
  // Ensure output directories exist
  ensureOutputDirs();
  
  // Compile proto files
  const success = compileProtoFiles();
  
  if (success) {
    console.log('\nSuccessfully compiled all proto files to JavaScript/TypeScript');
  } else {
    console.log('\nFailed to compile some proto files');
    process.exit(1);
  }
}

// Run the main function
main();