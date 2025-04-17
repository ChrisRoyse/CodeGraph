# CodeGraph Polyglot Analyzer: System Plan

## Overview
CodeGraph is a polyglot code analysis and graphing system designed to extract, represent, and visualize the structure and relationships of codebases spanning 20+ programming languages (e.g., Python, Java, TypeScript, SQL, C++, React, Supabase, etc.). The system parses source code, extracts a generalized set of nodes and relationships, and injects them into a Neo4j graph database for cross-language querying and visualization.

The primary testbed is the `test_polyglot_app/` folder, which contains a sample application implemented in multiple languages. The goal is to ensure that, after analysis, all meaningful entities and relationships from this folder are correctly represented in Neo4j.

---

## What the Program Does
- **Watches source code** (via file watcher and message queue) for changes in supported languages.
- **Analyzes code** using language-specific analyzers (Python, JS/TS, SQL, etc.), each with an AST visitor or parser.
- **Extracts entities** (nodes) and relationships from code, mapping language-specific constructs to a **generalized schema**.
- **Generates canonical IDs** for all nodes and relationships using a central ID service.
- **Injects nodes and relationships** into a Neo4j database for visualization and querying.
- **Logs all extraction/injection steps** for debugging and verification.

---

## Generalized CodeGraph Schema (Polyglot Support)
### Core Node Types (language-agnostic)
- **File:** Any source file or script.
- **Module/Package:** Logical grouping (module, package, namespace).
- **Class:** Class, struct, or type definition.
- **Function/Method:** Function, method, or procedure.
- **Variable:** Variable, constant, or field.
- **Parameter:** Function/method parameter.
- **Import/Include:** Import, include, require, or use statement.
- **Table/View/Column:** For SQL/DB schema objects.
- **Component:** For UI frameworks (React, Preact, etc.).
- **External:** Referenced but not defined entity.

### Core Relationship Types
- **:CALLS** – Function/method/procedure calls another.
- **:IMPORTS** – File/module imports/includes/uses another.
- **:INHERITS** – Class inherits/extends/implements another.
- **:ASSIGNS** – Variable/field assignment.
- **:DECLARES** – File/module declares a class/function/variable/etc.
- **:REFERENCES** – General reference (variable use, type use, etc.).
- **:CONTAINS** – Parent-child containment (file contains class, class contains method, etc.).
- **:RETURNS** – Function/method returns a type/value.
- **:PARAM_TYPE** – Parameter is of a type.
- **:FOREIGN_KEY** – For SQL, table/column references another.
- **:COMPONENT_USES** – For UI frameworks, component uses another.

### Node/Relationship Properties
- `canonical_id` (required, globally unique)
- `name`
- `type`
- `language`
- `file_path`
- `properties` (JSON blob for language-specific details)
- `external` (boolean, for unresolved references)

---

## What Needs to Be Fixed
### 1. **Extraction Completeness**
- Ensure all analyzers extract **all core node types** (Variable, Import, Table, etc.), not just Class/Function/File.
- Ensure **all core relationships** are extracted (not just :CALLS or :IMPORTS).
- Add fallback for unrecognized entities as `External` nodes.

### 2. **Relationship Injection**
- Confirm that relationships are actually written to Neo4j, not just logged.
- Ensure that all relationships reference valid, existing nodes (by canonical_id).
- Add error logging for any failed relationship insertions.

### 3. **Cross-Language Generalization**
- Review each analyzer’s AST visitor/parser to ensure it maps **all language-specific constructs** to the generalized schema.
- Avoid language-specific properties unless they are placed in the `properties` JSON blob.

### 4. **Canonical ID Consistency**
- All nodes and relationships must use the canonical ID service.
- Canonical ID generation must be stable and language-agnostic.

### 5. **Testing and Verification**
- Use `test_polyglot_app/` as the gold standard: after a full analysis, all files, entities, and relationships across all languages must be visible in Neo4j.
- Add debug logging for every node and relationship extracted and injected.
- Run Cypher queries in Neo4j Desktop to verify presence of all expected node types and relationship types.

---

## Implementation Checklist (for Each Analyzer)
- [ ] Map all language-specific entities to the generalized schema.
- [ ] Extract all relationships as defined above.
- [ ] Use canonical ID service for all nodes/relationships.
- [ ] Add debug logging for extracted nodes/relationships.
- [ ] Test and verify in SQL and Neo4j.

---

## Example: Schema Mapping Table
| Language | Function | Class/Type | Variable | Import/Include | Table/Column | Component | Relationship Examples |
|----------|----------|------------|----------|----------------|--------------|-----------|----------------------|
| Python   | Function | Class      | Variable | Import         | -            | -         | :CALLS, :IMPORTS, :CONTAINS |
| JS/TS    | Function | Class      | Variable | Import/Require | -            | Component | :CALLS, :IMPORTS, :CONTAINS, :COMPONENT_USES |
| SQL      | Function | -          | -        | -              | Table/Column | -         | :REFERENCES, :FOREIGN_KEY |
| Java     | Method   | Class      | Field    | Import         | -            | -         | :CALLS, :INHERITS, :CONTAINS |
| React    | Function | -          | -        | Import         | -            | Component | :COMPONENT_USES, :IMPORTS |

---

## Next Steps
1. Patch and expand all analyzers (Python, JS/TS, SQL, etc.) to:
   - Extract and log all core node and relationship types.
   - Use canonical ID service for every node and relationship.
   - Map language-specific constructs to the generalized schema.
2. Test on `test_polyglot_app/` and verify in Neo4j that:
   - All files, entities, and relationships are present and correct.
   - The graph is navigable and meaningful across languages.
3. Add additional analyzers or schema extensions as needed for new languages or frameworks.

---

## Goal
**The system is fully operational if the entire `test_polyglot_app/` project is perfectly represented in Neo4j, with all meaningful nodes and relationships, regardless of language. This is the true test of a successful, generalized, polyglot code graph extraction pipeline.**
