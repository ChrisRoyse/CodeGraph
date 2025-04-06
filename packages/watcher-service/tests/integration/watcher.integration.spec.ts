import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { Neo4jClient } from '@bmcp/analyzer-core/database/neo4j-client';
import { StorageManager } from '@bmcp/analyzer-core/analyzer/storage-manager';
import { Neo4jContainer, StartedNeo4jContainer } from "@testcontainers/neo4j";

const execPromise = promisify(exec);

const TEST_PROJECT_DIR = path.resolve(__dirname, '../../../../test_fixtures/integration_test_project_1');
const ANALYZER_CACHE_DIR = path.join(TEST_PROJECT_DIR, '.analyzer_cache');
const ENTITY_ID_FILE = path.join(ANALYZER_CACHE_DIR, 'entity_ids.json');

// Variables to hold dynamic container details
let NEO4J_URI: string;
let NEO4J_USER = 'neo4j'; // Default user for the container
let NEO4J_PASSWORD = ''; // Will be set by the container
const NEO4J_DATABASE = 'neo4j'; // Use the default container database

// Helper function to run CLI commands
async function runCliCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    // Assuming the CLI entry point is dist/index.js relative to project root
    const projectRoot = path.resolve(__dirname, '../../../../');
    const fullCommand = `node ${path.join(projectRoot, 'dist/index.js')} ${command}`;
    console.log(`Executing: ${fullCommand}`); // For debugging
    try {
        return await execPromise(fullCommand, { cwd: projectRoot });
    } catch (error: any) {
        console.error(`Error executing command: ${fullCommand}`);
        console.error(`Stderr: ${error.stderr}`);
        console.error(`Stdout: ${error.stdout}`);
        throw error; // Re-throw after logging
    }
}

// Helper function for delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to query Neo4j
async function queryNeo4j(client: Neo4jClient, query: string, params?: Record<string, any>): Promise<any[]> {
    // Use the database configured for the client instance used in tests
    const session = await client.getSession('READ', 'TestQueryHelper'); // Use getSession which respects client's config
    try {
        const result = await session.run(query, params);
        return result.records.map(record => record.toObject());
    } finally {
        await session.close();
    }
}

