// src/analyzer/parsers/java-parser.ts
import type { default as TreeSitterParser } from 'tree-sitter'; // Import the type
// Grammar is loaded by ParserFactory
// import Java from 'tree-sitter-java';
import path from 'path';
import fs from 'fs/promises';
import { createContextLogger } from '../../utils/logger.js';
 // Corrected path
import { ParserError } from '../../utils/errors.js';
 // Corrected path
import { FileInfo } from '../../scanner/file-scanner.js';
 // Corrected path
 // Corrected path // Corrected path
import { AstNode, RelationshipInfo, LanguageParser, InstanceCounter, PackageDeclarationNode, JavaPackageNode, ImportDeclarationNode, JavaClassNode, JavaInterfaceNode, JavaMethodNode, JavaFieldNode, JavaEnumNode } from '../types.js'; // Import LanguageParser
import { ensureTempDir, getTempFilePath, generateInstanceId, generateEntityId, generateRelationshipId } from '../parser-utils.js';
 // Corrected path
 // Corrected path

const logger = createContextLogger('JavaParser');

// Helper to get node text safely
function getNodeText(node: TreeSitterParser.SyntaxNode | null | undefined): string {
    return node?.text ?? '';
}

// Helper to get location
function getNodeLocation(node: TreeSitterParser.SyntaxNode): { startLine: number, endLine: number, startColumn: number, endColumn: number } {
    return {
        startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
        startColumn: node.startPosition.column, endColumn: node.endPosition.column,
    };
}

// --- Tree-sitter Visitor ---
class JavaAstVisitor {
    public nodes: AstNode[] = [];
    public relationships: RelationshipInfo[] = [];
    private instanceCounter: InstanceCounter = { count: 0 };
    private fileNode: AstNode;
    private now: string = new Date().toISOString();
    private currentPackage: string | null = null;
    private currentClassOrInterfaceId: string | null = null; // Store entityId

    constructor(private filepath: string) {
        const filename = path.basename(filepath);
        const fileEntityId = generateEntityId('file', filepath);
        this.fileNode = {
            id: generateInstanceId(this.instanceCounter, 'file', filename),
            entityId: fileEntityId, kind: 'File', name: filename, filePath: filepath,
            startLine: 1, endLine: 0, startColumn: 0, endColumn: 0,
            language: 'Java', createdAt: this.now,
        };
        this.nodes.push(this.fileNode);
    }

    visit(node: TreeSitterParser.SyntaxNode) {
        // Process the current node first
        this.visitNode(node); // Always process the node

        // Always recurse into children
        for (const child of node.namedChildren) {
            this.visit(child);
        }

        if (node.type === 'program') { // Root node type for Java
             this.fileNode.endLine = node.endPosition.row + 1;
             this.fileNode.loc = this.fileNode.endLine;
        }
    }

    private visitNode(node: TreeSitterParser.SyntaxNode) {
        try {
            switch (node.type) {
                case 'package_declaration':
                    this.visitPackageDeclaration(node);
                    break;
                case 'import_declaration':
                    this.visitImportDeclaration(node);
                    break;
                case 'class_declaration':
                    this.visitClassOrInterfaceDeclaration(node, 'JavaClass');
                    break;
                case 'interface_declaration':
                     this.visitClassOrInterfaceDeclaration(node, 'JavaInterface');
                     break;
                case 'enum_declaration':
                     this.visitEnumDeclaration(node);
                     break;
                case 'method_declaration':
                     this.visitMethodDeclaration(node);
                     break;
                case 'constructor_declaration': // Handle constructors explicitly
                     this.visitConstructorDeclaration(node);
                     break;
                case 'field_declaration':
                     this.visitFieldDeclaration(node);
                     break;
                // No need to explicitly handle body nodes here, main visit loop handles recursion
            }
        } catch (error: any) {
             logger.warn(`[JavaAstVisitor] Error visiting node type ${node.type} in ${this.filepath}: ${error.message}`);
        }
    }

