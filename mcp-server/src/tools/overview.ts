// Use require for CommonJS
const neo4j = require('neo4j-driver');
const z = require('zod');
const fs = require('fs/promises'); // Keep fs for reading package.json
const path = require('path'); // Keep path
// Helpers might need adjustment if they were in mcp.ts originally
// Assuming helpers are defined similarly or imported if refactored

// Define project root relative to the compiled script's location (__dirname)
// __dirname will be something like /path/to/amcp/mcp-server/dist/tools
const PROJECT_ROOT_DIR = path.resolve(__dirname, '../../..'); // Go up 3 levels: tools -> dist -> mcp-server -> amcp

// Helper function to run read queries (copied from other tool files for now)
async function runReadQuery(driver: typeof neo4j.Driver, query: string, params: Record<string, any> = {}) {
    const session = driver.session({ database: process.env.NEO4J_DATABASE || 'codegraph' });
    try {
        const neo4jParams = Object.entries(params).reduce((acc, [key, value]) => {
            // Convert JS numbers to Neo4j Integers for properties expecting them
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
        // Convert Neo4j integers/BigInts immediately upon retrieval
        return result.records.map((record: any) => {
             const obj = record.toObject();
             for (const key in obj) {
                 if (neo4j.isInt(obj[key])) {
                     obj[key] = obj[key].toNumber(); // Convert Neo4j Int
                 } else if (typeof obj[key] === 'bigint') {
                     obj[key] = Number(obj[key]); // Convert JS BigInt
                 }
             }
             return obj;
         });
    } finally {
        await session.close();
    }
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

const GenerateOverviewInputZodSchema = z.object({}); // No input parameters
const GenerateOverviewInputJSONSchema = {
    type: "object",
    properties: {},
    required: [],
} as const;

// Helper function to format query results into Markdown sections
function formatSection(title: string, data: any[], columns: string[]): string {
    if (!data || data.length === 0) {
        return `## ${title}\n\n_No data found._\n`;
    }

    let markdown = `## ${title}\n\n`;
    markdown += `| ${columns.join(' | ')} |\n`;
    markdown += `| ${columns.map(() => '---').join(' | ')} |\n`;

    data.forEach(item => {
        const row = columns.map(col => {
            let value = item[col];
            // Handle array values (like labels)
            if (Array.isArray(value)) {
                value = value.filter(v => v !== 'Embeddable').join(', '); // Filter out Embeddable label for display
            }
             // Truncate long file paths
             if (col === 'file' && typeof value === 'string' && value.length > 60) {
                value = '...' + value.slice(-57);
            }
            // Format numbers nicely - ensure value is number first
            if (typeof value === 'number') {
                 if (!Number.isInteger(value)) {
                    value = value.toFixed(2);
                 } else {
                    value = String(value); // Convert integer to string
                 }
            }
            // Ensure BigInts are converted (should be handled by runReadQuery now, but belt-and-suspenders)
            if (typeof value === 'bigint') {
                value = value.toString();
            }

            return value !== null && value !== undefined ? String(value) : '';
        }).join(' | ');
        markdown += `| ${row} |\n`;
    });

    return markdown + '\n';
}

// Helper to format dependencies from package.json
function formatDependencies(dependencies: Record<string, string> | undefined): string {
    if (!dependencies || Object.keys(dependencies).length === 0) {
        return "_No dependencies found._\n";
    }
    let markdown = "| Package | Version |\n";
    markdown += "|---|---|\n";
    Object.entries(dependencies).forEach(([pkg, version]) => {
        markdown += `| ${pkg} | ${version} |\n`;
    });
    return markdown + "\n";
}

const generateCodebaseOverviewTool: ExecutableTool = {
    name: 'generate_codebase_overview',
    description: 'Generates a comprehensive Markdown overview of the codebase graph, including node/relationship stats, complexity metrics, and potential issues.',
    inputSchema: GenerateOverviewInputJSONSchema,
    zodSchema: GenerateOverviewInputZodSchema,
    execute: async (driver, args, vectorServiceInstance) => { // Add vectorServiceInstance even if unused for consistent interface
        console.log("Starting codebase overview generation...");
        const overviewData: Record<string, any> = {}; // Keep for potential future JSON use, but focus on MD
        const reportSections: string[] = ["# Codebase Overview\n"];

        try {
            // --- Architecture & Structure ---
            reportSections.push("# Architecture & Structure\n");
            reportSections.push("## High-level Architecture Diagram\n\n_Requires manual creation or diagramming tool integration._\n");
            reportSections.push("## Directory Structure\n\n_Manual analysis or dedicated tool needed._\n");
            // Read package.json for external dependencies
            let pkgDepSection = "## Module/Package Dependencies\n\n";
            try {
                const packageJsonPath = path.join(PROJECT_ROOT_DIR, 'package.json'); // Use corrected PROJECT_ROOT_DIR
                console.log(`Reading package.json from: ${packageJsonPath}`);
                const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
                const packageJson = JSON.parse(packageJsonContent);
                pkgDepSection += "### Dependencies\n" + formatDependencies(packageJson.dependencies);
                pkgDepSection += "### Dev Dependencies\n" + formatDependencies(packageJson.devDependencies);
            } catch (error: any) {
                console.error("Failed to read or parse package.json:", error);
                pkgDepSection += "_Could not read or parse package.json._\n";
            }
            reportSections.push(pkgDepSection);
            reportSections.push("## Design Patterns\n\n_Requires manual analysis or pattern detection logic._\n");

            // --- Key Components ---
            reportSections.push("# Key Components\n");
            console.log("Fetching potential entry points...");
            overviewData.entryPoints = await runReadQuery(driver, `
                MATCH (f:Function {name: 'main'}) RETURN f.name as name, f.filePath as file, labels(f) as kind
                UNION
                MATCH (m:Method {name: 'listen'})<-[:CONTAINS]-(c:Class) RETURN m.name + ' (in ' + c.name + ')' as name, m.filePath as file, labels(m) as kind
                LIMIT 10
            `);
             reportSections.push(formatSection(
                "Potential Entry Points (Heuristic: 'main' function, 'listen' method)",
                overviewData.entryPoints,
                ['name', 'kind', 'file']
            ));
            reportSections.push("## Core Classes/Modules (Heuristic)\n\n_See 'High Fan-In/Out Nodes' section below for potential candidates._\n");
            reportSections.push("## Database Schema\n\n_Requires specific schema extraction logic or DB introspection._\n");
             console.log("Fetching potential data models...");
            overviewData.dataModels = await runReadQuery(driver, `
                MATCH (n) WHERE (n:Class OR n:Interface OR n:TypeAlias) AND (n.name ENDS WITH 'Model' OR n.name ENDS WITH 'Schema' OR n.name ENDS WITH 'Entity')
                RETURN n.name as name, n.filePath as file, labels(n) as kind
                LIMIT 20
            `);
             reportSections.push(formatSection(
                "Potential Data Models (Heuristic: Name ends with Model/Schema/Entity)",
                overviewData.dataModels,
                ['name', 'kind', 'file']
            ));
            reportSections.push("## Service Boundaries & Interfaces\n\n_Requires analysis of API definitions or specific architectural patterns._\n");


            // --- Code Metrics & Quality ---
            reportSections.push("# Code Metrics & Quality\n");
            reportSections.push("## Lines of Code\n\n_Requires external tool (e.g., 'cloc') integration._\n");
            console.log("Fetching node counts...");
            const nodeCountsData = await runReadQuery(driver, `
                MATCH (n) WHERE NOT n:_Migration RETURN labels(n) AS kinds, count(n) AS count ORDER BY count DESC
            `);
            const aggregatedNodeCounts: Record<string, number> = {};
            let totalNodes = 0;
            nodeCountsData.forEach((item: any) => {
                const primaryLabel = item.kinds.filter((l: string) => l !== 'Embeddable')[0] || 'Unknown';
                const count = Number(item.count);
                aggregatedNodeCounts[primaryLabel] = (aggregatedNodeCounts[primaryLabel] || 0) + count;
                totalNodes += count;
            });
            overviewData.totalNodes = totalNodes;
            overviewData.nodeCountsAggregated = Object.entries(aggregatedNodeCounts).map(([kind, count]) => ({ kind, count }));
            reportSections.push(formatSection(
                "Node Counts by Primary Type",
                overviewData.nodeCountsAggregated,
                ['kind', 'count']
            ));
            console.log("Fetching relationship counts...");
            const relationshipCountsData = await runReadQuery(driver, `
                MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY count DESC
            `);
            overviewData.totalRelationships = relationshipCountsData.reduce((sum: number, item: any) => sum + Number(item.count), 0);
            reportSections.push(formatSection(
                "Relationship Counts by Type",
                relationshipCountsData,
                ['type', 'count']
            ));
            console.log("Fetching complex files...");
            overviewData.complexFiles = await runReadQuery(driver, `
                MATCH (f:File)-[:CONTAINS]->(n) WHERE NOT n:Directory AND NOT n:File AND NOT n:_Migration
                MATCH (n)-[r]-() WHERE NOT type(r) IN ['CONTAINS']
                WITH f, n, count(r) AS nodeDegree
                WITH f, avg(nodeDegree) AS avgContainedDegree, count(n) AS nodesInFile
                WHERE nodesInFile > 1
                ORDER BY avgContainedDegree DESC LIMIT 10
                RETURN f.filePath AS file, avgContainedDegree, nodesInFile
            `);
            reportSections.push(formatSection(
                "Top 10 Most Complex Files (Avg. Degree of Contained Nodes)",
                overviewData.complexFiles,
                ['file', 'avgContainedDegree', 'nodesInFile']
            ));
            reportSections.push("## Test Coverage\n\n_Requires integration with coverage tools._\n");
            reportSections.push("## Static Analysis Findings\n\n_Requires integration with linters/static analysis tools._\n");
            // Technical Debt (TODOs)
            console.log("Fetching TODO indicators...");
            overviewData.todos = await runReadQuery(driver, `
                MATCH (n) WHERE n.documentation CONTAINS 'TODO' OR n.docComment CONTAINS 'TODO'
                RETURN n.name as name, labels(n) as kind, n.filePath as file, left(n.documentation, 100) + '...' as context
                LIMIT 20
            `);
             reportSections.push(formatSection(
                "Technical Debt Indicators (Sample TODOs)",
                overviewData.todos,
                ['name', 'kind', 'file', 'context']
            ));


            // --- Dependency Analysis ---
            reportSections.push("# Dependency Analysis\n");
            // External Dependencies section moved under Architecture & Structure
             console.log("Fetching most connected nodes...");
             overviewData.mostConnected = await runReadQuery(driver, `
                 MATCH (n) WHERE NOT n:Directory AND NOT n:File AND NOT n:_Migration
                 MATCH (n)-[r]-() WHERE NOT type(r) IN ['CONTAINS']
                 WITH n, count(r) AS degree
                 ORDER BY degree DESC LIMIT 10
                 RETURN n.name AS name, n.filePath AS file, degree, labels(n) as kind
             `);
             reportSections.push(formatSection(
                 "Top 10 Most Connected Nodes (excluding CONTAINS)",
                 overviewData.mostConnected,
                 ['name', 'kind', 'file', 'degree']
             ));
             console.log("Fetching high fan-in/out nodes...");
             overviewData.highFanInOut = await runReadQuery(driver, `
                 MATCH (n) WHERE (n:Class OR n:Function OR n:Method)
                 OPTIONAL MATCH (n)<-[in]-() WHERE NOT type(in) IN ['CONTAINS']
                 WITH n, count(DISTINCT in) AS fanIn
                 OPTIONAL MATCH (n)-[out]->() WHERE NOT type(out) IN ['CONTAINS']
                 WITH n, fanIn, count(DISTINCT out) AS fanOut
                 WHERE (fanIn + fanOut) >= 5
                 ORDER BY (fanIn + fanOut) DESC LIMIT 10
                 RETURN n.name AS name, n.filePath AS file, fanIn, fanOut, (fanIn + fanOut) AS totalDegree, labels(n) as kind
             `);
             reportSections.push(formatSection(
                 "Top 10 High Fan-In/Out Nodes (Min Degree 5)",
                 overviewData.highFanInOut,
                 ['name', 'kind', 'file', 'fanIn', 'fanOut', 'totalDegree']
             ));
            console.log("Fetching circular dependencies...");
            overviewData.circularDeps = await runReadQuery(driver, `
                MATCH path = (f1:File)-[:IMPORTS|CROSS_FILE_IMPORTS*1..5]->(f1)
                RETURN [n IN nodes(path) | n.filePath] AS cycle
                LIMIT 5
            `);
            reportSections.push(formatSection(
                "Sample Circular Dependencies (Max Path 5, Limit 5)",
                overviewData.circularDeps.map((c: any) => ({ cycle: c.cycle.join(' -> ') })),
                ['cycle']
            ));
            reportSections.push("## Unused Dependencies\n\n_Requires analysis comparing package.json with actual imports._\n");
            reportSections.push("## Security Vulnerabilities\n\n_Requires integration with tools like 'npm audit'._\n");


            // --- Data & Control Flow ---
            reportSections.push("# Data & Control Flow\n");
            reportSections.push("## Data Flow\n\n_Requires deeper analysis._\n");
            reportSections.push("## State Management\n\n_Requires manual analysis or specific tracers._\n");
            // Async Patterns
            console.log("Fetching async function/method counts...");
             overviewData.asyncCounts = await runReadQuery(driver, `
                 MATCH (n) WHERE (n:Function OR n:Method) AND n.isAsync = true
                 RETURN labels(n)[0] as kind, count(n) as asyncCount
             `);
             reportSections.push(formatSection(
                 "Async Functions/Methods",
                 overviewData.asyncCounts,
                 ['kind', 'asyncCount']
             ));
            reportSections.push("## Error Handling\n\n_Requires analysis of try/catch, error types._\n");

            // --- Documentation & Testing ---
            reportSections.push("# Documentation & Testing\n");
             // Documentation Coverage (Basic)
             console.log("Fetching basic documentation coverage...");
             overviewData.docCoverage = await runReadQuery(driver, `
                 MATCH (n) WHERE (n:Function OR n:Method OR n:Class OR n:Interface)
                 RETURN labels(n)[0] as kind,
                        count(n) as total,
                        sum(CASE WHEN n.documentation IS NOT NULL AND trim(n.documentation) <> "" THEN 1 ELSE 0 END) as documented
                 ORDER BY kind
             `);
             reportSections.push(formatSection(
                 "Basic Documentation Coverage (Has Docstring)",
                 overviewData.docCoverage,
                 ['kind', 'total', 'documented']
             ));
            reportSections.push("## API Documentation\n\n_Requires analysis of API definition files (Swagger, OpenAPI) or specific annotations._\n");
            reportSections.push("## Testing Strategy\n\n_Requires analysis of test files and frameworks._\n");
            reportSections.push("## Mocking Strategies\n\n_Requires analysis of test files and mocking libraries._\n");

            // --- Build & Deploy ---
            reportSections.push("# Build & Deploy\n");
            reportSections.push("## Build Configuration\n\n_Requires analysis of build scripts (package.json, webpack, etc.)._\n");
            reportSections.push("## Environment Configuration\n\n_Requires analysis of .env files, config loading._\n");
            reportSections.push("## Deployment Pipeline\n\n_Requires analysis of CI/CD configuration (e.g., GitHub Actions, Jenkinsfile)._\n");
            reportSections.push("## Feature Flags\n\n_Requires analysis of feature flag implementation._\n");

            // --- Domain Summary ---
            reportSections.push("# Domain Summary\n");
            console.log("Fetching domain summary...");
            const domainSummaryData = await runReadQuery(driver, `
                MATCH (n) WHERE n.domain IS NOT NULL AND NOT n:Directory AND NOT n:_Migration
                RETURN n.domain AS domain, labels(n)[0] AS primaryKind, count(n) AS count
                ORDER BY domain, primaryKind
            `);
            const aggregatedDomainSummary: Record<string, Record<string, number>> = {};
            domainSummaryData.forEach((item: any) => {
                const domain = item.domain as string;
                const kind = item.primaryKind as string;
                const count = Number(item.count);
                if (!aggregatedDomainSummary[domain]) {
                    aggregatedDomainSummary[domain] = {};
                }
                aggregatedDomainSummary[domain][kind] = (aggregatedDomainSummary[domain][kind] || 0) + count;
            });
            overviewData.domainSummaryAggregated = Object.entries(aggregatedDomainSummary).map(([domain, kinds]) => ({
                domain,
                details: Object.entries(kinds).map(([kind, count]) => `${kind}: ${count}`).join(', ')
            }));
            reportSections.push(formatSection(
                "Node Counts by Domain",
                overviewData.domainSummaryAggregated,
                ['domain', 'details']
            ));


            // --- Generate Final Report ---
            const markdownReport = reportSections.join('\n');
            console.log("Overview generation complete.");
            return markdownReport; // Return the Markdown string directly

        } catch (error: any) {
            console.error("Error generating codebase overview:", error);
             if (error instanceof TypeError && error.message.includes("Cannot mix BigInt")) {
                 console.error("BigInt conversion error detected during overview generation.");
                 throw new Error(`Failed to generate overview due to BigInt conversion issue. Check query results processing.`);
             }
            throw new Error(`Failed to generate overview: ${error.message}`);
        }
    },
};

// Use module.exports for CommonJS
module.exports = {
    overviewTools: [
        generateCodebaseOverviewTool,
    ]
};