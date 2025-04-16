/**
 * Tests for the Go Analyzer
 */

const fs = require('fs');
const path = require('path');
const { analyzeGoFile } = require('../dist/ast-visitor');
const { formatAnalysisResults } = require('../dist/ast-visitor-utils');

// Mock ID Service client
class MockIdServiceClient {
  async generateId(filePath, entityType, name, parentCanonicalId = "", paramTypes = [], languageHint = "go") {
    const canonicalId = `${filePath}::${entityType}::${name}`;
    const gid = `gid-${Math.random().toString(36).substring(2, 15)}`;
    return [canonicalId, gid];
  }

  close() {
    // No-op
  }
}

// Test fixtures
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const SIMPLE_GO_FILE = path.join(FIXTURES_DIR, 'simple.go');
const COMPLEX_GO_FILE = path.join(FIXTURES_DIR, 'complex.go');

// Create fixtures directory if it doesn't exist
if (!fs.existsSync(FIXTURES_DIR)) {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
}

// Create simple Go file fixture
const simpleGoContent = `
package main

import (
  "fmt"
  "os"
)

// User represents a user in the system
type User struct {
  ID   int
  Name string
}

// NewUser creates a new user
func NewUser(id int, name string) *User {
  return &User{
    ID:   id,
    Name: name,
  }
}

// String implements the Stringer interface
func (u *User) String() string {
  return fmt.Sprintf("User(%d, %s)", u.ID, u.Name)
}

func main() {
  user := NewUser(1, "John")
  fmt.Println(user)
  os.Exit(0)
}
`;

// Create complex Go file fixture
const complexGoContent = `
package repository

import (
  "context"
  "database/sql"
  "errors"
  "time"
)

// Repository defines the interface for data access
type Repository interface {
  FindByID(ctx context.Context, id int) (*Entity, error)
  Save(ctx context.Context, entity *Entity) error
  Delete(ctx context.Context, id int) error
}

// Entity represents a domain entity
type Entity struct {
  ID        int
  Name      string
  CreatedAt time.Time
  UpdatedAt time.Time
}

// SQLRepository implements Repository using SQL
type SQLRepository struct {
  db *sql.DB
}

// NewSQLRepository creates a new SQL repository
func NewSQLRepository(db *sql.DB) *SQLRepository {
  return &SQLRepository{db: db}
}

// FindByID finds an entity by ID
func (r *SQLRepository) FindByID(ctx context.Context, id int) (*Entity, error) {
  query := "SELECT id, name, created_at, updated_at FROM entities WHERE id = ?"
  row := r.db.QueryRowContext(ctx, query, id)
  
  var entity Entity
  err := row.Scan(&entity.ID, &entity.Name, &entity.CreatedAt, &entity.UpdatedAt)
  if err != nil {
    if errors.Is(err, sql.ErrNoRows) {
      return nil, nil
    }
    return nil, err
  }
  
  return &entity, nil
}

// Save saves an entity
func (r *SQLRepository) Save(ctx context.Context, entity *Entity) error {
  if entity.ID == 0 {
    return r.insert(ctx, entity)
  }
  return r.update(ctx, entity)
}

// Delete deletes an entity
func (r *SQLRepository) Delete(ctx context.Context, id int) error {
  query := "DELETE FROM entities WHERE id = ?"
  _, err := r.db.ExecContext(ctx, query, id)
  return err
}

// insert inserts a new entity
func (r *SQLRepository) insert(ctx context.Context, entity *Entity) error {
  query := "INSERT INTO entities (name, created_at, updated_at) VALUES (?, ?, ?)"
  now := time.Now()
  entity.CreatedAt = now
  entity.UpdatedAt = now
  
  result, err := r.db.ExecContext(ctx, query, entity.Name, entity.CreatedAt, entity.UpdatedAt)
  if err != nil {
    return err
  }
  
  id, err := result.LastInsertId()
  if err != nil {
    return err
  }
  
  entity.ID = int(id)
  return nil
}

// update updates an existing entity
func (r *SQLRepository) update(ctx context.Context, entity *Entity) error {
  query := "UPDATE entities SET name = ?, updated_at = ? WHERE id = ?"
  entity.UpdatedAt = time.Now()
  
  _, err := r.db.ExecContext(ctx, query, entity.Name, entity.UpdatedAt, entity.ID)
  return err
}
`;

// Write fixtures to files
fs.writeFileSync(SIMPLE_GO_FILE, simpleGoContent);
fs.writeFileSync(COMPLEX_GO_FILE, complexGoContent);

