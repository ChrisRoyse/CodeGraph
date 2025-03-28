// Use require for CommonJS
const neo4j = require('neo4j-driver');
const z = require('zod');
const { VectorService } = require('../../../dist/vector/vector-service.js'); // Adjust path for compiled output
// const fs = require('fs/promises'); // No longer needed for file writing
// const path = require('path'); // No longer needed for file writing

// Define output directory relative to server CWD (No longer needed)
// const OUTPUT_DIR = path.resolve(process.cwd(), '.');

// Helper to ensure output directory exists (No longer needed)
// async function ensureOutputDir() { ... }

// Helper function to run read queries
async function runReadQuery(driver: typeof neo4j.Driver, query: string, params: Record<string, any> = {}) {
    const session = driver.session({ database: process.env.NEO4J_DATABASE || 'codegraph' });
    try {
        const neo4jParams = Object.entries(params).reduce((acc, [key, value]) => {
            // Convert JS numbers to Neo4j Integers for properties expecting them
            if (['limit', 'threshold', 'maxDepth', 'topK'].includes(key) && Number.isInteger(value)) { // Removed context-specific params
                acc[key] = neo4j.int(value);
            } else {
                acc[key] = value;
            }
            return acc;
        }, {} as Record<string, any>);

        const loggableParams = { ...neo4jParams };
        if (loggableParams.queryVector) loggableParams.queryVector = '[embedding vector]';
        console.error(`[DEBUG] Running Query: ${query}`);
        console.error(`[DEBUG] With Neo4j Params: ${JSON.stringify(loggableParams)}`);

        const result = await session.readTransaction((tx: any) => tx.run(query, neo4jParams));
        // Convert Neo4j integers/BigInts immediately upon retrieval
        return result.records.map((record: any) => {
             const obj = record.toObject();
             // Custom handling for relationship results which might not be simple objects
             if (obj.rel && obj.rel.identity) { // Check if it looks like a relationship object
                 return {
                     startNodeId: neo4j.isInt(obj.startNodeId) ? obj.startNodeId.toNumber() : obj.startNodeId,
                     endNodeId: neo4j.isInt(obj.endNodeId) ? obj.endNodeId.toNumber() : obj.endNodeId,
                     rel: relationshipToObject(obj.rel) // Process relationship separately
                 };
             }
             // Process node objects
             for (const key in obj) {
                 if (neo4j.isInt(obj[key])) {
                     obj[key] = obj[key].toNumber(); // Convert Neo4j Int
                 } else if (typeof obj[key] === 'bigint') {
                     obj[key] = Number(obj[key]); // Convert JS BigInt
                 } else if (obj[key] && typeof obj[key] === 'object' && obj[key].identity) {
                     // If a field contains a node object, process it
                     obj[key] = nodeToObject(obj[key]);
                 } else if (Array.isArray(obj[key])) {
                     // If a field contains an array (e.g., list of nodes/rels), process items
                     obj[key] = obj[key].map((item: any) => {
                         if (item && typeof item === 'object' && item.identity) return nodeToObject(item);
                         if (item && typeof item === 'object' && item.start) return relationshipToObject(item); // Check if it's a relationship-like object
                         return item;
                     }).filter(Boolean); // Remove nulls from failed conversions
                 }
             }
             return obj;
         });
    } finally {
        await session.close();
    }
}

// Helper to save results and return message (No longer needed)
// async function saveContextToFile(targetName: string, contextData: any): Promise<string> { ... }

// Helper to convert Neo4j node to plain object, excluding embedding
function nodeToObject(node: any): Record<string, any> | null {
    if (!node || !node.properties) return null;
    const { embedding, ...properties } = node.properties; // Exclude embedding
    return {
        // id: node.identity?.toString(), // Use entityId instead
        labels: node.labels?.filter((l: string) => l !== 'Embeddable'), // Filter Embeddable label
        ...properties
    };
}

// Helper to convert Neo4j relationship to plain object, excluding embedding
function relationshipToObject(rel: any): Record<string, any> | null {
    if (!rel || !rel.properties || !rel.type || !rel.start || !rel.end) return null;
    const { embedding, ...properties } = rel.properties; // Exclude embedding
    return {
        // id: rel.identity?.toString(), // Use entityId instead
        type: rel.type,
        startNodeElementId: rel.start?.toString(), // Element ID of start node
        endNodeElementId: rel.end?.toString(), // Element ID of end node
        ...properties
    };
}


// --- Tool Definition ---

// Define ExecutableTool locally or use 'any'
interface ExecutableTool {
    name: string;
    description: string;
    inputSchema: any;
    zodSchema?: any;
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: typeof VectorService) => Promise<any>;
}

// Updated Zod Schema - Removed depth/limit parameters
const GetNodeContextInputZodSchema = z.object({
    targetName: z.string().describe("Name of the primary node (Function, Class, etc.) to get context for."),
    targetKind: z.string().optional().describe("Optional kind of the target node for disambiguation (e.g., 'Function', 'Class')."),
    targetFilePath: z.string().optional().describe("Optional file path of the target node for disambiguation."),
});

