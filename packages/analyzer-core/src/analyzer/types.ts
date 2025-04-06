// src/analyzer/types.ts
import winston from 'winston'; // Import Logger type
import ts from 'typescript'; // Needed for ts.Node below, ensure typescript is a dependency if not already
import { SourceFile } from 'ts-morph'; // Import ts-morph SourceFile


// --- Core Types ---

/**
 * Represents a generic node in the Abstract Syntax Tree (AST).
 * This is the base interface extended by language-specific node types.
 */
export interface AstNode {
    id: string;             // Unique instance ID for this node in this specific parse run
    entityId: string;       // Globally unique identifier for the code entity (e.g., file path + function name + line)
    kind: string;           // Type of the node (e.g., 'File', 'Function', 'Class', 'Import')
    labels?: string[];      // Optional: Neo4j labels for the node
    name: string;           // Name of the node (e.g., function name, class name, filename)
    type?: string;          // Optional: Type information (e.g., variable type, function return type) - Deprecated, use specific fields like returnType, dataType
    /** Relative path from the project root to the file containing this node */
    filePath: string;
    startLine: number;      // Starting line number (1-based)
    endLine: number;        // Ending line number (1-based)
    startColumn: number;    // Starting column number (0-based)
    endColumn: number;      // Ending column number (0-based)
    language: string;       // Programming language (e.g., 'TypeScript', 'Python', 'Java')
    loc?: number;           // Lines of code (optional)
    properties?: Record<string, any>; // Catch-all for additional language-specific or parser-specific properties
    signature?: string;     // Optional: Full function/method signature string
    dataType?: string;      // Optional: Specific data type (e.g., for variables, parameters, fields)
    scope?: string;         // Optional: Scope identifier (e.g., class name, function name, global)
    isExported?: boolean;   // Optional: Indicates if the node is exported
    complexity?: number;    // Optional: Cyclomatic complexity or similar metric
    isAbstract?: boolean;   // Optional: Indicates if a class/method is abstract
    isAsync?: boolean;      // Optional: Indicates if a function/method is async
    isOptional?: boolean;   // Optional: Indicates if a parameter/property is optional
    isStatic?: boolean;     // Optional: Indicates if a member is static
    isGenerator?: boolean;  // Optional: Indicates if a function is a generator
    isRestParameter?: boolean; // Optional: Indicates if a parameter is a rest parameter
    isConstant?: boolean;   // Optional: Indicates if a variable is constant
    accessModifier?: 'public' | 'private' | 'protected' | 'internal' | 'package'; // Optional: Visibility/access modifier
    returnType?: string;    // Optional: Return type of a function/method
    decorators?: string[];  // Optional: List of decorator names
    implementsInterfaces?: string[]; // Optional: List of implemented interface names
    modifierFlags?: string[]; // Optional: List of modifier keywords (e.g., 'export', 'async', 'static')
    tags?: string[];        // Optional: List of tags (e.g., from JSDoc @tags)
    documentation?: string; // Optional: Documentation string (e.g., from JSDoc)
    docComment?: string;    // Optional: Raw documentation comment
    parentId?: string;      // Optional entityId of the parent node (e.g., class containing a method)
    createdAt: string;      // ISO timestamp of creation
}

// Java Specific Nodes
export interface JavaPackageNode extends AstNode { // Use AstNode as the base
    kind: 'JavaPackage';
}


/**
 * Represents a relationship between two AstNode objects.
 */
export interface RelationshipInfo {
    id: string;             // Unique instance ID for this relationship in this specific parse run
    entityId: string;       // Globally unique identifier for the relationship instance (DEPRECATED - use relationshipId)
    relationshipId: string; // Globally unique identifier for the relationship (sourceId:type:targetId)
    type: string;           // Type of the relationship (e.g., 'CALLS', 'IMPORTS', 'EXTENDS')
    sourceId: string;       // entityId of the source node
    targetId: string;       // entityId of the target node
    properties?: Record<string, any>; // Additional properties for the relationship
    weight?: number;        // Optional weight for ranking or analysis
    language?: string;      // Optional: Language context for the relationship (e.g., 'C++' for EXTENDS)
    createdAt: string;      // ISO timestamp of creation
}

/**
 * Represents the result of parsing a single file.
 */
export interface SingleFileParseResult {
    filePath: string;
    nodes: AstNode[];
    relationships: RelationshipInfo[];
}


/**
 * Interface for language-specific parsers.
 */
export interface LanguageParser {
    /**
     * Parses the content of a single file.
     * @param filePath - The absolute path to the file.
     * @param fileContent - The content of the file.
     * @returns A promise resolving to the extracted nodes and relationships.
     */
    parse(filePath: string, fileContent: string): Promise<{ nodes: AstNode[], relationships: RelationshipInfo[] }>;
}

/**
 * Helper type for generating unique instance IDs during a parse run.
 */
export interface InstanceCounter {
    count: number;
}


/**
 * Context object passed to parser functions.
 */
