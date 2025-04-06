# Phase 04: Neo4j Ingestion & Initial Population

**Version:** 1.1
**Date:** 2025-04-06

> **Note:** This phase describes the logic for ingesting analysis data into Neo4j. In the refined architecture ([Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md)), this logic resides within the dedicated **Neo4j Ingestion Service**.

## 1. Goals

*   Implement the **Neo4j Ingestion Service** to connect to the external Neo4j Desktop instance.
*   Implement logic within the **Neo4j Ingestion Service** to process the standardized analysis data (Protobuf format) received via **gRPC** from Language Analyzer services.
*   Translate the analysis data into appropriate Cypher queries (`MERGE`, `CREATE`, `SET`) based on the schema defined in Phase 01/02.
*   Integrate the persistent entity ID management strategy (from Phase 02) into the **Neo4j Ingestion Service**.
*   Perform an initial full population of the Neo4j graph using CPG data generated from a sample Python project.
*   Develop basic Cypher queries for inspecting the populated graph.

## 2. Neo4j Ingestion Service Implementation

*   **Neo4j Driver Integration:**
    *   Add the official Neo4j driver dependency (e.g., `neo4j-driver` for Python).
    *   Configure the driver connection using environment variables set in `docker-compose.yml` pointing to the external Neo4j Desktop instance (`bolt://host.docker.internal:7687`, user/pass).
    *   Implement connection management.
*   **gRPC Endpoint & Data Processing:**
    *   Implement the `IngestAnalysis` gRPC endpoint to receive analysis data (Protobuf messages) from Language Analyzer services.
    *   Process the received `nodes` and `relationships` data.
*   **Cypher Query Generation:**
    *   For each `node` in the received analysis data:
        *   Generate a `MERGE` query based on the node's `entityId`. This ensures nodes are created if they don't exist or matched if they do.
        *   Use `ON CREATE SET` and `ON MATCH SET` clauses to set/update the node's label(s) and properties based on the CPG data.
        *   Example (Conceptual Cypher for a Method node):
            ```cypher
            MERGE (n {entityId: $node.entityId})
            ON CREATE SET n = $node.properties, n :Method // Set properties and label on creation
            ON MATCH SET n += $node.properties, n :Method // Update properties and ensure label exists on match
            ```
            *   `$node` represents the parameter map containing the node's `entityId` and `properties`.
    *   For each `relationship` in the received analysis data:
        *   Generate `MATCH` queries to find the source and target nodes using their respective `entityId`s.
        *   Generate a `MERGE` query for the relationship between the matched source and target nodes, using the relationship `type`.
        *   Use `ON CREATE SET` / `ON MATCH SET` to set/update relationship properties.
        *   Example (Conceptual Cypher for a CALLS relationship):
            ```cypher
            MATCH (source {entityId: $rel.sourceEntityId}) // Match source node by its persistent ID
            MATCH (target {entityId: $rel.targetEntityId}) // Match target node by its persistent ID
            MERGE (source)-[r:$rel.type]->(target) // Merge the relationship
            ON CREATE SET r = $rel.properties // Set properties on creation
            ON MATCH SET r += $rel.properties // Update properties on match
            ```
            *   `$rel` represents the parameter map containing source/target `entityId`s, relationship `type`, and `properties`.
*   **Transaction Management:** Execute the generated Cypher queries within Neo4j transactions for atomicity (e.g., process results from one analysis request as one transaction).
*   **Error Handling:** Implement robust error handling for database operations (connection errors, query failures).

## 3. Initial Population Process

*   **Trigger:** The initial population is triggered by sending analysis requests for all relevant source files to the **API Gateway**.
*   **Workflow:**
    1.  A script or manual process identifies all source files in the target codebase.
    2.  For each file:
        *   Send an analysis request to the **API Gateway** (HTTP).
        *   The Gateway calls the appropriate **Language Analyzer** (gRPC).
        *   The Analyzer sends results to the **Neo4j Ingestion Service** (gRPC).
        *   The Ingestion Service processes the results and executes Cypher `MERGE` queries within a transaction.
    3.  Log progress and any errors encountered.

## 4. Graph Inspection Queries

Develop a set of basic Cypher queries to manually inspect the graph after the initial population:

*   Count nodes by label: `MATCH (n:Method) RETURN count(n)`
*   Count relationships by type: `MATCH ()-[r:CALLS]->() RETURN count(r)`
*   Find specific nodes: `MATCH (f:File {name: 'example.py'}) RETURN f`
*   Explore connections: `MATCH (m:Method {name: 'my_function'})-[r]->(n) RETURN m, r, n`
*   Check properties: `MATCH (p:Parameter {name: 'arg1'}) RETURN p.type`

## 5. Deliverables

*   Source code for the Neo4j Ingestion Service, including Neo4j driver integration, gRPC endpoint, and ingestion logic.
*   Updated `Dockerfile` for the Neo4j Ingestion Service.
*   Scripts or commands to trigger the initial population process.
*   A set of basic Cypher inspection queries.
*   Documentation (within this file) detailing the ingestion logic, transaction strategy, and results of the initial population run on a sample project.

## 6. Next Steps

*   Implement the Neo4j integration and ingestion logic in the **Neo4j Ingestion Service**.
*   Perform the initial population using a small-to-medium sample Python project.
*   Manually inspect the resulting graph using the defined Cypher queries to perform a preliminary validation of the schema and ingestion process.
*   Proceed to Phase 05: Verification Framework & Accuracy Testing for rigorous validation.