# CodeGraph Canonical ID System & Cross-Language Code Analysis: Optimized Implementation Plan

## Overview
This document outlines the architecture, canonical ID system, data storage schema, and a phased implementation plan for a scalable, cross-language code graph analysis system. The goal is to enable robust analysis of very large codebases (millions of lines, 5+ languages), with the ability to:
- Generate and manage canonical IDs for all code entities.
- Store all nodes and relationships (including cross-language) in a SQL database.
- Efficiently wipe and repopulate the database for each analysis run.
- Persist rich properties for nodes and relationships (e.g., async, params, visibility).

---

## 1. Canonical ID System
- **Managed by**: `id_service` (gRPC-based, see `shared/proto/id_service.proto`).
- **Purpose**: Generate unique, stable, language-agnostic IDs for every code entity (function, class, table, etc.), and cross-language global IDs (GID).
- **Canonical ID Structure**: Encodes file path, entity type, name, parent context, and parameter types, delimited by `::` (see `parseCanonicalId` in `id-logic.ts`).
- **Usage**: All analyzers request canonical IDs from the ID service for every node and relationship.
- **Cross-language**: GIDs enable mapping relationships between entities in different languages (e.g., SQL table → Python ORM model).

---

## 2. SQL Schema for Code Graph Storage
- **Schema file**: `sql/001_create_codegraph_schema.sql`
- **Tables**:
  - `code_nodes`:
    - `id` (canonical ID, PK)
    - `name`, `type`, `language`, `file_path`
    - `properties` (JSONB, e.g., async, params, visibility)
    - `created_at`
  - `code_relationships`:
    - `id` (serial PK)
    - `source_id`, `target_id` (FK to `code_nodes.id`)
    - `type` (calls, imports, uses, etc.)
    - `properties` (JSONB)
    - `created_at`
- **Wipe & Repopulate**: Before each analysis, truncate both tables to ensure a fresh state.

---

## 3. End-to-End Analysis Workflow
1. **Wipe DB**: Truncate `code_nodes` and `code_relationships`.
2. **Scan Files**: Each analyzer (Python, JS/TS, Go, Java, C#, SQL, HTML, etc.) walks the codebase.
3. **Node/Relationship Extraction**: For each file, extract all code entities and their relationships.
4. **ID Assignment**: For each entity, request canonical ID and GID from the ID service.
5. **Batch Insert**: Store all nodes and relationships in the SQL DB, including rich properties.
6. **Cross-file & Cross-language Linking**: Use canonical IDs and GIDs to resolve relationships across files and languages.
7. **(Optional) Post-processing**: Additional analysis for more complex relationships (e.g., SQL-to-backend linkage).

---

## 4. Implementation Plan

### **Phase 1: Canonical ID System Review & Documentation**
- [ ] Review all usages of the ID service in each analyzer (Python, JS/TS, Go, Java, etc.)
- [ ] Document canonical ID and GID structure, generation, and parsing
- [ ] Ensure ID service is robust for large-scale, multi-language projects

### **Phase 2: Database Schema Validation & Migration**
- [ ] Validate `code_nodes` and `code_relationships` schema
- [ ] Ensure tables exist in all environments (local, CI, production)
- [ ] Add missing indexes for performance (if needed)
- [ ] Write migration/init scripts if not present

### **Phase 3: Analyzer Extraction Logic**
- [ ] For each analyzer:
    - [ ] Ensure all entities (functions, classes, tables, etc.) are extracted
    - [ ] Ensure all relationships (calls, imports, uses, etc.) are extracted
    - [ ] Ensure all relevant properties are captured (async, params, etc.)
    - [ ] Ensure batch insertion to DB
    - [ ] Ensure use of canonical IDs and GIDs
- [ ] Add/expand support for new languages if needed

### **Phase 4: Cross-File and Cross-Language Linking**
- [ ] Implement logic to resolve relationships across files within a language
- [ ] Implement logic to resolve relationships across languages using GID
- [ ] Special case: SQL-to-backend (e.g., Python ORM ↔ SQL table)
- [ ] Write tests for cross-language relationship resolution

### **Phase 5: Scalability & Performance**
- [ ] Test on large codebases (1M+ lines, 5+ languages)
- [ ] Optimize batch insertion, DB queries, and memory usage
- [ ] Add monitoring/logging for analysis runs
- [ ] Document scaling strategies (sharding, partitioning, etc.)

### **Phase 6: Properties & Extensibility**
- [ ] Ensure all important node/relationship properties are persisted (async, params, etc.)
- [ ] Document property schema and usage
- [ ] Add support for custom properties/extensions

### **Phase 7: Documentation & Developer Onboarding**
- [ ] Write developer docs for the ID system, schema, and analyzer architecture
- [ ] Document how to add new languages/entities/relationships
- [ ] Document troubleshooting and scaling tips

---

## Appendix: Open Questions & Research Tasks
- [ ] Review best practices for distributed ID generation at scale
- [ ] Research cross-language code graph analysis in other large-scale tools
- [ ] Identify potential bottlenecks in DB schema or ID service

---

## Conclusion
This plan provides a detailed, phased roadmap for building a robust, scalable, cross-language code graph analysis system with a canonical ID service at its core. Each phase is broken into actionable tasks. Review and approve this plan, and we can proceed to execute each phase step-by-step.
