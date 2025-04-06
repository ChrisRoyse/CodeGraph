# Phase 02a: Modular Microservice Architecture

**Version:** 1.0
**Date:** 2025-04-06

## 1. Goals

*   Define a refined system architecture based on isolated microservices for each language analyzer to resolve dependency conflicts (e.g., `tree-sitter` versions).
*   Specify gRPC as the primary communication protocol between internal services.
*   Clarify the role of each service within the new architecture.
*   Update infrastructure considerations to reflect reliance on an external Neo4j Desktop instance during local development.

## 2. Core Infrastructure: Neo4j Setup (Local Development)

*   **Technology:** Neo4j Graph Database.
*   **Setup:** This project will utilize an **external Neo4j Desktop instance** for local development to avoid port conflicts and simplify setup. The internal `neo4j` service definition has been removed from `docker-compose.yml`.
*   **Configuration:** Ensure your Neo4j Desktop instance is running and accessible. Connection details (URI, username, password) are configured via `.env` for host scripts and directly in `docker-compose.yml` environment variables for services.
*   **Access (Neo4j Desktop Defaults):**
    *   Neo4j Browser: `http://localhost:7474`
    *   Bolt Protocol: `bolt://localhost:7687`
*   **Docker Service Connection:** Services within Docker Compose will connect to the host's Neo4j Desktop instance using the special DNS name `host.docker.internal` (e.g., `bolt://host.docker.internal:7687`).

## 3. System Architecture

The system employs a modular microservice architecture. Each language analysis component runs in its own containerized environment, ensuring dependency isolation.

```mermaid
graph TD
    subgraph User/Trigger
        U[User Request / Git Hook]
    end

    subgraph Analysis Pipeline Services (Docker Compose)
        direction LR
        GW[API Gateway (Orchestrator)]
        CF[Code Fetcher Service]

        subgraph Language Analyzer Services (Isolated Containers)
            direction TB
            LA_JoernC[Joern C/C++ Analyzer (gRPC)]
            LA_JoernJava[Joern Java Analyzer (gRPC)]
            LA_TS_SQL[TreeSitter SQL Analyzer (gRPC)]
            LA_TS_Py[TreeSitter Python Analyzer (gRPC)]
            LA_Other[...]
        end

        NI[Neo4j Ingestion Service (gRPC)]
    end

    subgraph External Services
        Neo4j[(Neo4j Desktop Instance)]
    end

    U -- HTTP Request --> GW
    GW -- Fetch Code Request (gRPC) --> CF
    CF -- Code Fetched --> GW
    GW -- Analyze C Request (gRPC) --> LA_JoernC
    GW -- Analyze Java Request (gRPC) --> LA_JoernJava
    GW -- Analyze SQL Request (gRPC) --> LA_TS_SQL
    GW -- Analyze Python Request (gRPC) --> LA_TS_Py
    
    LA_JoernC -- Analysis Result (gRPC) --> NI
    LA_JoernJava -- Analysis Result (gRPC) --> NI
    LA_TS_SQL -- Analysis Result (gRPC) --> NI
    LA_TS_Py -- Analysis Result (gRPC) --> NI
    
    NI -- Writes Graph (Bolt) --> Neo4j

    style Neo4j fill:#ccf,stroke:#333,stroke-width:2px
```

**Service Responsibilities:**

*   **API Gateway:**
    *   Receives analysis requests via HTTP.
    *   Coordinates the workflow: calls Code Fetcher, determines language, calls the appropriate Language Analyzer via gRPC.
    *   Acts as the primary orchestrator.
*   **Code Fetcher Service:**
    *   Fetches code from specified sources (e.g., local paths, Git URLs).
    *   Makes code available to analyzer services (e.g., via shared volumes).
*   **Language Analyzer Services (e.g., `treesitter_sql_analyzer`):**
    *   **Isolated:** Each runs in its own Docker container with specific dependencies (Node.js version, Python version, exact `tree-sitter` grammar versions, CPG tool like Joern).
    *   Exposes a gRPC endpoint to receive analysis requests (file path/content).
    *   Performs code analysis using its specific tools.
    *   Generates analysis results (e.g., CPG data) in a standardized format.
    *   Sends results directly to the Neo4j Ingestion Service via gRPC.
*   **Neo4j Ingestion Service:**
    *   Receives standardized analysis results from any Language Analyzer Service via gRPC.
    *   Connects to the external Neo4j Desktop instance (`host.docker.internal:7687`).
    *   Manages persistent entity ID generation/lookup (strategy defined in Phase 02).
    *   Translates analysis data into Cypher queries (CREATE/MERGE/DELETE).
    *   Executes queries to update the Neo4j graph.

## 4. gRPC API Contracts

*   **Standardized Analysis Result Format:** A consistent Protobuf message format will define the structure for nodes and relationships sent from Analyzers to the Ingestor. (Details TBD based on Phase 01/02 schemas).
*   **Analyzer Service Endpoint:** (Example: `AnalyzeCode`)
    *   Request: Contains file path, content (optional), language hint.
    *   Response: A stream or single message containing analysis results (nodes/relationships) in the standardized Protobuf format, sent to the Neo4j Ingestion Service.
*   **Ingestor Service Endpoint:** (Example: `IngestAnalysis`)
    *   Request: A stream or single message containing analysis results from an Analyzer.
    *   Response: Status confirmation (e.g., success/failure).

*(Specific Protobuf definitions will be created)*

## 5. Persistent Entity ID Management

The strategy outlined in Phase 02 remains valid: use stable hashes of defining code element characteristics. This will be implemented within the Language Analyzer services and used by the Neo4j Ingestion Service during `MERGE` operations.

## 6. Next Steps

*   Refactor `docker-compose.yml` to define separate services for each planned language analyzer (starting with SQL).
*   Create Dockerfiles for each analyzer service, installing specific dependencies.
*   Implement the gRPC interfaces and server/client logic.
*   Update existing Phase documents (02, 03, 04, 07) to reference this architecture.