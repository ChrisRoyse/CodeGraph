import { Node, ts, CallExpression, Identifier, PropertyAccessExpression, ClassDeclaration, InterfaceDeclaration, VariableDeclaration, FunctionDeclaration, MethodDeclaration, MethodSignature, FunctionExpression, ArrowFunction } from 'ts-morph';
import { AstNode, ParserContext } from '../parser'; // Adjust path as needed

const { SyntaxKind } = ts;

/**
 * Attempts to find the original declaration source file path and name for a called expression.
 */
function getTargetDeclarationInfo(expression: Node, context: ParserContext): { filePath: string; name: string; kind: string } | null {
    try {
        const symbol = expression.getSymbol();
        if (!symbol) return null;

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return null;

        // Take the first declaration (simplification)
        const declaration = declarations[0];
        if (!declaration) return null; // Ensure declaration exists

        const sourceFile = declaration.getSourceFile();
        const filePath = sourceFile.getFilePath();
        let name = symbol.getName(); // Use symbol name as default
        let kind = 'unknown';

        // Determine kind and potentially refine name based on declaration type
        if (Node.isFunctionDeclaration(declaration)) {
            kind = 'Function';
            name = declaration.getName() ?? name;
        } else if (Node.isArrowFunction(declaration)) {
            kind = 'Function'; // Treat arrow functions as Function kind
            // Try to get name from parent variable declaration
            const varDecl = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
            name = varDecl?.getName() ?? name; // Use variable name if found
        } else if (Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration)) {
            kind = 'Method';
            name = declaration.getName() ?? name;
            const parentContainer = declaration.getParent() as ClassDeclaration | InterfaceDeclaration | null;
            if (parentContainer && (Node.isClassDeclaration(parentContainer) || Node.isInterfaceDeclaration(parentContainer))) {
                const parentName = parentContainer.getName();
                if (parentName) {
                    name = `${parentName}.${name}`;
                }
            }
        } else if (Node.isClassDeclaration(declaration)) {
            kind = 'Class';
            name = declaration.getName() ?? name;
        } else if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            if (initializer && (Node.isFunctionExpression(initializer) || Node.isArrowFunction(initializer))) {
                kind = 'Function';
                name = declaration.getName() ?? name;
            } else {
                kind = 'Variable';
                name = declaration.getName() ?? name;
            }
        }
        // Add more kinds as needed

        // Use resolveImportPath for cross-file consistency
        const resolvedFilePath = context.resolveImportPath(context.sourceFile.getFilePath(), filePath);

        return { filePath: resolvedFilePath, name, kind };
    } catch (e) {
        context.logger.debug(`Error resolving symbol for call target: ${expression.getText()}`, { error: e });
        return null; // Ignore errors during symbol resolution
    }
}


/**
 * Analyzes a node's body for function/method calls and adds CALLS relationships.
 */
export function analyzeCalls(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now } = context;

    try {
        const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);

        for (const callExpr of callExpressions) {
            const expression = callExpr.getExpression();
            const startLine = callExpr.getStartLineNumber();
            // Correct way to get column
            const column = callExpr.getStart() - callExpr.getStartLinePos();

            // Attempt to resolve the target declaration
            const targetInfo = getTargetDeclarationInfo(expression, context);

            let targetEntityId: string;
            let targetName: string;
            let properties: Record<string, any> = {
                startLine,
                column, // Add column to properties
                isPlaceholder: true, // Assume placeholder initially
            };

            if (targetInfo) {
                // Generate entityId based on resolved info
                targetEntityId = generateEntityId(targetInfo.kind.toLowerCase(), `${targetInfo.filePath}:${targetInfo.name}`);
                targetName = targetInfo.name;
                properties.targetName = targetName;
                properties.targetFilePath = targetInfo.filePath;
                properties.targetKind = targetInfo.kind;
                properties.resolutionHint = 'symbol_declaration';
            } else {
                // Fallback if symbol resolution fails
                targetName = expression.getText();
                const qualifiedTargetName = `${parentNode.filePath}:${targetName}`;
                targetEntityId = generateEntityId('unknown_call_target', qualifiedTargetName);
                properties.targetName = targetName;
                properties.qualifiedName = qualifiedTargetName;
                properties.resolutionHint = 'text_fallback';
                logger.debug(`Symbol resolution failed for call target: ${targetName} in ${parentNode.filePath}`);
            }

            if (!targetName) continue;

            const relEntityId = generateEntityId('calls', `${parentNode.entityId}:${targetEntityId}`);

            addRelationship({
                id: generateId('calls', `${parentNode.id}:${targetEntityId}`, { line: startLine, column }),
                entityId: relEntityId,
                type: 'CALLS',
                sourceId: parentNode.entityId,
                targetId: targetEntityId,
                weight: 7,
                properties,
                createdAt: now,
            });
        }
    } catch (e) {
        logger.warn(`Error analyzing calls in ${parentNode.filePath} for ${parentNode.name}`, { error: e });
    }
}