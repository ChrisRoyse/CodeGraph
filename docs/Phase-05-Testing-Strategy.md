# Phase 05: Testing Strategy & Implementation

**Version:** 1.0
**Date:** 2025-04-06

## 1. Overview

This document outlines the testing strategy for the CodeGraph analysis system. The goal is to ensure the correctness, reliability, and accuracy of each microservice and the system as a whole, with a particular focus on verifying the generated Neo4j Code Property Graph (CPG).

## 2. Test Project Selection

**Selected Project:** `test_fixtures/complex_polyglot_app/`

**Rationale:**
To rigorously test the CodeGraph system's ability to handle diverse codebases, a custom, complex polyglot application was created at `test_fixtures/complex_polyglot_app/`. This application serves as the primary test fixture for integration and end-to-end testing. It includes:
*   **Frontend:** Preact (JavaScript/JSX) with Tailwind (CSS), demonstrating modern frontend structures and dependencies.
*   **Backend Service 1:** Deno (TypeScript), showcasing a different backend language and runtime.
*   **Backend Service 2:** Python (Flask), representing a common backend language.
*   **Database Schema:** SQL (PostgreSQL), defining data structures.
*   **Interconnections:** The project is designed with intra-file, inter-file (within the same language/service), inter-directory, and cross-language dependencies (e.g., frontend calling both backends, backends potentially calling each other, Python interacting with the database based on the SQL schema).

This complexity allows for testing various CPG generation scenarios, including resolving dependencies and relationships across different languages and project structures, aligning with the verification goals outlined in `Phase-05-Verification-Accuracy.md`.

## 3. Testing Strategy

A multi-layered testing approach will be employed, covering unit, integration, and end-to-end tests.

### 3.1. Unit Testing

*   **Goal:** Verify the correctness of individual functions, classes, and modules within each microservice in isolation.
*   **Scope:** Focus on the internal logic of each service:
    *   `api_gateway`: Request validation, routing logic, basic response formatting.
    *   `code_fetcher_service`: Repository cloning/fetching logic, file handling, error handling for invalid repos/paths.
    *   `joern_analysis_service`: Input validation, Joern process invocation (`subprocess` calls), output parsing (if applicable), error handling for Joern failures, transformation to standardized format.
    *   `neo4j_ingestion_service`: Data validation (against protobuf schema), Cypher query generation, transaction management, error handling for Neo4j connection/write issues.
