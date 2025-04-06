import { Node, SyntaxKind, ts, TryStatement, CatchClause } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getNodeName } from '../../utils/ts-helpers.js'; // If needed for catch block naming

const { SyntaxKind: SK } = ts;

/**
 * Analyzes a code block (function/method body) for TryStatements and CatchClauses.
 * Creates HANDLES_ERROR relationships during Pass 1.
 * @param body - The ts-morph Node representing the code block to analyze.
 * @param parentNode - The AstNode of the containing function or method.
 * @param context - The parser context.
 */
export function analyzeControlFlow(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now } = context;

    try {
        const tryStatements = body.getDescendantsOfKind(SK.TryStatement);

        for (const tryStmt of tryStatements) {
            const catchClause = tryStmt.getCatchClause();
            if (!catchClause) continue; // Skip try without catch

            const tryStartLine = tryStmt.getStartLineNumber();
            const tryColumn = tryStmt.getStart() - tryStmt.getStartLinePos();
            const catchStartLine = catchClause.getStartLineNumber();
            const catchColumn = catchClause.getStart() - catchClause.getStartLinePos();

            // For simplicity, link the parent function/method directly to the catch clause parameter (if any)
            // or create a generic target representing the error handling block.

            // Option 1: Link to Catch Parameter (if it exists)
            const catchBinding = catchClause.getVariableDeclaration();
            let targetEntityId: string;
            let targetName: string;
            let targetKind: string;

            if (catchBinding) {
                // Find the corresponding Parameter AstNode created by parameter-parser (might be tricky)
                // Or generate a parameter entity ID based on the catch binding
                targetName = getNodeName(catchBinding, 'errorParam');
                // Generate ID relative to the parent function, similar to parameters
                const paramQualifiedName = `${parentNode.entityId}:catch:${targetName}:${catchStartLine}`;
                targetEntityId = generateEntityId('parameter', paramQualifiedName); // Treat catch var as a parameter
                targetKind = 'Parameter';
                // We might not have actually created a separate AstNode for the catch parameter,
                // so this relationship might point to a non-existent node initially.
                // Pass 2 resolver would need to handle this or we adjust parameter parsing.
                // For now, let's assume the ID is sufficient.
                 logger.debug(`[Pass 1] HANDLES_ERROR detected: ${parentNode.name} -> catch(${targetName})`);

            } else {
                // Option 2: Link to a generic "ErrorHandler" concept for the catch block
                targetName = `ErrorHandler_${catchStartLine}`;
                const handlerQualifiedName = `${parentNode.entityId}:handler:${catchStartLine}`;
                targetEntityId = generateEntityId('error_handler', handlerQualifiedName); // Use a custom kind
                targetKind = 'ErrorHandler';
                 logger.debug(`[Pass 1] HANDLES_ERROR detected: ${parentNode.name} -> CatchBlock@L${catchStartLine}`);
                // We would need to ensure 'error_handler' is a valid node label in the schema
                // or adjust the relationship target logic. Let's stick with Option 1 for now,
                // assuming the parameter ID is the intended target. Revert to Option 1 logic:
                targetName = 'errorParam'; // Default name if no binding
                const paramQualifiedName = `${parentNode.entityId}:catch:${targetName}:${catchStartLine}`;
                targetEntityId = generateEntityId('parameter', paramQualifiedName);
                targetKind = 'Parameter';

            }


            // Create HANDLES_ERROR relationship (Function/Method -> Catch Parameter/Handler)
            const properties: Record<string, any> = {
                tryStartLine,
                tryColumn,
                catchStartLine,
                catchColumn,
                targetName,
                targetKind,
            };

            const handlesErrorRelEntityId = generateEntityId('handles_error', `${parentNode.entityId}:${targetEntityId}`);
            addRelationship({
                id: generateId('handles_error', `${parentNode.id}:${targetEntityId}`, { line: catchStartLine, column: catchColumn }),
                entityId: handlesErrorRelEntityId,
                type: 'HANDLES_ERROR',
                sourceId: parentNode.entityId, // Source is the function/method containing the try-catch
                targetId: targetEntityId,     // Target is the conceptual parameter/handler
                weight: 5, // Adjust weight as needed
                properties,
                createdAt: now
            });
        }
    } catch (error: any) {
        logger.warn(`Error analyzing control flow (try/catch) within ${parentNode.name} (${parentNode.filePath})`, { message: error.message });
    }
}