// src/analyzer/analysis/analyzer-utils.ts
import { Node, SyntaxKind as SK, ClassDeclaration, InterfaceDeclaration, FunctionDeclaration, MethodDeclaration, ArrowFunction, FunctionExpression, MethodSignature, VariableDeclaration, ParameterDeclaration, TypeAliasDeclaration, EnumDeclaration, EnumMember, Expression } from 'ts-morph';
import { TargetDeclarationInfo } from '../types.js'; // Assuming TargetDeclarationInfo is defined here
import { generateEntityId } from '../parser-utils.js';
import winston from 'winston';

/**
 * Represents the resolved information about a target declaration.
 */
// export interface TargetDeclarationInfo { // Moved to types.ts
//     name: string;
//     kind: string; // e.g., 'Function', 'Class', 'Variable', 'Interface', 'Method', 'Parameter'
//     filePath: string; // Absolute, normalized path
//     entityId: string; // Globally unique ID matching Pass 1 generation
// }

/**
 * Resolves the declaration information for a given expression node.
 * Tries to find the original declaration, handling aliases (imports).
 * Generates an entityId consistent with Pass 1 parsers.
 *
 * @param expression - The expression node to resolve (e.g., identifier, property access).
 * @param currentFilePath - The absolute, normalized path of the file containing the expression.
 * @param resolveImportPath - Function to resolve relative import paths.
 * @param logger - Winston logger instance.
 * @returns TargetDeclarationInfo object or null if resolution fails.
 */
