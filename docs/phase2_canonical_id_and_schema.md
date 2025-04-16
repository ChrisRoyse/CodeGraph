# Phase 2: Canonical ID System & Schema Design

## 1. Canonical ID Scheme
- Canonical ID is a SHA256 hash of:
  - Repository name (or unique repo ID)
  - File path (relative to repo root)
  - Language
  - Fully qualified name (with class/module nesting)
  - Type (function, class, variable, etc.)
  - Signature (for functions/methods: param types, return type)
- Example input string for hash:
  ```
  repo:myrepo|file:src/foo/bar.py|lang:python|type:function|name:MyClass.my_func|sig:(str,int)->bool
  ```
- This ensures uniqueness across files, languages, and codebases.

## 2. ID Service Update
- The ID service will:
  - Accept all required fields for ID generation via gRPC (repo, file, lang, type, name, signature)
  - Compute SHA256 hash as canonical ID
  - Return canonical ID (and optionally GID for global queries)
  - (Optional/future) Persist generated IDs in Postgres for audit/history
- gRPC proto message (example):
  ```proto
  message GenerateIdRequest {
    string repo = 1;
    string file_path = 2;
    string language = 3;
    string entity_type = 4;
    string fully_qualified_name = 5;
    string signature = 6;
  }
  message GenerateIdResponse {
    string canonical_id = 1;
    string gid = 2;
  }
  ```

## 3. SQL Schema (Finalized)
- See `/sql/001_create_codegraph_schema.sql` for table definitions.
- All canonical IDs are stored in the `id` field (VARCHAR(64)) in `code_nodes` and referenced in `code_relationships`.
- All node/relationship properties are stored in the `properties` JSONB field.

## 4. Conventions for Analyzers
- All analyzers must:
  - Call the ID service with all required fields for every entity
  - Store the returned canonical ID in the SQL database
  - Use the same property keys for node/relationship properties (e.g., `async`, `params`, `return_type`)

## 5. Next Steps
- Update all analyzers to use the canonical ID service
- Begin SQL persistence of nodes/relationships in Phase 3

---

This document finalizes the canonical ID system and schema conventions for CodeGraph. All analyzers and services must follow these conventions for cross-language, cross-file, and large-scale codebase support.
