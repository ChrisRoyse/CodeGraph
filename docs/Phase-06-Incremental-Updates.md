# Phase 06: Incremental Update Implementation

**Version:** 1.1
**Date:** 2025-04-06

## 1. Goals

*   Implement an efficient mechanism for detecting changes (added, modified, deleted files) in the target codebase.
*   Define and implement a strategy for incrementally updating the Neo4j CPG based on detected changes, minimizing redundant analysis while maintaining graph accuracy.
*   Update relevant service APIs and data structures (`.proto` files) to support the incremental flow.
*   Ensure the verification framework (Phase 05) can validate the graph's accuracy after incremental updates.

## 2. Change Detection Mechanism

*   **Requirement:** Need a reliable way to identify which source files have changed since the last analysis.
*   **Selected Approach:** Leverage **Git integration** via the `api_gateway`.
    *   The `api_gateway` will orchestrate the process by using `git diff --name-status <commit1> <commit2>` (or similar Git commands) to determine the list of Added (A), Modified (M), and Deleted (D) files between the current analysis request and the previous one for a given repository state.
    *   This list of changed files (including paths and status) will be passed downstream to the analysis and ingestion services.
    *   **Justification:** Git provides a robust, standard way to track changes precisely. It integrates well with typical development workflows and CI/CD pipelines. The `api_gateway` is the logical place for this orchestration step.

## 3. Incremental Update Strategy

This strategy aims to balance the need for complete code context during analysis with the efficiency of updating only changed portions of the graph.

### 3.1. Analysis Strategy (`joern_analysis_service`)

*   **Input:** Full codebase path, list of Added/Modified file paths, list of Deleted file paths (received from `api_gateway`).
*   **Processing:**
    1.  **Full Codebase Analysis:** Joern will be executed on the **entire codebase**.
        *   **Justification:** Joern requires the full context of the codebase (all source files) to accurately resolve dependencies, types, and cross-file relationships (e.g., function calls between files). Running it only on changed files would lead to an incomplete and potentially inaccurate CPG.
    2.  **CPG Output Filtering:** After Joern generates the complete CPG, the `joern_analysis_service` will filter this output *before* sending it downstream.
        *   The filtered CPG subset will primarily include nodes and relationships relevant to the **Added** and **Modified** files. This filtering logic needs careful implementation to ensure necessary connecting nodes/edges are retained for context.
        *   The service will also pass along the list of **Deleted** file paths received in the input.
*   **Output:** A filtered CPG subset (e.g., JSON containing relevant nodes/relationships) and the list of deleted file paths, sent to the `neo4j_ingestion_service`.

### 3.2. Graph Update Strategy (`neo4j_ingestion_service`)