    private visitPackageDeclaration(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const packageName = getNodeText(node.namedChild(0)); // Assuming name is the first named child
        this.currentPackage = packageName;

        // Revert to original entityId including filepath
        const entityId = generateEntityId('packagedeclaration', `${this.filepath}:${packageName}`);
        const packageNode: PackageDeclarationNode = { // Revert type
            id: generateInstanceId(this.instanceCounter, 'package', packageName, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'PackageDeclaration', name: packageName,
 // Revert kind
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
        };
        this.nodes.push(packageNode);

        // Relationship: File -> DECLARES_PACKAGE -> PackageDeclaration
        const relEntityId = generateEntityId('declares_package', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'declares_package', `${this.fileNode.id}:${packageNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DECLARES_PACKAGE'),
            type: 'DECLARES_PACKAGE',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });
    }

    private visitImportDeclaration(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const importPath = getNodeText(node.namedChild(0)); // Assuming path is first named child
        const onDemand = getNodeText(node).endsWith('.*'); // Simple check for wildcard

        const entityId = generateEntityId('importdeclaration', `${this.filepath}:${importPath}:${location.startLine}`);
        const importNode: ImportDeclarationNode = {
            id: generateInstanceId(this.instanceCounter, 'import', importPath, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'ImportDeclaration', name: importPath,
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
            properties: { importPath, onDemand }
        };
        this.nodes.push(importNode);

        // Relationship: File -> JAVA_IMPORTS -> ImportDeclaration
        // Target resolution happens in Pass 2
        const relEntityId = generateEntityId('java_imports', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'java_imports', `${this.fileNode.id}:${importNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'JAVA_IMPORTS'),
            type: 'JAVA_IMPORTS',
            sourceId: this.fileNode.entityId, targetId: entityId, // Target is the import node itself for now
            createdAt: this.now, weight: 5,
        });
    }

    private visitClassOrInterfaceDeclaration(node: TreeSitterParser.SyntaxNode, kind: 'JavaClass' | 'JavaInterface') {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        const originalClassOrInterfaceId = this.currentClassOrInterfaceId; // Backup context
        const qualifiedName = this.currentPackage ? `${this.currentPackage}.${name}` : name;
        const entityId = generateEntityId(kind.toLowerCase(), qualifiedName); // Use qualified name for entity ID

        const classNode: AstNode = { // Use base AstNode, specific type depends on kind
            id: generateInstanceId(this.instanceCounter, kind.toLowerCase(), name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: kind, name: name,
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
            properties: { qualifiedName }
            // TODO: Add extends/implements info to properties
        };
        this.nodes.push(classNode);
        this.currentClassOrInterfaceId = entityId; // Set context for methods/fields

        // Relationship: File -> DEFINES_CLASS/DEFINES_INTERFACE -> Class/Interface
        const relType = kind === 'JavaClass' ? 'DEFINES_CLASS' : 'DEFINES_INTERFACE';
        const relEntityId = generateEntityId(relType.toLowerCase(), `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, relType.toLowerCase(), `${this.fileNode.id}:${classNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, relType),
            type: relType,
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // Handle extends (superclass)
        const superclassNode = node.childForFieldName('superclass')?.childForFieldName('type');
        if (superclassNode) {
            const superclassName = getNodeText(superclassNode);
            if (superclassName) {
                const placeholderTargetId = `placeholder:${superclassName}`;
                const relType = 'EXTENDS';
                const relEntityId = generateEntityId(relType.toLowerCase(), `${entityId}:${placeholderTargetId}`);
                this.relationships.push({
                    id: generateInstanceId(this.instanceCounter, relType.toLowerCase(), `${classNode.id}:${superclassName}`),
                    entityId: relEntityId,
                    relationshipId: generateRelationshipId(entityId, placeholderTargetId, relType),
                    type: relType, sourceId: entityId, targetId: placeholderTargetId,
                    language: 'Java', properties: { targetName: superclassName },
                    createdAt: this.now, weight: 10,
                });
            }
        }

        // Handle implements (interfaces)
        const interfacesNode = node.childForFieldName('interfaces')?.childForFieldName('type_list');
        if (interfacesNode) {
            interfacesNode.namedChildren.forEach(interfaceTypeNode => {
                const interfaceName = getNodeText(interfaceTypeNode);
                if (interfaceName) {
                    const placeholderTargetId = `placeholder:${interfaceName}`;
                    const relType = 'IMPLEMENTS';
                    const relEntityId = generateEntityId(relType.toLowerCase(), `${entityId}:${placeholderTargetId}`);
                    this.relationships.push({
                        id: generateInstanceId(this.instanceCounter, relType.toLowerCase(), `${classNode.id}:${interfaceName}`),
                        entityId: relEntityId,
                        relationshipId: generateRelationshipId(entityId, placeholderTargetId, relType),
                        type: relType, sourceId: entityId, targetId: placeholderTargetId,
                        language: 'Java', properties: { targetName: interfaceName },
                        createdAt: this.now, weight: 10,
                    });
                }
            });
        }

        // Let main visit loop handle recursion into body
        // const bodyNode = node.childForFieldName('body');
        // if (bodyNode) {
        //     this.visit(bodyNode); // Recurse into the body
        // }

        // Restore context AFTER visiting children (handled by main visit loop finishing siblings)
        // this.currentClassOrInterfaceId = originalClassOrInterfaceId; // Defer restoration
    }

     private visitMethodDeclaration(node: TreeSitterParser.SyntaxNode) {
        if (!this.currentClassOrInterfaceId) return; // Only process methods within a class/interface context

        const location = getNodeLocation(node);
        // Use 'name' field which works for regular methods
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);

        if (!name) {
            logger.warn(`[JavaAstVisitor] Could not find name for method_declaration at ${this.filepath}:${location.startLine}`);
            return;
        }

        const methodEntityId = generateEntityId('javamethod', `${this.currentClassOrInterfaceId}.${name}`); // ID relative to parent
        const methodNode: JavaMethodNode = {
            id: generateInstanceId(this.instanceCounter, 'javamethod', name, { line: location.startLine, column: location.startColumn }),
            entityId: methodEntityId, kind: 'JavaMethod', name: name,
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
            parentId: this.currentClassOrInterfaceId,
            // TODO: Extract parameters, return type, modifiers
        };
        this.nodes.push(methodNode);

        // Relationship: Class/Interface -> HAS_METHOD -> Method
        const relEntityId = generateEntityId('has_method', `${this.currentClassOrInterfaceId}:${methodEntityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_method', `${this.currentClassOrInterfaceId}:${methodNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.currentClassOrInterfaceId, methodEntityId, 'HAS_METHOD'),
            type: 'HAS_METHOD',
            sourceId: this.currentClassOrInterfaceId, targetId: methodEntityId,
            createdAt: this.now, weight: 8,
        });
        // TODO: Visit parameters within the method signature
        // TODO: Visit method body for calls
    }

