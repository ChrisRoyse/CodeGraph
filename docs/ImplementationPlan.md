Guiding Principles for the AI:
Follow Each Step Precisely: Execute the instructions in the exact order given within each phase.
Adhere to Mandatory Architecture: Consistently implement the specified microservices pattern, Centralized ID Service, File Watcher, Message Queue (assume RabbitMQ for concrete example, but design for interface), and Neo4j interaction patterns.
Prioritize Testing: Implement tests immediately after developing corresponding code, as specified in each step. Ensure high test coverage.
Statelessness & Scalability: Design all scalable services (Analyzers, Ingestion Workers) to be stateless.
Configuration Management: Use environment variables primarily for configuration. Define clear .env.example files.
Logging & Monitoring: Implement structured logging (e.g., JSON format) in all services from the start. Include basic health check endpoints.
Error Handling: Implement robust error handling, especially around I/O, network calls, parsing failures, and database interactions. Use the message queue's retry/dead-letter mechanisms where appropriate.
Code Quality: Write clean, well-documented, typed (where applicable) code following standard conventions for the chosen language(s).
Project Setup: BMCP Real-time System
# Project Root Directory Structure (Example)
bmcp-realtime/
├── docker-compose.yml
├── .env.example
├── shared/                    # Shared Protobuf definitions, data models
│   ├── proto/
│   └── models/python/         # Pydantic models for Python services
├── services/
│   ├── id_service/            # Centralized gRPC ID Service (Node.js/TS or Rust)
│   ├── file_watcher_service/  # File System Monitoring Service
│   ├── analyzers/             # Language Analyzer Services
│   │   ├── python_analyzer/
│   │   ├── javascript_analyzer/
│   │   ├── typescript_analyzer/ # (Can potentially merge with JS)
│   │   └── go_analyzer/         # etc... for all languages
│   ├── ingestion_worker/      # Neo4j Ingestion/Resolution Worker (Python)
│   └── api_gateway/           # Configuration, Status, Query API (FastAPI)
├── tests/                     # Root for integration/E2E tests
└── scripts/                   # Utility scripts (e.g., initial setup, bulk load)
Use code with caution.
Bash
Phase 0: Foundation & Infrastructure Setup
Goal: Establish the project structure, core dependencies, communication contracts, and basic infrastructure orchestration.
Step 0.1: Initialize Project Structure: Create the directory structure outlined above. Initialize a version control system (e.g., git init).
Step 0.2: Define Core Data Models:
In shared/models/python/, create Pydantic models for:
AnalysisNodeStub
AnalysisRelationshipStub
AnalyzerResultPayload (initially basic, add deletion fields later)
Ensure these models precisely match the specification.
Step 0.3: Define Protobuf Contracts:
In shared/proto/, create .proto files for:
ID Service: id_service.proto defining IdService with GenerateId and ParseId RPCs and corresponding Request/Response messages.
(Optional) Analyzer Service: If direct gRPC calls to analyzers are ever needed (e.g., for initial scan trigger), define analyzer_service.proto.
(Optional) Ingestion Service: Define ingestion_service.proto if any direct gRPC calls are needed (less likely if using MQ primarily).
Step 0.4: Compile Protobuf: Set up scripts (e.g., using grpcio-tools for Python, grpc-tools for Node.js) to compile .proto files into language-specific code (*_pb2.py, *_pb2_grpc.py, etc.) and place them appropriately for service use.
Step 0.5: Setup Docker Compose:
Create docker-compose.yml at the project root.
Define base services:
RabbitMQ: Use the official image (e.g., rabbitmq:3-management). Configure necessary exchanges and queues (e.g., bmcp.events.filesystem, bmcp.jobs.analysis, bmcp.results.analysis) using mechanisms like a definitions file or startup script.
Neo4j: Use the official image (e.g., neo4j:latest). Configure authentication, persistence volumes, and expose ports.
PostgreSQL (Optional but Recommended): If needed for tracking/staging (e.g., File Watcher state, job status), add a Postgres service.
Step 0.6: Create Basic Dockerfiles: Create minimal Dockerfile for each planned service directory (ID Service, File Watcher, Python Analyzer, Ingestion Worker, API Gateway) using appropriate base images (Node, Python). For now, they can just copy basic placeholder code.
Step 0.7: Environment Configuration: Create .env.example listing all necessary environment variables (MQ connection strings, Neo4j URI/credentials, service ports, etc.). Update docker-compose.yml to load environment variables.
Step 0.8: Initial Infrastructure Test: Run docker-compose up. Verify that RabbitMQ, Neo4j, and other infrastructure services start correctly. Access RabbitMQ management UI and Neo4j browser if possible.
Phase 1: Centralized ID Service Implementation
Goal: Build and rigorously test the critical ID generation/parsing service.
Step 1.1: Choose Technology: Decide on Node.js/TypeScript or Rust for the id_service.
Step 1.2: Implement gRPC Server:
In services/id_service/, implement the gRPC server based on the compiled id_service.proto.
Implement the GenerateId RPC:
Take GenerateIdRequest.
Apply meticulous logic based on shared/canonical-ids/src/index.ts (ported accurately) for path normalization, entity type handling, parent context inclusion, parameter formatting, and name sanitization.
Generate the full Canonical ID.
Generate the GID (language prefix + SHA256 of Canonical ID).
Return GenerateIdResponse.
Implement the ParseId RPC:
Take ParseIdRequest.
Implement logic to parse both GIDs (extract prefix, hash) and Canonical IDs (split by ::, handle params, parent contexts).
Return ParseIdResponse with extracted components.
Step 1.3: Implement Unit Tests (ID Service):
Write comprehensive unit tests covering all aspects of Canonical ID and GID generation for various entity types, paths, parameters, parent contexts, and edge cases (special characters, deep nesting).
Test ParseId extensively with valid and invalid inputs (GIDs, canonical IDs). Ensure perfect reconstruction/parsing. Achieve near 100% coverage.
Step 1.4: Dockerize ID Service: Finalize the services/id_service/Dockerfile to build and run the service.
Step 1.5: Integrate ID Service into Docker Compose: Add the id_service definition to docker-compose.yml, exposing its gRPC port.
Step 1.6: Basic Integration Test (Manual/Scripted): Create a simple gRPC client script (in Python or Node.js) outside the service. Connect to the running ID service (via Docker networking) and test calling GenerateId and ParseId with various inputs. Verify expected outputs.
Phase 2: Basic Analysis & Ingestion Pipeline (Single Language: Python)
Goal: Create a minimal end-to-end flow: File Watcher detects -> Analyzer parses (Python) -> Ingestion Worker puts basic data into Neo4j.
Step 2.1: Implement Basic File Watcher:
In services/file_watcher_service/ (e.g., using Python with watchdog):
Implement basic logic to watch a configured directory (CODEBASE_ROOT env var).
On detecting file CREATED/MODIFIED events for .py files:
Determine the file path relative to CODEBASE_ROOT.
Publish a simple message to the bmcp.jobs.analysis RabbitMQ queue (e.g., { "file_path": "path/to/file.py", "event_type": "MODIFIED" }).
Implement connection/channel management for RabbitMQ.
Implement basic logging.
Step 2.2: Implement Unit Tests (File Watcher):
Mock file system events.
Test that the correct messages are published to a mock RabbitMQ client upon specific file events (creation, modification).
Test path relativization logic.
Step 2.3: Implement Basic Python Analyzer:
In services/analyzers/python_analyzer/:
Implement a RabbitMQ consumer listening to bmcp.jobs.analysis.
On receiving a job message:
Read the specified file_path.
Use Python's ast module to parse the file content.
Implement a simple AST visitor to identify:
File node
Function definitions
Class definitions
CRITICAL: For each identified entity:
Create a gRPC client for the Central ID Service.
Call the ID Service's GenerateId RPC with appropriate context (file path, entity type Function/Class, name, empty parent/params for now).
Store the returned GID and Canonical ID.
Prepare AnalysisNodeStub objects for the file, functions, and classes.
For now, NO relationship extraction.
Create an AnalyzerResultPayload containing only the nodes_upserted list.
Publish the AnalyzerResultPayload to the bmcp.results.analysis RabbitMQ queue.
Implement RabbitMQ producer logic. Implement basic error handling (e.g., log parsing errors).
Step 2.4: Implement Unit Tests (Python Analyzer):
Test the RabbitMQ consumer setup.
Test the parser with simple Python code samples.
Mock the ID Service gRPC client: Verify it's called with the correct arguments for functions/classes.
Verify the structure of the AnalyzerResultPayload published to the mock MQ producer.
Test basic error handling for unparseable files.
Step 2.5: Implement Basic Ingestion Worker:
In services/ingestion_worker/ (Python recommended):
Implement a RabbitMQ consumer listening to bmcp.results.analysis.
On receiving an AnalyzerResultPayload:
Connect to the Neo4j database using the neo4j driver.
Start a transaction.
For each AnalysisNodeStub in nodes_upserted:
Execute a Cypher query: MERGE (n:Node {gid: $gid}) ON CREATE SET n += $properties SET n.canonical_id = $canonical_id ON MATCH SET n += $properties SET n.canonical_id = $canonical_id RETURN n (Pass gid, canonical_id, and properties as parameters. Dynamically add labels from the stub later).
No relationship handling yet.
Commit the transaction.
Implement Neo4j driver management and basic error handling.
Step 2.6: Configure Neo4j Indexes (Initial):
Add a script or manual step (scripts/setup_neo4j.sh) to execute Cypher via cypher-shell or driver on startup/first run:
CREATE CONSTRAINT unique_gid IF NOT EXISTS FOR (n:Node) REQUIRE n.gid IS UNIQUE;
CREATE INDEX node_canonical_id IF NOT EXISTS FOR (n:Node) ON (n.canonical_id);
Step 2.7: Implement Unit Tests (Ingestion Worker):
Test the RabbitMQ consumer setup.
Mock the Neo4j driver/session: Verify that the correct Cypher queries (MERGE node) and parameters are executed for incoming node stubs.
Test transaction handling logic (commit/rollback).
Step 2.8: Dockerize & Integrate All Services:
Finalize Dockerfiles for File Watcher, Python Analyzer, Ingestion Worker.
Add these services to docker-compose.yml, ensuring they connect to RabbitMQ, Neo4j, and the ID Service correctly (using Docker network service names). Configure watched directory volume mounts for the File Watcher.
Step 2.9: Integration Test (Phase 2):
Start the full system with docker-compose up.
Create/save a simple .py file in the watched directory.
Observe Logs: Check File Watcher logs for event detection, Analyzer logs for processing and ID Service calls, Ingestion Worker logs for receiving results.
Check RabbitMQ: Verify messages flow through the queues (e.g., via Management UI).
Check Neo4j: Query the database to verify that nodes (:Node) corresponding to the file, functions, and classes were created with correct gid and canonical_id properties.
Phase 3: Real-time Updates, Deletions, and Basic Resolution
Goal: Enhance the pipeline to handle modifications, deletions, and basic relationship creation/resolution.
Step 3.1: Enhance File Watcher:
Implement event debouncing/throttling (e.g., wait X milliseconds after the last event for a file before processing).
Implement filtering logic (ignore patterns from config/env vars like node_modules, .git).
Handle DELETE events: Publish a message to bmcp.jobs.analysis or a dedicated deletion queue (e.g., bmcp.jobs.deletion) like { "file_path": "path/to/deleted.py", "event_type": "DELETED" }.
Step 3.2: Enhance Python Analyzer (Relationships & Deltas):
Modify the AST visitor to identify basic relationships:
Function Calls (find ast.Call nodes). Generate target_canonical_id based on called function name (simple resolution for now, assume local or import).
Imports (ast.Import, ast.ImportFrom).
For each relationship, create AnalysisRelationshipStub (source_gid of containing element, target_canonical_id, type: e.g., :CALLS, :IMPORTS).
Handle Modified Files:
(Simple Approach): Re-analyze the entire file. The result payload represents the new desired state. The Ingestion Worker will handle merging.
(Advanced Approach - Optional): Keep track of previously analyzed state (GIDs of nodes/rels) for the file. Compare new analysis results with the old state to explicitly identify added/modified/deleted nodes/relationships within the file. Modify AnalyzerResultPayload schema to include nodes_deleted, relationships_deleted lists. This is more complex but allows finer-grained updates. Start with the simple approach.
Add relationships list to the published AnalyzerResultPayload.
Step 3.3: Implement Unit Tests (Analyzer Enhancements):
Test call graph relationship extraction.
Test import relationship extraction.
Mock ID Service to ensure target canonical IDs are generated (even if simplified resolution).
Verify relationship stubs are correctly added to the payload.
Step 3.4: Enhance Ingestion Worker (Updates, Deletions, Pending Rel):
Modify node handling: Use ON MATCH SET n = $properties (or += if merging is preferred) to fully update node properties on modify. Add logic to dynamically apply/update labels based on node_stub.labels.
Implement Deletion Handling:
If consuming from a dedicated deletion queue or based on event_type from Analyzer: Find the GID(s) associated with the deleted file (requires storing file path on nodes or querying ID service). Execute MATCH (n {gid: $gid}) DETACH DELETE n. Ensure this happens before potential recreation if the file is immediately re-added. Needs careful sequencing/transaction management. A common pattern is to look up nodes belonging to the file first, collect their GIDs, then delete.
Implement Phase 1 Relationship Handling:
For each AnalysisRelationshipStub in the payload:
Create a :PendingRelationship node (or similar structure): CREATE (pr:PendingRelationship {sourceGid: $source_gid, targetCanonicalId: $target_canonical_id, type: $rel_type, properties: $rel_props}). Batch this if possible.
Step 3.5: Implement Basic Resolution Logic (Ingestion Worker):
Immediate Resolution Attempt (Target Side): When merging a node n, immediately after the MERGE, query for pending relationships pointing to it:
MATCH (pr:PendingRelationship {targetCanonicalId: $n_canonical_id})
WITH pr // Collect all pending rels for this node
MATCH (s:Node {gid: pr.sourceGid}) // Find source node by GID
MATCH (t:Node {gid: $n_gid}) // Get the target node just created/merged
CALL apoc.create.relationship(s, pr.type, pr.properties, t) YIELD rel // Create final relationship
DELETE pr // Delete the pending node
Use code with caution.
Cypher
(Requires APOC library or handle batching manually. Run within the node merge transaction if possible). Use n.gid and n.canonical_id from the merged node n.
(Fallback - Separate Trigger/Timer): Add a function resolve_pending_relationships():
Queries MATCH (pr:PendingRelationship) RETURN pr LIMIT 1000 (or similar batch size).
For each batch:
UNWIND $batch as pr_data
MATCH (s:Node {gid: pr_data.sourceGid})
MATCH (t:Node {canonical_id: pr_data.targetCanonicalId})
CALL apoc.create.relationship(s, pr_data.type, pr_data.properties, t) YIELD rel
// Need to reference original pr node to delete it, potentially match again by properties or pass node ID.
WITH pr_data MATCH (pr_node:PendingRelationship {sourceGid: pr_data.sourceGid, targetCanonicalId: pr_data.targetCanonicalId, type: pr_data.type}) DELETE pr_node (Query to delete needs refinement for efficiency/accuracy).
Implement a mechanism to trigger this periodically (e.g., APScheduler) or via an API call/MQ message later.
Step 3.6: Implement Unit Tests (Ingestion Worker Enhancements):
Mock Neo4j driver. Verify deletion Cypher. Verify pending relationship creation Cypher.
Test the immediate resolution logic: Simulate node creation triggering pending resolution lookup and final relationship creation/pending deletion.
Test the fallback resolution logic batching and queries.
Step 3.7: Integration Test (Phase 3):
Start the system.
Create a Python file a.py with function foo(). Verify node a.py::Function::foo created.
Create b.py calling a.foo(). Verify b.py::Function::call_a created. Verify a final :CALLS relationship exists between them (assuming resolution worked quickly). Check for leftover :PendingRelationship nodes (should ideally be none or resolving quickly).
Modify a.py (e.g., add parameter to foo). Verify a.py::Function::foo node properties/canonical_id updated.
Delete a.py. Verify the a.py file node and its function node are removed, along with the :CALLS relationship originating from b.py (if applicable, requires careful dependency deletion).
Recreate a.py. Verify nodes reappear and relationships are potentially re-established.
Phase 4: Expand Language Support
Goal: Add analyzers for the remaining required languages, following the established pattern.
Step 4.1: Implement JavaScript/TypeScript Analyzer:
In services/analyzers/javascript_analyzer/ (Node.js likely):
Set up RabbitMQ consumer/producer.
Integrate a JS/TS parser (Tree-sitter with tree-sitter-javascript and tree-sitter-typescript grammars recommended).
Implement AST traversal logic to identify entities (Files, Functions, Classes, Methods, Variables, Imports, Exports, require calls). Pay attention to ES6 modules vs CommonJS.
CRITICAL: Implement gRPC client to call the Central ID Service for all entities. Handle parent context (classes, nested functions). Handle parameters for functions/methods.
Implement basic relationship extraction (:CALLS, :IMPORTS, :USES_IMPORT, class inheritance). Generate target_canonical_id using best-effort import path resolution (handle relative paths, potentially baseUrl/paths from tsconfig.json if context allows).
Format results into AnalyzerResultPayload and publish.
Implement comprehensive Unit Tests (Parsing various JS/TS features, ID service calls, relationship extraction).
Dockerize and add to docker-compose.yml.
Step 4.2: Implement SQL Analyzer:
In a suitable service (e.g., services/analyzers/sql_analyzer/ using Python or Node.js):
Set up RabbitMQ consumer/producer.
Integrate Tree-sitter with a suitable SQL grammar (e.g., tree-sitter-sql).
Implement logic to identify entities: Files, Tables (CREATE TABLE), Columns (col_name col_type), Views, Functions/Procedures.
CRITICAL: Call Central ID Service for GID/Canonical ID generation (e.g., path/schema.sql::Table::users, path/schema.sql::users::Column::email).
Extract basic relationships: Column definitions within Tables (:DEFINES_COLUMN), View dependencies on Tables.
Format and publish results. Implement Unit Tests. Dockerize. Integrate.
Step 4.3: Implement Analyzers for Go, Java, C#, C++, Rust, HTML, CSS, React/Preact:
Repeat the pattern from Step 4.1/4.2 for each language/technology:
Create new service directory.
Choose appropriate technology/parser (Tree-sitter preferred if good grammar exists, else native tools/compiler APIs).
Implement MQ consumer/producer.
Implement parsing and entity extraction specific to the language syntax (structs, interfaces, traits, namespaces, components, hooks, HTML elements, CSS rules).
MANDATORY: Integrate gRPC client for Central ID Service calls for all entities.
Implement relevant relationship extraction (inheritance, implementation, references, component usage, styling).
Handle language-specific import/dependency resolution for generating target_canonical_id.
Add support for parsing hints (# bmcp:<hint>).
Implement comprehensive Unit Tests for each analyzer.
Dockerize and add service to docker-compose.yml.
Step 4.4: Integration Test (Multi-Language):
Create a small sample project with interacting Python, JS, and potentially SQL files.
Save changes in different files.
Verify that nodes for all languages are created correctly in Neo4j.
CRITICAL: Verify that cross-language relationships (based on target_canonical_id matching) are correctly resolved and created by the Ingestion Worker's resolution logic. Query Neo4j for specific expected cross-language links (e.g., a JS function node :CALLS a Python function node).
Phase 5: API Gateway & Configuration
Goal: Build the service for configuration, status monitoring, and potentially querying.
Step 5.1: Implement API Gateway Service (FastAPI):
In services/api_gateway/:
Set up FastAPI application.
Step 5.2: Implement Configuration API:
Endpoints (GET /config, POST /config) to manage:
Watched directory paths.
Ignored file/directory patterns.
Language extension mappings (if needed beyond defaults).
Debounce timers for File Watcher.
Store configuration (e.g., in a simple file, database, or rely on environment variables managed externally). The File Watcher needs to read this config.
Step 5.3: Implement Status Monitoring API:
Endpoint (GET /status) to provide health/status information:
Check connectivity to RabbitMQ, Neo4j, ID Service.
Query RabbitMQ management API (if accessible) for queue depths.
(Optional) Add health check endpoints to other services (Analyzers, Ingestion Worker) and query them.
Step 5.4: Implement Query Proxy API (Optional):
Endpoint (POST /query) that accepts Cypher queries (or simplified query structures).
Connects to Neo4j.
Executes the query.
Returns results to the client (e.g., a visualization tool or editor extension).
Implement basic security (e.g., API key authentication) for this endpoint.
Step 5.5: Implement Initial Scan Trigger API (Optional):
Endpoint (POST /scan/trigger) to initiate a full scan of configured directories (useful for startup or manual refresh). This might involve the API Gateway walking the directories and publishing jobs directly to bmcp.jobs.analysis.
Step 5.6: Implement Unit/Integration Tests (API Gateway):
Test API endpoints using FastAPI's test client.
Mock interactions with other services (MQ, Neo4j, Health Checks).
Test configuration loading/saving.
Test query execution path (mocking Neo4j driver).
Step 5.7: Dockerize & Integrate API Gateway: Add to docker-compose.yml. Configure ports.
Phase 6: Advanced Features & Optimization
Goal: Enhance accuracy, performance, and robustness.
Step 6.1: Implement Hint Parsing: Add logic to all relevant language analyzers to detect and parse comments like # bmcp:call-target <ID> and generate appropriate AnalysisRelationshipStubs. Test this thoroughly.
Step 6.2: Integrate Type System Information (Optional/Complex):
For typed languages (TS, Java, C#, Go), investigate using compiler APIs or static analysis tools (e.g., tsc API, MyPy internals, Go analysis tools) within the respective analyzers to:
Get more accurate call target resolution (resolve dynamic calls).
Disambiguate functions/methods based on types.
Extract type relationship information (:HAS_TYPE, :IMPLEMENTS).
This adds significant complexity to analyzers. Implement carefully with feature flags if possible.
Step 6.3: Optimize Neo4j Ingestion/Resolution:
Batching: Ensure Ingestion Worker batches Neo4j writes (UNWIND for nodes, pending rels). Profile and tune batch sizes.
Resolution Queries: Profile and optimize the Cypher queries used in the immediate and fallback resolution steps. Ensure efficient index usage (EXPLAIN, PROFILE). Consider alternative structures to :PendingRelationship nodes if they become a bottleneck (e.g., storing pending info differently).
Step 6.4: Optimize Analyzers: Profile analyzers for bottlenecks (parsing large files, ID service calls, serialization). Optimize critical paths. Minimize memory usage.
Step 6.5: Enhance File Watcher Robustness: Handle OS-level edge cases, improve error handling for inaccessible directories, refine restart/recovery logic.
Step 6.6: Develop Initial Bulk Loading Script: Create a script (scripts/bulk_load.sh or similar) that:
Runs all analyzers over the entire configured codebase.
Makes analyzers output results to CSV files formatted for neo4j-admin database load (requires deterministic GIDs generated before load - the Central ID service is perfect for this).
Automates the process of stopping Neo4j, running neo4j-admin database load, and restarting Neo4j. Document its usage for initial population.
Phase 7: Final Testing, Documentation, Deployment Prep
Goal: Ensure system stability, create user documentation, and prepare for deployment.
Step 7.1: Comprehensive End-to-End Testing:
Set up complex test codebases covering all supported languages and intricate cross-language interactions.
Perform extensive testing scenarios: initial scan, multiple rapid file modifications, large file changes, deletions, renames, error conditions (analyzer crashes, DB down).
Verify Graph Integrity: Write Cypher queries to validate the final graph state against the expected structure after complex operations. Check for orphaned nodes/relationships or incorrect links.
Step 7.2: Performance Benchmarking:
Measure initial scan time for different codebase sizes (small, medium, large).
Measure latency from file save to visible graph update under varying load levels (many small changes vs. large file changes).
Monitor CPU/Memory usage of all services under load. Identify and address bottlenecks found in Phase 6.
Step 7.3: Write Documentation:
README: Project overview, architecture, quick start guide, configuration options.
Service Documentation: Detailed description of each service's role, API (if applicable), configuration, and specific behaviors.
Canonical ID Spec: Document the exact rules for Canonical ID generation.
Deployment Guide: Instructions for deploying using Docker Compose and potentially Kubernetes (Phase 7.4).
User Guide: How to configure monitored paths, interpret the graph, use query capabilities (if any).
Step 7.4: Prepare for Deployment:
Finalize Docker images, optimize layer caching.
Create production-ready configuration examples.
(Optional) Create Kubernetes deployment manifests (Deployments, Services, ConfigMaps, Secrets, PersistentVolumes).
Refine logging and monitoring configurations for production environments.
This phased plan provides a highly detailed roadmap. The AI should proceed sequentially, ensuring tests pass at each stage before moving to the next. Continuous integration and validation are key to successfully building this complex real-time analysis system.