export interface ParserContext {
    filePath: string;
    sourceFile: SourceFile; // Use ts-morph SourceFile
    fileNode: FileNode; // Reference to the FileNode being processed
    result: SingleFileParseResult; // The accumulating result for the current file
    addNode: (node: AstNode) => void;
    addRelationship: (rel: RelationshipInfo) => void;
    generateId: (prefix: string, identifier: string, options?: { line?: number; column?: number }) => string;
    generateEntityId: (kind: string, qualifiedName: string) => string;
    generateRelationshipId: (sourceId: string, targetId: string, type: string) => string;
    logger: winston.Logger;
    resolveImportPath: (sourcePath: string, importPath: string) => string;
    now: string;
    // Add any other properties needed during parsing
}


/**
 * Represents the resolved information about a target declaration, used in Pass 2.
 */
export interface TargetDeclarationInfo {
    name: string;
    kind: string; // e.g., 'Function', 'Class', 'Variable', 'Interface', 'Method', 'Parameter'
    filePath: string; // Absolute, normalized path
    entityId: string; // Globally unique ID matching Pass 1 generation
}

/**
 * Context object passed to relationship resolver functions.
 */
export interface ResolverContext {
    nodeIndex: Map<string, AstNode>;
    addRelationship: (rel: RelationshipInfo) => void;
    addNode: (node: AstNode) => void; // Add function to add/merge nodes
    generateId: (prefix: string, identifier: string, options?: { line?: number; column?: number }) => string;
    generateEntityId: (kind: string, qualifiedName: string) => string;
    logger: winston.Logger;
    resolveImportPath: (sourcePath: string, importPath: string) => string;
    now: string;
}


// --- Language Agnostic Node Kinds (Examples) ---

export interface FileNode extends AstNode {
    kind: 'File';
    loc: number; // Lines of code for the file
}

// --- Component Node (e.g., for React/Vue/Svelte) ---
export interface ComponentNode extends AstNode {
    kind: 'Component';
    properties?: {
        isExported?: boolean;
        isDefaultExport?: boolean;
    } & Record<string, any>; // Allow other properties
}



// --- JSX Specific Nodes ---

export interface JSXElementNode extends AstNode {
    kind: 'JSXElement';
    properties: {
        tagName: string;
        isSelfClosing: boolean;
    } & Record<string, any>;
}

export interface JSXAttributeNode extends AstNode {
    kind: 'JSXAttribute';
    parentId: string; // entityId of the parent JSXElement
    properties: {
        value?: string | boolean | object; // Attribute value can be complex
    } & Record<string, any>;
}

// --- Tailwind Specific Node (Example) ---
// This might be better represented as a property or relationship
// depending on how you want to model Tailwind usage.
export interface TailwindClassNode extends AstNode {
    kind: 'TailwindClass';
    parentId: string; // entityId of the node using the class (e.g., JSXElement)
    properties: {
        className: string;
    } & Record<string, any>;
}


// --- C/C++ Specific Nodes ---

export interface IncludeDirectiveNode extends AstNode {
    kind: 'IncludeDirective';
    properties: {
        includePath: string;
        isSystemInclude: boolean;
    };
}

export interface MacroDefinitionNode extends AstNode {
    kind: 'MacroDefinition';
    properties: {
        value?: string; // Value might be optional or complex
    };
}

export interface CFunctionNode extends AstNode {
    kind: 'CFunction';
    language: 'C' | 'C++'; // Can be in C or C++ files
    parentId?: string; // Optional link to struct/namespace entityId if applicable
    // TODO: Add parameters, return type
}

export interface CppClassNode extends AstNode {
    kind: 'CppClass';
    language: 'C++';
    properties?: {
        // TODO: Add base classes, template parameters
    } & Record<string, any>;
}

export interface CppMethodNode extends AstNode {
    kind: 'CppMethod';
    language: 'C++';
    parentId: string; // Link to containing class entityId
    // TODO: Add parameters, return type, modifiers (const, virtual, static)
}

// --- Java Specific Nodes ---

export interface PackageDeclarationNode extends AstNode {
    kind: 'PackageDeclaration';
}

export interface ImportDeclarationNode extends AstNode {
    kind: 'ImportDeclaration';
    properties: {
        importPath: string;
        onDemand: boolean; // For wildcard imports like java.util.*
    };
}

export interface JavaClassNode extends AstNode {
    kind: 'JavaClass';
    language: 'Java';
    properties: {
        qualifiedName: string;
        // TODO: Add modifiers, superclass, interfaces
    };
}

export interface JavaInterfaceNode extends AstNode {
    kind: 'JavaInterface';
    language: 'Java';
    properties: {
        qualifiedName: string;
        // TODO: Add modifiers, extends list
    };
}

export interface JavaMethodNode extends AstNode {
    kind: 'JavaMethod';
    language: 'Java';
    parentId?: string;
    // TODO: Add return type, parameters, modifiers, throws
}

export interface JavaFieldNode extends AstNode {
    kind: 'JavaField';
    language: 'Java';
    parentId?: string;
    // TODO: Add type, modifiers
}

