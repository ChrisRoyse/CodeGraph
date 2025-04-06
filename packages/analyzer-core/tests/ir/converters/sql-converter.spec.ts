import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'; // Added vi, beforeEach, Mock
import { convertToIr } from '../../../src/ir/converters/sql-converter.js';
import {
  FileIr, // Updated
  IrElement, // Updated
  ElementType, // Updated
  PotentialRelationship, // Updated
  RelationshipType, // Updated
  Language,
  CanonicalId,
  // Import specific property interfaces
  DatabaseTableProperties,
  DatabaseColumnProperties,
  DatabaseQueryProperties,
} from '../../../src/ir/schema.js'; // Updated schema imports
import { generateCanonicalId, addIdToElement } from '../../../src/ir/ir-utils.js'; // Updated util imports
import { ParserFactory } from '../../../src/analyzer/parsers/parser-factory.js'; // Import for mocking
import { Query, SyntaxNode } from 'tree-sitter'; // Import Query for mocking

// Mock ParserFactory
vi.mock('../../../src/analyzer/parsers/parser-factory.js', () => ({
  ParserFactory: {
    // Mock the static parse method
    parse: vi.fn().mockResolvedValue(null), // Default mock returns null (simulating parse failure)
    // Mock other static methods/properties if needed by the converter
  },
}));

// Mock ir-utils (existing mock)
vi.mock('../../../src/ir/ir-utils.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../src/ir/ir-utils.js');
  const mockGenerateId = (element: Omit<IrElement, 'id'>, projectId: string): CanonicalId => {
      const type = element.type.toLowerCase();
      let path = `${element.filePath}:${element.name}`;
      if (element.type === 'DatabaseTable') {
          path = `${(element.properties as DatabaseTableProperties).schemaName ?? ''}.${element.name}`;
      } else if (element.type === 'DatabaseColumn') {
          // Needs parent table context - simplified for mock
          path = `unknown_table.${element.name}`;
      }
      path = path.replace(/\\/g, '/').replace(/[:*?<>"|]/g, '_');
      return `connectome://${projectId}/${type}:${path}`;
  };
  return {
    ...actual,
    generateCanonicalId: mockGenerateId,
    addIdToElement: <T extends Omit<IrElement, 'id'>>(element: T, projectId: string): T & { id: CanonicalId } => {
        const id = mockGenerateId(element, projectId);
        (element as unknown as IrElement).id = id;
        return element as T & { id: CanonicalId };
    }
  };
});

// Mock grammar-loader (needed by sql-converter)
// We need to mock getGrammar because the converter uses it to compile the Query
vi.mock('@bmcp/grammar-loader', () => ({
    getGrammar: vi.fn().mockImplementation((lang: string) => {
        // Return a dummy grammar object sufficient for Query compilation mock
        // The actual grammar isn't needed if we mock the query results or traversal
        if (lang === 'SQL') {
            return {
                // Mock methods needed by tree-sitter Query constructor if any
                // For now, an empty object might suffice if Query constructor is robust
                // or if we further mock the Query object itself.
            };
        }
        throw new Error(`Mock getGrammar called with unexpected language: ${lang}`);
    }),
}));

// Mock tree-sitter Query to prevent actual compilation errors with dummy grammar
// We will mock the `matches` method used in the converter
vi.mock('tree-sitter', async (importOriginal) => {
    const actual = await importOriginal() as typeof import('tree-sitter');
    // Keep SyntaxNode as a type if needed elsewhere, but mock Query class
    return {
        ...actual, // Keep other exports like SyntaxNode if needed as types
        Query: vi.fn().mockImplementation(() => ({
            // Mock the 'matches' method used in sql-converter.ts
            matches: vi.fn().mockReturnValue([]), // Default mock returns no matches
        })),
    };
});
// Helper function to find an element by name and type within a FileIr object
const findElement = (fileIr: FileIr, name: string, type: ElementType): IrElement | undefined => {
  return fileIr.elements.find(e => e.name === name && e.type === type);
};

// Helper function to find a potential relationship by type and target pattern
const findPotentialRelationship = (fileIr: FileIr, type: RelationshipType, targetPattern: string): PotentialRelationship | undefined => {
    return fileIr.potentialRelationships.find(r => r.type === type && r.targetPattern === targetPattern);
};

