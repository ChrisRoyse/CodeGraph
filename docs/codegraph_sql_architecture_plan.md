# CodeGraph: Scalable Multi-Language Code Graph Analysis & Storage System

## Objective
Design and implement a robust, scalable system that can analyze very large, polyglot codebases (millions of lines, 5+ languages), extract all code nodes (functions, classes, variables, etc.) and their relationships (calls, imports, references, etc.), and persist this data in a SQL database with a canonical ID system. The system must support cross-file and cross-language relationships, efficient updates, and rich property storage for nodes and edges.

---

## Phase 1: Foundation & Requirements Gathering
### Tasks
- Audit current analyzers and ID service for existing logic and gaps
- Define the canonical node and relationship types (abstract across languages)
- Define required node/edge properties (e.g. async, return type, language, etc.)
- Choose SQL database (e.g. Postgres) and set up a Dockerized instance
- Define the schema for code nodes and relationships (see below)

---

## Phase 2: Canonical ID System & Schema Design
### Tasks
- Design a robust canonical ID scheme:
  - Incorporate repository, file path, language, fully qualified name, and signature
  - Use a hash (e.g. SHA256) for uniqueness and scalability
- Update ID service to generate and store canonical IDs for all entities
- Define SQL schema:

```sql
CREATE TABLE code_nodes (
    id VARCHAR(64) PRIMARY KEY, -- canonical ID
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- function, class, variable, etc.
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    properties JSONB,           -- async, params, visibility, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE code_relationships (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL REFERENCES code_nodes(id),
    target_id VARCHAR(64) NOT NULL REFERENCES code_nodes(id),
    type TEXT NOT NULL,         -- calls, imports, uses, inherits, etc.
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Phase 3: Analyzer Updates & Data Pipeline
### Tasks
- Update each analyzer (Python, Java, TS, SQL, etc.) to:
  - Extract nodes/relationships + properties in a language-agnostic format
  - Request canonical IDs from the ID service for all entities
  - On scan start, **wipe all tables** (truncate code_nodes, code_relationships)
  - Insert new nodes and relationships in a single pass (batch for performance)
- Ensure analyzers emit all required properties (async, params, etc.)
- Implement batching for large codebases

---

## Phase 4: Cross-File & Cross-Language Resolution
### Tasks
- After all files are processed, run a resolution pass:
  - Use canonical IDs to link relationships across files and languages
  - Example: Python function calling a SQL procedure, or Java class using a TS API
- Store these resolved relationships in code_relationships
- Validate correctness with test cases (e.g. known cross-language links)

---

## Phase 5: Performance, Scaling, and Robustness
### Tasks
- Add indexes to SQL tables (id, type, language, file_path)
- Implement bulk insert/update strategies (e.g. COPY for Postgres)
- Add health checks and minimal logging for failures
- Add simple CLI or API for querying the graph
- Document all schema, API endpoints, and analyzer outputs

---

## Phase 6: Testing, Validation, and Documentation
### Tasks
- Build a test suite with small and very large polyglot repos
- Validate performance (insert speed, query speed, memory usage)
- Document all assumptions, limitations, and extension points
- Provide migration scripts for schema evolution
- Write developer onboarding and usage guides

---

## Appendix: Example Node & Relationship Properties
- **Node**: name, type, language, file_path, async, params, return_type, visibility, decorators, docstring, etc.
- **Relationship**: type (calls, imports, etc.), language, file_path, line_number, etc.

---

## Summary Table: Phases & Key Tasks
| Phase | Key Tasks |
|-------|-----------|
| 1     | Audit, requirements, schema selection |
| 2     | Canonical ID, SQL schema, ID service update |
| 3     | Analyzer extraction, batch insert, property capture |
| 4     | Cross-file/language linking, validation |
| 5     | Performance, health, docs, API |
| 6     | Testing, validation, onboarding |

---

This plan ensures a robust, scalable, and language-agnostic code graph system, ready for very large and complex codebases.