    // Separate visitor for constructors
    private visitConstructorDeclaration(node: TreeSitterParser.SyntaxNode) {
        if (!this.currentClassOrInterfaceId) return;

        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name'); // Constructor name is in 'name' field
        const name = getNodeText(nameNode);

        if (!name) {
            logger.warn(`[JavaAstVisitor] Could not find name for constructor_declaration at ${this.filepath}:${location.startLine}`);
            return;
        }

        // Verify name matches the current class context
        const parentClassNode = this.nodes.find(n => n.entityId === this.currentClassOrInterfaceId);
        if (!parentClassNode || name !== parentClassNode.name) {
             logger.warn(`[JavaAstVisitor] Constructor name "${name}" does not match class name "${parentClassNode?.name}" at ${this.filepath}:${location.startLine}`);
             return; // Likely a parsing error or unexpected structure
        }


        const methodEntityId = generateEntityId('javamethod', `${this.currentClassOrInterfaceId}.${name}`); // Use same kind for simplicity
        const methodNode: JavaMethodNode = {
            id: generateInstanceId(this.instanceCounter, 'javamethod', name, { line: location.startLine, column: location.startColumn }),
            entityId: methodEntityId, kind: 'JavaMethod', name: name, // Treat as a method
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
            parentId: this.currentClassOrInterfaceId,
            properties: { isConstructor: true } // Add property to distinguish
            // TODO: Extract parameters, modifiers
        };
        this.nodes.push(methodNode);

        // Relationship: Class -> HAS_METHOD -> Constructor
        const relEntityId = generateEntityId('has_method', `${this.currentClassOrInterfaceId}:${methodEntityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'has_method', `${this.currentClassOrInterfaceId}:${methodNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.currentClassOrInterfaceId, methodEntityId, 'HAS_METHOD'),
            type: 'HAS_METHOD',
            sourceId: this.currentClassOrInterfaceId, targetId: methodEntityId,
            createdAt: this.now, weight: 8,
        });
        // TODO: Visit parameters
        // TODO: Visit body
    }


     private visitFieldDeclaration(node: TreeSitterParser.SyntaxNode) {
        if (!this.currentClassOrInterfaceId) return; // Only process fields within a class/interface context

        const location = getNodeLocation(node);
        // Field declaration can have multiple variables (e.g., int x, y;)
        // The structure is typically: modifiers type declarator(s);
        const declaratorList = node.namedChildren.filter(c => c.type === 'variable_declarator');

        if (declaratorList.length === 0) {
             logger.warn(`[JavaAstVisitor] No variable_declarator found in field_declaration at ${this.filepath}:${location.startLine}`);
             return;
        }


        for (const declarator of declaratorList) {
             const nameNode = declarator.childForFieldName('name'); // Tree-sitter Java uses 'name'
             const name = getNodeText(nameNode);
             if (!name) continue;

             const fieldEntityId = generateEntityId('javafield', `${this.currentClassOrInterfaceId}.${name}`);
             const fieldNode: JavaFieldNode = {
                 id: generateInstanceId(this.instanceCounter, 'javafield', name, { line: location.startLine, column: location.startColumn }), // Use declarator location?
                 entityId: fieldEntityId, kind: 'JavaField', name: name,
                 filePath: this.filepath, language: 'Java', ...getNodeLocation(declarator), createdAt: this.now, // Use declarator location
                 parentId: this.currentClassOrInterfaceId,
                 // TODO: Extract type, modifiers from parent 'field_declaration' node
             };
             this.nodes.push(fieldNode);

             // Relationship: Class/Interface -> HAS_FIELD -> Field
             const relEntityId = generateEntityId('has_field', `${this.currentClassOrInterfaceId}:${fieldEntityId}`);
             this.relationships.push({
                 id: generateInstanceId(this.instanceCounter, 'has_field', `${this.currentClassOrInterfaceId}:${fieldNode.id}`),
                 entityId: relEntityId,
                 relationshipId: generateRelationshipId(this.currentClassOrInterfaceId, fieldEntityId, 'HAS_FIELD'),
                 type: 'HAS_FIELD',
                 sourceId: this.currentClassOrInterfaceId, targetId: fieldEntityId,
                 createdAt: this.now, weight: 7,
             });
        }
    }

    private visitEnumDeclaration(node: TreeSitterParser.SyntaxNode) {
        const location = getNodeLocation(node);
        const nameNode = node.childForFieldName('name');
        const name = getNodeText(nameNode);
        if (!name) return;

        const qualifiedName = this.currentPackage ? `${this.currentPackage}.${name}` : name;
        const entityId = generateEntityId('javaenum', qualifiedName);

        const enumNode: JavaEnumNode = {
            id: generateInstanceId(this.instanceCounter, 'javaenum', name, { line: location.startLine, column: location.startColumn }),
            entityId: entityId, kind: 'JavaEnum', name: name,
            filePath: this.filepath, language: 'Java', ...location, createdAt: this.now,
            properties: { qualifiedName }
            // TODO: Extract enum constants from body
        };
        this.nodes.push(enumNode);

        // Relationship: File -> DEFINES_ENUM -> Enum
        const relEntityId = generateEntityId('defines_enum', `${this.fileNode.entityId}:${entityId}`);
        this.relationships.push({
            id: generateInstanceId(this.instanceCounter, 'defines_enum', `${this.fileNode.id}:${enumNode.id}`),
            entityId: relEntityId,
            relationshipId: generateRelationshipId(this.fileNode.entityId, entityId, 'DEFINES_ENUM'),
            type: 'DEFINES_ENUM',
            sourceId: this.fileNode.entityId, targetId: entityId,
            createdAt: this.now, weight: 9,
        });

        // Let main visit loop handle recursion into body
        // const bodyNode = node.childForFieldName('body');
        // if (bodyNode) {
        //     this.visit(bodyNode);
        // }
    }
}

