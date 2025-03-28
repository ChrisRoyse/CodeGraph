import { InterfaceDeclaration, Node, MethodSignature, PropertySignature } from 'ts-morph';
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces
import { getEndColumn, getJsDocText } from '../../utils/ts-helpers'; // Use relative path and helpers

// Reusable function to extract parameters from MethodSignature
function extractParameters(node: MethodSignature): { name: string; type: string }[] {
    try {
        return node.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText() || 'any'
        }));
    } catch {
        return [];
    }
}

// --- Main Interface Parsing Function ---
export function parseInterfaces(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const interfaces = sourceFile.getInterfaces();

    logger.debug(`Found ${interfaces.length} interfaces in ${fileNode.name}`);

    for (const declaration of interfaces) {
        try {
            const name = declaration.getName() || 'AnonymousInterface';
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('interface', qualifiedName);
            const docs = getJsDocText(declaration); // Use helper

            // Initialize memberProperties array
            const memberProperties: AstNode['memberProperties'] = [];

            const node: AstNode = {
                id: generateId('interface', qualifiedName),
                entityId,
                kind: 'Interface', name, filePath: fileNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                memberProperties, // Add empty array
                createdAt: now,
            };
            addNode(node); // Add interface node first

            // CONTAINS relationship (File -> Interface)
            addRelationship({
                id: generateId('contains', `${fileNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${fileNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: fileNode.entityId, targetId: node.entityId,
                weight: 5, createdAt: now,
            });

            // Parse members (signatures)
            parseInterfaceMethods(declaration, node, context); // Methods still create separate nodes
            parseInterfaceProperties(declaration, node, context); // Properties added to node.memberProperties

            // Parse inheritance (EXTENDS)
            parseInterfaceInheritance(declaration, node, context);

        } catch (e) { logger.warn(`Error parsing interface ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { error: e }); }
    }
}

// --- Helper Functions for Interface Members and Inheritance ---

function parseInterfaceMethods(interfaceDeclaration: InterfaceDeclaration, interfaceNode: AstNode, context: ParserContext): void {
    const { addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const methods = interfaceDeclaration.getMethods(); // MethodSignatures

    for (const declaration of methods) {
        try {
            const name = declaration.getName() || 'anonymousMethodSig';
            const qualifiedName = `${interfaceNode.filePath}:${interfaceNode.name}.${name}`;
            const entityId = generateEntityId('method', qualifiedName); // Use 'method' kind for consistency
            const docs = getJsDocText(declaration); // Use helper
            const parameters = extractParameters(declaration);
            const returnType = declaration.getReturnType().getText();

            const node: AstNode = {
                id: generateId('method', qualifiedName), // Use 'method' kind
                entityId,
                kind: 'Method', // Treat signature as Method for graph consistency
                name, filePath: interfaceNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                parameterTypes: parameters, returnType: returnType,
                createdAt: now,
            };
            addNode(node);

            // CONTAINS relationship (Interface -> Method)
            addRelationship({
                id: generateId('contains', `${interfaceNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${interfaceNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: interfaceNode.entityId, targetId: node.entityId,
                weight: 2, createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing interface method ${declaration.getName() ?? 'anonymous'} in ${interfaceNode.filePath}`, { error: e }); }
    }
}

// Modified to add properties to the parent node instead of creating separate nodes
function parseInterfaceProperties(interfaceDeclaration: InterfaceDeclaration, interfaceNode: AstNode, context: ParserContext): void {
    const { logger, now } = context; // No need for addNode or addRelationship
    const properties = interfaceDeclaration.getProperties(); // PropertySignatures

    if (!interfaceNode.memberProperties) { // Ensure array exists
        interfaceNode.memberProperties = [];
    }

    for (const declaration of properties) {
        try {
            const name = declaration.getName() || 'anonymousPropertySig';
            const docs = getJsDocText(declaration); // Use helper

            // Add property details to the parent interface node's array
            interfaceNode.memberProperties.push({
                name,
                type: declaration.getType().getText(),
                // Visibility/Static not applicable to interface properties
                isReadonly: declaration.isReadonly(),
                startLine: declaration.getStartLineNumber(),
                endLine: declaration.getEndLineNumber(),
                documentation: docs || undefined,
            });
        } catch (e) { logger.warn(`Error parsing interface property ${declaration.getName() ?? 'anonymous'} in ${interfaceNode.filePath}`, { error: e }); }
    }
}


function parseInterfaceInheritance(interfaceDeclaration: InterfaceDeclaration, interfaceNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, resolveImportPath } = context;
    const baseInterfaces = interfaceDeclaration.getExtends();

    for (const base of baseInterfaces) {
        try {
            const baseName = base.getText();
            let baseFilePath = interfaceNode.filePath;
            try {
                const baseSourceFile = base.getType().getSymbol()?.getDeclarations()?.[0]?.getSourceFile();
                if (baseSourceFile) baseFilePath = resolveImportPath(interfaceNode.filePath, baseSourceFile.getFilePath());
            } catch { /* Ignore */ }

            const qualifiedBaseName = `${baseFilePath}:${baseName}`;
            const baseEntityId = generateEntityId('interface', qualifiedBaseName);
            const relEntityId = generateEntityId('extends', `${interfaceNode.entityId}:${baseEntityId}`);

            addRelationship({
                id: generateId('extends', `${interfaceNode.id}:${qualifiedBaseName}`),
                entityId: relEntityId, type: 'EXTENDS', sourceId: interfaceNode.entityId, targetId: baseEntityId,
                weight: 9, properties: { baseName, qualifiedName: qualifiedBaseName, isPlaceholder: true }, createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing interface extends clause for ${interfaceNode.name}`, { error: e }); }
    }
}