// Mock ir-utils (same as other specs)
vi.mock('../../../src/ir/ir-utils.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../src/ir/ir-utils.js');
  const mockGenerateId = (element: Omit<IrElement, 'id'>, projectId: string): CanonicalId => {
      const type = element.type.toLowerCase();
      let path = `${element.filePath}:${element.name}`;
      if (element.type === 'DatabaseTable') {
          path = `${(element.properties as DatabaseTableProperties).schemaName ?? ''}.${element.name}`;
      } else if (element.type === 'DatabaseColumn') {
          // Needs parent table context - simplified for mock
          path = `unknown_table.${element.name}`;
      }
      path = path.replace(/\\/g, '/').replace(/[:*?<>"|]/g, '_');
      return `connectome://${projectId}/${type}:${path}`;
  };
  return {
    ...actual,
    generateCanonicalId: mockGenerateId,
    addIdToElement: <T extends Omit<IrElement, 'id'>>(element: T, projectId: string): T & { id: CanonicalId } => {
        const id = mockGenerateId(element, projectId);
        (element as unknown as IrElement).id = id;
        return element as T & { id: CanonicalId };
    }
  };
});

describe('SQL IR Converter', () => {

  // Before each test, reset mocks and potentially set up specific mock returns
  beforeEach(() => {
    vi.clearAllMocks(); // Clear mocks before each test

    // Default mock for ParserFactory.parse - tests should override this
    // We need to cast the mock function properly
    const parseMock = ParserFactory.parse as Mock;
    parseMock.mockResolvedValue(null); // Default to parse failure

     // Default mock for Query.matches - tests should override this
     // Need to get the mocked class constructor to instantiate
    const MockedQuery = vi.mocked(Query);
    const queryInstance = new MockedQuery(vi.fn() as any, ''); // Provide dummy args
    const matchesMock = queryInstance.matches as Mock;
    matchesMock.mockReturnValue([]); // Default to no query matches
  });
  const filePath = 'test.sql';
  const language: Language = Language.SQL;
  const projectId = 'test-project-sql'; // Example project ID

  // Helper to create a minimal FileIr structure for expectations
  const createExpectedFileIr = (
      elements: IrElement[] = [],
      potentialRelationships: PotentialRelationship[] = []
  ): FileIr => ({
      schemaVersion: '1.0',
      projectId: projectId,
      fileId: `connectome://${projectId}/file:${filePath}`,
      filePath: filePath,
      language: language,
      elements: elements,
      potentialRelationships: potentialRelationships,
  });

   // Helper to create a partial element and add mock ID
   const createMockElement = (partialElement: Omit<IrElement, 'id' | 'filePath'>): IrElement => {
       const fullPartial = { ...partialElement, filePath: filePath };
       return addIdToElement(fullPartial, projectId);
   };

  it('should extract DatabaseTable and DatabaseColumn elements from CREATE TABLE statement', async () => { // Added async
    const code = 'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));';
    const tableName = 'users';

    // --- Mock SyntaxNode Structure ---
    // Note: This is a simplified mock focusing on properties accessed by the converter.
    // Helper to create minimal node mocks
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({
        type,
        text,
        children: children as SyntaxNode[], // Cast needed for mock structure
        namedChildren: namedChildren as SyntaxNode[], // Cast needed
        startPosition: start,
        endPosition: end,
        // Mock methods used by converter helpers
        descendantsOfType: (descType: string): SyntaxNode[] => {
            let found: SyntaxNode[] = [];
            if (type === descType) {
                found.push(createNode(type, text, children, start, end, namedChildren) as SyntaxNode); // Return self if type matches
            }
            children.forEach(child => {
                 // Ensure child has descendantsOfType before calling
                 if (typeof (child as any).descendantsOfType === 'function') {
                    found = found.concat((child as any).descendantsOfType(descType));
                 } else if (child.type === descType) {
                     // Basic fallback if child doesn't have the method mocked
                     found.push(child as SyntaxNode);
                 }
            });
            return found;
        },
        // Add other methods like childForFieldName if needed by helpers like getQualifiedName
        childForFieldName: (fieldName: string): SyntaxNode | null => null, // Default mock
        // Mock nextNamedSibling specifically for the TABLE keyword node
        nextNamedSibling: null,
    });


    const mockIdIdentifierNode = createNode('identifier', 'id', [], {row: 0, column: 21}, {row: 0, column: 23});
    const mockIdTypeNode = createNode('data_type', 'INT', [], {row: 0, column: 24}, {row: 0, column: 27});
    const mockIdConstraintNode = createNode('column_constraint', 'PRIMARY KEY', [], {row: 0, column: 28}, {row: 0, column: 39});
    const mockIdColumnDefNode = createNode('column_definition', 'id INT PRIMARY KEY', [mockIdIdentifierNode, mockIdTypeNode, mockIdConstraintNode], {row: 0, column: 21}, {row: 0, column: 39});

    const mockNameIdentifierNode = createNode('identifier', 'name', [], {row: 0, column: 41}, {row: 0, column: 45});
    const mockNameTypeNode = createNode('data_type', 'VARCHAR(100)', [], {row: 0, column: 46}, {row: 0, column: 58});
    const mockNameColumnDefNode = createNode('column_definition', 'name VARCHAR(100)', [mockNameIdentifierNode, mockNameTypeNode], {row: 0, column: 41}, {row: 0, column: 58});

    const mockTableIdentifierNode = createNode('identifier', tableName, [], {row: 0, column: 13}, {row: 0, column: 18});
    const mockTableKeywordNode: Partial<SyntaxNode> = { ...createNode('TABLE', 'TABLE', [], {row: 0, column: 7}, {row: 0, column: 12}), nextNamedSibling: mockTableIdentifierNode as SyntaxNode }; // Mock next sibling

    const mockCreateTableNode = createNode(
        'create_table_statement',
        code,
        [ // Simplified children list for structure
            createNode('CREATE', 'CREATE', [], {row: 0, column: 0}, {row: 0, column: 6}),
            mockTableKeywordNode,
            mockTableIdentifierNode,
            createNode('(', '(', [], {row: 0, column: 19}, {row: 0, column: 20}),
            mockIdColumnDefNode,
            createNode(',', ',', [], {row: 0, column: 39}, {row: 0, column: 40}),
            mockNameColumnDefNode,
            createNode(')', ')', [], {row: 0, column: 59}, {row: 0, column: 60}),
            createNode(';', ';', [], {row: 0, column: 60}, {row: 0, column: 61}),
        ],
        { row: 0, column: 0 },
        { row: 0, column: 61 }, // Adjusted end column
        [mockTableIdentifierNode] // Named children
    );

    const mockRootNode = createNode('source_file', code, [mockCreateTableNode], {row: 0, column: 0}, {row: 0, column: 61});
    // --- End Mock SyntaxNode Structure ---


    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode); // Cast to satisfy type
    // Query.matches mock uses default empty array from beforeEach

    // --- Expected IR (already defined in the test) ---
    // Expected Table Element
    const tableElement = createMockElement({
        type: 'DatabaseTable',
        name: tableName,
        // Adjust expected location based on mock node if necessary, or use expect.any(Object)
        location: expect.any(Object), // { start: { line: 1, column: 1 }, end: { line: 1, column: 62 } },
        properties: {
            language: Language.SQL,
            rawSignature: code,
        } as DatabaseTableProperties,
    });

    // Expected Column Elements
    const idColumnElement = createMockElement({
        type: 'DatabaseColumn',
        name: 'id',
        location: expect.any(Object), // { start: { line: 1, column: 22 }, end: { line: 1, column: 40 } },
        properties: {
            language: Language.SQL,
            dataType: 'INT',
            isPrimaryKey: true, // Expect this to be parsed now
            isForeignKey: false,
            constraints: ['PRIMARY KEY'], // Expect constraints
            rawSignature: 'id INT PRIMARY KEY',
        } as DatabaseColumnProperties,
    });
     const nameColumnElement = createMockElement({
        type: 'DatabaseColumn',
        name: 'name',
        location: expect.any(Object), // { start: { line: 1, column: 42 }, end: { line: 1, column: 59 } },
        properties: {
            language: Language.SQL,
            dataType: 'VARCHAR(100)',
             isPrimaryKey: false,
            isForeignKey: false,
            constraints: [],
            rawSignature: 'name VARCHAR(100)',
        } as DatabaseColumnProperties,
    });

    // Manually set parentId for expectation matching, as the mock doesn't handle the post-processing step perfectly
    (idColumnElement.properties as DatabaseColumnProperties).parentId = tableElement.id;
    (nameColumnElement.properties as DatabaseColumnProperties).parentId = tableElement.id;

    const expectedIr = createExpectedFileIr([tableElement, idColumnElement, nameColumnElement]);

    // --- Call and Assertions (already defined) ---
    const actualIr = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId

    // Find elements for comparison (order might vary)
    const actualTable = findElement(actualIr, tableName, 'DatabaseTable');
    const actualIdCol = findElement(actualIr, 'id', 'DatabaseColumn');
    const actualNameCol = findElement(actualIr, 'name', 'DatabaseColumn');

    expect(actualTable).toBeDefined();
    expect(actualIdCol).toBeDefined();
    expect(actualNameCol).toBeDefined();

    // Check counts first
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);

    // Check content - Use objectContaining for flexibility with IDs/locations
    expect(actualTable).toEqual(expect.objectContaining({
        name: tableElement.name,
        type: tableElement.type,
        properties: expect.objectContaining({ language: Language.SQL })
    }));
     expect(actualIdCol).toEqual(expect.objectContaining({
        name: idColumnElement.name,
        type: idColumnElement.type,
        properties: expect.objectContaining({
            language: Language.SQL,
            dataType: 'INT',
            isPrimaryKey: true,
            constraints: expect.arrayContaining(['PRIMARY KEY'])
        })
    }));
    expect(actualNameCol).toEqual(expect.objectContaining({
        name: nameColumnElement.name,
        type: nameColumnElement.type,
        properties: expect.objectContaining({
            language: Language.SQL,
            dataType: 'VARCHAR(100)',
            isPrimaryKey: false,
            constraints: []
        })
    }));


    // Check parentId relationship after converter runs its logic
    expect((actualIdCol?.properties as DatabaseColumnProperties)?.parentId).toBe(actualTable?.id);
    expect((actualNameCol?.properties as DatabaseColumnProperties)?.parentId).toBe(actualTable?.id);

  });

  it('should extract PotentialRelationship for SELECT statement', async () => { // Added async
    const code = 'SELECT id, name FROM users WHERE id = 1;';

    // --- Mock SyntaxNode Structure ---
    // Helper is defined in the previous test case
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({ /* ... see previous test ... */ type, text, children: children as SyntaxNode[], namedChildren: namedChildren as SyntaxNode[], startPosition: start, endPosition: end, descendantsOfType: vi.fn().mockReturnValue([]), childForFieldName: vi.fn().mockReturnValue(null), nextNamedSibling: null }); // Simplified mock node creator

    const mockSelectNode = createNode('select_statement', code, [], {row: 0, column: 0}, {row: 0, column: 39});
    const mockRootNode = createNode('source_file', code, [mockSelectNode], {row: 0, column: 0}, {row: 0, column: 39});
    // --- End Mock SyntaxNode Structure ---

    // --- Mock Query Matches ---
    // Simulate the Query finding the 'users' table
    const mockUsersTableNode = createNode('identifier', 'users', [], {row: 0, column: 20}, {row: 0, column: 25}); // Node for 'users'
    const mockQueryMatches = [
        {
            pattern: 0, // Index of the pattern in the query string that matched
            captures: [
                // Simulate the capture for '@table'
                { name: 'table', node: mockUsersTableNode as SyntaxNode },
                // Add '@qualified_name' capture if the converter uses it
                { name: 'qualified_name', node: mockUsersTableNode as SyntaxNode }, // Assuming simple identifier matches qualified_name capture
                 // Add '@table_ref_context' or similar context capture if needed
                { name: 'table_ref_context', node: mockUsersTableNode as SyntaxNode } // Example context capture
            ],
        },
    ];
    // --- End Mock Query Matches ---


    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode);
    // Configure the Query.matches mock for this specific test
    const MockedQuery = vi.mocked(Query);
    const queryInstance = new MockedQuery(vi.fn() as any, ''); // Re-instantiate for safety or rely on beforeEach reset
    (queryInstance.matches as Mock).mockReturnValue(mockQueryMatches);
    // --- End Configure Mocks ---


    // --- Expected IR ---
    const expectedRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, // File scope
        type: 'DatabaseQuery',
        targetPattern: 'users', // Target is the involved table(s)
        location: expect.any(Object), // { start: { line: 1, column: 1 }, end: { line: 1, column: 40 } }, // Approx location based on mock
        properties: {
            queryType: 'SELECT',
            rawSql: code, // Raw SQL text
            targetTables: ['users'],
            rawReference: expect.stringContaining('SELECT id, name FROM users'), // Check snippet
        } as DatabaseQueryProperties,
    };
    const expectedIr = createExpectedFileIr([], [expectedRelationship]);
    // --- End Expected IR ---

    // --- Call and Assertions ---
    const actualIr = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId
    const actualRel = findPotentialRelationship(actualIr, 'DatabaseQuery', 'users');

    expect(actualIr.elements.length).toBe(0);
    expect(actualRel).toBeDefined();
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
    // Use objectContaining for flexibility
    expect(actualRel).toEqual(expect.objectContaining({
        type: 'DatabaseQuery',
        targetPattern: 'users',
        properties: expect.objectContaining({
            queryType: 'SELECT',
            targetTables: ['users'],
            rawSql: code,
            rawReference: expect.any(String) // Check rawReference exists
        })
    }));
    // --- End Call and Assertions ---
  });

  it('should extract PotentialRelationship for INSERT statement', async () => { // Added async
    const code = "INSERT INTO users (name) VALUES ('Alice');";

    // --- Mock SyntaxNode Structure ---
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({ /* ... see previous test ... */ type, text, children: children as SyntaxNode[], namedChildren: namedChildren as SyntaxNode[], startPosition: start, endPosition: end, descendantsOfType: vi.fn().mockReturnValue([]), childForFieldName: vi.fn().mockReturnValue(null), nextNamedSibling: null }); // Simplified mock node creator

    const mockInsertNode = createNode('insert_statement', code, [], {row: 0, column: 0}, {row: 0, column: 39});
    const mockRootNode = createNode('source_file', code, [mockInsertNode], {row: 0, column: 0}, {row: 0, column: 39});
    // --- End Mock SyntaxNode Structure ---

    // --- Mock Query Matches ---
    // Simulate the Query finding the 'users' table in an INSERT context
    const mockUsersTableNode = createNode('identifier', 'users', [], {row: 0, column: 12}, {row: 0, column: 17}); // Node for 'users'
    const mockQueryMatches = [
        {
            pattern: 2, // Index of the INSERT pattern in the query string
            captures: [
                { name: 'table', node: mockUsersTableNode as SyntaxNode },
                { name: 'qualified_name', node: mockUsersTableNode as SyntaxNode }, // Assuming simple identifier matches
                { name: 'insert_context', node: mockInsertNode as SyntaxNode } // Context capture
            ],
        },
    ];
    // --- End Mock Query Matches ---


    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode);
    const MockedQuery = vi.mocked(Query);
    const queryInstance = new MockedQuery(vi.fn() as any, '');
    (queryInstance.matches as Mock).mockReturnValue(mockQueryMatches);
    // --- End Configure Mocks ---


    // --- Expected IR ---
     const expectedRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, // File scope
        type: 'DatabaseQuery',
        targetPattern: 'users',
        location: expect.any(Object), // { start: { line: 1, column: 1 }, end: { line: 1, column: 40 } }, // Approx location
        properties: {
            queryType: 'INSERT',
            rawSql: code,
            targetTables: ['users'],
            rawReference: expect.stringContaining('INSERT INTO users'),
        } as DatabaseQueryProperties,
    };
    const expectedIr = createExpectedFileIr([], [expectedRelationship]);
    // --- End Expected IR ---

    // --- Call and Assertions ---
    const actualIr = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId
    const actualRel = findPotentialRelationship(actualIr, 'DatabaseQuery', 'users');

    expect(actualIr.elements.length).toBe(0);
    expect(actualRel).toBeDefined();
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
    expect(actualRel).toEqual(expect.objectContaining({
        type: 'DatabaseQuery',
        targetPattern: 'users',
        properties: expect.objectContaining({
            queryType: 'INSERT',
            targetTables: ['users'],
            rawSql: code,
            rawReference: expect.any(String)
        })
    }));
    // --- End Call and Assertions ---
  it('should extract PotentialRelationship for UPDATE statement', async () => { // Added async
    const code = "UPDATE users SET name = 'Bob' WHERE id = 1;";

    // --- Mock SyntaxNode Structure ---
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({ /* ... see previous test ... */ type, text, children: children as SyntaxNode[], namedChildren: namedChildren as SyntaxNode[], startPosition: start, endPosition: end, descendantsOfType: vi.fn().mockReturnValue([]), childForFieldName: vi.fn().mockReturnValue(null), nextNamedSibling: null }); // Simplified mock node creator

    const mockUpdateNode = createNode('update_statement', code, [], {row: 0, column: 0}, {row: 0, column: 41});
    const mockRootNode = createNode('source_file', code, [mockUpdateNode], {row: 0, column: 0}, {row: 0, column: 41});
    // --- End Mock SyntaxNode Structure ---

    // --- Mock Query Matches ---
    // Simulate the Query finding the 'users' table in an UPDATE context
    const mockUsersTableNode = createNode('identifier', 'users', [], {row: 0, column: 7}, {row: 0, column: 12}); // Node for 'users'
    const mockQueryMatches = [
        {
            pattern: 1, // Index of the UPDATE pattern in the query string
            captures: [
                { name: 'table', node: mockUsersTableNode as SyntaxNode },
                { name: 'qualified_name', node: mockUsersTableNode as SyntaxNode }, // Assuming simple identifier matches
                { name: 'update_context', node: mockUpdateNode as SyntaxNode } // Context capture
            ],
        },
    ];
    // --- End Mock Query Matches ---


    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode);
    const MockedQuery = vi.mocked(Query);
    const queryInstance = new MockedQuery(vi.fn() as any, '');
    (queryInstance.matches as Mock).mockReturnValue(mockQueryMatches);
    // --- End Configure Mocks ---


    // --- Expected IR ---
     const expectedRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, // File scope
        type: 'DatabaseQuery',
        targetPattern: 'users',
        location: expect.any(Object), // { start: { line: 1, column: 1 }, end: { line: 1, column: 42 } }, // Approx location
        properties: {
            queryType: 'UPDATE',
            rawSql: code,
            targetTables: ['users'],
            rawReference: expect.stringContaining('UPDATE users SET'),
        } as DatabaseQueryProperties,
    };
    const expectedIr = createExpectedFileIr([], [expectedRelationship]);
    // --- End Expected IR ---

    // --- Call and Assertions ---
    const actualIr = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId
    const actualRel = findPotentialRelationship(actualIr, 'DatabaseQuery', 'users');

    expect(actualIr.elements.length).toBe(0);
    expect(actualRel).toBeDefined();
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
    expect(actualRel).toEqual(expect.objectContaining({
        type: 'DatabaseQuery',
        targetPattern: 'users',
        properties: expect.objectContaining({
            queryType: 'UPDATE',
            targetTables: ['users'],
            rawSql: code,
            rawReference: expect.any(String)
        })
    }));
    // --- End Call and Assertions ---
  });
  });

  it('should handle multiple statements separated by semicolons', async () => { // Added async
    const code = `
      CREATE TABLE products (sku VARCHAR(50) PRIMARY KEY, description TEXT);
      INSERT INTO products (sku, description) VALUES ('WDG001', 'A basic widget');
      SELECT sku FROM products WHERE description LIKE '%widget%';
    `;

    // --- Mock SyntaxNode Structure ---
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({ /* ... see previous test ... */ type, text, children: children as SyntaxNode[], namedChildren: namedChildren as SyntaxNode[], startPosition: start, endPosition: end, descendantsOfType: vi.fn().mockImplementation((descType: string) => { let found: SyntaxNode[] = []; if (type === descType) { found.push(createNode(type, text, children, start, end, namedChildren) as SyntaxNode); } children.forEach(child => { if (typeof (child as any).descendantsOfType === 'function') { found = found.concat((child as any).descendantsOfType(descType)); } else if (child.type === descType) { found.push(child as SyntaxNode); } }); return found; }), childForFieldName: vi.fn().mockReturnValue(null), nextNamedSibling: null }); // Updated mock creator with descendantsOfType logic

    // Mock CREATE TABLE statement node (simplified)
    const mockSkuIdentifier = createNode('identifier', 'sku', [], {row: 1, column: 26}, {row: 1, column: 29});
    const mockSkuType = createNode('data_type', 'VARCHAR(50)', [], {row: 1, column: 30}, {row: 1, column: 41});
    const mockSkuConstraint = createNode('column_constraint', 'PRIMARY KEY', [], {row: 1, column: 42}, {row: 1, column: 53});
    const mockSkuColDef = createNode('column_definition', 'sku VARCHAR(50) PRIMARY KEY', [mockSkuIdentifier, mockSkuType, mockSkuConstraint], {row: 1, column: 26}, {row: 1, column: 53});
    const mockDescIdentifier = createNode('identifier', 'description', [], {row: 1, column: 55}, {row: 1, column: 66});
    const mockDescType = createNode('data_type', 'TEXT', [], {row: 1, column: 67}, {row: 1, column: 71});
    const mockDescColDef = createNode('column_definition', 'description TEXT', [mockDescIdentifier, mockDescType], {row: 1, column: 55}, {row: 1, column: 71});
    const mockProductsTableIdentifier = createNode('identifier', 'products', [], {row: 1, column: 19}, {row: 1, column: 27});
    const mockTableKeyword: Partial<SyntaxNode> = { ...createNode('TABLE', 'TABLE', [], {row: 1, column: 13}, {row: 1, column: 18}), nextNamedSibling: mockProductsTableIdentifier as SyntaxNode };
    const mockCreateTableNode = createNode(
        'create_table_statement',
        'CREATE TABLE products (sku VARCHAR(50) PRIMARY KEY, description TEXT);',
        [mockTableKeyword, mockProductsTableIdentifier, mockSkuColDef, mockDescColDef], // Simplified children
        { row: 1, column: 6 }, { row: 1, column: 73 },
        [mockProductsTableIdentifier]
    );
     // Add descendantsOfType mock specifically for create_table_statement
    (mockCreateTableNode as any).descendantsOfType = function(this: Partial<SyntaxNode>, descType: string): SyntaxNode[] {
        if (descType === 'column_definition') return [mockSkuColDef as SyntaxNode, mockDescColDef as SyntaxNode];
        if (descType === 'table_constraint') return []; // No table constraints in this example
        if (descType === 'identifier' && this.type === 'create_table_statement') return [mockProductsTableIdentifier as SyntaxNode]; // Use 'this.type'
        return [];
    };


    // Mock INSERT statement node (simplified)
    const mockInsertNode = createNode(
        'insert_statement',
        "INSERT INTO products (sku, description) VALUES ('WDG001', 'A basic widget');",
        [], { row: 2, column: 6 }, { row: 2, column: 78 }
    );

    // Mock SELECT statement node (simplified)
    const mockSelectNode = createNode(
        'select_statement',
        "SELECT sku FROM products WHERE description LIKE '%widget%';",
        [], { row: 3, column: 6 }, { row: 3, column: 64 }
    );

    // Mock Root Node
    const mockRootNode = createNode('source_file', code, [mockCreateTableNode, mockInsertNode, mockSelectNode], {row: 0, column: 0}, {row: 4, column: 5});
    // --- End Mock SyntaxNode Structure ---


    // --- Mock Query Matches ---
    // Simulate finding 'products' table for both INSERT and SELECT contexts
    const mockProductsTableNodeInsert = createNode('identifier', 'products', [], {row: 2, column: 18}, {row: 2, column: 26});
    const mockProductsTableNodeSelect = createNode('identifier', 'products', [], {row: 3, column: 20}, {row: 3, column: 28});
    const mockQueryMatches = [
        // Match for INSERT
        {
            pattern: 2, // INSERT pattern index
            captures: [
                { name: 'table', node: mockProductsTableNodeInsert as SyntaxNode },
                { name: 'qualified_name', node: mockProductsTableNodeInsert as SyntaxNode },
                { name: 'insert_context', node: mockInsertNode as SyntaxNode }
            ],
        },
         // Match for SELECT (using table_reference pattern)
        {
            pattern: 0, // table_reference pattern index
            captures: [
                { name: 'table', node: mockProductsTableNodeSelect as SyntaxNode },
                { name: 'qualified_name', node: mockProductsTableNodeSelect as SyntaxNode },
                { name: 'table_ref_context', node: mockProductsTableNodeSelect as SyntaxNode } // Context is the reference itself
            ],
        },
    ];
    // --- End Mock Query Matches ---


    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode);
    const MockedQuery = vi.mocked(Query);
    const queryInstance = new MockedQuery(vi.fn() as any, '');
    // Configure matches mock to return all matches regardless of the node passed to it in the test
    (queryInstance.matches as Mock).mockReturnValue(mockQueryMatches);
    // --- End Configure Mocks ---


    // --- Expected IR (simplified checks) ---
    const tableElement = createMockElement({
        type: 'DatabaseTable', name: 'products',
        location: expect.any(Object), properties: { language: Language.SQL, rawSignature: expect.any(String) },
    });
    const skuColumnElement = createMockElement({
        type: 'DatabaseColumn', name: 'sku',
        location: expect.any(Object), properties: expect.objectContaining({ language: Language.SQL, dataType: 'VARCHAR(50)', parentId: tableElement.id, isPrimaryKey: true }),
    });
     const descColumnElement = createMockElement({
        type: 'DatabaseColumn', name: 'description',
        location: expect.any(Object), properties: expect.objectContaining({ language: Language.SQL, dataType: 'TEXT', parentId: tableElement.id, isPrimaryKey: false }),
    });
    const insertRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, type: 'DatabaseQuery', targetPattern: 'products',
        location: expect.any(Object), properties: expect.objectContaining({ queryType: 'INSERT', targetTables: ['products'] })
    };
    const selectRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, type: 'DatabaseQuery', targetPattern: 'products',
        location: expect.any(Object), properties: expect.objectContaining({ queryType: 'SELECT', targetTables: ['products'] })
    };
    // --- End Expected IR ---


    // --- Call and Assertions ---
    const actualIr = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId

    // Check counts
    expect(actualIr.elements.length).toBe(3); // products table, sku col, description col
    expect(actualIr.potentialRelationships.length).toBe(2); // INSERT, SELECT

    // Check specific elements/relationships exist (using helpers)
    const actualTable = findElement(actualIr, 'products', 'DatabaseTable');
    const actualSkuCol = findElement(actualIr, 'sku', 'DatabaseColumn');
    const actualDescCol = findElement(actualIr, 'description', 'DatabaseColumn');
    const actualInsertRel = actualIr.potentialRelationships.find(r => (r.properties as DatabaseQueryProperties)?.queryType === 'INSERT');
    const actualSelectRel = actualIr.potentialRelationships.find(r => (r.properties as DatabaseQueryProperties)?.queryType === 'SELECT');

    expect(actualTable).toBeDefined();
    expect(actualSkuCol).toBeDefined();
    expect(actualDescCol).toBeDefined();
    expect(actualInsertRel).toBeDefined();
    expect(actualSelectRel).toBeDefined();

    // Check parent IDs for columns
    expect((actualSkuCol?.properties as DatabaseColumnProperties)?.parentId).toBe(actualTable?.id);
    expect((actualDescCol?.properties as DatabaseColumnProperties)?.parentId).toBe(actualTable?.id);

    // Check relationship targets
    expect(actualInsertRel?.targetPattern).toBe('products');
    expect((actualInsertRel?.properties as DatabaseQueryProperties)?.targetTables).toEqual(['products']);
    expect(actualSelectRel?.targetPattern).toBe('products');
    expect((actualSelectRel?.properties as DatabaseQueryProperties)?.targetTables).toEqual(['products']);
    // --- End Call and Assertions ---
  });

   it('should return an empty FileIr object for empty input', async () => { // Added async
    const code = '';
    const result = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId
    expect(result.elements).toEqual([]);
    expect(result.potentialRelationships).toEqual([]);
    expect(result.filePath).toBe(filePath);
  });

  it('should return an empty FileIr object for non-SQL DDL/DML statements', async () => { // Added async
    const code = '/* This is just a comment */ -- Another comment';

    // --- Mock SyntaxNode Structure ---
    const createNode = (type: string, text: string, children: Partial<SyntaxNode>[] = [], start: {row: number, column: number}, end: {row: number, column: number}, namedChildren: Partial<SyntaxNode>[] = []): Partial<SyntaxNode> => ({ /* ... see previous test ... */ type, text, children: children as SyntaxNode[], namedChildren: namedChildren as SyntaxNode[], startPosition: start, endPosition: end, descendantsOfType: vi.fn().mockReturnValue([]), childForFieldName: vi.fn().mockReturnValue(null), nextNamedSibling: null }); // Simplified mock node creator

    // Simulate a root node with only comment nodes or an empty structure
    const mockComment1 = createNode('comment', '/* This is just a comment */', [], {row: 0, column: 0}, {row: 0, column: 28});
    const mockComment2 = createNode('comment', '-- Another comment', [], {row: 0, column: 29}, {row: 0, column: 47}); // Assuming line comment node type
    const mockRootNode = createNode('source_file', code, [mockComment1, mockComment2], {row: 0, column: 0}, {row: 0, column: 47});
    // --- End Mock SyntaxNode Structure ---

    // --- Configure Mocks ---
    (ParserFactory.parse as Mock).mockResolvedValue(mockRootNode as SyntaxNode);
    // Query.matches mock uses default empty array from beforeEach
    // --- End Configure Mocks ---

    // --- Call and Assertions ---
    const result = await convertToIr(code, filePath, 'test-project'); // Add dummy projectId
    expect(result.elements).toEqual([]);
    expect(result.potentialRelationships).toEqual([]);
    // --- End Call and Assertions ---
  });

});