export function getTargetDeclarationInfo(
    expression: Node,
    currentFilePath: string,
    resolveImportPath: (sourcePath: string, importPath: string) => string,
    logger: winston.Logger
): TargetDeclarationInfo | null {
    try {
        let symbol = expression.getSymbol();
        if (!symbol) {
             // logger.debug(`Symbol not found for expression: ${expression.getText().substring(0, 50)}...`); // Keep this commented unless needed
            return null;
        }

        // If the direct symbol is an alias (like an import), get the original symbol
        const aliasedSymbol = symbol.getAliasedSymbol();
        if (aliasedSymbol) {
            // logger.debug(`Symbol '${symbol.getName()}' is an alias. Using aliased symbol '${aliasedSymbol.getName()}'.`); // Keep commented unless needed
            symbol = aliasedSymbol;
        }

        const declarations = symbol.getDeclarations();
        if (!declarations || declarations.length === 0) {
             // It's possible the aliased symbol also has no declarations (e.g., importing a type from a declaration file)
             logger.debug(`No declarations found for symbol: ${symbol.getName()} (after checking alias)`);
            return null;
        }

        const declaration = declarations[0];
        if (!declaration) return null;

        const sourceFile = declaration.getSourceFile();
        const originalFilePath = sourceFile.getFilePath();
        // Resolve path relative to the *current* file, not the declaration file
        const resolvedFilePath = resolveImportPath(currentFilePath, originalFilePath).replace(/\\/g, '/'); // Normalize path


        let name = symbol.getName();
        let kind = 'unknown';
        let qualifiedNameForId: string | null = null;

        // Determine kind and base qualified name
        if (Node.isFunctionDeclaration(declaration) || Node.isFunctionExpression(declaration) || Node.isArrowFunction(declaration)) {
            kind = 'Function';
            name = (Node.isFunctionDeclaration(declaration) || Node.isFunctionExpression(declaration)) ? declaration.getName() ?? name : name; // Use getName() if available for named functions
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        } else if (Node.isMethodDeclaration(declaration) || Node.isMethodSignature(declaration)) {
            kind = 'Method';
            name = declaration.getName() ?? name;
            const parentContainer = declaration.getParent() as ClassDeclaration | InterfaceDeclaration | null;
            if (parentContainer && (Node.isClassDeclaration(parentContainer) || Node.isInterfaceDeclaration(parentContainer))) {
                const parentName = parentContainer.getName();
                // Use simplified ID format (filePath:Parent.method)
                qualifiedNameForId = `${resolvedFilePath}:${parentName ?? 'AnonymousContainer'}.${name}`;
            } else {
                 qualifiedNameForId = `${resolvedFilePath}:unknownParent.${name}`;
            }
        } else if (Node.isClassDeclaration(declaration)) {
            kind = 'Class';
            name = declaration.getName() ?? name;
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        } else if (Node.isInterfaceDeclaration(declaration)) {
            kind = 'Interface';
            name = declaration.getName() ?? name;
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        } else if (Node.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            if (initializer && (Node.isFunctionExpression(initializer) || Node.isArrowFunction(initializer))) {
                kind = 'Function'; // Treat variable assigned functions as Function kind
                name = declaration.getName() ?? name;
                // Use simplified ID format (filePath:name) for functions
                qualifiedNameForId = `${resolvedFilePath}:${name}`;
            } else {
                kind = 'Variable';
                name = declaration.getName() ?? name;
                 // Variables might still need line numbers if declared multiple times in scope?
                 // For now, keep it simple: filePath:name
                 qualifiedNameForId = `${resolvedFilePath}:${name}`;
            }
        } else if (Node.isParameterDeclaration(declaration)) {
            kind = 'Parameter';
            name = declaration.getName() ?? name;
            // Find the containing function/method using ancestor traversal
            const funcOrMethod = declaration.getFirstAncestor(
                (a): a is FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | MethodSignature =>
                    Node.isFunctionDeclaration(a) || Node.isMethodDeclaration(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a) || Node.isMethodSignature(a)
            );
 // Added MethodSignature check

            if (funcOrMethod) {
                 const parentName = ('getName' in funcOrMethod && funcOrMethod.getName()) ? funcOrMethod.getName() : 'anonymousParent';
                 const parentFilePath = funcOrMethod.getSourceFile().getFilePath();
                 const resolvedParentFilePath = resolveImportPath(currentFilePath, parentFilePath).replace(/\\/g, '/'); // Use currentFilePath & normalize
                 // Construct the parent's qualified name string (consistent with function/method parsers)
                 // Need to include line number for parent function/method here too for consistency
                 const parentStartLine = funcOrMethod.getStartLineNumber();
                 const parentQualifiedName = `${resolvedParentFilePath}:${parentName}:${parentStartLine}`; // Add line number
                 // Use the parent's qualified name string to build the parameter's qualified name
                 qualifiedNameForId = `${parentQualifiedName}:${name}`; // Parameter ID includes parent context
            } else {
                 qualifiedNameForId = `${resolvedFilePath}:unknownParent:${name}`;
            }
        } else if (Node.isTypeAliasDeclaration(declaration)) {
            kind = 'TypeAlias';
            name = declaration.getName() ?? name;
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        } else if (Node.isEnumDeclaration(declaration)) {
            kind = 'TypeAlias'; // Treat enums like type aliases for simplicity
            name = declaration.getName() ?? name;
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        } else if (Node.isEnumMember(declaration)) {
            kind = 'TypeAlias'; // Treat enum members like type aliases
            const enumName = declaration.getParent().getName();
            name = `${enumName}.${declaration.getName()}`;
            qualifiedNameForId = `${resolvedFilePath}:${enumName}`; // ID based on the Enum itself
        }
        // Add other kinds like ImportSpecifier, NamespaceImport if needed

        if (!qualifiedNameForId) {
            // Fallback or if kind is still unknown
            qualifiedNameForId = `${resolvedFilePath}:${name}`;
        }

        // If no specific kind was determined, try a fallback or return null
        if (kind === 'unknown') {
             logger.debug(`[getTargetDeclarationInfo] Could not determine specific target kind for node: ${expression.getText()}`);
            // Maybe try symbol flags? e.g., symbol.getFlags() & ts.SymbolFlags.Function
            return null;
        }

        // Add start line to qualifier for functions and methods to match parser
        // This ensures consistency with entity IDs generated in function-parser.ts

        if (kind === 'Function') {
            qualifiedNameForId = `${qualifiedNameForId}:${declaration.getStartLineNumber()}`;
        }

        // Generate the final entityId
        // IMPORTANT: This MUST match the entityId generation logic in Pass 1 parsers
        const entityId = generateEntityId(kind.toLowerCase(), qualifiedNameForId);

        // logger.debug(`[getTargetDeclarationInfo] Resolved: ${expression.getText()} -> Target: ${name} (Kind: ${kind}, File: ${resolvedFilePath}, EntityId: ${entityId})`);

        return {
            name: name,
            kind: kind,
            filePath: resolvedFilePath,
            entityId: entityId,
        };

    } catch (error: any) {
        logger.warn(`[getTargetDeclarationInfo] Error resolving declaration for expression "${expression.getText()}": ${error.message}`);
        return null;
    }
}