/**
 * Integration Test Client for ID Service
 * 
 * This script tests the ID Service's gRPC API by connecting to a running
 * ID Service instance and testing both GenerateId and ParseId RPCs with
 * various inputs to verify the service is working correctly.
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const util = require('util');

// Configuration
const config = {
  host: process.env.ID_SERVICE_HOST || 'localhost',
  port: process.env.ID_SERVICE_PORT || '50051',
  protoPath: path.resolve(__dirname, '../shared/proto/id_service.proto')
};

// Test cases for GenerateId
const generateIdTestCases = [
  {
    name: 'Basic Function',
    request: {
      file_path: 'src/app.js',
      entity_type: 'Function',
      name: 'calculateTotal'
    }
  },
  {
    name: 'Function with Parameters',
    request: {
      file_path: 'src/app.js',
      entity_type: 'Function',
      name: 'calculateTotal',
      param_types: ['number', 'number']
    }
  },
  {
    name: 'Class Method',
    request: {
      file_path: 'src/models/user.ts',
      entity_type: 'Method',
      name: 'getUserById',
      parent_canonical_id: 'src/models/user.ts::Class::User',
      param_types: ['string']
    }
  },
  {
    name: 'Python Function',
    request: {
      file_path: 'src/utils.py',
      entity_type: 'Function',
      name: 'process_data',
      language_hint: 'python'
    }
  },
  {
    name: 'File Entity',
    request: {
      file_path: 'src/index.html',
      entity_type: 'File',
      name: 'index.html',
      language_hint: 'html'
    }
  },
  {
    name: 'SQL Table',
    request: {
      file_path: 'db/schema.sql',
      entity_type: 'Table',
      name: 'users',
      language_hint: 'sql'
    }
  },
  {
    name: 'SQL Column',
    request: {
      file_path: 'db/schema.sql',
      entity_type: 'Column',
      name: 'email',
      parent_canonical_id: 'db/schema.sql::Table::users',
      language_hint: 'sql'
    }
  },
  {
    name: 'React Component',
    request: {
      file_path: 'src/components/Button.jsx',
      entity_type: 'Component',
      name: 'Button',
      language_hint: 'jsx'
    }
  },
  {
    name: 'CSS Rule',
    request: {
      file_path: 'src/styles/main.css',
      entity_type: 'Rule',
      name: '.container',
      language_hint: 'css'
    }
  },
  {
    name: 'Edge Case: Special Characters',
    request: {
      file_path: 'src/utils.js',
      entity_type: 'Function',
      name: 'handle$special-chars!'
    }
  }
];

// Helper function to format output
function formatOutput(data) {
  return util.inspect(data, { depth: null, colors: true });
}

// Main function
async function main() {
  try {
    console.log('Loading proto definition from', config.protoPath);
    
    // Load the protobuf definition
    const packageDefinition = protoLoader.loadSync(config.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    
    // Create the gRPC service definition
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const idService = protoDescriptor.bmcp.id_service;
    
    // Create a client
    const client = new idService.IdService(
      `${config.host}:${config.port}`,
      grpc.credentials.createInsecure()
    );
    
    // Promisify the client methods
    const generateId = util.promisify(client.generateId).bind(client);
    const parseId = util.promisify(client.parseId).bind(client);
    
    console.log(`\nConnecting to ID Service at ${config.host}:${config.port}...\n`);
    
    // Test GenerateId RPC
    console.log('=== Testing GenerateId RPC ===\n');
    
    const generatedIds = [];
    
    for (const testCase of generateIdTestCases) {
      console.log(`Test Case: ${testCase.name}`);
      console.log('Request:', formatOutput(testCase.request));
      
      try {
        const response = await generateId(testCase.request);
        console.log('Response:', formatOutput(response));
        
        // Store the generated IDs for testing ParseId
        generatedIds.push({
          name: testCase.name,
          canonical_id: response.canonical_id,
          gid: response.gid
        });
        
        console.log('✓ Test passed\n');
      } catch (error) {
        console.error('✗ Test failed:', error.message, '\n');
      }
    }
    
    // Test error cases for GenerateId
    console.log('=== Testing GenerateId Error Cases ===\n');
    
    // Missing required fields
    const errorCases = [
      {
        name: 'Missing file_path',
        request: {
          entity_type: 'Function',
          name: 'myFunction'
        }
      },
      {
        name: 'Missing entity_type',
        request: {
          file_path: 'src/app.js',
          name: 'myFunction'
        }
      },
      {
        name: 'Missing name',
        request: {
          file_path: 'src/app.js',
          entity_type: 'Function'
        }
      },
      {
        name: 'Invalid entity_type',
        request: {
          file_path: 'src/app.js',
          entity_type: 'InvalidType',
          name: 'myFunction'
        }
      }
    ];
    
    for (const errorCase of errorCases) {
      console.log(`Error Case: ${errorCase.name}`);
      console.log('Request:', formatOutput(errorCase.request));
      
      try {
        const response = await generateId(errorCase.request);
        console.log('Unexpected success:', formatOutput(response));
        console.log('✗ Test failed: Expected an error\n');
      } catch (error) {
        console.log('Expected error:', error.message);
        console.log('✓ Test passed\n');
      }
    }
    
    // Test ParseId RPC
    console.log('=== Testing ParseId RPC ===\n');
    
    // Test parsing the generated canonical IDs
    for (const id of generatedIds) {
      console.log(`Test Case: Parse Canonical ID from "${id.name}"`);
      console.log('Request:', { id_string: id.canonical_id });
      
      try {
        const response = await parseId({ id_string: id.canonical_id });
        console.log('Response:', formatOutput(response));
        console.log('✓ Test passed\n');
      } catch (error) {
        console.error('✗ Test failed:', error.message, '\n');
      }
    }
    
    // Test parsing the generated GIDs
    for (const id of generatedIds) {
      console.log(`Test Case: Parse GID from "${id.name}"`);
      console.log('Request:', { id_string: id.gid });
      
      try {
        const response = await parseId({ id_string: id.gid });
        console.log('Response:', formatOutput(response));
        console.log('✓ Test passed\n');
      } catch (error) {
        console.error('✗ Test failed:', error.message, '\n');
      }
    }
    
    // Test error cases for ParseId
    console.log('=== Testing ParseId Error Cases ===\n');
    
    const parseErrorCases = [
      {
        name: 'Empty ID string',
        request: { id_string: '' }
      },
      {
        name: 'Invalid ID format',
        request: { id_string: 'not-a-valid-id' }
      }
    ];
    
    for (const errorCase of parseErrorCases) {
      console.log(`Error Case: ${errorCase.name}`);
      console.log('Request:', formatOutput(errorCase.request));
      
      try {
        const response = await parseId(errorCase.request);
        console.log('Unexpected success:', formatOutput(response));
        console.log('✗ Test failed: Expected an error\n');
      } catch (error) {
        console.log('Expected error:', error.message);
        console.log('✓ Test passed\n');
      }
    }
    
    console.log('=== Test Summary ===\n');
    console.log('All tests completed.');
    
  } catch (error) {
    console.error('Error running tests:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch(console.error);