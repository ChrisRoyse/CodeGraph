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

const DetectLayerViolationsInputZodSchema = z.object({
    disallowedPaths: z.array(z.object({ fromDomain: z.string(), toDomain: z.string() }))
        .describe("An array of objects specifying disallowed calls, e.g., [{ fromDomain: 'UI Layer', toDomain: 'Data Access Layer' }]"),
});
// type DetectLayerViolationsArgs = z.infer<typeof DetectLayerViolationsInputZodSchema>; // Removed
const DetectLayerViolationsInputJSONSchema = {
    type: "object",
    properties: {
        disallowedPaths: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    fromDomain: { type: 'string' },
                    toDomain: { type: 'string' },
                },
                required: ['fromDomain', 'toDomain'],
            },
            description: "Array of disallowed domain call paths.",
        },
    },
    required: ['disallowedPaths'],
} as const;

const detectLayerViolationsTool: ExecutableTool = {
    name: 'detect_layer_violations',
    description: 'Detects violations of specified architectural layering constraints based on inferred domains.',
    inputSchema: DetectLayerViolationsInputJSONSchema,
    zodSchema: DetectLayerViolationsInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        const allViolations: any[] = [];
        for (const disallowed of args.disallowedPaths) {
            const query = `
                MATCH (sourceNode)-[:CALLS|USES|CROSS_FILE_CALLS|CROSS_FILE_USES]->(targetNode)
                WHERE sourceNode.domain = $fromDomain AND targetNode.domain = $toDomain
                AND sourceNode.filePath <> targetNode.filePath
                RETURN DISTINCT
                       sourceNode.name AS sourceName,
                       sourceNode.filePath AS sourceFile,
                       sourceNode.domain AS sourceDomain,
                       targetNode.name AS targetName,
                       targetNode.filePath AS targetFile,
                       targetNode.domain AS targetDomain
                LIMIT 50
            `;
            const result = await runReadQuery(driver, query, disallowed);
            if (result.length > 0) {
                allViolations.push({
                    violation: `${disallowed.fromDomain} -> ${disallowed.toDomain}`,
                    examples: result,
                });
            }
        }

        const message = allViolations.length === 0
            ? "No specified layer violations detected."
            : `Detected ${allViolations.length} types of layer violations.`;

        return await saveResultsToFile('detect_layer_violations', allViolations.length > 0 ? allViolations : [{ message }]);
    },
};

// ---

const FindUnauthorizedDependenciesInputZodSchema = z.object({
    sourceDomain: z.string().describe("The domain that should not depend on the target."),
    targetDomain: z.string().describe("The domain that should not be depended upon by the source."),
});
// type FindUnauthorizedDependenciesArgs = z.infer<typeof FindUnauthorizedDependenciesInputZodSchema>; // Removed
const FindUnauthorizedDependenciesInputJSONSchema = {
    type: "object",
    properties: {
        sourceDomain: { type: 'string', description: "Source domain." },
        targetDomain: { type: 'string', description: "Target domain." },
    },
    required: ['sourceDomain', 'targetDomain'],
} as const;

const findUnauthorizedDependenciesTool: ExecutableTool = {
    name: 'find_unauthorized_dependencies',
    description: 'Finds dependencies (imports, calls, uses) from a source domain to a target domain.',
    inputSchema: FindUnauthorizedDependenciesInputJSONSchema,
    zodSchema: FindUnauthorizedDependenciesInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        const query = `
            MATCH (sourceNode)-[r:IMPORTS|CALLS|USES|CROSS_FILE_IMPORTS|CROSS_FILE_CALLS|CROSS_FILE_USES]->(targetNode)
            WHERE sourceNode.domain = $sourceDomain AND targetNode.domain = $targetDomain
              AND sourceNode.filePath <> targetNode.filePath
            RETURN DISTINCT
                   sourceNode.name AS sourceName,
                   sourceNode.filePath AS sourceFile,
                   type(r) as relationshipType,
                   targetNode.name AS targetName,
                   targetNode.filePath AS targetFile
            LIMIT 100
        `;
        const results = await runReadQuery(driver, query, args);
        const message = results.length === 0
           ? `No unauthorized dependencies found from ${args.sourceDomain} to ${args.targetDomain}.`
           : `Found ${results.length} unauthorized dependencies from ${args.sourceDomain} to ${args.targetDomain}.`;

        return await saveResultsToFile('find_unauthorized_dependencies', results.length > 0 ? results : [{ message }]);
    },
};


// Use module.exports for CommonJS
module.exports = {
    architectureTools: [
        detectLayerViolationsTool,
        findUnauthorizedDependenciesTool,
    ]
};