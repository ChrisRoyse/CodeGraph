// javascript_analyzer_service/processors.test.js
// Mock tree-sitter BEFORE requiring processors

// Define mocks first
const mockQueryMatches = jest.fn();
const MockQuery = jest.fn().mockImplementation(() => ({ // Mock Query *constructor*
    matches: mockQueryMatches,
}));
const MockParser = jest.fn().mockImplementation(() => ({ // Mock Parser *constructor*
    setLanguage: jest.fn(),
    parse: jest.fn().mockReturnValue({
        // Basic mock root node structure
        rootNode: {
            type: 'program', text: '',
            startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 },
            descendantsOfType: jest.fn().mockReturnValue([])
         }
    }),
}));
// Assign Query as a static property *on the mock constructor itself*
MockParser.Query = MockQuery;

// Mock the module, exporting the mock Parser constructor directly
jest.mock('tree-sitter', () => MockParser);


const Parser = require('tree-sitter'); // Now gets the mock Parser constructor
const JavaScript = require('tree-sitter-javascript'); // Keep requiring this, might be needed elsewhere? Or mock if causes issues.
const processors = require('./processors');
const helpers = require('./helpers');
const idGen = require('./id_generator');

// Mock dependencies
jest.mock('./helpers', () => ({
    getNodeText: jest.fn((node, code) => code.substring(node.startIndex, node.endIndex)),
    API_CALL_IDENTIFIERS: ['axios.post', 'fetch'] // Example API identifiers
}));

jest.mock('./id_generator', () => ({
    createCanonicalFunction: jest.fn((name, params, className) => `func:${className ? className + '.' : ''}${name}(#${params?.length ?? 0})`), // Match actual format
    createCanonicalClass: jest.fn((name) => `type:${name}`), // Match actual format
    createCanonicalImport: jest.fn((name, source) => `import:${name}@${source}`), // Match actual format
    // Match actual implementation logic: scopeIdentifier is null for file-level vars -> var:name
    createCanonicalVariable: jest.fn((name, scopeIdentifier) => scopeIdentifier ? `prop:${(scopeIdentifier.split(':').pop() || scopeIdentifier)}.${name}` : `var:${name}`),
    // Mock other idGen functions if needed
}));

// Helper to create a mock context for tests
const createMockContext = (filePath = 'test.js') => {
    const nodes = [];
    const relationships = [];
    const fileUniqueId = `file:${filePath}`; // Example file ID

    return {
        nodes,
        relationships,
        filePath,
        fileUniqueId,
        // Match signature from analyzer.js: createNode(type, name, node, canonicalId, extraLabels = [], properties = {})
        createNode: jest.fn((type, name, node, canonicalId, extraLabels = [], properties = {}) => {
            const uniqueId = `${canonicalId}@${node.startPosition.row + 1}`; // Simple unique ID for testing
            nodes.push({
                uniqueId,
                name,
                filePath,
                startLine: node.startPosition.row + 1,
                endLine: node.endPosition.row + 1,
                language: 'javascript',
                labels: [type, ...(extraLabels || [])], // Use extraLabels arg
                properties: { ...properties, canonicalIdentifier: canonicalId } // Use properties arg
            });
            return uniqueId; // Return the generated ID
        }),
        createRelationship: jest.fn((sourceId, targetIdentifier, type, node, properties = {}) => {
            relationships.push({
                sourceId,
                targetIdentifier, // This is the unresolved identifier
                type,
                properties: {
                    ...properties,
                    lineNumber: node.startPosition.row + 1,
                }
            });
        }),
        sourceCode: '', // Will be set per test case
    };
};

// Helper to create mock nodes (simplified)
const createMockNode = (type, text, startRow, startCol, endRow, endCol, children = [], namedChildren = [], childFieldNameMap = {}) => ({
    type,
    text,
    startPosition: { row: startRow, column: startCol },
    endPosition: { row: endRow, column: endCol },
    startIndex: -1, // Not strictly needed if getNodeText is mocked well
    endIndex: -1,   // Not strictly needed if getNodeText is mocked well
    children: children,
    namedChildren: namedChildren,
    childForFieldName: (name) => childFieldNameMap[name] || null,
    // Add other methods/properties if needed by processors
});

// parseCode is less relevant now as we mock query results, but keep a basic version
const parseCode = (code) => {
     // Return a basic mock root node structure
     return createMockNode('program', code, 0, 0, code.split('\n').length -1, 0);
};

