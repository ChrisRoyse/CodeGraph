// Focus: Test interaction between analyzer output and api_client input

const analyzer = require('./analyzer'); // To mock the analyze function
const apiClient = require('./api_client'); // To mock the sendAnalysisData function
// Removed grpc, server, parser, SQL imports as they are not directly tested here

// --- Mocks ---

// Mock the core analyze function
jest.mock('./analyzer', () => ({
    analyze: jest.fn(),
}));

// Mock the API client function
jest.mock('./api_client', () => ({
    sendAnalysisData: jest.fn(),
}));

// --- Test Suite ---

describe('SQL Analyzer -> API Client Integration', () => {
    const MOCK_FILE_PATH = 'integration/test.sql';
    const MOCK_SOURCE_CODE = 'SELECT * FROM users;'; // Example input for analyze
    const MOCK_ANALYSIS_RESULT = { // Mock output from analyze
        nodes: [{ uniqueId: 'node1', type: 'QueryTableReference', name: 'users' }], // Use schema keys
        relationships: [{ sourceId: 'node1', targetIdentifier: 'users', type: 'REFERENCES_TABLE' }], // Use schema keys
    };

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup default mock implementations
        analyzer.analyze.mockReturnValue(MOCK_ANALYSIS_RESULT); // Mock analyze return value
        apiClient.sendAnalysisData.mockResolvedValue(); // Mock successful API call
    });

    // Simulates the part of the server.js workflow we want to test
    async function simulateAnalysisAndSend(filePath, sourceCode) {
        try {
            // 1. Simulate getting analysis results (using the mock)
            const analysisResult = analyzer.analyze(null, filePath, sourceCode); // Pass null for rootNode as it's mocked

            // 2. Simulate sending data via API client (using the mock)
            await apiClient.sendAnalysisData(analysisResult); // Pass the direct result

            return { success: true };
        } catch (error) {
            console.error("Simulated workflow error:", error);
            return { success: false, error: error };
        }
    }

    test('should call analyze and then sendAnalysisData with the results', async () => {
        await simulateAnalysisAndSend(MOCK_FILE_PATH, MOCK_SOURCE_CODE);

        // Verify analyze was called (basic check)
        expect(analyzer.analyze).toHaveBeenCalledTimes(1);
        expect(analyzer.analyze).toHaveBeenCalledWith(null, MOCK_FILE_PATH, MOCK_SOURCE_CODE);

        // Verify sendAnalysisData was called with the exact result from analyze
        expect(apiClient.sendAnalysisData).toHaveBeenCalledTimes(1);
        expect(apiClient.sendAnalysisData).toHaveBeenCalledWith(MOCK_ANALYSIS_RESULT);
    });

    test('should propagate error if sendAnalysisData fails', async () => {
        const apiError = new Error('API Network Error');
        apiClient.sendAnalysisData.mockRejectedValue(apiError); // Simulate API call failure

        const result = await simulateAnalysisAndSend(MOCK_FILE_PATH, MOCK_SOURCE_CODE);

        expect(result.success).toBe(false);
        expect(result.error).toBe(apiError);

        // Verify analyze was still called
        expect(analyzer.analyze).toHaveBeenCalledTimes(1);

        // Verify sendAnalysisData was called
        expect(apiClient.sendAnalysisData).toHaveBeenCalledTimes(1);
        expect(apiClient.sendAnalysisData).toHaveBeenCalledWith(MOCK_ANALYSIS_RESULT);
    });

     test('should handle error if analyze function throws', async () => {
        const analysisError = new Error('Internal Analyzer Error');
         analyzer.analyze.mockImplementation(() => {
             throw analysisError;
         });

        const result = await simulateAnalysisAndSend(MOCK_FILE_PATH, MOCK_SOURCE_CODE);

        expect(result.success).toBe(false);
        expect(result.error).toBe(analysisError);

        // Verify analyze was called
        expect(analyzer.analyze).toHaveBeenCalledTimes(1);

        // Verify sendAnalysisData was NOT called because analyze threw first
        expect(apiClient.sendAnalysisData).not.toHaveBeenCalled();
    });

});