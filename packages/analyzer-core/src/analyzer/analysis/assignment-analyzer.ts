import { Node, SyntaxKind, ts, Identifier, BinaryExpression, PropertyAccessExpression } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getTargetDeclarationInfo } from './analyzer-utils.js'; // Shared util

const { SyntaxKind: SK } = ts;

/**
 * Analyzes a code block (function/method body) for assignment expressions
 * that potentially mutate state (e.g., assigning to `this.property` or module variables).
 * Creates intra-file MUTATES_STATE relationships during Pass 1.
 * Cross-file mutations are handled in Pass 2.
 * @param body - The ts-morph Node representing the code block to analyze.
 * @param parentNode - The AstNode of the containing function or method.
 * @param context - The parser context.
 */
export function analyzeAssignments(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, result } = context;

    try {
        // Find BinaryExpressions with an assignment operator (=)
        const assignments = body.getDescendantsOfKind(SK.BinaryExpression).filter(expr =>
            expr.getOperatorToken().getKind() === SK.EqualsToken
        );

        for (const assignment of assignments) {
            const leftHandSide = assignment.getLeft();
            const assignStartLine = assignment.getStartLineNumber();
            const assignColumn = assignment.getStart() - assignment.getStartLinePos();

            // --- Target Resolution ---
            let targetInfo: ReturnType<typeof getTargetDeclarationInfo> = null;
            let targetEntityId: string | null = null;
            let targetNodeInFile: AstNode | undefined = undefined;

            // Try to resolve the variable/property being assigned to
            // Handle `this.property = ...` and `variable = ...`
            if (Node.isPropertyAccessExpression(leftHandSide)) {
                 // Potentially `this.prop` or `obj.prop`. Need to resolve `prop`.
                 // For MUTATES_STATE, we are often interested in the property itself.
                 // Let's try resolving the property name node.
                 targetInfo = getTargetDeclarationInfo(leftHandSide.getNameNode(), parentNode.filePath, context.resolveImportPath, context.logger);
            } else if (Node.isIdentifier(leftHandSide)) {
                 // Simple variable assignment `var = ...`
                 targetInfo = getTargetDeclarationInfo(leftHandSide, parentNode.filePath, context.resolveImportPath, context.logger);
            } else {
                 // Skip other complex LHS assignments (e.g., array destructuring) for now
                 continue;
            }

            if (targetInfo) {
                // Check if the resolved target is within the current file
                targetNodeInFile = result.nodes.find(n => n.entityId === targetInfo.entityId && n.filePath === parentNode.filePath);
                if (targetNodeInFile) {
                    // Only consider mutations to Variables or Properties (represented as Variables for now)
                    if (targetInfo.kind === 'Variable' || targetInfo.kind === 'Parameter') { // Allow mutating params? Maybe not ideal. Let's stick to Variable for now.
                         if (targetInfo.kind === 'Variable') {
                            targetEntityId = targetInfo.entityId;
                            logger.debug(`[Pass 1] Intra-file MUTATES_STATE detected: ${parentNode.name} -> ${targetInfo.name}`);
                         } else {
                             logger.debug(`[Pass 1] Skipping potential MUTATES_STATE on non-variable target kind: ${targetInfo.kind}`);
                             continue;
                         }
                    } else {
                         logger.debug(`[Pass 1] Skipping potential MUTATES_STATE on non-variable target kind: ${targetInfo.kind}`);
                         continue;
                    }
                } else {
                    logger.debug(`[Pass 1] Cross-file MUTATES_STATE detected (or unresolved): ${parentNode.name} -> ${targetInfo.name}. Deferring to Pass 2.`);
                    continue; // Skip cross-file in Pass 1
                }
            } else {
                logger.debug(`[Pass 1] Could not resolve MUTATES_STATE target: ${leftHandSide.getText()} in ${parentNode.name}. Deferring to Pass 2.`);
                continue; // Skip unresolved in Pass 1
            }

            // --- Create Relationship ---
            if (targetEntityId) {
                const properties: Record<string, any> = {
                    startLine: assignStartLine,
                    column: assignColumn,
                    targetName: targetInfo?.name || leftHandSide.getText(),
                    targetKind: targetInfo?.kind || 'unknown',
                    resolutionHint: 'symbol_declaration',
                    // Could add info about the RHS value type if needed
                    // valueType: assignment.getRight().getType().getText() || 'unknown'
                };

                const mutateRelEntityId = generateEntityId('mutates_state', `${parentNode.entityId}:${targetEntityId}`);
                addRelationship({
                    id: generateId('mutates_state', `${parentNode.id}:${targetEntityId}`, { line: assignStartLine, column: assignColumn }),
                    entityId: mutateRelEntityId,
                    type: 'MUTATES_STATE',
                    sourceId: parentNode.entityId,
                    targetId: targetEntityId, // Guaranteed string
                    weight: 8, // Mutations are significant
                    properties,
                    createdAt: now
                });
            }
        }
    } catch (error: any) {
        logger.warn(`Error analyzing assignments within ${parentNode.name} (${parentNode.filePath})`, { message: error.message });
    }
}