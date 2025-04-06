import { VariableStatement, VariableDeclaration, Node, ts, VariableDeclarationKind } from 'ts-morph'; // Import VariableDeclarationKind
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getNodeType, getJsDocText, getNodeName } from '../../utils/ts-helpers.js';

const { SyntaxKind } = ts;

/**
 * Parses VariableDeclarations within a source file to create Variable nodes (Pass 1).
 * Skips variables that initialize functions, as those are handled by function-parser.
 * @param context - The parser context for the current file.
 */
export function parseVariables(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, generateId, generateEntityId, logger, now } = context;

    // Get VariableStatements first, as they contain export status and docs
    const variableStatements = sourceFile.getVariableStatements();

    logger.debug(`Found ${variableStatements.length} variable statements in ${fileNode.name}`);

    for (const statement of variableStatements) {
        const isExported = statement.isExported();
        // Get docs from the statement, as it often precedes the declaration list
        const docs = getJsDocText(statement);

        const declarations = statement.getDeclarations();
        for (const declaration of declarations) {
            try {
                // Skip if the variable is initializing a function (handled by function-parser)
                const initializer = declaration.getInitializer();
                if (initializer && (Node.isFunctionExpression(initializer) || Node.isArrowFunction(initializer))) {
                    continue; // Skip function variables
                }

                const name = getNodeName(declaration, 'anonymousVar');
                // Qualified name includes file path
                const qualifiedName = `${fileNode.filePath}:${name}`;
                // Add line number for potentially non-unique variable names within a file
                const uniqueQualifiedName = `${qualifiedName}:${declaration.getStartLineNumber()}`;
                const entityId = generateEntityId('variable', uniqueQualifiedName);
 // Use unique name for ID
                const type = getNodeType(declaration);
                 const declarationKind = statement.getDeclarationKind();
                 const isConstant = declarationKind === VariableDeclarationKind.Const;
 // Use imported enum
                 const modifiers = statement.getModifiers() ?? [];
                 const modifierFlags = modifiers.map(mod => mod.getText());
                 // Add 'const', 'let', or 'var' to modifier flags for clarity
                 if (declarationKind === VariableDeclarationKind.Const) modifierFlags.push('const');
 // Use imported enum
                 else if (declarationKind === VariableDeclarationKind.Let) modifierFlags.push('let');
 // Use imported enum
                 else modifierFlags.push('var'); // Assume var if not const or let

                const variableNode: AstNode = {
                    id: generateId('variable', uniqueQualifiedName),
                    entityId,
                    kind: 'Variable',
                    name,
                    filePath: fileNode.filePath,
                    language: 'TypeScript', // Add language property
                    startLine: declaration.getStartLineNumber(),
                    endLine: declaration.getEndLineNumber(), // Often same as start for simple vars
                    startColumn: declaration.getStart() - declaration.getStartLinePos(),
                    endColumn: getEndColumn(declaration),
                    loc: declaration.getEndLineNumber() - declaration.getStartLineNumber() + 1,
                    type: type,
                    documentation: docs || undefined, // Use docs from statement
                    docComment: docs,
                    isExported: isExported, // Use export status from statement
                    isConstant: isConstant,
                     modifierFlags: modifierFlags.length > 0 ? modifierFlags : undefined,
                    createdAt: now,
                };
                addNode(variableNode);

                // Note: Relationships involving variables (MUTATES_STATE, potentially READS_VARIABLE)
                // are typically handled during body analysis in Pass 1 (AstParser) or Pass 2.

            } catch (e: any) {
                logger.warn(`Error parsing variable declaration ${declaration.getName()} in ${fileNode.filePath}`, { message: e.message });
            }
        }
    }
}