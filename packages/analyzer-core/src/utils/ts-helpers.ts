import { Node, SyntaxKind, JSDoc, ts } from 'ts-morph';

/**
 * Gets the end column number for a node.
 * @param node - The ts-morph Node.
 * @returns The 0-based end column number.
 */
export function getEndColumn(node: Node): number {
    try {
        const endLine = node.getEndLineNumber();
        const sourceFile = node.getSourceFile();
        const lineStartPos = sourceFile.compilerNode.getPositionOfLineAndCharacter(endLine - 1, 0);
        return node.getEnd() - lineStartPos;
    } catch (e) {
        // console.warn(`Error getting end column for node: ${e}`);
        return 0; // Fallback
    }
}

/**
 * Determines the visibility (public, private, protected) of a class member.
 * Defaults to 'public' if no explicit modifier is found.
 * @param node - The ts-morph Node (e.g., MethodDeclaration, PropertyDeclaration).
 * @returns The visibility modifier string.
 */
export function getVisibility(node: Node): 'public' | 'private' | 'protected' {
    // Use the correct type guard: Node.isModifierable(...)
    if (Node.isModifierable(node)) {
        // Now TypeScript knows 'node' has modifier methods within this block
        if (node.hasModifier(SyntaxKind.PrivateKeyword)) {
            return 'private';
        }
        if (node.hasModifier(SyntaxKind.ProtectedKeyword)) {
            return 'protected';
        }
    }
    return 'public';
}

/**
 * Extracts the combined text content from all JSDoc comments associated with a node.
 * @param node - The ts-morph Node.
 * @returns The combined JSDoc text, or an empty string if none found.
 */
export function getJsDocText(node: Node): string {
    // Use the correct type guard: Node.isJSDocable(...)
    if (Node.isJSDocable(node)) {
        // TypeScript knows 'node' has getJsDocs() here
        const jsDocs: JSDoc[] = node.getJsDocs();
        return jsDocs.map((doc: JSDoc) => doc.getCommentText() || '').join('\n').trim();
    }
    return '';
}

/**
 * Extracts the description part of the first JSDoc comment.
 * @param node The node to extract JSDoc from.
 * @returns The description string or undefined.
 */
export function getJsDocDescription(node: Node): string | undefined {
     // Use the correct type guard: Node.isJSDocable(...)
    if (Node.isJSDocable(node)) {
        const jsDocs: JSDoc[] = node.getJsDocs();
        if (jsDocs.length > 0) {
            // Add nullish coalescing for safety, although getJsDocs should return empty array if none
            return jsDocs[0]?.getDescription().trim() || undefined;
        }
    }
    return undefined;
}

/**
 * Checks if a node has the 'export' keyword modifier.
 * @param node The node to check.
 * @returns True if the node is exported, false otherwise.
 */
export function isNodeExported(node: Node): boolean {
    // Use the correct type guard: Node.isModifierable(...)
    if (Node.isModifierable(node)) {
        return node.hasModifier(SyntaxKind.ExportKeyword);
    }
    // Consider edge cases like `export { name };` if needed later
    return false;
}

/**
 * Checks if a node has the 'async' keyword modifier.
 * @param node The node to check (e.g., FunctionDeclaration, MethodDeclaration, ArrowFunction).
 * @returns True if the node is async, false otherwise.
 */
export function isNodeAsync(node: Node): boolean {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
        return node.isAsync();
    }
    return false;
}

/**
 * Checks if a node has the 'static' keyword modifier.
 * @param node The node to check (e.g., MethodDeclaration, PropertyDeclaration).
 * @returns True if the node is static, false otherwise.
 */
export function isNodeStatic(node: Node): boolean {
     // Use the correct type guard: Node.isModifierable(...)
    if (Node.isModifierable(node)) {
        return node.hasModifier(SyntaxKind.StaticKeyword);
    }
    return false;
}

/**
 * Safely gets the name of a node, returning a default if none exists.
 * Handles various node types that might have names.
 * @param node The node.
 * @param defaultName The default name to return if the node has no name.
 * @returns The node's name or the default name.
 */
export function getNodeName(node: Node, defaultName: string = 'anonymous'): string {
    // Use specific type guards for nodes known to have names
    if (Node.isVariableDeclaration(node) || Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node) || Node.isInterfaceDeclaration(node) || Node.isMethodDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isParameterDeclaration(node) || Node.isEnumDeclaration(node) || Node.isTypeAliasDeclaration(node) || Node.isBindingElement(node) || Node.isPropertySignature(node) || Node.isMethodSignature(node)) {
        // TypeScript knows these have getName()
        return node.getName() ?? defaultName;
    }
    // Add other types like EnumMember, NamespaceDeclaration if needed
    return defaultName;
}


/**
 * Safely gets the type text of a node, returning 'any' if resolution fails.
 * @param node The node (e.g., VariableDeclaration, ParameterDeclaration, PropertyDeclaration).
 * @returns The type text or 'any'.
 */
export function getNodeType(node: Node): string {
     try {
        // Use specific type guards for nodes known to have types
        if (Node.isVariableDeclaration(node) || Node.isParameterDeclaration(node) || Node.isPropertyDeclaration(node) || Node.isPropertySignature(node) || Node.isBindingElement(node)) {
             // TypeScript knows these have getType()
             return node.getType().getText() || 'any';
        }
     } catch (e) {
         // console.warn(`Could not get type for node kind ${node.getKindName()}: ${e}`);
     }
     return 'any'; // Default fallback
}

/**
 * Safely gets the return type text of a function-like node.
 * @param node The function-like node.
 * @returns The return type text or 'any'.
 */
export function getFunctionReturnType(node: Node): string {
     try {
         // Use specific type guards for function-like nodes
         if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node) || Node.isMethodSignature(node)) {
             // TypeScript knows these have getReturnType()
             return node.getReturnType().getText() || 'any';
         }
     } catch (e) {
         // console.warn(`Could not get return type for node kind ${node.getKindName()}: ${e}`);
     }
     return 'any';
}