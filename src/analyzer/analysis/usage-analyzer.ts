import { Node, SyntaxKind, Identifier, ClassDeclaration, InterfaceDeclaration, VariableDeclaration, FunctionDeclaration, MethodDeclaration, MethodSignature, PropertySignature, BindingElement, ImportSpecifier, ExportSpecifier, TypeReferenceNode, FunctionExpression, ArrowFunction, EnumDeclaration, TypeAliasDeclaration, ParameterDeclaration } from 'ts-morph';
import { AstNode, ParserContext } from '../parser'; // Adjust path as needed
import { getEndColumn } from '../../utils/ts-helpers'; // Import getEndColumn

/**
 * Helper to check if an identifier is part of a declaration or specific naming context.
 */
function isDeclarationOrNameContext(identifier: Node): boolean {
    const parent = identifier.getParent();
    if (!parent) return false;
    const parentKind = parent.getKind();

    // Add more kinds as needed
    return (
        parentKind === SyntaxKind.VariableDeclaration ||
        parentKind === SyntaxKind.FunctionDeclaration ||
        parentKind === SyntaxKind.MethodDeclaration ||
        parentKind === SyntaxKind.ClassDeclaration ||
        parentKind === SyntaxKind.InterfaceDeclaration ||
        parentKind === SyntaxKind.EnumDeclaration ||
        parentKind === SyntaxKind.EnumMember ||
        parentKind === SyntaxKind.TypeAliasDeclaration ||
        parentKind === SyntaxKind.Parameter ||
        (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) || // Don't capture 'prop' in obj.prop
        (Node.isPropertyAssignment(parent) && parent.getNameNode() === identifier) || // Don't capture 'prop' in { prop: ... }
        (Node.isMethodSignature(parent) && parent.getNameNode() === identifier) ||
        (Node.isPropertySignature(parent) && parent.getNameNode() === identifier) ||
        (Node.isBindingElement(parent) && parent.getNameNode() === identifier) || // Don't capture 'a' in const {a} = ...
        (Node.isImportSpecifier(parent) && parent.getNameNode() === identifier) || // Handled by module parser
        (Node.isExportSpecifier(parent) && parent.getNameNode() === identifier) || // Handled by module parser
        parentKind === SyntaxKind.TypeReference // Avoid capturing type names as usage targets here
    );
}

/**
 * Recursively finds and creates Parameter nodes for ArrowFunctions and FunctionExpressions.
 */
function processNestedFunctionParams(containerNode: Node, parentAstNode: AstNode, context: ParserContext): void {
    const { addNode, addRelationship, generateId, generateEntityId, logger, now } = context;

    containerNode.forEachDescendant((node) => {
        if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
            // Create a temporary 'Function' node representation for context if needed,
            // or directly link params to the outer parentAstNode (simplification for now)
            const funcNodeContext = parentAstNode; // Link params to the outer function/method for now

            node.getParameters().forEach(param => {
                try {
                    const paramName = param.getName();
                    const paramType = param.getType().getText() || 'any';
                    // Entity ID needs context from the outer function and param name
                    const paramEntityId = generateEntityId('parameter', `${funcNodeContext.entityId}:lambdaParam:${paramName}:${param.getStart()}`); // Add start pos for uniqueness
                    const paramDocs = undefined; // JSDoc less common on lambda params

                    const paramNode: AstNode = {
                        id: generateId('parameter', `${funcNodeContext.id}:lambdaParam:${paramName}`, { line: param.getStartLineNumber(), column: param.getStart() - param.getStartLinePos() }),
                        entityId: paramEntityId,
                        kind: 'Parameter', name: paramName, filePath: funcNodeContext.filePath,
                        startLine: param.getStartLineNumber(), endLine: param.getEndLineNumber(),
                        startColumn: param.getStart() - param.getStartLinePos(), endColumn: getEndColumn(param), // Assuming getEndColumn exists
                        type: paramType,
                        documentation: paramDocs, docComment: paramDocs,
                        isOptional: param.isOptional(),
                        isRestParameter: param.isRestParameter(),
                        createdAt: now,
                    };

                    // Avoid adding duplicate nodes if analysis runs multiple times on same body
                    if (!context.result.nodes.some(n => n.entityId === paramEntityId)) {
                        addNode(paramNode);

                        // CONTAINS relationship (Outer Function/Method -> Lambda Parameter)
                        addRelationship({
                            id: generateId('contains', `${funcNodeContext.id}:${paramNode.id}`),
                            entityId: generateEntityId('contains', `${funcNodeContext.entityId}:${paramNode.entityId}`),
                            type: 'CONTAINS', sourceId: funcNodeContext.entityId, targetId: paramNode.entityId,
                            weight: 1, // Low weight
                            createdAt: now,
                        });
                    }
                } catch (paramError) {
                    logger.warn(`Error parsing lambda parameter ${param.getName()} within ${funcNodeContext.name}`, { error: paramError });
                }
            });

            // Prevent descending into the parameters/body of this nested function again
            return false;
        }
        return undefined; // Continue traversal
    });
}


