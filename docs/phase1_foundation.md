# Phase 1: Foundation & Requirements Gathering

## 1. Audit of Current System
- **Analyzers:**
  - Extract nodes (functions, classes, variables, etc.) and relationships (calls, imports, etc.) using ASTs or language-specific parsers.
  - Use a shared gRPC-based ID service for generating canonical IDs for all entities.
  - Do **not** currently persist extracted data to SQL or Neo4j.
- **ID Service:**
  - Generates robust, language-agnostic canonical IDs.
  - No evidence of persistent storage (SQL/Postgres) for IDs or code graph.

## 2. Canonical Node and Relationship Types
- **Node Types:**
  - `function`, `class`, `variable`, `file`, `module`, `package`, etc.
- **Relationship Types:**
  - `calls`, `imports`, `uses`, `inherits`, `defines`, `references`, etc.

## 3. Required Node/Edge Properties
- **Node Properties:**
  - `name`, `type`, `language`, `file_path`, `async`, `params`, `return_type`, `visibility`, `decorators`, `docstring`, etc.
- **Relationship Properties:**
  - `type`, `language`, `file_path`, `line_number`, etc.

## 4. SQL Database Selection
- **PostgreSQL** chosen for scalability, JSONB support, and robust ecosystem.
- Will be run as a Docker container, exposed on port 5432.

## 5. SQL Schema (see `/sql/001_create_codegraph_schema.sql`)
- `code_nodes` table: stores all code entities with canonical ID and properties.
- `code_relationships` table: stores all relationships between nodes, with properties.

## 6. Next Steps
- Add Postgres service to `docker-compose.yml`.
- Run migration in Postgres container to set up schema.
- Update analyzers to persist data to SQL in future phases.

---

This document summarizes the findings and outputs of Phase 1. See `/sql/001_create_codegraph_schema.sql` for the migration script. Proceed to Phase 2 for canonical ID and schema integration.
