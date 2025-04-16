const fs = require('fs');
const path = require('path');
const os = require('os');
const { analyzeCSharpFile } = require('../dist/ast-visitor');
const { CSharpEntityType, CSharpRelationshipType } = require('../dist/models');

// Mock the ID Service client
jest.mock('../dist/id-service-client', () => ({
  IdServiceClient: class {
    generateIds(filePath, entityType, entityName, parentCanonicalId) {
      const canonicalId = parentCanonicalId
        ? `${parentCanonicalId}::${entityType}::${entityName}`
        : `${filePath}::${entityType}::${entityName}`;
      
      const gid = `test-gid-${Math.random().toString(36).substring(2, 15)}`;
      
      return Promise.resolve({ canonicalId, gid });
    }
    close() {}
  }
}));

describe('C# Analyzer', () => {
  let tempDir;
  let tempFilePath;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csharp-analyzer-test-'));
    tempFilePath = path.join(tempDir, 'TestClass.cs');
  });

  afterEach(() => {
    // Clean up temporary files
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }
  });

  test('should parse a simple C# class', async () => {
    // Create a simple C# class file
    const csharpCode = `
using System;
using System.Collections.Generic;

namespace TestNamespace
{
    public class TestClass
    {
        private readonly ILogger _logger;
        
        public TestClass(ILogger logger)
        {
            _logger = logger;
        }
        
        public string Name { get; set; }
        
        public void DoSomething()
        {
            _logger.Log("Doing something");
            Console.WriteLine("Hello, world!");
        }
    }
}`;

    fs.writeFileSync(tempFilePath, csharpCode);

    // Process the file
    // Create a mock IdServiceClient
    const { IdServiceClient } = require('../dist/id-service-client');
    const idServiceClient = new IdServiceClient();
    
    // Process the file
    const [nodes, relationships] = await analyzeCSharpFile(tempFilePath, idServiceClient);
    
    // Format the result to match the expected test format
    const result = {
      file_path: tempFilePath,
      language: 'csharp',
      nodes_upserted: nodes.map(node => ({
        ...node,
        labels: [node.type],
        canonical_id: node.canonical_id,
        parent_canonical_id: node.parent_canonical_id
      })),
      relationships_upserted: relationships
    };

    // Verify the result
    expect(result).toBeDefined();
    expect(result.file_path).toBe(tempFilePath);
    expect(result.language).toBe('csharp');
    expect(result.error).toBeUndefined();

    // Check nodes
    expect(result.nodes_upserted).toBeDefined();
    expect(result.nodes_upserted.length).toBeGreaterThan(0);

    // Verify file node
    const fileNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.File)
    );
    expect(fileNode).toBeDefined();
    expect(fileNode.name).toBe('TestClass.cs');

    // Verify namespace node
    const namespaceNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Namespace)
    );
    expect(namespaceNode).toBeDefined();
    expect(namespaceNode.name).toBe('TestNamespace');

    // Verify class node
    const classNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Class)
    );
    expect(classNode).toBeDefined();
    expect(classNode.name).toBe('TestClass');
    expect(classNode.properties.is_public).toBe(true);

    // Verify property node
    const propertyNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Property)
    );
    expect(propertyNode).toBeDefined();
    expect(propertyNode.name).toBe('Name');
    expect(propertyNode.properties.type).toBe('string');
    expect(propertyNode.properties.has_getter).toBe(true);
    expect(propertyNode.properties.has_setter).toBe(true);

    // Verify method node
    const methodNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Method) && 
      node.name === 'DoSomething'
    );
    expect(methodNode).toBeDefined();
    expect(methodNode.properties.return_type).toBe('void');

    // Verify field node
    const fieldNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Field)
    );
    expect(fieldNode).toBeDefined();
    expect(fieldNode.name).toBe('_logger');
    expect(fieldNode.properties.type).toBe('ILogger');
    expect(fieldNode.properties.is_readonly).toBe(true);

    // Verify constructor node
    const constructorNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Method) && 
      node.name === 'TestClass'
    );
    expect(constructorNode).toBeDefined();
    expect(constructorNode.properties.parameters).toContain('logger');
    expect(constructorNode.properties.parameter_types).toContain('ILogger');

    // Verify using nodes
    const usingNodes = result.nodes_upserted.filter(node => 
      node.labels.includes(CSharpEntityType.Using)
    );
    expect(usingNodes.length).toBe(2);
    expect(usingNodes.map(node => node.name)).toContain('System');
    expect(usingNodes.map(node => node.name)).toContain('System.Collections.Generic');

    // Check relationships
    expect(result.relationships_upserted).toBeDefined();
    expect(result.relationships_upserted.length).toBeGreaterThan(0);

    // Verify CONTAINS relationships
    const containsRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.CONTAINS
    );
    expect(containsRelationships.length).toBeGreaterThan(0);

    // Verify IMPORTS relationships
    const importsRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.IMPORTS
    );
    expect(importsRelationships.length).toBe(2);

    // Verify CALLS relationships
    const callsRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.CALLS
    );
    expect(callsRelationships.length).toBeGreaterThan(0);

    // Verify USES_TYPE relationships
    const usesTypeRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.USES_TYPE
    );
    expect(usesTypeRelationships.length).toBeGreaterThan(0);

    // Verify DEPENDS_ON relationships
    const dependsOnRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.DEPENDS_ON
    );
    expect(dependsOnRelationships.length).toBeGreaterThan(0);
  });

  test('should parse a C# interface with methods and properties', async () => {
    // Create a C# interface file
    const csharpCode = `
using System;

namespace TestNamespace
{
    public interface IRepository<T> where T : class
    {
        T GetById(int id);
        IEnumerable<T> GetAll();
        void Add(T entity);
        void Update(T entity);
        void Delete(int id);
        
        int Count { get; }
    }
}`;

    fs.writeFileSync(tempFilePath, csharpCode);

    // Process the file
    // Create a mock IdServiceClient
    const { IdServiceClient } = require('../dist/id-service-client');
    const idServiceClient = new IdServiceClient();
    
    // Process the file
    const [nodes, relationships] = await analyzeCSharpFile(tempFilePath, idServiceClient);
    
    // Format the result to match the expected test format
    const result = {
      file_path: tempFilePath,
      language: 'csharp',
      nodes_upserted: nodes.map(node => ({
        ...node,
        labels: [node.type],
        canonical_id: node.canonical_id,
        parent_canonical_id: node.parent_canonical_id
      })),
      relationships_upserted: relationships
    };

    // Verify the result
    expect(result).toBeDefined();
    expect(result.file_path).toBe(tempFilePath);
    expect(result.language).toBe('csharp');
    expect(result.error).toBeUndefined();

    // Check nodes
    expect(result.nodes_upserted).toBeDefined();
    expect(result.nodes_upserted.length).toBeGreaterThan(0);

    // Verify interface node
    const interfaceNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Interface)
    );
    expect(interfaceNode).toBeDefined();
    expect(interfaceNode.name).toBe('IRepository');
    expect(interfaceNode.properties.is_public).toBe(true);

    // Verify method nodes
    const methodNodes = result.nodes_upserted.filter(node => 
      node.labels.includes(CSharpEntityType.Method) && 
      node.parent_canonical_id === interfaceNode.canonical_id
    );
    expect(methodNodes.length).toBe(5);
    
    const getByIdMethod = methodNodes.find(node => node.name === 'GetById');
    expect(getByIdMethod).toBeDefined();
    expect(getByIdMethod.properties.parameters).toContain('id');
    expect(getByIdMethod.properties.parameter_types).toContain('int');
    expect(getByIdMethod.properties.return_type).toBe('T');

    // Verify property node
    const propertyNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Property) && 
      node.parent_canonical_id === interfaceNode.canonical_id
    );
    expect(propertyNode).toBeDefined();
    expect(propertyNode.name).toBe('Count');
    expect(propertyNode.properties.type).toBe('int');
    expect(propertyNode.properties.has_getter).toBe(true);
    expect(propertyNode.properties.has_setter).toBe(false);
  });

  test('should parse a C# class with attributes', async () => {
    // Create a C# class with attributes
    const csharpCode = `
using System;
using System.ComponentModel.DataAnnotations;

namespace TestNamespace
{
    [Serializable]
    public class User
    {
        [Key]
        public int Id { get; set; }
        
        [Required]
        [StringLength(100)]
        public string Username { get; set; }
        
        [EmailAddress]
        public string Email { get; set; }
        
        [DataType(DataType.Password)]
        public string Password { get; set; }
        
        [Display(Name = "Created Date")]
        public DateTime CreatedAt { get; set; }
        
        [HttpPost]
        public void Save()
        {
            // Save user
        }
    }
}`;

    fs.writeFileSync(tempFilePath, csharpCode);

    // Process the file
    // Create a mock IdServiceClient
    const { IdServiceClient } = require('../dist/id-service-client');
    const idServiceClient = new IdServiceClient();
    
    // Process the file
    const [nodes, relationships] = await analyzeCSharpFile(tempFilePath, idServiceClient);
    
    // Format the result to match the expected test format
    const result = {
      file_path: tempFilePath,
      language: 'csharp',
      nodes_upserted: nodes.map(node => ({
        ...node,
        labels: [node.type],
        canonical_id: node.canonical_id,
        parent_canonical_id: node.parent_canonical_id
      })),
      relationships_upserted: relationships
    };

    // Verify the result
    expect(result).toBeDefined();
    expect(result.file_path).toBe(tempFilePath);
    expect(result.language).toBe('csharp');
    expect(result.error).toBeUndefined();

    // Check nodes
    expect(result.nodes_upserted).toBeDefined();
    expect(result.nodes_upserted.length).toBeGreaterThan(0);

    // Verify class node
    const classNode = result.nodes_upserted.find(node => 
      node.labels.includes(CSharpEntityType.Class)
    );
    expect(classNode).toBeDefined();
    expect(classNode.name).toBe('User');

    // Verify attribute nodes
    const attributeNodes = result.nodes_upserted.filter(node => 
      node.labels.includes(CSharpEntityType.Attribute)
    );
    expect(attributeNodes.length).toBeGreaterThan(0);
    
    const attributeNames = attributeNodes.map(node => node.name);
    expect(attributeNames).toContain('Serializable');
    expect(attributeNames).toContain('Key');
    expect(attributeNames).toContain('Required');
    expect(attributeNames).toContain('StringLength');
    expect(attributeNames).toContain('EmailAddress');
    expect(attributeNames).toContain('DataType');
    expect(attributeNames).toContain('Display');
    expect(attributeNames).toContain('HttpPost');

    // Verify ANNOTATED_WITH relationships
    const annotatedWithRelationships = result.relationships_upserted.filter(rel => 
      rel.type === CSharpRelationshipType.ANNOTATED_WITH
    );
    expect(annotatedWithRelationships.length).toBeGreaterThan(0);
  });
});