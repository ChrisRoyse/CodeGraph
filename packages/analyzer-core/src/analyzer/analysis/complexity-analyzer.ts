import { Node, SyntaxKind, ts } from 'ts-morph';

const { SyntaxKind: SK } = ts; // Alias for brevity

/**
 * Calculates the cyclomatic complexity of a given code block or expression.
 * Complexity = Decision Points + 1
 * Decision Points include: if, for, while, case, &&, ||, ?, ??, catch clauses.
 *
 * @param node - The ts-morph Node representing the function/method body or relevant block.
 * @returns The calculated cyclomatic complexity score.
 */
export function calculateCyclomaticComplexity(node: Node | undefined): number {
    if (!node) {
        return 1; // Default complexity for an empty or undefined body
    }

    let complexity = 1; // Start with 1 for the single entry point

    try {
        node.forEachDescendant((descendant) => {
            const kind = descendant.getKind();

            // Increment for standard decision points
            if (
                kind === SK.IfStatement ||
                kind === SK.ForStatement ||
                kind === SK.ForInStatement ||
                kind === SK.ForOfStatement ||
                kind === SK.WhileStatement ||
                kind === SK.DoStatement ||
                kind === SK.CaseClause ||
                kind === SK.CatchClause ||
                kind === SK.ConditionalExpression // Ternary '?'
            ) {
                complexity++;
            }
            // Increment for logical operators within BinaryExpressions
            else if (Node.isBinaryExpression(descendant)) { // Use type guard
                const operatorKind = descendant.getOperatorToken().getKind();
                if (
                    operatorKind === SK.AmpersandAmpersandToken || // &&
                    operatorKind === SK.BarBarToken ||             // ||
                    operatorKind === SK.QuestionQuestionToken    // ??
                ) {
                    complexity++;
                }
            }

            // Optional: Prevent descending into nested functions/classes
            // if (Node.isFunctionLikeDeclaration(descendant) || Node.isClassDeclaration(descendant)) {
            //     return false; // Stop traversal for this branch
            // }
        });
    } catch (e) {
        console.warn(`Error calculating complexity: ${e}`);
        return 1; // Return default complexity on error
    }

    return complexity;
}