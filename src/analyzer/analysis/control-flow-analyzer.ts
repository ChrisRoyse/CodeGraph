import { Node, ts, TryStatement } from 'ts-morph';
import { AstNode, ParserContext } from '../parser';

const { SyntaxKind } = ts;

/**
 * Analyzes a node's body for control flow statements (specifically try-catch for HANDLES_ERROR).
 * @param body - The body node (e.g., Block, Expression) to analyze.
 * @param parentNode - The AstNode representing the containing function or method.
 * @param context - The ParserContext containing results and helpers.
 */
export function analyzeControlFlow(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now } = context;

    try {
        // Find only TryStatements for HANDLES_ERROR
        const tryStatements = body.getDescendantsOfKind(SyntaxKind.TryStatement);

        for (const statement of tryStatements) {
            const catchClause = statement.getCatchClause();
            if (catchClause) {
                const catchStartLine = catchClause.getStartLineNumber();
                // Use parent node's info for generating IDs related to the handling relationship
                const relationshipBaseId = `${parentNode.id}:catch:${catchStartLine}`;
                const relationshipBaseEntityId = `${parentNode.entityId}:catch:${catchStartLine}`;

                // Conceptual target ID for the catch block itself (doesn't represent a real node)
                const catchTargetId = generateId('catch_clause', relationshipBaseId);
                // Entity ID for the HANDLES_ERROR relationship
                const handlesErrorEntityId = generateEntityId('handles_error', relationshipBaseEntityId);

                addRelationship({
                    id: generateId('handles_error', relationshipBaseId), // Unique instance ID
                    entityId: handlesErrorEntityId,
                    type: 'HANDLES_ERROR',
                    sourceId: parentNode.entityId, // Source is the function/method containing the try-catch
                    targetId: catchTargetId,       // Target is conceptual (the catch block location)
                    weight: 4,
                    properties: {
                        catchStartLine,
                        isPlaceholder: true, // Target is conceptual, won't resolve to a node
                        resolutionMethod: 'conceptual_catch',
                    },
                    createdAt: now,
                });
            }
        }
    } catch (e) {
        logger.warn(`Error analyzing control flow in ${parentNode.filePath} for ${parentNode.name}`, { error: e });
    }
}