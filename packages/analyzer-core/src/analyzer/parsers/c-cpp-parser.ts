// src/analyzer/parsers/c-cpp-parser.ts
import type { default as TreeSitterParser } from 'tree-sitter'; // Import the type
// Grammars are loaded by ParserFactory, no need to import C/Cpp here directly
// import C from 'tree-sitter-c';
// import Cpp from 'tree-sitter-cpp';
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js'; // Corrected path
import { ParserError } from '../../utils/errors.js'; // Corrected path
import { FileInfo } from '../../scanner/file-scanner.js'; // Corrected path
import { AstNode, RelationshipInfo, LanguageParser, InstanceCounter, IncludeDirectiveNode, CFunctionNode, CppClassNode, CppMethodNode } from '../types.js'; // Import LanguageParser
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId, generateRelationshipId } from '../parser-utils.js';
 // Corrected path

const logger = createContextLogger('CCppParser');

// Helper to get node text safely
function getNodeText(node: TreeSitterParser.SyntaxNode | null | undefined): string {
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: TreeSitterParser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } {
    // Tree-sitter positions are 0-based, AstNode expects 1-based lines
    return {
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column,
        endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class CCppAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode; // Represents the file being parsed
    private now: string = new Date().toISOString();
    private currentClassEntityId: string | undefined = undefined; // Track current class context (use undefined)

    constructor(private filepath: string, private language: 'C' | 'C++') {
        // Create the File node representation for this parse
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath); // Use 'file' kind for consistency
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId,
            kind: 'File', // Use standard 'File' kind
            name: filename,
            filePath: filepath,
            startLine: 1, // File starts at 1
            endLine: 0, // Will be updated after parsing
            startColumn: 0,
            endColumn: 0,
            language: language,
            createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    visit(node: TreeSitterParser.SyntaxNode) {
        // Process the current node first
        this.visitNode(node); // Always process the node

        // Always recurse into children, let visitNode handle specific logic
        for (const child of node.namedChildren) {
            this.visit(child);
        }

        // Update file end line after visiting all nodes
        if (node.type === 'translation_unit') { // Root node type for C/C++
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    // Returns true if the node type was handled and recursion should potentially stop, false otherwise
    private visitNode(node: TreeSitterParser.SyntaxNode): boolean {
        try {
            // Log every node type visited in header files for debugging
            if (this.filepath.endsWith('.h') || this.filepath.endsWith('.hpp')) {
                const location = getNodeLocation(node);
                logger.debug(`[CCppAstVisitor Header Debug] Visiting Node Type: ${node.type} at ${this.filepath}:${location.startLine}`);
            }

            switch (node.type) {
                case 'preproc_include':
                case 'preproc_def':
                    this.visitIncludeOrDefine(node);
                    return true; // Handled, stop recursion here
                case 'namespace_definition':
                     return false; // Allow recursion into namespace body
                case 'function_definition':
                    this.visitFunctionDefinition(node);
                    return false; // Allow recursion into function body
                case 'class_specifier':
                    this.visitClassSpecifier(node);
                    return false; // Allow recursion into class body/members
                // Add cases for struct_specifier, etc. later
                case 'struct_specifier': // Handle struct/class definitions
                    // logger.debug(`[CCppAstVisitor] Found struct_specifier at ${this.filepath}:${getNodeLocation(node).startLine}`);
                    this.visitClassSpecifier(node); // Treat structs like classes for now
                    return false; // Allow recursion
                case 'declaration':
                    // Handle other declaration types (e.g., simple variables) if needed later
                    return false; // Allow recursion for other declaration parts
                case 'type_definition':
                    // Handle other type definitions (struct, enum) if needed later
                    return false; // Allow recursion
                case 'type_specifier':
                    return false; // Allow recursion
                default:
                    // Log unhandled node types, especially if they might contain classes
                    const location = getNodeLocation(node);
                    if (node.text.includes('class ') && node.type !== 'comment') { // Basic check
                         logger.debug(`[CCppAstVisitor] Unhandled node type potentially containing class: ${node.type} at ${this.filepath}:${location.startLine}\nText: ${node.text.substring(0, 100)}...`);
                    }
                    return false; // Not specifically handled, allow generic recursion
            }
        } catch (error: any) {
             logger.warn(`[CCppAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
             return false; // Continue traversal even if one node fails
        }
    }

    private visitIncludeOrDefine(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        let name = 'unknown_directive';
        let kind: 'IncludeDirective' | 'MacroDefinition' = 'IncludeDirective'; // Default, adjust later
        let properties: Record<string, any> = {};

        if (node.type === 'preproc_include') {
            kind = 'IncludeDirective';
            const pathNode = node.childForFieldName('path');
            const includePath = getNodeText(pathNode);
            const isSystemInclude = includePath.startsWith('<') && includePath.endsWith('>');
            name = includePath; // Use the path as the name for includes
            properties = {
                includePath: includePath.substring(1, includePath.length - 1), // Remove <> or ""
                isSystemInclude: isSystemInclude,
            };
        } else if (node.type === 'preproc_def') {
            kind = 'MacroDefinition'; // Placeholder kind
            name = getNodeText(node.childForFieldName('name'));
            properties = { value: getNodeText(node.childForFieldName('value')) };
        }

        const entityId = generateEntityId(kind.toLowerCase(), `${this.filepath}:${name}:${location.startLine}`);
        const directiveNode: AstNode = { // Use base AstNode, cast later if needed
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: kind,
            name: name,
            filePath: this.filepath,
            language: this.language,
            ...location,
            createdAt: this.now,
            properties: properties,
        };
        this.nodes.push(directiveNode);

        // Add INCLUDES relationship (File -> IncludeDirective/MacroDefinition)
        if (kind === 'IncludeDirective') {
            const relEntityId = generateEntityId('includes', `${this.fileNode.entityId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'includes', `${this.fileNode.id}:${directiveNode.id}`),
                entityId: relEntityId, // Keep old entityId for now if needed elsewhere, but relationshipId is primary
                relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'INCLUDES'),
                type: 'INCLUDES',
                sourceId: this.fileNode.entityId,
                targetId: entityId,
                createdAt: this.now,
                weight: 5,
            });
        }
    }

     private visitFunctionDefinition(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const declarator = node.childForFieldName('declarator');
        const nameNode = declarator?.childForFieldName('declarator'); // Function name is often nested
        const name = getNodeText(nameNode);

        if (!name) {
             logger.debug(`[CCppAstVisitor] Skipping function_definition without a clear name at ${this.filepath}:${location.startLine}`);
             return; // Skip anonymous or malformed/misidentified
        }

        // Determine if it's a method (inside a class) or a standalone function
        const kind: 'CFunction' | 'CppMethod' = this.currentClassEntityId ? 'CppMethod' : 'CFunction';
        const parentId = this.currentClassEntityId; // undefined if not in a class

        const entityId = generateEntityId(kind.toLowerCase(), `${this.filepath}:${name}:${location.startLine}`);

        // Create the base object first
        const baseFuncNode = {
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: kind,
            name: name,
            filePath: this.filepath,
            language: this.language,
            ...location,
            loc: location.endLine - location.startLine + 1,
            createdAt: this.now,
            parentId: parentId, // Link method to class (undefined is fine)
            // TODO: Extract parameters, return type
        };

        // Explicitly cast based on kind before pushing
        let funcNode: CFunctionNode | CppMethodNode;
        if (kind === 'CppMethod') {
            funcNode = baseFuncNode as CppMethodNode;
        } else {
            funcNode = baseFuncNode as CFunctionNode;
        }
        this.nodes.push(funcNode);


        // Add relationship File -> CFunction (DEFINES_FUNCTION) or Class -> CppMethod (HAS_METHOD)
        if (kind === 'CppMethod' && parentId) {
            const relEntityId = generateEntityId('has_method', `${parentId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'has_method', `${parentId}:${funcNode.id}`),
                entityId: relEntityId,
                relationshipId: generateRelationshipId(parentId, entityId, 'HAS_METHOD'),
                type: 'HAS_METHOD',
                sourceId: parentId, targetId: entityId,
                createdAt: this.now, weight: 8,
            });
        } else if (kind === 'CFunction') {
            const relEntityId = generateEntityId('defines_function', `${this.fileNode.entityId}:${entityId}`);
            this.relationships.push({
                id: generateInstanceId(this.instanceCounter, 'defines_function', `${this.fileNode.id}:${funcNode.id}`),
                entityId: relEntityId,
                relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_FUNCTION'),
                type: 'DEFINES_FUNCTION',
                sourceId: this.fileNode.entityId, targetId: entityId,
                createdAt: this.now, weight: 8,
            });
        }

        // Context restoration for nested functions/classes needs careful handling
        // For now, we let the main visit loop handle body recursion
    }

    private visitClassSpecifier(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        // Try standard name field first
        let nameNode: TreeSitterParser.SyntaxNode | null | undefined = node.childForFieldName('name');

        // Workaround: If nameNode is null AND the original type was function_definition,
        // find the 'identifier' child that follows the 'type_identifier' child.
        if (!nameNode && node.type === 'function_definition') {
            let typeIdentifierFound = false;
            for (const child of node.namedChildren) {
                if (child.type === 'type_identifier') {
                    typeIdentifierFound = true;
                } else if (typeIdentifierFound && child.type === 'identifier') {
                    nameNode = child;
                    logger.debug(`[CCppAstVisitor] Using identifier child as name for misidentified class at ${this.filepath}:${location.startLine}`);
                    break;
                }
            }
        }

        const name = getNodeText(nameNode);

        if (!name) {
            logger.warn(`[CCppAstVisitor] Skipping class_specifier/misidentified node without a name at ${this.filepath}:${location.startLine}`);
            return; // Skip anonymous classes or nodes we can't name
        }

        // Log children to find the inheritance clause node type/field name
        // logger.debug(`[CCppAstVisitor] Children of class ${name}: ${node.children.map(c => `${c.type} ('${c.text.substring(0,20)}...')`).join(', ')}`);
        // Log NAMED children and their field names
        const namedChildrenFields = node.namedChildren.map(c => `Type: ${c.type}, Field: ${node.fieldNameForChild(c.id)}`);
        logger.debug(`[CCppAstVisitor] Named children fields for class ${name}: ${namedChildrenFields.join('; ')}`);

        const originalClassId = this.currentClassEntityId; // Save outer class context if nested

        const entityId = generateEntityId('cppclass', `${this.filepath}:${name}`);
        // logger.debug(`[CCppAstVisitor] Found class: ${name}, EntityId: ${entityId}`);

        const classNode: CppClassNode = {
            id: generateInstanceId(this.instanceCounter, 'cppclass', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId,
            kind: 'CppClass',
            name: name,
            filePath: this.filepath,
            language: 'C++', // Explicitly set to C++ for CppClassNode
            ...location,
            createdAt: this.now,
        };
        this.nodes.push(classNode);
        this.currentClassEntityId = entityId; // Set context for methods/nested members

        // Add relationship File -> CppClass (DEFINES_CLASS)
        const relEntityId = generateEntityId('defines_class', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'defines_class', `${this.fileNode.id}:${classNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_CLASS'),
            type: 'DEFINES_CLASS', // Reusing type
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // Handle inheritance (base_class_clause)
        const baseClause = node.childForFieldName('base_class_clause'); // Correct field name
        if (baseClause) {
            // Iterate through base specifiers (might handle multiple inheritance later)
            const currentLanguage = this.language; // Capture language explicitly
            logger.debug(`[CCppAstVisitor] Found base_class_clause for ${name} at ${this.filepath}:${location.startLine}. Children: ${baseClause.children.map(c => c.type).join(', ')}`);
            const baseSpecifiers = baseClause.children.filter(c => c.type === 'base_specifier');
            logger.debug(`[CCppAstVisitor] Found ${baseSpecifiers.length} base_specifier nodes.`);
            baseSpecifiers.forEach(baseSpecifier => {
                // The name of the parent class is usually a type_identifier
                let parentNameNode = baseSpecifier.descendantsOfType('type_identifier')[0]; // Find type_identifier within the specifier
                // Fallback: If no type_identifier found, maybe the baseSpecifier itself is the name node (less likely but possible)
                if (!parentNameNode && baseSpecifier.type === 'type_identifier') {
                    parentNameNode = baseSpecifier;
                }

                logger.debug(`[CCppAstVisitor] Processing baseSpecifier. Type: ${baseSpecifier.type}. Found parentNameNode: ${!!parentNameNode}, Type: ${parentNameNode?.type}`);
                const parentName = getNodeText(parentNameNode);
                if (parentName) {
                    logger.debug(`[CCppAstVisitor] Found parent class name: ${parentName}`);
                    // Use a simpler placeholder targetId, store details in properties
                    const placeholderTargetId = `placeholder:${parentName}`;
                    // RelationshipResolver (Pass 2) should ideally fix this later if possible
                    const extendsRelEntityId = generateEntityId('extends', `${entityId}:${placeholderTargetId}`); // Relationship ID

                    this.relationships.push({
                        id: generateInstanceId(this.instanceCounter, 'extends', `${classNode.id}:${parentName}`), // Instance ID
                        entityId: extendsRelEntityId,
                        relationshipId: generateRelationshipId(entityId, placeholderTargetId, 'EXTENDS'),
                        type: 'EXTENDS',
                        sourceId: entityId, // Child class
                        targetId: placeholderTargetId, // Simple placeholder ID
                        language: currentLanguage, // Use captured language
                        properties: { // Store info needed for resolution in Pass 2
                            targetName: parentName,
                            targetKind: 'CppClass' // We know it must be a CppClass
                        },
                        createdAt: this.now,
                        weight: 10, // High weight for inheritance
                    });
                    logger.debug(`[CCppAstVisitor] Pushed EXTENDS relationship: ${extendsRelEntityId}`);
                }
            }
);
        }

        // Let the main visit loop handle recursion into the body/member list
        // Restore context AFTER visiting children (handled by main visit loop now)
        // This is tricky without explicit exit events. Defer proper context stack management.
        // this.currentClassEntityId = originalClassId; // Restore outer class context - DEFERRED
    }

    // Add visitStructSpecifier etc. later
}


/**
 * Parses C/C++ files using Tree-sitter.
 */
export class CCppParser implements LanguageParser {
    private sharedParser: TreeSitterParser;

    constructor(sharedParser: TreeSitterParser) {
        this.sharedParser = sharedParser; // Use the parser passed from AnalyzerService
        logger.debug('C/C++ Parser instance created with shared TreeSitterParser.');
    }

    /**
     * Parses a single C/C++ file content.
     * @param filePath - The absolute path to the file.
     * @param fileContent - The content of the file.
     * @returns A promise resolving to the extracted nodes and relationships.
     */
    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        const language = path.extname(normalizedFilePath) === '.c' || path.extname(normalizedFilePath) === '.h' ? 'C' : 'C++';
        logger.info(`[CCppParser] Parsing ${language} file: ${path.basename(normalizedFilePath)}`);

        try {
            // Assume the sharedParser already has the correct language grammar set by AnalyzerService
            const tree = this.sharedParser.parse(fileContent);
            const visitor = new CCppAstVisitor(normalizedFilePath, language);
            visitor.visit(tree.rootNode);

            logger.info(`[CCppParser] Parsed ${path.basename(normalizedFilePath)}. Nodes: ${visitor.nodes.length}, Rels: ${visitor.relationships.length}.`);
            return {
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

        } catch (error: any) {
            logger.error(`[CCppParser] Error parsing ${normalizedFilePath}`, {
                 errorMessage: error.message,
                 stack: error.stack?.substring(0, 500)
            });
            // Return empty result on error to allow analysis to continue for other files
            return { nodes: [], relationships: [] };
            // Or rethrow if preferred: throw new ParserError(`Failed C/C++ parsing for ${normalizedFilePath}`, { originalError: error });
        }
    }
}