describe('JavaScript Processors', () => {

    let mockContext;
    let scopeStack;

    beforeEach(() => {
        mockContext = createMockContext();
        scopeStack = [mockContext.fileUniqueId]; // Start with file scope
        // Reset mocks before each test
        jest.clearAllMocks();
        MockParser.mockClear(); // Clear the constructor mock
        MockQuery.mockClear(); // Clear the constructor mock
        mockQueryMatches.mockReset().mockReturnValue([]); // Reset matches mock and set default
        // Mock getNodeText to use node.text directly if available, otherwise fallback
        helpers.getNodeText.mockImplementation((node, code) => node?.text ?? code.substring(node.startIndex, node.endIndex));
    });

    // --- Test cases will go here ---

    describe('processFunctions', () => {
        test('should create a node for a simple function declaration', () => {
            const code = 'function simpleFunc() {}';
            mockContext.sourceCode = code;
            const rootNode = parseCode(code); // Still needed for context

            // --- Mock Query Results ---
            const funcNameNode = createMockNode('identifier', 'simpleFunc', 0, 9, 0, 19);
            const paramsNode = createMockNode('formal_parameters', '()', 0, 19, 0, 21);
            const bodyNode = createMockNode('statement_block', '{}', 0, 22, 0, 24);
            const funcDeclNode = createMockNode('function_declaration', code, 0, 0, 0, 24, [funcNameNode, paramsNode, bodyNode]); // Simplified children

            mockQueryMatches.mockReturnValueOnce([
                {
                    pattern: 0, // Index of the pattern in the query
                    captures: [
                        { name: 'function.name', node: funcNameNode },
                        { name: 'function.definition', node: funcDeclNode },
                        { name: 'function.parameters', node: paramsNode },
                        { name: 'function.body', node: bodyNode },
                    ],
                },
            ]);
            // --- End Mock ---

            processors.processFunctions(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String)); // Check mock constructor
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode); // Check matches was called

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Function',
                'simpleFunc',
                funcDeclNode, // Expect the specific mock node
                'func:simpleFunc(#0)', // Use actual canonical format
                [], // extraLabels
                { parameters: [], is_async: false } // properties
            );
            expect(mockContext.nodes).toHaveLength(1);
            expect(mockContext.nodes[0]).toMatchObject({
                name: 'simpleFunc',
                labels: expect.arrayContaining(['Function']),
                properties: expect.objectContaining({ canonicalIdentifier: 'func:simpleFunc(#0)' })
            });
        });

        test('should create a node for an anonymous function assigned to a variable', () => {
            const code = 'const myFunc = function() {};';
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

             // --- Mock Query Results ---
             const funcNameNode = createMockNode('identifier', 'myFunc', 0, 6, 0, 12);
             const funcNode = createMockNode('function', 'function() {}', 0, 15, 0, 28);
             const paramsNode = createMockNode('formal_parameters', '()', 0, 23, 0, 25); // Inside funcNode
             const bodyNode = createMockNode('statement_block', '{}', 0, 26, 0, 28); // Inside funcNode
             funcNode.namedChildren = [paramsNode, bodyNode]; // Mock children needed by processor

             const varDeclaratorNode = createMockNode('variable_declarator', 'myFunc = function() {}', 0, 6, 0, 28, [funcNameNode, funcNode]);
             varDeclaratorNode.childForFieldName = (name) => name === 'name' ? funcNameNode : (name === 'value' ? funcNode : null); // Mock field access

             mockQueryMatches.mockReturnValueOnce([
                 {
                     pattern: 1, // Assuming var decl pattern is second
                     captures: [
                         { name: 'function.name', node: funcNameNode },
                         { name: 'function.definition', node: varDeclaratorNode }, // Definition is the declarator here
                         { name: 'function.parameters', node: paramsNode }, // From nested function
                         { name: 'function.body', node: bodyNode }, // From nested function
                     ],
                 },
             ]);
             // --- End Mock ---

            processors.processFunctions(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Function',
                'myFunc', // Name comes from the variable declarator
                varDeclaratorNode, // Expect the declarator node
                'func:myFunc(#0)', // Use actual canonical format
                [], // extraLabels
                { parameters: [], is_async: false } // properties
            );
             expect(mockContext.nodes).toHaveLength(1);
        });

         test('should create a node for an arrow function assigned to a variable', () => {
            const code = 'const arrowFunc = (a, b) => a + b;';
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const funcNameNode = createMockNode('identifier', 'arrowFunc', 0, 6, 0, 15);
            const arrowFuncNode = createMockNode('arrow_function', '(a, b) => a + b', 0, 18, 0, 34);
            const paramsNode = createMockNode('formal_parameters', '(a, b)', 0, 18, 0, 24); // Inside arrowFuncNode
            const paramA = createMockNode('identifier', 'a', 0, 19, 0, 20);
            const paramB = createMockNode('identifier', 'b', 0, 22, 0, 23);
            paramsNode.namedChildren = [paramA, paramB]; // Mock params children

            const bodyNode = createMockNode('binary_expression', 'a + b', 0, 28, 0, 33); // Inside arrowFuncNode
            arrowFuncNode.namedChildren = [paramsNode, bodyNode]; // Mock children

            const varDeclaratorNode = createMockNode('variable_declarator', 'arrowFunc = (a, b) => a + b', 0, 6, 0, 34, [funcNameNode, arrowFuncNode]);
             varDeclaratorNode.childForFieldName = (name) => name === 'name' ? funcNameNode : (name === 'value' ? arrowFuncNode : null); // Mock field access

            mockQueryMatches.mockReturnValueOnce([
                {
                    pattern: 1, // Assuming var decl pattern is second
                    captures: [
                        { name: 'function.name', node: funcNameNode },
                        { name: 'function.definition', node: varDeclaratorNode },
                        { name: 'function.parameters', node: paramsNode },
                        { name: 'function.body', node: bodyNode }, // Body of arrow func
                    ],
                },
            ]);
             // --- End Mock ---

            processors.processFunctions(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Function',
                'arrowFunc',
                varDeclaratorNode, // Expect the declarator node
                'func:arrowFunc(#2)', // Use actual canonical format
                [], // extraLabels
                { parameters: ['a', 'b'], is_async: false } // properties
            );
             expect(mockContext.nodes).toHaveLength(1);
             expect(mockContext.nodes[0].properties.parameters).toEqual(['a', 'b']);
        });

        // Add more tests for async functions, generator functions, different parameter types etc.
        // SAPPO: Test cases for potential :ParsingError or unexpected AST structures.
    });

    describe('processClassesAndMethods', () => {
        test('should create nodes for class and its method', () => {
            const code = `
                class MyClass {
                    constructor(name) { this.name = name; }
                    greet() { console.log('Hello'); }
                    async fetchData() { return await fetch('/api'); }
                }
            `;
            mockContext.sourceCode = code;
            const rootNode = parseCode(code); // Still needed for context

            // --- Mock Query Results ---
            // Mock Class Query
            const classNameNode = createMockNode('identifier', 'MyClass', 1, 10, 1, 17);
            const classBodyNode = createMockNode('class_body', '{...}', 1, 18, 4, 17); // Simplified body text
            const classDeclNode = createMockNode('class_declaration', code.trim(), 1, 4, 4, 17);
            const classMatchesResult = [
                {
                    pattern: 0,
                    captures: [
                        { name: 'class.name', node: classNameNode },
                        { name: 'class.body', node: classBodyNode },
                        { name: 'class.definition', node: classDeclNode },
                    ],
                },
            ];


            // Mock Method Query (called inside processClassesAndMethods)
            const constructorNameNode = createMockNode('property_identifier', 'constructor', 2, 14, 2, 25);
            const constructorParamsNode = createMockNode('formal_parameters', '(name)', 2, 25, 2, 31);
            const constructorBodyNode = createMockNode('statement_block', '{ this.name = name; }', 2, 32, 2, 53);
            const constructorDefNode = createMockNode('method_definition', 'constructor(name) { this.name = name; }', 2, 14, 2, 53);
            constructorParamsNode.namedChildren = [createMockNode('identifier', 'name', 2, 26, 2, 30)]; // Mock param child

            const greetNameNode = createMockNode('property_identifier', 'greet', 3, 14, 3, 19);
            const greetParamsNode = createMockNode('formal_parameters', '()', 3, 19, 3, 21);
            const greetBodyNode = createMockNode('statement_block', "{ console.log('Hello'); }", 3, 22, 3, 48);
            const greetDefNode = createMockNode('method_definition', "greet() { console.log('Hello'); }", 3, 14, 3, 48);

            const fetchDataNameNode = createMockNode('property_identifier', 'fetchData', 4, 14, 4, 23);
            const fetchDataParamsNode = createMockNode('formal_parameters', '()', 4, 23, 4, 25);
            const fetchDataBodyNode = createMockNode('statement_block', "{ return await fetch('/api'); }", 4, 26, 4, 58);
            const fetchDataDefNode = createMockNode('method_definition', "async fetchData() { return await fetch('/api'); }", 4, 8, 4, 58); // Include async
            fetchDataDefNode.text = "async fetchData() { return await fetch('/api'); }"; // Ensure text includes async

             const methodMatchesResult = [
                 {
                     pattern: 0,
                     captures: [
                         { name: 'method.name', node: constructorNameNode },
                         { name: 'method.parameters', node: constructorParamsNode },
                         { name: 'method.body', node: constructorBodyNode },
                         { name: 'method.definition', node: constructorDefNode },
                     ],
                 },
                 {
                     pattern: 0,
                     captures: [
                         { name: 'method.name', node: greetNameNode },
                         { name: 'method.parameters', node: greetParamsNode },
                         { name: 'method.body', node: greetBodyNode },
                         { name: 'method.definition', node: greetDefNode },
                     ],
                 },
                 {
                     pattern: 0,
                     captures: [
                         { name: 'method.name', node: fetchDataNameNode },
                         { name: 'method.parameters', node: fetchDataParamsNode },
                         { name: 'method.body', node: fetchDataBodyNode },
                         { name: 'method.definition', node: fetchDataDefNode },
                     ],
                 },
            ];

            // Set up sequential mock returns for the two query calls
            mockQueryMatches
                .mockReturnValueOnce(classMatchesResult)  // First call (class query)
                .mockReturnValueOnce(methodMatchesResult); // Second call (method query)
            // --- End Mock ---


            processors.processClassesAndMethods(rootNode, code, mockContext, scopeStack);

            // Check queries were created and called
            expect(MockQuery).toHaveBeenCalledTimes(2); // Class query + Method query
            expect(mockQueryMatches).toHaveBeenCalledTimes(2);
            expect(mockQueryMatches).toHaveBeenNthCalledWith(1, rootNode); // Class query called on root
            expect(mockQueryMatches).toHaveBeenNthCalledWith(2, classBodyNode); // Method query called on class body


            expect(mockContext.createNode).toHaveBeenCalledTimes(4); // Class + 3 Methods

            // Check Class Node
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Class',
                'MyClass',
                classDeclNode, // Expect the specific mock node
                'type:MyClass', // Use actual canonical format
                [], // extraLabels
                {} // properties
            );

            // Check Constructor Method Node
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Method',
                'constructor',
                constructorDefNode, // Expect the specific mock node
                'func:MyClass.constructor(#1)', // Use actual canonical format
                [], // extraLabels
                expect.objectContaining({ parameters: ['name'], is_async: false, is_static: false, parent_class: 'MyClass' })
            );

            // Check Greet Method Node
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Method',
                'greet',
                greetDefNode, // Expect the specific mock node
                'func:MyClass.greet(#0)', // Use actual canonical format
                 [], // extraLabels
                expect.objectContaining({ parameters: [], is_async: false, is_static: false, parent_class: 'MyClass' })
            );

             // Check Async Method Node
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Method',
                'fetchData',
                fetchDataDefNode, // Expect the specific mock node
                'func:MyClass.fetchData(#0)', // Use actual canonical format
                 [], // extraLabels
                expect.objectContaining({ parameters: [], is_async: true, is_static: false, parent_class: 'MyClass' })
            );

            expect(mockContext.nodes).toHaveLength(4);
            expect(scopeStack).toEqual([mockContext.fileUniqueId]); // Ensure scope stack is balanced
        });
        // Add tests for static methods, anonymous classes etc.
    });

    describe('processImports', () => {
        test('should create node and relationship for default ES6 import', () => {
            const code = "import myDefault from './utils';";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const defaultImportNode = createMockNode('identifier', 'myDefault', 0, 7, 0, 16);
            const sourceNode = createMockNode('string', "'./utils'", 0, 22, 0, 31);
            const importStmtNode = createMockNode('import_statement', code, 0, 0, 0, 32);
            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'import.default', node: defaultImportNode },
                        { name: 'import.source', node: sourceNode },
                        { name: 'import.statement', node: importStmtNode },
                    ],
                },
            ]);
            // --- End Mock ---

            processors.processImports(rootNode, code, mockContext);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Import',
                'myDefault',
                importStmtNode, // Expect the specific mock node
                'import:myDefault@./utils', // Use actual canonical format
                ['Import'], // Check labels
                expect.objectContaining({ source: './utils', type: 'ESM', has_default_import: true, named_imports: [], has_namespace_import: false })
            );
            expect(mockContext.nodes).toHaveLength(1);

            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
            // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId, // Source ID
                './utils', // Target Identifier
                'IMPORTS', // Type
                importStmtNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });

         test('should create node and relationship for named ES6 imports', () => {
            const code = "import { funcA, funcB as aliasB } from 'lib';";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

             // --- Mock Query Results ---
             const nameNodeA = createMockNode('identifier', 'funcA', 0, 9, 0, 14);
             const nameNodeB = createMockNode('identifier', 'aliasB', 0, 24, 0, 30); // Alias node
             const importSpecA = createMockNode('import_specifier', 'funcA', 0, 9, 0, 14);
             importSpecA.namedChildren = [nameNodeA]; // Mock child
             const importSpecB = createMockNode('import_specifier', 'funcB as aliasB', 0, 16, 0, 30);
             importSpecB.namedChildren = [nameNodeB]; // Mock child (alias)

             const namedImportsNode = createMockNode('named_imports', '{ funcA, funcB as aliasB }', 0, 7, 0, 32);
             namedImportsNode.namedChildren = [importSpecA, importSpecB]; // Mock children

             const importClauseNode = createMockNode('import_clause', '{ funcA, funcB as aliasB }', 0, 7, 0, 32);
             importClauseNode.namedChildren = [namedImportsNode]; // Mock child

             const sourceNode = createMockNode('string', "'lib'", 0, 38, 0, 43);
             const importStmtNode = createMockNode('import_statement', code, 0, 0, 0, 44);

             mockQueryMatches.mockReturnValueOnce([ // Return an array
                 {
                     pattern: 0,
                     captures: [
                         // Note: The query captures 'import.name' for each specifier's final name
                         { name: 'import.name', node: nameNodeA },
                         { name: 'import.name', node: nameNodeB }, // Capture the alias 'aliasB'
                         { name: 'import.source', node: sourceNode },
                         { name: 'import.statement', node: importStmtNode },
                         // Need to simulate the structure for representativeName logic
                         // Might need to adjust mock context or processor logic if this is too complex
                     ],
                 },
             ]);
             // --- End Mock ---

            processors.processImports(rootNode, code, mockContext);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Import',
                '{funcA, aliasB}', // Corrected representative name
                importStmtNode, // Expect the specific mock node
                'import:{funcA, aliasB}@lib', // Use actual canonical format
                ['Import'],
                expect.objectContaining({ source: 'lib', type: 'ESM', named_imports: ['funcA', 'aliasB'], has_default_import: false, has_namespace_import: false }) // Corrected named_imports
            );
            expect(mockContext.nodes).toHaveLength(1);

            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
            // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId,
                'lib',
                'IMPORTS',
                importStmtNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });

         test('should create node and relationship for namespace ES6 import', () => {
            const code = "import * as Utils from './utils.js';";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const namespaceNode = createMockNode('identifier', 'Utils', 0, 10, 0, 15);
            const namespaceImportNode = createMockNode('namespace_import', '* as Utils', 0, 7, 0, 15);
            namespaceImportNode.namedChildren = [namespaceNode]; // Mock child

            const sourceNode = createMockNode('string', "'./utils.js'", 0, 21, 0, 33);
            const importStmtNode = createMockNode('import_statement', code, 0, 0, 0, 34);

            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'import.namespace', node: namespaceNode }, // Capture the namespace identifier
                        { name: 'import.source', node: sourceNode },
                        { name: 'import.statement', node: importStmtNode },
                    ],
                },
            ]);
             // --- End Mock ---

            processors.processImports(rootNode, code, mockContext);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Import',
                'Utils', // Representative name
                importStmtNode, // Expect the specific mock node
                'import:Utils@./utils.js', // Use actual canonical format
                ['Import'],
                expect.objectContaining({ source: './utils.js', type: 'ESM', has_namespace_import: true, named_imports: [], has_default_import: false })
            );
            expect(mockContext.nodes).toHaveLength(1);

            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
            // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId,
                './utils.js',
                'IMPORTS',
                importStmtNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });
    });

    describe('processRequires', () => {
        test('should create node and relationship for simple require call', () => {
            const code = "require('fs');"; // Call not assigned
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const requireNameNode = createMockNode('identifier', 'require', 0, 0, 0, 7);
            const sourceNode = createMockNode('string', "'fs'", 0, 8, 0, 12);
            const argsNode = createMockNode('arguments', "('fs')", 0, 7, 0, 13);
            argsNode.namedChildren = [sourceNode]; // Mock child
            const callExprNode = createMockNode('call_expression', code, 0, 0, 0, 14);
            callExprNode.namedChildren = [requireNameNode, argsNode]; // Mock children

            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'require.name', node: requireNameNode },
                        { name: 'require.source', node: sourceNode },
                        { name: 'require.call', node: callExprNode },
                    ],
                },
            ]);
            // --- End Mock ---

            processors.processRequires(rootNode, code, mockContext);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Import',
                'fs', // Representative name defaults to source path
                callExprNode, // Expect the call expression node
                'import:fs@fs', // Use actual canonical format
                ['Import'],
                expect.objectContaining({ source: 'fs', type: 'CommonJS' })
            );
            expect(mockContext.nodes).toHaveLength(1);

            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
             // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId,
                'fs',
                'IMPORTS',
                callExprNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });

        test('should create node and relationship for require assigned to variable', () => {
            const code = "const path = require('path');";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const requireNameNode = createMockNode('identifier', 'require', 0, 13, 0, 20);
            const sourceNode = createMockNode('string', "'path'", 0, 21, 0, 27);
            const argsNode = createMockNode('arguments', "('path')", 0, 20, 0, 28);
            argsNode.namedChildren = [sourceNode];
            const callExprNode = createMockNode('call_expression', "require('path')", 0, 13, 0, 28);
            callExprNode.namedChildren = [requireNameNode, argsNode];

            const varNameNode = createMockNode('identifier', 'path', 0, 6, 0, 10);
            const varDeclaratorNode = createMockNode('variable_declarator', "path = require('path')", 0, 6, 0, 28);
            varDeclaratorNode.namedChildren = [varNameNode, callExprNode];
            // Mock parent relationship for assignedVarName logic
            callExprNode.parent = varDeclaratorNode;
            varDeclaratorNode.childForFieldName = (name) => name === 'name' ? varNameNode : null;


            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'require.name', node: requireNameNode },
                        { name: 'require.source', node: sourceNode },
                        { name: 'require.call', node: callExprNode },
                    ],
                },
            ]);
             // --- End Mock ---

            processors.processRequires(rootNode, code, mockContext);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String));
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Import',
                'path', // Representative name is the variable name
                varDeclaratorNode, // Expect the declarator node
                'import:path@path', // Use actual canonical format
                ['Import'],
                expect.objectContaining({ source: 'path', type: 'CommonJS' })
            );
            expect(mockContext.nodes).toHaveLength(1);

            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
            // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId,
                'path',
                'IMPORTS',
                callExprNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });
    });

     describe('processVariables', () => {
        test('should create a node for a simple variable declaration', () => {
            const code = 'const count = 5;';
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const varNameNode = createMockNode('identifier', 'count', 0, 6, 0, 11);
            const valueNode = createMockNode('number', '5', 0, 14, 0, 15);
            const varDeclaratorNode = createMockNode('variable_declarator', 'count = 5', 0, 6, 0, 15);
            varDeclaratorNode.namedChildren = [varNameNode, valueNode];
            // Mock parent to determine 'kind'
            const constKeywordNode = createMockNode('const_keyword', 'const', 0, 0, 0, 5);
            const lexicalDeclNode = createMockNode('lexical_declaration', code, 0, 0, 0, 16);
            // Implement the child method correctly on the mock node
            lexicalDeclNode.child = jest.fn((index) => (index === 0 ? constKeywordNode : null)); // Use jest.fn()
            varDeclaratorNode.parent = lexicalDeclNode;


            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'variable.name', node: varNameNode },
                        { name: 'variable.value', node: valueNode },
                        { name: 'variable.declarator', node: varDeclaratorNode },
                    ],
                },
            ]);
            // --- End Mock ---

            processors.processVariables(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String)); // Check mock constructor
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);
            // Verify child(0) was called on the parent mock
            expect(lexicalDeclNode.child).toHaveBeenCalledWith(0);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'Variable',
                'count',
                varNameNode, // Expect the name node
                `var:count`, // Corrected expectation based on updated mock
                ['Declaration'],
                { kind: 'const' }
            );
            expect(mockContext.nodes).toHaveLength(1);
        });

         test('should NOT create a node for require assignment (handled by processRequires)', () => {
            const code = "const fs = require('fs');";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

             // --- Mock Query Results ---
             // Simulate the query finding the declarator, but the processor should ignore it
             const varNameNode = createMockNode('identifier', 'fs', 0, 6, 0, 8);
             const callExprNode = createMockNode('call_expression', "require('fs')", 0, 11, 0, 23);
             // Mock the call expression's function child for the check in processVariables
             callExprNode.childForFieldName = (name) => name === 'function' ? createMockNode('identifier', 'require', 0, 11, 0, 18) : null;

             const varDeclaratorNode = createMockNode('variable_declarator', "fs = require('fs')", 0, 6, 0, 23);
             varDeclaratorNode.namedChildren = [varNameNode, callExprNode];
             const lexicalDeclNode = createMockNode('lexical_declaration', code, 0, 0, 0, 24);
             // Implement the child method correctly on the mock node
             lexicalDeclNode.child = jest.fn((index) => (index === 0 ? createMockNode('const_keyword', 'const', 0, 0, 0, 5) : null));
             varDeclaratorNode.parent = lexicalDeclNode; // Mock parent

             mockQueryMatches.mockReturnValueOnce([ // Return an array
                 {
                     pattern: 0,
                     captures: [
                         { name: 'variable.name', node: varNameNode },
                         { name: 'variable.value', node: callExprNode },
                         { name: 'variable.declarator', node: varDeclaratorNode },
                     ],
                 },
             ]);
             // --- End Mock ---

            processors.processVariables(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String)); // Check mock constructor
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).not.toHaveBeenCalled();
            expect(mockContext.nodes).toHaveLength(0);
        });
         // Add tests for let, var, different scopes etc.
    });

    describe('processCalls', () => {
        test('should create call node and CALLS relationship from current scope', () => {
            const code = `
                function outer() {
                    inner(1);
                }
            `;
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock processFunctions Query (Setup needed *within* this test) ---
            const funcNameNode_outer = createMockNode('identifier', 'outer', 1, 18, 1, 23);
            const funcParamsNode_outer = createMockNode('formal_parameters', '()', 1, 23, 1, 25);
            const funcBodyNode_outer = createMockNode('statement_block', '{ inner(1); }', 1, 26, 3, 17);
            const funcDeclNode_outer = createMockNode('function_declaration', code.trim(), 1, 17, 3, 17);
            // Set the mock return value for the *first* call to query.matches in this test
            mockQueryMatches.mockReturnValueOnce([ { pattern: 0, captures: [
                { name: 'function.name', node: funcNameNode_outer },
                { name: 'function.definition', node: funcDeclNode_outer },
                { name: 'function.parameters', node: funcParamsNode_outer },
                { name: 'function.body', node: funcBodyNode_outer }, // Use the correct body node variable
            ]}]);
            // --- End Mock ---

            // Process function first to establish scope
            processors.processFunctions(rootNode, code, mockContext, scopeStack);
            const funcNode = mockContext.nodes[0];
            expect(funcNode).toBeDefined(); // Check if function node was created
            const funcScopeId = funcNode.uniqueId; // Get the ID created for the function

            // Process calls within the function's scope
            // Use the funcBodyNode from the mock above
            const funcBodyNode = funcBodyNode_outer;

            // --- Mock Query Results for processCalls ---
            const targetNode = createMockNode('identifier', 'inner', 2, 12, 2, 17);
            const argNode = createMockNode('number', '1', 2, 18, 2, 19);
            const argsNode = createMockNode('arguments', '(1)', 2, 17, 2, 20);
            argsNode.namedChildren = [argNode];
            const callExprNode = createMockNode('call_expression', 'inner(1)', 2, 12, 2, 20);
            callExprNode.namedChildren = [targetNode, argsNode];

            // Set the return value for the *second* query.matches call (within processCalls)
            // No need to reset here as beforeEach handles it.
            mockQueryMatches.mockReturnValueOnce([ // Return an array for the processCalls query
                {
                    pattern: 0,
                    captures: [
                        { name: 'call.target', node: targetNode },
                        { name: 'call.arguments', node: argsNode },
                        { name: 'call.expression', node: callExprNode },
                    ],
                },
            ]);
             // --- End Mock ---

            scopeStack.push(funcScopeId); // Enter function scope
            processors.processCalls(funcBodyNode, code, mockContext, scopeStack); // Call with the mock body node
            scopeStack.pop(); // Exit function scope

            // Check the processCalls query call specifically
            expect(MockQuery).toHaveBeenCalledTimes(2); // Once for processFunctions, once for processCalls
            expect(mockQueryMatches).toHaveBeenCalledTimes(2); // Once for processFunctions, once for processCalls
            expect(mockQueryMatches).toHaveBeenLastCalledWith(funcBodyNode); // Ensure it was called on the body node

            // Check Call Node creation
            expect(mockContext.createNode).toHaveBeenCalledTimes(2); // Function + Call
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenLastCalledWith(
                'Call',
                'inner',
                callExprNode, // Expect the specific mock node
                expect.stringMatching(/^inner@\d+$/), // Canonical ID for call
                ['Invocation'],
                expect.objectContaining({ target_string: 'inner', arguments_string: '(1)' })
            );
            expect(mockContext.nodes).toHaveLength(2); // Function + Call

            // Check CALLS Relationship creation
            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1); // Only the CALLS relationship
             // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                funcScopeId,
                'inner',
                'CALLS',
                callExprNode // Node object
            );
            expect(mockContext.relationships).toHaveLength(1);
        });

        test('should create ApiCall node for recognized API calls', () => {
            const code = "axios.post('/data', {});";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            const targetMemberNode = createMockNode('member_expression', 'axios.post', 0, 0, 0, 10); // Target is member expr
            const arg1Node = createMockNode('string', "'/data'", 0, 11, 0, 18);
            const arg2Node = createMockNode('object', '{}', 0, 20, 0, 22);
            const argsNode = createMockNode('arguments', "('/data', {})", 0, 10, 0, 23);
            argsNode.namedChildren = [arg1Node, arg2Node];
            const callExprNode = createMockNode('call_expression', code, 0, 0, 0, 24);
            callExprNode.namedChildren = [targetMemberNode, argsNode];

            mockQueryMatches.mockReturnValueOnce([ // Return an array
                {
                    pattern: 0,
                    captures: [
                        { name: 'call.target', node: targetMemberNode }, // Target is member expr
                        { name: 'call.arguments', node: argsNode },
                        { name: 'call.expression', node: callExprNode },
                    ],
                },
            ]);
            // --- End Mock ---

            processors.processCalls(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String)); // Check mock constructor
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).toHaveBeenCalledTimes(1);
            // Corrected expectation for createNode arguments
            expect(mockContext.createNode).toHaveBeenCalledWith(
                'ApiCall', // Node type should be ApiCall
                'axios.post',
                callExprNode, // Expect the specific mock node
                expect.stringMatching(/^axios\.post@\d+$/),
                ['Invocation'],
                expect.objectContaining({ target_string: 'axios.post', arguments_string: "('/data', {})" })
            );
            expect(mockContext.nodes).toHaveLength(1);
            expect(mockContext.nodes[0].labels).toContain('ApiCall');

            // Check CALLS relationship (still created from file scope)
            expect(mockContext.createRelationship).toHaveBeenCalledTimes(1);
            // Expect 4 arguments
            expect(mockContext.createRelationship).toHaveBeenCalledWith(
                mockContext.fileUniqueId,
                'axios.post',
                'CALLS',
                callExprNode // Node object
            );
             expect(mockContext.relationships).toHaveLength(1);
        });

         test('should NOT create call node or relationship for require calls', () => {
            const code = "require('os');";
            mockContext.sourceCode = code;
            const rootNode = parseCode(code);

            // --- Mock Query Results ---
            // Simulate the query finding the require call, but processor should ignore it
            const targetNode = createMockNode('identifier', 'require', 0, 0, 0, 7);
            const argNode = createMockNode('string', "'os'", 0, 8, 0, 12);
            const argsNode = createMockNode('arguments', "('os')", 0, 7, 0, 13);
            argsNode.namedChildren = [argNode];
            const callExprNode = createMockNode('call_expression', code, 0, 0, 0, 14);
            callExprNode.namedChildren = [targetNode, argsNode];

            mockQueryMatches.mockReturnValueOnce([ // Return an array
                 {
                     pattern: 0,
                     captures: [
                         { name: 'call.target', node: targetNode },
                         { name: 'call.arguments', node: argsNode },
                         { name: 'call.expression', node: callExprNode },
                     ],
                 },
            ]);
             // --- End Mock ---

            processors.processCalls(rootNode, code, mockContext, scopeStack);

            expect(MockQuery).toHaveBeenCalledWith(JavaScript, expect.any(String)); // Check mock constructor
            expect(mockQueryMatches).toHaveBeenCalledWith(rootNode);

            expect(mockContext.createNode).not.toHaveBeenCalled();
            expect(mockContext.createRelationship).not.toHaveBeenCalled();
        });
        // Add tests for calls on members (obj.method()), calls in global scope etc.
    });

});
