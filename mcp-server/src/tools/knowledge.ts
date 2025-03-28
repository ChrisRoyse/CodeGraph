// Use require for CommonJS
const neo4j = require('neo4j-driver');
const z = require('zod');
// Import VectorService class type for execute signature
// Adjust path relative to the compiled output location (dist/tools -> dist/vector)
const { VectorService } = require('../../../dist/vector/vector-service.js'); // Corrected path

// Cannot use type-only import with require
// import type { ExecutableTool } from '../index.js';
const fs = require('fs/promises');
const path = require('path');

// Define output directory relative to project root
const OUTPUT_DIR = path.resolve(process.cwd(), '../mcp-server-output');

// Helper to ensure output directory exists
async function ensureOutputDir() {
    try {
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
    } catch (error) {
        console.error(`Failed to create output directory: ${OUTPUT_DIR}`, error);
    }
}

// Helper function to run read queries
async function runReadQuery(driver: typeof neo4j.Driver, query: string, params: Record<string, any> = {}) {
    const session = driver.session({ database: process.env.NEO4J_DATABASE || 'codegraph' });
    try {
        // Ensure integer parameters are correctly formatted for Neo4j
        const neo4jParams = Object.entries(params).reduce((acc, [key, value]) => {
            // Use neo4j.int for known integer params, pass others directly
            if (['limit', 'threshold', 'maxDepth', 'topK'].includes(key) && Number.isInteger(value)) {
                acc[key] = neo4j.int(value);
            } else {
                acc[key] = value; // Handles strings, floats (for score), arrays (embeddings) etc.
            }
            return acc;
        }, {} as Record<string, any>);

        // Avoid logging potentially very large embedding vectors
        const loggableParams = { ...neo4jParams };
        if (loggableParams.queryVector) loggableParams.queryVector = '[embedding vector]';

        console.error(`[DEBUG] Running Query: ${query}`);
        console.error(`[DEBUG] With Neo4j Params: ${JSON.stringify(loggableParams)}`);

        const result = await session.readTransaction((tx: any) => tx.run(query, neo4jParams)); // Add any type
        return result.records.map((record: any) => record.toObject()); // Add any type
    } finally {
        await session.close();
    }
}

// Helper to save results and return message
async function saveResultsToFile(toolName: string, results: any[]): Promise<string> {
    await ensureOutputDir();
    const outputPath = path.join(OUTPUT_DIR, `${toolName}_result.json`);
    const outputData = JSON.stringify(results, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    , 2);
    await fs.writeFile(outputPath, outputData);
    return `Results saved to ${path.relative(process.cwd(), outputPath)}`;
}

// --- Tool Definitions ---

// Define ExecutableTool locally or use 'any'
interface ExecutableTool {
    name: string;
    description: string;
    inputSchema: any; // Use 'any' for simplicity in CJS
    zodSchema?: any; // Use 'any'
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: typeof VectorService) => Promise<any>; // Use typeof VectorService
}


const FindByDomainInputZodSchema = z.object({
    domainName: z.string().describe("The name of the domain to search for (e.g., 'Service Layer', 'Data Access Layer')."),
    nodeKinds: z.array(z.string()).optional().describe("Optional list of node kinds to filter by (e.g., ['Class', 'Function'])."),
    limit: z.number().int().positive().optional().default(25).describe("Maximum number of results (default 25)."),
});
// type FindByDomainArgs = z.infer<typeof FindByDomainInputZodSchema>; // Removed z.infer
const FindByDomainInputJSONSchema = {
    type: "object",
    properties: {
        domainName: { type: 'string', description: "The name of the domain to search for." },
        nodeKinds: { type: 'array', items: { type: 'string' }, description: "Optional list of node kinds to filter by.", optional: true },
        limit: { type: 'number', description: "Maximum number of results.", default: 25 },
    },
    required: ['domainName'],
} as const;

