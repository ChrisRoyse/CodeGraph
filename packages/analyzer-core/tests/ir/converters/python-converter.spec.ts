import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertToIr } from '../../../src/ir/converters/python-converter';
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
  VariableProperties,
  ImportsProperties,
  CallsProperties,
} from '../../../src/ir/schema';
import { generateCanonicalId, addIdToElement } from '../../../src/ir/ir-utils';
import Parser from 'tree-sitter'; // Needed for Tree type hint
import { ParserFactory } from '../../../src/analyzer/parsers/parser-factory'; // Import ParserFactory

// Helper function to create a basic mock node
const createMockNode = (type: string, text: string, startLine: number, startCol: number, endLine: number, endCol: number, namedChildren: any[] = [], otherProps: Record<string, any> = {}) => ({
    type,
    text,
    startPosition: { row: startLine - 1, column: startCol },
    endPosition: { row: endLine - 1, column: endCol },
    namedChildren,
    // Add other commonly used properties/methods if needed by the converter
    childForFieldName: vi.fn((fieldName) => otherProps.fields?.[fieldName]), // Basic field access mock
    descendantsForFieldName: vi.fn(),
    // Basic walk mock - might need more sophisticated implementation if converter uses it heavily
    walk: vi.fn().mockImplementation(() => ({
        currentNode: vi.fn(),
        gotoFirstChild: vi.fn(),
        gotoNextSibling: vi.fn(),
        gotoParent: vi.fn(),
    })),
    ...otherProps, // Allow adding arbitrary properties for specific tests
});

// Mock ParserFactory
vi.mock('../../../src/analyzer/parsers/parser-factory', () => ({
    ParserFactory: {
        parse: vi.fn(), // We will mockResolvedValueOnce in each test
    },
}));

// Helper function to find an entity by name and type within a FileIr object
const findElement = (fileIr: FileIr, name: string, type: ElementType): IrElement | undefined => {
  return fileIr.elements.find(e => e.name === name && e.type === type);
};

// Helper function to find a potential relationship by type and target pattern
const findPotentialRelationship = (fileIr: FileIr, type: RelationshipType, targetPattern: string): PotentialRelationship | undefined => {
    return fileIr.potentialRelationships.find(r => r.type === type && r.targetPattern === targetPattern);
};