/**
 * Helper to get names of locally declared variables/functions/params within a container node.
 */
function getLocalDeclarations(container: Node, context: ParserContext): Set<string> { // Pass context
    const locals = new Set<string>();
 // Keep this simple for now, rely on symbol resolution
    // try {
    //     // DO NOT add parameters here - we want to track their usage
   //      // Add variable/function declarations if needed later for more complex scoping
    // } catch (e) { context.logger.debug(`Error getting local declarations`, { error: e });
    return locals;
}

/**
 * Attempts to find the original declaration source file path and name for a used identifier.
 */
function getTargetDeclarationInfo(identifier: Identifier, context: ParserContext): { filePath: string; name: string; kind: string; entityId: string } | null {
    try {
        const symbol = identifier.getSymbol();
        if (!symbol) return null;

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) return null;

        const declaration = declarations[0]; // Simplification
        if (!declaration) return null;

        const sourceFile = declaration.getSourceFile();
        const filePath = sourceFile.getFilePath();
        let name = symbol.getName();
        let kind = 'unknown';

        // Determine kind based on declaration type
        if (Node.isFunctionDeclaration(declaration)) {
            kind = 'Function';
            name = declaration.getName() ?? name;
        } else if (Node.isArrowFunction(declaration) || Node.isFunctionExpression(declaration)) {
            kind = 'Function';
            // Try to get name from parent variable declaration
            const varDecl = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
            name = varDecl?.getName() ?? name;
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
        } else if (Node.isInterfaceDeclaration(declaration)) {
            kind = 'Interface';
            name = declaration.getName() ?? name;
        } else if (Node.isVariableDeclaration(declaration)) {
            kind = 'Variable';
            name = declaration.getName() ?? name;
        } else if (Node.isParameterDeclaration(declaration)) {
            kind = 'Parameter'; // Correct kind
            name = declaration.getName() ?? name;
            // Find the containing function/method to build the correct entityId
            const func = declaration.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration)
                      || declaration.getFirstAncestorByKind(SyntaxKind.MethodDeclaration)
                      || declaration.getFirstAncestorByKind(SyntaxKind.ArrowFunction)
                      || declaration.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
            if (func) {
                // Reconstruct the function/method entityId (approximation, might need refinement)
                const funcName = ('getName' in func && func.getName()) ? func.getName() : 'anonymous';
                const funcFilePath = func.getSourceFile().getFilePath();
                const funcQualifiedName = `${funcFilePath}:${funcName}:${func.getStartLineNumber()}`; // Assumes function entityId format includes line number
                const funcEntityId = context.generateEntityId('function', funcQualifiedName); // Or 'method' if MethodDeclaration
                const paramEntityId = context.generateEntityId('parameter', `${funcEntityId}:${name}`);
                return { filePath: funcFilePath, name, kind, entityId: paramEntityId };
            }
        } else if (Node.isTypeAliasDeclaration(declaration)) {
            kind = 'TypeAlias';
            name = declaration.getName() ?? name;
        } else if (Node.isEnumDeclaration(declaration)) {
            kind = 'TypeAlias'; // Treat Enum as TypeAlias for simplicity
            name = declaration.getName() ?? name;
        } else if (Node.isEnumMember(declaration)) {
            kind = 'TypeAlias'; // Treat EnumMember as part of TypeAlias
            name = `${declaration.getParent().getName()}.${declaration.getName()}`;
        }
        // Add PropertySignature/PropertyDeclaration if needed, though USES usually points to the container

        const resolvedFilePath = context.resolveImportPath(context.sourceFile.getFilePath(), filePath);
        // Generate a standard entity ID if it wasn't a parameter handled above
        const entityId = context.generateEntityId(kind.toLowerCase(), `${resolvedFilePath}:${name}`);
        return { filePath: resolvedFilePath, name, kind, entityId };

    } catch (e) {
        context.logger.debug(`Error resolving symbol for usage target: ${identifier.getText()}`, { error: e });
        return null;
    }
}


