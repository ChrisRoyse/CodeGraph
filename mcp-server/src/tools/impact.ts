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

const FindAffectedByChangeInputZodSchema = z.object({
    nodeName: z.string().describe("Name of the node (Function, Class, Interface, etc.) being changed."),
    nodeKind: z.string().optional().describe("Optional kind of the node for disambiguation."),
    filePath: z.string().optional().describe("Optional file path of the node for disambiguation."),
    maxDepth: z.number().int().positive().optional().default(5).describe("Maximum dependency depth to search (default 5)."),
});
// type FindAffectedByChangeArgs = z.infer<typeof FindAffectedByChangeInputZodSchema>; // Removed
const FindAffectedByChangeInputJSONSchema = {
    type: "object",
    properties: {
        nodeName: { type: 'string', description: "Name of the node being changed." },
        nodeKind: { type: 'string', description: "Optional kind of the node.", optional: true },
        filePath: { type: 'string', description: "Optional file path of the node.", optional: true },
        maxDepth: { type: 'number', description: "Maximum dependency depth.", default: 5 },
    },
    required: ['nodeName'],
} as const;

const findAffectedByChangeTool: ExecutableTool = {
    name: 'find_affected_by_change',
    description: 'Identify all code elements potentially affected by changing a specific component (traces incoming dependencies).',
    inputSchema: FindAffectedByChangeInputJSONSchema,
    zodSchema: FindAffectedByChangeInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        let matchClause = `MATCH (target {name: $nodeName})`;
        if (args.nodeKind) {
            matchClause = `MATCH (target:\`${args.nodeKind}\` {name: $nodeName})`;
        }
        const absoluteFilePath = args.filePath ? (args.filePath.startsWith('c:/') ? args.filePath : `c:/code/amcp/${args.filePath.replace(/^\.\//, '')}`) : null;
        if (absoluteFilePath) {
            matchClause += ` WHERE target.filePath = $filePath`;
        }

        const dependencyRelTypes = [
            'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'IMPORTS',
            'CROSS_FILE_CALLS', 'CROSS_FILE_USES', 'CROSS_FILE_EXTENDS', 'CROSS_FILE_IMPLEMENTS', 'CROSS_FILE_IMPORTS'
        ].map(t => `\`${t}\``).join('|');

        const maxDepth = args.maxDepth; // Zod handles default
        const query = `
            ${matchClause}
            WITH target LIMIT 1
            MATCH path = (dependent)-[r:${dependencyRelTypes}*1..${maxDepth}]->(target)
            WHERE dependent <> target
            WITH DISTINCT dependent
            RETURN dependent.name AS name, labels(dependent) AS kind, dependent.filePath AS file
            ORDER BY kind, file, name
            LIMIT 100
        `;
        const results = await runReadQuery(driver, query, {
            nodeName: args.nodeName,
            nodeKind: args.nodeKind,
            filePath: absoluteFilePath,
            maxDepth: maxDepth
        });
        return await saveResultsToFile('find_affected_by_change', results);
    },
};

// ---

const FindInterfaceRippleEffectInputZodSchema = z.object({
    interfaceName: z.string().describe("Name of the interface being modified."),
    filePath: z.string().optional().describe("Optional file path of the interface for disambiguation."),
    maxDepth: z.number().int().positive().optional().default(3).describe("Maximum dependency depth (default 3)."),
});
// type FindInterfaceRippleEffectArgs = z.infer<typeof FindInterfaceRippleEffectInputZodSchema>; // Removed
const FindInterfaceRippleEffectInputJSONSchema = {
    type: "object",
    properties: {
        interfaceName: { type: 'string', description: "Name of the interface." },
        filePath: { type: 'string', description: "Optional file path.", optional: true },
        maxDepth: { type: 'number', description: "Maximum dependency depth.", default: 3 },
    },
    required: ['interfaceName'],
} as const;

