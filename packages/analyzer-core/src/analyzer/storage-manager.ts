import fs from 'fs/promises';
import path from 'path';
import { Neo4jClient } from '../database/neo4j-client.js';
// Use import type for type-only imports
import type { AstNode, RelationshipInfo } from './types.js';
import { createContextLogger } from '../utils/logger.js';
import { generateRelationshipId } from './parser-utils.js'; // Assuming parser-utils.js is ESM compatible now
import { config } from '../config/index.js'; // Use named import
import { Neo4jError } from '../utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

const logger = createContextLogger('StorageManager');

const CACHE_DIR = '.analyzer_cache';
const ENTITY_ID_CACHE_FILE = 'entity_ids.json';
const ENTITY_ID_CACHE_PATH = path.join(CACHE_DIR, ENTITY_ID_CACHE_FILE);

// Type definitions remain the same
export type EntityIdMap = Record<string, string[]>; // Add export

interface ResolvedRelationship {
    from: AstNode;
    to: AstNode;
    type: string;
    properties?: Record<string, any>;
}

export class StorageManager { // Add export keyword
    private neo4jClient: Neo4jClient; // Use the class name directly as the type
    private batchSize: number;

    constructor(neo4jClient: Neo4jClient) { // Use the class name directly as the type
        this.neo4jClient = neo4jClient;
        this.batchSize = config.storageBatchSize;
        logger.info(`StorageManager initialized with injected Neo4jClient and batch size: ${this.batchSize}`);
    }

    // --- Entity ID Cache File Operations ---
    async loadEntityIdMap(): Promise<EntityIdMap> {
        try {
            await fs.access(ENTITY_ID_CACHE_PATH);
            const fileContent = await fs.readFile(ENTITY_ID_CACHE_PATH, 'utf-8');
            if (!fileContent.trim()) return {};
            const map = JSON.parse(fileContent) as EntityIdMap;
            logger.info(`Loaded entity ID map from ${ENTITY_ID_CACHE_PATH}`);
            return map;
        } catch (error: any) {
            if (error.code === 'ENOENT') return {};
            logger.error(`Failed to load entity ID map from ${ENTITY_ID_CACHE_PATH}`, { error: error.message });
            return {};
        }
    }

    async saveEntityIdMap(map: EntityIdMap): Promise<void> {
        try {
            await fs.mkdir(CACHE_DIR, { recursive: true });
            const jsonContent = JSON.stringify(map, null, 2);
            await fs.writeFile(ENTITY_ID_CACHE_PATH, jsonContent, 'utf-8');
            logger.info(`Successfully saved entity ID map to ${ENTITY_ID_CACHE_PATH}`);
        } catch (error: any) {
            logger.error(`Failed to save entity ID map to ${ENTITY_ID_CACHE_PATH}`, { error: error.message });
            throw new Error(`Failed to save entity ID map: ${error.message}`);
        }
    }

