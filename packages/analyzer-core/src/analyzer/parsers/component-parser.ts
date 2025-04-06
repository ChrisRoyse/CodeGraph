// src/analyzer/parsers/component-parser.ts
import { Node, SyntaxKind as SK, FunctionDeclaration, VariableDeclaration, ClassDeclaration, ArrowFunction, FunctionExpression } from 'ts-morph';
import { AstNode, ComponentNode } from '../types.js'; // Import ComponentNode
import { generateEntityId, generateInstanceId } from '../parser-utils.js';
import { createContextLogger } from '../../utils/logger.js';

const logger = createContextLogger('ComponentParser');

/**
 * Checks if a node represents a potential component (React/Vue/Svelte style).
 * Heuristic: Checks if it's a function/class that returns JSX or has JSX within.
 * @param node - The ts-morph node to check.
 * @returns True if the node looks like a component, false otherwise.
 */
function isPotentialComponent(node: Node): node is FunctionDeclaration | VariableDeclaration | ClassDeclaration {
    if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) {
        // Check if name starts with uppercase (common convention)
        const name = node.getName();
        if (!name || !/^[A-Z]/.test(name)) {
            return false;
        }
        // Check if it explicitly returns JSX or contains JSX elements
        if (Node.isFunctionDeclaration(node)) {
            const returnType = node.getReturnTypeNode();
            if (returnType && (returnType.getText().includes('JSX.Element') || returnType.getText().includes('ReactElement'))) {
                return true;
            }
            if (node.getDescendantsOfKind(SK.JsxElement).length > 0 || node.getDescendantsOfKind(SK.JsxSelfClosingElement).length > 0) {
                return true;
            }
        } else if (Node.isClassDeclaration(node)) {
            // For classes, check for a render method returning JSX
            const renderMethod = node.getMethod('render');
            if (renderMethod) {
                 const returnType = renderMethod.getReturnTypeNode();
                 if (returnType && (returnType.getText().includes('JSX.Element') || returnType.getText().includes('ReactElement'))) {
                     return true;
                 }
                 if (renderMethod.getDescendantsOfKind(SK.JsxElement).length > 0 || renderMethod.getDescendantsOfKind(SK.JsxSelfClosingElement).length > 0) {
                     return true;
                 }
            }
             // Also check if class itself contains JSX (less common but possible)
             if (node.getDescendantsOfKind(SK.JsxElement).length > 0 || node.getDescendantsOfKind(SK.JsxSelfClosingElement).length > 0) {
                 return true;
             }
        }
        return false; // Default if no JSX found
    }

    if (Node.isVariableDeclaration(node)) {
        const name = node.getName();
        if (!name || !/^[A-Z]/.test(name)) {
            return false;
        }
        const initializer = node.getInitializer();
        if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
            // Check return type annotation if available on variable declaration
             const typeNode = node.getTypeNode();
             if (typeNode && (typeNode.getText().includes('JSX.Element') || typeNode.getText().includes('React.FC') || typeNode.getText().includes('ReactElement'))) {
                 return true;
             }
            // Check initializer body for JSX
            if (initializer.getDescendantsOfKind(SK.JsxElement).length > 0 || initializer.getDescendantsOfKind(SK.JsxSelfClosingElement).length > 0) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Parses a potential component node (FunctionDeclaration, ClassDeclaration, or VariableDeclaration with ArrowFunction/FunctionExpression).
 * @param node - The ts-morph node representing the component.
 * @param filePath - The absolute path to the file containing the node.
 * @param instanceCounter - The counter for generating unique instance IDs.
 * @param now - The current timestamp string.
 * @returns An AstNode representing the component, or null if it's not a valid component.
 */
export function parseComponent(
    node: FunctionDeclaration | VariableDeclaration | ClassDeclaration,
    filePath: string,
    instanceCounter: { count: number },
    now: string
): ComponentNode | null {
    let componentName: string | undefined;
    let declarationNode: Node = node; // The node representing the core declaration for location info

    if (Node.isVariableDeclaration(node)) {
        componentName = node.getName();
        const initializer = node.getInitializer();
        // Use initializer for location if it's a function/arrow function
        if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
            declarationNode = initializer;
        }
    } else { // FunctionDeclaration or ClassDeclaration
        componentName = node.getName();
    }

    if (!componentName) {
        logger.debug(`Skipping potential component without a name in ${filePath} at line ${node.getStartLineNumber()}`);
        return null; // Cannot identify component without a name
    }

    // Double-check with the heuristic if needed (might be redundant if called correctly)
    if (!isPotentialComponent(node)) {
         logger.debug(`Node ${componentName} in ${filePath} did not meet component heuristics.`);
         return null;
    }


    const startLine = declarationNode.getStartLineNumber();
    const endLine = declarationNode.getEndLineNumber();
    const startColumn = declarationNode.getStart();
    const endColumn = declarationNode.getEnd();
    const language = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? 'TSX' : 'TypeScript'; // Basic detection

    // Determine export status
    let isExported = false;
    let isDefaultExport = false;
    if (Node.isVariableDeclaration(node)) {
        const varStatement = node.getFirstAncestorByKind(SK.VariableStatement);
        isExported = varStatement?.hasExportKeyword() ?? false;
        isDefaultExport = varStatement?.hasDefaultKeyword() ?? false; // Variable statements can have default export (e.g., export default MyComponent = ...)
    } else if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node)) {
        isExported = node.hasExportKeyword();
        isDefaultExport = node.hasDefaultKeyword();
    }


    // Generate IDs
    // Entity ID should be stable based on file path and component name
    const entityId = generateEntityId('component', `${filePath}:${componentName}`);
    const instanceId = generateInstanceId(instanceCounter, 'component', componentName, { line: startLine, column: startColumn });

    logger.debug(`Parsed Component: ${componentName} (Exported: ${isExported}, Default: ${isDefaultExport}) in ${filePath}`);

    const componentNode: ComponentNode = {
        id: instanceId,
        entityId: entityId,
        kind: 'Component',
        name: componentName,
        filePath: filePath,
        startLine: startLine,
        endLine: endLine,
        startColumn: startColumn,
        endColumn: endColumn,
        language: language,
        properties: { // Add properties object
            isExported: isExported,
            isDefaultExport: isDefaultExport
            // Add other relevant properties like props, state analysis results later
        },
        createdAt: now,
    };

    return componentNode;
}