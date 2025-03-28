// Use require for CommonJS
const neo4j = require('neo4j-driver');
const z = require('zod');
// Cannot use type-only import with require
// import type { ExecutableTool } from '../index.js';
// import type { VectorService } from '../../../src/vector/vector-service.js';
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
        const neo4jParams = Object.entries(params).reduce((acc, [key, value]) => {
            if (['limit', 'threshold', 'maxDepth', 'topK'].includes(key) && Number.isInteger(value)) {
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
        return result.records.map((record: any) => record.toObject());
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
    inputSchema: any;
    zodSchema?: any;
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: any) => Promise<any>;
}

const FindMostConnectedInputZodSchema = z.object({
    nodeKind: z.enum(['Function', 'Method', 'Class', 'Interface', 'File'])
        .describe("The kind of node to analyze (Function, Method, Class, Interface, File)."),
    limit: z.number().int().positive().optional().default(10)
        .describe("Maximum number of results to return (default 10)."),
});
// type FindMostConnectedArgs = z.infer<typeof FindMostConnectedInputZodSchema>; // Removed
const FindMostConnectedInputJSONSchema = {
    type: "object",
    properties: {
        nodeKind: { type: 'string', enum: ['Function', 'Method', 'Class', 'Interface', 'File'], description: "The kind of node to analyze." },
        limit: { type: 'number', description: "Maximum number of results to return.", default: 10 },
    },
    required: ['nodeKind'],
} as const;

const findMostConnectedNodesTool: ExecutableTool = {
    name: 'find_most_connected_nodes',
    description: 'Identifies nodes (Functions, Methods, Classes, etc.) with the highest number of incoming/outgoing relationships (excluding CONTAINS).',
    inputSchema: FindMostConnectedInputJSONSchema,
    zodSchema: FindMostConnectedInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        const query = `
            MATCH (n:\`${args.nodeKind}\`)
            MATCH (n)-[r]-()
            WHERE NOT type(r) IN ['CONTAINS']
            WITH n, count(r) AS degree
            ORDER BY degree DESC
            LIMIT $limit
            RETURN n.name AS name, n.filePath AS file, degree, labels(n) as kind
        `;
        const results = await runReadQuery(driver, query, { limit: args.limit });
        return await saveResultsToFile('find_most_connected_nodes', results);
    },
};

// ---

const FindComplexFilesInputZodSchema = z.object({
    limit: z.number().int().positive().optional().default(10)
        .describe("Maximum number of files to return (default 10)."),
});
// type FindComplexFilesArgs = z.infer<typeof FindComplexFilesInputZodSchema>; // Removed
const FindComplexFilesInputJSONSchema = {
    type: "object",
    properties: {
        limit: { type: 'number', description: "Maximum number of files to return.", default: 10 },
    },
    required: [],
} as const;

const findComplexFilesTool: ExecutableTool = {
    name: 'find_complex_files',
    description: 'Finds files containing nodes with the most complex relationship structures (highest average degree of contained nodes).',
    inputSchema: FindComplexFilesInputJSONSchema,
    zodSchema: FindComplexFilesInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        const query = `
            MATCH (f:File)-[:CONTAINS]->(n)
            WHERE NOT n:Directory AND NOT n:File
            MATCH (n)-[r]-()
            WHERE NOT type(r) IN ['CONTAINS']
            WITH f, n, count(r) AS nodeDegree
            WITH f, avg(nodeDegree) AS avgContainedDegree, count(n) AS nodesInFile
            WHERE nodesInFile > 1
            ORDER BY avgContainedDegree DESC
            LIMIT $limit
            RETURN f.filePath AS file, avgContainedDegree, nodesInFile
        `;
        const results = await runReadQuery(driver, query, { limit: args.limit });
        return await saveResultsToFile('find_complex_files', results);
    },
};

// ---

const FindHighFanInOutInputZodSchema = z.object({
    nodeKind: z.enum(['Class', 'Function', 'Method'])
        .describe("The kind of node to analyze (Class, Function, Method)."),
    threshold: z.number().int().positive().optional().default(10)
        .describe("Minimum combined fan-in/fan-out degree to report (default 10)."),
    limit: z.number().int().positive().optional().default(10)
        .describe("Maximum number of results to return (default 10)."),
});
// type FindHighFanInOutArgs = z.infer<typeof FindHighFanInOutInputZodSchema>; // Removed
const FindHighFanInOutInputJSONSchema = {
    type: "object",
    properties: {
        nodeKind: { type: 'string', enum: ['Class', 'Function', 'Method'], description: "The kind of node to analyze." },
        threshold: { type: 'number', description: "Minimum combined fan-in/fan-out degree.", default: 10 },
        limit: { type: 'number', description: "Maximum number of results.", default: 10 },
    },
    required: ['nodeKind'],
} as const;

const findHighFanInOutNodesTool: ExecutableTool = {
    name: 'find_high_fan_in_out_nodes',
    description: 'Locates classes, functions, or methods with excessive responsibilities (high fan-in/fan-out, excluding CONTAINS).',
    inputSchema: FindHighFanInOutInputJSONSchema,
    zodSchema: FindHighFanInOutInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        const query = `
            MATCH (n:\`${args.nodeKind}\`)
            OPTIONAL MATCH (n)<-[in]-() WHERE NOT type(in) IN ['CONTAINS']
            WITH n, count(DISTINCT in) AS fanIn
            OPTIONAL MATCH (n)-[out]->() WHERE NOT type(out) IN ['CONTAINS']
            WITH n, fanIn, count(DISTINCT out) AS fanOut
            WHERE (fanIn + fanOut) >= $threshold
            ORDER BY (fanIn + fanOut) DESC
            LIMIT $limit
            RETURN n.name AS name, n.filePath AS file, fanIn, fanOut, (fanIn + fanOut) AS totalDegree
        `;
        const results = await runReadQuery(driver, query, { threshold: args.threshold, limit: args.limit });
        return await saveResultsToFile('find_high_fan_in_out_nodes', results);
    },
};


// Use module.exports for CommonJS
module.exports = {
    complexityTools: [
        findMostConnectedNodesTool,
        findComplexFilesTool,
        findHighFanInOutNodesTool,
    ]
};