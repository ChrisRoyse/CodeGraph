import { SourceFile, ExportDeclaration } from 'ts-morph';
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces

// --- Main Module Parsing Function ---
export function parseModules(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now, resolveImportPath } = context;

    // --- Imports ---
    const importDeclarations = sourceFile.getImportDeclarations();
    logger.debug(`Found ${importDeclarations.length} imports in ${fileNode.name}`);

    for (const declaration of importDeclarations) {
        try {
            const moduleSpecifier = declaration.getModuleSpecifierValue();
            if (!moduleSpecifier) continue;

            const importPath = resolveImportPath(fileNode.filePath, moduleSpecifier);
            const targetFileEntityId = generateEntityId('file', importPath); // Target is the file itself
            const relEntityId = generateEntityId('imports', `${fileNode.entityId}:${targetFileEntityId}`);

            addRelationship({
                id: generateId('imports', `${fileNode.id}:${importPath}`),
                entityId: relEntityId,
                type: 'IMPORTS',
                sourceId: fileNode.entityId,
                targetId: targetFileEntityId, // Placeholder entity ID for the file
                weight: 8,
                properties: {
                    importPath, moduleSpecifier,
                    isExternal: !moduleSpecifier.startsWith('.'),
                    startLine: declaration.getStartLineNumber(),
                    isPlaceholder: true, // File might not be parsed yet
                },
                createdAt: now,
            });
            // Named imports are handled by USES relationships via analyzeUsage in the main parser or a dedicated analyzer
        } catch (e) { logger.warn(`Error parsing import in ${fileNode.filePath}`, { error: e }); }
    }

    // --- Exports ---
    const exportDeclarations = sourceFile.getExportDeclarations();
    logger.debug(`Found ${exportDeclarations.length} exports in ${fileNode.name}`);

    for (const declaration of exportDeclarations) {
        try {
            const moduleSpecifier = declaration.getModuleSpecifierValue();

            if (moduleSpecifier) {
                // Re-export from another module (e.g., export * from './other')
                const exportPath = resolveImportPath(fileNode.filePath, moduleSpecifier);
                const targetFileEntityId = generateEntityId('file', exportPath);
                const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetFileEntityId}`);

                addRelationship({
                    id: generateId('exports', `${fileNode.id}:${exportPath}`),
                    entityId: relEntityId,
                    type: 'EXPORTS', // File -> File export
                    sourceId: fileNode.entityId,
                    targetId: targetFileEntityId, // Placeholder entity ID for the file
                    weight: 8,
                    properties: {
                        exportPath, moduleSpecifier,
                        isExternal: !moduleSpecifier.startsWith('.'),
                        startLine: declaration.getStartLineNumber(),
                        isPlaceholder: true,
                    },
                    createdAt: now,
                });
            } else {
                // Named exports (e.g., export { name1, name2 })
                const namedExports = declaration.getNamedExports();
                for (const namedExport of namedExports) {
                    const name = namedExport.getNameNode().getText();
                    const alias = namedExport.getAliasNode()?.getText();
                    // We need to find the entity being exported. This requires looking up the name
                    // in the current file's context, which is complex here.
                    // For simplicity now, create a placeholder relationship.
                    // The relationship resolver should handle connecting this correctly later.
                    const qualifiedName = `${fileNode.filePath}:${name}`; // Placeholder qualified name
                    const targetEntityId = generateEntityId('unknown_export', qualifiedName); // Placeholder target
                    const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetEntityId}`);

                    addRelationship({
                        id: generateId('exports', `${fileNode.id}:${qualifiedName}`),
                        entityId: relEntityId,
                        type: 'EXPORTS',
                        sourceId: fileNode.entityId,
                        targetId: targetEntityId, // Placeholder
                        weight: 8,
                        properties: {
                            exportName: name,
                            alias: alias || undefined,
                            qualifiedName: qualifiedName, // Hint for resolver
                            startLine: namedExport.getStartLineNumber(),
                            isPlaceholder: true,
                        },
                        createdAt: now,
                    });
                }
            }
        } catch (e) { logger.warn(`Error parsing export declaration in ${fileNode.filePath}`, { error: e }); }
    }

     // Default export (e.g., export default function() {})
     const defaultExport = sourceFile.getDefaultExportSymbol();
     if (defaultExport) {
         try {
             const declaration = defaultExport.getValueDeclaration();
             if (declaration) {
                 const name = 'default'; // Standard name for default export
                 // Find the corresponding node already created in this file's results
                 // This requires searching result.nodes which isn't ideal in a modular parser.
                 // Create a placeholder relationship for now. Resolver needs to handle this.
                 const targetEntityId = generateEntityId('unknown_default_export', `${fileNode.filePath}:default`);
                 const relEntityId = generateEntityId('exports', `${fileNode.entityId}:${targetEntityId}:default`);

                 addRelationship({
                     id: generateId('exports', `${fileNode.id}:${targetEntityId}:default`),
                     entityId: relEntityId,
                     type: 'EXPORTS',
                     sourceId: fileNode.entityId,
                     targetId: targetEntityId, // Placeholder
                     weight: 8,
                     properties: {
                         exportName: name,
                         isDefaultExport: true,
                         startLine: declaration.getStartLineNumber(),
                         isPlaceholder: true,
                     },
                     createdAt: now,
                 });
             }
         } catch (e) { logger.warn(`Error parsing default export in ${fileNode.filePath}`, { error: e }); }
     }
}