// packages/analyzer-core/src/analyzer/parsers/parser-factory.spec.ts
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { ParserFactory } from './parser-factory.js'; // Added .js
import { Language } from '../../types/index.js'; // Assuming types/index is ESM
import { ParserServiceClient } from './parser-service-client.js'; // Import the client to mock it
import type { SyntaxNode } from 'tree-sitter'; // Import type for mock return value

// Mock the ParserServiceClient
const mockRequestParsing = vi.fn();
vi.mock('./parser-service-client.js', () => { // Added .js
    return {
        ParserServiceClient: vi.fn().mockImplementation(() => {
            return {
                requestParsing: mockRequestParsing,
                // Mock other methods like destroy if needed by tests
                destroy: vi.fn(),
            };
        }),
    };
});

// Mock logger inside the factory function to avoid hoisting issues
vi.mock('../../utils/logger', () => {
    const mockLogger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    };
    return {
        createContextLogger: vi.fn().mockReturnValue(mockLogger),
        logger: mockLogger, // Provide the named export 'logger'
    };
});


describe('ParserFactory', () => {
    // Make beforeEach async to allow awaiting ParserFactory.reset()
    beforeEach(async () => {
        // Reset the factory before each test to ensure isolation
        // Reset mocks and the factory before each test
        vi.clearAllMocks();
        // ParserFactory.reset() might internally call client.destroy(), ensure it's mocked if needed
        await ParserFactory.reset(); // Reset is now async
    });

    it('should call ParserServiceClient.requestParsing with correct arguments and return its result', async () => {
        // Arrange
        const language = Language.TypeScript;
        const content = 'const x = 1;';
        const filePath = 'src/test.ts';
        // Create a mock SyntaxNode structure (adjust as needed based on actual AST structure)
        const mockAst: Partial<SyntaxNode> = {
            type: 'program',
            text: content,
            // Add other relevant properties if needed for downstream processing
            // Removed rootNode as it's not a direct property of SyntaxNode
        };
        mockRequestParsing.mockResolvedValue(mockAst); // Mock the client's response

        // Act
        const result = await ParserFactory.parse(language, content, filePath);

        // Assert
        // 1. Check if the mock client was instantiated (implicitly tested by mock setup)
        // 2. Check if requestParsing was called correctly
        expect(mockRequestParsing).toHaveBeenCalledTimes(1);
        expect(mockRequestParsing).toHaveBeenCalledWith({
            language: 'TypeScript', // Expect the mapped string key
            fileContent: content,
            filePath: filePath,
            outputFormat: 'ast',
        });

        // 3. Check if the result from parse matches the mocked AST
        expect(result).toEqual(mockAst);
    });

    it('should handle parsing errors from the service client', async () => {
        // Arrange
        const language = Language.Python;
        const content = 'invalid python code';
        const errorMessage = 'Failed to parse Python code';
        mockRequestParsing.mockRejectedValue(new Error(errorMessage)); // Mock an error response

        // Act & Assert
        // Expect parse to return null when the client throws an error
        await expect(ParserFactory.parse(language, content)).resolves.toBeNull();

        // Verify requestParsing was still called
        expect(mockRequestParsing).toHaveBeenCalledTimes(1);
        expect(mockRequestParsing).toHaveBeenCalledWith({
            language: 'Python',
            fileContent: content,
            filePath: undefined, // No file path provided in this call
            outputFormat: 'ast',
        });
    });

    it('should throw an error for Language.Unknown', async () => {
        // Arrange
        const unknownLanguage = Language.Unknown; // Use the defined Unknown enum
        const content = 'some code';

        // Act & Assert
        // mapLanguageEnumToKey should return null for Unknown, leading to parse throwing an error
        await expect(ParserFactory.parse(unknownLanguage, content))
            .rejects
            .rejects
            .toThrow(`Cannot parse content due to unmappable language enum value: ${unknownLanguage}`);

        // Ensure the service client was not called
        expect(mockRequestParsing).not.toHaveBeenCalled();
    });

});