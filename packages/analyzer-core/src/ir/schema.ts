/**
 * @file Defines the core Intermediate Representation (IR) schema for the Code Connectome.
 * This schema aims to be language-agnostic where possible, capturing essential
 * structural elements and potential relationships across TypeScript, Python, SQL, and Java.
 * Inspired by concepts from Kythe and CodeQL.
 * Based on docs/architecture_connectome.md
 */

// --- Core Types ---

/**
 * Represents a position within a file. (1-based line, 0-based column for consistency with many tools)
 */
export interface Position {
  line: number; // 1-based line number
  column: number; // 0-based column number
}

/**
 * Represents a location range within a file.
 */
export interface Location {
  start: Position;
  end: Position;
}

/**
 * Enumeration of supported source languages.
 * Ensure these values are consistent with parser implementations and file extension mappings.
 */
export enum Language {
  TypeScript = 'TYPESCRIPT',
  JavaScript = 'JAVASCRIPT',
  Python = 'PYTHON',
  SQL = 'SQL',
  Java = 'JAVA',
  TSX = 'TSX',
  Go = 'GO', // Add Go
  CSharp = 'CSHARP', // Add CSharp
  C = 'C', // Add C
  CPP = 'CPP', // Add CPP
  // Add other languages as needed
  Unknown = 'UNKNOWN', // Fallback for unsupported types
}

/**
 * Represents the type of a defined code or infrastructure element in the IR.
 * These types form the basis for nodes in the Code Connectome graph.
 * Aligned with Canonical ID entity types.
 */
export type ElementType =
  | 'File' // Represents the file itself, implicitly defined by FileIr
  | 'Module' // e.g., Python module, TS/JS module
  | 'Package' // e.g., Java package
  | 'Class'
  | 'Interface'
  | 'Enum'
  | 'Function' // Standalone functions
  | 'Method' // Functions bound to a class/interface/enum
  | 'Variable' // Includes local variables, parameters, constants
  | 'Field' // Class/object properties
  | 'TypeAlias' // e.g., TypeScript type alias, Java typedef (less common)
  | 'AnnotationDefinition' // Definition of an annotation/decorator
  | 'ApiRouteDefinition' // Backend route definition (e.g., Express, Flask, Spring MVC)
  | 'DatabaseSchemaDefinition' // Represents a whole schema definition block/file
  | 'DatabaseTable'
  | 'DatabaseView'
  | 'DatabaseColumn'
  | 'DatabaseFunction' // Stored function/procedure in DB
  | 'DatabaseProcedure' // Stored procedure in DB
  | 'GenericElement'; // Fallback for elements not fitting other categories

/**
 * Represents the type of a potential relationship observed in the code.
 * These are unresolved references or actions found by parsers.
 * They are processed by resolvers to create concrete graph edges between IrElements.
 */
export type RelationshipType =
  | 'Imports' // Importing a module/package or specific entities from it
  | 'Calls' // Function/method call
  | 'ApiFetch' // Frontend/client-side API call (e.g., fetch, axios)
  | 'DatabaseQuery' // ORM usage or raw SQL execution from application code
  | 'Inherits' // Class extends Class, Interface extends Interface
  | 'Implements' // Class implements Interface
  | 'Instantiates' // Creating an instance of a class
  | 'Reads' // Reading from a variable/field
  | 'Writes' // Writing to a variable/field
  | 'UsesAnnotation' // Applying an annotation/decorator to an element
  | 'ReferencesType' // Using a type (class, interface, enum, alias) in a signature or declaration
  | 'ReferencesElement'; // Generic reference when specific type is unknown/unclear

// --- Canonical ID ---

/**
 * Represents a Canonical ID string - a unique, project-wide identifier for an IrElement.
 * Format: connectome://<project_id>/<element_type>:<file_path>#<fragment>
 * - project_id: Unique identifier for the analyzed project.
 * - element_type: Lowercase version of ElementType (e.g., 'function', 'class').
 * - file_path: Project-relative path to the file containing the element.
 * - fragment: Identifier unique within the file (e.g., 'ClassName.methodName(sig)', 'funcName(sig)', 'varName', 'tableName.colName', 'GET:/api/users/{id}').
 * The exact fragment generation logic is defined elsewhere (e.g., ir-utils).
 */
export type CanonicalId = string;

// --- IR Element Detail Interfaces (Properties) ---
// These define the structure of the `properties` field for specific ElementTypes.

export interface BaseElementProperties {
  /** Language of the element's definition. */
  language: Language;
  /** Optional: Parent element ID (e.g., class containing a method, file containing a function). */
  parentId?: CanonicalId;
  /** Optional: Access modifier if applicable (e.g., public, private, protected). */
  accessModifier?: 'public' | 'private' | 'protected' | 'internal' | 'package';
  /** Optional: Snippet of the definition signature for context. */
  rawSignature?: string;
}

export interface ModuleProperties extends BaseElementProperties {
  // Module-specific properties, if any (e.g., exports list?)
}

export interface PackageProperties extends BaseElementProperties {
  // Package-specific properties, if any
}

