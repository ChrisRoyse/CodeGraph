// No TreeSitter import needed here anymore, factory handles parser instance
import type { AstNode, RelationshipInfo } from './types.js'; // Add .js extension

/**
 * @interface LanguageParser
 * @description Defines the contract for language-specific parsers used within the analyzer.
 * Each language parser is responsible for loading its specific grammar and parsing
 * source code files into an Abstract Syntax Tree (AST) representation, along with
 * identifying relationships between code elements.
 */
export interface LanguageParser {
  // initialize method removed - The ParserFactory now handles loading and setting the language grammar.
  /**
   * @method parse
   * @description Parses the content of a source code file for a specific language.
   * It generates an AST and identifies relationships based on the language's syntax and semantics.
   * @param {string} filePath - The path to the file being parsed. Used for context and node identification.
   * @param {string} fileContent - The actual source code content of the file.
   * @returns {{ nodes: AstNode[], relationships: RelationshipInfo[] }} An object containing:
   *   - `nodes`: An array of `AstNode` objects representing the parsed code elements.
   *   - `relationships`: An array of `RelationshipInfo` objects describing the connections between nodes.
   * @throws {Error} If parsing fails due to syntax errors or other issues.
   */
  parse(filePath: string, fileContent: string): { nodes: AstNode[], relationships: RelationshipInfo[] };
}