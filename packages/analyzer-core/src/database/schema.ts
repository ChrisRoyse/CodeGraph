import { Neo4jClient } from './neo4j-client.js';
import { createContextLogger } from '../utils/logger.js';
import { Neo4jError } from '../utils/errors.js';

const logger = createContextLogger('SchemaManager');

// Define Node Labels used in the graph
export const NODE_LABELS = [
    'File', 'Directory', 'Class', 'Interface', 'Function', 'Method',
    'Variable', 'Parameter', 'TypeAlias', 'Import', 'Export',
    'Component', 'JSXElement', 'JSXAttribute',
    'TailwindClass',
    'PythonModule', 'PythonFunction', 'PythonClass', 'PythonMethod', 'PythonParameter', 'PythonVariable',
    'CFunction', 'CppClass', 'CppMethod', 'IncludeDirective',
 'MacroDefinition', // Added MacroDefinition
    'JavaClass', 'JavaInterface', 'JavaMethod', 'JavaField', 'PackageDeclaration', 'ImportDeclaration', 'JavaPackage', // Added JavaPackage
    'CSharpClass', 'CSharpInterface', 'CSharpStruct', 'CSharpMethod', 'Property', 'Field', 'NamespaceDeclaration', 'UsingDirective',
    'GoFunction', 'GoMethod', 'GoStruct', 'GoInterface', 'PackageClause', 'ImportSpec',
    // Added SQL labels
    'SQLSchema', 'SQLTable', 'SQLView', 'SQLColumn', 'SQLSelectStatement', 'SQLInsertStatement', 'SQLUpdateStatement', 'SQLDeleteStatement', 'SQLFunction', 'SQLProcedure'
];

// Define Relationship Types used in the graph
const BASE_RELATIONSHIP_TYPES = [
    'CONTAINS',      // Directory->File, JavaPackage->File
    'IMPORTS',       // File->File or File->Module (Placeholder)
    'EXPORTS',       // File->Variable/Function/Class/Interface/TypeAlias
    'CALLS',         // Function/Method->Function/Method
    'EXTENDS',       // Class->Class, Interface->Interface
    'IMPLEMENTS',    // Class->Interface
    'HAS_METHOD',    // Class/Interface->Method
    'HAS_PARAMETER', // Function/Method->Parameter
    'MUTATES_STATE', // Function/Method->Variable/Property
    'HANDLES_ERROR', // TryStatement->CatchClause (or Function/Method)
    'DEFINES_COMPONENT', // File->Component
    'RENDERS_ELEMENT',   // Component/JSXElement -> JSXElement
    'USES_COMPONENT',    // Component -> Component (via JSX tag)
    'HAS_PROP',          // JSXElement -> JSXAttribute
    'USES_TAILWIND_CLASS', // JSXElement -> TailwindClass
    'PYTHON_IMPORTS',          // PythonModule -> PythonModule (placeholder)
    'PYTHON_CALLS',            // PythonFunction/PythonMethod -> Unknown (placeholder)
    'PYTHON_DEFINES_FUNCTION', // PythonModule/PythonClass -> PythonFunction
    'PYTHON_DEFINES_CLASS',    // PythonModule -> PythonClass
    'PYTHON_HAS_METHOD',       // PythonClass -> PythonMethod
    'PYTHON_HAS_PARAMETER',    // PythonFunction/PythonMethod -> PythonParameter
    'INCLUDES',                // C/C++: File -> IncludeDirective (or directly to File in Pass 2)
    'DECLARES_PACKAGE',        // Java: File -> PackageDeclaration (Removed in favor of JavaPackage->CONTAINS)
    'JAVA_IMPORTS',            // Java: File -> ImportDeclaration (or Class/Package)
    'HAS_FIELD',               // Java/C#: Class/Interface/Struct -> Field
    'DECLARES_NAMESPACE',      // C#: File -> NamespaceDeclaration
    'USES_NAMESPACE',          // C#: File -> UsingDirective (or Namespace)
    'HAS_PROPERTY',            // C#: Class/Interface/Struct -> Property
    'GO_IMPORTS',              // Go: File -> ImportSpec (or Package)
    // Added SQL relationship types
    'DEFINES_TABLE',           // SQL: Schema/File -> SQLTable
    'DEFINES_VIEW',            // SQL: Schema/File -> SQLView
    'HAS_COLUMN',              // SQL: Table/View -> SQLColumn
    'REFERENCES_TABLE',        // SQL: Statement/View/Function/Procedure -> SQLTable
    'REFERENCES_VIEW',         // SQL: Statement/View/Function/Procedure -> SQLView
    'CALLS_FUNCTION',          // SQL: Statement/Function/Procedure -> SQLFunction
    'CALLS_PROCEDURE'          // SQL: Statement/Function/Procedure -> SQLProcedure
];

