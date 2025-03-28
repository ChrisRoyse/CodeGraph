#!/usr/bin/env node
// Use require for CommonJS modules
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    // type Tool, // Cannot use type-only import with require
} = require('@modelcontextprotocol/sdk/types.js');
const neo4j = require('neo4j-driver');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs/promises'); // Import fs for reading result files
const { fileURLToPath } = require('url'); // Keep this for __dirname equivalent
const z = require('zod'); // Correctly require zod
// Import the VectorService CLASS using require - Adjust path for compiled output
const { VectorService } = require('../../dist/vector/vector-service.js'); // Corrected path

// Import tool definitions using require
const { structuralTools } = require('./tools/structural.js');
const { complexityTools } = require('./tools/complexity.js');
const { architectureTools } = require('./tools/architecture.js');
const { knowledgeTools } = require('./tools/knowledge.js');
const { impactTools } = require('./tools/impact.js');
// const { mcpTools } = require('./tools/mcp.js'); // Removed mcpTools import
const { adminTools } = require('./tools/admin.js');
const { overviewTools } = require('./tools/overview.js');
const { contextTools } = require('./tools/context.js'); // Added contextTools import

// --- Configuration & Setup ---

// Load .env file from the parent directory (project root)
// const __filename = fileURLToPath(import.meta.url); // Not available in CJS
// const __dirname = path.dirname(__filename); // Use __dirname directly in CJS
const projectRootDir = path.resolve(__dirname, '../../');
dotenv.config({ path: path.join(projectRootDir, '.env') });

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'test1234';
const NEO4J_DATABASE = process.env.NEO4J_DATABASE || 'codegraph';

// Basic console logger for the server itself
const logger = {
    info: (message: string, meta?: any) => console.error(`[INFO] ${message}`, meta ? JSON.stringify(meta) : ''),
    warn: (message: string, meta?: any) => console.error(`[WARN] ${message}`, meta ? JSON.stringify(meta) : ''),
    error: (message: string, meta?: any) => console.error(`[ERROR] ${message}`, meta ? JSON.stringify(meta) : ''),
    debug: (message: string, meta?: any) => console.error(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : ''),
};

// --- Neo4j Client ---
let driver: typeof neo4j.Driver | null = null; // Use typeof for driver type

function getDriver(): typeof neo4j.Driver {
    if (!driver) {
        try {
            driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD));
            logger.info(`Neo4j driver created for ${NEO4J_URI}, db: ${NEO4J_DATABASE}`);
            driver.verifyConnectivity({ database: NEO4J_DATABASE })
                .then(() => logger.info('Neo4j connection verified.'))
                .catch((error: any) => logger.error('Neo4j connectivity verification failed:', { error: error.message })); // Add type any
        } catch (error: any) {
            logger.error('Failed to create Neo4j driver:', { error: error.message });
            throw new Error('Could not create Neo4j driver.');
        }
    }
    return driver;
}

async function closeDriver(): Promise<void> {
    if (driver) {
        logger.info('Closing Neo4j driver...');
        await driver.close();
        driver = null;
        logger.info('Neo4j driver closed.');
    }
}

// --- Tool Definition with Execute Function ---
// Re-declare Tool type locally if needed, or use 'any'
type Tool = import('@modelcontextprotocol/sdk/types.js').Tool;

// Use module.exports for the interface if it needs to be shared (or keep internal)
export interface ExecutableTool extends Tool {
    // Use 'any' for zodSchema type annotation in CJS context
    zodSchema?: any;
    // Use typeof VectorService for the instance type
    execute: (driver: typeof neo4j.Driver, args: any, vectorServiceInstance: typeof VectorService) => Promise<any>;
}

// --- Tool Implementations ---
const allTools: ExecutableTool[] = [
    ...structuralTools,
    ...complexityTools,
    ...architectureTools,
    ...knowledgeTools,
    ...impactTools,
    // ...mcpTools, // Removed mcpTools
    ...adminTools,
    ...overviewTools, // Re-enabled
    ...contextTools, // Added contextTools
];

// --- MCP Server Class ---

class CodebaseGraphServer {
    private server: typeof Server; // Use typeof for SDK class types
    private tools: Map<string, ExecutableTool> = new Map();
    private vectorServiceInstance: typeof VectorService; // Use typeof for instance type

    constructor() {
        this.vectorServiceInstance = new VectorService();
        this.server = new Server(
            {
                name: 'codebase-graph-server',
                version: '0.1.3', // Incremented version
            },
            {
                capabilities: {
                    resources: {},
                    tools: {},
                },
            }
        );

        this.registerTools();
        this.setupToolHandlers();

        // Error handling
        this.server.onerror = (error: any) => logger.error('[MCP Error]', error); // Add type any
        process.on('SIGINT', async () => {
            await this.server.close();
            await closeDriver();
            process.exit(0);
        });
         process.on('SIGTERM', async () => {
            await this.server.close();
            await closeDriver();
            process.exit(0);
        });
    }

