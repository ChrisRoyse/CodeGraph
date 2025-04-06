import { ClassDeclaration, MethodDeclaration, PropertyDeclaration, Node, ts } from 'ts-morph';
import { AstNode, ParserContext } from '../types.js';
import { getEndColumn, getVisibility, getJsDocText } from '../../utils/ts-helpers.js'; // Assuming ts-helpers.ts will be created
import { calculateCyclomaticComplexity } from '../analysis/complexity-analyzer.js'; // Assuming complexity-analyzer.ts will be created
import { parseParameters } from './parameter-parser.js'; // Assuming parameter-parser.ts will be created

const { SyntaxKind } = ts;

/**
 * Parses ClassDeclarations within a source file to create Class and Method nodes
 * and HAS_METHOD relationships (Pass 1).
 * @param context - The parser context for the current file.
 */
export function parseClasses(context: ParserContext): void {
    const { sourceFile, fileNode, addNode, generateId, generateEntityId, generateRelationshipId, logger, now } = context;
    const classes = sourceFile.getClasses();

    logger.debug(`Found ${classes.length} classes in ${fileNode.name}`);

    for (const declaration of classes) {
        try {
            const name = declaration.getName() || 'AnonymousClass';
            // Define a consistent qualified name for entity ID generation
            const qualifiedName = `${fileNode.filePath}:${name}`;
            const entityId = generateEntityId('class', qualifiedName);
            const docs = getJsDocText(declaration);
 // Existing doc extraction
             const isAbstract = declaration.isAbstract();
             const implementsClauses = declaration.getImplements();
             const implementsInterfaces = implementsClauses.map(impl => impl.getText());
             const modifiers = declaration.getModifiers() ?? [];
             const modifierFlags = modifiers.map(mod => mod.getText());
             // Extract JSDoc tags
             const jsDocs = declaration.getJsDocs();
             let tags: string[] = [];
             if (jsDocs.length > 0) {
                 const lastJsDoc = jsDocs[jsDocs.length - 1];
                 tags = lastJsDoc!.getTags().map(tag => tag.getTagName()); // Use non-null assertion
             }

            const classNode: AstNode = {
                id: generateId('class', qualifiedName),
                entityId,
                kind: 'Class',
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
                 isAbstract: isAbstract,
                 implementsInterfaces: implementsInterfaces.length > 0 ? implementsInterfaces : undefined,
                 tags: tags.length > 0 ? tags : undefined,
                 modifierFlags: modifierFlags.length > 0 ? modifierFlags : undefined,
                // memberProperties will be populated by parseClassProperties if called
                createdAt: now,
            };
            addNode(classNode);

            // Parse members (methods, properties)
            parseClassMethods(declaration, classNode, context);
            // parseClassProperties(declaration, classNode, context); // Optionally parse properties

            // Note: Inheritance (EXTENDS, IMPLEMENTS) is handled in Pass 2

        } catch (e: any) {
            logger.warn(`Error parsing class ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { message: e.message });
        }
    }
}

/**
 * Parses MethodDeclarations within a ClassDeclaration (Pass 1).
 */
function parseClassMethods(classDeclaration: ClassDeclaration, classNode: AstNode, context: ParserContext): void {
    const { addNode, addRelationship, generateId, generateEntityId, generateRelationshipId, logger, now } = context;
    const methods = classDeclaration.getMethods();

    for (const declaration of methods) {
        try {
            const name = declaration.getName() || 'anonymousMethod';
            // Qualified name includes class name for uniqueness
            const qualifiedName = `${classNode.filePath}:${classNode.name}.${name}`;
            const entityId = generateEntityId('method', qualifiedName);
            const docs = getJsDocText(declaration);
            const returnType = declaration.getReturnType().getText() || 'any';
            const complexity = calculateCyclomaticComplexity(declaration); // Calculate complexity

            const methodNode: AstNode = {
                id: generateId('method', qualifiedName),
                entityId,
                kind: 'Method',
                name,
                filePath: classNode.filePath,
                language: 'TypeScript', // Add language property
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                loc: declaration.getEndLineNumber() - declaration.getStartLineNumber() + 1,
                complexity: complexity,
                documentation: docs || undefined, docComment: docs,
                accessModifier: getVisibility(declaration), // Correct property name
                isStatic: declaration.isStatic(), isAsync: declaration.isAsync(),
                returnType: returnType,
                properties: { parentId: classNode.entityId }, // Store parent ID
                createdAt: now,
            };
            addNode(methodNode);

            // Add HAS_METHOD relationship (Intra-file)
            const hasMethodRelEntityId = generateEntityId('has_method', `${classNode.entityId}:${methodNode.entityId}`);
            addRelationship({
                id: generateId('has_method', `${classNode.id}:${methodNode.id}`),
                entityId: hasMethodRelEntityId,
                relationshipId: generateRelationshipId(classNode.entityId, methodNode.entityId, 'HAS_METHOD'),
                type: 'HAS_METHOD',
                sourceId: classNode.entityId,
                targetId: methodNode.entityId,
                weight: 10, // High weight for structural containment
                createdAt: now,
            });

            // Parse parameters for this method
            parseParameters(declaration, methodNode, context);

            // Note: Body analysis (CALLS, MUTATES_STATE, etc.) is done in AstParser after all nodes are created

        } catch (e: any) {
            logger.warn(`Error parsing method ${declaration.getName() ?? 'anonymous'} in class ${classNode.name} (${classNode.filePath})`, { message: e.message });
        }
    }
}

// Optional: Function to parse properties if needed in Pass 1
/*
function parseClassProperties(classDeclaration: ClassDeclaration, classNode: AstNode, context: ParserContext): void {
    const { logger, now } = context;
    const properties = classDeclaration.getProperties();

    if (!classNode.memberProperties) {
        classNode.memberProperties = [];
    }

    for (const declaration of properties) {
        try {
            const name = declaration.getName() || 'anonymousProperty';
            const docs = getJsDocText(declaration);

            // Create a simple representation for the property list on the class node
            classNode.memberProperties.push({
                name,
                type: declaration.getType().getText() || 'any',
                visibility: getVisibility(declaration),
                isStatic: declaration.isStatic(),
                // isReadonly: declaration.isReadonly(), // Add if needed
                // startLine: declaration.getStartLineNumber(), // Add if needed
                // endLine: declaration.getEndLineNumber(), // Add if needed
                // documentation: docs || undefined, // Add if needed
            });

            // Optionally create separate Variable nodes for properties if needed for detailed analysis
            // const qualifiedName = `${classNode.filePath}:${classNode.name}.${name}`;
            // const entityId = generateEntityId('variable', qualifiedName); // Or 'property' kind?
            // ... create AstNode for property ...
            // addNode(propertyNode);
            // ... add HAS_PROPERTY relationship ...

        } catch (e: any) {
             logger.warn(`Error parsing property ${declaration.getName() ?? 'anonymous'} in class ${classNode.name} (${classNode.filePath})`, { message: e.message });
        }
    }
}
*/