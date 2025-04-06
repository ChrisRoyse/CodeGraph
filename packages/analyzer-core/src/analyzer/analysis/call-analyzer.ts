import { Node, SyntaxKind, ts, Identifier, CallExpression } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getTargetDeclarationInfo } from './analyzer-utils.js'; // Assuming a shared util for target resolution

const { SyntaxKind: SK } = ts;

/**
 * Analyzes a code block (function/method body) for CallExpressions.
 * Creates intra-file CALLS relationships during Pass 1.
 * Cross-file calls are handled in Pass 2.
 * @param body - The ts-morph Node representing the code block to analyze.
 * @param parentNode - The AstNode of the containing function or method.
 * @param context - The parser context.
 */
export function analyzeCalls(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, result } = context;

    try {
        const callExpressions = body.getDescendantsOfKind(SK.CallExpression);

        for (const callExpr of callExpressions) {
            const expression = callExpr.getExpression(); // The part being called (e.g., function name, this.method)
            const callStartLine = callExpr.getStartLineNumber();
            const callColumn = callExpr.getStart() - callExpr.getStartLinePos();
            const callArguments = callExpr.getArguments();
            const argumentCount = callArguments.length;
            let argumentTypes: string[] = [];
            try {
                argumentTypes = callArguments.map((arg: Node) => arg.getType().getText() || 'any');
            } catch (typeError) {
                logger.debug(`Could not resolve argument types for call in ${parentNode.name} at L${callStartLine}`, { error: typeError });
                argumentTypes = Array(argumentCount).fill('error');
            }

            // Check for conditional context
            const conditionalAncestor = callExpr.getFirstAncestor((ancestor: Node) => {
                const kind = ancestor.getKind();
                return kind === SK.IfStatement || kind === SK.ConditionalExpression || kind === SK.SwitchStatement ||
                       kind === SK.ForStatement || kind === SK.ForInStatement || kind === SK.ForOfStatement ||
                       kind === SK.WhileStatement || kind === SK.DoStatement || kind === SK.TryStatement;
            });
            const isConditional = !!conditionalAncestor;

            // Attempt to resolve the called function/method declaration
            const targetInfo = getTargetDeclarationInfo(expression, parentNode.filePath, context.resolveImportPath, context.logger);

            let targetEntityId: string | null = null;
            let targetNodeInFile: AstNode | undefined = undefined;

            if (targetInfo) {
                // Check if the resolved target is within the current file being parsed
                targetNodeInFile = result.nodes.find(n => n.entityId === targetInfo.entityId && n.filePath === parentNode.filePath);
                if (targetNodeInFile) {
                    targetEntityId = targetInfo.entityId;
                    logger.debug(`[Pass 1] Intra-file CALL detected: ${parentNode.name} -> ${targetInfo.name}`);
                } else {
                    logger.debug(`[Pass 1] Cross-file CALL detected (or unresolved symbol): ${parentNode.name} -> ${targetInfo.name}. Deferring to Pass 2.`);
                    // Skip creating relationship in Pass 1
                    continue;
                }
            } else {
                // Cannot resolve target, skip in Pass 1
                logger.debug(`[Pass 1] Could not resolve CALL target: ${expression.getText()} in ${parentNode.name}. Deferring to Pass 2.`);
                continue;
            }

            // Only proceed if we have a valid intra-file targetEntityId
            if (targetEntityId) {
                const properties: Record<string, any> = {
                    startLine: callStartLine,
                    column: callColumn,
                    argumentCount,
                    argumentTypes,
                    isConditional,
                    // Use resolved info if available, otherwise fallback
                    targetName: targetInfo?.name || expression.getText(),
                    targetKind: targetInfo?.kind || 'unknown',
                    resolutionHint: 'symbol_declaration', // Since we resolved it to an intra-file node
                };

                const callRelEntityId = generateEntityId('calls', `${parentNode.entityId}:${targetEntityId}`);
                addRelationship({
                    id: generateId('calls', `${parentNode.id}:${targetEntityId}`, { line: callStartLine, column: callColumn }),
                    entityId: callRelEntityId,
                    type: 'CALLS',
                    sourceId: parentNode.entityId,
                    targetId: targetEntityId,
 // Now guaranteed to be string
                    weight: 7, // Adjust weight as needed
                    properties,
                    createdAt: now
                });
            }
        }
    } catch (error: any) {
        logger.warn(`Error analyzing calls within ${parentNode.name} (${parentNode.filePath})`, { message: error.message });
    }
}