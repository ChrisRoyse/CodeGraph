// packages/analyzer-core/tests/ir/converters/typescript-converter.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'; // Added beforeEach
import { convertToIr } from '../../../src/ir/converters/typescript-converter';
import { ParserFactory } from '../../../src/analyzer/parsers/parser-factory'; // Added
import type { Tree } from 'web-tree-sitter'; // Added for mock type safety
import {
  FileIr,
  IrElement,
  ElementType,
  PotentialRelationship,
  RelationshipType,
  Language,
  CanonicalId,
  FunctionProperties,
  ClassProperties,
  InterfaceProperties,
  VariableProperties,
  ImportsProperties, // Updated name
  ApiFetchProperties,
  CallsProperties, // Updated name
  MethodProperties, // Added
  ApiRouteDefinitionProperties,
  DatabaseTableProperties,
  DatabaseColumnProperties,
} from '../../../src/ir/schema.js';
import { generateCanonicalId, addIdToElement } from '../../../src/ir/ir-utils.js';

// Mock ParserFactory
vi.mock('../../../src/analyzer/parsers/parser-factory'); // Added
// Mock ir-utils remains the same
vi.mock('../../../src/ir/ir-utils.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../src/ir/ir-utils.js');
  const mockGenerateId = (element: Omit<IrElement, 'id'>, projectId: string): CanonicalId => {
      const type = element.type.toLowerCase();
      let path = `${element.filePath}:${element.name}`;
      if (element.type === 'ApiRouteDefinition') {
          path = `${(element.properties as ApiRouteDefinitionProperties).httpMethod}:${(element.properties as ApiRouteDefinitionProperties).pathPattern}`;
      } else if (element.type === 'DatabaseTable') {
          path = `${(element.properties as DatabaseTableProperties).schemaName ?? ''}.${element.name}`;
      } else if (element.type === 'DatabaseColumn') {
          path = `unknown_table.${element.name}`; // Simplified mock
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

const filePath = 'test.ts';
const language = Language.TypeScript; // Base language for most tests
const projectId = 'test-project';

const createExpectedFileIr = (
    elements: IrElement[] = [],
    potentialRelationships: PotentialRelationship[] = [],
    fileLang: Language = language // Allow overriding language for TSX
): FileIr => ({
    schemaVersion: '1.0',
    projectId: projectId,
    fileId: `connectome://${projectId}/file:${filePath}`,
    filePath: filePath,
    language: fileLang,
    elements: elements,
    potentialRelationships: potentialRelationships,
});

const createMockElement = (partialElement: Omit<IrElement, 'id' | 'filePath'>): IrElement => {
    const fullPartial = { ...partialElement, filePath: filePath };
    return addIdToElement(fullPartial, projectId);
};

describe('TypeScript/TSX IR Converter', () => {

  // Mock the parse result before each test
  beforeEach(() => {
    // Reset mocks if needed
    vi.clearAllMocks();

    // Mock ParserFactory.parse to return a generic placeholder Tree object.
    // This assumes convertToIr calls ParserFactory.parse internally.
    // The actual structure needed by the converter might require a more detailed mock.
    // For now, provide a minimal mock structure.
    const mockTree = {
        rootNode: {
            // Mock methods used by the converter, e.g., children, type, text, startPosition, endPosition
            // This will likely need adjustment based on the converter's implementation.
            children: [],
            type: 'program',
            text: 'mock code',
            startPosition: { row: 0, column: 0 },
            endPosition: { row: 0, column: 10 },
            walk: vi.fn(), // Mock walk if used
            descendantsOfType: vi.fn().mockReturnValue([]), // Mock descendantsOfType if used
        }
    } as unknown as Tree; // Use unknown assertion carefully

    vi.mocked(ParserFactory.parse).mockResolvedValue(mockTree);
  });

  it('should convert a simple function definition', async () => {
    const code = `function add(a: number, b: number): number { return a + b; }`;
    const expectedElement = createMockElement({
      type: 'Function',
      name: 'add',
      location: { start: { line: 1, column: 0 }, end: { line: 1, column: 60 } }, // Adjusted end column
      properties: {
        language: Language.TypeScript, // Added language
        signature: 'add(a: number, b: number): number', // Added signature
        parameters: [
            { name: 'a', type: 'number', position: 0 }, // Corrected type, position
            { name: 'b', type: 'number', position: 1 }  // Corrected type, position
        ],
        returnType: 'number', // Corrected type
        isAsync: false, // Added isAsync
        rawSignature: 'function add(a: number, b: number): number', // Moved rawSignature
      } as FunctionProperties,
    });
    const expectedIr = createExpectedFileIr([expectedElement]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript); // Verify it was called correctly
   // ---
    // Use toMatchObject for partial matching within properties if needed, but full check first
    expect(actualIr.elements).toEqual(expect.arrayContaining([expect.objectContaining(expectedElement)]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);
  });

  it('should convert a simple class definition with a method', async () => {
    const code = `class Calculator { add(a: number, b: number) { return a + b; } }`;
    const classElement = createMockElement({
      type: 'Class',
      name: 'Calculator',
      location: { start: { line: 1, column: 0 }, end: { line: 1, column: 64 } }, // Adjusted end column
      properties: {
          language: Language.TypeScript, // Added language
          rawSignature: 'class Calculator', // Moved rawSignature
      } as ClassProperties,
    });
    const methodElement = createMockElement({
        type: 'Method', // Updated type
        name: 'add',
        location: { start: { line: 1, column: 19 }, end: { line: 1, column: 62 } }, // Adjusted end column
        properties: {
            language: Language.TypeScript, // Added language
            signature: 'add(a: number, b: number)', // Added signature
            parameters: [
                { name: 'a', type: 'number', position: 0 }, // Corrected type
                { name: 'b', type: 'number', position: 1 }  // Corrected type
            ],
            parentId: classElement.id,
            isAsync: false, // Added
            rawSignature: 'add(a: number, b: number)', // Moved rawSignature
        } as MethodProperties, // Updated type
    });

    const expectedIr = createExpectedFileIr([classElement, methodElement]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([
        expect.objectContaining(classElement),
        expect.objectContaining(methodElement)
    ]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);
  });

   it('should convert a simple interface definition', async () => {
    const code = `interface Point { x: number; y: number; }`;
    const expectedElement = createMockElement({
      type: 'Interface',
      name: 'Point',
      location: { start: { line: 1, column: 0 }, end: { line: 1, column: 41 } }, // Adjusted end column
      properties: {
          language: Language.TypeScript, // Added language
          rawSignature: 'interface Point', // Moved rawSignature
      } as InterfaceProperties,
    });
    const expectedIr = createExpectedFileIr([expectedElement]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([expect.objectContaining(expectedElement)]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);
  });

  it('should convert a simple constant variable', async () => {
    const code = `const PI = 3.14;`;
    const expectedElement = createMockElement({
      type: 'Variable',
      name: 'PI',
      location: { start: { line: 1, column: 6 }, end: { line: 1, column: 15 } }, // Adjusted end column
      properties: {
        language: Language.TypeScript, // Added language
        isConstant: true,
        dataType: 'number', // Added dataType
        rawSignature: 'PI = 3.14', // Moved rawSignature
      } as VariableProperties,
    });
    const expectedIr = createExpectedFileIr([expectedElement]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([expect.objectContaining(expectedElement)]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);
  });

  it('should convert a named import into a PotentialRelationship', async () => {
    const code = `import { useState } from 'react';`;
    const expectedRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`,
        type: 'Imports', // Updated type
        targetPattern: 'react#useState', // Updated pattern
        location: { start: { line: 1, column: 9 }, end: { line: 1, column: 17 } }, // Location of 'useState'
        properties: {
            moduleSpecifier: 'react',
            importedEntityName: 'useState',
            isTypeImport: false, // Added isTypeImport
            rawReference: "import { useState } from 'react';", // Expect specific string WITH semicolon
        } as ImportsProperties, // Updated type
    };
    const expectedIr = createExpectedFileIr([], [expectedRelationship]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements.length).toBe(0);
    // Use toMatchObject for partial matching within properties
    expect(actualIr.potentialRelationships).toEqual(
        expect.arrayContaining([expect.objectContaining(expectedRelationship)])
    );
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
  });

   it('should convert a namespace import into a PotentialRelationship', async () => {
    const code = `import * as fs from 'fs';`;
    const expectedRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`,
        type: 'Imports', // Updated type
        targetPattern: 'fs', // Namespace imports target the module itself
        location: { start: { line: 1, column: 7 }, end: { line: 1, column: 14 } }, // Location of '* as fs'
        properties: {
            moduleSpecifier: 'fs',
            importedEntityName: '*', // Namespace import
            alias: 'fs', // Expect alias property
            isTypeImport: false, // Added isTypeImport
            rawReference: "import * as fs from 'fs'", // Expect specific string
        } as ImportsProperties, // Updated type
    };
     const expectedIr = createExpectedFileIr([], [expectedRelationship]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements.length).toBe(0);
    expect(actualIr.potentialRelationships).toEqual(
        expect.arrayContaining([expect.objectContaining(expectedRelationship)])
    );
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
  });

  it('should convert a simple JSX component (arrow function as Variable)', async () => {
    const code = `const MyComponent = () => <div>Hello</div>;`;
    // Expect both a Variable and a Function element
    const varElement = createMockElement({
      type: 'Variable',
      name: 'MyComponent',
      location: { start: { line: 1, column: 6 }, end: { line: 1, column: 42 } }, // Adjusted end
      properties: {
        language: Language.TSX, // Assuming TSX based on JSX content
        isConstant: true,
        dataType: 'function', // Inferred type
        rawSignature: 'MyComponent = () => <div>Hello</div>',
      } as VariableProperties,
    });
     const funcElement = createMockElement({
      type: 'Function', // The arrow function itself
      name: 'MyComponent', // Name inherited from variable
      location: { start: { line: 1, column: 20 }, end: { line: 1, column: 42 } }, // Location of arrow function
      properties: {
        language: Language.TSX,
        signature: 'MyComponent()', // Simple signature
        parameters: [],
        isAsync: false,
        rawSignature: '() => <div>Hello</div>',
      } as FunctionProperties,
    });
    const expectedIr = createExpectedFileIr([varElement, funcElement], [], Language.TSX); // Set file language

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   // The converter should detect JSX and request the TSX parser
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TSX);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([
        expect.objectContaining(varElement),
        expect.objectContaining(funcElement)
    ]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships.length).toBe(0);
  });

  it('should identify a fetch API call within a function as Element + Relationship', async () => {
    const code = `function fetchData() { fetch('/api/data'); }`;
    const funcElement = createMockElement({
      type: 'Function',
      name: 'fetchData',
      location: { start: { line: 1, column: 0 }, end: { line: 1, column: 44 } }, // Adjusted end
      properties: {
        language: Language.TypeScript,
        signature: 'fetchData()',
        parameters: [],
        isAsync: false,
        rawSignature: 'function fetchData()',
      } as FunctionProperties,
    });
    const expectedRelationship: PotentialRelationship = {
        sourceId: funcElement.id,
        type: 'ApiFetch',
        targetPattern: '/api/data',
        location: { start: { line: 1, column: 23 }, end: { line: 1, column: 41 } }, // Adjusted end column based on test output
        properties: {
            httpMethod: 'GET',
            urlPattern: '/api/data',
            framework: 'fetch',
            rawReference: `fetch('/api/data')`, // Moved rawReference
        } as ApiFetchProperties,
    };
    const expectedIr = createExpectedFileIr([funcElement], [expectedRelationship]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([expect.objectContaining(funcElement)]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships).toEqual(
        expect.arrayContaining([expect.objectContaining(expectedRelationship)])
    );
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
  });

   it('should identify an axios API call within a function as Element + Relationships', async () => {
    const code = `import axios from 'axios'; function getUsers() { axios.get('/users'); }`;
    const importRelationship: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`,
        type: 'Imports', // Updated type
        targetPattern: 'axios', // Default import targets module
        location: { start: { line: 1, column: 7 }, end: { line: 1, column: 12 } }, // Location of 'axios'
        properties: {
            moduleSpecifier: 'axios',
            importedEntityName: 'default',
            alias: 'axios', // Expect alias property
            isTypeImport: false,
            rawReference: "import axios from 'axios'", // Expect specific string
        } as ImportsProperties,
    };
    const funcElement = createMockElement({
      type: 'Function',
      name: 'getUsers',
      location: { start: { line: 1, column: 27 }, end: { line: 1, column: 71 } }, // Adjusted end
      properties: {
        language: Language.TypeScript,
        signature: 'getUsers()',
        parameters: [],
        isAsync: false,
        rawSignature: 'function getUsers()',
      } as FunctionProperties,
    });
    const callRelationship: PotentialRelationship = {
        sourceId: funcElement.id,
        type: 'ApiFetch', // Identified as API fetch
        targetPattern: '/users', // URL pattern is the target
        location: { start: { line: 1, column: 49 }, end: { line: 1, column: 68 } }, // Adjusted end column based on test output
        properties: {
            httpMethod: 'GET',
            urlPattern: '/users',
            framework: 'axios',
            rawReference: `axios.get('/users')`, // Moved rawReference
        } as ApiFetchProperties,
    };

    const expectedIr = createExpectedFileIr([funcElement], [importRelationship, callRelationship]);

   const actualIr = await convertToIr(code, filePath, projectId);

   // --- Add assertion for ParserFactory.parse call ---
   expect(ParserFactory.parse).toHaveBeenCalledWith(code, filePath, Language.TypeScript);
   // ---
    expect(actualIr.elements).toEqual(expect.arrayContaining([expect.objectContaining(funcElement)]));
    expect(actualIr.elements.length).toBe(expectedIr.elements.length);
    expect(actualIr.potentialRelationships).toEqual(
        expect.arrayContaining([
            expect.objectContaining(importRelationship),
            expect.objectContaining(callRelationship)
        ])
    );
    expect(actualIr.potentialRelationships.length).toBe(expectedIr.potentialRelationships.length);
  });

});