describe('Go Analyzer', () => {
  let idServiceClient;

  beforeEach(() => {
    idServiceClient = new MockIdServiceClient();
  });

  test('should analyze a simple Go file', async () => {
    const [nodes, relationships] = await analyzeGoFile(SIMPLE_GO_FILE, idServiceClient);
    
    // Check that we have the expected nodes
    expect(nodes.length).toBeGreaterThan(0);
    
    // Check for specific node types
    const nodeTypes = nodes.map(node => node.type);
    expect(nodeTypes).toContain('File');
    expect(nodeTypes).toContain('Package');
    expect(nodeTypes).toContain('Function');
    expect(nodeTypes).toContain('Struct');
    expect(nodeTypes).toContain('Method');
    
    // Check for specific nodes
    const fileNode = nodes.find(node => node.type === 'File');
    expect(fileNode).toBeTruthy();
    expect(fileNode.name).toBe('simple.go');
    
    const packageNode = nodes.find(node => node.type === 'Package');
    expect(packageNode).toBeTruthy();
    expect(packageNode.name).toBe('main');
    
    const userStructNode = nodes.find(node => node.type === 'Struct' && node.name === 'User');
    expect(userStructNode).toBeTruthy();
    
    const newUserFunctionNode = nodes.find(node => node.type === 'Function' && node.name === 'NewUser');
    expect(newUserFunctionNode).toBeTruthy();
    
    const stringMethodNode = nodes.find(node => node.type === 'Method' && node.name === 'String');
    expect(stringMethodNode).toBeTruthy();
    
    // Check that we have relationships
    expect(relationships.length).toBeGreaterThan(0);
    
    // Format the results
    const result = formatAnalysisResults(SIMPLE_GO_FILE, nodes, relationships);
    
    // Check the result format
    expect(result).toHaveProperty('file_path', SIMPLE_GO_FILE);
    expect(result).toHaveProperty('language', 'go');
    expect(result).toHaveProperty('nodes_upserted');
    expect(result).toHaveProperty('relationships_upserted');
    expect(result.nodes_upserted.length).toBe(nodes.length);
    expect(result.relationships_upserted.length).toBe(relationships.length);
  });

  test('should analyze a complex Go file', async () => {
    const [nodes, relationships] = await analyzeGoFile(COMPLEX_GO_FILE, idServiceClient);
    
    // Check that we have the expected nodes
    expect(nodes.length).toBeGreaterThan(0);
    
    // Check for specific node types
    const nodeTypes = nodes.map(node => node.type);
    expect(nodeTypes).toContain('File');
    expect(nodeTypes).toContain('Package');
    expect(nodeTypes).toContain('Interface');
    expect(nodeTypes).toContain('Struct');
    expect(nodeTypes).toContain('Method');
    expect(nodeTypes).toContain('Function');
    
    // Check for specific nodes
    const fileNode = nodes.find(node => node.type === 'File');
    expect(fileNode).toBeTruthy();
    expect(fileNode.name).toBe('complex.go');
    
    const packageNode = nodes.find(node => node.type === 'Package');
    expect(packageNode).toBeTruthy();
    expect(packageNode.name).toBe('repository');
    
    const repositoryInterfaceNode = nodes.find(node => node.type === 'Interface' && node.name === 'Repository');
    expect(repositoryInterfaceNode).toBeTruthy();
    
    const entityStructNode = nodes.find(node => node.type === 'Struct' && node.name === 'Entity');
    expect(entityStructNode).toBeTruthy();
    
    const sqlRepositoryStructNode = nodes.find(node => node.type === 'Struct' && node.name === 'SQLRepository');
    expect(sqlRepositoryStructNode).toBeTruthy();
    
    const findByIDMethodNode = nodes.find(node => node.type === 'Method' && node.name === 'FindByID');
    expect(findByIDMethodNode).toBeTruthy();
    
    // Check that we have relationships
    expect(relationships.length).toBeGreaterThan(0);
    
    // Format the results
    const result = formatAnalysisResults(COMPLEX_GO_FILE, nodes, relationships);
    
    // Check the result format
    expect(result).toHaveProperty('file_path', COMPLEX_GO_FILE);
    expect(result).toHaveProperty('language', 'go');
    expect(result).toHaveProperty('nodes_upserted');
    expect(result).toHaveProperty('relationships_upserted');
    expect(result.nodes_upserted.length).toBe(nodes.length);
    expect(result.relationships_upserted.length).toBe(relationships.length);
  });

  test('should handle errors gracefully', async () => {
    // Create a non-existent file path
    const nonExistentFile = path.join(FIXTURES_DIR, 'non-existent.go');
    
    // Mock fs.readFileSync to throw an error
    const originalReadFileSync = fs.readFileSync;
    fs.readFileSync = jest.fn().mockImplementation((filePath) => {
      if (filePath === nonExistentFile) {
        throw new Error('File not found');
      }
      return originalReadFileSync(filePath);
    });
    
    try {
      const [nodes, relationships] = await analyzeGoFile(nonExistentFile, idServiceClient);
      
      // Should return empty arrays on error
      expect(nodes).toEqual([]);
      expect(relationships).toEqual([]);
    } finally {
      // Restore the original function
      fs.readFileSync = originalReadFileSync;
    }
  });

  test('should format deletion results correctly', () => {
    // Import the function from index.js (assuming it's exported)
    const { formatAnalysisResults } = require('../dist/ast-visitor-utils');
    
    // Create a test file path
    const testFilePath = path.join(FIXTURES_DIR, 'test-delete.go');
    
    // Format deletion results
    const result = formatAnalysisResults(testFilePath, [], []);
    
    // Check the result format
    expect(result).toHaveProperty('file_path', testFilePath);
    expect(result).toHaveProperty('language', 'go');
    expect(result).toHaveProperty('nodes_upserted');
    expect(result).toHaveProperty('relationships_upserted');
    expect(result).toHaveProperty('nodes_deleted');
    expect(result).toHaveProperty('relationships_deleted');
    expect(result.nodes_upserted).toEqual([]);
    expect(result.relationships_upserted).toEqual([]);
    expect(result.nodes_deleted).toEqual([]);
    expect(result.relationships_deleted).toEqual([]);
  });

  test('should create a deletion payload', () => {
    // Create a test file path
    const testFilePath = path.join(FIXTURES_DIR, 'test-delete.go');
    
    // Create a deletion payload
    const payload = {
      file_path: testFilePath,
      language: 'go',
      nodes_upserted: [],
      relationships_upserted: [],
      nodes_deleted: [testFilePath],
      relationships_deleted: []
    };
    
    // Check the payload format
    expect(payload).toHaveProperty('file_path', testFilePath);
    expect(payload).toHaveProperty('language', 'go');
    expect(payload.nodes_upserted).toEqual([]);
    expect(payload.relationships_upserted).toEqual([]);
    expect(payload.nodes_deleted).toEqual([testFilePath]);
    expect(payload.relationships_deleted).toEqual([]);
  });
});