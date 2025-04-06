import { describe, it, expect } from 'vitest';
import { generateCanonicalId, addIdToElement } from '../../src/ir/ir-utils'; // Updated imports
import {
  IrElement, // Updated
  ElementType, // Updated
  Language,
  CanonicalId,
  // Import specific property types
  FunctionProperties,
  ApiRouteDefinitionProperties,
  DatabaseTableProperties,
  DatabaseColumnProperties,
  VariableProperties, // Added for addIdToElement test
} from '../../src/ir/schema'; // Updated imports

describe('IR Utils', () => {
  const projectId = 'test-proj';
  const filePath = 'src/components/Button.tsx';
  const language = Language.TypeScript;

  describe('generateCanonicalId', () => {
    // Base mock element - Omit 'id' as the function generates it
    const baseMockElement: Omit<IrElement, 'id'> = {
      type: 'Function',
      name: 'Button',
      filePath: filePath,
      location: { start: { line: 10, column: 0 }, end: { line: 25, column: 1 } },
      properties: {} as FunctionProperties, // Add empty properties object
    };

    it('should generate a non-empty string ID', () => {
      const id = generateCanonicalId(baseMockElement, projectId);
      expect(id).toBeTypeOf('string');
      // Check format connectome://<project_id>/<entity_type>:<entity_path>
      expect(id).toMatch(/^connectome:\/\/test-proj\/function:src\/components\/Button.tsx:Button$/);
    });

    it('should generate consistent IDs for the same entity input', () => {
      const element1 = { ...baseMockElement }; // Use correct base and variable name
      const element2 = { ...baseMockElement }; // Use correct base and variable name
      const id1 = generateCanonicalId(element1, projectId); // Use correct variable name
      const id2 = generateCanonicalId(element2, projectId); // Use correct variable name
      expect(id1).toEqual(id2);
    });

    it('should generate different IDs for different file paths', () => {
      const element1 = { ...baseMockElement }; // Already correct
      const element2 = { ...baseMockElement, filePath: 'src/utils/helpers.ts' }; // Already correct
      const id1 = generateCanonicalId(element1, projectId); // Already correct
      const id2 = generateCanonicalId(element2, projectId); // Already correct
      expect(id1).not.toEqual(id2);
      expect(id2).toContain('src/utils/helpers.ts');
    });

    it('should generate different IDs for different entity names', () => {
      const element1 = { ...baseMockElement }; // Use correct base and variable name
      const element2 = { ...baseMockElement, name: 'Icon' }; // Use correct base and variable name
      const id1 = generateCanonicalId(element1, projectId); // Use correct variable name
      const id2 = generateCanonicalId(element2, projectId); // Use correct variable name
      expect(id1).not.toEqual(id2);
      expect(id2).toContain(':Icon');
    });

    it('should generate different IDs for different entity types', () => {
      const element1: Omit<IrElement, 'id'> = { ...baseMockElement }; // Type: Function

      const element2: Omit<IrElement, 'id'> = {
        type: 'ApiRouteDefinition',
        name: 'get_button_route', // Name is not part of path for API routes
        filePath: 'src/routes/button.ts', // File path not part of path for API routes
        location: { start: { line: 5, column: 0 }, end: { line: 15, column: 1 } },
        properties: {
          httpMethod: 'GET',
          pathPattern: '/api/button',
        } as ApiRouteDefinitionProperties,
      };

      const id1 = generateCanonicalId(element1, projectId);
      const id2 = generateCanonicalId(element2, projectId);
      expect(id1).not.toEqual(id2);
      expect(id1).toContain('/function:');
      expect(id2).toContain('/apiroutedefinition:GET:/api/button'); // Check specific path format
    });

    // Note: Signature and startLine are not part of Canonical ID generation per spec
    // Test cases for those variations are removed.

    it('should generate correct path for DatabaseTable', () => {
        const element: Omit<IrElement, 'id'> = {
            type: 'DatabaseTable',
            name: 'users',
            filePath: 'db/schema.sql',
            location: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
            properties: { schemaName: 'public' } as DatabaseTableProperties,
        };
        const id = generateCanonicalId(element, projectId);
        expect(id).toBe(`connectome://${projectId}/databasetable:public.users`);
    });

     it('should generate correct path for DatabaseColumn', () => {
        const tableId = `connectome://${projectId}/databasetable:public.users`;
        const element: Omit<IrElement, 'id'> = {
            type: 'DatabaseColumn',
            name: 'email',
            filePath: 'db/schema.sql',
            location: { start: { line: 3, column: 2 }, end: { line: 3, column: 20 } },
            properties: {
                dataType: 'VARCHAR(255)',
                parentId: tableId, // Provide parent table ID
            } as DatabaseColumnProperties,
        };
        const id = generateCanonicalId(element, projectId);
        expect(id).toBe(`connectome://${projectId}/databasecolumn:public.users.email`);
    });

    // TODO: Add tests for edge cases (missing properties, special characters in names/paths)
  });

  describe('addIdToElement', () => {
      it('should add a valid Canonical ID property to the element', () => {
          const partialElement: Omit<IrElement, 'id'> = {
            type: 'Variable',
            name: 'count',
            filePath: 'src/index.ts',
            location: { start: { line: 5, column: 4 }, end: { line: 5, column: 15 } },
            properties: { isConstant: false } as VariableProperties,
          };

          // Type assertion needed because the function modifies the object
          const elementWithId = addIdToElement(partialElement as any, projectId);

          expect(elementWithId).toHaveProperty('id');
          expect(elementWithId.id).toBeTypeOf('string');
          expect(elementWithId.id).toMatch(/^connectome:\/\/test-proj\/variable:src\/index.ts:count$/);
          // Verify original properties are preserved
          expect(elementWithId.name).toBe('count');
          expect(elementWithId.type).toBe('Variable');
      });
  });
});