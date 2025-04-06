# Phase 05: Verification Framework & Accuracy Testing

**Version:** 1.0
**Date:** 2025-04-05

## 1. Goals

*   Establish a rigorous process for verifying the 100% accuracy of the generated Neo4j CPG representation against the source code.
*   Create a diverse suite of "dummy" test files covering various language constructs for the pilot language (Python) and future languages.
*   Define the exact expected Neo4j graph structure (nodes, relationships, properties, entity IDs) corresponding to each test file.
*   Develop and implement an automated verification framework using Cypher queries and programmatic checks.
*   Integrate the verification framework into a testing suite to be run after initial population and incremental updates.
*   Iteratively refine CPG generation and ingestion logic based on verification results until 100% accuracy is achieved for the test suite.

## 2. Test File Suite Creation

*   **Strategy:** Create small, focused source code files (initially Python) that exercise specific language features and potential edge cases relevant to CPG construction.
*   **Examples of Constructs to Cover:**
    *   Basic file/module structure
    *   Function definitions (with/without parameters, different return types)
    *   Class definitions (inheritance, members, methods)
    *   Variable declarations (local, global, instance)
    *   Control flow (if/else, for/while loops, break/continue)
    *   Function/method calls (static, dynamic/instance)
    *   Imports/dependencies
    *   Literals (strings, numbers, booleans, lists, dicts)
    *   Complex expressions
    *   Comments (should generally be ignored or handled specifically)
    *   Decorators (Python)
*   **Organization:** Store test files in a dedicated directory (e.g., `test/verification_files/python/`).

## 3. Defining Expected Graph Structures

*   **Process:** For *each* test file created in step 2, manually derive and document the precise expected Neo4j graph representation.
*   **Format:** This can be documented in a structured format (e.g., YAML, JSON, or even Markdown tables) alongside the test file.
*   **Content:** The definition must include:
    *   Expected Node Counts: Total count for each label (`File`, `Method`, `Call`, etc.).
    *   Expected Relationship Counts: Total count for each type (`CONTAINS`, `CALLS`, `FLOWS_TO`, etc.).
    *   Specific Nodes: List key nodes with their expected `entityId` and critical properties (name, path, line, signature, etc.).
    *   Specific Relationships: List key relationships defining source/target `entityId`s, type, and critical properties.
*   **Example (Conceptual for a simple Python file):**
    *   **File:** `test/verification_files/python/simple_func.py`
    *   **Expected Nodes:**
        *   `File`: 1 (entityId: hash('.../simple_func.py'), name: 'simple_func.py')
        *   `Method`: 1 (entityId: hash('.../simple_func.py:add'), name: 'add', signature: 'add(a, b)')
        *   `Parameter`: 2 (entityId: hash('...:add:a:0'), name: 'a'; entityId: hash('...:add:b:1'), name: 'b')
        *   `Local`: 1 (entityId: hash('...:add:result:3'), name: 'result')
        *   `Identifier`: 3 (for 'a', 'b', 'result' usage)
        *   `Literal`: 0
        *   `ControlStructure`: 0
        *   `Call`: 0
    *   **Expected Relationships:**
        *   `CONTAINS`: (File) -> (Method)
        *   `CONTAINS`: (Method) -> (Parameter 'a'), (Method) -> (Parameter 'b'), (Method) -> (Local 'result')
        *   `PARAMETER_LINK`: (Parameter 'a') -> (Method), (Parameter 'b') -> (Method)
        *   `LOCAL_LINK`: (Local 'result') -> (Method)
        *   `AST`: Various parent-child relationships.
        *   `REACHES`: (Parameter 'a') -> (Identifier 'a'), (Parameter 'b') -> (Identifier 'b'), (Local 'result') -> (Identifier 'result')
        *   `REF`: (Identifier 'a') -> (Parameter 'a'), (Identifier 'b') -> (Parameter 'b'), (Identifier 'result') -> (Local 'result')
        *   `FLOWS_TO`: Edges representing control flow within the 'add' function.

## 4. Verification Framework Implementation

*   **Approach:** Combine Cypher queries for structural checks and programmatic comparisons for detailed property validation.
*   **Technology:** Use a testing framework (e.g., `pytest` for Python) and the Neo4j driver.
*   **Components:**
    1.  **Test Runner:** Orchestrates the execution of verification tests for each file in the test suite.
    2.  **Expected State Loader:** Parses the documented expected graph structure for a given test file.
    3.  **Cypher Query Executor:** Runs predefined Cypher queries against the actual Neo4j graph generated for the test file.
        *   **Queries for Counts:** Verify node/relationship counts match expected values.
        *   **Queries for Existence:** Verify specific nodes/relationships exist based on `entityId` and key properties.
        *   **Queries for Structure:** Verify specific paths or patterns (e.g., `MATCH (f:File)-[:CONTAINS]->(m:Method {name:'add'}) RETURN count(m) > 0`).
    4.  **Programmatic Comparator:**
        *   Fetches relevant graph portions from Neo4j using the driver (e.g., get all nodes/relationships related to a specific file `entityId`).
        *   Compares the properties of fetched nodes/relationships against the expected properties defined for the test file. Performs deep comparison of property values.
    5.  **Assertion Engine:** Uses the testing framework's assertion capabilities (`assert count == expected_count`, `assert node.properties == expected_properties`) to report success or failure. Detailed failure messages are crucial.

## 5. Integration and Iteration

*   **Workflow:**
    1.  Run the Orchestrator's initial population (Phase 04) or incremental update (Phase 06) for a test file.
    2.  Execute the verification test suite against the resulting graph state in Neo4j.
    3.  Analyze any failures reported by the assertion engine.
    4.  Debug and refine the CPG generation logic in the relevant Language Parser Service or the ingestion logic in the Orchestrator Service.
    5.  Repeat steps 1-4 until all verification tests pass for the file.
    6.  Expand the test suite with more files and repeat the process.
*   **Automation:** Integrate the verification suite into the CI/CD pipeline to run automatically after changes to the CPG generation or ingestion code.

## 6. Deliverables

*   A suite of dummy source code files (`test/verification_files/`).
*   Documentation defining the expected Neo4j graph structure for each test file.
*   Source code for the automated verification framework (test runner, Cypher queries, programmatic comparator).
*   Integration with a testing framework (`pytest` or similar).
*   Documentation (within this file) detailing the framework design, test cases, and the process for running verification.
*   Initial accuracy results and evidence of iterative refinement based on test failures.

## 7. Next Steps

*   Create the initial set of Python dummy test files.
*   Define the expected graph structures for these files.
*   Implement the verification framework components.
*   Integrate the framework with `pytest`.
*   Run initial verification tests against the graph populated in Phase 04 and begin the refinement cycle.
*   Proceed to Phase 06: Incremental Update Implementation, ensuring verification tests are run after updates.