const findInterfaceRippleEffectTool: ExecutableTool = {
    name: 'find_interface_ripple_effect',
    description: 'Finds ripple effects of modifying an interface (implementing classes and their dependents).',
    inputSchema: FindInterfaceRippleEffectInputJSONSchema,
    zodSchema: FindInterfaceRippleEffectInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        let matchClause = `MATCH (iface:Interface {name: $interfaceName})`;
        const absoluteFilePath = args.filePath ? (args.filePath.startsWith('c:/') ? args.filePath : `c:/code/amcp/${args.filePath.replace(/^\.\//, '')}`) : null;
        if (absoluteFilePath) {
            matchClause += ` WHERE iface.filePath = $filePath`;
        }

        const dependencyRelTypes = [
            'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'IMPORTS',
            'CROSS_FILE_CALLS', 'CROSS_FILE_USES', 'CROSS_FILE_EXTENDS', 'CROSS_FILE_IMPLEMENTS', 'CROSS_FILE_IMPORTS'
        ].map(t => `\`${t}\``).join('|');

        const maxDepth = args.maxDepth; // Zod handles default
        const query = `
            ${matchClause}
            WITH iface LIMIT 1
            MATCH (implementer:Class)-[:IMPLEMENTS|CROSS_FILE_IMPLEMENTS]->(iface)
            MATCH path = (dependent)-[r:${dependencyRelTypes}*1..${maxDepth}]->(implementer)
            WHERE dependent <> iface AND dependent <> implementer
            WITH DISTINCT dependent, implementer, iface
            RETURN dependent.name AS dependentName, labels(dependent) AS dependentKind, dependent.filePath AS dependentFile,
                   implementer.name AS implementerName, implementer.filePath AS implementerFile,
                   iface.name AS interfaceName
            ORDER BY dependentKind, dependentFile, dependentName
            LIMIT 100
        `;
        const results = await runReadQuery(driver, query, {
            interfaceName: args.interfaceName,
            filePath: absoluteFilePath,
            maxDepth: maxDepth
        });
        return await saveResultsToFile('find_interface_ripple_effect', results);
    },
};

// ---

const FindDownstreamDependentsInputZodSchema = z.object({
    nodeName: z.string().describe("Name of the function, class, etc."),
    nodeKind: z.string().optional().describe("Optional kind for disambiguation."),
    filePath: z.string().optional().describe("Optional file path for disambiguation."),
    maxDepth: z.number().int().positive().optional().default(3).describe("Maximum dependency depth (default 3)."),
});
// type FindDownstreamDependentsArgs = z.infer<typeof FindDownstreamDependentsInputZodSchema>; // Removed
const FindDownstreamDependentsInputJSONSchema = {
    type: "object",
    properties: {
        nodeName: { type: 'string', description: "Name of the node." },
        nodeKind: { type: 'string', description: "Optional kind.", optional: true },
        filePath: { type: 'string', description: "Optional file path.", optional: true },
        maxDepth: { type: 'number', description: "Maximum dependency depth.", default: 3 },
    },
    required: ['nodeName'],
} as const;

const findDownstreamDependentsTool: ExecutableTool = {
    name: 'find_downstream_dependents',
    description: 'Discover which parts of the system rely on a particular functionality (traces outgoing dependencies).',
    inputSchema: FindDownstreamDependentsInputJSONSchema,
    zodSchema: FindDownstreamDependentsInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        let matchClause = `MATCH (source {name: $nodeName})`;
        if (args.nodeKind) {
            matchClause = `MATCH (source:\`${args.nodeKind}\` {name: $nodeName})`;
        }
        const absoluteFilePath = args.filePath ? (args.filePath.startsWith('c:/') ? args.filePath : `c:/code/amcp/${args.filePath.replace(/^\.\//, '')}`) : null;
        if (absoluteFilePath) {
            matchClause += ` WHERE source.filePath = $filePath`;
        }

        const dependencyRelTypes = [
            'CALLS', 'USES', 'EXTENDS', 'IMPLEMENTS', 'IMPORTS',
            'CROSS_FILE_CALLS', 'CROSS_FILE_USES', 'CROSS_FILE_EXTENDS', 'CROSS_FILE_IMPLEMENTS', 'CROSS_FILE_IMPORTS'
        ].map(t => `\`${t}\``).join('|');

        const maxDepth = args.maxDepth; // Zod handles default
        const query = `
            ${matchClause}
            WITH source LIMIT 1
            MATCH path = (source)-[r:${dependencyRelTypes}*1..${maxDepth}]->(dependent)
            WHERE dependent <> source
            WITH DISTINCT dependent
            RETURN dependent.name AS name, labels(dependent) AS kind, dependent.filePath AS file
            ORDER BY kind, file, name
            LIMIT 100
        `;
        const results = await runReadQuery(driver, query, {
            nodeName: args.nodeName,
            nodeKind: args.nodeKind,
            filePath: absoluteFilePath,
            maxDepth: maxDepth
        });
        return await saveResultsToFile('find_downstream_dependents', results);
    },
};


// Use module.exports for CommonJS
module.exports = {
    impactTools: [
        findAffectedByChangeTool,
        findInterfaceRippleEffectTool,
        findDownstreamDependentsTool,
    ]
};