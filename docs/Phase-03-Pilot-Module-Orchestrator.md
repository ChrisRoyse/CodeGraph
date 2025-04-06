# Phase 03: Pilot Language Analyzer & API Gateway Stub

**Version:** 1.1
**Date:** 2025-04-06

> **Note:** This phase implements the first components of the modular microservice architecture defined in [Phase-02a-Modular-Architecture.md](./Phase-02a-Modular-Architecture.md).

## 1. Goals

*   Implement the first language-specific analyzer module (e.g., `treesitter_python_analyzer`), using Python as the pilot language.
*   Develop a basic API Gateway service stub capable of communicating with the pilot analyzer module via **gRPC**.
*   Implement a basic Neo4j Ingestion Service stub to receive analysis results via **gRPC**.
*   Verify the end-to-end flow: API Gateway receives HTTP request -> calls Code Fetcher -> calls Python Analyzer (gRPC) -> Analyzer sends results to Ingestor (gRPC).
*   Containerize the pilot module and orchestrator stub for isolated testing and future deployment.

## 2. Pilot Language Module: Python Analyzer Service (Example)

*   **Technology Stack:** Python (using `grpcio` for the gRPC server), chosen CPG tool's Python integration (e.g., `tree-sitter` library for Python).
*   **Core Logic:**
    1.  **gRPC Service Definition (`AnalyzeCode`):**
        *   Implement the gRPC server endpoint based on Protobuf definitions.
        *   Receive `filePath` or `fileContent` for a Python file via gRPC request.
        *   Validate the request.
    2.  **CPG Tool Integration:**
        *   Invoke the appropriate CPG tool (e.g., `tree-sitter` Python library) to analyze the code.
        *   Handle potential errors during parsing.
    3.  **CPG Data Transformation:**
        *   Convert the CPG tool's output into the standardized Protobuf format defined for inter-service communication. Generate persistent `entityId`s.
    4.  **Send Results to Ingestor:**
        *   Establish a gRPC client connection to the Neo4j Ingestion Service.
        *   Send the generated analysis results (Protobuf messages) to the Ingestor's `IngestAnalysis` endpoint.
        *   Handle potential communication errors.
*   **Containerization:**
    *   Create a `Dockerfile` for the Python Parser Service.
    *   Include Python runtime, service dependencies (Flask/FastAPI), CPG tool installation/setup, and the service code.
    *   Expose the necessary port for the gRPC server.

## 3. API Gateway Service Stub

*   **Technology Stack:** Can be implemented in any suitable language (e.g., Python, Node.js, Go).
*   **Core Logic:**
    1.  **Configuration:** Load connection details for the Code Fetcher and all Language Analyzer services (e.g., `python_analyzer:500XX`) from environment variables set in `docker-compose.yml`.
    2.  **HTTP Endpoint:** Implement a basic HTTP endpoint (e.g., `POST /analyze`) to receive analysis requests (e.g., specifying a file path or repository URL).
    3.  **Workflow Logic:**
        *   Call the Code Fetcher service (gRPC) to retrieve the code.
        *   Determine the language (e.g., based on file extension).
        *   Call the appropriate Language Analyzer service (e.g., Python Analyzer) via **gRPC**, passing the code location/content.
    4.  **Response Handling:**
        *   The Analyzer sends results directly to the Ingestor. The Gateway only needs to confirm the analysis request was successfully dispatched to the correct analyzer.
        *   Return an HTTP response indicating the analysis request was accepted (e.g., 202 Accepted).
    4.  **Response Handling:**
*   *(Response Handling details moved above)*
*   **Containerization:**
    *   Create a `Dockerfile` for the API Gateway Service.
    *   Include runtime, dependencies, and the stub code.

## 4. Neo4j Ingestion Service Stub

*   **Technology Stack:** Python (using `grpcio`).
*   **Core Logic:**
    1.  **gRPC Service Definition (`IngestAnalysis`):** Implement the server endpoint.
    2.  **Receive Results:** Accept analysis results (Protobuf messages) from Analyzer services.
    3.  **Log/Print:** For this stub phase, simply log or print the received analysis data structure to verify successful communication. Actual Neo4j connection and ingestion is deferred to Phase 04.
*   **Containerization:** Create a `Dockerfile`.

## 5. Testing Strategy

*   **Unit Tests:** Test individual components like API request/response handling, CPG data transformation logic, and entity ID generation within the Python module.
*   **Integration Tests:**
    1.  Create simple sample Python files with various constructs (functions, classes, calls, variables).
    2.  Run the containerized services (API Gateway, Python Analyzer, Ingestor Stub) using Docker Compose.
    3.  Send an HTTP request to the API Gateway to trigger analysis for a sample Python file.
    4.  Verify (by inspecting logs/output for this phase):
        *   Gateway calls the Python Analyzer.
        *   Python Analyzer calls the Ingestor Stub.
        *   Ingestor Stub receives the expected analysis data structure (Protobuf).
    5.  Test error handling (e.g., providing an invalid file path, malformed code).
*   **Tools:** Use standard testing frameworks (e.g., `pytest`). Use `grpcurl` or similar tools for direct gRPC testing. Use Docker Compose for the test environment.

## 6. Deliverables

*   Source code for the pilot Python Analyzer Service, including `Dockerfile`.
*   Source code for the API Gateway Stub, including `Dockerfile`.
*   Source code for the Neo4j Ingestion Service Stub, including `Dockerfile`.
*   Updated `docker-compose.yml` reflecting the new services.
*   Sample Python test files.
*   Documentation (within this file) detailing the implementation choices, setup instructions for testing, and test results.

## 7. Next Steps

*   Define the Protobuf messages for gRPC communication (Analyzer -> Ingestor).
*   Implement the pilot Python Analyzer Service (using `tree-sitter`).
*   Implement the API Gateway Stub.
*   Implement the Neo4j Ingestion Service Stub.
*   Perform integration testing of the gRPC communication flow.
*   Proceed to Phase 04: Neo4j Ingestion & Initial Population.