    async clearEntityIdMap(): Promise<void> {
        try {
            await fs.unlink(ENTITY_ID_CACHE_PATH);
            logger.info(`Successfully cleared entity ID map file: ${ENTITY_ID_CACHE_PATH}`);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                logger.warn(`Attempted to clear entity ID map file, but it did not exist: ${ENTITY_ID_CACHE_PATH}`);
                return;
            }
            logger.error(`Failed to clear entity ID map file: ${ENTITY_ID_CACHE_PATH}`, { error: error.message });
            throw new Error(`Failed to clear entity ID map file: ${error.message}`);
        }
    }

    // --- Neo4j Operations ---
    async saveNodesBatch(nodes: AstNode[]): Promise<void> {
        if (nodes.length === 0) {
            logger.debug('No nodes provided to saveNodesBatch.');
            return;
        }
        logger.info(`Saving ${nodes.length} unique nodes to database...`);

        for (let i = 0; i < nodes.length; i += this.batchSize) {
             const batch = nodes.slice(i, i + this.batchSize);
             if (batch.length === 0) continue;

            const preparedBatch = batch.map(node => {
                const properties = this.prepareNodeProperties(node);
                // IMPORTANT: Remove entityId from the properties map that will be used in SET +=
                // It's already used in the MERGE clause. Including it in SET += is redundant and potentially problematic.
                delete properties.entityId;
                return {
                    entityId: node.entityId, // Keep entityId separate for MERGE
                    labels: node.labels ?? [node.kind ?? 'Unknown'],
                    properties: properties // Pass the rest of the properties
                };
            });

            const cypher = `
                UNWIND $batch AS nodeData
                MERGE (n { entityId: nodeData.entityId })
                // Use SET n += properties instead of SET n = properties
                // This merges the new properties onto the node
                SET n += nodeData.properties
                WITH n, nodeData
                // Ensure labels are handled correctly after properties are set/merged
                CALL apoc.create.removeLabels(n, [label IN labels(n) WHERE label <> 'Resource']) YIELD node as removedLabelsNode // Keep Resource label if present
                WITH n, nodeData
                CALL apoc.create.addLabels(n, nodeData.labels) YIELD node as addedLabelsNode
                RETURN count(addedLabelsNode)
            `;

            try {
                await this.neo4jClient.runTransaction(cypher, { batch: preparedBatch }, 'WRITE', 'StorageManager-Nodes');
                logger.debug(`Saved batch of ${preparedBatch.length} nodes (Total processed: ${Math.min(i + preparedBatch.length, nodes.length)}/${nodes.length})`);
            } catch (error: any) {
                logger.error(`Failed to save node batch (index ${i})`, { error: error.message, code: error.code });
                 logger.error(`Failing node batch data (first 5): ${JSON.stringify(preparedBatch.slice(0, 5), null, 2)}`);
                throw new Neo4jError(`Failed to save node batch: ${error.message}`, { originalError: error, code: error.code });
            }
        }
        logger.info(`Finished saving ${nodes.length} unique nodes.`);
    }

    async saveRelationshipsBatch(relationshipType: string, relationships: RelationshipInfo[]): Promise<void> {
        if (relationships.length === 0) {
            logger.debug(`No relationships of type ${relationshipType} provided.`);
            return;
        }
        logger.info(`Saving ${relationships.length} unique relationships of type ${relationshipType}...`);

        for (let i = 0; i < relationships.length; i += this.batchSize) {
            const batch = relationships.slice(i, i + this.batchSize);
             if (batch.length === 0) continue;

             const preparedBatch = batch.map(rel => this.prepareRelationshipProperties(rel));

            const cypher = `
                UNWIND $batch AS relData
                 MERGE (source { entityId: relData.sourceId })
                 MERGE (target { entityId: relData.targetId })
                 MERGE (source)-[r:\`${relationshipType}\` { relationshipId: relData.relationshipId }]->(target)
                 ON CREATE SET
                     r.type = relData.type,
                     r.createdAt = relData.createdAt,
                     r.weight = relData.weight,
                     r.relationshipId = relData.relationshipId,
                     r += relData.properties
                 ON MATCH SET
                     r.weight = relData.weight,
                     r += relData.properties
            `;

            try {
                await this.neo4jClient.runTransaction(cypher, { batch: preparedBatch }, 'WRITE', 'StorageManager-Rels');
                logger.debug(`Saved batch of ${preparedBatch.length} relationships (Total processed: ${Math.min(i + preparedBatch.length, relationships.length)}/${relationships.length})`);
            } catch (error: any) {
                logger.error(`Failed to save relationship batch (index ${i}, type: ${relationshipType})`, { error: error.message, code: error.code });
                 logger.error(`Failing relationship batch data (first 5): ${JSON.stringify(preparedBatch.slice(0, 5), null, 2)}`);
                throw new Neo4jError(`Failed to save relationship batch (type ${relationshipType}): ${error.message}`, { originalError: error, code: error.code, context: { batch: preparedBatch.slice(0,5) } });
            }
        }
        logger.info(`Finished saving ${relationships.length} unique relationships of type ${relationshipType}.`);
    }

    async deleteNodesAndRelationships(entityIds: string[]): Promise<void> {
        if (entityIds.length === 0) return;
        logger.info(`Deleting ${entityIds.length} entities...`);

        for (let i = 0; i < entityIds.length; i += this.batchSize) {
            const batch = entityIds.slice(i, i + this.batchSize);
            if (batch.length === 0) continue;

            const cypher = `
                UNWIND $batch AS entityId
                MATCH (n {entityId: entityId})
                DETACH DELETE n
            `;

            try {
                // Assuming runTransaction returns QueryResult or similar with summary
                const result: any = await this.neo4jClient.runTransaction(cypher, { batch }, 'WRITE', 'StorageManager-Delete');
                const nodesDeleted = result?.summary?.counters?.updates?.()?.nodesDeleted ?? 0;
                const relationshipsDeleted = result?.summary?.counters?.updates?.()?.relationshipsDeleted ?? 0;
                logger.debug(`Deleted batch of ${batch.length} entity IDs (Nodes: ${nodesDeleted}, Rels: ${relationshipsDeleted}). Total processed: ${Math.min(i + batch.length, entityIds.length)}/${entityIds.length}`);
            } catch (error: any) {
                logger.error(`Failed to delete entity batch (index ${i})`, { error: error.message, code: error.code });
                logger.error(`Failing entity ID batch data (first 5): ${JSON.stringify(batch.slice(0, 5), null, 2)}`);
                throw new Neo4jError(`Failed to delete entity batch: ${error.message}`, { originalError: error, code: error.code });
            }
        }
        logger.info(`Finished deleting ${entityIds.length} entities.`);
    }

    async persistResolvedRelationships(resolvedRelationships: ResolvedRelationship[]): Promise<void> { // ResolvedRelationship is defined locally
        if (!resolvedRelationships || resolvedRelationships.length === 0) return;
        logger.info(`Persisting ${resolvedRelationships.length} resolved relationships...`);
        const now = new Date().toISOString();

        const uniqueNodes = new Map<string, AstNode>();
        resolvedRelationships.forEach(rel => {
            if (rel.from && !uniqueNodes.has(rel.from.entityId)) uniqueNodes.set(rel.from.entityId, rel.from);
            if (rel.to && !uniqueNodes.has(rel.to.entityId)) uniqueNodes.set(rel.to.entityId, rel.to);
        });

        const nodesToSave = Array.from(uniqueNodes.values());
        if (nodesToSave.length > 0) {
            logger.info(`Ensuring ${nodesToSave.length} source/target nodes exist...`);
            await this.saveNodesBatch(nodesToSave);
        }

        const relationshipsByType: Record<string, RelationshipInfo[]> = {};
        for (const rel of resolvedRelationships) {
            if (!rel.from || !rel.to || !rel.type) {
                logger.warn('Skipping invalid resolved relationship:', { relationship: rel });
                continue;
            }
            const deterministicRelationshipId = generateRelationshipId(rel.from.entityId, rel.to.entityId, rel.type);
            const relationshipInfo: RelationshipInfo = {
                id: uuidv4(),
                entityId: deterministicRelationshipId,
                relationshipId: deterministicRelationshipId,
                sourceId: rel.from.entityId,
                targetId: rel.to.entityId,
                type: rel.type.toUpperCase(),
                properties: rel.properties || {},
                createdAt: now,
            };
            if (!relationshipsByType[relationshipInfo.type]) {
                relationshipsByType[relationshipInfo.type] = [];
            }
            relationshipsByType[relationshipInfo.type]!.push(relationshipInfo);
        }

        for (const [type, rels] of Object.entries(relationshipsByType)) {
            if (rels.length > 0) await this.saveRelationshipsBatch(type, rels);
        }
        logger.info(`Finished persisting ${resolvedRelationships.length} resolved relationships.`);
    }


    /**
     * Prepares AstNode properties for Neo4j storage.
     * Constructs the properties object explicitly from AstNode fields.
     */
    private prepareNodeProperties(node: AstNode): Record<string, any> {
        const finalProperties: Record<string, any> = {
            entityId: node.entityId,
            name: node.name,
            kind: node.kind,
            filePath: node.filePath,
            startLine: node.startLine,
            endLine: node.endLine,
            startColumn: node.startColumn,
            endColumn: node.endColumn,
            language: node.language,
            createdAt: node.createdAt,
        };

        if (node.loc !== undefined) finalProperties.loc = node.loc;
        if (node.isExported !== undefined) finalProperties.isExported = node.isExported;
        if (node.parentId !== undefined) finalProperties.parentId = node.parentId;
        if (node.signature !== undefined) finalProperties.signature = node.signature;
        if (node.scope !== undefined) finalProperties.scope = node.scope;
        if (node.dataType !== undefined) finalProperties.dataType = node.dataType;
        if (node.isAsync !== undefined) finalProperties.isAsync = node.isAsync;
        if (node.accessModifier !== undefined) finalProperties.accessModifier = node.accessModifier;
        if (node.decorators !== undefined) finalProperties.decorators = node.decorators;
        if (node.returnType !== undefined) finalProperties.returnType = node.returnType;

        if (node.properties && typeof node.properties === 'object') {
            for (const key in node.properties) {
                if (!(key in finalProperties)) {
                    finalProperties[key] = node.properties[key];
                } else if (key === 'filePath' && finalProperties[key] !== node.properties[key]) {
                     logger.warn(`Nested property 'filePath' (${node.properties[key]}) conflicts with top-level filePath (${finalProperties[key]}) for node ${node.entityId}. Using top-level.`);
                }
            }
        }

        Object.keys(finalProperties).forEach(key => {
            if (finalProperties[key] === undefined) {
                delete finalProperties[key];
            }
        });

        return finalProperties;
    }


    /**
     * Prepares RelationshipInfo properties for Neo4j storage.
     */
    private prepareRelationshipProperties(rel: RelationshipInfo): Record<string, any> {
        const preparedProps = { ...rel.properties };
         for (const key in preparedProps) {
             if (preparedProps[key] === undefined) {
                 preparedProps[key] = null;
             }
         }
        return {
            relationshipId: rel.relationshipId,
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            type: rel.type,
            weight: rel.weight ?? 0,
            createdAt: rel.createdAt,
            properties: preparedProps,
        };
    }
}