// Updated JSON Schema - Removed depth/limit properties
const GetNodeContextInputJSONSchema = {
    type: "object",
    properties: {
        targetName: { type: 'string', description: "Name of the primary node (Function, Class, etc.) to get context for." },
        targetKind: { type: 'string', description: "Optional kind of the target node for disambiguation.", optional: true },
        targetFilePath: { type: 'string', description: "Optional file path of the target node for disambiguation.", optional: true },
    },
    required: ['targetName'],
} as const;

const getNodeContextTool: ExecutableTool = {
    name: 'get_node_context',
    // Updated description
    description: 'Gathers comprehensive context for a specific code node, including its properties and its 2-hop neighborhood (nodes and relationships).',
    inputSchema: GetNodeContextInputJSONSchema,
    zodSchema: GetNodeContextInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Use 'any' for args
        // Updated result structure
        const contextResult: Record<string, any> = {
            targetNode: null,
            neighborhood: {
                nodes: [],
                relationships: []
            },
            errors: [],
        };

        try {
            // 1. Find Target Node (Same as before)
            let matchClause = `MATCH (target {name: $targetName})`;
            const params: Record<string, any> = { targetName: args.targetName };
            if (args.targetKind) {
                matchClause = `MATCH (target:\`${args.targetKind}\` {name: $targetName})`;
            }
            if (args.targetFilePath) {
                // Ensure uppercase C:/ for path matching
                params.targetFilePath = args.targetFilePath.startsWith('C:/')
                    ? args.targetFilePath
                    : `C:/code/amcp/${args.targetFilePath.replace(/^\.\//, '')}`;
                matchClause += ` WHERE target.filePath = $targetFilePath`;
            }
            const targetQuery = `${matchClause} RETURN target LIMIT 2`; // Limit 2 to detect ambiguity
            const targetRes = await runReadQuery(driver, targetQuery, params);

            if (targetRes.length === 0) {
                throw new Error(`Target node "${args.targetName}" not found` + (args.targetFilePath ? ` in file ${args.targetFilePath}` : ''));
            }
            if (targetRes.length > 1) {
                throw new Error(`Ambiguous target node "${args.targetName}". Provide targetKind or targetFilePath.`);
            }
            const targetNeo4jNode = targetRes[0].target;
            contextResult.targetNode = nodeToObject(targetNeo4jNode); // Use helper
            const targetId = contextResult.targetNode?.entityId;

            if (!targetId) {
                 throw new Error(`Could not retrieve entityId for target node "${args.targetName}".`);
            }
            params.targetId = targetId; // Add targetId for subsequent queries

            // 2. Get 2-Hop Neighborhood
            console.error(`[DEBUG] Fetching 2-hop neighborhood for targetId: ${targetId}`);
            const neighborhoodQuery = `
                MATCH (target {entityId: $targetId})
                CALL {
                    WITH target
                    MATCH path = (target)-[rels*1..2]-(neighbor) // Get paths up to 2 hops
                    RETURN nodes(path) as pathNodes, relationships(path) as pathRels
                }
                UNWIND pathNodes as node // Unwind all nodes in the paths
                UNWIND pathRels as rel   // Unwind all relationships in the paths
                RETURN collect(DISTINCT node) as nodes, collect(DISTINCT rel) as relationships
            `;
            const neighborhoodRes = await runReadQuery(driver, neighborhoodQuery, { targetId });

            if (neighborhoodRes.length > 0 && neighborhoodRes[0]) {
                 // Process nodes and relationships using helpers
                 contextResult.neighborhood.nodes = (neighborhoodRes[0].nodes || []).map(nodeToObject).filter(Boolean);
                 contextResult.neighborhood.relationships = (neighborhoodRes[0].relationships || []).map(relationshipToObject).filter(Boolean);
                 console.error(`[DEBUG] Found ${contextResult.neighborhood.nodes.length} nodes and ${contextResult.neighborhood.relationships.length} relationships in 2-hop neighborhood.`);
            } else {
                 console.error(`[DEBUG] No neighborhood found within 2 hops for targetId: ${targetId}`);
            }

            // Remove old sections (location, dependencies, siblings, impacted, similar)
            delete contextResult.location;
            delete contextResult.dependencies;
            delete contextResult.siblings;
            delete contextResult.impactedNodes;
            delete contextResult.similarNodes;


        } catch (error: any) {
            console.error(`Error fetching context for ${args.targetName}:`, error);
            contextResult.errors.push({
                phase: 'Overall Execution',
                message: error.message,
                stack: error.stack
            });
        }

        // Return the context object directly
        // Exclude embedding vectors from the JSON output for readability
        const resultWithoutEmbeddings = JSON.parse(JSON.stringify(contextResult, (key, value) =>
            key === 'embedding' ? '[embedding vector]' : (typeof value === 'bigint' ? value.toString() : value)
        ));
        return resultWithoutEmbeddings;
    },
};

// Use module.exports for CommonJS
module.exports = {
    contextTools: [ // Export under a different name
        getNodeContextTool,
    ]
};