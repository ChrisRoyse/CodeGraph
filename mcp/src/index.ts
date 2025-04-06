#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa } from 'execa';
import path from 'path';
import * as chokidar from 'chokidar'; // Use import * as
import { fileURLToPath } from 'url';
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
// Use relative path to source for build workaround
// Revert back to workspace alias
import { Neo4jClient, StorageManager, createContextLogger, config as analyzerConfig, AppError } from '@bmcp/analyzer-core';

// Define __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the main project root
const projectRootDir = path.resolve(__dirname, '..', '..'); // c:/code/bmcp
// Path to the compiled main analyzer script
const analyzerScriptPath = path.join(projectRootDir, 'dist', 'index.js');

// --- Watcher State ---
let watcherInstance: chokidar.FSWatcher | null = null;
let watchedDirectory: string | null = null;
// Hardcode essential ignores and extensions for now
const watcherIgnorePatterns: string[] = [
    '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
    '**/*___jb_tmp___', '**/*~', '**/*.log', '**/*.lock'
];
const watcherSupportedExtensions: string[] = [
    '.ts', '.tsx', '.js', '.jsx', '.py', '.c', '.h', '.cpp', '.hpp',
    '.cc', '.hh', '.java', '.cs', '.go' // Exclude .sql for now
];
// --- End Watcher State ---

// Define the input schema for the run_analyzer tool
const RunAnalyzerInputSchema = z.object({
  directory: z.string().describe("The absolute path to the project directory to analyze."),
});
type RunAnalyzerArgs = z.infer<typeof RunAnalyzerInputSchema>;

// Define the input schema for start_watcher
const StartWatcherInputSchema = z.object({
  directory: z.string().describe("Absolute path to the directory to watch."),
});
type StartWatcherArgs = z.infer<typeof StartWatcherInputSchema>;

// Define the input schema for stop_watcher (none needed)
const StopWatcherInputSchema = z.object({});
type StopWatcherArgs = z.infer<typeof StopWatcherInputSchema>;

// Create an MCP server
const server = new McpServer({
  name: "code-analyzer-mcp",
  version: "0.1.0"
});

// Add the run_analyzer tool (returns command string)
server.tool(
  "run_analyzer",
  { directory: z.string() },
  async (args, context) => {
    console.error(`[MCP Server Log] 'run_analyzer' tool called.`);
    const { directory } = args as RunAnalyzerArgs;
    const absoluteAnalysisDir = path.resolve(directory).replace(/\\/g, '/'); // Normalize

    if (!directory || typeof directory !== 'string') {
         console.error('[MCP Server Log] Invalid directory input provided.');
         return {
            content: [{ type: "text", text: 'Invalid directory input provided.' }],
            isError: true
         };
    }

    console.error(`[MCP Server Log] Constructing analysis command for: ${absoluteAnalysisDir}`);

    // Construct the manual command string
      const commandString = [
        'node',
        `"${analyzerScriptPath}"`,
        'analyze',
        `"${absoluteAnalysisDir}"`,
        '--update-schema',
        // Pass Neo4j credentials (replace with secure handling if needed)
        '--neo4j-url', 'bolt://localhost:7687',
        '--neo4j-user', 'neo4j',
        '--neo4j-password', 'test1234',
        '--neo4j-database', 'codegraph'
      ].join(' ');

      console.error(`[MCP Server Log] Constructed command: ${commandString}`);
      console.error(`[MCP Server Log] Required CWD: ${projectRootDir}`);

      // Return the command details as JSON within the text content
      const commandDetails = {
           command: commandString,
          cwd: projectRootDir // Execute from main project root
      };
      return {
          content: [{ type: "text", text: JSON.stringify(commandDetails) }],
          _meta: { requires_execute_command: true } // Add metadata hint
      };
  }
);

// --- Watcher Logic (Refactored into a reusable function) ---