/**
 * Parses Java files using Tree-sitter.
 */
export class JavaParser implements LanguageParser {
    private sharedParser: TreeSitterParser;

    constructor(sharedParser: TreeSitterParser) {
        this.sharedParser = sharedParser; // Store shared parser
        // Language is set by AnalyzerService
        logger.debug('JavaParser initialized with shared Tree-sitter parser.');
    }

    /**
     * Parses Java file content using Tree-sitter.
     * @param filePath - The absolute path to the file being parsed.
     * @param fileContent - The source code content.
     * @returns {Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }>} Parsed nodes and relationships.
     * @throws {ParserError} If parsing fails.
     */
    async parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[]; relationships: RelationshipInfo[] }> {
        const normalizedFilePath = filePath.replace(/\\/g, '/');
        logger.info(`[JavaParser] Parsing Java file: ${path.basename(normalizedFilePath)}`);

        try {
            // Assume sharedParser has Java language set by AnalyzerService
            const tree = this.sharedParser.parse(fileContent);
            const visitor = new JavaAstVisitor(normalizedFilePath);
            visitor.visit(tree.rootNode);

            logger.info(`[JavaParser] Parsed ${path.basename(normalizedFilePath)}. Nodes: ${visitor.nodes.length}, Rels: ${visitor.relationships.length}.`);
            return {
                nodes: visitor.nodes,
                relationships: visitor.relationships,
            };

        } catch (error: any) {
            logger.error(`[JavaParser] Error parsing ${normalizedFilePath}`, {
                 errorMessage: error.message,
                 stack: error.stack?.substring(0, 500)
            });
            // Return empty result on error
            return { nodes: [], relationships: [] };
            // Or rethrow: throw new ParserError(`Failed Java parsing for ${normalizedFilePath}`, { originalError: error });
        }
    }
}