import { Project } from 'ts-morph';
import { analyze, AnalysisNode, AnalysisRelationship } from './analyzer';
import { sendAnalysisDataToApi } from './api_client'; // Import the function to mock

// Mock the entire api_client module
jest.mock('./api_client', () => ({
    sendAnalysisDataToApi: jest.fn().mockResolvedValue({ success: true }), // Mock implementation
}));

// Cast the mocked function to jest.Mock for type safety in assertions
const mockedSendAnalysisData = sendAnalysisDataToApi as jest.Mock;

describe('TypeScript Analyzer - Integration Tests', () => {
    let project: Project;
    const testFilePath = '/test/path/integration_sample.ts';
    const normalizedTestFilePath = '/test/path/integration_sample.ts'; // Based on previous findings

    beforeEach(() => {
        project = new Project({ useInMemoryFileSystem: true });
        // Reset the mock before each test
        mockedSendAnalysisData.mockClear();
    });

    it('should analyze code and call sendAnalysisDataToApi with the results', async () => {
        const code = `
function simpleAdd(a: number, b: number): number {
  return a + b;
}

const result = simpleAdd(1, 2);
console.log(result);
`;
        const sourceFile = project.createSourceFile(testFilePath, code);

        // 1. Perform analysis
        const analysisResult = await analyze(sourceFile, testFilePath);

        // Basic check on analysis result structure
        expect(analysisResult).toHaveProperty('nodes');
        expect(analysisResult).toHaveProperty('relationships');
        expect(Array.isArray(analysisResult.nodes)).toBe(true);
        expect(Array.isArray(analysisResult.relationships)).toBe(true);
        expect(analysisResult.nodes.length).toBeGreaterThan(0); // Expect at least a File node

        // Find the File node to ensure basic analysis worked
        const fileNode = analysisResult.nodes.find(n => n.labels.includes('File')); // Check labels array
        expect(fileNode).toBeDefined();
        expect(fileNode?.filePath).toBe(normalizedTestFilePath);

        // 2. Simulate sending data (using the actual function name which is now mocked)
        // Determine language based on file path (simple example)
        const language = testFilePath.endsWith('.tsx') ? 'tsx' : 'typescript';
        await sendAnalysisDataToApi(language, normalizedTestFilePath, analysisResult.nodes, analysisResult.relationships);

        // 3. Assert mock was called correctly
        expect(mockedSendAnalysisData).toHaveBeenCalledTimes(1);
        // Check if called with the correct arguments
        expect(mockedSendAnalysisData).toHaveBeenCalledWith(
            language, // Check language
            normalizedTestFilePath, // Check file path
            expect.arrayContaining([ // Check nodes array structure
                expect.objectContaining({
                    labels: ['File'], // Updated property
                    name: 'integration_sample.ts',
                    filePath: normalizedTestFilePath,
                    language: 'typescript', // Added property
                }),
                expect.objectContaining({
                    labels: ['Function'], // Updated property
                    name: 'simpleAdd',
                    language: 'typescript', // Added property
                }),
            ]),
            expect.any(Array) // Check relationships is an array
        );
    });

    // Add more integration tests if needed, e.g., error handling in the send process if relevant here
});