// Define relationship types that can cross file boundaries
const CROSS_FILE_RELATIONSHIP_TYPES = BASE_RELATIONSHIP_TYPES
    .filter((type): type is string => typeof type === 'string') // Ensure only strings are processed
    .filter(type => ['IMPORTS', 'EXPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS', 'MUTATES_STATE', 'INCLUDES', 'JAVA_IMPORTS', 'USES_NAMESPACE', 'GO_IMPORTS', 'REFERENCES_TABLE', 'REFERENCES_VIEW', 'CALLS_FUNCTION', 'CALLS_PROCEDURE'].includes(type)) // Added SQL cross-file types
    .map(type => `CROSS_FILE_${type}`); // Prefix for clarity in queries if needed

// Combine base and cross-file types for constraint generation
// Ensure uniqueness in the combined list
export const ALL_RELATIONSHIP_TYPES = Array.from(new Set([...BASE_RELATIONSHIP_TYPES]));


// --- Schema Definitions ---

// Node Uniqueness Constraints (Crucial for merging nodes correctly)
const nodeUniquenessConstraints = NODE_LABELS.map(label =>
    `CREATE CONSTRAINT ${label.toLowerCase()}_entityid_unique IF NOT EXISTS FOR (n:\`${label}\`) REQUIRE n.entityId IS UNIQUE`
);

// Relationship Uniqueness Constraints (NEW - to prevent duplicates)
// Note: Neo4j requires relationship constraints to be defined without specifying node labels.
// This constraint ensures that for a given relationship TYPE, the relationshipId is unique.
const relationshipUniquenessConstraints = ALL_RELATIONSHIP_TYPES.map(relType =>
    `CREATE CONSTRAINT rel_${relType.toLowerCase()}_relid_unique IF NOT EXISTS FOR ()-[r:\`${relType}\`]-() REQUIRE r.relationshipId IS UNIQUE`
);

// Indexes for faster lookups (Essential for performance)
const indexes = [
    ...NODE_LABELS.map(label => `CREATE INDEX ${label.toLowerCase()}_filepath_index IF NOT EXISTS FOR (n:\`${label}\`) ON (n.filePath)`), // Use backticks for labels
    ...NODE_LABELS.map(label => `CREATE INDEX ${label.toLowerCase()}_name_index IF NOT EXISTS FOR (n:\`${label}\`) ON (n.name)`), // Use backticks for labels
    `CREATE INDEX file_kind_index IF NOT EXISTS FOR (n:File) ON (n.kind)`, // Example
    // Optional: Index relationshipId for faster MERGE lookups, though the constraint implies uniqueness.
    // ...ALL_RELATIONSHIP_TYPES.map(relType => `CREATE INDEX rel_${relType.toLowerCase()}_relid_index IF NOT EXISTS FOR ()-[r:${relType}]-() ON (r.relationshipId)`)
];

/**
 * Manages the application of schema (constraints and indexes) to the Neo4j database.
 */
export class SchemaManager {
    private neo4jClient: Neo4jClient;

    constructor(neo4jClient: Neo4jClient) {
        this.neo4jClient = neo4jClient;
    }

