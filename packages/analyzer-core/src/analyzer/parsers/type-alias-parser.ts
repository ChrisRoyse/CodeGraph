import { TypeAliasDeclaration, EnumDeclaration, Node, ts } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getJsDocText, getNodeName } from '../../utils/ts-helpers.js';

const { SyntaxKind } = ts;

/**
 * Parses TypeAliasDeclarations and EnumDeclarations within a source file
 * to create TypeAlias nodes (Pass 1).
 * @param context - The parser context for the current file.
 */
export function parseTypeAliases(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, generateId, generateEntityId, logger, now } = context;

    // Parse Type Aliases
    const typeAliases = sourceFile.getTypeAliases();
    logger.debug(`Found ${typeAliases.length} type aliases in ${fileNode.name}`);
    for (const declaration of typeAliases) {
        try {
            const name = getNodeName(declaration, 'AnonymousTypeAlias');
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('typealias', qualifiedName); // Use lowercase 'typealias'
            const docs = getJsDocText(declaration);
            const typeText = declaration.getTypeNode()?.getText() || 'unknown'; // Get the actual type definition

            const typeAliasNode: AstNode = {
                id: generateId('typealias', qualifiedName),
                entityId,
                kind: 'TypeAlias',
                name,
                filePath: fileNode.filePath,
                language: 'TypeScript', // Add language property
                startLine: declaration.getStartLineNumber(),
                endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(),
                endColumn: getEndColumn(declaration),
                loc: declaration.getEndLineNumber() - declaration.getStartLineNumber() + 1,
                isExported: declaration.isExported(),
                documentation: docs || undefined,
                docComment: docs,
                type: typeText, // Store the type definition text
                createdAt: now,
            };
            addNode(typeAliasNode);

        } catch (e: any) {
            logger.warn(`Error parsing type alias ${declaration.getName()} in ${fileNode.filePath}`, { message: e.message });
        }
    }

    // Parse Enums (Treating them as a form of TypeAlias for simplicity in the graph)
    const enums = sourceFile.getEnums();
    logger.debug(`Found ${enums.length} enums in ${fileNode.name}`);
    for (const declaration of enums) {
         try {
            const name = getNodeName(declaration, 'AnonymousEnum');
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('typealias', qualifiedName); // Use 'typealias' kind
            const docs = getJsDocText(declaration);
            // Could store enum members in properties if needed
            // const members = declaration.getMembers().map(m => ({ name: m.getName(), value: m.getValue() }));

            const enumNode: AstNode = {
                id: generateId('typealias', qualifiedName), // Use 'typealias' prefix
                entityId,
                kind: 'TypeAlias',
                name,
                filePath: fileNode.filePath, // Use 'TypeAlias' kind
                language: 'TypeScript', // Add language property
                startLine: declaration.getStartLineNumber(),
                endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(),
                endColumn: getEndColumn(declaration),
                loc: declaration.getEndLineNumber() - declaration.getStartLineNumber() + 1,
                isExported: declaration.isExported(),
                documentation: docs || undefined,
                docComment: docs,
                properties: { isEnum: true }, // Add a flag to distinguish enums
                createdAt: now,
            };
            addNode(enumNode);

         } catch (e: any) {
             logger.warn(`Error parsing enum ${declaration.getName()} in ${fileNode.filePath}`, { message: e.message });
         }
    }
}