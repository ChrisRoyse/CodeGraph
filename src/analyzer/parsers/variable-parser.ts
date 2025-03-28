import { VariableDeclaration, Node, SyntaxKind } from 'ts-morph';
 // Import SyntaxKind
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces
import { getEndColumn } from '../../utils/ts-helpers'; // To be created

// Reusable function to extract documentation comments (if needed, or import from a shared util)
function extractDocComment(node: Node): string {
    // Basic implementation, assuming VariableDeclarations don't typically have attached JSDocs in ts-morph easily
    return '';
}

// --- Main Variable Parsing Function ---
export function parseVariables(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const variables = sourceFile.getVariableDeclarations();

    logger.debug(`Found ${variables.length} variables in ${fileNode.name}`);

    for (const declaration of variables) {
        try {
            const name = declaration.getName() || 'anonymousVariable';
            // Avoid parsing variables declared within functions/methods here, they are local scope
            if (declaration.getFirstAncestorByKind(SyntaxKind.Block)) {
                continue;
            }

            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('variable', qualifiedName);
            const docs = extractDocComment(declaration); // Likely empty

            const node: AstNode = {
                id: generateId('variable', qualifiedName),
                entityId,
                kind: 'Variable', name, filePath: fileNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                returnType: declaration.getType().getText(), // Variable type
                createdAt: now,
            };
            addNode(node);

            // CONTAINS relationship (File -> Variable)
            addRelationship({
                id: generateId('contains', `${fileNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${fileNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: fileNode.entityId, targetId: node.entityId,
                weight: 3, // Lower weight than functions/classes
                createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing variable ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { error: e }); }
    }
}