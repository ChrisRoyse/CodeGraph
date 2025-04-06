# Phase 01: CPG Research, Tool Selection & Schema Foundation

**Version:** 1.0
**Date:** 2025-04-05

## 1. Goals

*   Research existing Code Property Graph (CPG) generation tools suitable for a multi-language codebase (TS/JS, Python, Java, C#, C/C++, Go).
*   Evaluate candidate tools based on language support, output formats, extensibility, incremental analysis capabilities, community support, and licensing.
*   Select the primary CPG tool(s) for the project.
*   Define the foundational Neo4j CPG schema based on established standards and project requirements.

## 2. Activities

*   **CPG Tool Research:** Use Perplexity AI tools (`search`, `get_documentation`) to gather information on candidate CPG tools (e.g., Joern, Plume, Fraunhofer CPG).
*   **Tool Evaluation:** Analyze documentation for:
    *   Supported Languages: Verify coverage for TS/JS, Python, Java, C#, C/C++, Go. Note any gaps (e.g., SQL).
    *   Output Formats: Check for direct Neo4j export, CSV, JSON, GraphML, Protobuf, etc.
    *   Extensibility: Assess options for custom rules, queries, or passes.
    *   Incremental Analysis: Determine if tools support efficient updates based on code changes.
    *   Community & Maintenance: Evaluate project activity, support channels, and licensing.
*   **CPG Standard Research:** Review CPG specifications (e.g., [CPG Specification](https://cpgspec.github.io/), Joern's schema).
*   **Tool Selection:** Choose the most promising tool(s) based on the evaluation criteria. Document the rationale.
*   **Schema Definition:** Define core Neo4j node labels, relationship types, and essential properties.
*   **Documentation:** Record findings, decisions, and the defined schema in this document.

## 3. CPG Tool Research & Evaluation

### 3.1. Joern

*   **Description:** Open-source platform for code analysis using CPGs. Strong focus on vulnerability discovery.
*   **Supported Languages:** C/C++, Java, JS/TS, Python, Go, Kotlin, C#, PHP, Ruby, Swift, Binaries (x86/x64). (SQL not supported). Maturity varies (High for C/Java/JS/Py/Binaries, Medium for Go/C#, Low for others).
*   **Output Formats:** Neo4j CSV, GraphML, GraphSON, DOT. Allows export of specific graph representations (AST, CFG, PDG, CPG).
*   **Extensibility:** High. Custom CPG passes, Scala-based query DSL, plugin system.
*   **Incremental Analysis:** No explicit support mentioned in initial research documentation. Further investigation might be needed, or this might require custom implementation on top of Joern.
*   **Community & Maintenance:** Actively maintained (GitHub), Apache 2.0 license, Discord community.
*   **Pros:** Wide language support, powerful query capabilities, active development, standard CPG implementation.
*   **Cons:** SQL not supported, incremental analysis capability unclear from initial research, potentially steep learning curve for Scala DSL.
*   **Reference:** [Joern Docs](https://docs.joern.io), [GitHub](https://github.com/joernio/joern)

*(Further research on Plume, Fraunhofer CPG, and potentially others like CodeQL CPG extraction will be added here)*

## 4. Tool Selection Rationale (Preliminary)

Based on initial research, **Joern** appears to be a strong candidate due to its broad language support matching most project requirements, its foundation on CPG standards, active maintenance, and powerful analysis capabilities.

**Key Considerations:**
*   The lack of explicit incremental analysis support needs further investigation or planning for custom implementation.
*   SQL support is missing; a separate strategy/tool might be needed if SQL analysis is critical.
*   The team's familiarity with Scala for extending queries should be assessed.

**Decision:** Tentatively select Joern as the primary CPG generation tool, pending further research into alternatives and deeper investigation into its incremental update potential.

## 5. Foundational Neo4j CPG Schema

This initial schema is based on common CPG concepts and Joern's schema. It will be refined as tool selection is finalized and implementation progresses.

**Core Node Labels:**

*   `File`: Represents a source code file.
    *   Properties: `id` (persistent unique ID), `name` (string), `path` (string), `language` (string), `hash` (string, content hash for change detection), `code` (string, optional full content)
*   `Namespace`: Represents a namespace or package.
    *   Properties: `id`, `name` (string)
*   `TypeDecl`: Represents a type declaration (class, struct, interface, enum).
    *   Properties: `id`, `name` (string), `fullName` (string), `inheritsFrom` (list<string>), `line` (int), `column` (int)
*   `Method` / `Function`: Represents a method or function.
    *   Properties: `id`, `name` (string), `fullName` (string), `signature` (string), `returnType` (string), `isExternal` (boolean), `line` (int), `column` (int)
*   `Parameter`: Represents a method/function parameter.
    *   Properties: `id`, `name` (string), `type` (string), `index` (int), `line` (int), `column` (int)
*   `Local`: Represents a local variable declaration.
    *   Properties: `id`, `name` (string), `type` (string), `line` (int), `column` (int)
*   `Member`: Represents a class member/field.
    *   Properties: `id`, `name` (string), `type` (string), `line` (int), `column` (int)
*   `Call`: Represents a function or method call.
    *   Properties: `id`, `name` (string, called method name), `fullName` (string), `signature` (string), `dispatchType` (string, e.g., STATIC, DYNAMIC), `line` (int), `column` (int)
*   `Identifier`: Represents an occurrence of a variable/parameter.
    *   Properties: `id`, `name` (string), `line` (int), `column` (int)
*   `Literal`: Represents a literal value (string, number, boolean).
    *   Properties: `id`, `value` (string), `type` (string), `line` (int), `column` (int)
*   `ControlStructure`: Represents control flow constructs (if, while, for, switch).
    *   Properties: `id`, `type` (string, e.g., IF, WHILE), `line` (int), `column` (int)
*   `MetaData`: General metadata node for the graph.
    *   Properties: `language` (string), `version` (string)

**Core Relationship Types:**

*   **AST (Abstract Syntax Tree) Edges:**
    *   `SOURCE_FILE`: (`Namespace`|`TypeDecl`|`Method`) -> `File`
    *   `CONTAINS`: (`File`|`Namespace`|`TypeDecl`|`Method`) -> (`TypeDecl`|`Method`|`Member`|`Local`|`Parameter`|`Call`|`Identifier`|`Literal`|`ControlStructure`)
    *   `AST`: Parent AST node -> Child AST node (Generic structural relationship)
    *   `PARAMETER_LINK`: (`Parameter`) -> `Method`
    *   `LOCAL_LINK`: (`Local`) -> `Method`
    *   `MEMBER_LINK`: (`Member`) -> `TypeDecl`
*   **CFG (Control Flow Graph) Edges:**
    *   `FLOWS_TO`: Source CFG node -> Target CFG node (Represents execution flow)
    *   `CONDITION`: (`ControlStructure`) -> Expression node (Boolean condition)
*   **PDG (Program Dependence Graph) Edges:**
    *   `REACHES`: Definition site (e.g., `Local`, `Parameter`) -> Usage site (`Identifier`) (Data dependency)
    *   `CALLS`: (`Call`) -> (`Method`|`Function`)
    *   `REF`: (`Identifier`) -> (`Local`|`Parameter`|`Member`) (Reference to declaration)
    *   `INHERITS_FROM`: (`TypeDecl`) -> (`TypeDecl`)
    *   `IMPORTS` / `DEPENDS_ON`: (`File`|`Namespace`) -> (`File`|`Namespace`|`TypeDecl`|`Method`)
*   **Other:**
    *   `ARGUMENT`: (`Call`) -> Expression node (Arguments passed to call)
    *   `RECEIVER`: (`Call`) -> Expression node (Object instance for dynamic calls)

**Persistent Entity ID Strategy:**
*   A unique, persistent ID (`id` property) will be assigned to every node and potentially relationships.
*   Strategy TBD in Phase 02, but likely involves hashing relevant node properties (e.g., `path` + `fullName` + `signature` for a Method) or using a stable identifier generation scheme. This is crucial for tracking elements across analyses and enabling reliable incremental updates.

## 6. Next Steps

*   Complete research on alternative CPG tools (Plume, Fraunhofer CPG, CodeQL).
*   Finalize the CPG tool selection based on comprehensive evaluation.
*   Refine the Neo4j schema based on the chosen tool's specific output and capabilities.
*   Proceed to Phase 02: Core Infrastructure & API Design.