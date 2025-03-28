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

// Helper function to run potentially complex queries, handling results carefully
async function runArbitraryQuery(driver: typeof neo4j.Driver, query: string, params: Record<string, any> = {}) {
    const session = driver.session({ database: process.env.NEO4J_DATABASE || 'codegraph' });
    try {
        const isWriteQuery = /\b(CREATE|MERGE|SET|DELETE|REMOVE|CALL)\b/i.test(query);
        const transactionFunction = isWriteQuery
            ? session.writeTransaction.bind(session)
            : session.readTransaction.bind(session);

        const result = await transactionFunction((tx: any) => tx.run(query, params)); // Add any type

        const data = result.records.map((record: any) => { // Add any type
            const obj: Record<string, any> = {};
            record.keys.forEach((key: string) => { // Add string type
                if (typeof key === 'string') {
                    obj[key] = record.get(key);
                }
            });
            return obj;
        });

        return JSON.parse(JSON.stringify(data, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));

    } catch (error: any) {
        console.error("Cypher query failed:", error);
        throw new Error(`Cypher query failed: ${error.message} (Code: ${error.code})`);
    } finally {
        await session.close();
    }
}

// Helper to save results and return message (specific for run_cypher_query)
async function saveCypherResultsToFile(query: string, params: Record<string, any>, results: any[]): Promise<string> {
    await ensureOutputDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `run_cypher_query_${timestamp}_result.json`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    const outputData = {
        query: query,
        params: params,
        results: results
    };
    await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
    return `Results saved to ${path.relative(process.cwd(), outputPath)}`;
}


// --- Tool Definition ---

// Define ExecutableTool locally or use 'any'
interface ExecutableTool {
    name: string;
    description: string;
    inputSchema: any;
    zodSchema?: any;
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: any) => Promise<any>;
}

// run_cypher_query tool removed

// Use module.exports for CommonJS
module.exports = {
    mcpTools: [] // Empty array as the tool is removed
};