/**
 * Tests for the SQL Analyzer
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock the tree-sitter and tree-sitter-sql modules
jest.mock('tree-sitter', () => {
  return class Parser {
    setLanguage() {}
    parse() {
      return {
        rootNode: {
          text: 'mock SQL content'
        }
      };
    }
    getLanguage() {
      return {
        query: () => ({
          matches: () => []
        })
      };
    }
  };
});

jest.mock('@derekstride/tree-sitter-sql', () => ({}));

// Mock the ID Service client
jest.mock('../src/id-service-client', () => {
  return {
    IdServiceClient: class {
      constructor() {}
      async generateId(filePath, entityType, name, parentCanonicalId = '') {
        return [`${filePath}::${entityType}::${name}`, `sql:${filePath}::${entityType}::${name}`];
      }
      close() {}
    }
  };
});

// Import the modules after mocking
const { analyzeSqlFile } = require('../src/ast-visitor');
const { createAnalysisNodeStubs, createAnalysisRelationshipStubs } = require('../src/index');
const { SqlEntityType, SqlRelationshipType } = require('../src/models');

describe('SQL Analyzer', () => {
  let tempSqlFile;

  beforeEach(() => {
    // Create a temporary SQL file for testing
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-analyzer-test-'));
    tempSqlFile = path.join(tempDir, 'test.sql');
    
    const sqlContent = `
      CREATE TABLE users (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE posts (
        id INT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE VIEW user_posts AS
      SELECT u.name, p.title, p.content
      FROM users u
      JOIN posts p ON u.id = p.user_id;

      CREATE FUNCTION get_user_posts(user_id INT)
      RETURNS TABLE (title VARCHAR, content TEXT) AS $$
      BEGIN
        RETURN QUERY SELECT p.title, p.content
        FROM posts p
        WHERE p.user_id = user_id;
      END;
      $$ LANGUAGE plpgsql;
    `;
    
    fs.writeFileSync(tempSqlFile, sqlContent);
  });

  afterEach(() => {
    // Clean up temporary files
    if (tempSqlFile && fs.existsSync(tempSqlFile)) {
      fs.unlinkSync(tempSqlFile);
      fs.rmdirSync(path.dirname(tempSqlFile));
    }
  });

  test('analyzeSqlFile should extract nodes and relationships', async () => {
    // Create a mock ID Service client (already mocked above)
    const mockIdServiceClient = new (require('../src/id-service-client').IdServiceClient)();
    
    // Analyze the SQL file
    const [nodes, relationships] = await analyzeSqlFile(tempSqlFile, mockIdServiceClient);
    
    // Verify that nodes were extracted
    expect(nodes.length).toBeGreaterThan(0);
    
    // Verify that the file node was created
    const fileNode = nodes.find(node => node.type === SqlEntityType.File);
    expect(fileNode).toBeDefined();
    expect(fileNode.name).toBe(path.basename(tempSqlFile));
    
    // Create node stubs
    const nodeStubs = createAnalysisNodeStubs(nodes);
    expect(nodeStubs.length).toBe(nodes.length);
    
    // Create relationship stubs
    const relationshipStubs = createAnalysisRelationshipStubs(relationships);
    expect(relationshipStubs.length).toBe(relationships.length);
  });

  test('createAnalysisNodeStubs should create proper node stubs', () => {
    // Create test nodes
    const nodes = [
      {
        type: SqlEntityType.Table,
        name: 'users',
        path: tempSqlFile,
        parent_canonical_id: `${tempSqlFile}::${SqlEntityType.File}::test.sql`,
        canonical_id: `${tempSqlFile}::${SqlEntityType.Table}::users`,
        gid: `sql:${tempSqlFile}::${SqlEntityType.Table}::users`,
        properties: {
          columns: ['id', 'name', 'email', 'created_at']
        }
      },
      {
        type: SqlEntityType.Column,
        name: 'id',
        path: tempSqlFile,
        parent_canonical_id: `${tempSqlFile}::${SqlEntityType.Table}::users`,
        canonical_id: `${tempSqlFile}::${SqlEntityType.Column}::id`,
        gid: `sql:${tempSqlFile}::${SqlEntityType.Column}::id`,
        properties: {
          data_type: 'INT',
          primary_key: true
        }
      }
    ];
    
    // Create node stubs
    const nodeStubs = createAnalysisNodeStubs(nodes);
    
    // Verify node stubs
    expect(nodeStubs.length).toBe(2);
    
    // Verify table node stub
    const tableNodeStub = nodeStubs.find(node => node.name === 'users');
    expect(tableNodeStub).toBeDefined();
    expect(tableNodeStub.labels).toContain(SqlEntityType.Table);
    expect(tableNodeStub.properties.columns).toEqual(['id', 'name', 'email', 'created_at']);
    
    // Verify column node stub
    const columnNodeStub = nodeStubs.find(node => node.name === 'id');
    expect(columnNodeStub).toBeDefined();
    expect(columnNodeStub.labels).toContain(SqlEntityType.Column);
    expect(columnNodeStub.properties.data_type).toBe('INT');
    expect(columnNodeStub.properties.primary_key).toBe(true);
  });

  test('createAnalysisRelationshipStubs should create proper relationship stubs', () => {
    // Create test relationships
    const relationships = [
      {
        source_gid: `sql:${tempSqlFile}::${SqlEntityType.Table}::users`,
        target_canonical_id: `${tempSqlFile}::${SqlEntityType.Column}::id`,
        type: SqlRelationshipType.DEFINES_COLUMN,
        properties: {}
      },
      {
        source_gid: `sql:${tempSqlFile}::${SqlEntityType.Table}::posts`,
        target_canonical_id: `${tempSqlFile}::${SqlEntityType.Table}::users`,
        type: SqlRelationshipType.REFERENCES,
        properties: {
          local_column: 'user_id',
          foreign_column: 'id'
        }
      }
    ];
    
    // Create relationship stubs
    const relationshipStubs = createAnalysisRelationshipStubs(relationships);
    
    // Verify relationship stubs
    expect(relationshipStubs.length).toBe(2);
    
    // Verify DEFINES_COLUMN relationship
    const definesColumnRel = relationshipStubs.find(rel => rel.type === SqlRelationshipType.DEFINES_COLUMN);
    expect(definesColumnRel).toBeDefined();
    expect(definesColumnRel.source_gid).toBe(`sql:${tempSqlFile}::${SqlEntityType.Table}::users`);
    
    // Verify REFERENCES relationship
    const referencesRel = relationshipStubs.find(rel => rel.type === SqlRelationshipType.REFERENCES);
    expect(referencesRel).toBeDefined();
    expect(referencesRel.properties.local_column).toBe('user_id');
    expect(referencesRel.properties.foreign_column).toBe('id');
  });
});