*   **Techniques:**
    *   Use standard unit testing frameworks (e.g., `pytest` for Python, Deno's built-in tester for Deno).
    *   **Mocking/Stubbing:** Isolate units from external dependencies (other services, file system, network calls, `subprocess`, database connections) using libraries like `unittest.mock` (Python) or appropriate Deno mocking libraries.
    *   Test edge cases, error conditions, and expected outputs for various inputs.
*   **Location:** Tests will reside within a `tests/` directory inside each service's main directory (e.g., `code_fetcher_service/tests/`).

### 3.2. Integration Testing

*   **Goal:** Verify the interactions and communication between different components or services.
*   **Scope:**
    *   **Service-to-Service:** Test direct interactions, e.g., API Gateway calling Code Fetcher, Code Fetcher calling Joern Analysis, Joern Analysis potentially calling Neo4j Ingestion (or Orchestrator handling this flow). Test gRPC communication channels defined by `.proto` files.
    *   **Service-to-External:** Test interactions with external systems like Git (for Code Fetcher) or the Neo4j database (for Neo4j Ingestion).
*   **Techniques:**
    *   Use testing frameworks like `pytest`.
    *   May involve running dependent services (e.g., in Docker containers managed by `docker-compose`).
    *   Focus on API contracts (REST/gRPC) and data exchange formats.
    *   For database interactions, use a dedicated test database instance, potentially seeded with schema and test data (`database/schema.sql`).
*   **Location:** Can reside within the respective service's `tests/integration/` subdirectory or a top-level `tests/integration/` directory.

### 3.3. End-to-End (E2E) / System Testing

*   **Goal:** Verify the complete workflow of the system from the initial API request to the final state of the Neo4j graph, using the selected test project.
*   **Scope:** Simulate a user request to analyze the `complex_polyglot_app` project.
    1.  Trigger analysis via the API Gateway.
    2.  Verify Code Fetcher clones/retrieves the project.
    3.  Verify Joern Analysis service processes the code.
    4.  Verify Neo4j Ingestion service populates the graph.
    5.  **Crucially:** Verify the accuracy and structure of the resulting Neo4j graph (see Section 4).
*   **Techniques:**
    *   Run the entire system (all services, Neo4j database) typically using `docker-compose`.
    *   Use a test client to interact with the API Gateway.
    *   Employ the Verification Framework (Section 4) to assert the final graph state.
*   **Location:** Likely in a top-level `tests/e2e/` directory.

## 4. Graph Verification Approach

Verifying the 100% accuracy of the generated Neo4j graph is paramount, as detailed in `docs/Phase-05-Verification-Accuracy.md`. The approach involves:

1.  **Defining Expected State:** For the `complex_polyglot_app` test project (and potentially smaller, focused code snippets later), manually derive and document the precise expected Neo4j graph structure. This includes:
    *   **Node Counts:** Expected number of nodes for each label (`File`, `Method`, `Class`, `Call`, `Variable`, `Dependency`, `Namespace`, etc.) based on the test project code.
    *   **Relationship Counts:** Expected number of relationships for each type (`CONTAINS`, `CALLS`, `IMPORTS`, `INHERITS`, `REFERENCES`, `DEFINES`, etc.).
    *   **Specific Nodes/Properties:** Key nodes identified by their deterministic `entityId` (generated based on file path, qualified name, line numbers, etc.) and their critical properties (name, signature, file path, language).
    *   **Specific Relationships:** Key relationships defined by source/target `entityId`s and type, verifying structural patterns (e.g., a specific function call from the Preact frontend to the Deno backend, a Python function accessing a specific database table defined in SQL).

2.  **Automated Verification Framework:** Implement tests (likely within the E2E suite using `pytest`) that:
    *   Trigger the analysis of the test project.
    *   Wait for ingestion to complete.
    *   Connect to the test Neo4j instance using the Python Neo4j driver.
    *   Execute Cypher queries to:
        *   Assert node counts per label match the expected counts.
        *   Assert relationship counts per type match the expected counts.
        *   Assert the existence and properties of specific, critical nodes identified by `entityId`.
        *   Assert the existence of specific, critical relationships between nodes identified by `entityId`.
        *   Verify structural patterns (e.g., `MATCH (f:File {language:'javascript'})-[:CALLS]->(m:Method {language:'typescript', name:'hello'}) RETURN count(*) > 0`).
    *   Use `pytest` assertions to compare query results against the documented expected state. Provide detailed error messages on failure.

This verification framework will be the core of ensuring the CPG's accuracy and completeness for the supported languages and their interactions within the test project.

## 5. Tooling

*   **Testing Framework:** `pytest` (for Python services and potentially orchestrating E2E tests), Deno built-in test runner.
*   **Mocking:** `unittest.mock` (Python), Deno standard library or third-party mocking tools.
*   **Containerization:** Docker, Docker Compose.
*   **CI/CD:** (To be integrated later) GitHub Actions or similar.
*   **Database Driver:** `psycopg2` (Python), Neo4j Python Driver.

## 6. Next Steps (Implementation)

1.  Setup test directories and add `pytest` dependencies (Task 4).
2.  Implement initial unit tests for `code_fetcher_service` (Task 5).
3.  Begin documenting the detailed expected Neo4j state for `complex_polyglot_app`.
4.  Develop the verification framework components (Cypher queries, `pytest` fixtures/tests).