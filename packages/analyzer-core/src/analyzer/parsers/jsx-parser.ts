// src/analyzer/parsers/jsx-parser.ts
import {
    SyntaxKind, Node, JsxElement, JsxSelfClosingElement, JsxAttribute, StringLiteral,
    JsxExpression, Identifier, Block
} from 'ts-morph';
import { ts } from 'ts-morph';
import { createContextLogger } from '../../utils/logger.js';
import { ParserContext, JSXElementNode, JSXAttributeNode, ComponentNode, TailwindClassNode } from '../types.js';

/**
 * Parses JSX elements and attributes within a source file.
 * Creates JSXElement and JSXAttribute nodes, and RENDERS_ELEMENT / HAS_PROP relationships.
 * Assumes Component nodes have already been created by component-parser.
 */
export function parseJsx(context: ParserContext): void {
    const { sourceFile, addNode, addRelationship, generateId, generateEntityId, generateRelationshipId, fileNode, now, logger, result } = context;
    logger.debug(`[jsx-parser] Starting JSX parsing for: ${fileNode.name}`);

    const tailwindClassCache = new Map<string, TailwindClassNode>();
    const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement);
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
    const allJsxNodes = [...jsxElements, ...jsxSelfClosingElements];

    for (const jsxNode of allJsxNodes) {
        try {
            let tagNameNode: Node;
            let attributes: (JsxAttribute | Node<ts.JsxSpreadAttribute>)[] = [];
            const isSelfClosing = Node.isJsxSelfClosingElement(jsxNode);

            if (isSelfClosing) {
                tagNameNode = jsxNode.getTagNameNode();
                attributes = jsxNode.getAttributes();
            } else if (Node.isJsxElement(jsxNode)) {
                const openingElement = jsxNode.getOpeningElement();
                tagNameNode = openingElement.getTagNameNode();
                attributes = openingElement.getAttributes();
            } else {
                // This case should theoretically not be reached.
                logger.warn(`[jsx-parser] Encountered unexpected JSX node type in ${fileNode.filePath}`);
                continue;
            }

            const tagName = tagNameNode.getText();
            const location = {
                startLine: jsxNode.getStartLineNumber(),
                endLine: jsxNode.getEndLineNumber(),
                startColumn: jsxNode.getStart() - jsxNode.getStartLinePos(),
                endColumn: 0,
            };
            const jsxInstanceId = `${fileNode.filePath}:${tagName}:${location.startLine}:${location.startColumn}`;
            const jsxElementEntityId = generateEntityId('jsxelement', jsxInstanceId);

            const jsxElementNode: JSXElementNode = {
                id: generateId('jsxelement', jsxInstanceId, { line: location.startLine, column: location.startColumn }),
                entityId: jsxElementEntityId,
                kind: 'JSXElement', name: tagName, filePath: fileNode.filePath,
                startLine: location.startLine, endLine: location.endLine,
                startColumn: location.startColumn, endColumn: location.endColumn,
                language: 'TypeScript', // Assuming TS/JS context for JSX
                createdAt: now,
                properties: {
                    tagName: tagName, // Add the missing tagName
                    isSelfClosing: isSelfClosing
                }
            };
            addNode(jsxElementNode);
            logger.debug(`[jsx-parser] Added JSXElement node: ${tagName} (EntityId: ${jsxElementEntityId})`);

            // --- Create RENDERS_ELEMENT Relationship ---
            let currentParent: Node | undefined = jsxNode.getParent();
            let parentAstNode: JSXElementNode | ComponentNode | undefined = undefined;

            while (currentParent) {
                 const potentialComp = result.nodes.find(n =>
                     n.kind === 'Component' &&
                     n.startLine === currentParent!.getStartLineNumber() && // Non-null assertion ok due to while condition
                     n.filePath === fileNode.filePath
                 ) as ComponentNode | undefined;

                 if (potentialComp) {
                     parentAstNode = potentialComp;
                     break;
                 }

                 let parentJsxNode: JsxElement | JsxSelfClosingElement | undefined;
                 if (Node.isJsxElement(currentParent)) {
                     parentJsxNode = currentParent;
                 } else if (Node.isJsxSelfClosingElement(currentParent)) {
                     parentJsxNode = currentParent;
                 }

                 if (parentJsxNode) {
                     const parentTagNameNode = Node.isJsxSelfClosingElement(parentJsxNode)
                         ? parentJsxNode.getTagNameNode()
                         : parentJsxNode.getOpeningElement().getTagNameNode();

                     if (parentTagNameNode) {
                         const parentTagName = parentTagNameNode.getText();
                         const parentLocation = {
                             startLine: parentJsxNode.getStartLineNumber(), // Use typed parentJsxNode
                             startColumn: parentJsxNode.getStart() - parentJsxNode.getStartLinePos(),
                         };
                         const parentInstanceId = `${fileNode.filePath}:${parentTagName}:${parentLocation.startLine}:${parentLocation.startColumn}`;
                         const parentEntityId = generateEntityId('jsxelement', parentInstanceId);
                         const foundParentJsxAstNode = result.nodes.find(n => n.entityId === parentEntityId) as JSXElementNode | undefined;
                         if (foundParentJsxAstNode) {
                             parentAstNode = foundParentJsxAstNode;
                             break;
                         }
                     }
                 }

                 if (Node.isBlock(currentParent) || Node.isSourceFile(currentParent)) {
                     break;
                 }
                 // Get parent for next iteration safely
                 // @ts-ignore - TS control flow analysis seems confused here, but loop condition ensures currentParent is defined.
                 const nextParent: Node | undefined = currentParent.getParent();
                 currentParent = nextParent; // Assign potentially undefined value
            }


            if (parentAstNode) {
                const relEntityId = generateEntityId('renders_element', `${parentAstNode.entityId}:${jsxElementEntityId}`);
                addRelationship({
                    id: generateId('renders_element', `${parentAstNode.id}:${jsxElementNode.id}`),
                    entityId: relEntityId,
                    relationshipId: generateRelationshipId(parentAstNode.entityId, jsxElementEntityId, 'RENDERS_ELEMENT'),
                    type: 'RENDERS_ELEMENT',
                    sourceId: parentAstNode.entityId, targetId: jsxElementEntityId,
                    weight: 6, createdAt: now,
                });
                 logger.debug(`[jsx-parser] Added RENDERS_ELEMENT relationship: ${parentAstNode.name} -> ${jsxElementNode.name}`);
            } else {
                 logger.debug(`[jsx-parser] Could not find parent Component or JSXElement for ${jsxElementNode.name} at line ${jsxElementNode.startLine}`);
            }

            // --- Create HAS_PROP Relationships ---
            for (const attribute of attributes) {
                if (Node.isJsxAttribute(attribute)) {
                    const attrName = attribute.getNameNode().getText();
                    const initializer = attribute.getInitializer();
                    let attrValue: any = true;

                    if (initializer) {
                        if (Node.isStringLiteral(initializer)) {
                            attrValue = initializer.getLiteralValue();
                        } else if (Node.isJsxExpression(initializer)) {
                            const expr = initializer.getExpression();
                            attrValue = expr ? `{${expr.getText()}}` : '{expression}';
                        } else {
                             attrValue = initializer.getText();
                        }
                    }

                    const attrLocation = {
                        startLine: attribute.getStartLineNumber(), endLine: attribute.getEndLineNumber(),
                        startColumn: attribute.getStart() - attribute.getStartLinePos(), endColumn: 0,
                    };
                    const attrInstanceId = `${jsxElementEntityId}:${attrName}`;
                    const attrEntityId = generateEntityId('jsxattribute', attrInstanceId);

                    const jsxAttributeNode: JSXAttributeNode = {
                        id: generateId('jsxattribute', attrInstanceId, { line: attrLocation.startLine, column: attrLocation.startColumn }),
                        entityId: attrEntityId, kind: 'JSXAttribute', name: attrName,
                        parentId: jsxElementNode.entityId, // Link to parent JSX element
                        filePath: fileNode.filePath, startLine: attrLocation.startLine, endLine: attrLocation.endLine,
                        language: 'TypeScript', // Assuming TS/JS context
                        startColumn: attrLocation.startColumn, endColumn: attrLocation.endColumn,
                        createdAt: now, properties: { value: attrValue }
                    };
                    addNode(jsxAttributeNode);
                     logger.debug(`[jsx-parser] Added JSXAttribute node: ${attrName}`);

                    const relEntityId = generateEntityId('has_prop', `${jsxElementEntityId}:${attrEntityId}`);
                    addRelationship({
                        id: generateId('has_prop', `${jsxElementNode.id}:${jsxAttributeNode.id}`),
                        entityId: relEntityId,
                        relationshipId: generateRelationshipId(jsxElementEntityId, attrEntityId, 'HAS_PROP'),
                        type: 'HAS_PROP',
                        sourceId: jsxElementEntityId, targetId: attrEntityId,
                        weight: 7, createdAt: now,
                    });
                     logger.debug(`[jsx-parser] Added HAS_PROP relationship: ${jsxElementNode.name} -> ${jsxAttributeNode.name}`);

                    // --- Tailwind CSS Class Parsing ---
                    if (attrName === 'className' && typeof attrValue === 'string') {
                        const classNames = attrValue.split(/\s+/).filter(cn => cn.trim() !== '');
                        logger.debug(`[jsx-parser] Found className attribute with ${classNames.length} potential classes: "${attrValue}"`);

                        for (const className of classNames) {
                            try {
                                const tailwindClassName = className;
                                const tailwindEntityId = generateEntityId('tailwindclass', tailwindClassName);
                                let tailwindNode = tailwindClassCache.get(tailwindEntityId);

                                if (!tailwindNode) {
                                    tailwindNode = {
 // Explicitly type as TailwindClassNode
                                        id: generateId('tailwindclass', tailwindClassName, { line: attrLocation.startLine, column: attrLocation.startColumn }),
                                        entityId: tailwindEntityId,
                                        parentId: jsxElementNode.entityId, // Link to the element using the class
                                        kind: 'TailwindClass',
                                        name: tailwindClassName,
                                        filePath: fileNode.filePath, // File where the class usage occurs
                                        language: 'TypeScript', // Assuming TS/JS context
                                        // Start/end lines for a class itself aren't really applicable here
                                        startLine: 0, endLine: 0, startColumn: 0, endColumn: 0,
                                        createdAt: now,
                                        properties: { className: tailwindClassName } // Store the class name
                                    };
                                    addNode(tailwindNode);
                                    tailwindClassCache.set(tailwindEntityId, tailwindNode);
                                    logger.debug(`[jsx-parser] Added TailwindClass node: ${tailwindClassName}`);
                                }

                                // Ensure tailwindNode exists before creating relationship
                                if (tailwindNode) {
                                    const twRelEntityId = generateEntityId('uses_tailwind_class', `${jsxElementEntityId}:${tailwindEntityId}`);
                                    addRelationship({
                                        // Now tailwindNode is guaranteed to be defined here
                                        id: generateId('uses_tailwind_class', `${jsxElementNode.id}:${tailwindNode.id}`),
                                        entityId: twRelEntityId,
                                        relationshipId: generateRelationshipId(jsxElementEntityId, tailwindEntityId, 'USES_TAILWIND_CLASS'),
                                        type: 'USES_TAILWIND_CLASS',
                                        sourceId: jsxElementEntityId, targetId: tailwindEntityId,
 // Use tailwindEntityId which is always defined
                                        weight: 2, createdAt: now,
                                    });
                                    // And here
    
                                logger.debug(`[jsx-parser] Added USES_TAILWIND_CLASS relationship: ${jsxElementNode.name} -> ${tailwindNode.name}`);
                                } else {
                                    // This case should not happen if cache logic is correct, but log just in case
                                    logger.warn(`[jsx-parser] Could not find or create Tailwind node for class "${tailwindClassName}" before relationship creation.`);
                                }

                            } catch (tailwindError: any) {
                                 logger.warn(`[jsx-parser] Error processing Tailwind class "${className}" in ${fileNode.filePath}: ${tailwindError.message}`);
                            }
                        }
                    }
                }
            }

        } catch (error: any) {
            const tagName = Node.isJsxSelfClosingElement(jsxNode)
                ? jsxNode.getTagNameNode().getText()
                : (Node.isJsxElement(jsxNode) ? jsxNode.getOpeningElement().getTagNameNode().getText() : 'unknown');
             logger.error(`[jsx-parser] Error processing JSX element "${tagName}" in ${fileNode.filePath}: ${error.message}`, { stack: error.stack?.substring(0, 300) });
        }
    }
}