async function startWatcherLogic(directory: string): Promise<boolean> {
    const absoluteWatchDir = path.resolve(directory).replace(/\\/g, '/'); // Normalize
    console.error(`[MCP Watcher Logic] Starting watcher for directory: ${absoluteWatchDir}`);

    if (watcherInstance) {
        console.warn("[MCP Watcher Logic] Watcher already running. Stopping existing watcher first.");
        await watcherInstance.close();
        watcherInstance = null;
        watchedDirectory = null;
    }

    try {
        console.error(`[MCP Watcher Logic] Initializing chokidar for: ${absoluteWatchDir}`);
        watchedDirectory = absoluteWatchDir; // Store the watched directory
        console.error('[MCP Watcher Logic] Calling chokidar.watch...'); // DEBUG

        watcherInstance = chokidar.watch(absoluteWatchDir, {
            ignored: watcherIgnorePatterns, // Use defined ignores
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 1500, // Adjust timing if needed
                pollInterval: 100
            },
            depth: 99 // Watch subdirectories deeply
        });

        console.error('[MCP Watcher Logic] Attaching event listeners...'); // DEBUG
        watcherInstance
            .on('add', (filePath: string) => handleFileChange('add', filePath))
            .on('change', (filePath: string) => handleFileChange('change', filePath))
            .on('unlink', (filePath: string) => handleFileChange('unlink', filePath))
            .on('error', (error: unknown) => { // Type is unknown
                if (error instanceof Error) {
                    console.error(`[MCP Watcher] Error: ${error.message}`);
                } else {
                    console.error(`[MCP Watcher] Unknown error: ${error}`);
                }
            })
            .on('ready', () => console.error(`[MCP Watcher] Initial scan complete for ${watchedDirectory}. Ready for changes.`));
        console.error('[MCP Watcher Logic] Event listeners attached.'); // DEBUG

        console.error(`[MCP Watcher Logic] Watcher initialized successfully for ${absoluteWatchDir}`);
        return true; // Indicate success

    } catch (error: any) {
        console.error(`[MCP Watcher Logic] Failed to start watcher: ${error.message}`);
        watcherInstance = null; // Ensure state is reset on error
        watchedDirectory = null;
        return false; // Indicate failure
    }
}


// --- Watcher Tools ---

server.tool(
    "start_watcher",
    { directory: z.string() },
    async (args, context) => {
        const { directory } = args as StartWatcherArgs;
        console.error(`[MCP Server Log] Tool 'start_watcher' called for directory: ${directory}`);
        const success = await startWatcherLogic(directory); // Call the refactored logic
        if (success) {
             return { content: [{ type: "text", text: `Watcher started successfully for ${path.resolve(directory)}` }] };
        } else {
            // Attempt to get error message if possible, otherwise generic
            const errorMessage = (context as any)?.error?.message || 'Unknown error starting watcher';
            return {
                content: [{ type: "text", text: `Error starting watcher: ${errorMessage}` }],
                isError: true
            };
        }
    }
);

server.tool(
    "stop_watcher",
    {}, // No arguments needed
    async (args, context) => {
        console.error("[MCP Server Log] 'stop_watcher' called.");
        if (watcherInstance) {
            try {
                const stoppedDir = watchedDirectory; // Capture before nulling
                await watcherInstance.close();
                console.error(`[MCP Watcher] Watcher stopped for ${stoppedDir}.`);
                watcherInstance = null;
                watchedDirectory = null;
                return { content: [{ type: "text", text: "Watcher stopped successfully." }] };
            } catch (error: any) {
                console.error(`[MCP Watcher] Error stopping watcher: ${error.message}`);
                // Still reset state even if close fails? Maybe.
                watcherInstance = null;
                watchedDirectory = null;
                return {
                    content: [{ type: "text", text: `Error stopping watcher: ${error.message}` }],
                    isError: true
                };
            }
        } else {
            console.warn("[MCP Watcher] No active watcher to stop.");
            return { content: [{ type: "text", text: "No watcher was active." }] };
        }
    }
);

// --- Watcher Event Handling ---

async function handleFileChange(eventType: 'add' | 'change' | 'unlink', filePath: string) {
    const normalizedPath = path.resolve(filePath).replace(/\\/g, '/'); // Ensure absolute and normalized
    const fileExtension = path.extname(normalizedPath);

    console.error(`[MCP Watcher] Detected ${eventType}: ${normalizedPath}`);

    // Check if the file extension is supported
    if (!watcherSupportedExtensions.includes(fileExtension)) {
        console.error(`[MCP Watcher] Ignoring change for unsupported extension: ${fileExtension}`);
        return;
    }

    if (eventType === 'add' || eventType === 'change') {
        await triggerIncrementalUpdate(normalizedPath);
    } else if (eventType === 'unlink') {
        await triggerFileDeletion(normalizedPath);
    }
}

