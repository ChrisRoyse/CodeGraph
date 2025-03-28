import { FunctionDeclaration, Node, SyntaxKind } from 'ts-morph'; // Added SyntaxKind
import { AstNode, RelationshipInfo, ParserContext } from '../parser'; // Import shared interfaces
import { getEndColumn, getJsDocText } from '../../utils/ts-helpers'; // Use relative path

// Import analysis helpers
import { analyzeCalls } from '../analysis/call-analyzer';
import { analyzeUsage } from '../analysis/usage-analyzer';
import { analyzeControlFlow } from '../analysis/control-flow-analyzer';
// import { analyzeAssignments } from '../analysis/assignment-analyzer'; // Assignments less relevant for standalone functions

// Reusable function to extract parameters
function extractParameters(node: FunctionDeclaration): { name: string; type: string }[] {
    try {
        return node.getParameters().map(p => ({
            name: p.getName(),
            type: p.getType().getText() || 'any'
        }));
    } catch {
        return [];
    }
}

// --- Main Function Parsing Function ---
export function parseFunctions(context: ParserContext): void {
    const { sourceFile, fileNode, result, addNode, addRelationship, generateId, generateEntityId, logger, now } = context;
    // Include FunctionExpressions if needed, for now just declarations
    const functions = sourceFile.getFunctions(); // Consider sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration) for broader scope if needed

    logger.debug(`Found ${functions.length} functions in ${fileNode.name}`);

    for (const declaration of functions) {
        try {
            const name = declaration.getName() || 'anonymousFunction';
            const qualifiedName = `${fileNode.filePath}:${name}:${declaration.getStartLineNumber()}`; // Add line number for potential overloads/duplicates
            const entityId = generateEntityId('function', qualifiedName);
            const docs = getJsDocText(declaration); // Use helper
            const parameters = extractParameters(declaration);
            const returnType = declaration.getReturnType().getText();

            const node: AstNode = {
                id: generateId('function', qualifiedName),
                entityId,
                kind: 'Function', name, filePath: fileNode.filePath,
                startLine: declaration.getStartLineNumber(), endLine: declaration.getEndLineNumber(),
                startColumn: declaration.getStart() - declaration.getStartLinePos(), endColumn: getEndColumn(declaration),
                documentation: docs || undefined, docComment: docs,
                isAsync: declaration.isAsync(),
                // parameterTypes: parameters, // Store simple info if still needed
                returnType: returnType,
                createdAt: now,
                // Add semantic properties later if needed
            };
            addNode(node);

            // CONTAINS relationship (File -> Function)
            addRelationship({
                id: generateId('contains', `${fileNode.id}:${node.id}`),
                entityId: generateEntityId('contains', `${fileNode.entityId}:${node.entityId}`),
                type: 'CONTAINS', sourceId: fileNode.entityId, targetId: node.entityId,
                weight: 5, createdAt: now,
            });

            // --- Create Parameter Nodes ---
            const parameterDeclarations = declaration.getParameters();
            logger.debug(`Processing ${parameterDeclarations.length} parameters for function ${name}`);
            for (const param of parameterDeclarations) {
                try {
                    const paramName = param.getName();
                    const paramType = param.getType().getText() || 'any';
                    // Ensure unique entity ID for parameter within its function scope
                    const paramEntityId = generateEntityId('parameter', `${entityId}:${paramName}`);
                    const paramDocs = getJsDocText(param);

                    const paramNode: AstNode = {
                        id: generateId('parameter', `${node.id}:${paramName}`),
                        entityId: paramEntityId,
                        kind: 'Parameter', name: paramName, filePath: fileNode.filePath,
                        startLine: param.getStartLineNumber(), endLine: param.getEndLineNumber(),
                        startColumn: param.getStart() - param.getStartLinePos(), endColumn: getEndColumn(param),
                        type: paramType,
                        documentation: paramDocs || undefined, docComment: paramDocs,
                        isOptional: param.isOptional(),
                        isRestParameter: param.isRestParameter(),
                        createdAt: now,
                    };
                    addNode(paramNode);

                    // CONTAINS relationship (Function -> Parameter)
                    addRelationship({
                        id: generateId('contains', `${node.id}:${paramNode.id}`),
                        entityId: generateEntityId('contains', `${node.entityId}:${paramNode.entityId}`),
                        type: 'CONTAINS', sourceId: node.entityId, targetId: paramNode.entityId,
                        weight: 2, // Lower weight than File->Function
                        createdAt: now,
                    });
                } catch (paramError) {
                    logger.warn(`Error parsing parameter ${param.getName()} for function ${name}`, { error: paramError });
                }
            }
            // --- End Parameter Nodes ---

            // --- Create Local Variable Nodes ---
            const body = declaration.getBody();
            if (body) {
                body.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(varDecl => {
                    try {
                        const varName = varDecl.getName();
                        const varType = varDecl.getType().getText() || 'any';
                        // Entity ID needs to be unique within the function's scope
                        const varEntityId = generateEntityId('variable', `${entityId}:${varName}`); // Use function entityId as scope
                        const varDocs = getJsDocText(varDecl.getFirstAncestorByKind(SyntaxKind.VariableStatement) || varDecl);

                        const varNode: AstNode = {
                            id: generateId('variable', `${node.id}:${varName}`),
                            entityId: varEntityId,
                            kind: 'Variable', name: varName, filePath: fileNode.filePath,
                            startLine: varDecl.getStartLineNumber(), endLine: varDecl.getEndLineNumber(),
                            startColumn: varDecl.getStart() - varDecl.getStartLinePos(), endColumn: getEndColumn(varDecl),
                            type: varType,
                            documentation: varDocs || undefined, docComment: varDocs,
                            // Determine scope/visibility if needed (e.g., const/let)
                            createdAt: now,
                        };
                        addNode(varNode);

                        // CONTAINS relationship (Function -> Variable)
                        addRelationship({
                            id: generateId('contains', `${node.id}:${varNode.id}`),
                            entityId: generateEntityId('contains', `${node.entityId}:${varNode.entityId}`),
                            type: 'CONTAINS', sourceId: node.entityId, targetId: varNode.entityId,
                            weight: 1, // Lower weight than Function->Param
                            createdAt: now,
                        });
                    } catch (varError) {
                        logger.warn(`Error parsing local variable ${varDecl.getName()} in function ${name}`, { error: varError });
                    }
                });
            }
            // --- End Local Variable Nodes ---

            // Analyze body
            if (body) {
                analyzeCalls(body, node, context); // Uncommented
                analyzeUsage(body, node, context); // Uncommented
                analyzeControlFlow(body, node, context); // Uncommented
                // analyzeAssignments not typically called for standalone functions
            }
        } catch (e) { logger.warn(`Error parsing function ${declaration.getName() ?? 'anonymous'} in ${fileNode.filePath}`, { error: e }); }
    }
}