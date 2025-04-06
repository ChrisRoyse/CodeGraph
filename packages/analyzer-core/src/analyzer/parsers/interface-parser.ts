import { InterfaceDeclaration, MethodSignature, PropertySignature, Node, ts } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getVisibility, getJsDocText, getFunctionReturnType } from '../../utils/ts-helpers.js';
// Assuming complexity calculation isn't typically done for interface methods
// import { calculateCyclomaticComplexity } from '../analysis/complexity-analyzer.js';
import { parseParameters } from './parameter-parser.js'; // For method parameters

const { SyntaxKind } = ts;

/**
 * Parses InterfaceDeclarations within a source file to create Interface and Method nodes
 * and HAS_METHOD relationships (Pass 1).
 * @param context - The parser context for the current file.
 */
export function parseInterfaces(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, generateId, generateEntityId, logger, now } = context;
    const interfaces = sourceFile.getInterfaces();

    logger.debug(`Found ${interfaces.length} interfaces in ${fileNode.name}`);

    for (const declaration of interfaces) {
        try {
            const name = declaration.getName() || 'AnonymousInterface';
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('interface', qualifiedName);
            const docs = getJsDocText(declaration);

            const interfaceNode: AstNode = {
                id: generateId('interface', qualifiedName),
                entityId,
                kind: 'Interface',
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
                // memberProperties will be populated if parseInterfaceProperties is called
                createdAt: now,
            };
            addNode(interfaceNode);

            // Parse members (method signatures, property signatures)
            parseInterfaceMethods(declaration, interfaceNode, context);
            // parseInterfaceProperties(declaration, interfaceNode, context); // Optional

            // Note: Inheritance (EXTENDS) is handled in Pass 2

        } catch (e: any) {
            logger.warn(`Error parsing interface ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { message: e.message });
        }
    }
}

/**
 * Parses MethodSignatures within an InterfaceDeclaration (Pass 1).
 * Creates Method nodes (representing the signature) and HAS_METHOD relationships.
 */
function parseInterfaceMethods(interfaceDeclaration: InterfaceDeclaration, interfaceNode: AstNode, context: ParserContext): void {
    const { addNode, addRelationship, generateId, generateEntityId, generateRelationshipId, logger, now } = context;
    const methods = interfaceDeclaration.getMethods(); // Gets MethodSignatures

    for (const signature of methods) { // signature is MethodSignature
        try {
            const name = signature.getName() || 'anonymousMethodSig';
            // Qualified name includes interface name
            const qualifiedName = `${interfaceNode.filePath}:${interfaceNode.name}.${name}`;
            // Treat MethodSignature as a Method node for graph consistency
            const entityId = generateEntityId('method', qualifiedName);
            const docs = getJsDocText(signature);
            const returnType = getFunctionReturnType(signature); // Use helper

            const methodNode: AstNode = {
                id: generateId('method', qualifiedName), // Use 'method' prefix
                entityId,
                kind: 'Method',
                name,
                filePath: interfaceNode.filePath, // Belongs to the interface's file
                language: 'TypeScript', // Add language property
                startLine: signature.getStartLineNumber(), endLine: signature.getEndLineNumber(),
                startColumn: signature.getStart() - signature.getStartLinePos(), endColumn: getEndColumn(signature),
                loc: signature.getEndLineNumber() - signature.getStartLineNumber() + 1,
                // Complexity doesn't apply to signatures
                documentation: docs || undefined, docComment: docs,
                // Visibility/Static/Async don't apply to interface methods
                returnType: returnType,
                properties: { parentId: interfaceNode.entityId, isSignature: true }, // Mark as signature, link parent
                createdAt: now,
            };
            addNode(methodNode);

            // Add HAS_METHOD relationship (Interface -> Method)
            const hasMethodRelEntityId = generateEntityId('has_method', `${interfaceNode.entityId}:${methodNode.entityId}`);
            addRelationship({
                id: generateId('has_method', `${interfaceNode.id}:${methodNode.id}`),
                entityId: hasMethodRelEntityId,
                relationshipId: generateRelationshipId(interfaceNode.entityId, methodNode.entityId, 'HAS_METHOD'),
                type: 'HAS_METHOD',
                sourceId: interfaceNode.entityId,
                targetId: methodNode.entityId,
                weight: 10,
                createdAt: now,
            });

            // Parse parameters for this method signature
            parseParameters(signature, methodNode, context);

        } catch (e: any) {
            logger.warn(`Error parsing method signature ${signature.getName() ?? 'anonymous'} in interface ${interfaceNode.name} (${interfaceNode.filePath})`, { message: e.message });
        }
    }
}

// Optional: Function to parse PropertySignatures if needed
/*
function parseInterfaceProperties(interfaceDeclaration: InterfaceDeclaration, interfaceNode: AstNode, context: ParserContext): void {
    const { logger, now } = context;
    const properties = interfaceDeclaration.getProperties(); // Gets PropertySignatures

    if (!interfaceNode.memberProperties) {
        interfaceNode.memberProperties = [];
    }

    for (const signature of properties) { // signature is PropertySignature
        try {
            const name = signature.getName() || 'anonymousPropSig';
            const docs = getJsDocText(signature);

            interfaceNode.memberProperties.push({
                name,
                type: signature.getType().getText() || 'any',
                // visibility: undefined, // Not applicable
                // isStatic: undefined, // Not applicable
                // isReadonly: signature.isReadonly(), // Add if needed
            });

            // Optionally create separate Variable nodes for properties if needed
            // const qualifiedName = `${interfaceNode.filePath}:${interfaceNode.name}.${name}`;
            // const entityId = generateEntityId('variable', qualifiedName); // Or 'property'?
            // ... create AstNode ...
            // addNode(propertyNode);
            // ... add HAS_PROPERTY relationship ...

        } catch (e: any) {
            logger.warn(`Error parsing property signature ${signature.getName() ?? 'anonymous'} in interface ${interfaceNode.name} (${interfaceNode.filePath})`, { message: e.message });
        }
    }
}
*/