    private registerTools() {
        allTools.forEach(tool => {
            if (this.tools.has(tool.name)) {
                 logger.warn(`Duplicate tool name detected: ${tool.name}. Overwriting.`);
            }
            this.tools.set(tool.name, tool);
            logger.info(`Registered tool: ${tool.name}`);
        });
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: Array.from(this.tools.values()).map(({ zodSchema, execute, ...rest }) => rest),
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => { // Add type any
            const toolName = request.params.name;
            const tool = this.tools.get(toolName);
            const args = request.params.arguments || {};
            let validatedArgs = args;
            let finalResult: any; // Variable to hold the final result

            logger.debug(`[HANDLER] Received call for tool: ${toolName}`);
            logger.debug(`[HANDLER] Raw args: ${JSON.stringify(args)}`);

            if (!tool) {
                logger.error(`[HANDLER] Tool not found: ${toolName}`);
                throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
            }

            if (tool.zodSchema) {
                logger.debug(`[HANDLER] Found Zod schema for ${toolName}. Parsing args...`);
                try {
                    validatedArgs = tool.zodSchema.parse(args);
                    logger.debug(`[HANDLER] Parsed/validated args for ${toolName}: ${JSON.stringify(validatedArgs)}`);
                } catch (error) {
                    // Use type guard with the imported 'z' object
                    if (error instanceof z.ZodError) {
                        // Rely on runtime check; 'error' has ZodError properties here
                        logger.error(`[HANDLER] Zod validation failed for ${toolName}: ${JSON.stringify((error as any).errors)}`);
                        throw new McpError(
                            ErrorCode.InvalidParams,
                            // Add type any to map parameter
                            `Invalid parameters for tool ${toolName}: ${(error as any).errors.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
                        );
                    }
                    // Handle other potential errors
                    const unknownError = error as any;
                    logger.error(`[HANDLER] Unexpected validation error for tool ${toolName}:`, { error: unknownError?.message });
                    throw new McpError(ErrorCode.InternalError, `Internal validation error for tool ${toolName}.`);
                }
            } else {
                 logger.warn(`[HANDLER] No Zod schema found for tool ${toolName}, skipping validation and default application.`);
            }

            logger.info(`[HANDLER] Executing tool: ${toolName}`, { validatedArgs });

            try {
                const toolExecuteResult = await tool.execute(getDriver(), validatedArgs, this.vectorServiceInstance);
                logger.debug(`[HANDLER] Tool ${toolName} raw execution result: ${typeof toolExecuteResult === 'string' ? toolExecuteResult.substring(0, 100) + '...' : '[Object]'}`);

                // Check if the result is a "Results saved to..." message
                if (typeof toolExecuteResult === 'string' && toolExecuteResult.startsWith('Results saved to ')) {
                    const relativePath = toolExecuteResult.substring('Results saved to '.length);
                    // Construct absolute path relative to the CWD of the server process (mcp-server)
                    const absolutePath = path.resolve(process.cwd(), relativePath);
                    logger.info(`[HANDLER] Tool result indicates file saved. Reading content from: ${absolutePath}`);
                    try {
                        const fileContent = await fs.readFile(absolutePath, 'utf-8');
                        finalResult = JSON.parse(fileContent); // Parse the JSON content
                        logger.debug(`[HANDLER] Successfully read and parsed content from ${relativePath}`);
                    } catch (readError: any) {
                        logger.error(`[HANDLER] Failed to read or parse result file ${absolutePath}: ${readError.message}`);
                        // Fallback to returning the original message if file read fails
                        finalResult = toolExecuteResult;
                    }
                } else {
                    // If not a "saved to" message, use the result directly
                    finalResult = toolExecuteResult;
                }

                // Ensure final result is always stringified for the text content part
                const resultText = typeof finalResult === 'string' ? finalResult : JSON.stringify(finalResult, null, 2);
                logger.debug(`[HANDLER] Tool ${toolName} final processing successful. Returning type: ${typeof finalResult}`);

                return {
                    content: [{ type: 'text', text: resultText }],
                };
            } catch (error: any) {
                 logger.error(`[HANDLER] Error executing tool ${toolName}:`, { error: error.message, stack: error.stack });
                 const errorMessage = error instanceof Error ? error.message : String(error);
                 return {
                     content: [{ type: 'text', text: `Error executing tool ${toolName}: ${errorMessage}` }],
                     isError: true,
                 };
            }
        });
    }

    async run() {
        getDriver();
        try {
            await this.vectorServiceInstance.ensureEmbedderReady();
        } catch (error) {
             logger.error('Failed to initialize vector service embedder on startup. Semantic search tools may fail.', error);
        }
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        logger.info('Codebase Graph MCP server running on stdio');
    }
}

// --- Run Server ---
const server = new CodebaseGraphServer();
server.run().catch(error => {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
});

// Export nothing explicitly for CommonJS entry point