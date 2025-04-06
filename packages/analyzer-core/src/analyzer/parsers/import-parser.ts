// src/analyzer/parsers/import-parser.ts
import { Node, SyntaxKind } from 'ts-morph';
import { ParserContext, AstNode, RelationshipInfo } from '../types.js';
import { getJsDocDescription } from '../../utils/ts-helpers.js'; // Assuming this helper exists

/**
 * Parses import declarations in a TypeScript source file.
 * Creates Import nodes and File->IMPORTS->Import relationships.
 */
export function parseImports(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, addRelationship, generateId, generateEntityId, generateRelationshipId, logger, now } = context;

    const importDeclarations = sourceFile.getImportDeclarations();
    logger.debug(`Found ${importDeclarations.length} import declarations in ${fileNode.name}`);

    for (const declaration of importDeclarations) {
        try {
            const moduleSpecifier = declaration.getModuleSpecifierValue() ?? 'unknown_module';
            const startLine = declaration.getStartLineNumber();
            const endLine = declaration.getEndLineNumber();

            // Create a unique name/identifier for the import node itself
            // Using module specifier and line number for uniqueness within the file
            const importName = `${moduleSpecifier}:${startLine}`;
            const qualifiedName = `${fileNode.filePath}:${importName}`;
            const entityId = generateEntityId('import', qualifiedName); // Use 'import' kind

            // Extract named imports, default import, namespace import
            const namedImports = declaration.getNamedImports().map(ni => ni.getName());
            const defaultImport = declaration.getDefaultImport()?.getText();
            const namespaceImport = declaration.getNamespaceImport()?.getText();

            const importNode: AstNode = { // Consider creating a specific ImportNode type if more props needed
                id: generateId('import', qualifiedName, { line: startLine }),
                entityId: entityId,
                kind: 'Import',
                name: importName, // Use combined name
                filePath: fileNode.filePath,
                language: 'TypeScript', // Or TSX based on fileNode?
                startLine: startLine,
                endLine: endLine,
                startColumn: declaration.getStart() - declaration.getStartLinePos(),
                endColumn: declaration.getEnd() - declaration.getStartLinePos(), // Adjust if needed
                properties: {
                    moduleSpecifier: moduleSpecifier,
                    namedImports: namedImports.length > 0 ? namedImports : undefined,
                    defaultImport: defaultImport,
                    namespaceImport: namespaceImport,
                    isTypeOnly: declaration.isTypeOnly(),
                },
                documentation: getJsDocDescription(declaration), // Get JSDoc if available
                createdAt: now,
            };
            addNode(importNode);

            // Create relationship: File IMPORTS ImportNode
            const relEntityId = generateEntityId('imports', `${fileNode.entityId}:${entityId}`);
            const importRel: RelationshipInfo = {
                id: generateId('imports', `${fileNode.id}:${importNode.id}`),
                entityId: relEntityId,
                relationshipId: generateRelationshipId(fileNode.entityId, entityId, 'IMPORTS'),
                type: 'IMPORTS',
                sourceId: fileNode.entityId,
                targetId: entityId,
                weight: 1, // Adjust weight as needed
                createdAt: now,
            };
            addRelationship(importRel);
            // logger.debug(`Added Import node for "${moduleSpecifier}" and IMPORTS relationship from ${fileNode.name}`);

        } catch (error: any) {
            logger.warn(`Failed to process import declaration at line ${declaration.getStartLineNumber()} in ${fileNode.filePath}: ${error.message}`);
        }
    }
}