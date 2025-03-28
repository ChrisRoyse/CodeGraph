import neo4jClient from '../database/neo4j-client';
import { AstNode, RelationshipInfo } from './parser';
import { createContextLogger } from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import config from '../config'; // Import config for batch size

const logger = createContextLogger('StorageManager');

export class StorageManager {
    private batchSize: number;

    constructor() {
        this.batchSize = config.analysis.batchSize; // Get batch size from config
        logger.info(`StorageManager initialized with batch size: ${this.batchSize}`);
    }

    /**
     * Saves a batch of nodes to the Neo4j database using MERGE.
     * Adds an ':Embeddable' label if the node has an embedding property.
     * Stringifies complex array properties before saving.
     */
    async saveNodes(nodes: AstNode[]): Promise<void> {
        if (!nodes || nodes.length === 0) {
            logger.info('No nodes provided to save.');
            return;
        }
        logger.info(`Saving ${nodes.length} nodes to database...`);

        const query = `
            UNWIND $batch AS nodeData
            // Add :Embeddable label dynamically if embedding exists
            CALL apoc.merge.node(
                [nodeData.kind] + CASE WHEN nodeData.embedding IS NOT NULL THEN ['Embeddable'] ELSE [] END,
                { entityId: nodeData.entityId },
                // Properties to set/update - apoc.map.clean removes nulls/empty lists
                // We handle complex types manually before passing to the query
                apoc.map.clean(nodeData, ['kind'], []),
                {} // Properties to set on create only (optional)
            ) YIELD node
            RETURN count(node) as count
        `;

        try {
            for (let i = 0; i < nodes.length; i += this.batchSize) {
                const batch = nodes.slice(i, i + this.batchSize);
                // Preprocess batch data to handle complex types
                const batchData = batch.map(node => {
                    const processedNode: Record<string, any> = { ...node };

                    // Ensure kind is a single string
                    processedNode.kind = Array.isArray(node.kind) ? node.kind[0] : node.kind;

                    // Stringify arrays of objects
                    if (processedNode.parameterTypes && Array.isArray(processedNode.parameterTypes)) {
                        processedNode.parameterTypes = JSON.stringify(processedNode.parameterTypes);
                    }
                    if (processedNode.memberProperties && Array.isArray(processedNode.memberProperties)) {
                        processedNode.memberProperties = JSON.stringify(processedNode.memberProperties);
                    }
                    // Stringify other potential complex objects if they exist
                    if (processedNode.llmSummary && typeof processedNode.llmSummary === 'object') {
                         processedNode.llmSummary = JSON.stringify(processedNode.llmSummary);
                    }
                     if (processedNode.queryProperties && typeof processedNode.queryProperties === 'object') {
                         processedNode.queryProperties = JSON.stringify(processedNode.queryProperties);
                    }

                    return processedNode;
                });

                logger.debug(`Saving node batch ${i / this.batchSize + 1}... (${batch.length} nodes)`);
                await neo4jClient.write(query, { batch: batchData });
            }
            logger.info(`Finished saving ${nodes.length} nodes.`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Failed to save nodes batch', { error: err });
            throw new DatabaseError('Failed to save nodes batch', { originalError: err.message });
        }
    }


    /**
     * Saves a batch of relationships to the Neo4j database using MERGE.
     * Merges based on entityId only, then sets all properties.
     */
    async saveRelationships(relationships: RelationshipInfo[]): Promise<void> {
        if (!relationships || relationships.length === 0) {
            logger.info('No relationships provided to save.');
            return;
        }
        logger.info(`Saving ${relationships.length} relationships to database...`);

        // Merge relationship based on entityId only, then SET properties
        const query = `
            UNWIND $batch AS relData
            MATCH (source {entityId: relData.sourceId})
            MATCH (target {entityId: relData.targetId})
            CALL apoc.merge.relationship(
                source,
                relData.type, // Relationship type string
                { entityId: relData.entityId }, // Properties to match on
                {}, // Pass EMPTY map for merge properties
                target,
                {} // Properties to set on create only (optional)
            ) YIELD rel
            // Explicitly set all properties after merge using += for primitives
            // and separate SET for embedding
            SET rel += relData.primitiveProperties
            SET rel.embedding = relData.embedding // Handles null if embedding is undefined
            RETURN count(rel) as count
        `;

        try {
            for (let i = 0; i < relationships.length; i += this.batchSize) {
                const batch = relationships.slice(i, i + this.batchSize);
                 // Preprocess relationship properties
                 const batchData = batch.map(rel => {
                     const { properties, ...restOfRel } = rel;
                     const primitiveProperties: Record<string, any> = {};
                     let embeddingVector: number[] | undefined = undefined;

                     if (properties) {
                         Object.entries(properties).forEach(([key, value]) => {
                             if (key === 'embedding' && Array.isArray(value)) {
                                 embeddingVector = value;
                             }
                             // Stricter check: Only include non-null primitives or arrays of non-null primitives
                             else if (value !== null && typeof value !== 'object' && !Array.isArray(value)) {
                                 primitiveProperties[key] = value;
                             } else if (Array.isArray(value) && value.every(item => item !== null && typeof item !== 'object')) {
                                 primitiveProperties[key] = value;
                             }
                             // Explicitly ignore other complex properties
                         });
                     }

                     return {
                         ...restOfRel,
                         primitiveProperties: primitiveProperties, // Properties for SET +=
                         embedding: embeddingVector // Separate embedding for SET
                     };
                 });
                logger.debug(`Saving relationship batch ${i / this.batchSize + 1}... (${batch.length} relationships)`);
                await neo4jClient.write(query, { batch: batchData });
            }
            logger.info(`Finished saving ${relationships.length} relationships.`);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Failed to save relationships batch', { error: err });
            throw new DatabaseError('Failed to save relationships batch', { originalError: err.message });
        }
    }

    /**
     * Resets the database by deleting all nodes and relationships.
     * USE WITH CAUTION!
     */
    async resetDatabase(): Promise<void> {
        logger.warn('Resetting database: Deleting all nodes and relationships...');
        try {
            await neo4jClient.write('MATCH (n) DETACH DELETE n');
            logger.info('Database reset complete.');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            logger.error('Failed to reset database', { error: err });
            throw new DatabaseError('Failed to reset database', { originalError: err.message });
        }
    }
}