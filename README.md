# AMCP - Advanced Model Context Protocol & Codebase Intelligence Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) <!-- Placeholder License -->
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://example.com/build) <!-- Placeholder Build Status -->
[![Coverage Status](https://img.shields.io/badge/coverage-85%25-brightgreen)](https://example.com/coverage) <!-- Placeholder Coverage -->

## Overview

**AMCP** is a cutting-edge codebase intelligence platform designed to provide deep, semantic insights into complex software projects. It transcends traditional static analysis by:

1.  **Parsing** code into detailed Abstract Syntax Trees (ASTs).
2.  **Constructing** a rich knowledge graph representing code entities and their relationships within a Neo4j database.
3.  **Leveraging** advanced vector embeddings and Transformer models via ChromaDB for powerful semantic analysis and search capabilities.

This multi-faceted approach enables sophisticated querying, visualization, and understanding of code structure, dependencies, complexity hotspots, potential architectural violations, and semantic similarities.

The platform also features a **Model Context Protocol (MCP) server**, exposing its powerful analytical capabilities through a standardized tool-based interface, allowing other applications or AI agents to interact with and reason about the codebase graph.

## Key Features

*   🧠 **Deep Code Parsing:** Utilizes `ts-morph` for highly accurate and detailed TypeScript AST generation, capturing fine-grained code structures.
*   🕸️ **Graph-Based Representation:** Models codebase entities (files, classes, functions, variables, interfaces, etc.) and their intricate relationships (calls, uses, imports, inheritance, implementation, containment) in a Neo4j graph database.
*   💡 **Semantic Analysis & Embeddings:** Employs `@xenova/transformers` and ChromaDB to generate vector embeddings for code nodes, enabling semantic search ("find code that does X"), similarity analysis, and concept tracing.
*   📊 **Comprehensive Static Analysis:** Identifies crucial metrics and potential issues including dependencies, circular references, code complexity, high fan-in/fan-out nodes, and more.
*   🤖 **Model Context Protocol (MCP) Server:** Provides a rich set of tools via a local server for:
    *   Querying the codebase graph (dependencies, structure).
    *   Performing impact analysis ("what breaks if I change this?").
    *   Finding semantically related code fragments.
    *   Detecting architectural layer violations.
    *   Generating codebase overviews and context reports.
*   💻 **Command-Line Interface (CLI):** Offers commands to initiate full codebase analysis, manage the database schema, and perform administrative tasks.
*   🔧 **Extensible Architecture:** Built with modular components for scanning, parsing, analysis, storage, and serving, facilitating future enhancements.

## Architecture

The AMCP platform consists of several key components working together:

1.  **File Scanner:** Discovers relevant source code files within the target project directory based on configuration.
2.  **AST Parser (`AstParser`):** Uses `ts-morph` to parse discovered TypeScript files into ASTs. It extracts structural nodes (classes, functions, etc.) and identifies initial relationships within each file.
3.  **Analyzers:** Specialized modules analyze the ASTs to identify specific relationship types (e.g., `CallAnalyzer`, `UsageAnalyzer`, `AssignmentAnalyzer`).
4.  **Relationship Resolver:** Resolves relationships between nodes, particularly those spanning multiple files (e.g., imports, cross-file function calls).
5.  **Semantic Analyzer:** Performs semantic analysis on code nodes (currently placeholder, potential for deeper analysis).
6.  **Vector Service:** Manages the generation of vector embeddings for code nodes using Transformer models and stores/queries them using a vector database (ChromaDB).
7.  **Storage Manager:** Orchestrates the batch saving of extracted nodes and resolved relationships into the Neo4j graph database.
8.  **Neo4j Database:** The core graph database storing the comprehensive codebase knowledge graph.
9.  **MCP Server:** A separate Node.js process that connects to the Neo4j database and exposes a suite of analysis tools via the Model Context Protocol (typically over stdio or SSE).
10. **CLI:** A user-facing command-line interface (`commander`) for triggering analysis runs and managing the system.

```mermaid
graph LR
    subgraph CLI
        A[Analyze Command]
    end
    subgraph Analyzer Core
        B[File Scanner] --> C{AST Parser (ts-morph)};
        C --> D[Analyzers (Calls, Usage, etc.)];
        C --> E[Semantic Analyzer];
        D --> F[Relationship Resolver];
        E --> G[Vector Service (Transformers + ChromaDB)];
        F --> H[Storage Manager];
        G --> H;
    end
    subgraph Data Stores
        I[Neo4j Database];
        J[ChromaDB (Vector Store)];
    end
    subgraph MCP Server
        K[MCP Tool Implementations] --> L[Neo4j Client];
        M[MCP Server Runtime] --> K;
    end

    A --> B;
    H --> I;
    G --> J;
    L --> I;
    N[User/Client] <--> M;

    style CLI fill:#f9f,stroke:#333,stroke-width:2px
    style "Analyzer Core" fill:#ccf,stroke:#333,stroke-width:2px
    style "Data Stores" fill:#cfc,stroke:#333,stroke-width:2px
    style "MCP Server" fill:#ffc,stroke:#333,stroke-width:2px
```

## Technology Stack

*   **Primary Language:** TypeScript
*   **AST Parsing:** `ts-morph`
*   **Graph Database:** Neo4j (`neo4j-driver`)
*   **Vector Database:** ChromaDB (`chromadb-client`)
*   **Embeddings/Transformers:** `@xenova/transformers`
*   **CLI Framework:** `commander`
*   **Logging:** `winston`
*   **Environment Config:** `dotenv`
*   **Runtime:** Node.js
*   **Development:** npm, ESLint, Prettier, Jest, ts-node

## Getting Started

### Prerequisites

*   **Node.js:** Version 18 or higher recommended.
*   **npm:** Included with Node.js.
*   **Neo4j:** A running Neo4j instance (version 4.x or 5.x). This can be a local installation, Docker container, or a cloud instance (e.g., Neo4j Aura).

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd amcp
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  **Create `.env` file:** Copy or rename `.env.example` (if provided) to `.env` in the root directory.
2.  **Configure Neo4j Connection:** Update the `.env` file with your Neo4j instance details:
    ```dotenv
    NEO4J_URI=neo4j://localhost:7687 # Or your Neo4j instance URI
    NEO4J_USER=neo4j
    NEO4J_PASSWORD=your_neo4j_password
    NEO4J_DATABASE=codegraph # Or your desired database name
    ```
3.  **Other Configuration (Optional):** Review other variables in `.env` for logging levels, vector service settings, etc.

### Build

Compile the TypeScript code:
```bash
npm run build
```

### Running the Analyzer

To analyze a codebase and populate the Neo4j database:

```bash
# Analyze a specific directory
npm start analyze <path_to_your_codebase>

# Options:
# --reset-db: Completely clear the Neo4j database before analysis
# --update-schema: Apply schema constraints and indexes (recommended for first run)
npm start analyze <path_to_your_codebase> -- --reset-db --update-schema
```

The analysis process can take time depending on the size and complexity of the target codebase.

### Running the MCP Server

To start the server that exposes the analysis tools:

```bash
# Assuming a start script exists in package.json
npm run start:mcp

# Or run directly (adjust path if needed)
node mcp-server/dist/index.js --stdio
```

The server will listen for connections (typically via stdio for local clients).

## Usage

### CLI

The primary CLI command is `analyze`:

*   `npm start analyze <directory>`: Analyzes the specified directory.
*   `npm start analyze <directory> -- --reset-db`: Clears the database before analysis.
*   `npm start analyze <directory> -- --update-schema`: Ensures database schema (indexes, constraints) is applied.

### MCP Server Tools

Once the MCP server is running, compatible clients (like AI agents or specialized developer tools) can connect and utilize its tools. Here's a summary of available tools (refer to `mcp-server/src/tools/` for details):

**Structural & Dependency Analysis:**

*   `list_module_dependencies`: List direct imports for a file/directory.
*   `find_circular_dependencies`: Detect circular import paths.
*   `get_dependency_tree`: Visualize the import tree from a starting file.

**Complexity & Quality:**

*   `find_most_connected_nodes`: Identify nodes (Functions, Classes, etc.) with high connectivity.
*   `find_complex_files`: Find files with complex internal relationship structures.
*   `find_high_fan_in_out_nodes`: Locate components with potentially excessive responsibilities.

**Architectural Conformance:**

*   `detect_layer_violations`: Check against predefined architectural layering rules.
*   `find_unauthorized_dependencies`: Find dependencies between specified logical domains.

**Knowledge Discovery & Search:**

*   `find_code_by_domain`: Find code elements associated with a domain concept.
*   `trace_concept_implementation`: Trace how a concept is implemented across the codebase.
*   `find_related_code`: Find related code fragments using semantic similarity search.
*   `find_semantically_similar_nodes`: Find code nodes semantically similar to a query text.

**Impact Analysis:**

*   `find_affected_by_change`: Identify code potentially affected by changing a component (incoming dependencies).
*   `find_interface_ripple_effect`: Trace the impact of modifying an interface.
*   `find_downstream_dependents`: Discover parts of the system relying on a specific component (outgoing dependencies).

**Context & Overview:**

*   `generate_codebase_overview`: Generate a comprehensive Markdown overview report.
*   `get_node_context`: Gather detailed context (properties, neighborhood) for a specific code node.

**Administration:**

*   `analyzecodebase`: Provides the CLI command to run a full re-analysis.
*   `ping_server`: Checks if the MCP server is responsive.

## Contributing

Contributions are welcome! Please follow these general guidelines:

1.  **Fork** the repository.
2.  Create a **new branch** for your feature or bug fix (`git checkout -b feature/your-feature-name`).
3.  Make your changes, adhering to the existing **code style** (run `npm run lint` and `npm run format`).
4.  Add **unit tests** for new functionality or bug fixes. Ensure all tests pass (`npm test`).
5.  **Commit** your changes with clear, descriptive messages.
6.  **Push** your branch to your fork (`git push origin feature/your-feature-name`).
7.  Create a **Pull Request** targeting the `main` branch of the original repository.

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details. <!-- Create a LICENSE file if one doesn't exist -->

## Acknowledgements

*   The `ts-morph` team for the excellent TypeScript AST manipulation library.
*   The Neo4j team for the powerful graph database.
*   The ChromaDB and Hugging Face teams for enabling accessible vector search and transformer models.