import { Node, SyntaxKind, ts, BinaryExpression } from 'ts-morph'; // Import ts namespace and BinaryExpression
import { AstNode, ParserContext } from '../parser'; // Adjust path as needed

// const { SyntaxKind } = ts; // Remove duplicate declaration

/**
 * Analyzes assignment expressions within a block to detect state mutations.
 * Primarily focuses on mutations to 'this.property'.
 * @param body - The body node (e.g., Block, Expression) to analyze.
 * @param parentNode - The AstNode representing the containing function or method.
 * @param context - The ParserContext containing results and helpers.
 */
export function analyzeAssignments(body: Node, parentNode: AstNode, context: ParserContext): void {
    // Only analyze within methods for 'this' mutations for now
    if (!body || parentNode.kind !== 'Method') return;

    const { addRelationship, generateId, generateEntityId, logger, now } = context;

    try {
        // Filter specifically for BinaryExpression with assignment operators
        const assignments = body.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((expr: BinaryExpression) =>
            [SyntaxKind.EqualsToken, SyntaxKind.PlusEqualsToken, SyntaxKind.MinusEqualsToken,
             SyntaxKind.AsteriskEqualsToken, SyntaxKind.SlashEqualsToken // Add more if needed
            ].includes(expr.getOperatorToken().getKind())
        );

        for (const assignment of assignments) {
            // Now 'assignment' is known to be a BinaryExpression
            const leftOperand = assignment.getLeft();
            const startLine = assignment.getStartLineNumber();
            let targetEntityId: string | null = null;
            let targetName: string | null = null;
            let targetKind: string | null = null;

            // Check if it's a property access on 'this' (this.property = ...)
            if (Node.isPropertyAccessExpression(leftOperand)) {
                const expression = leftOperand.getExpression();
                if (expression.getKind() === SyntaxKind.ThisKeyword) {
                    const propName = leftOperand.getName();
                    // Assume the parent node's name format is 'ClassName.methodName'
                    const className = parentNode.name.split('.')[0];
                    if (className) {
                        targetName = `${className}.${propName}`;
                        // The target is the Class/Interface node itself, as property is metadata
                        targetEntityId = generateEntityId('class', `${parentNode.filePath}:${className}`); // Assume class for now
                        targetKind = 'Property'; // Indicate the mutation target *type*
                    } else {
                         logger.warn(`Could not extract class name from method node name: ${parentNode.name} in ${parentNode.filePath}`);
                    }
                }
            }
            // Could add checks for module-level variable mutations here if needed

            if (targetEntityId && targetName && targetKind) {
                const relEntityId = generateEntityId('mutates_state', `${parentNode.entityId}:${targetEntityId}:${targetName}`); // Include target name for uniqueness

                addRelationship({
                    id: generateId('mutates_state', `${parentNode.id}:${targetEntityId}:${targetName}:${startLine}`), // Instance ID
                    entityId: relEntityId,
                    type: 'MUTATES_STATE',
                    sourceId: parentNode.entityId, // The method performing the mutation
                    targetId: targetEntityId,     // The Class/Interface node containing the property
                    weight: 8,
                    properties: {
                        targetMemberName: targetName, // Store the specific property name
                        targetKind: targetKind,
                        startLine: startLine,
                        isPlaceholder: true, // Target node might not be resolved yet by resolver
                    },
                    createdAt: now,
                });
            }
        }
    } catch (e) {
        logger.warn(`Error analyzing assignments in ${parentNode.filePath} for ${parentNode.name}`, { error: e });
    }
}