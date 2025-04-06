# Phase 02: Core Infrastructure & API Design (Partially Superseded)

**Version:** 1.1
**Date:** 2025-04-06

> **Note:** The overall system architecture and inter-service communication details have been refined and moved to [Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md). This document retains details on the Neo4j schema and Entity ID strategy but should be read in conjunction with Phase 02a.

## 1. Goals

*   Define the setup process for the core Neo4j database infrastructure.
*   Design the overall system architecture (See [Phase-02a](./Phase-02a-Modular-Architecture.md) for the refined microservice model).
*   Specify the **gRPC API contracts** for communication between services (See [Phase-02a](./Phase-02a-Modular-Architecture.md)).
*   Outline the strategy for generating and managing persistent, unique entity IDs for all graph elements to ensure historical tracking and enable incremental updates.

## 2. Core Infrastructure: Neo4j Setup

*   **Technology:** Neo4j Graph Database.
*   **Local Development Setup:** Use an **external Neo4j Desktop instance** to avoid port conflicts and simplify local setup. Ensure it is running.
    *   The internal `neo4j` service has been removed from the project's `docker-compose.yml`.
*   **Configuration:** Configure connection details in `.env` (for host scripts) and `docker-compose.yml` (for services). See [Phase-02a](./Phase-02a-Modular-Architecture.md#2-core-infrastructure-neo4j-setup-local-development) for details on connecting services via `host.docker.internal`.
*   **Access (Defaults):**
    *   Neo4j Browser: `http://localhost:7474`
    *   Bolt Protocol: `bolt://localhost:7687` (for drivers/host scripts)
    *   Bolt Protocol (from Docker): `bolt://host.docker.internal:7687`

## 3. System Architecture

The system employs a modular microservice architecture. **See [Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md#3-system-architecture) for the detailed diagram and service responsibilities.** The key change is isolating each language analyzer into its own containerized service to manage dependencies.

*(Diagram moved to Phase-02a)*

**Module Responsibilities:**

*   **Language Parser Services (e.g., Python Parser Service):**
    *   Responsible for analyzing code of a *specific* language.
    *   Integrates with the chosen CPG generation tool (e.g., Joern) for that language.
    *   Exposes a **gRPC endpoint** to receive analysis requests.
    *   Sends analysis results directly to the Neo4j Ingestion Service via gRPC.
    *   Runs in an isolated Docker container with specific dependencies.
*   **Orchestrator Service:**
    *   Implemented as the **API Gateway** service.
    *   Receives analysis requests via HTTP.
    *   Coordinates the workflow: calls Code Fetcher, determines language, calls the appropriate Language Analyzer via **gRPC**.
    *   Does *not* directly handle CPG data or Neo4j updates (delegated to Ingestion Service).
*   **Neo4j Ingestion Service:**
    *   Receives standardized analysis results (e.g., CPG JSON/Protobuf) from Language Analyzer Services via **gRPC**.
    *   Connects to the external Neo4j database.
    *   Manages persistent entity ID generation/lookup.
    *   Translates analysis data into Cypher queries (CREATE/MERGE/DELETE).
    *   Executes queries to update the Neo4j graph.
*   **Watcher/Change Detector (Optional/External):**
    *   Monitors the codebase for changes (e.g., using `git diff`, filesystem events).
    *   Triggers the Orchestrator Service to perform analysis on changed files.

## 4. gRPC API Contracts (Inter-Service Communication)

*   Communication between the API Gateway, Language Analyzers, and Neo4j Ingestion Service will use **gRPC** for efficiency.
*   **Standardized Protobuf Format:** A consistent Protobuf message definition will represent analysis results (nodes, relationships, properties) sent from Analyzers to the Ingestor.
*   See [Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md#4-grpc-api-contracts) for further details and endpoint examples.

## 5. Persistent Entity ID Management Strategy

*   **Requirement:** Every logical code element (file, class, method, variable declaration, call site, etc.) represented in the graph must have a unique and persistent identifier (`entityId`) that remains stable across analyses *unless the element itself fundamentally changes*. This is critical for tracking history and performing accurate incremental updates.
*   **Proposed Strategy:** Generate `entityId` by creating a stable hash (e.g., SHA-256) of defining characteristics of the element.
    *   **File:** `hash(absolute_path)`
    *   **TypeDecl (Class/Struct/etc.):** `hash(file_entityId + ':' + fully_qualified_name)`
    *   **Method/Function:** `hash(file_entityId + ':' + fully_qualified_name + ':' + signature)`
    *   **Parameter:** `hash(method_entityId + ':' + parameter_name + ':' + parameter_index)`
    *   **Local Variable:** `hash(method_entityId + ':' + variable_name + ':' + definition_line_number)`
    *   **Call Site:** `hash(caller_method_entityId + ':' + called_method_signature + ':' + line_number + ':' + column_number)`
    *   **Relationships:** Can often be identified by the `entityId`s of their source and target nodes plus the relationship type, but may need their own IDs if properties change.
*   **Implementation:**
    *   Language Parser Services will generate the `entityId` for each node they produce based on this strategy and include it in the JSON response.
    *   The **Neo4j Ingestion Service** will use this `entityId` in `MERGE` operations in Neo4j.
    *   The **Neo4j Ingestion Service** will manage any necessary caching or lookup mechanisms for efficient ID handling.

## 6. Next Steps

*   Ensure Neo4j Desktop is running and accessible.
*   Begin development of the API Gateway, Neo4j Ingestion Service, and the first Language Analyzer microservice (e.g., SQL) based on the architecture in Phase 02a.
*   Define the standardized Protobuf format for analysis results.
*   Refine the entity ID hashing algorithm.