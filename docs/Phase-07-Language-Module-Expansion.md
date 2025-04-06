# Phase 07: Language Module Expansion

**Version:** 1.1
**Date:** 2025-04-06

> **Note:** This phase describes adding new language support based on the modular microservice architecture defined in [Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md).

## 1. Goals

*   Systematically implement, integrate, and test individual **Language Analyzer Service** microservices for the target languages:
    *   JavaScript / TypeScript (JS/TS)
    *   Java
    *   C#
    *   C / C++
    *   Go
    *   SQL (If a suitable CPG/analysis tool is identified and deemed necessary)
*   Ensure each new module adheres to the microservice architecture, **gRPC API contract**, and standardized **Protobuf data format**.
*   Extend the verification framework (Phase 05) with language-specific test files and expected graph structures.
*   Validate the CPG generation, Neo4j ingestion, accuracy, and incremental update handling for each new language module.

## 2. Expansion Process (Iterative per Language)

The following process will be repeated for each target language (JS/TS, Java, C#, C/C++, Go, potentially SQL):

1.  **Tool Confirmation & Setup:**
    *   Confirm the chosen CPG tool (e.g., Joern) provides stable support for the target language.
    *   Investigate any language-specific setup or configuration required for the tool (e.g., build environment prerequisites for C/C++, JDK for Java, .NET SDK for C#).
    *   Identify the best method for invoking the tool and extracting CPG data (CLI export format, library API).
2.  **Language Analyzer Service Implementation:**
    *   Create a new service project/directory for the language module (e.g., `java_analyzer_service`).
    *   Implement the **gRPC server endpoint** (`AnalyzeCode`) using a suitable framework (e.g., `grpc-java` for Java, `grpc` for Node.js, `grpc` for Go).
    *   Integrate the CPG tool invocation logic (e.g., Joern, tree-sitter).
    *   Implement the transformation logic to convert the tool's output to the standardized **Protobuf format**, including persistent `entityId` generation.
    *   Implement the **gRPC client** logic to send results to the **Neo4j Ingestion Service** (`IngestAnalysis` endpoint).
    *   Implement robust error handling for tool execution and data transformation.
    *   Containerize the service using a `Dockerfile`, including language runtime, dependencies, and CPG tool setup.
3.  **API Gateway Integration:**
    *   Update the API Gateway's configuration (e.g., environment variables in `docker-compose.yml`) to include the gRPC address for the new language analyzer service.
    *   Enhance the API Gateway's language detection logic to identify files of the new language.
    *   Ensure the API Gateway correctly routes analysis requests for the new language to its dedicated analyzer service via gRPC.
4.  **Verification Suite Extension:**
    *   Create language-specific dummy test files (`test/verification_files/<language>/`) covering relevant constructs for that language.
    *   Define the expected Neo4j graph structures (nodes, relationships, properties, `entityId`s) for these new test files.
    *   Extend the verification framework (Phase 05) to load and execute tests for the new language, potentially adding language-specific validation logic if needed.
5.  **Testing and Validation:**
    *   **Integration Testing:** Use Docker Compose to run the new language analyzer alongside the API Gateway, Neo4j Ingestion Service (or stub), and Neo4j Desktop. Test the end-to-end flow: Gateway receives HTTP -> calls Analyzer (gRPC) -> Analyzer sends results to Ingestor (gRPC). Verify logs at each stage.
    *   **Ingestion Testing:** Perform an initial population using the new test files and verify graph structure in Neo4j Desktop using Cypher queries (Phase 04).
    *   **Accuracy Testing:** Run the extended verification test suite against the populated graph. Debug and refine the language analyzer's CPG generation/transformation and the Neo4j Ingestion Service's logic until accuracy targets are met.
    *   **Incremental Update Testing:** Run the incremental update test scenarios (from Phase 06) using the new language's test files (modify, add, delete). Verify graph accuracy after each update using the verification suite.

## 3. Language-Specific Considerations (Examples)

*   **JS/TS:** Handling module systems (CommonJS, ES Modules), frameworks (React, Angular, Vue), transpilation. Joern uses GraalVM.
*   **Java:** Build system integration (Maven, Gradle), JDK versions, bytecode vs. source code analysis. Joern uses JavaParser.
*   **C#:** .NET SDK versions, project/solution files (`.csproj`, `.sln`). Joern uses Roslyn.
*   **C/C++:** Build system complexity (Makefiles, CMake), preprocessor directives, header files, pointer analysis. Joern uses Eclipse CDT and requires careful configuration.
*   **Go:** Package management, goroutines, channels. Joern uses `go.parser`.
*   **SQL:** Different dialects (PostgreSQL, MySQL, T-SQL), stored procedures, DDL vs. DML. CPG representation for SQL is less common; may require custom parsing or a dedicated SQL analysis tool integrated separately if deemed essential. *Decision on SQL support pending further investigation.*

## 4. Deliverables (Per Language)

*   Source code for the new Language Parser Service, including `Dockerfile`.
*   Updated API Gateway configuration/code for integration.
*   Language-specific dummy test files and expected graph structure definitions.
*   Extended verification framework code.
*   Updated `docker-compose.yml` for testing.
*   Documentation (within this file or linked) detailing implementation specifics, setup, testing procedures, and validation results for the language.

## 5. Next Steps

*   Prioritize the order of language module implementation based on project needs.
*   Begin the iterative process described in Section 2 for the first expansion language (e.g., JS/TS or Java).
*   Continuously run the full verification suite across all supported languages as new modules are added.
*   Once all target language modules are implemented and validated, proceed to Phase 08: Scalability Testing & Optimization.