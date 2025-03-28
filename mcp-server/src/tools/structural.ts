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

        // Add 'any' type for tx and record
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

// Define ExecutableTool locally or use 'any' if not importing
interface ExecutableTool {
    name: string;
    description: string;
    inputSchema: any; // Use 'any' for simplicity in CJS
    zodSchema?: any; // Use 'any'
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: any) => Promise<any>;
}


const ListDependenciesInputZodSchema = z.object({
    filePath: z.string().describe("The relative path to the file or directory (e.g., 'src/services/userService.ts' or 'src/controllers')."),
});
// Remove type alias using z.infer
// type ListDependenciesArgs = z.infer<typeof ListDependenciesInputZodSchema>;
const ListDependenciesInputJSONSchema = {
    type: "object",
    properties: {
        filePath: { type: 'string', description: "The relative path to the file or directory (e.g., 'src/services/userService.ts' or 'src/controllers')." },
    },
    required: ['filePath'],
} as const;

const listDependenciesTool: ExecutableTool = {
    name: 'list_module_dependencies',
    description: 'List direct dependencies (imports) for a given file or directory.',
    inputSchema: ListDependenciesInputJSONSchema,
    zodSchema: ListDependenciesInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args type
        const query = `
            MATCH (startNode:File)
            WHERE startNode.filePath = $filePath
            MATCH (startNode)-[r:IMPORTS|CROSS_FILE_IMPORTS]->(dependency:File)
            RETURN dependency.filePath AS importedFile
            ORDER BY importedFile
        `;
        // Ensure uppercase C:/ for path matching
        const absoluteFilePath = args.filePath.startsWith('C:/')
            ? args.filePath
            : `C:/code/amcp/${args.filePath.replace(/^\.\//, '')}`;
        console.error(`[DEBUG] list_module_dependencies - filePath: ${args.filePath}, absoluteFilePath: ${absoluteFilePath}`);
        const results = await runReadQuery(driver, query, { filePath: absoluteFilePath });

        if (results.length > 0) {
            const importedFiles = results.map((record: any) => `- ${record.importedFile}`);
            return `${args.filePath} imports:\n${importedFiles.join('\n')}`;
        } else {
            return `No dependencies found for ${args.filePath}`;
        }
    },
};

// ---

const FindCircularDependenciesInputZodSchema = z.object({
    maxPathLength: z.number().int().positive().optional().default(10).describe("Maximum path length to search for cycles (default 10)."),
});
// Remove type alias using z.infer
// type FindCircularDependenciesArgs = z.infer<typeof FindCircularDependenciesInputZodSchema>;
const FindCircularDependenciesInputJSONSchema = {
    type: "object",
    properties: {
        maxPathLength: { type: 'number', description: "Maximum path length to search for cycles (default 10).", default: 10 },
    },
    required: [],
} as const;

const findCircularDependenciesTool: ExecutableTool = {
    name: 'find_circular_dependencies',
    description: 'Detects circular import dependencies between files in the codebase.',
    inputSchema: FindCircularDependenciesInputJSONSchema,
    zodSchema: FindCircularDependenciesInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args type
        const maxPath = args.maxPathLength; // Zod handles default
        console.error(`[DEBUG] find_circular_dependencies - args.maxPathLength: ${args.maxPathLength}, resolved maxPath: ${maxPath}`);
        const query = `
            MATCH path = (f1:File)-[:IMPORTS|CROSS_FILE_IMPORTS*1..${maxPath}]->(f1)
            RETURN [n IN nodes(path) | n.filePath] AS cycle
            LIMIT 100
        `;
        // Pass maxPath directly, runReadQuery handles neo4j.int()
        const results = await runReadQuery(driver, query, { maxPath: maxPath }); // Pass maxPath here
        await ensureOutputDir();
        const outputPath = path.join(OUTPUT_DIR, 'find_circular_dependencies_result.json');
        const outputData = JSON.stringify(results, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        , 2);

        if (results.length === 0) {
            await fs.writeFile(outputPath, JSON.stringify({ message: "No circular dependencies found." }, null, 2));
            return `No circular dependencies found (up to max path length). Results file updated: ${path.relative(process.cwd(), outputPath)}`;
        }

        await fs.writeFile(outputPath, outputData);
        return `Results saved to ${path.relative(process.cwd(), outputPath)}`;
    },
};

// ---

const GetDependencyTreeInputZodSchema = z.object({
    filePath: z.string().describe("The relative path to the starting file (e.g., 'src/index.ts')."),
    maxDepth: z.number().int().positive().optional().default(3).describe("Maximum depth to traverse (default 3)."),
});
// Remove type alias using z.infer
// type GetDependencyTreeArgs = z.infer<typeof GetDependencyTreeInputZodSchema>;
const GetDependencyTreeInputJSONSchema = {
    type: "object",
    properties: {
        filePath: { type: 'string', description: "The relative path to the starting file (e.g., 'src/index.ts')." },
        maxDepth: { type: 'number', description: "Maximum depth to traverse (default 3).", default: 3 },
    },
    required: ['filePath'],
} as const;

const getDependencyTreeTool: ExecutableTool = {
    name: 'get_dependency_tree',
    description: 'Visualize the dependency tree (imports) starting from a specific file.',
    inputSchema: GetDependencyTreeInputJSONSchema,
    zodSchema: GetDependencyTreeInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args type
        const maxDepth = args.maxDepth; // Zod handles default
        console.error(`[DEBUG] get_dependency_tree - args.maxDepth: ${args.maxDepth}, resolved maxDepth: ${maxDepth}`);
        const query = `
            MATCH path = (startFile:File {filePath: $filePath})-[:IMPORTS|CROSS_FILE_IMPORTS*0..${maxDepth}]->(dep:File)
            WITH nodes(path) AS nodesInPath, relationships(path) AS relsInPath
            UNWIND nodesInPath AS node
            WITH collect(DISTINCT node { .*, labels: labels(node) }) AS nodes, relsInPath
            UNWIND relsInPath AS rel
            WITH nodes, collect(DISTINCT { id: id(rel), type: type(rel), start: startNode(rel).entityId, end: endNode(rel).entityId, properties: properties(rel) }) AS rels
            RETURN nodes, rels
        `;
        // Ensure uppercase C:/ for path matching
        const absoluteFilePath = args.filePath.startsWith('C:/')
            ? args.filePath
            : `C:/code/amcp/${args.filePath.replace(/^\.\//, '')}`;
        // Pass maxDepth directly, runReadQuery handles neo4j.int()
        const results = await runReadQuery(driver, query, { filePath: absoluteFilePath, maxDepth: maxDepth });
        await ensureOutputDir();
        const outputPath = path.join(OUTPUT_DIR, 'get_dependency_tree_result.json');
        const outputData = JSON.stringify(results, (key, value) =>
             typeof value === 'bigint' ? value.toString() : value
        , 2);

        await fs.writeFile(outputPath, outputData);
        return `Results saved to ${path.relative(process.cwd(), outputPath)}`;
    },
};


// Use module.exports for CommonJS
module.exports = {
    structuralTools: [
        listDependenciesTool,
        findCircularDependenciesTool,
        getDependencyTreeTool,
    ]
};