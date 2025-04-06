// packages/analyzer-core/src/analyzer/parsers/typescript-parser.ts
import path from 'path';
import { Project, ScriptKind, SourceFile as TsMorphSourceFile } from 'ts-morph';
import ts from 'typescript';
import type { default as TreeSitterParser } from 'tree-sitter'; // Keep for constructor consistency if needed
import { Language } from '../../types/index.js';
import { AstNode, RelationshipInfo, LanguageParser, FileNode, ParserContext } from '../types.js';
import { parseFunctions } from './function-parser.js';
import { parseClasses } from './class-parser.js';
import { parseVariables } from './variable-parser.js';
import { parseInterfaces } from './interface-parser.js';
import { parseTypeAliases } from './type-alias-parser.js';
import { parseJsx } from './jsx-parser.js';
import { parseImports } from './import-parser.js';
import { createContextLogger } from '../../utils/logger.js';
import { ParserError } from '../../utils/errors.js';
import { generateEntityId, generateInstanceId, generateRelationshipId } from '../parser-utils.js';

const logger = createContextLogger('TypeScriptParser');

export class TypeScriptParser implements LanguageParser {
    private tsProject: Project;
    // private sharedParser: TreeSitterParser; // Store if needed, though ts-morph handles parsing

    constructor(sharedParser: TreeSitterParser) { // Accept shared parser for consistency, even if unused
        // this.sharedParser = sharedParser;
        // Initialize ts-morph project. Consider sharing this project instance
        // across multiple calls if performance becomes an issue.
        this.tsProject = new Project({
            // Optionally load tsconfig for better type resolution, but might slow down
            // tsConfigFilePath: 'tsconfig.json',
            // Add default compiler options if not loading tsconfig
             compilerOptions: {
                 allowJs: true, // Allow JavaScript files
                 checkJs: false, // Don't type-check JS files strictly
                 jsx: ts.JsxEmit.React, // Assume React JSX for .jsx/.tsx
                 // target: ts.ScriptTarget.ESNext, // Use modern JS features (Removed to satisfy type checker)
                 // module: ts.ModuleKind.ESNext, // Use modern modules (Removed to satisfy type checker)
                 moduleResolution: ts.ModuleResolutionKind.NodeJs, // Standard Node resolution
             },
        });
        logger.info('TypeScriptParser constructed with internal ts-morph Project.');
    }

    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const normalizedPath = filePath.replace(/\\/g, '/');
        logger.debug(`Parsing TS/JS/TSX file: ${normalizedPath}`);
        const now = new Date().toISOString();
        const instanceCounter = { count: 0 };

        try {
            // Add or update the source file in the ts-morph project
            // Using fileContent allows parsing without reading from disk again
            const sourceFile = this.tsProject.createSourceFile(
                normalizedPath,
                fileContent,
                { overwrite: true }
            );

            const fileEntityId = generateEntityId('file', normalizedPath);
            const fileNode: FileNode = {
                id: generateInstanceId(instanceCounter, 'file', path.basename(normalizedPath)),
                entityId: fileEntityId,
                kind: 'File',
                labels: ['File', 'TypeScript'], // Add specific label
                name: path.basename(normalizedPath),
                filePath: normalizedPath,
                language: sourceFile.getScriptKind() === ScriptKind.JSX || sourceFile.getScriptKind() === ScriptKind.TSX ? Language.TSX : Language.TypeScript,
                startLine: 1,
                endLine: sourceFile.getEndLineNumber(),
                startColumn: 0,
                endColumn: 0, // ts-morph doesn't easily provide end column for file
                loc: sourceFile.getEndLineNumber(), // Lines of code
                createdAt: now,
            };

            const result: { nodes: AstNode[], relationships: RelationshipInfo[] } = {
                nodes: [fileNode],
                relationships: [],
            };

            const addNode = (node: AstNode) => { result.nodes.push(node); };
            const addRelationship = (rel: RelationshipInfo) => { result.relationships.push(rel); };

            const context: ParserContext = {
                filePath: normalizedPath,
                sourceFile: sourceFile,
                fileNode: fileNode,
                result: { ...result, filePath: normalizedPath }, // Pass the result object being built, ensure filePath is included
                addNode: addNode,
                addRelationship: addRelationship,
                generateId: (prefix: string, identifier: string, options?: { line?: number; column?: number }) =>
                    generateInstanceId(instanceCounter, prefix, identifier, options),
                generateEntityId: generateEntityId,
                logger: createContextLogger(`TypeScriptParser-${path.basename(normalizedPath)}`),
                resolveImportPath: (source: string, imp: string) => {
                    // Basic relative path resolution (can be enhanced)
                    try {
                        const resolved = path.resolve(path.dirname(source), imp);
                        // TODO: Add checks for file extensions, index files etc.
                        return resolved.replace(/\\/g, '/');
                    } catch (e) {
                        return imp; // Return original if resolution fails
                    }
                },
                generateRelationshipId: generateRelationshipId, // Add the function here
                now: now,
            };

            // Call the individual parsing functions, passing the context
            parseImports(context);
            parseFunctions(context);
            parseClasses(context);
            parseVariables(context);
            parseInterfaces(context);
            parseTypeAliases(context);
            if (context.fileNode.language === Language.TSX) {
               parseJsx(context);
            }

            logger.debug(`Finished parsing ${normalizedPath}. Nodes: ${result.nodes.length}, Rels: ${result.relationships.length}`);
            return result;

        } catch (error: any) {
            logger.error(`Error parsing TS/JS/TSX file ${normalizedPath}: ${error.message}`, { stack: error.stack });
            // Return empty result on error to avoid crashing the whole analysis
            return { nodes: [], relationships: [] };
            // Or rethrow if preferred: throw new ParserError(`Failed to parse ${normalizedPath}: ${error.message}`);
        }
    }
}