describe('Watcher Service Integration Tests', () => {
    let neo4jClient: Neo4jClient;
    let storageManager: StorageManager; // For reading cache if needed directly
    let container: StartedNeo4jContainer | null = null;
    let watcherProcess: ChildProcess | null = null;

    beforeAll(async () => {
        console.log('Starting Neo4j container...');
        try {
            // Start the Neo4j container
            const startedContainer = await new Neo4jContainer()
                // .withEnterpriseEdition() // Use if Enterprise features are needed
                .withReuse() // Reuse container if possible for faster local runs
                .start();

            container = startedContainer; // Assign only after successful start
            NEO4J_URI = startedContainer.getBoltUri();
            NEO4J_PASSWORD = startedContainer.getPassword(); // Get the generated password
            console.log(`Neo4j container started. URI: ${NEO4J_URI}, DB: ${NEO4J_DATABASE}`);

            // Instantiate the client *after* getting container details
    
        console.log(`Connecting to Neo4j at ${NEO4J_URI}`);
            neo4jClient = new Neo4jClient({
                uri: NEO4J_URI,
                username: NEO4J_USER,
                password: NEO4J_PASSWORD,
                database: NEO4J_DATABASE // Explicitly set database for tests
            });
            console.log('Neo4jClient created. Connection will be established on first use.');

        } catch (err) {
            console.error("Failed to start Neo4j container:", err);
            throw err; // Fail fast if container doesn't start
        }

        storageManager = new StorageManager(ANALYZER_CACHE_DIR); // Point to test project cache
    }, 60000); // Increase timeout for container startup

    afterAll(async () => {
        await neo4jClient.closeDriver(); // Correct method name
        console.log('Neo4j connection closed.');
        if (container) {
            console.log('Stopping Neo4j container...');
            await container.stop();
            console.log('Neo4j container stopped.');
        }
    });

    beforeEach(async () => {
        // Clean up before each test
        await fs.remove(ANALYZER_CACHE_DIR); // Remove cache
        // Clear Neo4j database
        console.log('Clearing Neo4j database...');
        try {
            await neo4jClient.runTransaction('MATCH (n) DETACH DELETE n', {}, 'WRITE', 'TestCleanup');
        } catch (error) {
            console.error("Failed to clear Neo4j database:", error);
            // Optionally re-throw or handle if cleanup failure should fail the test setup
            throw error;
        }
        console.log('Neo4j database cleared.');
        // Ensure test project exists (it should, but good practice)
        await fs.ensureDir(TEST_PROJECT_DIR);
        // Recreate initial files if they were deleted in previous tests
        // Default content for most tests, including cross-lang setup
        await fs.writeFile(path.join(TEST_PROJECT_DIR, 'main.py'), `from utils import add # Initial import for cross-lang test setup\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\nif __name__ == "__main__":\n    result = add(1, 2)\n    greet("World")\n    print(f"Result from TS: {result}")`);
        await fs.writeFile(path.join(TEST_PROJECT_DIR, 'utils.ts'), `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n    return a * b;\n}`);
    });

    afterEach(async () => {
        // Optional: Add cleanup specific to after each test if needed
        // Stop any running watcher process if started within a test
        if (watcherProcess && !watcherProcess.killed) {
            console.log('Killing watcher process...');
            const killed = watcherProcess.kill('SIGTERM'); // Send SIGTERM
            if (!killed) {
                console.warn('Failed to kill watcher process with SIGTERM, trying SIGKILL.');
                watcherProcess.kill('SIGKILL'); // Force kill if SIGTERM failed
            }
            watcherProcess = null;
            await delay(500); // Give time for the process to exit
            console.log('Watcher process should be stopped.');
        }
    });

    // --- Test Cases ---

    it('Initial Analysis: should create cache file and populate Neo4j', async () => {
        // 1. Run analyze command
        const analyzeCommand = `analyze ${TEST_PROJECT_DIR}`;
        const { stdout, stderr } = await runCliCommand(analyzeCommand);
        console.log('Analyze stdout:', stdout);
        if (stderr) {
            console.error('Analyze stderr:', stderr);
            // Optionally fail the test if stderr is not expected
            // expect(stderr).toBe('');
        }

        // 2. Verify entity_ids.json exists and has basic structure
        const cacheExists = await fs.pathExists(ENTITY_ID_FILE);
        expect(cacheExists, `${ENTITY_ID_FILE} should exist after analysis`).toBe(true);

        const cacheContent = await fs.readJson(ENTITY_ID_FILE);
        expect(cacheContent, 'Cache content should be an object').toBeTypeOf('object');
        // Use relative paths as keys in the cache
        const relativeMainPy = path.relative(TEST_PROJECT_DIR, path.join(TEST_PROJECT_DIR, 'main.py'));
        const relativeUtilsTs = path.relative(TEST_PROJECT_DIR, path.join(TEST_PROJECT_DIR, 'utils.ts'));
        expect(cacheContent[relativeMainPy], `Cache should contain key for ${relativeMainPy}`).toBeDefined();
        expect(cacheContent[relativeUtilsTs], `Cache should contain key for ${relativeUtilsTs}`).toBeDefined();
        expect(Array.isArray(cacheContent[relativeMainPy]), `${relativeMainPy} cache entry should be an array`).toBe(true);
        expect(Array.isArray(cacheContent[relativeUtilsTs]), `${relativeUtilsTs} cache entry should be an array`).toBe(true);
        expect(cacheContent[relativeMainPy].length, `${relativeMainPy} should have associated entity IDs`).toBeGreaterThan(0);
        expect(cacheContent[relativeUtilsTs].length, `${relativeUtilsTs} should have associated entity IDs`).toBeGreaterThan(0);

        // 3. Query Neo4j for expected nodes (basic check)
        const fileNodes = await queryNeo4j(neo4jClient, 'MATCH (f:File) WHERE f.path ENDS WITH $py OR f.path ENDS WITH $ts RETURN f.path as path', { py: 'main.py', ts: 'utils.ts' });
        expect(fileNodes.length, 'Should find File nodes for both test files').toBe(2);
        expect(fileNodes.some(n => n.path.endsWith('main.py'))).toBe(true);
        expect(fileNodes.some(n => n.path.endsWith('utils.ts'))).toBe(true);

        const pyFunctionNodes = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.name', { name: 'greet', path: 'main.py' });
        expect(pyFunctionNodes.length, 'Should find the greet Function node in main.py').toBe(1);

        const tsFunctionNodes = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.name', { name: 'add', path: 'utils.ts' });
        expect(tsFunctionNodes.length, 'Should find the add Function node in utils.ts').toBe(1);

        // Add more specific checks for relationships if needed
    });

    it('File Modification: should update cache and Neo4j', async () => {
        // 1. Run initial analyze
        await runCliCommand(`analyze ${TEST_PROJECT_DIR}`);
        const initialCache = await fs.readJson(ENTITY_ID_FILE);
        const relativeMainPy = path.relative(TEST_PROJECT_DIR, path.join(TEST_PROJECT_DIR, 'main.py'));
        const initialPyEntityIds = initialCache[relativeMainPy];
        expect(initialPyEntityIds.length).toBeGreaterThan(0);

        // Verify initial state in Neo4j (e.g., 'greet' function exists)
        let pyFunctionNodes = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.id as id', { name: 'greet', path: 'main.py' });
        expect(pyFunctionNodes.length, "Initial 'greet' function should exist").toBe(1);
        const initialGreetId = pyFunctionNodes[0].id;

        // 2. Start watch command
        const projectRoot = path.resolve(__dirname, '../../../../');
        const cliPath = path.join(projectRoot, 'dist/index.js');
        watcherProcess = spawn('node', [cliPath, 'watch', TEST_PROJECT_DIR], { cwd: projectRoot, detached: false }); // Run watcher

        watcherProcess.stdout?.on('data', (data) => console.log(`Watcher stdout: ${data}`));
        watcherProcess.stderr?.on('data', (data) => console.error(`Watcher stderr: ${data}`));
        watcherProcess.on('error', (err) => console.error('Watcher error:', err));
        watcherProcess.on('close', (code) => console.log(`Watcher exited with code ${code}`));

        await delay(3000); // Wait for watcher to potentially initialize

        // 3. Modify a file (main.py: rename greet to farewell)
        const modifiedPyContent = `from utils import add\n\ndef farewell(name):\n    print(f"Goodbye, {name}!")\n\nif __name__ == "__main__":\n    farewell("World")`;
        const mainPyPath = path.join(TEST_PROJECT_DIR, 'main.py'); // Corrected path
        await fs.writeFile(mainPyPath, modifiedPyContent);
        console.log(`Modified ${mainPyPath}`);

        // 4. Wait for watcher to process
        await delay(5000); // Adjust delay as needed based on watcher performance

        // 5. Verify entity_ids.json is updated
        const updatedCache = await fs.readJson(ENTITY_ID_FILE);
        const updatedPyEntityIds = updatedCache[relativeMainPy];
        expect(updatedPyEntityIds, 'Python file entry should still exist in cache').toBeDefined();
        expect(updatedPyEntityIds).not.toEqual(initialPyEntityIds); // IDs should change
        // Check if any of the old IDs persist for this file (they shouldn't)
        const oldIdsPersist = initialPyEntityIds.some((id: string) => updatedPyEntityIds.includes(id));
        expect(oldIdsPersist, 'Old entity IDs for the modified file should be removed from its cache entry').toBe(false);

        // 6. Query Neo4j to verify old entities removed, new ones added
        // Check old 'greet' function is gone (by ID)
        const oldGreetNode = await queryNeo4j(neo4jClient, 'MATCH (n) WHERE n.id = $id RETURN n', { id: initialGreetId });
        expect(oldGreetNode.length, "Old 'greet' function node should be deleted").toBe(0);

        // Check new 'farewell' function exists
        pyFunctionNodes = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.name', { name: 'farewell', path: 'main.py' });
        expect(pyFunctionNodes.length, "New 'farewell' function should exist").toBe(1);

        // 7. Stop watcher process (handled in afterEach)
    });

    it('File Addition: should update cache and Neo4j', async () => {
        // 1. Run initial analyze
        await runCliCommand(`analyze ${TEST_PROJECT_DIR}`);

        // 2. Start watch command
        const projectRoot = path.resolve(__dirname, '../../../../');
        const cliPath = path.join(projectRoot, 'dist/index.js');
        watcherProcess = spawn('node', [cliPath, 'watch', TEST_PROJECT_DIR], { cwd: projectRoot, detached: false });
        watcherProcess.stdout?.on('data', (data) => console.log(`Watcher stdout: ${data}`));
        watcherProcess.stderr?.on('data', (data) => console.error(`Watcher stderr: ${data}`));
        await delay(3000); // Wait for watcher init

        // 3. Add a new file (e.g., helper.py)
        const newFilePath = path.join(TEST_PROJECT_DIR, 'helper.py');
        const newFileContent = `def helper_function():\n    print("Helping out!")`;
        await fs.writeFile(newFilePath, newFileContent);
        console.log(`Created ${newFilePath}`);

        // 4. Wait for watcher
        await delay(5000); // Adjust delay

        // 5. Verify entity_ids.json includes new file
        const updatedCache = await fs.readJson(ENTITY_ID_FILE);
        const relativeNewFilePath = path.relative(TEST_PROJECT_DIR, newFilePath);
        expect(updatedCache[relativeNewFilePath], `Cache should contain key for ${relativeNewFilePath}`).toBeDefined();
        expect(Array.isArray(updatedCache[relativeNewFilePath]), `${relativeNewFilePath} cache entry should be an array`).toBe(true);
        expect(updatedCache[relativeNewFilePath].length, `${relativeNewFilePath} should have associated entity IDs`).toBeGreaterThan(0);

        // 6. Query Neo4j for new entities/relationships
        // Check File node exists
        const fileNode = await queryNeo4j(neo4jClient, 'MATCH (f:File) WHERE f.path ENDS WITH $path RETURN f.path', { path: 'helper.py' });
        expect(fileNode.length, 'Should find File node for helper.py').toBe(1);

        // Check Function node exists
        const functionNode = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.name', { name: 'helper_function', path: 'helper.py' });
        expect(functionNode.length, 'Should find helper_function node in helper.py').toBe(1);

        // 7. Stop watcher
        // (handled in afterEach)
    });

    it('File Deletion: should update cache and Neo4j', async () => {
        // 1. Run initial analyze
        await runCliCommand(`analyze ${TEST_PROJECT_DIR}`);
        const initialCache = await fs.readJson(ENTITY_ID_FILE);
        const relativeUtilsTs = path.relative(TEST_PROJECT_DIR, path.join(TEST_PROJECT_DIR, 'utils.ts'));
        const initialTsEntityIds = initialCache[relativeUtilsTs];
        expect(initialTsEntityIds.length).toBeGreaterThan(0);

        // Verify initial state in Neo4j (e.g., 'add' function exists)
        let tsFunctionNodes = await queryNeo4j(neo4jClient, 'MATCH (fn:Function {name: $name})<-[:CONTAINS]-(f:File) WHERE f.path ENDS WITH $path RETURN fn.id as id', { name: 'add', path: 'utils.ts' });
        expect(tsFunctionNodes.length, "Initial 'add' function should exist").toBe(1);
        const initialAddId = tsFunctionNodes[0].id;

        // 2. Start watch command
        const projectRoot = path.resolve(__dirname, '../../../../');
        const cliPath = path.join(projectRoot, 'dist/index.js');
        watcherProcess = spawn('node', [cliPath, 'watch', TEST_PROJECT_DIR], { cwd: projectRoot, detached: false });
        watcherProcess.stdout?.on('data', (data) => console.log(`Watcher stdout: ${data}`));
        watcherProcess.stderr?.on('data', (data) => console.error(`Watcher stderr: ${data}`));
        await delay(3000); // Wait for watcher init

        // 3. Delete a file (e.g., utils.ts)
        const utilsTsPath = path.join(TEST_PROJECT_DIR, 'utils.ts');
        await fs.remove(utilsTsPath);
        console.log(`Deleted ${utilsTsPath}`);

        // 4. Wait for watcher
        await delay(5000); // Adjust delay

        // 5. Verify file entry removed from entity_ids.json
        const updatedCache = await fs.readJson(ENTITY_ID_FILE);
        expect(updatedCache[relativeUtilsTs], `Cache should no longer contain key for ${relativeUtilsTs}`).toBeUndefined();

        // 6. Query Neo4j to verify entities/relationships removed
        // Check File node is gone
        const fileNode = await queryNeo4j(neo4jClient, 'MATCH (f:File) WHERE f.path ENDS WITH $path RETURN f.path', { path: 'utils.ts' });
        expect(fileNode.length, 'File node for utils.ts should be deleted').toBe(0);

        // Check associated Function node ('add') is gone (by ID)
        const oldAddNode = await queryNeo4j(neo4jClient, 'MATCH (n) WHERE n.id = $id RETURN n', { id: initialAddId });
        expect(oldAddNode.length, "Old 'add' function node should be deleted").toBe(0);

        // 7. Stop watcher
        // (handled in afterEach)
    });

    it('Cross-Language: should update relationships across files', async () => {
        // 1. Setup: Modify main.py to import and use add from utils.ts (Done in beforeEach)

        // 2. Run initial analyze
        await runCliCommand(`analyze ${TEST_PROJECT_DIR}`);

        // 3. Verify initial relationship in Neo4j (e.g., CALLS from main.py scope to utils.ts#add)
        const initialCallRels = await queryNeo4j(neo4jClient, `
            MATCH (pyFile:File)-[:CONTAINS]->(pyScope)-[r:CALLS]->(tsFunc:Function)-[:CONTAINS]-(tsFile:File)
            WHERE pyFile.path ENDS WITH 'main.py' AND tsFile.path ENDS WITH 'utils.ts' AND tsFunc.name = 'add'
            RETURN r
        `);
        expect(initialCallRels.length, "Initial CALLS relationship should exist from main.py to utils.ts#add").toBe(1);

        // 4. Start watch command
        const projectRoot = path.resolve(__dirname, '../../../../');
        const cliPath = path.join(projectRoot, 'dist/index.js');
        watcherProcess = spawn('node', [cliPath, 'watch', TEST_PROJECT_DIR], { cwd: projectRoot, detached: false });
        watcherProcess.stdout?.on('data', (data) => console.log(`Watcher stdout: ${data}`));
        watcherProcess.stderr?.on('data', (data) => console.error(`Watcher stderr: ${data}`));
        await delay(3000); // Wait for watcher init

        // 5. Modify utils.ts (e.g., rename 'add' to 'sum')
        const utilsTsPath = path.join(TEST_PROJECT_DIR, 'utils.ts');
        const modifiedUtilsContent = `export function sum(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n    return a * b;\n}`;
        await fs.writeFile(utilsTsPath, modifiedUtilsContent);
        console.log(`Modified ${utilsTsPath}`);
        await delay(1000); // Small delay before next modification

        // 6. Modify main.py to use 'sum'
        const mainPyPath = path.join(TEST_PROJECT_DIR, 'main.py');
        const modifiedPyContent = `from utils import sum # Import the renamed function\n\ndef greet(name):\n    print(f"Hello, {name}!")\n\nif __name__ == "__main__":\n    result = sum(1, 2) # Call the renamed function\n    greet("World")\n    print(f"Result from TS: {result}")`;
        await fs.writeFile(mainPyPath, modifiedPyContent);
        console.log(`Modified ${mainPyPath}`);

        // 7. Wait for watcher
        await delay(7000); // Longer delay to process both changes

        // 8. Verify entity_ids.json updated for both files (Basic check: keys exist)
        const updatedCache = await fs.readJson(ENTITY_ID_FILE);
        const relativeMainPy = path.relative(TEST_PROJECT_DIR, mainPyPath);
        const relativeUtilsTs = path.relative(TEST_PROJECT_DIR, utilsTsPath);
        expect(updatedCache[relativeMainPy], `Cache should still contain key for ${relativeMainPy}`).toBeDefined();
        expect(updatedCache[relativeUtilsTs], `Cache should still contain key for ${relativeUtilsTs}`).toBeDefined();

        // 9. Query Neo4j: old relationship gone, new relationship exists
        // Check old CALLS relationship is gone
        const oldCallRels = await queryNeo4j(neo4jClient, `
            MATCH (pyFile:File)-[:CONTAINS]->(pyScope)-[r:CALLS]->(tsFunc:Function)-[:CONTAINS]-(tsFile:File)
            WHERE pyFile.path ENDS WITH 'main.py' AND tsFile.path ENDS WITH 'utils.ts' AND tsFunc.name = 'add'
            RETURN r
        `);
        expect(oldCallRels.length, "Old CALLS relationship to 'add' should be deleted").toBe(0);

        // Check new CALLS relationship exists to 'sum'
        const newCallRels = await queryNeo4j(neo4jClient, `
            MATCH (pyFile:File)-[:CONTAINS]->(pyScope)-[r:CALLS]->(tsFunc:Function)-[:CONTAINS]-(tsFile:File)
            WHERE pyFile.path ENDS WITH 'main.py' AND tsFile.path ENDS WITH 'utils.ts' AND tsFunc.name = 'sum'
            RETURN r
        `);
        expect(newCallRels.length, "New CALLS relationship should exist from main.py to utils.ts#sum").toBe(1);

        // 10. Stop watcher
        // (handled in afterEach)
    });

});