const findCodeByDomainTool: ExecutableTool = {
    name: 'find_code_by_domain',
    description: 'Find all code elements (Files, Classes, Functions, etc.) associated with a specific domain concept.',
    inputSchema: FindByDomainInputJSONSchema,
    zodSchema: FindByDomainInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Use 'any' for args
        let query = `
            MATCH (n)
            WHERE n.domain = $domainName
        `;
        if (args.nodeKinds && args.nodeKinds.length > 0) {
            const labelFilter = args.nodeKinds.map((kind: string) => `:\`${kind}\``).join('|'); // Add type for kind
            query += ` AND (n${labelFilter}) `;
        }
        query += `
            RETURN n.name AS name, labels(n) AS kind, n.filePath AS file, n.domain AS domain
            ORDER BY kind, file, name
            LIMIT $limit
        `;
        const results = await runReadQuery(driver, query, { domainName: args.domainName, limit: args.limit });
        return await saveResultsToFile('find_code_by_domain', results);
    },
};

// ---

const TraceConceptImplementationInputZodSchema = z.object({
    startNodeName: z.string().describe("Name of the starting node (e.g., a function or class name)."),
    startNodeKind: z.string().optional().describe("Optional kind of the starting node (e.g., 'Function', 'Class') for disambiguation."),
    maxDepth: z.number().int().positive().optional().default(3).describe("Maximum relationship depth to traverse (default 3)."),
    relationshipTypes: z.array(z.string()).optional().default(['CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'CONTAINS'])
        .describe("Types of relationships to follow (default: CALLS, USES, EXTENDS, IMPLEMENTS, CONTAINS)."),
});
// type TraceConceptImplementationArgs = z.infer<typeof TraceConceptImplementationInputZodSchema>; // Removed z.infer
const TraceConceptImplementationInputJSONSchema = {
    type: "object",
    properties: {
        startNodeName: { type: 'string', description: "Name of the starting node." },
        startNodeKind: { type: 'string', description: "Optional kind of the starting node.", optional: true },
        maxDepth: { type: 'number', description: "Maximum relationship depth.", default: 3 },
        relationshipTypes: { type: 'array', items: { type: 'string' }, description: "Types of relationships to follow.", default: ['CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'CONTAINS'] },
    },
    required: ['startNodeName'],
} as const;

const traceConceptImplementationTool: ExecutableTool = {
    name: 'trace_concept_implementation',
    description: 'Trace how a concept (starting from a specific node) is implemented by following relevant relationships.',
    inputSchema: TraceConceptImplementationInputJSONSchema,
    zodSchema: TraceConceptImplementationInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Use 'any' for args
        const relTypes = args.relationshipTypes;
        const maxDepth = args.maxDepth;
        const relFilter = relTypes.map((type: string) => `:\`${type}\`|\`CROSS_FILE_${type}\``).join('|'); // Add type for type
        let matchClause = `MATCH (startNode {name: $startNodeName})`;
        if (args.startNodeKind) {
            matchClause = `MATCH (startNode:\`${args.startNodeKind}\` {name: $startNodeName})`;
        }

        const query = `
            ${matchClause}
            CALL apoc.path.subgraphNodes(startNode, {
                relationshipFilter: "${relFilter}",
                maxLevel: $maxDepth
            })
            YIELD node
            RETURN node.name AS name, labels(node) AS kind, node.filePath AS file, node.domain AS domain
            LIMIT 200 // Limit total nodes returned
        `;
        const results = await runReadQuery(driver, query, { startNodeName: args.startNodeName, maxDepth: maxDepth });
        return await saveResultsToFile('trace_concept_implementation', results);
    },
};

// ---

// Updated Schema for find_related_code (Unified Search)
const FindRelatedCodeInputZodSchema = z.object({
    queryText: z.string().describe("Natural language description of the code to find."),
    nodeKinds: z.array(z.string()).optional().describe("Optional list of node kinds to filter results (e.g., ['Class', 'Function'])."),
    domainName: z.string().optional().describe("Optional domain name to filter results."),
    limit: z.number().int().positive().optional().default(10).describe("Maximum number of results (default 10)."),
});

// type FindRelatedCodeArgs = z.infer<typeof FindRelatedCodeInputZodSchema>; // Removed z.infer
const FindRelatedCodeInputJSONSchema = {
    type: "object",
    properties: {
        queryText: { type: 'string', description: "Natural language description of the code to find." },
        nodeKinds: { type: 'array', items: { type: 'string' }, description: "Optional list of node kinds to filter by.", optional: true },
        domainName: { type: 'string', description: "Optional domain name to filter results.", optional: true },
        limit: { type: 'number', description: "Maximum number of results.", default: 10 },
    },
    required: ['queryText'], // Only queryText is strictly required
} as const;

const findRelatedCodeTool: ExecutableTool = {
    name: 'find_related_code',
    description: 'Finds related code fragments using semantic similarity search, with optional filtering by kind and domain.',
    inputSchema: FindRelatedCodeInputJSONSchema,
    zodSchema: FindRelatedCodeInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Use 'any' for args

        const queryVector = await vectorServiceInstance.generateEmbedding(args.queryText);
        if (!queryVector) throw new Error("Failed to generate embedding for queryText.");

        const topK = args.limit; // Zod provides default
        let params: Record<string, any> = { topK: topK, queryVector: queryVector };

        // Base query using vector index - Use the correct index name
        let query = `
            CALL db.index.vector.queryNodes('embeddable_embedding_index', $topK, $queryVector) YIELD node, score
        `;

        // Add WHERE clauses for optional filters
        let whereClauses: string[] = [];
        if (args.domainName) {
            whereClauses.push("node.domain = $domainName");
            params.domainName = args.domainName;
        }
        if (args.nodeKinds && args.nodeKinds.length > 0) {
            // Build label filter like (node:Kind1 OR node:Kind2)
            const kindFilter = args.nodeKinds.map((kind: string) => `node:\`${kind}\``).join(' OR '); // Add type for kind
            whereClauses.push(`(${kindFilter})`);
            // No extra params needed for labels
        }

        if (whereClauses.length > 0) {
            query += `\n WHERE ${whereClauses.join(' AND ')}`;
        }

        // Add RETURN clause
        query += `
            RETURN node.name AS name, labels(node) AS kind, node.filePath AS file, node.domain AS domain, score
            ORDER BY score DESC
        `;
        // Vector index call already implicitly limits to topK, but re-applying after WHERE might be safer/clearer
        query += `\n LIMIT $topK`; // Re-apply limit after WHERE

        const results = await runReadQuery(driver, query, params);
        return await saveResultsToFile('find_related_code', results);
    },
};

// --- NEW TOOL: find_semantically_similar_nodes ---

const FindSimilarNodesInputZodSchema = z.object({
    queryText: z.string().describe("Text to find semantically similar code nodes for."),
    limit: z.number().int().positive().optional().default(10).describe("Maximum number of similar nodes to return (default 10)."),
    // Add optional filters if needed later (e.g., nodeKinds, domainName)
});
// type FindSimilarNodesArgs = z.infer<typeof FindSimilarNodesInputZodSchema>; // Removed z.infer
const FindSimilarNodesInputJSONSchema = {
    type: "object",
    properties: {
        queryText: { type: 'string', description: "Text to find semantically similar code nodes for." },
        limit: { type: 'number', description: "Maximum number of similar nodes to return.", default: 10 },
    },
    required: ['queryText'],
} as const;

const findSimilarNodesTool: ExecutableTool = {
    name: 'find_semantically_similar_nodes',
    description: 'Finds code nodes (functions, classes, etc.) with embeddings semantically similar to the query text.',
    inputSchema: FindSimilarNodesInputJSONSchema,
    zodSchema: FindSimilarNodesInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Use 'any' for args
        const queryVector = await vectorServiceInstance.generateEmbedding(args.queryText);
        if (!queryVector) throw new Error("Failed to generate embedding for queryText.");

        const topK = args.limit; // Zod provides default
        const params = { topK: topK, queryVector: queryVector };

        // Assumes VECTOR_INDEX_NAME is 'embeddable_embedding_index'
        const query = `
            CALL db.index.vector.queryNodes('embeddable_embedding_index', $topK, $queryVector) YIELD node, score
            RETURN node.name AS name, labels(node) AS kind, node.filePath AS file, node.domain AS domain, score
            ORDER BY score DESC
        `;

        const results = await runReadQuery(driver, query, params);
        return await saveResultsToFile('find_semantically_similar_nodes', results);
    },
};


// Use module.exports for CommonJS
module.exports = {
    knowledgeTools: [
        findCodeByDomainTool,
        traceConceptImplementationTool,
        findRelatedCodeTool, // Updated unified search
        findSimilarNodesTool, // Add the new tool
    ]
};