# CodeGraph: Visualize, Understand, and Talk to Your Codebase!

[![CodeGraph Demo Video](https://img.youtube.com/vi/6Cg3lRitQps/0.jpg)](https://youtu.be/6Cg3lRitQps)

**(Click the image above to watch the demo video!)**

Dive into CodeGraph, a powerful tool that transforms your TypeScript and JavaScript codebase into a rich, queryable Neo4j graph database. Explore your code's structure, understand complex relationships, and even "talk" to your codebase using natural language queries facilitated by MCP (Model Context Protocol) integration.

---

## The Challenge: Navigating Code Complexity

Modern software projects, especially in TS/JS, quickly become intricate webs of files, functions, classes, and dependencies. Understanding these relationships is vital for development, maintenance, and onboarding, but it's often a daunting task.
*   How do you quickly grasp the high-level architecture?
*   How do you trace the impact of a change across files?
*   How can new team members get up to speed efficiently?
*   How can AI truly understand the *structure* and *intent* behind your code?

## Enter CodeGraph: Your Codebase Knowledge Graph

CodeGraph tackles these challenges head-on. It meticulously analyzes your TS/JS code, extracts detailed structural information and the relationships between elements, and maps it all into a Neo4j graph database.

**Why a graph? Because code *is* a graph!** Files import files, functions call functions, classes inherit from classes. Representing your codebase as a graph unlocks powerful querying, visualization, and analysis capabilities.

## Key Features

*   **Comprehensive Scanning:** Analyzes `.ts`, `.tsx`, `.js`, `.jsx` files within specified directories, respecting `.gitignore` and custom ignore patterns.
*   **Deep Parsing:** Leverages the robust `ts-morph` library for accurate Abstract Syntax Tree (AST) analysis.
*   **Rich Element Identification:** Identifies Files, Directories, Classes, Interfaces, Functions, Methods, Variables, Parameters, Type Aliases, and more.
*   **Detailed Metadata:** Extracts source location, export/async/generator status, cyclomatic complexity, documentation comments, return types, visibility, and other valuable details.
*   **Relationship Mapping:** Uncovers crucial relationships like `CONTAINS`, `IMPORTS`, `EXPORTS`, `EXTENDS`, `IMPLEMENTS`, `CALLS`, `HAS_METHOD`, `HAS_PARAMETER`, `HANDLES_ERROR` (try/catch), and `MUTATES_STATE` (assignments).
*   **Neo4j Integration:** Creates a queryable knowledge graph of your code in a configurable Neo4j database.
*   **Schema Management:** Automatically manages Neo4j constraints and indexes for optimal performance. Includes options to reset the database.
*   **MCP Integration:** Works seamlessly with MCP servers, including the `code-analyzer-mcp` for analysis and `mcp-neo4j-cypher` for querying the graph using natural language.

## How It Works: The Analysis Workflow

CodeGraph employs a sophisticated two-pass analysis process:

1.  **Pass 1 (Scanning & Parsing):**
    *   Files are scanned based on configuration.
    *   Each file is parsed into an AST using `ts-morph`.
    *   Individual code elements (nodes) and their *intra-file* relationships (e.g., a class containing methods defined *within* the same file) are identified and temporarily stored.
    *   Nodes are saved to Neo4j.
2.  **Pass 2 (Relationship Resolution):**
    *   Leveraging the complete project context available through `ts-morph` after Pass 1, this pass resolves *cross-file* relationships.
    *   Connections like function calls between different files, imports linking modules, and class inheritance/implementations across files are accurately mapped.
    *   All resolved relationships (from Pass 1 and Pass 2) are saved to Neo4j.

This ensures a comprehensive and accurate representation of your codebase's structure and dependencies.

## Neo4j Data Model

CodeGraph creates the following node labels:

*   `Directory`: Represents a folder.
*   `File`: Represents a source code file (`.ts`, `.js`, etc.). Attributes: `language`, `moduleSystem`, `loc`.
*   `Class`: Represents a class. Attributes: `isAbstract`, `isExported`, `loc`.
*   `Interface`: Represents an interface. Attributes: `isExported`, `loc`.
*   `Function`: Represents a function (declaration, expression, arrow). Attributes: `isAsync`, `isGenerator`, `isExported`, `complexity`, `returnType`, `tags`, `isCallback`.
*   `Method`: Represents a method within a class/interface. Attributes: `isAsync`, `isStatic`, `visibility`, `complexity`, `returnType`.
*   `Variable`: Represents a variable declaration. Attributes: `isConst`, `isExported`, `type`.
*   `Parameter`: Represents a function/method parameter. Attributes: `type`, `isOptional`, `isRestParameter`.
*   `TypeAlias`: Represents a type alias. Attributes: `isExported`, `type`.
*   `Placeholder`: Internal node for unresolved symbols or external references during analysis.

And connects them with these relationship types:

*   `CONTAINS`: `(Directory)-[:CONTAINS]->(File)`
*   `IMPORTS`: `(File)-[:IMPORTS]->(Placeholder)` (Resolved in Pass 2)
*   `EXPORTS`: `(File)-[:EXPORTS]->(Function|Class|Interface|Variable|TypeAlias)`
*   `EXTENDS`: `(Class)-[:EXTENDS]->(Class|Placeholder)`
*   `IMPLEMENTS`: `(Class)-[:IMPLEMENTS]->(Interface|Placeholder)`
*   `HAS_METHOD`: `(Class|Interface)-[:HAS_METHOD]->(Method)`
*   `HAS_PARAMETER`: `(Function|Method)-[:HAS_PARAMETER]->(Parameter)`
*   `CALLS`: `(Function|Method)-[:CALLS]->(Function|Method|Placeholder)`
*   `HANDLES_ERROR`: `(Function|Method)-[:HANDLES_ERROR]->(Placeholder)` (Try/Catch)
*   `MUTATES_STATE`: `(Function|Method)-[:MUTATES_STATE]->(Variable|Placeholder)` (Assignments)

## Getting Started

### Prerequisites

1.  **Neo4j Database:**
    *   Tested with Neo4j **v5.16.0** (Community or Enterprise). Later versions *might* work.
    *   Database Name: `codegraph` (or configure as needed).
    *   Credentials: Default `neo4j`/`password` or set your own.
2.  **Neo4j Plugins (Recommended):**
    *   **APOC Core:** Latest version compatible with your Neo4j (e.g., `5.16.0`).
    *   **Graph Data Science (GDS) Library:** Latest version compatible (e.g., `2.6.4`). *(While not strictly required for basic analysis, GDS enables advanced graph algorithms).*
3.  **Node.js & npm:** Latest LTS version recommended.

### Installation Options

**Option 1: Easiest Setup (Recommended)**

Download the pre-packaged zip file containing the analyzer, necessary configurations, and potentially a compatible Neo4j setup.

1.  **Download:** [CodeGraph_Setup.zip](https://drive.google.com/file/d/1gbF6GWDlFG6S1ATjsY7bdC5uJHMe20fL/view?usp=sharing)
2.  **Unzip:** Extract the contents to `C:\code\amcp\` (or your preferred location, but paths might need adjustment if not placed here, especially in MCP settings).
3.  **Configure MCP:** Set up your MCP servers (see [MCP Integration](#mcp-integration) below).
4.  **Ensure Neo4j is Running:** Start your Neo4j instance configured for the `codegraph` database.
5.  **Run Analysis:** Use the `code-analyzer-mcp` tool via your AI assistant (like Roo!).

**Option 2: Manual Setup (from GitHub)**

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url> amcp
    cd amcp
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Compile TypeScript:**
    ```bash
    npm run build
    ```
4.  **Configure Environment:** Create a `.env` file in the project root (`c:/code/amcp/`) for Neo4j credentials:
    ```dotenv
    # .env
    NEO4J_URI=bolt://localhost:7687
    NEO4J_USERNAME=neo4j
    NEO4J_PASSWORD=your_neo4j_password # Change this!
    NEO4J_DATABASE=codegraph
    ```
    *(Ensure `.env` is in your `.gitignore`)*
5.  **Configure MCP:** Set up your MCP servers (see [MCP Integration](#mcp-integration) below).
6.  **Ensure Neo4j is Running:** Start your Neo4j instance.
7.  **Run Analysis:** Use the CLI directly or the `code-analyzer-mcp` tool.

## Usage (CLI)

```bash
# Navigate to the project directory if not already there
cd c:/code/amcp

# Run the analyzer (using compiled code in dist/)
# Replace <path/to/your/codebase> with the actual path
node dist/index.js analyze <path/to/your/codebase> [options]

# Example: Analyze the current project, resetting the DB first
node dist/index.js analyze . --reset-db --update-schema

# Example: Analyze a different project, ignoring node_modules and dist
node dist/index.js analyze ../my-other-project --ignore "**/node_modules/**,**/dist/**"

# --- Options ---
#   <directory>                   Required: Path to the directory to analyze.
#   -e, --extensions <exts>       Comma-separated file extensions (default: .ts,.tsx,.js,.jsx).
#   -i, --ignore <patterns>       Comma-separated glob patterns to ignore (uses .gitignore syntax).
#   --update-schema               Force update Neo4j schema (constraints/indexes). Recommended on first run.
#   --reset-db                    WARNING: Deletes ALL data in the target Neo4j DB before analysis.
#   --neo4j-url <url>             Neo4j connection URL (overrides .env).
#   --neo4j-user <user>           Neo4j username (overrides .env).
#   --neo4j-password <password>   Neo4j password (overrides .env).
#   --neo4j-database <database>   Neo4j database name (overrides .env).
#   -h, --help                    Display help information.
#   -v, --version                 Display version information.
```

## MCP Integration

CodeGraph is designed to work seamlessly with AI assistants via the Model Context Protocol (MCP).

### Required MCP Servers:

1.  **`code-analyzer-mcp`:** Provides the `run_analyzer`, `start_watcher`, and `stop_watcher` tools to trigger analysis and manage file watching. Complies with JSON-RPC 2.0 and uses Zod for parameter validation. Depends on MCP SDK v1.7.0.
2.  **`github.com/neo4j-contrib/mcp-neo4j`:** Provides tools (`read-neo4j-cypher`, `write-neo4j-cypher`, `get-neo4j-schema`) to interact with the Neo4j database, enabling natural language querying of your code graph. Complies with JSON-RPC 2.0.

### Example `mcp_settings.json`:

```json
{
  "mcpServers": {
    "github.com/neo4j-contrib/mcp-neo4j": {
      "command": "mcp-neo4j-cypher",
      "args": [
        "--db-url",
        "bolt://localhost:7687?database=codegraph", // Adjust if your Neo4j is different
        "--username",
        "neo4j", // Adjust username
        "--password",
        "test1234" // !! CHANGE THIS PASSWORD & SECURE IT !!
      ],
      // IMPORTANT: Adjust 'cwd' if mcp-neo4j-cypher is installed elsewhere
      "cwd": "C:/Users/hotra/OneDrive/Documents/Cline/MCP/mcp-neo4j/servers/mcp-neo4j-cypher",
      "disabled": false,
      "autoApprove": [
        "read-neo4j-cypher",
        "write-neo4j-cypher",
        "get-neo4j-schema"
      ],
      "alwaysAllow": [ // Or use alwaysAllow for convenience during development
        "read-neo4j-cypher",
        "get-neo4j-schema",
        "write-neo4j-cypher"
      ]
    },
    "code-analyzer-mcp": {
      "command": "node",
      // IMPORTANT: This path assumes installation via Option 1 (Zip)
      // Adjust if you installed manually or placed the project elsewhere
      "args": [
        "c:/code/amcp/mcp/dist/index.js"
      ],
      "cwd": "c:/code/amcp/mcp", // Assumes installation via Option 1
      "disabled": false,
      "alwaysAllow": [ // Or use autoApprove
        "run_analyzer",
        "start_watcher",
        "stop_watcher"
        // Future tools might go here
      ]
    }
  }
}
```

**To use with your AI assistant:**

1.  Ensure Neo4j is running.
2.  Configure your `mcp_settings.json` correctly (adjust paths and credentials!).
3.  Ask your assistant to:
    *   `Analyze <path/to/codebase> with the analyzer tool`
    *   `Start watching <path/to/codebase> with the watcher tool`
    *   `Stop the watcher`
    *   Once analyzed: `Use the Neo4j tools to tell me about the <FunctionName> function.`
    *   `Show me the schema of the codebase graph.`

## The Development Edge: Beyond Visualization

While visualizing the graph is insightful, the real power comes from querying:

*   **Smarter Refactoring:** Precisely identify *every* usage of a function, class, or variable before renaming or modifying it. `MATCH (caller)-[:CALLS]->(callee {name: 'oldFunctionName'}) RETURN caller.filePath, caller.name`
*   **Faster Onboarding:** New team members can explore dependencies and architecture visually or through targeted queries, accelerating their understanding.
*   **Clearer Impact Analysis:** Understand the ripple effects of changes. Query the graph to see dependents before committing.
*   **Automated Documentation:** Generate diagrams or reports directly from the live codebase graph.
*   **Code Quality Insights:** Analyze coupling, cohesion, complexity hotspots, and potential dead code by querying graph patterns. `MATCH (f:Function) WHERE f.complexity > 10 RETURN f.name, f.filePath, f.complexity ORDER BY f.complexity DESC`
*   **Debugging Aid:** Trace call chains, identify potential error handling gaps, or understand state mutation paths.

## The Future: AI & Codebase Understanding

CodeGraph provides the structured knowledge foundation that AI needs to truly comprehend software architecture.

*   **AI-Assisted Refactoring:** Could an AI suggest or even perform refactoring based on graph analysis and best practices?
*   **Vulnerability Detection:** Can AI identify security risks by analyzing call chains and data flow within the graph?
*   **Intelligent Code Generation:** Could AI assist in writing new code by understanding the existing structure and finding optimal integration points?

CodeGraph is a stepping stone towards AI systems that can more deeply understand, analyze, and potentially even maintain complex software.

**Version 1 Limitations & Roadmap:**

*   **Static Analysis:** The `analyze` command creates a snapshot. Changes require re-running analysis or using the watcher.
*   **Watcher Mechanism (Current):** The `start_watcher` MCP tool initiates a file watcher (`chokidar`) within the MCP server process. When a file change (`add`, `change`, `unlink`) is detected for a supported file type, it **does not** perform a direct, fine-grained graph update. Instead, it prints a specific JSON message prefixed with `MCP_WATCHER_EXECUTE:` to `stderr`. This JSON contains a fully formed CLI command (`analyze <watched_directory> ...` for add/change, or `delete-node --filePath <deleted_file_path> ...` for unlink) and the required `cwd`. The *client environment* hosting the MCP server (e.g., an AI assistant's execution harness) is responsible for capturing this `stderr` message, parsing the JSON, and executing the command to update the Neo4j database. This means updates currently involve re-analyzing the entire watched directory or deleting all nodes for a removed file.
*   **Version 2 Goal:** Implement true real-time, incremental updates. As the AI or developer modifies files, the graph will be efficiently updated with only the necessary changes, avoiding full re-scans. The `mcp/src/watcher-child.ts` file explores a more granular approach but is not used by the current primary MCP watcher implementation.

## Support & Contribution

This is an open-source project (License: MIT - *assuming MIT, please update if different*).

As a college student developing this tool, any support is greatly appreciated! If you find CodeGraph useful, consider donating:

**[Your Donation Link Here]**

Contributions (bug reports, feature requests, pull requests) are welcome on the [GitHub Repository](Your-GitHub-Repo-Link-Here).

---

Unlock the structure within your code. Start graphing today!