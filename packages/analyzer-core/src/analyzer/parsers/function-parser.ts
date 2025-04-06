import { FunctionDeclaration, FunctionExpression, ArrowFunction, VariableDeclaration, Node, ts } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getVisibility, getJsDocText, getNodeName, getFunctionReturnType } from '../../utils/ts-helpers.js';
import { calculateCyclomaticComplexity } from '../analysis/complexity-analyzer.js';
import { parseParameters } from './parameter-parser.js';
 // Assuming this exists and works

const { SyntaxKind } = ts;

/**
 * Parses FunctionDeclarations, FunctionExpressions, and ArrowFunctions within a source file
 * to create Function nodes (Pass 1).
 * @param context - The parser context for the current file.
 */
export function parseFunctions(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, generateId, generateEntityId, logger, now } = context;

    // Find all relevant function-like declarations/expressions
    const functions = [
        ...sourceFile.getFunctions(), // FunctionDeclarations
        ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction)
    ];

    logger.debug(`Found ${functions.length} function-like structures in ${fileNode.name}`);

    for (const declaration of functions) {
        try {
            // Initialize variables with defaults to satisfy definite assignment
            let name: string | undefined = undefined;
            let isExported: boolean = false;
            let startLine: number = declaration.getStartLineNumber();
            let endLine: number = declaration.getEndLineNumber();
            let startColumn: number = declaration.getStart() - declaration.getStartLinePos();
            let endColumn: number = getEndColumn(declaration);
            let docs: string | undefined = getJsDocText(declaration);
            let nodeToParse: FunctionDeclaration | FunctionExpression | ArrowFunction = declaration;
            let isCallback = false; // Flag for callbacks

            // Handle functions assigned to variables (const myFunc = () => {})
            if (Node.isFunctionExpression(nodeToParse) || Node.isArrowFunction(nodeToParse)) {
                const variableDecl = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
                const callExprArg = declaration.getFirstAncestorByKind(SyntaxKind.CallExpression);

                if (variableDecl) {
                    name = getNodeName(variableDecl, 'anonymousFuncExpr');
                    isExported = variableDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement)?.isExported() ?? false;
                    startLine = variableDecl.getStartLineNumber();
                    endLine = variableDecl.getEndLineNumber();
                    startColumn = variableDecl.getStart() - variableDecl.getStartLinePos();
                    endColumn = getEndColumn(variableDecl);
                    docs = getJsDocText(variableDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement) || variableDecl) || docs;
                } else {
                    // Likely an IIFE or callback argument
                    if (callExprArg) {
                        isCallback = true;
                        logger.debug(`[parseFunctions] Found callback function at ${fileNode.filePath}:${startLine}`);
                        const argIndex = callExprArg.getArguments().findIndex(arg => arg === declaration);
                        const callingFuncName = callExprArg.getExpression().getText();
                        const safeCallingFuncName = callingFuncName.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30);
                        name = `callback_${safeCallingFuncName}_arg${argIndex}`;
                    } else {
                        name = 'anonymousLambda'; // Fallback for IIFE or other cases
                    }
                    // Keep isExported as false
                    // Keep location/docs as initialized from the function/arrow expression itself
                }
            } else if (Node.isFunctionDeclaration(nodeToParse)) { // FunctionDeclaration
                name = getNodeName(declaration, 'anonymousFuncDecl');
                isExported = nodeToParse.isExported();
                // Keep location/docs as initialized from the declaration
            }

            // Ensure name was assigned
            if (name === undefined) {
                 logger.error(`[parseFunctions] Failed to determine name for function-like node at ${fileNode.filePath}:${startLine}`);
                 continue; // Skip this node if name couldn't be determined
            }

            // Define a consistent qualified name
            const uniqueQualifiedName = `${fileNode.filePath}:${name}:${startLine}`;
            const entityId = generateEntityId('function', uniqueQualifiedName);

            const returnType = getFunctionReturnType(declaration);
            const complexity = calculateCyclomaticComplexity(nodeToParse); // Pass the node itself
            const modifiers = declaration.getModifiers?.() ?? []; // Use optional chaining for ArrowFunction which might not have getModifiers
            const modifierFlags = modifiers.map(mod => mod.getText());
            // Check if it's a generator (Arrow functions cannot be generators)
            const isGenerator = Node.isFunctionDeclaration(declaration) || Node.isFunctionExpression(declaration)
                ? declaration.isGenerator()
                : false;

            // Extract JSDoc tags
            const jsDocs = declaration.getJsDocs();
            let tags: string[] = [];
            if (jsDocs.length > 0) {
                // Use the last JSDoc block before the declaration
                const lastJsDoc = jsDocs[jsDocs.length - 1];
                // Add non-null assertion to satisfy TS, although length check should guarantee it's defined
                tags = lastJsDoc!.getTags().map(tag => tag.getTagName());
            }

            const functionNode: AstNode = {
                id: generateId('function', uniqueQualifiedName),
                entityId,
                kind: 'Function',
                name,
                filePath: fileNode.filePath,
                language: 'TypeScript', // Add language property
                startLine, endLine, startColumn, endColumn,
                loc: endLine - startLine + 1,
                complexity: complexity,
                documentation: docs || undefined, docComment: docs,
                isExported: isExported,
                isAsync: declaration.isAsync(),
                isGenerator: isGenerator, // Use the calculated value
                returnType: returnType,
                tags: tags.length > 0 ? tags : undefined, // Add tags, omit if empty
                modifierFlags: modifierFlags, // Add modifier flags
                properties: { isCallback }, // Keep existing custom properties
                createdAt: now,
            };
            addNode(functionNode);

            // Parse parameters for this function
            parseParameters(declaration, functionNode, context);

            // Note: Body analysis (CALLS, MUTATES_STATE, etc.) is done in Pass 2 (RelationshipResolver)

        } catch (e: any) {
             const funcName = Node.isFunctionDeclaration(declaration) ? declaration.getName() : 'expression/arrow';
             logger.warn(`Error parsing function ${funcName} in ${fileNode.filePath}`, { message: e.message });
        }
    }
}