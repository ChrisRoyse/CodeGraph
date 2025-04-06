// packages/analyzer-core/tests/ir/ir-analyzer.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeIr, IrAnalysisResult } from '../../src/ir/ir-analyzer.js';
import { IrElement, PotentialRelationship, Language, ElementType, RelationshipType } from '../../src/ir/schema.js';

// Helper to create mock location
const mockLocation = (line: number = 1) => ({
  start: { line, column: 0 },
  end: { line, column: 10 },
});

describe('IR Analyzer', () => {
  let elements: IrElement[];
  let potentialRelationships: PotentialRelationship[];
  let analysisResult: IrAnalysisResult;

  beforeEach(() => {
    elements = [];
    potentialRelationships = [];
    analysisResult = { nodeQueries: [], relationshipQueries: [] };
  });

  // Helper function to run analysis
  const runAnalysis = () => {
    analysisResult = analyzeIr(elements, potentialRelationships);
  };

  it('should generate node queries for elements', () => {
    elements.push({
      id: 'connectome://proj/function:src/file.ts#funcA',
      filePath: 'src/file.ts',
      type: 'Function',
      name: 'funcA',
      location: mockLocation(1),
      properties: { language: Language.TypeScript, rawSignature: 'funcA()' },
    });
    runAnalysis();
    expect(analysisResult.nodeQueries.length).toBe(1);
    expect(analysisResult.nodeQueries[0]).toContain("MERGE (n:CodeElement:Function { id: 'connectome://proj/function:src/file.ts#funcA' })");
    expect(analysisResult.nodeQueries[0]).toContain('"name":"funcA"');
    expect(analysisResult.nodeQueries[0]).toContain('"filePath":"src/file.ts"');
  });

  it('should resolve same-file function calls', () => {
    const funcAId = 'connectome://proj/function:src/file.ts#funcA';
    const funcBId = 'connectome://proj/function:src/file.ts#funcB';
    elements.push(
      { id: funcAId, filePath: 'src/file.ts', type: 'Function', name: 'funcA', location: mockLocation(1), properties: { language: Language.TypeScript } },
      { id: funcBId, filePath: 'src/file.ts', type: 'Function', name: 'funcB', location: mockLocation(5), properties: { language: Language.TypeScript } }
    );
    potentialRelationships.push({
      sourceId: funcAId, // funcA calls funcB
      type: 'Calls',
      targetPattern: 'funcB',
      location: mockLocation(3),
      properties: { rawReference: 'funcB()' },
    });
    runAnalysis();
    expect(analysisResult.relationshipQueries.length).toBe(1);
    expect(analysisResult.relationshipQueries[0]).toContain(`MATCH (s { id: '${funcAId}' }), (t { id: '${funcBId}' }) MERGE (s)-[r:CALLS]->(t)`);
    expect(analysisResult.relationshipQueries[0]).toContain('"locationLine":3');
  });

   it('should resolve same-file variable reads', () => {
    const funcId = 'connectome://proj/function:src/file.ts#funcA';
    const varId = 'connectome://proj/variable:src/file.ts#myVar';
    elements.push(
      { id: funcId, filePath: 'src/file.ts', type: 'Function', name: 'funcA', location: mockLocation(1), properties: { language: Language.TypeScript } },
      { id: varId, filePath: 'src/file.ts', type: 'Variable', name: 'myVar', location: mockLocation(5), properties: { language: Language.TypeScript, dataType: 'string' } }
    );
    potentialRelationships.push({
      sourceId: funcId, // funcA reads myVar
      type: 'Reads',
      targetPattern: 'myVar',
      location: mockLocation(3),
      properties: { rawReference: 'myVar' },
    });
    runAnalysis();
    expect(analysisResult.relationshipQueries.length).toBe(1);
    expect(analysisResult.relationshipQueries[0]).toContain(`MATCH (s { id: '${funcId}' }), (t { id: '${varId}' }) MERGE (s)-[r:READS]->(t)`);
    expect(analysisResult.relationshipQueries[0]).toContain('"locationLine":3');
  });

  it('should resolve API fetch to route definition', () => {
    const funcId = 'connectome://proj/function:src/client.ts#fetchData';
    const routeId = 'connectome://proj/apiroutedefinition:src/server.ts#GET:/api/data';
    elements.push(
      { id: funcId, filePath: 'src/client.ts', type: 'Function', name: 'fetchData', location: mockLocation(1), properties: { language: Language.TypeScript } },
      { id: routeId, filePath: 'src/server.ts', type: 'ApiRouteDefinition', name: 'GET:/api/data', location: mockLocation(10), properties: { language: Language.TypeScript, httpMethod: 'GET', pathPattern: '/api/data' } }
    );
    potentialRelationships.push({
      sourceId: funcId,
      type: 'ApiFetch',
      targetPattern: '/api/data', // Matches route pathPattern
      location: mockLocation(5),
      properties: { httpMethod: 'GET', urlPattern: '/api/data', framework: 'fetch', rawReference: 'fetch("/api/data")' },
    });
    runAnalysis();
    // Expect 1 FETCHES relationship + 0 implicit HANDLED_BY (no handlerId provided)
    expect(analysisResult.relationshipQueries.length).toBe(1);
    expect(analysisResult.relationshipQueries[0]).toContain(`MATCH (s { id: '${funcId}' }), (t { id: '${routeId}' }) MERGE (s)-[r:FETCHES]->(t)`);
    expect(analysisResult.relationshipQueries[0]).toContain('"httpMethod":"GET"');
    expect(analysisResult.relationshipQueries[0]).toContain('"urlPattern":"/api/data"');
  });

  it('should create implicit HANDLED_BY relationship if handlerId exists', () => {
    const handlerId = 'connectome://proj/function:src/server.ts#getDataHandler';
    const routeId = 'connectome://proj/apiroutedefinition:src/server.ts#GET:/api/data';
    elements.push(
      { id: handlerId, filePath: 'src/server.ts', type: 'Function', name: 'getDataHandler', location: mockLocation(20), properties: { language: Language.TypeScript } },
      { id: routeId, filePath: 'src/server.ts', type: 'ApiRouteDefinition', name: 'GET:/api/data', location: mockLocation(10), properties: { language: Language.TypeScript, httpMethod: 'GET', pathPattern: '/api/data', handlerId: handlerId } }
    );
    // No potential relationships needed, testing implicit relationship generation
    runAnalysis();
    expect(analysisResult.relationshipQueries.length).toBe(1);
    expect(analysisResult.relationshipQueries[0]).toContain(`MATCH (s { id: '${routeId}' }), (t { id: '${handlerId}' }) MERGE (s)-[r:HANDLED_BY]->(t)`);
  });

  it('should resolve database query to table and column', () => {
    const funcId = 'connectome://proj/function:src/db_ops.py#queryUsers';
    const tableId = 'connectome://proj/databasetable:schema.sql#users';
    const columnId = 'connectome://proj/databasecolumn:schema.sql#users.id';
    elements.push(
      { id: funcId, filePath: 'src/db_ops.py', type: 'Function', name: 'queryUsers', location: mockLocation(1), properties: { language: Language.Python } },
      { id: tableId, filePath: 'schema.sql', type: 'DatabaseTable', name: 'users', location: mockLocation(1), properties: { language: Language.SQL } },
      { id: columnId, filePath: 'schema.sql', type: 'DatabaseColumn', name: 'id', location: mockLocation(2), properties: { language: Language.SQL, dataType: 'INT', parentId: tableId } }
    );
    potentialRelationships.push({
      sourceId: funcId,
      type: 'DatabaseQuery',
      targetPattern: 'users, users.id', // Pattern might vary based on converter
      location: mockLocation(5),
      properties: { queryType: 'SELECT', targetTables: ['users'], targetColumns: ['id'], rawReference: 'SELECT id FROM users' },
    });
    runAnalysis();
    // Expect 1 REFERENCES_TABLE and 1 REFERENCES_COLUMN + 1 implicit HAS_COLUMN
    expect(analysisResult.relationshipQueries.length).toBe(3);
    expect(analysisResult.relationshipQueries).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`MATCH (s { id: '${funcId}' }), (t { id: '${tableId}' }) MERGE (s)-[r:REFERENCES_TABLE]->(t)`),
        expect.stringContaining(`MATCH (s { id: '${funcId}' }), (t { id: '${columnId}' }) MERGE (s)-[r:REFERENCES_COLUMN]->(t)`),
        expect.stringContaining(`MATCH (s { id: '${tableId}' }), (t { id: '${columnId}' }) MERGE (s)-[r:HAS_COLUMN]->(t)`) // Implicit
      ])
    );
  });

   it('should create implicit HAS_COLUMN relationship', () => {
    const tableId = 'connectome://proj/databasetable:schema.sql#users';
    const columnId = 'connectome://proj/databasecolumn:schema.sql#users.id';
    elements.push(
      { id: tableId, filePath: 'schema.sql', type: 'DatabaseTable', name: 'users', location: mockLocation(1), properties: { language: Language.SQL } },
      { id: columnId, filePath: 'schema.sql', type: 'DatabaseColumn', name: 'id', location: mockLocation(2), properties: { language: Language.SQL, dataType: 'INT', parentId: tableId } }
    );
    runAnalysis();
    expect(analysisResult.relationshipQueries.length).toBe(1);
    expect(analysisResult.relationshipQueries[0]).toContain(`MATCH (s { id: '${tableId}' }), (t { id: '${columnId}' }) MERGE (s)-[r:HAS_COLUMN]->(t)`);
  });

  it('should log warning for unresolvable function call', () => {
     const funcId = 'connectome://proj/function:src/file.ts#funcA';
     elements.push(
       { id: funcId, filePath: 'src/file.ts', type: 'Function', name: 'funcA', location: mockLocation(1), properties: { language: Language.TypeScript } }
     );
     potentialRelationships.push({
       sourceId: funcId,
       type: 'Calls',
       targetPattern: 'nonExistentFunc',
       location: mockLocation(3),
       properties: { rawReference: 'nonExistentFunc()' },
     });
     // TODO: Mock or spy on logger.warn to verify the warning
     runAnalysis();
     expect(analysisResult.relationshipQueries.length).toBe(0); // No relationship created
   });

});