    /**
     * Applies all defined constraints and indexes to the database.
     * @param forceUpdate - If true, drops existing schema elements before applying.
     */
    async applySchema(forceUpdate: boolean = false): Promise<void> {
        logger.info(`Applying schema... Force update: ${forceUpdate}`);
        if (forceUpdate) {
            await this.dropAllSchemaElements();
        }

        const allSchemaCommands = [
            ...nodeUniquenessConstraints,
            ...relationshipUniquenessConstraints, // Add relationship constraints
            ...indexes,
        ];

        let appliedCount = 0;
        let failedCount = 0;

        for (const command of allSchemaCommands) {
            try {
                await this.neo4jClient.runTransaction(command, {}, 'WRITE', 'SchemaManager');
                logger.debug(`Successfully applied schema command: ${command.split(' ')[2]}...`);
                appliedCount++;
            } catch (error: any) {
                const alreadyExists = error.code === 'Neo.ClientError.Schema.ConstraintAlreadyExists' ||
                                      error.code === 'Neo.ClientError.Schema.IndexAlreadyExists' ||
                                      error.message?.includes('already exists');

                if (!alreadyExists || forceUpdate) {
                    logger.error(`Failed to apply schema command: ${command}`, { code: error.code, message: error.message });
                    failedCount++;
                } else {
                     logger.debug(`Schema element already exists, skipping: ${command.split(' ')[2]}...`);
                }
            }
        }
        logger.info(`Schema application finished. Applied/Verified: ${appliedCount}, Failed: ${failedCount}.`);
        if (failedCount > 0 && forceUpdate) {
             throw new Neo4jError(`Failed to apply ${failedCount} schema elements during forced update.`);
        }
    }

    /**
     * Drops all known user-defined constraints and indexes.
     * WARNING: Use with caution.
     */
    async dropAllSchemaElements(): Promise<void> {
        logger.warn('Dropping ALL user-defined constraints and indexes from the database...');
        let droppedConstraints = 0;
        let droppedIndexes = 0;
        let failedDrops = 0;

        try {
            const constraintsResult = await this.neo4jClient.runTransaction<{ name: string }[]>(
                'SHOW CONSTRAINTS YIELD name', {}, 'READ', 'SchemaManager'
            );
            // @ts-ignore TODO: Fix type casting from runTransaction
            const constraintNames = constraintsResult.records?.map((r: any) => r.get('name')) || [];
            logger.debug(`Found ${constraintNames.length} existing constraints.`);

            for (const name of constraintNames) {
                try {
                    await this.neo4jClient.runTransaction(`DROP CONSTRAINT ${name}`, {}, 'WRITE', 'SchemaManager');
                    logger.debug(`Dropped constraint: ${name}`);
                    droppedConstraints++;
                } catch (error: any) {
                    logger.error(`Failed to drop constraint: ${name}`, { message: error.message });
                    failedDrops++;
                }
            }

            const indexesResult = await this.neo4jClient.runTransaction<{ name: string }[]>(
                'SHOW INDEXES YIELD name', {}, 'READ', 'SchemaManager'
            );
             // @ts-ignore TODO: Fix type casting from runTransaction
            const indexNames = indexesResult.records?.map((r: any) => r.get('name')).filter((name: string) => !name.includes('constraint')) || [];
            logger.debug(`Found ${indexNames.length} existing user indexes.`);

            for (const name of indexNames) {
                try {
                    await this.neo4jClient.runTransaction(`DROP INDEX ${name}`, {}, 'WRITE', 'SchemaManager');
                    logger.debug(`Dropped index: ${name}`);
                    droppedIndexes++;
                } catch (error: any) {
                    logger.error(`Failed to drop index: ${name}`, { message: error.message });
                    failedDrops++;
                }
            }

            logger.info(`Finished attempting to drop schema elements: ${droppedConstraints} constraints, ${droppedIndexes} indexes dropped. ${failedDrops} failures.`);

        } catch (error: any) {
            logger.error('Failed to retrieve existing schema elements for dropping.', { message: error.message });
            throw new Neo4jError('Failed to retrieve schema for dropping.', { originalError: error });
        }
         if (failedDrops > 0) {
             logger.warn(`Encountered ${failedDrops} errors while dropping schema elements.`);
         }
    }

     /**
     * Deletes all nodes and relationships from the database.
     * WARNING: This is destructive and irreversible.
     */
    async resetDatabase(): Promise<void> {
        logger.warn('Deleting ALL nodes and relationships from the database...');
        try {
            await this.neo4jClient.runTransaction('MATCH (n) DETACH DELETE n', {}, 'WRITE', 'SchemaManager');
            logger.info('All nodes and relationships deleted.');
        } catch (error: any) {
            logger.error('Failed to delete all data from the database.', { message: error.message });
            throw new Neo4jError('Failed to reset database.', { originalError: error });
        }
    }
}