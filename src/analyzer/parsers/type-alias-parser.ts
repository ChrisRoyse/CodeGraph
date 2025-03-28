import { TypeAliasDeclaration, Node } from 'ts-morph';
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces
import { getEndColumn } from '../../utils/ts-helpers'; // To be created

// Reusable function to extract documentation comments
function extractDocComment(node: Node): string {
    try {
        if ('getJsDocs' in node && typeof (node as any).getJsDocs === 'function') {
            const jsDocs = (node as any).getJsDocs();
            return jsDocs?.map((doc: any) => doc.getText()).join('\n') || '';
        }
    } catch { /* Ignore errors */ }
    return '';
}

// --- Main Type Alias Parsing Function ---
export function parseTypeAliases(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const typeAliases = sourceFile.getTypeAliases();

    logger.debug(`Found ${typeAliases.length} type aliases in ${fileNode.name}`);

    for (const declaration of typeAliases) {
        try {
            const name = declaration.getName() || 'anonymousTypeAlias';
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('typealias', qualifiedName);
            const docs = extractDocComment(declaration);

            const node: AstNode = {
                id: generateId('typealias', qualifiedName),
                entityId,
                kind: 'TypeAlias', name, filePath: fileNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                createdAt: now,
            };
            addNode(node);

            // CONTAINS relationship (File -> TypeAlias)
            addRelationship({
                id: generateId('contains', `${fileNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${fileNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: fileNode.entityId, targetId: node.entityId,
                weight: 2, // Lower weight for type definitions
                createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing type alias ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { error: e }); }
    }
}