export interface ParameterDetail {
  name: string;
  type?: string; // Language-specific type string
  position: number; // 0-based index
}

export interface FunctionLikeProperties extends BaseElementProperties {
  parameters?: ParameterDetail[];
  returnType?: string; // Language-specific type string
  isAsync?: boolean;
  isStatic?: boolean; // Applicable for methods
  isAbstract?: boolean; // Applicable for methods
  signature?: string; // Formal signature (e.g., `(String, int): boolean`) - used for fragment generation
}

export interface FunctionProperties extends FunctionLikeProperties {
  // Function-specific properties
}

export interface MethodProperties extends FunctionLikeProperties {
  // Method-specific properties (often identical to FunctionProperties)
  // parentId MUST be defined and point to Class/Interface/Enum
}

export interface ClassProperties extends BaseElementProperties {
  extends?: CanonicalId[]; // IDs of parent classes (support multiple for mixins if needed?)
  implements?: CanonicalId[]; // IDs of implemented interfaces
  isAbstract?: boolean;
  // Members (methods, fields) are separate IrElements linked via parentId
}

export interface InterfaceProperties extends BaseElementProperties {
  extends?: CanonicalId[]; // IDs of parent interfaces
  // Members are separate IrElements linked via parentId
}

export interface EnumProperties extends BaseElementProperties {
  // Members (enum constants) could be Fields or specific EnumMember elements
}

export interface VariableProperties extends BaseElementProperties {
  dataType?: string; // Language-specific type string
  isConstant?: boolean;
}

export interface FieldProperties extends VariableProperties {
  isStatic?: boolean;
  // parentId MUST be defined and point to Class/Interface/Enum
}

export interface TypeAliasProperties extends BaseElementProperties {
  aliasedType: string; // Language-specific type string being aliased
}

export interface AnnotationDefinitionProperties extends BaseElementProperties {
  // Properties specific to annotation definitions, if any
}

export interface ApiRouteDefinitionProperties extends BaseElementProperties {
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | string; // Allow flexibility, normalize later
  pathPattern: string; // e.g., /users/{id}, ensure framework-specific syntax is handled
  framework?: string; // e.g., 'Express', 'Flask', 'SpringMVC', 'FastAPI'
  handlerId?: CanonicalId; // Optional: ID of the function/method handling the route
}

export interface DatabaseSchemaDefinitionProperties extends BaseElementProperties {
  databaseType?: string; // e.g., 'PostgreSQL', 'MySQL', 'SQLite'
}

export interface DatabaseTableProperties extends BaseElementProperties {
  schemaName?: string;
  // Columns are separate DatabaseColumn IrElements linked via parentId
}

export interface DatabaseViewProperties extends BaseElementProperties {
  schemaName?: string;
  definitionSql?: string; // Optional: Raw SQL for the view definition
}

export interface DatabaseColumnProperties extends BaseElementProperties {
  dataType: string; // SQL data type
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  referencesTable?: CanonicalId; // If isForeignKey
  referencesColumn?: CanonicalId; // If isForeignKey (name might suffice if ID not available)
  constraints?: string[]; // e.g., ['NOT NULL', 'UNIQUE']
  // parentId MUST be defined and point to DatabaseTable or DatabaseView
}

export interface DatabaseFunctionProperties extends FunctionLikeProperties {
  // DB Function/Procedure specific properties
  // parentId might point to DatabaseSchemaDefinition
}

export interface DatabaseProcedureProperties extends DatabaseFunctionProperties {
  // Potentially identical to DatabaseFunctionProperties
}

export interface GenericElementProperties extends BaseElementProperties {
  details: Record<string, any>; // For storing arbitrary data for unclassified elements
}

// --- IR Element Base Structure ---

/**
 * Represents a defined code or infrastructure element identified by a parser.
 * This is the core node structure for the Code Connectome graph.
 */
export interface IrElement {
  /** Canonical ID for this element. Must be unique within the project. */
  id: CanonicalId;
  /** Project-relative path of the file containing this element's definition. */
  filePath: string;
  /** The type of this element. */
  type: ElementType;
  /** The primary name of the element (e.g., function name, class name, table name). */
  name: string;
  /** The location range of the element's definition in the source file. */
  location: Location;
  /** Type-specific properties of the element. */
  properties:
    | ModuleProperties
    | PackageProperties
    | ClassProperties
    | InterfaceProperties
    | EnumProperties
    | FunctionProperties
    | MethodProperties
    | VariableProperties
    | FieldProperties
    | TypeAliasProperties
    | AnnotationDefinitionProperties
    | ApiRouteDefinitionProperties
    | DatabaseSchemaDefinitionProperties
    | DatabaseTableProperties
    | DatabaseViewProperties
    | DatabaseColumnProperties
    | DatabaseFunctionProperties
    | DatabaseProcedureProperties
    | GenericElementProperties;
  /** Optional: Tags or flags for additional classification (e.g., 'test', 'generated', 'deprecated'). */
  tags?: string[];
}

