// javascript_analyzer_service/analyzer.integration.test.js
const fs = require('fs/promises');
// Mock tree-sitter BEFORE requiring analyzer
const mockQueryMatches = jest.fn();
const MockQuery = jest.fn().mockImplementation(() => ({ // Mock Query *constructor*
    matches: mockQueryMatches,
}));
const MockParser = jest.fn().mockImplementation(() => ({ // Mock Parser *constructor*
    setLanguage: jest.fn(),
    parse: jest.fn((code) => ({ // Mock parse to return a basic root node
        rootNode: { type: 'program', text: code, startPosition: { row: 0, column: 0 }, endPosition: { row: code.split('\n').length - 1, column: 0 }, descendantsOfType: jest.fn().mockReturnValue([]) }
    })),
}));
// Assign Query as a static property *on the mock constructor itself*
MockParser.Query = MockQuery;

// Mock the module, exporting the mock Parser constructor directly
jest.mock('tree-sitter', () => MockParser);


const Parser = require('tree-sitter'); // Now gets the mock Parser constructor
const JavaScript = require('tree-sitter-javascript'); // Keep requiring this
const { analyze: analyzeJavaScript } = require('./analyzer'); // Import the 'analyze' function and alias it
const apiClient = require('./api_client');
const idGen = require('./id_generator'); // May need to mock parts of this if it affects output structure significantly

// Mock dependencies
jest.mock('fs/promises');
jest.mock('./api_client');
// Mock id_generator to produce predictable IDs for testing assertions
jest.mock('./id_generator', () => ({
    generateGlobalId: jest.fn((lang, filePath, canonicalId) => `${lang}:${filePath}:${canonicalId}`.substring(0, 50)), // Mock generateGlobalId instead of generateUniqueId
    createCanonicalFunction: jest.fn((name, params, className) => `func:${className ? className + '.' : ''}${name}(#${params?.length ?? 0})`), // Match actual implementation format
    createCanonicalClass: jest.fn((name) => `type:${name}`), // Match actual implementation format
    createCanonicalImport: jest.fn((name, source) => `import:${name}@${source}`), // Match actual implementation format
    createCanonicalVariable: jest.fn((name, scopeIdentifier) => scopeIdentifier ? `prop:${(scopeIdentifier.split(':').pop() || scopeIdentifier)}.${name}` : `var:${name}`), // Match actual implementation format
    // Add mocks for functions used in analyzer.js
    normalizePath: jest.fn((filePath) => filePath ? filePath.replace(/\\/g, '/').toLowerCase() : ''), // Handle undefined input
    createCanonicalFile: jest.fn((normalizedPath) => 'file'), // Mock based on implementation
}));


describe('JavaScript Analyzer Integration Tests', () => {

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();
        MockParser.mockClear(); // Clear constructor mock
        MockQuery.mockClear(); // Clear constructor mock
        mockQueryMatches.mockReset().mockReturnValue([]); // Reset matches mock and set default
        // Provide a default mock implementation for readFile
        fs.readFile.mockResolvedValue('');
        // Mock the API client function
        apiClient.sendAnalysisData.mockResolvedValue({ success: true }); // Default success mock
    });

    test('should analyze a simple file and return nodes/relationships structure', () => { // Updated test description
        const filePath = 'src/simple.js';
        const code = `
            import fs from 'fs';

            function greet(name) {
                const message = \`Hello, \${name}!\`;
                console.log(message);
                fs.writeFileSync('output.txt', message); // Example call
            }

            greet('World');
        `;

        // Mock fs.readFile for this specific test
        fs.readFile.mockResolvedValue(code);
        const parser = new Parser(); // Gets the mock parser
        parser.setLanguage(JavaScript); // Mocked method
        const tree = parser.parse(code); // Mocked method returns mock tree/rootNode
        const rootNode = tree.rootNode;

        // --- Mock Query Results for this specific test ---
        // Mock all processor queries to return empty arrays for now
        mockQueryMatches.mockReturnValue([]);
        // --- End Mock ---


        // Call analyze with all required arguments
        const result = analyzeJavaScript(rootNode, filePath, code); // analyze is synchronous

        // Verify the structure of the data returned by analyze
        expect(result).toBeDefined();
        expect(result).toHaveProperty('nodes');
        expect(result).toHaveProperty('relationships');

        // Check for the File node (created by analyze itself)
        const fileCanonicalId = 'file'; // From mock idGen
        const expectedFileGlobalId = idGen.generateGlobalId('javascript', filePath, fileCanonicalId);
        expect(result.nodes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    uniqueId: expectedFileGlobalId,
                    name: 'simple.js', // path.basename(filePath)
                    filePath: filePath,
                    labels: expect.arrayContaining(['File']),
                    // properties: expect.objectContaining({ canonicalIdentifier: fileCanonicalId }) // Properties not added in analyze's createNode
                })
            ])
        );

        // Since query matches are mocked as empty, expect no other nodes/relationships
        expect(result.nodes.length).toBe(1); // Only the file node
        expect(result.relationships.length).toBe(0); // No relationships generated from empty matches

    });

    // Test for error handling within analyze itself (e.g., parser error)
    test('should handle parser error gracefully', () => {
         const filePath = 'src/syntax_error.js';
         const code = 'function greet( {'; // Invalid syntax

         // Mock readFile
         fs.readFile.mockResolvedValue(code);

         // Mock the parser.parse to throw an error or return a tree with errors
         // Simulate error node with basic position properties
         const mockErrorRootNode = {
             type: 'program',
             hasError: () => true,
             toString: () => 'ERROR_NODE',
             startPosition: { row: 0, column: 0 }, // Add position properties
             endPosition: { row: 0, column: 0 }     // Add position properties
         };
         const mockParserInstance = {
             setLanguage: jest.fn(),
             parse: jest.fn().mockReturnValue({ rootNode: mockErrorRootNode })
         };
         MockParser.mockImplementation(() => mockParserInstance); // Make constructor return this instance

         const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

         const result = analyzeJavaScript(mockErrorRootNode, filePath, code);

         // Expect analyze to return only the File node on parser error
         const fileCanonicalId = 'file';
         const expectedFileGlobalId = idGen.generateGlobalId('javascript', filePath, fileCanonicalId);
         expect(result).toEqual({
             nodes: [
                 // Use objectContaining to be less brittle about exact properties
                 expect.objectContaining({
                     uniqueId: expectedFileGlobalId,
                     name: 'syntax_error.js', // path.basename(filePath)
                     filePath: filePath,
                     labels: expect.arrayContaining(['File'])
                 })
             ],
             relationships: []
         });
         // Optionally check for logging
         // expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error parsing'));

         consoleErrorSpy.mockRestore();
    });


    // Note: Testing the interaction with apiClient.sendAnalysisData should happen
    // in a test for the code that *calls* analyzeJavaScript and then calls sendAnalysisData,
    // likely in server.js or a main script.

    // Add more integration tests:
    // - Empty file
    // - File with complex constructs (classes, async/await, etc.) - requires mocking query results specifically
    // - Test interaction with id_generator more thoroughly if needed

});