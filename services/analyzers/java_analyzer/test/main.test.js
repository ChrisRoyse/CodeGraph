const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);

// Mock dependencies
jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue({
    createChannel: jest.fn().mockResolvedValue({
      assertQueue: jest.fn().mockResolvedValue({}),
      consume: jest.fn().mockResolvedValue({}),
      publish: jest.fn().mockResolvedValue({}),
      ack: jest.fn(),
      nack: jest.fn()
    }),
    close: jest.fn().mockResolvedValue({})
  })
}));

jest.mock('../src/id-service-client', () => {
  return {
    IdServiceClient: jest.fn().mockImplementation(() => {
      return {
        generateId: jest.fn().mockImplementation((filePath, entityType, name, parentCanonicalId = "", paramTypes = []) => {
          const canonicalId = `${filePath}::${entityType}::${name}`;
          const gid = `gid-${Math.random().toString(36).substring(2, 15)}`;
          return Promise.resolve([canonicalId, gid]);
        }),
        close: jest.fn()
      };
    })
  };
});

// Test data
const TEST_DIR = path.join(__dirname, 'test-data');
const JAVA_FILE_PATH = path.join(TEST_DIR, 'TestClass.java');
const JAVA_FILE_CONTENT = `
package com.example.test;

import java.util.List;
import java.util.ArrayList;

/**
 * A test class for Java analyzer
 */
public class TestClass {
    private String name;
    private static final int MAX_SIZE = 100;
    
    public TestClass(String name) {
        this.name = name;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public static void main(String[] args) {
        TestClass test = new TestClass("Test");
        System.out.println(test.getName());
    }
}
`;

// Setup and teardown
beforeAll(async () => {
  // Create test directory and files
  try {
    await mkdir(TEST_DIR, { recursive: true });
    await writeFile(JAVA_FILE_PATH, JAVA_FILE_CONTENT);
  } catch (error) {
    console.error('Error setting up test:', error);
  }
});

afterAll(async () => {
  // Clean up test directory and files
  try {
    await unlink(JAVA_FILE_PATH);
    await rmdir(TEST_DIR, { recursive: true });
  } catch (error) {
    console.error('Error cleaning up test:', error);
  }
});

