/**
 * Unit Tests for JavaScript/TypeScript Analyzer Service
 * 
 * This module contains unit tests for the JavaScript/TypeScript Analyzer service.
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const { IdServiceClient } = require('../dist/id-service-client');
const { analyzeJsFile } = require('../dist/ast-visitor');
const { createAnalysisNodeStubs, createAnalysisRelationshipStubs } = require('../dist/index');

// Mock modules
jest.mock('../dist/id-service-client');
jest.mock('amqplib');

// Test fixtures
const TEST_DIR = path.join(__dirname, 'fixtures');
const JS_TEST_FILE = path.join(TEST_DIR, 'test.js');
const TS_TEST_FILE = path.join(TEST_DIR, 'test.ts');

// Sample code for testing
const JS_TEST_CODE = `
// Sample JavaScript code for testing
const fs = require('fs');
const path = require('path');

class TestClass {
  constructor(name) {
    this.name = name;
  }
  
  greet() {
    console.log(\`Hello, \${this.name}!\`);
  }
}

function testFunction(param1, param2) {
  return param1 + param2;
}

const arrowFunc = (x) => x * 2;

module.exports = { TestClass, testFunction, arrowFunc };
`;

const TS_TEST_CODE = `
// Sample TypeScript code for testing
import * as fs from 'fs';
import path from 'path';

interface Person {
  name: string;
  age: number;
}

class TestClass {
  private name: string;
  
  constructor(name: string) {
    this.name = name;
  }
  
  greet(): void {
    console.log(\`Hello, \${this.name}!\`);
  }
}

function testFunction(param1: number, param2: number): number {
  return param1 + param2;
}

const arrowFunc = (x: number): number => x * 2;

export { TestClass, testFunction, arrowFunc };
`;

// Setup and teardown
beforeAll(async () => {
  // Create test directory if it doesn't exist
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  
  // Create test files
  await writeFile(JS_TEST_FILE, JS_TEST_CODE);
  await writeFile(TS_TEST_FILE, TS_TEST_CODE);
});

afterAll(async () => {
  // Clean up test files
  await unlink(JS_TEST_FILE);
  await unlink(TS_TEST_FILE);
});

// Mock ID Service client
beforeEach(() => {
  // Reset mocks
  jest.clearAllMocks();
  
  // Mock the generateId method
  IdServiceClient.prototype.generateId = jest.fn().mockImplementation(
    (filePath, entityType, name, parentCanonicalId = "", paramTypes = [], languageHint = "javascript") => {
      const canonicalId = `${filePath}::${entityType}::${name}`;
      const gid = `${languageHint}:${canonicalId}`;
      return Promise.resolve([canonicalId, gid]);
    }
  );
});

describe('JavaScript Analyzer', () => {
  test('should analyze JavaScript file correctly', async () => {
    // Create ID Service client
    const idServiceClient = new IdServiceClient('localhost', '50051');
    
    // Analyze the file
    const [nodes, relationships] = await analyzeJsFile(JS_TEST_FILE, idServiceClient);
    
    // Check that nodes were extracted
    expect(nodes.length).toBeGreaterThan(0);
    
    // Check for file node
    const fileNode = nodes.find(node => node.type === 'File');
    expect(fileNode).toBeDefined();
    expect(fileNode.name).toBe('test.js');
    expect(fileNode.path).toBe(JS_TEST_FILE);
    
    // Check for class node
    const classNode = nodes.find(node => node.type === 'Class' && node.name === 'TestClass');
    expect(classNode).toBeDefined();
    
    // Check for method node
    const methodNode = nodes.find(node => node.type === 'Method' && node.name === 'greet');
    expect(methodNode).toBeDefined();
    
    // Check for function node
    const functionNode = nodes.find(node => node.type === 'Function' && node.name === 'testFunction');
    expect(functionNode).toBeDefined();
    expect(functionNode.param_types).toContain('param1');
    expect(functionNode.param_types).toContain('param2');
    
    // Check for require relationships
    const requireRels = relationships.filter(rel => 
      rel.type === ':IMPORTS' && 
      rel.properties.method === 'require'
    );
    expect(requireRels.length).toBeGreaterThan(0);
    
    // Check for function call relationships
    const callRels = relationships.filter(rel => rel.type === ':CALLS');
    expect(callRels.length).toBeGreaterThan(0);
  });
  
  test('should analyze TypeScript file correctly', async () => {
    // Create ID Service client
    const idServiceClient = new IdServiceClient('localhost', '50051');
    
    // Analyze the file
    const [nodes, relationships] = await analyzeJsFile(TS_TEST_FILE, idServiceClient);
    
    // Check that nodes were extracted
    expect(nodes.length).toBeGreaterThan(0);
    
    // Check for file node
    const fileNode = nodes.find(node => node.type === 'File');
    expect(fileNode).toBeDefined();
    expect(fileNode.name).toBe('test.ts');
    expect(fileNode.path).toBe(TS_TEST_FILE);
    
    // Check for class node
    const classNode = nodes.find(node => node.type === 'Class' && node.name === 'TestClass');
    expect(classNode).toBeDefined();
    
    // Check for method node
    const methodNode = nodes.find(node => node.type === 'Method' && node.name === 'greet');
    expect(methodNode).toBeDefined();
    
    // Check for function node
    const functionNode = nodes.find(node => node.type === 'Function' && node.name === 'testFunction');
    expect(functionNode).toBeDefined();
    expect(functionNode.param_types).toContain('param1');
    expect(functionNode.param_types).toContain('param2');
    
    // Check for import relationships
    const importRels = relationships.filter(rel => rel.type === ':IMPORTS');
    expect(importRels.length).toBeGreaterThan(0);
    
    // Check for function call relationships
    const callRels = relationships.filter(rel => rel.type === ':CALLS');
    expect(callRels.length).toBeGreaterThan(0);
  });
  
  test('should handle errors gracefully', async () => {
    // Create ID Service client
    const idServiceClient = new IdServiceClient('localhost', '50051');
    
    // Analyze a non-existent file
    const [nodes, relationships] = await analyzeJsFile('non-existent-file.js', idServiceClient);
    
    // Check that empty arrays are returned
    expect(nodes).toEqual([]);
    expect(relationships).toEqual([]);
  });
  
  test('should create node stubs correctly', () => {
    // Sample nodes
    const nodes = [
      {
        type: 'File',
        name: 'test.js',
        path: 'test/file.js',
        parent_canonical_id: '',
        canonical_id: 'test/file.js::File::test.js',
        gid: 'javascript:test/file.js::File::test.js'
      },
      {
        type: 'Function',
        name: 'testFunction',
        path: 'test/file.js',
        parent_canonical_id: 'test/file.js::File::test.js',
        param_types: ['param1', 'param2'],
        canonical_id: 'test/file.js::Function::testFunction',
        gid: 'javascript:test/file.js::Function::testFunction'
      }
    ];
    
    // Create node stubs
    const nodeStubs = createAnalysisNodeStubs(nodes);
    
    // Check that node stubs were created correctly
    expect(nodeStubs.length).toBe(2);
    
    // Check file node stub
    const fileNodeStub = nodeStubs.find(node => node.labels.includes('File'));
    expect(fileNodeStub).toBeDefined();
    expect(fileNodeStub.gid).toBe('javascript:test/file.js::File::test.js');
    expect(fileNodeStub.canonical_id).toBe('test/file.js::File::test.js');
    expect(fileNodeStub.name).toBe('test.js');
    expect(fileNodeStub.file_path).toBe('test/file.js');
    expect(fileNodeStub.language).toBe('javascript');
    expect(fileNodeStub.labels).toEqual(['File']);
    
    // Check function node stub
    const functionNodeStub = nodeStubs.find(node => node.labels.includes('Function'));
    expect(functionNodeStub).toBeDefined();
    expect(functionNodeStub.gid).toBe('javascript:test/file.js::Function::testFunction');
    expect(functionNodeStub.canonical_id).toBe('test/file.js::Function::testFunction');
    expect(functionNodeStub.name).toBe('testFunction');
    expect(functionNodeStub.file_path).toBe('test/file.js');
    expect(functionNodeStub.language).toBe('javascript');
    expect(functionNodeStub.labels).toEqual(['Function']);
    expect(functionNodeStub.properties.param_types).toEqual(['param1', 'param2']);
  });
  
  test('should create relationship stubs correctly', () => {
    // Sample relationships
    const relationships = [
      {
        source_gid: 'javascript:test/file.js::Function::testFunction',
        target_canonical_id: 'javascript::Function::console.log',
        type: ':CALLS',
        properties: {}
      },
      {
        source_gid: 'javascript:test/file.js::Function::testFunction',
        target_canonical_id: 'javascript::Module::fs',
        type: ':IMPORTS',
        properties: { method: 'require' }
      }
    ];
    
    // Create relationship stubs
    const relationshipStubs = createAnalysisRelationshipStubs(relationships);
    
    // Check that relationship stubs were created correctly
    expect(relationshipStubs.length).toBe(2);
    
    // Check call relationship stub
    const callRelStub = relationshipStubs.find(rel => rel.type === ':CALLS');
    expect(callRelStub).toBeDefined();
    expect(callRelStub.source_gid).toBe('javascript:test/file.js::Function::testFunction');
    expect(callRelStub.target_canonical_id).toBe('javascript::Function::console.log');
    expect(callRelStub.properties).toEqual({});
    
    // Check import relationship stub
    const importRelStub = relationshipStubs.find(rel => rel.type === ':IMPORTS');
    expect(importRelStub).toBeDefined();
    expect(importRelStub.source_gid).toBe('javascript:test/file.js::Function::testFunction');
    expect(importRelStub.target_canonical_id).toBe('javascript::Module::fs');
    expect(importRelStub.properties).toEqual({ method: 'require' });
  });
test('should extract manual relationships from bmcp hint comments', async () => {
  const JS_HINT_FILE = path.join(TEST_DIR, 'hint_test.js');
  const JS_HINT_CODE = `
// bmcp:call-target my.module.Helper.doSomething
function foo() {}

// bmcp:imports my.module.Helper
const Helper = require('my/module/Helper');

// bmcp:uses-type my.module.CustomType
let customField;
/* rest of code */
`;

  await writeFile(JS_HINT_FILE, JS_HINT_CODE);

  const idServiceClient = new IdServiceClient('localhost', '50051');
  const [nodes, relationships] = await analyzeJsFile(JS_HINT_FILE, idServiceClient);

  // Check for manual relationships
  const manualRelationships = relationships.filter(r => r.properties && r.properties.manual_hint);
  expect(manualRelationships.length).toBeGreaterThanOrEqual(3);
  expect(manualRelationships.some(r => r.type === ':CALLS' && r.properties.hint_type === 'call-target')).toBeTruthy();
  expect(manualRelationships.some(r => r.type === ':IMPORTS' && r.properties.hint_type === 'imports')).toBeTruthy();
  expect(manualRelationships.some(r => r.type === ':USES_TYPE' && r.properties.hint_type === 'uses-type')).toBeTruthy();

  await unlink(JS_HINT_FILE);
});
});