export interface JavaEnumNode extends AstNode {
    kind: 'JavaEnum';
    language: 'Java';
    properties: {
        qualifiedName: string;
        // TODO: Add implements list, enum constants
    };
}


// --- Go Specific Nodes ---

export interface PackageClauseNode extends AstNode {
    kind: 'PackageClause';
    language: 'Go';
}

export interface ImportSpecNode extends AstNode {
    kind: 'ImportSpec';
    language: 'Go';
    properties: {
        importPath: string;
        alias?: string;
    };
}

export interface GoFunctionNode extends AstNode {
    kind: 'GoFunction';
    language: 'Go';
    properties: {
        qualifiedName: string;
        // TODO: Add parameters, return type
    };
}

export interface GoMethodNode extends AstNode {
    kind: 'GoMethod';
    language: 'Go';
    parentId?: string; // Link to receiver type entityId
    properties: {
        receiverType: string;
        // TODO: Add parameters, return type
    };
}

export interface GoStructNode extends AstNode {
    kind: 'GoStruct';
    language: 'Go';
    properties: {
        qualifiedName: string;
        // TODO: Add fields
    };
}

export interface GoInterfaceNode extends AstNode {
    kind: 'GoInterface';
    language: 'Go';
    properties: {
        qualifiedName: string;
        // TODO: Add methods
    };
}

export interface TypeAlias extends AstNode { // For Go type aliases
    kind: 'TypeAlias';
    language: 'Go';
    properties: {
        qualifiedName: string;
        aliasedType: string; // Store the underlying type as string for now
    };
}



// --- C# Specific Nodes ---

export interface NamespaceDeclarationNode extends AstNode {
    kind: 'NamespaceDeclaration';
    language: 'C#';
}

export interface UsingDirectiveNode extends AstNode {
    kind: 'UsingDirective';
    language: 'C#';
    properties: {
        namespaceOrType: string;
        isStatic: boolean;
        alias?: string;
    };
}

export interface CSharpClassNode extends AstNode {
    kind: 'CSharpClass';
    language: 'C#';
    properties: {
        qualifiedName: string;
        // TODO: Add modifiers, base list
    };
}

export interface CSharpInterfaceNode extends AstNode {
    kind: 'CSharpInterface';
    language: 'C#';
    properties: {
        qualifiedName: string;
        // TODO: Add modifiers, base list
    };
}

export interface CSharpStructNode extends AstNode {
    kind: 'CSharpStruct';
    language: 'C#';
    properties: {
        qualifiedName: string;
        // TODO: Add modifiers, base list
    };
}

export interface CSharpMethodNode extends AstNode {
    kind: 'CSharpMethod';
    language: 'C#';
    parentId?: string; // Link to containing class/struct/interface entityId
    // TODO: Add return type, parameters, modifiers
}

export interface PropertyNode extends AstNode { // For C# Properties
    kind: 'Property';
    language: 'C#';
    parentId?: string; // Link to containing class/struct/interface entityId
    // TODO: Add type, modifiers, accessors
}

export interface FieldNode extends AstNode { // For C# Fields
    kind: 'Field';
    language: 'C#';
    parentId?: string; // Link to containing class/struct/interface entityId
    // TODO: Add type, modifiers
}

// --- SQL Specific Nodes ---

export interface SQLTableNode extends AstNode {
    kind: 'SQLTable';
    language: 'SQL';
    properties: {
        qualifiedName: string;
        schema?: string | null;
    };
}

export interface SQLColumnNode extends AstNode {
    kind: 'SQLColumn';
    language: 'SQL';
    parentId: string; // entityId of the parent table
    properties: {
        dataType: string;
        // TODO: Add constraints (PK, FK, NULL, UNIQUE, DEFAULT)
    };
}

export interface SQLViewNode extends AstNode {
    kind: 'SQLView';
    language: 'SQL';
    properties: {
        qualifiedName: string;
        schema?: string | null;
        queryText: string; // Store the underlying query
    };
}

// Base type for different SQL statement kinds
export interface SQLStatementNode extends AstNode {
    kind: 'SQLSelectStatement' | 'SQLInsertStatement' | 'SQLUpdateStatement' | 'SQLDeleteStatement'; // Add other DML/DDL types as needed
    language: 'SQL';
    properties: {
        queryText: string; // Store the full statement text
    };
}


// --- Python Specific Nodes ---
// (Add Python-specific interfaces here if needed, e.g., PythonFunction, PythonClass)

// --- TypeScript/JavaScript Specific Nodes ---
// (Add TS/JS-specific interfaces here if needed)
export interface TSFunction extends AstNode {
    kind: 'TSFunction';
    properties?: {
        isExported?: boolean;
        isDefaultExport?: boolean;
        isAsync?: boolean;
    } & Record<string, any>;
}


// --- Relationship Types (Examples - can be language-specific) ---
// CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES_FUNCTION, DEFINES_CLASS, HAS_METHOD, HAS_FIELD, etc.