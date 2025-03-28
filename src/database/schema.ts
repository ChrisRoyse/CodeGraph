import neo4jClient from './neo4j-client';
import { createContextLogger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import neo4j, { Integer as Neo4jInteger, Session } from 'neo4j-driver'; // Import neo4j driver object and Session
import config from '../config'; // Import config directly

const logger = createContextLogger('Schema');

// --- Final Core Schema Definition ---

// Define ONLY the labels we want to exist.
const FINAL_NODE_LABELS = [
  'Directory', 'File', 'Class', 'Interface', 'Function', 'Method',
  'Variable', // Includes parameters, const, let, var
  'Parameter', // Explicitly add Parameter if used
  'TypeAlias',
  'Embeddable', // Add the new super-label for vector indexing
  '_Migration' // Internal for schema management
];

// Labels for nodes that will have embeddings (now handled by :Embeddable label)
const EMBEDDED_NODE_LABELS = ['Function', 'Method', 'Class', 'Interface', 'Variable', 'Parameter']; // Keep for reference

// Define ONLY the base relationship types we want created by the parser/resolver.
const BASE_RELATIONSHIP_TYPES = [
  'CONTAINS',      // Structural parent-child (Dir->File, File->Class, Class->Method) - Weight: 1
  'IMPORTS',       // File->File dependency - Weight: 8
  'EXPORTS',       // File->ExportedEntity - Weight: 8
  'CALLS',         // Caller->Callee (Function/Method -> Function/Method) - Weight: 7
  'EXTENDS',       // Child->Parent (Class->Class, Interface->Interface) - Weight: 9
  'IMPLEMENTS',    // Class->Interface - Weight: 9
  'USES',          // CodeBlock->Variable/Parameter/Function/Method/Class/Interface/TypeAlias - Weight: 6
  'MUTATES_STATE', // Function/Method->Variable/Property(on Class/Interface) - Weight: 8
  'HANDLES_ERROR', // TryBlock(conceptual)->CatchBlock(conceptual)/ErrorClass - Weight: 4
];

// Define derived cross-file types (resolver creates these by prefixing)
const CROSS_FILE_RELATIONSHIP_TYPES = BASE_RELATIONSHIP_TYPES
    .filter(type => ['CALLS', 'EXTENDS', 'IMPLEMENTS', 'USES', 'MUTATES_STATE', 'IMPORTS'].includes(type))
    .map(type => `CROSS_FILE_${type}`);

// All types that might exist in the DB after resolution
const ALL_EXPECTED_RELATIONSHIP_TYPES = [...BASE_RELATIONSHIP_TYPES, ...CROSS_FILE_RELATIONSHIP_TYPES];

// --- Constraints (Ensure uniqueness based on stable entityId) ---

export const nodeConstraints = FINAL_NODE_LABELS.map(label =>
  `CREATE CONSTRAINT ${label.toLowerCase()}_entityid_unique IF NOT EXISTS FOR (n:${label}) REQUIRE n.entityId IS UNIQUE`
);

// Create constraints only for BASE relationship types' entityIds
export const relationshipConstraints = BASE_RELATIONSHIP_TYPES.map(type =>
  `CREATE CONSTRAINT ${type.toLowerCase()}_entityid_unique IF NOT EXISTS FOR ()-[r:${type}]-() REQUIRE r.entityId IS UNIQUE`
);

// --- Indexes (For common query patterns) ---

export const basicIndexes = [
  // Index entityId for all core node types (including Embeddable if desired, though likely covered by specific labels)
  ...FINAL_NODE_LABELS.filter(l => l !== '_Migration').map(label =>
    `CREATE INDEX ${label.toLowerCase()}_entityid_idx IF NOT EXISTS FOR (n:${label}) ON (n.entityId)`
  ),
  // Index filePath
  `CREATE INDEX file_filepath_idx IF NOT EXISTS FOR (n:File) ON (n.filePath)`,
  `CREATE INDEX directory_filepath_idx IF NOT EXISTS FOR (n:Directory) ON (n.filePath)`,
  // Index name
  `CREATE INDEX class_name_idx IF NOT EXISTS FOR (n:Class) ON (n.name)`,
  `CREATE INDEX interface_name_idx IF NOT EXISTS FOR (n:Interface) ON (n.name)`,
  `CREATE INDEX function_name_idx IF NOT EXISTS FOR (n:Function) ON (n.name)`,
  `CREATE INDEX typealias_name_idx IF NOT EXISTS FOR (n:TypeAlias) ON (n.name)`,
];

// --- Vector Index ---
// Assuming paraphrase-MiniLM-L3-v2 produces 384 dimensions
const EMBEDDING_DIMENSION = 384;
const VECTOR_INDEX_NAME = 'embeddable_embedding_index'; // New single index name
const OLD_VECTOR_INDEX_PREFIX = 'node_embedding_index_'; // Prefix of the old indexes

// Create a SINGLE index on the :Embeddable label
export const vectorIndex = [
    `CREATE VECTOR INDEX ${VECTOR_INDEX_NAME} IF NOT EXISTS
     FOR (n:Embeddable) ON (n.embedding)
     OPTIONS { indexConfig: {
        \`vector.dimensions\`: ${EMBEDDING_DIMENSION},
        \`vector.similarity_function\`: 'cosine'
     }}`
];

// --- Schema Manager ---

export const allConstraintsToCreate = [...nodeConstraints, ...relationshipConstraints];
// Combine basic and vector indexes
export const allIndexesToCreate = [...basicIndexes, ...vectorIndex];

/**
 * Schema migration interface
 */
export interface Migration {
  id: string;
  description: string;
  up: (client: typeof neo4jClient) => Promise<void>;
  down: (client: typeof neo4jClient) => Promise<void>;
}

/**
 * Schema manager for database migrations and constraints
 */
export class SchemaManager {
  private migrations: Migration[] = [];

  /**
   * Escapes a label or name for safe use in Cypher queries.
   */
   private escapeName(name: string): string {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            const escapedName = name.replace(/`/g, '``');
            return `\`${escapedName}\``;
        }
        return name;
    }

  /**
   * Register a new migration
   */
  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    logger.debug(`Registered migration: ${migration.id} - ${migration.description}`);
  }

  /**
   * Get all registered migrations sorted by ID
   */
  getMigrations(): Migration[] {
    // Restore original implementation
    return [...this.migrations].sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Drops ALL user-defined constraints and indexes currently present in the database.
   * Attempts to preserve internal/lookup indexes.
   */
  async dropAllSchemaElements(): Promise<void> {
      logger.warn('Dropping ALL user-defined constraints and indexes from the database...');
      const session = neo4jClient.getSession('WRITE');
      let constraintCount = 0;
      let indexCount = 0;
      try {
          // Drop Constraints
          logger.debug('Fetching existing constraints...');
          const constraintsResult = await session.run('SHOW CONSTRAINTS YIELD name');
          const constraintNames = constraintsResult.records.map(record => record.get('name')).filter(name => name);
          logger.debug(`Found ${constraintNames.length} constraints to potentially drop.`);
          for (const name of constraintNames) {
              const dropStmt = `DROP CONSTRAINT ${this.escapeName(name)} IF EXISTS`;
              try {
                  await session.run(dropStmt);
                  logger.debug(`Dropped constraint: ${name}`);
                  constraintCount++;
              } catch (e: any) {
                  logger.warn(`Failed to drop constraint ${name}`, { code: e.code, message: e.message });
              }
          }

          // Drop Indexes (Including Vector) - More robustly
          logger.debug('Fetching existing indexes...');
          // Use SHOW INDEXES and explicitly try dropping known old/new vector indexes
          const indexesToTryDropping = [
              VECTOR_INDEX_NAME, // The new one we want
              ...EMBEDDED_NODE_LABELS.map(label => `${OLD_VECTOR_INDEX_PREFIX}${label.toLowerCase()}`) // The old ones
          ];

          // Also get all current indexes to drop others
          const indexesResult = await session.run('SHOW INDEXES YIELD name, type');
          const currentIndexes = indexesResult.records
              .map(record => ({ name: record.get('name'), type: record.get('type') }))
              .filter(index => index.name);

          const uniqueIndexNamesToDrop = new Set(indexesToTryDropping);
          currentIndexes.forEach(index => {
              // Avoid dropping constraint-backed indexes and internal lookup indexes
              const isConstraintIndex = index.type === 'RANGE' || index.type === 'POINT' || index.type === 'TEXT';
              const isLookupIndex = index.type === 'LOOKUP';
              // Avoid dropping basic indexes we intend to recreate immediately
              const isCurrentBasicIndex = index.name.endsWith('_entityid_idx') || index.name.endsWith('_filepath_idx') || index.name.endsWith('_name_idx');

              if (!isConstraintIndex && !isLookupIndex && !isCurrentBasicIndex) {
                  uniqueIndexNamesToDrop.add(index.name);
              }
          });


          logger.debug(`Attempting to drop ${uniqueIndexNamesToDrop.size} indexes (including potentially non-existent ones)...`);
          for (const name of uniqueIndexNamesToDrop) {
               // Use specific DROP VECTOR INDEX if available, otherwise generic DROP INDEX
               // Note: Neo4j 5 might require specific syntax, adjust if needed based on version docs
               const dropStmt = `DROP INDEX ${this.escapeName(name)} IF EXISTS`; // Generic fallback
               // const dropVectorStmt = `DROP VECTOR INDEX ${this.escapeName(name)} IF EXISTS`; // Use if supported

               try {
                   await session.run(dropStmt); // Try generic first
                   logger.debug(`Dropped index (or it didn't exist): ${name}`);
                   indexCount++; // Count attempts, not successes
               } catch (e: any) {
                   // Log errors other than "index not found"
                   if (!e.message?.includes('No such index') && !e.message?.includes('index does not exist')) {
                        logger.warn(`Failed to drop index ${name}`, { code: e.code, message: e.message });
                   } else {
                        logger.debug(`Index ${name} did not exist.`);
                   }
               }
          }

          logger.info(`Finished attempting to drop schema elements: ${constraintCount} constraints, ${indexCount} index drop attempts.`);
      } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          if (err.message.includes('Unknown procedure') || err.message.includes('Invalid input')) {
               logger.warn('Could not automatically drop schema elements using SHOW commands. Manual cleanup may be needed if old schema persists.');
          } else {
               logger.error('Failed during schema element drop process', { error: err });
          }
      } finally {
          await session.close();
      }
  }


  /**
   * Initialize schema with constraints and indexes defined in this file.
   * Optionally drops ALL existing user-defined elements first.
   * @param forceUpdate - If true, drops ALL existing user constraints/indexes before creating.
   */
  async initializeSchema(forceUpdate: boolean = false): Promise<void> {
    if (forceUpdate) {
        await this.dropAllSchemaElements();
    }

    logger.info('Applying defined schema constraints and indexes...');
    const session = neo4jClient.getSession('WRITE');
    let constraintsApplied = 0;
    let indexesApplied = 0;
    try {
      // Apply Constraints defined in this file
      for (const constraint of allConstraintsToCreate) {
        try {
          await session.executeWrite(tx => tx.run(constraint));
          logger.debug(`Applied constraint: ${constraint.split(' ')[2]}`);
          constraintsApplied++;
        } catch (error: any) {
          if (error.code === 'Neo.ClientError.Schema.ConstraintAlreadyExists' || error.message?.includes('already exists')) {
            logger.debug(`Constraint already exists: ${constraint.split(' ')[2]}`);
          } else {
            logger.error(`Failed to apply constraint: ${constraint}`, { code: error.code, message: error.message });
          }
        }
      }
      // Apply Indexes defined in this file (includes basic and vector)
      for (const index of allIndexesToCreate) {
         try {
          await session.executeWrite(tx => tx.run(index));
          logger.debug(`Applied index: ${index.split(' ')[2]}`);
          indexesApplied++;
        } catch (error: any) {
          if (error.code === 'Neo.ClientError.Schema.IndexAlreadyExists' || error.message?.includes('already exists')) {
            logger.debug(`Index already exists: ${index.split(' ')[2]}`);
          } else {
             if (error.message && error.message.includes("Failed to create index")) {
                 logger.warn(`Index creation failed, possibly due to syntax issues or existing index: ${index.split(' ')[2]}`);
             } else {
                 logger.error(`Failed to apply index: ${index}`, { code: error.code, message: error.message });
             }
          }
        }
      }
      logger.info(`Schema application finished. Applied ${constraintsApplied} constraints and ${indexesApplied} indexes.`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to apply schema elements', { error: err });
      throw new DatabaseError('Failed to apply schema elements', { originalError: err.message });
    } finally {
      await session.close();
    }
  }

   /**
   * Check if migrations node exists
   */
  private async migrationNodeExists(): Promise<boolean> {
    try {
      type CountResult = { count: Neo4jInteger | number };
      const result = await neo4jClient.read<CountResult>(
        'MATCH (n:_Migration {id: "schema_metadata"}) RETURN count(n) as count'
      );
      const record = result?.[0];
      const count = record?.count;
      return count !== null && count !== undefined && (typeof count === 'number' ? count > 0 : count.toNumber() > 0);
    } catch (error) {
      return false;
    }
  }

  /**
   * Create migrations node if it doesn't exist
   */
  private async ensureMigrationNode(): Promise<void> {
    if (await this.migrationNodeExists()) {
      return;
    }
    logger.info('Creating _Migration metadata node...');
    try {
       await neo4jClient.write('CREATE CONSTRAINT _migration_entityId_unique IF NOT EXISTS FOR (n:_Migration) REQUIRE n.entityId IS UNIQUE');
       await neo4jClient.write(
         'MERGE (n:_Migration {id: "schema_metadata", entityId: "meta:_Migration"}) ON CREATE SET n.lastApplied = null, n.createdAt = datetime()', {}
       );
       logger.info('_Migration metadata node created.');
    } catch (error) {
       const err = error instanceof Error ? error : new Error(String(error));
       logger.error('Failed to create _Migration metadata node', { error: err });
       throw new DatabaseError('Failed to create _Migration metadata node', { originalError: err.message });
    }
  }


  /**
   * Get applied migration IDs
   */
  async getAppliedMigrations(): Promise<string[]> {
    await this.ensureMigrationNode();
    try {
      const result = await neo4jClient.read<{ id: string }>(
        'MATCH (m:_Migration) WHERE m.id <> "schema_metadata" RETURN m.id AS id ORDER BY m.appliedAt'
      );
      return result.map((r) => r.id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get applied migrations', { error: err });
      throw new DatabaseError('Failed to get applied migrations', { originalError: err.message });
    }
  }

  /**
   * Apply pending migrations
   * @param forceSchemaUpdate - If true, drops ALL existing constraints/indexes before creating new ones.
   */
  async applyMigrations(forceSchemaUpdate: boolean = false): Promise<number> {
    await this.initializeSchema(forceSchemaUpdate);
    await this.ensureMigrationNode();

    const allMigrations = this.getMigrations();
    const appliedMigrationIds = await this.getAppliedMigrations();
    const pendingMigrations = allMigrations.filter(
      (m) => !appliedMigrationIds.includes(m.id)
    );

    if (pendingMigrations.length === 0) {
      logger.info('No pending migrations to apply.');
      return 0;
    }

    logger.info(`Found ${pendingMigrations.length} pending migrations.`);

    let appliedCount = 0;
    for (const migration of pendingMigrations) {
      logger.info(`Applying migration: ${migration.id} - ${migration.description}`);
      try {
        await neo4jClient.runTransaction('WRITE', async (tx) => {
          await migration.up(neo4jClient);
          await tx.run(
            `MERGE (m:_Migration {id: $id, entityId: $entityId})
             ON CREATE SET m.description = $description, m.appliedAt = datetime()`,
            {
              id: migration.id,
              entityId: `migration:${migration.id}`,
              description: migration.description,
            }
          );
        });
        logger.info(`Successfully applied migration: ${migration.id}`);
        appliedCount++;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error(`Failed to apply migration: ${migration.id}`, { error: err });
        throw new DatabaseError(`Failed to apply migration: ${migration.id}`, {
          migrationId: migration.id,
          originalError: err.message,
        });
      }
    }

    logger.info(`Applied ${appliedCount} migrations successfully.`);
    return appliedCount;
  }

  // --- Rollback/Reset (Implement if needed) ---
}

// Export singleton instance
const schemaManager = new SchemaManager();
export default schemaManager;