// --- Potential Relationship Detail Interfaces (Properties) ---
// These define the structure of the `properties` field for specific RelationshipTypes.

export interface BaseRelationshipProperties {
  /** Optional: Snippet of the source code reference for context. */
  rawReference?: string;
}

export interface ImportsProperties extends BaseRelationshipProperties {
  moduleSpecifier: string; // The path/module being imported (e.g., './utils', 'react', 'java.util.List')
  importedEntityName?: string; // Specific entity being imported (e.g., 'useState', 'List', 'myFunction') - '*' for wildcard
  isTypeImport?: boolean; // If it's specifically a type import (e.g., `import type ...`)
}

export interface CallsProperties extends BaseRelationshipProperties {
  arguments?: string[]; // Simplified representation (e.g., stringified args) - potentially large/complex
  isAsyncAwait?: boolean; // Was the call awaited?
  potentialTargetIds?: CanonicalId[]; // Parser's best guess(es) if resolvable locally
}

export interface ApiFetchProperties extends BaseRelationshipProperties {
  httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD' | string; // Allow flexibility, normalize later
  urlPattern: string; // The URL string or pattern used in the call (may contain variables)
  framework?: string; // e.g., 'fetch', 'axios', 'XMLHttpRequest', 'requests', 'HttpClient'
}

export interface DatabaseQueryProperties extends BaseRelationshipProperties {
  queryType?: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'DDL' | 'CALL' | 'UNKNOWN';
  ormMethod?: string; // e.g., 'findById', 'save', 'createQueryBuilder', 'execute'
  targetModel?: string; // Name of the ORM model being used (if applicable)
  rawSql?: string; // The raw SQL string, if available and not excessively long
  targetTables?: string[]; // Table/view names explicitly mentioned or inferred
  targetColumns?: string[]; // Column names explicitly mentioned or inferred
}

export interface InheritsProperties extends BaseRelationshipProperties {
  // targetPattern will be the name of the parent class/interface
}

export interface ImplementsProperties extends BaseRelationshipProperties {
  // targetPattern will be the name of the implemented interface
}

export interface InstantiatesProperties extends BaseRelationshipProperties {
  arguments?: string[]; // Simplified representation
  // targetPattern will be the name of the class being instantiated
}

export interface ReadsProperties extends BaseRelationshipProperties {
  // targetPattern will be the name of the variable/field being read
}

export interface WritesProperties extends BaseRelationshipProperties {
  // targetPattern will be the name of the variable/field being written to
}

export interface UsesAnnotationProperties extends BaseRelationshipProperties {
  annotationName: string; // The name of the annotation/decorator being used
  arguments?: string[]; // Arguments passed to the annotation
  // targetPattern will be the annotationName
}

export interface ReferencesTypeProperties extends BaseRelationshipProperties {
  // targetPattern will be the name of the type being referenced
}

export interface ReferencesElementProperties extends BaseRelationshipProperties {
  // targetPattern is the name/identifier of the referenced element
  // Used when a more specific relationship type isn't clear from the parser level
}


// --- Potential Relationship Base Structure ---

/**
 * Represents an observed action or reference in the code that suggests
 * a relationship between the source element and a target (represented by a pattern).
 * These are processed by resolvers to create concrete graph edges between IrElements.
 */
export interface PotentialRelationship {
  /** Canonical ID of the element containing the reference (e.g., the function making a call). */
  sourceId: CanonicalId;
  /** The type of relationship observed. */
  type: RelationshipType;
  /**
   * String representation of the target being referenced (e.g., function name, class name,
   * variable name, module path, URL pattern, table name, type name).
   * Resolvers use this pattern along with context (source element, imports, scope)
   * to find the target element's Canonical ID.
   */
  targetPattern: string;
  /** The location range of the reference/action itself in the source file. */
  location: Location;
  /** Type-specific properties of the relationship. */
  properties:
    | ImportsProperties
    | CallsProperties
    | ApiFetchProperties
    | DatabaseQueryProperties
    | InheritsProperties
    | ImplementsProperties
    | InstantiatesProperties
    | ReadsProperties
    | WritesProperties
    | UsesAnnotationProperties
    | ReferencesTypeProperties
    | ReferencesElementProperties;
}


// --- Top-Level File IR Structure ---

/**
 * Represents the complete Intermediate Representation generated for a single file.
 * This is the output of the SourceToIrConverter for one file.
 */
export interface FileIr {
  /** Version of the IR schema used to generate this structure. */
  schemaVersion: string; // e.g., "1.0.0"
  /** Project ID passed during analysis. */
  projectId: string; // Matches the project_id part of CanonicalIds
  /** Canonical ID for this file element. */
  fileId: CanonicalId;
  /** Project-relative path for this file. */
  filePath: string;
  /** Detected language of the file. */
  language: Language;
  /** Array of code/infrastructure elements defined within this file. */
  elements: IrElement[];
  /** Array of potential relationships observed originating from elements within this file. */
  potentialRelationships: PotentialRelationship[];
  /** Optional: Any errors encountered during parsing or IR conversion for this file. */
  errors?: { message: string; location?: Location }[];
}