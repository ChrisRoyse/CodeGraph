import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { AnalyzerService } from '../../src/analyzer/analyzer-service.js';
import { Neo4jClient } from '../../src/database/neo4j-client.js';
import { StorageManager } from '../../src/analyzer/storage-manager.js';
import { generateEntityId } from '../../src/analyzer/parser-utils.js';
import { createContextLogger } from '../../src/utils/logger.js';
import { CanonicalId } from '../../src/ir/schema.js';
import { Language } from '../../src/types/index.js';

const logger = createContextLogger('SimpleIntraFilePySpec');

// Helper function to load expected graph
const loadExpectedGraph = async (filePath: string): Promise<any> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
};

// Helper function to query Neo4j and format results using RELATIVE paths
const getActualGraph = async (neo4jClient: Neo4jClient, relativeBasePath: string): Promise<any> => {
    const queryBasePath = relativeBasePath.replace(/\\/g, '/'); // Ensure forward slashes
    console.log(`Querying graph for path starting with relative: ${queryBasePath}`);
    const session = await neo4jClient.getSession();
    try {
        const nodeResult = await session.run(
            `MATCH (n) WHERE n.filePath STARTS WITH $basePath OR n.filePath = $basePath RETURN n, labels(n) as nodeLabels`,
            { basePath: queryBasePath }
        );
        const relResult = await session.run(
            `MATCH (n)-[r]->(m)
             WHERE (n.filePath STARTS WITH $basePath OR n.filePath = $basePath)
               AND (m.filePath STARTS WITH $basePath OR m.filePath = $basePath)
             RETURN r, n.entityId AS sourceId, m.entityId AS targetId`,
            { basePath: queryBasePath }
        );

        const nodes = nodeResult.records.map(record => {
            const nodeN = record.get('n');
            return {
                labels: record.get('nodeLabels') || [],
                properties: nodeN.properties,
            };
        });

        const relationships = relResult.records.map(record => {
            const relR = record.get('r');
            return {
                type: relR.type,
                properties: relR.properties,
                sourceId: record.get('sourceId'),
                targetId: record.get('targetId'),
            };
        });

        console.log(`Found ${nodes.length} nodes and ${relationships.length} relationships.`);
        return { nodes, relationships };

    } finally {
        if (session) await session.close();
    }
};


// Helper function to clean Neo4j using the RELATIVE path
const cleanGraph = async (neo4jClient: Neo4jClient, relativeBasePath: string): Promise<void> => {
    const queryBasePath = relativeBasePath.replace(/\\/g, '/'); // Ensure forward slashes
    let session;
    try {
        session = await neo4jClient.getSession();
        console.log(`Cleaning graph for path starting with relative: ${queryBasePath}`);
        const result = await session.run(
            `MATCH (n) WHERE n.filePath STARTS WITH $basePath OR n.filePath = $basePath DETACH DELETE n RETURN count(n) as deletedCount`,
            { basePath: queryBasePath }
        );
        console.log(`Deleted ${result.records[0]?.get('deletedCount') || 0} nodes.`);
    } catch (error) {
        console.error("Error cleaning graph:", error);
    } finally {
        if (session) await session.close();
    }
};