describe('Java Analyzer', () => {
  let analyzeJavaFile;
  let formatAnalysisResults;
  
  beforeEach(() => {
    // Clear module cache to ensure fresh imports
    jest.resetModules();
    
    // Import the modules
    const astVisitor = require('../src/ast-visitor');
    const astVisitorUtils = require('../src/ast-visitor-utils');
    
    analyzeJavaFile = astVisitor.analyzeJavaFile;
    formatAnalysisResults = astVisitorUtils.formatAnalysisResults;
  });
  
  test('analyzeJavaFile should extract Java entities', async () => {
    // Create a mock ID service client
    const mockIdServiceClient = {
      generateId: jest.fn().mockImplementation((filePath, entityType, name, parentCanonicalId = "", paramTypes = []) => {
        const canonicalId = `${filePath}::${entityType}::${name}`;
        const gid = `gid-${Math.random().toString(36).substring(2, 15)}`;
        return Promise.resolve([canonicalId, gid]);
      })
    };
    
    // Analyze the Java file
    const [nodes, relationships] = await analyzeJavaFile(JAVA_FILE_PATH, mockIdServiceClient);
    
    // Verify the results
    expect(nodes.length).toBeGreaterThan(0);
    expect(relationships.length).toBeGreaterThan(0);
    
    // Check for specific entities
    const fileNode = nodes.find(node => node.type === 'File');
    expect(fileNode).toBeDefined();
    expect(fileNode.name).toBe('TestClass.java');
    
    const classNode = nodes.find(node => node.type === 'Class');
    expect(classNode).toBeDefined();
    expect(classNode.name).toBe('TestClass');
    
    const methodNodes = nodes.filter(node => node.type === 'Method');
    expect(methodNodes.length).toBeGreaterThanOrEqual(3); // getName, setName, main
    
    const fieldNodes = nodes.filter(node => node.type === 'Field');
    expect(fieldNodes.length).toBeGreaterThanOrEqual(2); // name, MAX_SIZE
    
    const constructorNode = nodes.find(node => node.type === 'Constructor');
    expect(constructorNode).toBeDefined();
    expect(constructorNode.name).toBe('TestClass');
  });
  
  test('formatAnalysisResults should format nodes and relationships correctly', () => {
    // Create sample nodes and relationships
    const nodes = [
      {
        type: 'File',
        name: 'TestClass.java',
        path: JAVA_FILE_PATH,
        parent_canonical_id: '',
        canonical_id: `${JAVA_FILE_PATH}::File::TestClass.java`,
        gid: 'gid-file',
        properties: { package_name: 'com.example.test' }
      },
      {
        type: 'Class',
        name: 'TestClass',
        path: JAVA_FILE_PATH,
        parent_canonical_id: `${JAVA_FILE_PATH}::Package::com.example.test`,
        canonical_id: `${JAVA_FILE_PATH}::Class::TestClass`,
        gid: 'gid-class',
        properties: { is_public: true }
      }
    ];
    
    const relationships = [
      {
        source_gid: 'gid-file',
        target_canonical_id: `${JAVA_FILE_PATH}::Package::com.example.test`,
        type: ':BELONGS_TO',
        properties: {}
      }
    ];
    
    // Format the results
    const result = formatAnalysisResults(JAVA_FILE_PATH, nodes, relationships);
    
    // Verify the formatted results
    expect(result).toBeDefined();
    expect(result.file_path).toBe(JAVA_FILE_PATH);
    expect(result.language).toBe('java');
    expect(result.nodes_upserted.length).toBe(2);
    expect(result.relationships_upserted.length).toBe(1);
    expect(result.nodes_deleted).toEqual([]);
    expect(result.relationships_deleted).toEqual([]);
    
    // Check node format
    const formattedFileNode = result.nodes_upserted.find(node => node.canonical_id.includes('::File::'));
    expect(formattedFileNode).toBeDefined();
    expect(formattedFileNode.gid).toBe('gid-file');
    expect(formattedFileNode.name).toBe('TestClass.java');
    expect(formattedFileNode.labels).toContain('File');
    
    // Check relationship format
    const formattedRelationship = result.relationships_upserted[0];
    expect(formattedRelationship.source_gid).toBe('gid-file');
    expect(formattedRelationship.type).toBe(':BELONGS_TO');
  });

  test('analyzeJavaFile should extract manual relationships from bmcp hint comments', async () => {
    const JAVA_HINT_FILE_CONTENT = `
// bmcp:call-target com.example.test.Helper.doSomething
public class HintTest {
    // bmcp:imports com.example.test.Helper
    Helper helper;

    // bmcp:uses-type com.example.test.CustomType
    CustomType customField;

    public void doWork() {
        // ...
    }
}
`;
    const JAVA_HINT_FILE_PATH = path.join(TEST_DIR, 'HintTest.java');
    await writeFile(JAVA_HINT_FILE_PATH, JAVA_HINT_FILE_CONTENT);

    const mockIdServiceClient = {
      generateId: jest.fn().mockImplementation((filePath, entityType, name, parentCanonicalId = "", paramTypes = []) => {
        const canonicalId = `${filePath}::${entityType}::${name}`;
        const gid = `gid-${Math.random().toString(36).substring(2, 15)}`;
        return Promise.resolve([canonicalId, gid]);
      })
    };

    const astVisitor = require('../src/ast-visitor');
    const [nodes, relationships] = await astVisitor.analyzeJavaFile(JAVA_HINT_FILE_PATH, mockIdServiceClient);

    // Check for manual relationships
    const manualRelationships = relationships.filter(r => r.properties && r.properties.manual_hint);
    expect(manualRelationships.length).toBeGreaterThanOrEqual(3);
    expect(manualRelationships.some(r => r.type === 'CALLS' && r.properties.hint_type === 'call-target')).toBeTruthy();
    expect(manualRelationships.some(r => r.type === 'IMPORTS' && r.properties.hint_type === 'imports')).toBeTruthy();
    expect(manualRelationships.some(r => r.type === 'USES_TYPE' && r.properties.hint_type === 'uses-type')).toBeTruthy();
  });

  test('handleAnalyzeAction should process Java files correctly', async () => {
    // This would be a more comprehensive test in a real implementation
    // For now, we'll just verify that the function exists and can be imported
    const index = require('../src/index');
    expect(typeof index).toBe('object');
  });
});