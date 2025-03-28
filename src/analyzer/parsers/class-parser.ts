import { ClassDeclaration, Node, MethodDeclaration, PropertyDeclaration } from 'ts-morph';
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces
import { getEndColumn, getVisibility, getJsDocText } from '../../utils/ts-helpers'; // Use relative path

// Import analysis helpers
import { analyzeCalls } from '../analysis/call-analyzer';
import { analyzeUsage } from '../analysis/usage-analyzer';
import { analyzeControlFlow } from '../analysis/control-flow-analyzer';
import { analyzeAssignments } from '../analysis/assignment-analyzer';


// Reusable function to extract parameters
function extractParameters(node: MethodDeclaration): { name: string; type: string }[] {
    try {
        return node.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText() || 'any'
        }));
    } catch {
        return [];
    }
}

// --- Main Class Parsing Function ---
export function parseClasses(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const classes = sourceFile.getClasses();

    logger.debug(`Found ${classes.length} classes in ${fileNode.name}`);

    for (const declaration of classes) {
        try {
            const name = declaration.getName() || 'AnonymousClass';
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('class', qualifiedName);
            const docs = getJsDocText(declaration); // Use helper

            // Initialize memberProperties array
            const memberProperties: AstNode['memberProperties'] = [];

            const node: AstNode = {
                id: generateId('class', qualifiedName),
                entityId,
                kind: 'Class', name, filePath: fileNode.filePath,
                startLine: declaration.getStartLineNumber(),
                endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(),
                endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                memberProperties, // Add the empty array initially
                createdAt: now,
                // Add semantic properties later if needed
            };
            addNode(node); // Add the class node first

            // CONTAINS relationship (File -> Class)
            addRelationship({
                id: generateId('contains', `${fileNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${fileNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: fileNode.entityId, targetId: node.entityId,
                weight: 5, createdAt: now,
            });

            // Parse members and add properties to the class node's memberProperties array
            parseClassMethods(declaration, node, context); // Methods still create separate nodes
            parseClassProperties(declaration, node, context); // Properties are now added to node.memberProperties

            // Parse inheritance (EXTENDS, IMPLEMENTS)
            parseClassInheritance(declaration, node, context);

        } catch (e) { logger.warn(`Error parsing class ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { error: e }); }
    }
}

// --- Helper Functions for Class Members and Inheritance ---

function parseClassMethods(classDeclaration: ClassDeclaration, classNode: AstNode, context: ParserContext): void {
    const { addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    const methods = classDeclaration.getMethods();

    for (const declaration of methods) {
        try {
            const name = declaration.getName() || 'anonymousMethod';
            const qualifiedName = `${classNode.filePath}:${classNode.name}.${name}`;
            const entityId = generateEntityId('method', qualifiedName);
            const docs = getJsDocText(declaration); // Use helper
            const parameters = extractParameters(declaration);
            const returnType = declaration.getReturnType().getText();

            const node: AstNode = {
                id: generateId('method', qualifiedName),
                entityId,
                kind: 'Method', name, filePath: classNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                visibility: getVisibility(declaration), // Use helper
                isStatic: declaration.isStatic(), isAsync: declaration.isAsync(),
                parameterTypes: parameters, returnType: returnType,
                createdAt: now,
            };
            addNode(node);

            // CONTAINS relationship (Class -> Method)
            addRelationship({
                id: generateId('contains', `${classNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${classNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: classNode.entityId, targetId: node.entityId,
                weight: 2, createdAt: now,
            });

            // Analyze body
            const body = declaration.getBody();
            if (body) {
                analyzeCalls(body, node, context); // Uncommented
                analyzeUsage(body, node, context); // Uncommented
                analyzeControlFlow(body, node, context); // Uncommented
                analyzeAssignments(body, node, context); // Uncommented
            }
        } catch (e) { logger.warn(`Error parsing method ${declaration.getName() ?? 'anonymous'} in ${classNode.filePath}`, { error: e }); }
    }
}

// Modified to add properties to the parent node instead of creating separate nodes
function parseClassProperties(classDeclaration: ClassDeclaration, classNode: AstNode, context: ParserContext): void {
    const { logger, now } = context; // No need for addNode or addRelationship here
    const properties = classDeclaration.getProperties();

    if (!classNode.memberProperties) { // Ensure array exists
        classNode.memberProperties = [];
    }

    for (const declaration of properties) {
        try {
            const name = declaration.getName() || 'anonymousProperty';
            const docs = getJsDocText(declaration); // Use helper

            // Add property details to the parent class node's array
            classNode.memberProperties.push({
                name,
                type: declaration.getType().getText(),
                visibility: getVisibility(declaration), // Use helper
                isStatic: declaration.isStatic(),
                isReadonly: declaration.isReadonly(),
                startLine: declaration.getStartLineNumber(),
                endLine: declaration.getEndLineNumber(),
                documentation: docs || undefined,
            });

        } catch (e) { logger.warn(`Error parsing property ${declaration.getName() ?? 'anonymous'} in ${classNode.filePath}`, { error: e }); }
    }
}


function parseClassInheritance(classDeclaration: ClassDeclaration, classNode: AstNode, context: ParserContext): void {
    const { addRelationship, generateId, generateEntityId, logger, now, resolveImportPath } = context;

    // Extends
    const baseClass = classDeclaration.getBaseClass();
    if (baseClass) {
        try {
            const baseClassName = baseClass.getText();
            let baseClassFilePath = classNode.filePath;
            try {
                const baseSourceFile = baseClass.getSymbol()?.getDeclarations()?.[0]?.getSourceFile();
                if (baseSourceFile) baseClassFilePath = resolveImportPath(classNode.filePath, baseSourceFile.getFilePath());
            } catch { /* Ignore */ }

            const qualifiedBaseName = `${baseClassFilePath}:${baseClassName}`;
            const baseEntityId = generateEntityId('class', qualifiedBaseName);
            const relEntityId = generateEntityId('extends', `${classNode.entityId}:${baseEntityId}`);

            addRelationship({
                id: generateId('extends', `${classNode.id}:${qualifiedBaseName}`),
                entityId: relEntityId, type: 'EXTENDS', sourceId: classNode.entityId, targetId: baseEntityId,
                weight: 9, properties: { baseName: baseClassName, qualifiedName: qualifiedBaseName, isPlaceholder: true }, createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing extends clause for ${classNode.name}`, { error: e }); }
    }

    // Implements
    const implementedInterfaces = classDeclaration.getImplements();
    for (const impl of implementedInterfaces) {
        try {
            const interfaceName = impl.getText();
            let interfaceFilePath = classNode.filePath;
            try {
                const interfaceSourceFile = impl.getType().getSymbol()?.getDeclarations()?.[0]?.getSourceFile();
                if (interfaceSourceFile) interfaceFilePath = resolveImportPath(classNode.filePath, interfaceSourceFile.getFilePath());
            } catch { /* Ignore */ }

            const qualifiedInterfaceName = `${interfaceFilePath}:${interfaceName}`;
            const interfaceEntityId = generateEntityId('interface', qualifiedInterfaceName);
            const relEntityId = generateEntityId('implements', `${classNode.entityId}:${interfaceEntityId}`);

            addRelationship({
                id: generateId('implements', `${classNode.id}:${qualifiedInterfaceName}`),
                entityId: relEntityId, type: 'IMPLEMENTS', sourceId: classNode.entityId, targetId: interfaceEntityId,
                weight: 9, properties: { interfaceName, qualifiedName: qualifiedInterfaceName, isPlaceholder: true }, createdAt: now,
            });
        } catch (e) { logger.warn(`Error parsing implements clause for ${classNode.name}`, { error: e }); }
    }
}