describe('AnalyzerService - Simple Python Intra-file Analysis', () => {
    let analyzerService: AnalyzerService;
    let neo4jClient: Neo4jClient;
    let storageManager: StorageManager;
    const projectRoot = path.resolve(process.cwd()).replace(/\\/g, '/');
    const relativeFixturePath = 'test_fixtures/simple_intra_file_py'; // Use relative path now
    const absoluteFixturePath = path.join(projectRoot, relativeFixturePath); // Still need absolute for loading expected
    const expectedGraphPath = path.join(absoluteFixturePath, 'expected_graph.json');

    // Helper to convert absolute paths in actual data to relative for comparison
    const makePathRelative = (absolutePath: string | undefined): string | undefined => {
        if (!absolutePath) return undefined;
        const normalizedAbsolutePath = absolutePath.replace(/\\/g, '/');
        if (normalizedAbsolutePath.startsWith(projectRoot + '/')) {
            return normalizedAbsolutePath.substring(projectRoot.length + 1);
        }
        if (!path.isAbsolute(normalizedAbsolutePath)) {
            return normalizedAbsolutePath;
        }
        logger.warn(`Path ${absolutePath} could not be made relative to project root ${projectRoot}`);
        return absolutePath;
    };


    beforeEach(async () => {
        const neo4jConfig = {
            uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
            username: process.env.NEO4J_USERNAME || 'neo4j',
            password: process.env.NEO4J_PASSWORD || 'test1234',
        };
        neo4jClient = new Neo4jClient(neo4jConfig);
        storageManager = new StorageManager(neo4jClient);
        try {
             const session = await neo4jClient.getSession();
             await session.run('RETURN 1'); await session.close();
             console.log("Neo4j connection successful.");
        } catch (error) {
            console.error("Initial Neo4j connection check failed:", error);
            throw new Error(`Neo4j connection failed. URI: ${neo4jConfig.uri}`);
        }
        await cleanGraph(neo4jClient, relativeFixturePath); // Use relative path for cleaning
        analyzerService = new AnalyzerService(neo4jClient, storageManager);
        await analyzerService.initialize();
        console.log("AnalyzerService initialized.");
    }, 30000);

    afterEach(async () => {
        await cleanGraph(neo4jClient, relativeFixturePath); // Use relative path for cleaning
    }, 30000);

    it('should correctly analyze a simple Python file with intra-file function calls', async () => {
        console.log(`Analyzing fixture path (relative): ${relativeFixturePath}`);
        // AnalyzerService likely expects an absolute path for analysis entry point
        await analyzerService.analyze(absoluteFixturePath);
        console.log("Analysis complete.");

        const expectedGraph = await loadExpectedGraph(expectedGraphPath);
        console.log("Expected graph loaded.");
        const actualGraph = await getActualGraph(neo4jClient, relativeFixturePath); // Use relative path for querying
        console.log("Actual graph retrieved.");

        // --- Node Comparison ---
        const normalizeProperties = (props: Record<string, any> | undefined, nodeLabels: string[] = [], isActual = false): Record<string, any> => {
            if (!props) return {};

            const output: Record<string, any> = {};
            const expectedKeys = new Set<string>();

            // Define expected keys based on labels (derived from expected_graph.json structure)
            if (nodeLabels.includes('Directory')) {
                expectedKeys.add('path');
            } else if (nodeLabels.includes('File')) {
                expectedKeys.add('path');
                expectedKeys.add('language');
                expectedKeys.add('lines_of_code');
            } else if (nodeLabels.includes('Function')) { // Includes Method
                expectedKeys.add('name'); expectedKeys.add('fqn'); expectedKeys.add('file_path');
                expectedKeys.add('start_line'); expectedKeys.add('end_line'); expectedKeys.add('signature');
                expectedKeys.add('return_type'); // Added
                expectedKeys.add('is_method'); expectedKeys.add('is_async'); expectedKeys.add('is_constructor');
            } else if (nodeLabels.includes('Parameter')) {
                expectedKeys.add('name'); expectedKeys.add('fqn'); expectedKeys.add('data_type'); expectedKeys.add('index'); // file_path not directly on Parameter properties
            } else if (nodeLabels.includes('Variable')) {
                expectedKeys.add('name'); expectedKeys.add('fqn'); expectedKeys.add('file_path');
                expectedKeys.add('start_line'); expectedKeys.add('end_line'); expectedKeys.add('data_type'); expectedKeys.add('scope');
            }

            // Copy only expected properties and normalize paths/bigints
            for (const key of Object.keys(props)) {
                if (expectedKeys.has(key)) {
                    let value = props[key];
                    // Normalize paths: Convert absolute to relative for ACTUAL data
                    if (isActual && ['path', 'fqn', 'file_path'].includes(key) && typeof value === 'string') {
                        value = makePathRelative(value);
                    }
                    // Ensure expected paths use forward slashes
                    else if (!isActual && ['path', 'fqn', 'file_path'].includes(key) && typeof value === 'string') {
                         value = value.replace(/\\/g, '/');
                    }

                    // Normalize BigInts
                    if (typeof value === 'bigint') {
                        value = Number(value);
                    }
                    // Normalize language case consistently
                    if (key === 'language' && typeof value === 'string') {
                        value = value.toLowerCase();
                    }
                    output[key] = value;
                }
            }
            return output;
        };

        const normalizeNode = (node: any, isActual = false) => ({
            labels: node.labels.sort(),
            properties: normalizeProperties(node.properties, node.labels, isActual),
        });

        const sortNodes = (a: any, b: any) => {
            const fqnA = a.properties?.fqn ?? a.properties?.path ?? '';
            const fqnB = b.properties?.fqn ?? b.properties?.path ?? '';
            return fqnA.localeCompare(fqnB);
        };

        const actualNodesNormalized = actualGraph.nodes.map(node => normalizeNode(node, true)).sort(sortNodes);
        const expectedNodesNormalized = expectedGraph.nodes.map(node => normalizeNode(node, false)).sort(sortNodes);

        console.log("Normalized Actual Nodes:", JSON.stringify(actualNodesNormalized, null, 2));
        console.log("Normalized Expected Nodes:", JSON.stringify(expectedNodesNormalized, null, 2));
        expect(actualNodesNormalized).toEqual(expectedNodesNormalized);


        // --- Relationship Comparison ---
        // Helper to generate expected CANONICAL entity IDs based on RELATIVE FQN
        // Must match the logic in ir-utils.ts/generateCanonicalId
        const getExpectedCanonicalId = (relativeFqn: string): CanonicalId | null => {
            if (!relativeFqn) return null;

            // Derive projectId from the relative fixture path base
            const projectId = path.basename(relativeFixturePath); // e.g., 'simple_intra_file_py'
            let entityType = 'unknown';
            let entityPath = relativeFqn; // Start with the FQN as the base for the path

            // Determine entityType and adjust entityPath based on FQN structure
            // This logic mirrors the expected_graph.json structure and generateCanonicalId logic
            const relativePathBase = 'test_fixtures/simple_intra_file_py';
            if (relativeFqn === relativePathBase) {
                 entityType = 'directory';
                 // Canonical ID for directory uses the path directly
                 entityPath = relativePathBase;
            } else if (relativeFqn === `${relativePathBase}/main.py`) {
                 entityType = 'file';
                 entityPath = `${relativePathBase}/main.py`;
            } else if (relativeFqn === `${relativePathBase}/main.py:greet`) {
                 entityType = 'function';
                 entityPath = `${relativePathBase}/main.py:greet`;
            } else if (relativeFqn === `${relativePathBase}/main.py:main`) {
                 entityType = 'function';
                 entityPath = `${relativePathBase}/main.py:main`;
            } else if (relativeFqn === `${relativePathBase}/main.py:greet#name`) {
                 // Parameters don't have their own top-level nodes/IDs in this IR version
                 // They are properties of the Function element. Return null.
                 console.warn(`Parameters like '${relativeFqn}' do not have independent canonical IDs.`);
                 return null;
            } else if (relativeFqn === `${relativePathBase}/main.py:greet:message`) {
                 entityType = 'variable';
                 entityPath = `${relativePathBase}/main.py:message`; // Variable path is file:name
            } else if (relativeFqn === `${relativePathBase}/main.py:main:result`) {
                 entityType = 'variable';
                 entityPath = `${relativePathBase}/main.py:result`; // Variable path is file:name
            } else {
                 console.warn(`Could not determine entity type for relative FQN: ${relativeFqn}`);
                 return null;
            }

            // Construct the canonical ID: connectome://<project_id>/<entity_type>:<entity_path>
            // Ensure path separators are forward slashes
            const cleanedPath = entityPath.replace(/\\/g, '/');
            return `connectome://${projectId}/${entityType}:${cleanedPath}`;
        };
        const normalizeRelationship = (rel: any) => ({
            type: rel.type,
            sourceId: rel.sourceId,
            targetId: rel.targetId,
            properties: normalizeProperties(rel.properties, [], true),
        });

         const sortRelationships = (a: any, b: any) => {
             const strA = `${a.type}-${a.sourceId}-${a.targetId}`;
             const strB = `${b.type}-${b.sourceId}-${b.targetId}`;
             return strA.localeCompare(strB);
         };

        const actualRelationshipsNormalized = actualGraph.relationships
            .map(normalizeRelationship)
            .sort(sortRelationships);

        // Normalize expected relationships to use entity IDs generated with RELATIVE FQNs
        const expectedRelationshipsNormalized = expectedGraph.relationships
            .map((rel: any) => {
                // Use the relative FQNs from the JSON to generate the expected entity IDs
                // Ensure the FQNs passed to getExpectedEntityId match the updated expected_graph.json
                const sourceId = getExpectedCanonicalId(rel.source_fqn); // Use new helper
                const targetId = getExpectedCanonicalId(rel.target_fqn); // Use new helper
                if (!sourceId || !targetId) {
                    console.warn(`Could not generate expected entity IDs for relationship: ${JSON.stringify(rel)}`);
                    return null; // Skip relationships where ID generation failed
                }

                // Normalize properties specific to relationships if needed
                let normalizedRelProps = { ...rel.properties }; // Start with properties from expected_graph.json

                // Ensure numeric properties are numbers
                if (rel.type === 'HAS_PARAMETER' && normalizedRelProps.index !== undefined) {
                    normalizedRelProps.index = Number(normalizedRelProps.index);
                }
                if (rel.type === 'CALLS' && normalizedRelProps.lineNumber !== undefined) {
                    normalizedRelProps.lineNumber = Number(normalizedRelProps.lineNumber);
                }
                // Add other type normalizations if necessary (e.g., boolean strings to booleans)

                // Remove properties not expected in the actual relationship properties
                // (e.g., source_fqn, target_fqn are used for ID generation but not stored in rel props)
                // delete normalizedRelProps.source_fqn; // Not present in rel.properties anyway
                // delete normalizedRelProps.target_fqn;

                return {
                    type: rel.type,
                    sourceId: sourceId,
                    targetId: targetId,
                    properties: normalizedRelProps, // Use normalized props
                };
            })
            .filter((rel: any) => rel !== null) // Filter out skipped relationships
            .sort(sortRelationships);

        console.log("Normalized Actual Relationships:", JSON.stringify(actualRelationshipsNormalized, null, 2));
        console.log("Normalized Expected Relationships:", JSON.stringify(expectedRelationshipsNormalized, null, 2));
        expect(actualRelationshipsNormalized).toEqual(expectedRelationshipsNormalized);

    }, 60000);
});