/**
 * Analyzes a node's body for identifier usages and adds USES relationships.
 */
export function analyzeUsage(body: Node, parentNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now } = context;

    // First, find and create nodes for parameters of nested functions/lambdas
    processNestedFunctionParams(body, parentNode, context);

    try {
        const identifiers = body.getDescendantsOfKind(SyntaxKind.Identifier);
        const localDeclarations = getLocalDeclarations(body, context); // Pass context here

        for (const identifier of identifiers) {
            const name = identifier.getText();
            const startLine = identifier.getStartLineNumber();
            const column = identifier.getStart() - identifier.getStartLinePos();

            // Skip declarations, property access names, locals, keywords, etc.
            // Removed localDeclarations check for now, relying on symbol resolution
            if (isDeclarationOrNameContext(identifier) || name === 'this') {
                continue;
            }

            // Attempt to resolve the target declaration
            const targetInfo = getTargetDeclarationInfo(identifier, context);

            let targetEntityId: string;
            let targetName: string;
            let properties: Record<string, any> = {
                startLine,
                column,
                isPlaceholder: true,
            };

            if (targetInfo) {
                // Generate entityId based on resolved info
                // Use the entityId returned by getTargetDeclarationInfo, which handles parameters specifically
                targetEntityId = targetInfo.entityId;
                targetName = targetInfo.name;
                properties.targetName = targetName;
                properties.targetFilePath = targetInfo.filePath;
                properties.targetKind = targetInfo.kind;
                properties.resolutionHint = 'symbol_declaration';
            } else {
                // Fallback if symbol resolution fails
                targetName = name; // Use the identifier text
                const qualifiedTargetName = `${parentNode.filePath}:${targetName}`; // Simplistic hint
                targetEntityId = generateEntityId('unknown_usage_target', qualifiedTargetName);
                properties.targetName = targetName;
                properties.qualifiedName = qualifiedTargetName;
                properties.resolutionHint = 'text_fallback';
                logger.debug(`Symbol resolution failed for usage target: ${targetName} in ${parentNode.filePath}`);
            }

            if (!targetName) continue;

            const relEntityId = generateEntityId('uses', `${parentNode.entityId}:${targetEntityId}`);

            addRelationship({
                id: generateId('uses', `${parentNode.id}:${targetEntityId}`, { line: startLine, column }),
                entityId: relEntityId,
                type: 'USES',
                sourceId: parentNode.entityId,
                targetId: targetEntityId, // Use potentially resolved entityId
                weight: 6,
                properties,
                createdAt: now,
            });
        }
    } catch (e) {
        logger.warn(`Error analyzing usage in ${parentNode.filePath} for ${parentNode.name}`, { error: e });
    }
}