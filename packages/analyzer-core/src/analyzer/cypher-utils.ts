import { Neo4jClient } from '../database/neo4j-client.js';
import { createContextLogger } from '../utils/logger.js';
import { Neo4jError } from '../utils/errors.js';
import config from '../config/index.js'; // Keep config import for storageBatchSize

const logger = createContextLogger('CypherUtils');

/**
 * Generates Cypher clauses for setting and removing node labels based on configuration.
 * This function is assumed based on its usage in storage-manager.ts.
 * @returns Object containing Cypher clauses for label management.
 */
export function generateNodeLabelCypher(): { removeClause: string; setLabelClauses: string } {
    // Define a static base label for removal. Specific labels are set based on 'kind' during node save.
    const baseLabel = 'CodeItem';
    const allLabels = [baseLabel]; // Use a minimal list for the REMOVE clause
    const removeClause = `REMOVE n:${allLabels.join(':')}`;

    // Define all possible labels based on 'kind' values used in the parsers
    const possibleKinds = [
        'File', 'Directory', 'Class', 'Interface', 'Function', 'Method', 'Variable',
        'Parameter', 'TypeAlias', 'Import', 'Export', 'Component', 'JSXElement',
        'JSXAttribute', 'TailwindClass', 'PythonModule', 'PythonFunction', 'PythonClass',
        'PythonMethod', 'PythonParameter', 'PythonVariable', 'CFunction', 'CppClass',
        'CppMethod', 'IncludeDirective', 'MacroDefinition', 'JavaClass', 'JavaInterface',
        'JavaMethod', 'JavaField', 'PackageDeclaration', 'ImportDeclaration', 'JavaPackage',
        'CSharpClass', 'CSharpInterface', 'CSharpStruct', 'CSharpMethod', 'Property',
        'Field', 'NamespaceDeclaration', 'UsingDirective', 'GoFunction', 'GoMethod',
        'GoStruct', 'GoInterface', 'PackageClause', 'ImportSpec', 'SQLSchema', 'SQLTable',
        'SQLView', 'SQLColumn', 'SQLSelectStatement', 'SQLInsertStatement',
        'SQLUpdateStatement', 'SQLDeleteStatement', 'SQLFunction', 'SQLProcedure'
        // Add any other kinds used by parsers here
    ];

    // Generate FOREACH logic to conditionally set the label based on n.kind
    // This creates a list containing the label string if the kind matches, then sets it.
    const setLabelClauses = possibleKinds.map(kind =>
        `FOREACH(_ IN CASE WHEN n.kind = '${kind}' THEN [1] ELSE [] END | SET n:\`${kind}\`)`
    ).join('\n        ');

    return {
        removeClause,
        setLabelClauses // Return the generated FOREACH clauses directly
    };
}


/**
 * Deletes nodes and their relationships from Neo4j based on a list of entity IDs.
 * Uses UNWIND for batching.
 * @param neo4jClient - The Neo4j client instance.
 * @param entityIds - An array of entity IDs to delete.
 */
export async function deleteNodesAndRelationshipsByEntityId(neo4jClient: Neo4jClient, entityIds: string[]): Promise<void> {
    if (!entityIds || entityIds.length === 0) {
        logger.debug('No entity IDs provided for deletion.');
        return;
    }

    logger.info(`Attempting to delete ${entityIds.length} entities and their relationships...`);

    // Use a larger batch size for deletion if configured, otherwise default
    const batchSize = config.storageBatchSize ?? 500; // Reuse storage batch size from config

    for (let i = 0; i < entityIds.length; i += batchSize) {
        const batch = entityIds.slice(i, i + batchSize);

        if (batch.length === 0) {
            continue;
        }

        const cypher = `
            UNWIND $batch AS entityIdToDelete
            MATCH (n { entityId: entityIdToDelete })
            DETACH DELETE n
        `;

        try {
            // Ensure driver is initialized before running the transaction
            await neo4jClient.initializeDriver('CypherUtils-Delete');
            await neo4jClient.runTransaction(cypher, { batch }, 'WRITE', 'CypherUtils-Delete');
            logger.debug(`Deleted batch of up to ${batch.length} entities (Total processed: ${Math.min(i + batch.length, entityIds.length)}/${entityIds.length})`);
        } catch (error: any) {
            logger.error(`Failed to delete entity batch (index ${i})`, { error: error.message, code: error.code });
            // Log the failing batch IDs for debugging
            logger.error(`Failing entity ID batch: ${JSON.stringify(batch)}`);
            // Throw a specific error or handle as needed
            throw new Neo4jError(`Failed to delete entity batch: ${error.message}`, { originalError: error, code: error.code });
        } finally {
             // Close driver connection after batch potentially? Or manage externally?
             // For simplicity here, assume external management or keep-alive.
             // await neo4jClient.closeDriver('CypherUtils-Delete'); // Might be inefficient if called per batch
        }
    }
    logger.info(`Finished deleting ${entityIds.length} entities.`);
}


/**
 * Generates a deterministic and unique entity ID for a relationship.
 * Ensures consistency for merging relationships.
 * @param sourceId - The entityId of the source node.
 * @param targetId - The entityId of the target node.
 * @param type - The type of the relationship (e.g., 'CALLS', 'IMPORTS').
 * @returns A unique string identifier for the relationship.
 */
export function generateRelationshipEntityId(sourceId: string, targetId: string, type: string): string {
    if (!sourceId || !targetId || !type) {
        logger.error('Missing required IDs or type for generating relationship entity ID', { sourceId, targetId, type });
        // Return a placeholder or throw an error, depending on desired handling
        return `INVALID_REL_ID_${Date.now()}`;
    }
    // Simple concatenation provides a basic unique ID. Consider hashing for very long IDs.
    return `${sourceId}-${type.toUpperCase()}->${targetId}`;
}

// Add other potential Cypher utility functions here if needed...