// Mock ir-utils to return predictable Canonical IDs and mock addIdToElement
// (Same mock as in typescript-converter.spec.ts)
vi.mock('../../../src/ir/ir-utils.js', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('../../../src/ir/ir-utils.js');
  const mockGenerateId = (element: Omit<IrElement, 'id'>, projectId: string): CanonicalId => {
      const type = element.type.toLowerCase();
      let path = `${element.filePath}:${element.name}`;
      // Add specific path logic if needed for Python elements in mock
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


describe('Python IR Converter', () => {
  const filePath = 'test.py';
  const language = Language.Python;
  const projectId = 'test-project-py'; // Example project ID

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

  // Reset mocks before each test if necessary
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the specific mock for ParserFactory.parse before each test
    vi.mocked(ParserFactory.parse).mockClear();
  });

  it('should extract a Function element from a simple function definition', async () => {
    const code = `def greet(name):\n  print(f"Hello, {name}")`;
    const expectedElement = createMockElement({
        type: 'Function',
        name: 'greet',
        location: { start: { line: 1, column: 0 }, end: { line: 2, column: 25 } }, // Approx location
        properties: {
            language: Language.Python,
            signature: '(name)', // Signature without function name
            parameters: [{ name: 'name', position: 0, type: undefined }], // Expect parameters array
            isAsync: false, // Expect isAsync property
            parentId: undefined, // Expect parentId (undefined for top-level)
            rawSignature: 'def greet(name)',
        } as FunctionProperties,
    });
    // Expect a 'Calls' relationship for the print function inside greet
    const expectedPrintCall: PotentialRelationship = {
        sourceId: expectedElement.id, // Source is the greet function
        type: 'Calls',
        targetPattern: 'print',
        location: expect.any(Object), // Location check can be loose
        properties: {
             rawReference: expect.stringContaining('print(')
        } as CallsProperties
    };
    const expectedIr = createExpectedFileIr([expectedElement], [expectedPrintCall]); // Add expected relationship

    // --- Mock ParserFactory.parse ---
    const mockFuncBodyNode = createMockNode('block', 'print(f"Hello, {name}")', 2, 2, 2, 25);
    const mockParametersNode = createMockNode('parameters', '(name)', 1, 10, 1, 16, [createMockNode('identifier', 'name', 1, 11, 1, 15)]);
    const mockFuncNameNode = createMockNode('identifier', 'greet', 1, 4, 1, 9);
    const mockFuncNode = createMockNode('function_definition', code, 1, 0, 2, 25, [mockFuncNameNode, mockParametersNode, mockFuncBodyNode], { fields: { name: mockFuncNameNode, parameters: mockParametersNode, body: mockFuncBodyNode } });
    const mockRootNode = createMockNode('module', code, 1, 0, 2, 25, [mockFuncNode]);
    const mockTree = { rootNode: mockRootNode };
    vi.mocked(ParserFactory.parse).mockResolvedValue(mockTree.rootNode as unknown as Parser.SyntaxNode); // Resolve with rootNode
    // --- End Mock ---

    const actualIr = await convertToIr(code, filePath, projectId);

    expect(actualIr.elements).toHaveLength(expectedIr.elements.length);
    expect(actualIr.elements[0]).toEqual(expect.objectContaining(expectedElement));
    expect(actualIr.elements[0]?.id).toEqual(expect.any(String));
    expect(actualIr.potentialRelationships).toHaveLength(1); // Expect 1 relationship
    expect(actualIr.potentialRelationships[0]).toEqual(expect.objectContaining({
        sourceId: expectedElement.id,
        type: 'Calls',
        targetPattern: 'print'
    }));
  });

  it('should extract Class and nested Function (Method) elements', async () => {
    const code = `class MyClass:\n  def __init__(self):\n    pass\n\n  def method(self):\n    pass`;
    const classElement = createMockElement({
        type: 'Class',
        name: 'MyClass',
        location: { start: { line: 1, column: 0 }, end: { line: 6, column: 8 } }, // Approx location
        properties: {
            language: Language.Python, // Added language
            rawSignature: 'class MyClass', // Moved inside properties
        } as ClassProperties,
    });
    const initElement = createMockElement({
        type: 'Function', // Methods are Functions
        name: '__init__',
        location: { start: { line: 2, column: 2 }, end: { line: 3, column: 8 } }, // Approx location
        properties: {
            language: Language.Python,
            signature: '()', // Signature excludes self
            parameters: [], // Expect empty parameters array (self excluded)
            isAsync: false, // Expect isAsync property
            parentId: classElement.id,
            rawSignature: 'def __init__(self)',
        } as FunctionProperties,
    });
    const methodElement = createMockElement({
        type: 'Function', // Methods are Functions
        name: 'method',
        location: { start: { line: 5, column: 2 }, end: { line: 6, column: 8 } }, // Approx location
        properties: {
            language: Language.Python,
            signature: '()', // Signature excludes self
            parameters: [], // Expect empty parameters array (self excluded)
            isAsync: false, // Expect isAsync property
            parentId: classElement.id,
            rawSignature: 'def method(self)',
        } as FunctionProperties,
    });
    const expectedIr = createExpectedFileIr([classElement, initElement, methodElement]);
    // --- Mock ParserFactory.parse ---
    const mockPassNode = createMockNode('pass_statement', 'pass', 3, 4, 3, 8);
    const mockInitBodyNode = createMockNode('block', 'pass', 3, 4, 3, 8, [mockPassNode]);
    const mockInitParamsNode = createMockNode('parameters', '(self)', 2, 15, 2, 21, [createMockNode('identifier', 'self', 2, 16, 2, 20)]);
    const mockInitNameNode = createMockNode('identifier', '__init__', 2, 6, 2, 14);
    const mockInitNode = createMockNode('function_definition', 'def __init__(self):\n    pass', 2, 2, 3, 8, [mockInitNameNode, mockInitParamsNode, mockInitBodyNode], { fields: { name: mockInitNameNode, parameters: mockInitParamsNode, body: mockInitBodyNode } });

    const mockMethodPassNode = createMockNode('pass_statement', 'pass', 6, 4, 6, 8);
    const mockMethodBodyNode = createMockNode('block', 'pass', 6, 4, 6, 8, [mockMethodPassNode]);
    const mockMethodParamsNode = createMockNode('parameters', '(self)', 5, 11, 5, 17, [createMockNode('identifier', 'self', 5, 12, 5, 16)]);
    const mockMethodNameNode = createMockNode('identifier', 'method', 5, 6, 5, 10);
    const mockMethodNode = createMockNode('function_definition', 'def method(self):\n    pass', 5, 2, 6, 8, [mockMethodNameNode, mockMethodParamsNode, mockMethodBodyNode], { fields: { name: mockMethodNameNode, parameters: mockMethodParamsNode, body: mockMethodBodyNode } });

    const mockClassBodyNode = createMockNode('block', '__init__(self):\n    pass\n\n  def method(self):\n    pass', 2, 2, 6, 8, [mockInitNode, mockMethodNode]);
    const mockClassNameNode = createMockNode('identifier', 'MyClass', 1, 6, 1, 13);
    const mockClassNode = createMockNode('class_definition', code, 1, 0, 6, 8, [mockClassNameNode, mockClassBodyNode], { fields: { name: mockClassNameNode, body: mockClassBodyNode } });

    const mockRootNode = createMockNode('module', code, 1, 0, 6, 8, [mockClassNode]);
    const mockTree = { rootNode: mockRootNode };
    vi.mocked(ParserFactory.parse).mockResolvedValue(mockTree.rootNode as unknown as Parser.SyntaxNode); // Resolve with rootNode
    // --- End Mock ---

    const actualIr = await convertToIr(code, filePath, projectId);

    // Find elements - order might not be guaranteed by converter implementation
    const actualClass = findElement(actualIr, 'MyClass', 'Class');
    const actualInit = findElement(actualIr, '__init__', 'Function');
    const actualMethod = findElement(actualIr, 'method', 'Function');

    expect(actualClass).toBeDefined();
    expect(actualInit).toBeDefined();
    expect(actualMethod).toBeDefined();
    expect(actualIr.elements.length).toBeGreaterThanOrEqual(3);

    expect(actualClass).toEqual(expect.objectContaining(classElement));
    expect(actualInit).toEqual(expect.objectContaining(initElement));
    expect(actualMethod).toEqual(expect.objectContaining(methodElement));

    // Check parent IDs explicitly
    expect((actualInit?.properties as FunctionProperties)?.parentId).toBe(actualClass?.id);
    expect((actualMethod?.properties as FunctionProperties)?.parentId).toBe(actualClass?.id);

    expect(actualIr.potentialRelationships).toHaveLength(0);
  });

   it('should extract a Variable element from a simple assignment', async () => {
    const code = `my_var = 10`;
    const expectedElement = createMockElement({
        type: 'Variable',
        name: 'my_var',
        location: { start: { line: 1, column: 0 }, end: { line: 1, column: 11 } }, // Approx location
        properties: {
            language: Language.Python, // Added language
            // scope: VariableScope.Global, // Scope check might be complex
            rawSignature: code, // Moved inside properties, Raw signature is the whole line for assignment
        } as VariableProperties,
    });
    const expectedIr = createExpectedFileIr([expectedElement]);

    // --- Mock ParserFactory.parse ---
    const mockVarNameNode = createMockNode('identifier', 'my_var', 1, 0, 1, 6);
    const mockValueNode = createMockNode('integer', '10', 1, 9, 1, 11);
    const mockAssignmentNode = createMockNode('assignment', code, 1, 0, 1, 11, [mockVarNameNode, mockValueNode], { fields: { left: mockVarNameNode, right: mockValueNode } });
    const mockExpressionStatementNode = createMockNode('expression_statement', code, 1, 0, 1, 11, [mockAssignmentNode]);
    const mockRootNode = createMockNode('module', code, 1, 0, 1, 11, [mockExpressionStatementNode]);
    const mockTree = { rootNode: mockRootNode };
    vi.mocked(ParserFactory.parse).mockResolvedValue(mockTree.rootNode as unknown as Parser.SyntaxNode); // Resolve with rootNode
    // --- End Mock ---

    const actualIr = await convertToIr(code, filePath, projectId);
    const actualVar = findElement(actualIr, 'my_var', 'Variable');

    expect(actualVar).toBeDefined();
    expect(actualIr.elements.length).toBeGreaterThanOrEqual(1);
    expect(actualVar).toEqual(expect.objectContaining(expectedElement));
    expect(actualVar?.id).toEqual(expect.any(String));
    expect(actualIr.potentialRelationships).toHaveLength(0);
  });

  it('should extract Import statements as PotentialRelationships', async () => {
    const code = `import os\nfrom time import sleep`;
    const expectedImportOs: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, // File scope
        type: 'Imports', // Corrected typo
        targetPattern: 'os',
        location: { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } }, // Approx location
        properties: {
            moduleSpecifier: 'os',
            rawReference: expect.any(String), // Added rawReference
        } as ImportsProperties, // Corrected typo, Simplified check
    };
     const expectedImportSleep: PotentialRelationship = {
        sourceId: `connectome://${projectId}/file:${filePath}`, // File scope
        type: 'Imports', // Corrected typo
        targetPattern: 'time',
        location: { start: { line: 2, column: 0 }, end: { line: 2, column: 22 } }, // Approx location
        properties: {
            moduleSpecifier: 'time',
            importedEntityName: 'sleep',
            rawReference: expect.any(String), // Added rawReference
        } as ImportsProperties, // Corrected typo, Simplified check
    };

    const expectedIr = createExpectedFileIr([], [expectedImportOs, expectedImportSleep]);
    // --- Mock ParserFactory.parse ---
    const mockImportOsNameNode = createMockNode('dotted_name', 'os', 1, 7, 1, 9, [createMockNode('identifier', 'os', 1, 7, 1, 9)]);
    const mockImportOsNode = createMockNode('import_statement', 'import os', 1, 0, 1, 8, [mockImportOsNameNode]);

    const mockSleepNameNode = createMockNode('identifier', 'sleep', 2, 18, 2, 22);
    const mockDottedSleepName = createMockNode('dotted_name', 'sleep', 2, 18, 2, 22, [mockSleepNameNode]); // Simplified, might be nested
    const mockFromTimeNameNode = createMockNode('dotted_name', 'time', 2, 5, 2, 9, [createMockNode('identifier', 'time', 2, 5, 2, 9)]);
    const mockImportFromNode = createMockNode('import_from_statement', 'from time import sleep', 2, 0, 2, 22, [mockFromTimeNameNode, mockDottedSleepName], { fields: { module_name: mockFromTimeNameNode, name: mockDottedSleepName } }); // Assuming 'name' field holds the imported entity

    const mockRootNode = createMockNode('module', code, 1, 0, 2, 22, [mockImportOsNode, mockImportFromNode]);
    const mockTree = { rootNode: mockRootNode };
    vi.mocked(ParserFactory.parse).mockResolvedValue(mockTree.rootNode as unknown as Parser.SyntaxNode); // Resolve with rootNode
    // --- End Mock ---

    const actualIr = await convertToIr(code, filePath, projectId);

    const actualOsRel = findPotentialRelationship(actualIr, 'Imports', 'os'); // Corrected typo
    const actualSleepRel = findPotentialRelationship(actualIr, 'Imports', 'time'); // Corrected typo

    expect(actualOsRel).toBeDefined();
    expect(actualSleepRel).toBeDefined();
    expect(actualIr.elements.length).toBe(0);
    expect(actualIr.potentialRelationships.length).toBeGreaterThanOrEqual(2);

    // Check relevant parts, location might be slightly off depending on parser details
    expect(actualOsRel).toEqual(expect.objectContaining({
        type: 'Imports', targetPattern: 'os', sourceId: expectedImportOs.sourceId // Corrected typo
    }));
    expect(actualSleepRel).toEqual(expect.objectContaining({
        type: 'Imports', targetPattern: 'time', sourceId: expectedImportSleep.sourceId // Corrected typo
    }));
    expect((actualSleepRel?.properties as ImportsProperties)?.importedEntityName).toEqual('sleep'); // Use toEqual for stricter check

  });

});