*   **Input:** Filtered CPG subset (for Added/Modified files), list of Deleted file paths (received from `joern_analysis_service`).
*   **Processing (Single Transaction):** To ensure atomicity and consistency, all graph updates occur within a single Neo4j transaction.
    1.  **Handle Deletions:**
        *   For each path in the `deleted_files` list:
            *   Identify the corresponding `File` node (e.g., using its path or a derived `entityId`).
            *   Delete the `File` node and all nodes/relationships logically contained within or directly connected to it. Using `DETACH DELETE` is crucial here. Example Cypher snippet:
              ```cypher
              MATCH (f:File {path: $deletedFilePath})
              OPTIONAL MATCH (f)-[:CONTAINS*0..]->(element) // Adjust relation based on schema
              DETACH DELETE element, f
              ```
    2.  **Handle Modifications:**
        *   For each file path implicitly marked as Modified (present in the CPG subset but not 'Added'):
            *   Identify the corresponding `File` node.
            *   Delete *existing* nodes/relationships associated *only* with the *old version* of this file. This is the most complex step and relies heavily on the CPG structure and identifiers. It might involve matching elements connected to the `File` node but *not* having `entityId`s present in the *new* CPG subset for that file.
    3.  **Handle Additions / Updates (Merge):**
        *   Process the nodes and relationships from the filtered CPG subset (representing Added and Modified files).
        *   Use `MERGE` operations based on unique identifiers (like Joern's `id` or a custom `entityId` as defined in Phase 02/04) to:
            *   Create new nodes/relationships for Added files or new elements within Modified files.
            *   Update properties of existing nodes/relationships for Modified files.
*   **Output:** Updated Neo4j graph.

## 4. API and Data Structure Changes (`.proto`)

To support the flow of change information, the gRPC service definitions need updates:

*   **`joern_analysis.proto`:**
    *   Modify the `AnalyzeRequest` message to include fields for the lists of changed files:
      ```protobuf
      message AnalyzeRequest {
        string codebase_path = 1;
        repeated string added_files = 2;    // List of added file paths
        repeated string modified_files = 3; // List of modified file paths
        repeated string deleted_files = 4;  // List of deleted file paths
        // Potentially other parameters like language, config etc.
      }
      ```
    *   The `AnalyzeResponse` might need structuring to clearly separate the CPG subset from any metadata.

*   **`neo4j_ingestion.proto`:**
    *   Modify the `IngestCpgRequest` message:
      ```protobuf
      message IngestCpgRequest {
        // Option 1: Pass filtered CPG directly
        string cpg_json_subset = 1; // Or a more structured CPG representation

        // Option 2: Pass lists and let ingestion fetch CPG if needed (less likely)
        // repeated string added_files = 1;
        // repeated string modified_files = 2;

        repeated string deleted_files = 3; // Always needed for deletion step
        // Other context like repository ID, commit SHA etc.
      }
      ```
      *(Decision: Passing the filtered CPG subset (`cpg_json_subset`) seems more aligned with the strategy where `joern_analysis_service` does the filtering).*

*   **`api_gateway` Orchestration:**
    *   The gateway's internal logic needs updating to:
        1.  Call the change detection mechanism (e.g., execute `git diff`).
        2.  Parse the diff output into added, modified, deleted lists.
        3.  Call `joern_analysis_service` with the codebase path and the change lists via the updated `AnalyzeRequest`.
        4.  Receive the `AnalyzeResponse` (containing the filtered CPG subset and deleted list).
        5.  Call `neo4j_ingestion_service` with the data via the updated `IngestCpgRequest`.

## 5. Testing Strategy

*   **Scenarios:** Enhance the test suite (Phase 05) with specific incremental scenarios:
    *   Initial full analysis of a codebase version (Commit A).
    *   Introduce changes (add, modify, delete files/code) -> Commit B.
    *   Run incremental update using Commit A and Commit B.
    *   Verify the graph state after the incremental update matches the state expected from a *full analysis* of Commit B.
    *   Cover cases like: adding/modifying/deleting functions, classes, variables, imports; adding/deleting files.
*   **Verification:** Use the existing verification queries (Phase 05) against the graph after each incremental update step to ensure accuracy.

## 6. Deliverables

*   Updated `api_gateway` logic for Git-based change detection and orchestration.
*   Updated `joern_analysis_service` logic for full analysis and CPG filtering.
*   Updated `neo4j_ingestion_service` logic for transactional delete/merge operations.
*   Updated `joern_analysis.proto` and `neo4j_ingestion.proto` files.
*   Regenerated gRPC client/server code.
*   Updated `Dockerfile`s for affected services.
*   Enhanced test suite with incremental update scenarios.
*   Updated verification framework integration.
*   This documentation file (`Phase-06-Incremental-Updates.md`).

## 7. Next Steps

*   Implement the API changes in `.proto` files and regenerate gRPC code.
*   Implement the change detection and orchestration logic in `api_gateway`.
*   Implement the analysis and filtering logic in `joern_analysis_service`.
*   Implement the transactional graph update logic in `neo4j_ingestion_service`.
*   Develop and integrate the incremental update test scenarios.
*   Test thoroughly and refine until accuracy goals are met.
*   Proceed to Phase 07: Language Module Expansion.