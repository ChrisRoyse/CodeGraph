# CodeGraph System Plan: Scalable, Cross-Language, Canonical Code Graph Analysis

## Overview
This document outlines the architecture and phased implementation plan for a robust, scalable system that:
- Analyzes entire codebases (millions of lines, multiple languages)
- Extracts and persists all code entities (functions, classes, variables, etc.) and their relationships (calls, imports, uses, etc.)
- Utilizes a canonical ID service for cross-file and cross-language linking
- Stores all results in SQL (Postgres) and Neo4j for querying and visualization
- Supports efficient, repeatable, and extensible analysis

---

## Phase 1: Foundation & Schema
### Tasks
1. **Design SQL Schema**
   - Create `code_nodes` and `code_relationships` tables with appropriate indices and JSONB properties for extensibility.
   - Ensure schema supports millions of records and is optimized for batch wipes/inserts.
2. **Neo4j Graph Model**
   - Define mapping from SQL entities to Neo4j nodes/edges.
   - Identify required node and relationship properties (e.g., async, params, file path, language).
3. **Canonical ID Service**
   - Implement or refine a service that generates canonical IDs and GIDs for all code entities, based on normalized structure and context.
   - Ensure IDs are stable across runs and unique across languages/files.

---

## Phase 2: Language Analysis & Ingestion
### Tasks
1. **Analyzer Enhancements**
   - Ensure each language analyzer (Python, JS/TS, SQL, etc.) emits:
     - All entities (nodes) and relationships (edges) with full property sets
     - Canonical IDs (from ID service)
   - Normalize output to a common schema (e.g., JSON or protocol buffers).
2. **Batch Processing**
   - Implement logic to scan a directory recursively and dispatch files to analyzers in parallel.
   - Support for large codebases: chunking, progress reporting, and error handling.
3. **SQL Persistence**
   - On each analysis run, wipe tables and insert new nodes/relationships in batches.
   - Store all properties (async, params, etc.) in JSONB columns for flexibility.

---

## Phase 3: Cross-File & Cross-Language Linking
### Tasks
1. **ID Service Integration**
   - Ensure all analyzers and orchestrators use the ID service for every entity and relationship.
   - IDs must allow linking across files and languages (e.g., Python function calling a SQL procedure).
2. **Relationship Resolution Pass**
   - After all files are analyzed, run a pass to resolve relationships between nodes using canonical IDs and GIDs.
   - Support cross-language and cross-file dependency mapping.
3. **Performance Optimizations**
   - Use indices, partitioning, and batch SQL operations for speed.
   - Consider distributed processing frameworks for massive codebases.

---

## Phase 4: Neo4j Integration & Visualization
### Tasks
1. **Data Export/Sync**
   - Implement robust export from SQL to Neo4j, mapping all nodes and relationships.
   - Support incremental updates and full refreshes.
2. **Graph Queries & Visualization**
   - Provide Cypher query templates for common analyses (e.g., call chains, dependency graphs).
   - Integrate with Neo4j Desktop or Bloom for visualization.
3. **Hybrid Querying**
   - Enable hybrid SQL/graph queries for advanced use cases (e.g., find all async functions in call chains crossing language boundaries).

---

## Phase 5: Scalability, Extensibility, and Automation
### Tasks
1. **CI/CD Integration**
   - Automate migrations, analysis runs, and exports in CI pipelines.
   - Support for scheduled, incremental, or event-driven analysis.
2. **Support for New Languages**
   - Define clear interfaces for adding new analyzers.
   - Document requirements for canonical ID integration and output schema.
3. **Monitoring & Logging**
   - Add detailed logging, error reporting, and performance metrics.
   - Monitor database and Neo4j health for large-scale runs.
4. **Advanced Storage**
   - Evaluate hybrid storage patterns (e.g., columnar storage for properties, partitioned tables).
   - Plan for distributed graph processing if needed (e.g., GraphScope, Spark).

---

## Best Practices & References
- Use intermediate representations (IRs) for language-agnostic analysis where possible.
- Canonical IDs should be generated from normalized code structure and context (e.g., hash of function signature, file path, language).
- Store all properties in flexible JSONB fields for future-proofing.
- Batch all database operations and use indices for speed.
- Use Neo4j for graph traversals and Postgres for structured metadata.
- See [docs/codegraph_sql_architecture_plan.md] for additional schema details.

---

## Next Steps
1. Review and approve this plan.
2. Begin with Phase 1: ensure schema, ID service, and analyzer outputs are ready.
3. Proceed phase by phase, validating at each step with test codebases (e.g., `test_polyglot_app/`).

---

*This plan is designed for maximum scalability, repeatability, and extensibility, ensuring CodeGraph can handle any codebase size or language mix as long as an analyzer exists.*
