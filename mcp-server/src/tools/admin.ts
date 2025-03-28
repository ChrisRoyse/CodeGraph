// Use require for CommonJS
const neo4j = require('neo4j-driver');
const z = require('zod');
// Cannot use type-only import with require
// import type { ExecutableTool } from '../index.js';
// import type { VectorService } from '../../../src/vector/vector-service.js';

// Helper function to run write queries (if needed, otherwise remove)
// async function runWriteQuery(driver: typeof neo4j.Driver, query: string, params: Record<string, any> = {}) { ... }

// --- Tool Definitions ---

// Define ExecutableTool locally or use 'any'
interface ExecutableTool {
    name: string;
    description: string;
    inputSchema: any;
    zodSchema?: any;
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: any) => Promise<any>;
}

// --- New Reanalyze Tool (Renamed) ---
const AnalyzeCodebaseInputZodSchema = z.object({}); // No input parameters
const AnalyzeCodebaseInputJSONSchema = {
    type: "object",
    properties: {},
    required: [],
} as const;

const analyzeCodebaseTool: ExecutableTool = { // Renamed constant
    name: 'analyzecodebase', // Renamed tool name
    description: 'Provides the command to run in the terminal to perform a full codebase re-analysis, resetting the database and updating the schema.',
    inputSchema: AnalyzeCodebaseInputJSONSchema,
    zodSchema: AnalyzeCodebaseInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => {
        const commandToRun = 'cd c:/code/amcp && npm start analyze c:/code/amcp -- --reset-db --update-schema';
        const message = `To perform a full re-analysis (resetting DB and updating schema), please run the following command in your terminal:\n\n\`\`\`bash\n${commandToRun}\n\`\`\`\n\nThis process will take some time.`;
        // Return simple object with the command and explanation
        return {
            message: message,
            command: commandToRun
        };
    },
};


// Ping Tool
const PingInputZodSchema = z.object({});
// type PingArgs = z.infer<typeof PingInputZodSchema>; // Removed
const PingInputJSONSchema = {
    type: "object",
    properties: {},
    required: [],
} as const;

const pingTool: ExecutableTool = {
    name: 'ping_server',
    description: 'A simple tool to check if the MCP server is running and responsive.',
    inputSchema: PingInputJSONSchema,
    zodSchema: PingInputZodSchema,
    execute: async (driver, args) => { // Use 'any' for args, remove unused vectorServiceInstance
        // Return simple object, no need to save file
        return { status: "pong", timestamp: new Date().toISOString() };
    },
};


// Use module.exports for CommonJS
module.exports = {
    adminTools: [
        analyzeCodebaseTool, // Export renamed tool
        pingTool,
    ]
};