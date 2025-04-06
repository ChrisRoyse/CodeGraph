// packages/grammar-loader/src/index.ts
import module from 'module';
import path from 'path';

// Define a type for the Language enum values expected from the caller
// This should match the enum used in analyzer-core/src/types/index.js
// We avoid a direct dependency to keep this package simple.
type LanguageKey =
  | 'TypeScript'
  | 'JavaScript'
  | 'TSX'
  | 'Python'
  | 'SQL'
  | 'Go'
  | 'Java'
  | 'CSharp'
  | 'C'
  | 'CPP'
  | 'Unknown'; // Include Unknown for completeness

// Map LanguageKey to the corresponding tree-sitter package names
const LANGUAGE_PACKAGE_MAP: Partial<Record<LanguageKey, string | { pkg: string; grammar: string }>> = {
    Python: 'tree-sitter-python',
    JavaScript: 'tree-sitter-javascript',
    TypeScript: { pkg: 'tree-sitter-typescript', grammar: 'typescript' },
    TSX: { pkg: 'tree-sitter-typescript', grammar: 'tsx' },
    SQL: '@derekstride/tree-sitter-sql', // Updated package name
    Go: 'tree-sitter-go',
    Java: 'tree-sitter-java',
    CSharp: 'tree-sitter-c-sharp',
    C: 'tree-sitter-c',
    CPP: 'tree-sitter-cpp',
};

// Type for the loaded language grammar object
type LoadedLanguageGrammar = any;

// Cache for loaded grammars
const loadedGrammars: Map<LanguageKey, LoadedLanguageGrammar> = new Map();

// Create a require function specific to this module's context
// This is crucial for resolving packages relative to this CJS module
// No need for createRequire in a CJS module, 'require' is globally available
const requireFunc = require;

/**
 * Loads and returns the Tree-sitter grammar object for a given language key.
 * Uses CommonJS require internally.
 *
 * @param language The language key (string matching the enum keys used in analyzer-core).
 * @returns The loaded language grammar object.
 * @throws Error if the language is unsupported or the grammar package cannot be loaded.
 */
export function getGrammar(language: LanguageKey): LoadedLanguageGrammar {
    console.log(`[grammar-loader] Requesting grammar for: ${language}`); // Added log

    if (loadedGrammars.has(language)) {
        console.log(`[grammar-loader] Returning cached grammar for: ${language}`); // Added log
        return loadedGrammars.get(language)!;
    }

    if (language === 'Unknown') {
        console.warn(`[grammar-loader] Attempted to get grammar for Unknown language type.`);
        throw new Error(`Unsupported language: ${language}`);
    }

    const packageInfo = LANGUAGE_PACKAGE_MAP[language];
    if (!packageInfo) {
        console.error(`[grammar-loader] Internal error: No language package defined for known language: ${language}`);
        throw new Error(`Language package not configured for language: ${language}`);
    }

    const packageName = typeof packageInfo === 'string' ? packageInfo : packageInfo.pkg;
    const grammarName = typeof packageInfo === 'string' ? null : packageInfo.grammar;

    try {
        console.log(`[grammar-loader] Loading grammar for ${language} via package: ${packageName}${grammarName ? ` (grammar: ${grammarName})` : ''}`);

        const loadedPackage = requireFunc(packageName);
        let loadedGrammar: LoadedLanguageGrammar;

        // Standard handling: Use the specified grammar property if defined.
        if (grammarName) {
            loadedGrammar = loadedPackage[grammarName];
        } else {
            // Check if the default export looks like a grammar object (basic check)
            // A valid grammar object usually has properties like 'nodeTypeInfo', 'parse', etc.
            // This is a heuristic and might need refinement.
            if (typeof loadedPackage === 'object' && loadedPackage !== null && typeof loadedPackage.parse === 'function') {
                 loadedGrammar = loadedPackage;
                 console.log(`[grammar-loader] Using default export for ${language}.`);
            } else if (typeof loadedPackage === 'object' && loadedPackage !== null && typeof loadedPackage.language?.parse === 'function') {
                 // Fallback: Check if it's under a 'language' property
                 loadedGrammar = loadedPackage.language;
                 console.log(`[grammar-loader] Using 'language' property for ${language}.`);
            } else if (typeof loadedPackage === 'object' && loadedPackage !== null && typeof loadedPackage[language.toLowerCase()]?.parse === 'function') {
                 // Fallback: Check if it's under a property named after the language (e.g., 'sql')
                 loadedGrammar = loadedPackage[language.toLowerCase()];
                 console.log(`[grammar-loader] Using '${language.toLowerCase()}' property for ${language}.`);
            } else {
                // If none of the above worked, assume the default export was intended,
                // even if it doesn't look right. The error will occur later if it's truly invalid.
                loadedGrammar = loadedPackage;
                 console.warn(`[grammar-loader] Could not definitively identify grammar object for ${language} using common patterns. Assuming default export.`);
            }
        }

        if (!loadedGrammar) {
            throw new Error(`Grammar '${grammarName || 'default'}' not found or resolved to null/undefined in package '${packageName}'.`);
        }

        loadedGrammars.set(language, loadedGrammar);
        console.log(`[grammar-loader] Grammar for ${language} loaded and cached successfully.`);
        return loadedGrammar;
    } catch (error: any) {
        console.error(`[grammar-loader] Failed to load parser grammar for ${language} using package '${packageName}'${grammarName ? ` (grammar: ${grammarName})` : ''}:`, error);
        if (error.code === 'MODULE_NOT_FOUND') {
            console.error(`[grammar-loader] Tree-sitter language package '${packageName}' not found. Please install it in the 'grammar-loader' package.`);
            throw new Error(`Required tree-sitter language package '${packageName}' is not installed in @bmcp/grammar-loader.`);
        }
        throw new Error(`Failed to load parser grammar for ${language}.`);
    }
}

// Export other utilities if needed