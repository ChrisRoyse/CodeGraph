// Removed direct TreeSitterParser and grammar-loader imports
import { Language } from '../../types/index.js';
import { logger } from '../../utils/logger.js';
import { ParserServiceClient } from './parser-service-client.js'; // Import the new client
import type { SyntaxNode } from 'tree-sitter'; // Assuming the client returns a standard SyntaxNode

// Define LanguageKey type based on expected string values for the service
// This should align with the keys used in the parser-service
type LanguageKey =
    | 'TypeScript' | 'JavaScript' | 'TSX' | 'Python' | 'SQL'
    | 'Go' | 'Java' | 'CSharp' | 'C' | 'CPP' | 'Unknown';

// Helper function moved outside the class
// Keep the helper function, ensure LanguageKey type matches the new definition
function mapLanguageEnumToKey(langValue: Language): LanguageKey | null {
    // Find the key corresponding to the enum value
    const key = Object.keys(Language).find(k => Language[k as keyof typeof Language] === langValue);

    // Validate if the found key is one of the expected LanguageKey strings
    const validKeys: ReadonlyArray<string> = [
        'TypeScript', 'JavaScript', 'TSX', 'Python', 'SQL',
        'Go', 'Java', 'CSharp', 'C', 'CPP', 'Unknown'
    ];

    if (key && validKeys.includes(key)) {
        return key as LanguageKey;
    }

    logger.error(`Could not map Language enum value "${langValue}" to a valid LanguageKey.`);
    return null;
}

/**
  * Factory class for interacting with the Parser Service via IPC.
  * Provides a method to request parsing for source code.
  */
 export class ParserFactory {
     // Instantiate the ParserServiceClient
     // Consider making this configurable or injectable if needed
     private static parserServiceClient = new ParserServiceClient();
    /**
     * Requests parsing for the given source code content via the Parser Service.
     *
     * @param language The programming language of the content.
     * @param content The source code to parse.
     * @param filePath Optional: The path to the file being parsed (for context).
     * @returns A promise that resolves with the SyntaxNode (AST root) or null if parsing fails.
     * @throws Error if the language enum cannot be mapped or the service request fails unexpectedly.
     */
    public static async parse(
        language: Language,
        content: string,
        filePath?: string // Optional file path for context
    ): Promise<SyntaxNode | null> {
        const languageKey = mapLanguageEnumToKey(language);
        if (!languageKey) {
            // Error already logged by mapLanguageEnumToKey
            throw new Error(`Cannot parse content due to unmappable language enum value: ${language}`);
        }

        try {
            logger.debug(`Requesting parsing via IPC for language: ${languageKey}${filePath ? ` (file: ${filePath})` : ''}`);
            // Pass arguments as a single requestData object
            const requestData = {
                language: languageKey,
                fileContent: content,
                filePath: filePath, // Pass optional filePath
                outputFormat: 'ast' as const // Request the AST, use 'as const' for type safety
            };
            const ast = await ParserFactory.parserServiceClient.requestParsing(requestData);
            logger.debug(`Received parsing result via IPC for language: ${languageKey}${filePath ? ` (file: ${filePath})` : ''}`);
            // TODO: Validate the structure of 'ast' if it's not guaranteed to be SyntaxNode
            return ast as SyntaxNode | null; // Cast might be needed depending on client return type
        } catch (error: any) {
            logger.error(`Error requesting parsing via IPC for language ${languageKey}${filePath ? ` (file: ${filePath})` : ''}:`, error);
            // Depending on desired behavior, either return null or re-throw
            // Returning null indicates parsing failure to the caller
            return null;
            // OR: throw new Error(`Parser service request failed for ${languageKey}: ${error.message}`);
        }
    }

    /**
     * Resets the ParserFactory state. Currently, this involves ensuring the
     * ParserServiceClient is disconnected if it holds persistent connections.
     * Needs implementation if the client requires explicit cleanup.
     */
    public static async reset(): Promise<void> {
        // If ParserServiceClient needs explicit disconnection, add it here.
        // await ParserFactory.parserServiceClient.disconnect();
        // ParserFactory.parserServiceClient = new ParserServiceClient(); // Re-instantiate if needed
        logger.info('ParserFactory reset. (Note: Client disconnection logic might be needed)');
    }
}