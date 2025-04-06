import { FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, ParameterDeclaration, Node, MethodSignature } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getNodeType, getJsDocDescription } from '../../utils/ts-helpers.js';

/**
 * Parses parameters of a function or method declaration.
 * Creates Parameter nodes and HAS_PARAMETER relationships.
 * @param declarationNode - The ts-morph node for the function/method.
 * @param parentNode - The AstNode for the owning function/method.
 * @param context - The parser context.
 */
export function parseParameters(
    declarationNode: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | MethodSignature,
    parentNode: AstNode, // The AstNode of the function/method owning the parameters
    context: ParserContext
): void {
    const { addNode, addRelationship, generateId, generateEntityId, generateRelationshipId, logger, now } = context;

    try {
        const parameters = declarationNode.getParameters();

        for (const param of parameters) {
            try {
                const name = param.getName() || 'anonymousParam';
                // Entity ID needs context from the parent function/method
                const qualifiedName = `${parentNode.entityId}:${name}`; // Use parent entityId for context
                const entityId = generateEntityId('parameter', qualifiedName);
                const type = getNodeType(param); // Use helper
                const docs = getJsDocDescription(param); // Use helper

                const paramNode: AstNode = {
                    id: generateId('parameter', qualifiedName, { line: param.getStartLineNumber(), column: param.getStart() - param.getStartLinePos() }),
                    entityId,
                    kind: 'Parameter',
                    name,
                    filePath: parentNode.filePath,
                    language: 'TypeScript', // Add language property
                    startLine: param.getStartLineNumber(), endLine: param.getEndLineNumber(),
                    startColumn: param.getStart() - param.getStartLinePos(), endColumn: getEndColumn(param),
                    loc: param.getEndLineNumber() - param.getStartLineNumber() + 1,
                    type: type,
                    documentation: docs,
                    isOptional: param.isOptional(),
                    isRestParameter: param.isRestParameter(),
                    properties: { parentId: parentNode.entityId }, // Link back to parent function/method
                    createdAt: now,
                };

                // Avoid adding duplicate nodes if analysis runs multiple times (though less likely with new structure)
                if (!context.result.nodes.some((n: AstNode) => n.entityId === entityId)) {
                    addNode(paramNode);

                    // Add HAS_PARAMETER relationship (Function/Method -> Parameter)
                    const hasParamRelEntityId = generateEntityId('has_parameter', `${parentNode.entityId}:${paramNode.entityId}`);
                    addRelationship({
                        id: generateId('has_parameter', `${parentNode.id}:${paramNode.id}`),
                        entityId: hasParamRelEntityId,
                        relationshipId: generateRelationshipId(parentNode.entityId, paramNode.entityId, 'HAS_PARAMETER'),
                        type: 'HAS_PARAMETER',
                        sourceId: parentNode.entityId,
                        targetId: paramNode.entityId,
                        weight: 8, // Parameters are important parts of a function signature
                        createdAt: now,
                    });
                }
            } catch (paramError: any) {
                logger.warn(`Error parsing parameter ${param.getName()} within ${parentNode.name} (${parentNode.filePath})`, { message: paramError.message });
            }
        }
    } catch (e: any) {
        logger.warn(`Error accessing parameters for ${parentNode.name} (${parentNode.filePath})`, { message: e.message });
    }
}