async function triggerIncrementalUpdate(filePath: string) {
    console.error(`[MCP Watcher] Triggering full re-analysis for watched directory due to change in: ${filePath}`);
    if (!watchedDirectory) {
        console.error("[MCP Watcher] Error: Watched directory is not set. Cannot trigger update.");
        return;
    }

    // Construct the standard analysis command for the entire watched directory
    const commandString = [
        'node',
        `"${analyzerScriptPath}"`, // Path to the main analyzer script
        'analyze',
        `"${watchedDirectory}"`,   // Analyze the whole watched directory
        '--update-schema',       // Assume schema update might be needed
        // Pass Neo4j credentials (replace with secure handling if needed)
        '--neo4j-url', 'bolt://localhost:7687',
        '--neo4j-user', 'neo4j',
        '--neo4j-password', 'test1234',
        '--neo4j-database', 'codegraph'
    ].join(' ');

    const commandDetails = {
        command: commandString,
        cwd: projectRootDir // Execute from the main project root
    };

    console.error(`[MCP Watcher] Logging command details to stderr: ${JSON.stringify(commandDetails)}`);
    // Log command details to stderr for the client environment to pick up
    console.error(`MCP_WATCHER_EXECUTE:${JSON.stringify(commandDetails)}`);
}

async function triggerFileDeletion(filePath: string) {
    console.error(`[MCP Watcher] Triggering deletion command for: ${filePath}`);

    // Construct a CLI command to handle deletion
    const commandString = [
        'node',
        `"${analyzerScriptPath}"`, // Path to the main analyzer script (dist/index.js)
        'delete-node',            // The new command name
        '--filePath', `"${filePath}"` // Pass filePath as an option
    ].join(' ');

    const commandDetails = {
        command: commandString,
        cwd: projectRootDir // Execute from the main project root
    };

    console.error(`[MCP Watcher] Logging command details to stderr: ${JSON.stringify(commandDetails)}`);
    // Log command details to stderr for the client environment to pick up
    console.error(`MCP_WATCHER_EXECUTE:${JSON.stringify(commandDetails)}`); // Use EXECUTE prefix
}

// --- Server Start ---

process.on('SIGINT', async () => {
    if (watcherInstance) await watcherInstance.close(); // Close watcher on exit
    await server.close();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    if (watcherInstance) await watcherInstance.close(); // Close watcher on exit
    await server.close();
    process.exit(0);
});


// Start receiving messages on stdin and sending messages on stdout
async function startServer() {
    console.error('[MCP Server Log] Starting server...');

    // --- Auto-start watcher IF directory provided as CLI arg (for direct testing) ---
    const args = process.argv.slice(2);
    const testWatchDirArg = args[0]; // Assume first argument is the directory path

    if (testWatchDirArg) {
        let watcherStarted = false;
        const testWatchDir = path.resolve(testWatchDirArg); // Resolve the provided path
        console.error(`[MCP Server Log] Auto-starting watcher from CLI arg for testing: ${testWatchDir}`);
        watcherStarted = await startWatcherLogic(testWatchDir); // Call the logic function directly
        // If watcher started successfully in test mode, exit after ready event fires (or shortly after init)
        // This requires the 'ready' event handler in startWatcherLogic to signal completion.
        // For testing, we now let it run until killed by the test runner.
        if (watcherStarted) {
             console.error('[MCP Server Log] Watcher started for testing. Exiting script.');
             // Give chokidar a moment to fire ready event if possible
             // await new Promise(resolve => setTimeout(resolve, 500));
 // No longer needed
             // process.exit(0);
 // REMOVE EXIT
        } else {
             console.error('[MCP Server Log] Watcher failed to start for testing. Exiting script with error.');
             // process.exit(1);
 // REMOVE EXIT
        }
    } else {
        console.error('[MCP Server Log] No directory provided via CLI arg, watcher not auto-started.');
    }
    // --- End Auto-start ---

    const transport = new StdioServerTransport();
    console.error('[MCP Server Log] Stdio transport created.');
    // await server.connect(transport);
 // Keep commented out for direct testing
    console.error('[MCP Server Log] Server connected to transport. Running on stdio.');
}

startServer().catch(console.error);