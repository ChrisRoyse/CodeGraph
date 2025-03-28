import { Node, SyntaxKind, SourceFile } from 'ts-morph'; // Added SourceFile import

/**
 * Calculates the end column for a given node.
 * Handles potential inconsistencies in how end positions are reported.
 * @param node - The ts-morph Node.
 * @returns The calculated end column number (1-based).
 */
export function getEndColumn(node: Node): number {
    try {
        const sourceFile = node.getSourceFile();
        const endLine = node.getEndLineNumber();
        const endPos = node.getEnd();

        // Get the start position of the end line using the compiler API
        const lineStartPos = sourceFile.compilerNode.getPositionOfLineAndCharacter(endLine - 1, 0); // TS uses 0-based line index

        // Calculate column (1-based)
        const endColumn = endPos - lineStartPos + 1;

        // Sanity check: column shouldn't be negative or excessively large
        // Get line length more reliably
        const lineText = sourceFile.getText().split('\n')[endLine - 1];
        const lineLength = lineText?.length ?? 1000; // Use actual line length if possible

        return Math.max(1, Math.min(endColumn, lineLength + 1)); // Clamp value
    } catch (error) {
        // Fallback if any error occurs
        try {
            // Try a simpler fallback using node's start position on its line
             return node.getEnd() - node.getStartLinePos() + 1;
        } catch {
             return 100; // Absolute fallback
        }
    }
}

/**
 * Gets the visibility scope of a class member.
 * @param node - The class member node (MethodDeclaration, PropertyDeclaration, etc.).
 * @returns 'public', 'private', 'protected', or 'public' (default).
 */
export function getVisibility(node: Node): 'public' | 'private' | 'protected' {
     try {
        // Use static type guard Node.isScoped to narrow the type
        if (Node.isScoped(node)) {
            // 'node' is now known to be ScopedNode inside this block
             const scope = node.getScope(); // Call getScope() on the narrowed type
             if (scope) {
                 return scope;
             }
        }
        // Check for explicit modifiers if getScope isn't available or returns undefined
        // Use static type guard Node.isModifierable
        if (Node.isModifierable(node)) {
             // 'node' is now known to be ModifierableNode inside this block
             if (node.hasModifier(SyntaxKind.PrivateKeyword)) return 'private';
             if (node.hasModifier(SyntaxKind.ProtectedKeyword)) return 'protected';
        }

    } catch { /* Ignore errors */ }
    return 'public'; // Default to public
}

// Add other ts-morph helper functions as needed

// Example: Helper to safely get JSDoc text
export function getJsDocText(node: Node): string | undefined {
     try {
        // Check if the node kind supports JSDocs directly
        if (Node.isJSDocable(node)) { // Use Node.isJSDocable
            const jsDocs = node.getJsDocs();
            if (jsDocs && jsDocs.length > 0) {
                return jsDocs.map((doc: any) => doc.getText()).join('\n'); // Keep 'any' for now or import JSDoc type
            }
        }
    } catch { /* Ignore errors */ }
    return undefined;
}

// Type alias for scope, used internally by getVisibility
type Scope = 'public' | 'private' | 'protected';