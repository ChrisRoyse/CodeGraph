# codebase-graph-server Tools

This document provides an overview of the tools available through the `codebase-graph-server` MCP server. This server analyzes the codebase to build a graph representation and provides tools to query and understand the code's structure, dependencies, and potential issues.

## Available Tools

*   **`list_module_dependencies`**: List direct dependencies (imports) for a given file or directory.
*   **`find_circular_dependencies`**: Detects circular import dependencies between files in the codebase.
*   **`get_dependency_tree`**: Visualize the dependency tree (imports) starting from a specific file.
*   **`find_most_connected_nodes`**: Identifies nodes (Functions, Methods, Classes, etc.) with the highest number of incoming/outgoing relationships (excluding CONTAINS).
*   **`find_complex_files`**: Finds files containing nodes with the most complex relationship structures (highest average degree of contained nodes).
*   **`find_high_fan_in_out_nodes`**: Locates classes, functions, or methods with excessive responsibilities (high fan-in/fan-out, excluding CONTAINS).
*   **`detect_layer_violations`**: Detects violations of specified architectural layering constraints based on inferred domains.
*   **`find_unauthorized_dependencies`**: Finds dependencies (imports, calls, uses) from a source domain to a target domain.
*   **`find_code_by_domain`**: Find all code elements (Files, Classes, Functions, etc.) associated with a specific domain concept.
*   **`trace_concept_implementation`**: Trace how a concept (starting from a specific node) is implemented by following relevant relationships.
*   **`find_related_code`**: Finds related code fragments using semantic similarity search, with optional filtering by kind and domain.
*   **`find_semantically_similar_nodes`**: Finds code nodes (functions, classes, etc.) with embeddings semantically similar to the query text.
*   **`find_affected_by_change`**: Identify all code elements potentially affected by changing a specific component (traces incoming dependencies).
*   **`find_interface_ripple_effect`**: Finds ripple effects of modifying an interface (implementing classes and their dependents).
*   **`find_downstream_dependents`**: Discover which parts of the system rely on a particular functionality (traces outgoing dependencies).
*   **`analyzecodebase`**: Provides the command to run in the terminal to perform a full codebase re-analysis, resetting the database and updating the schema.
*   **`ping_server`**: A simple tool to check if the MCP server is running and responsive.
*   **`generate_codebase_overview`**: Generates a comprehensive Markdown overview of the codebase graph, including node/relationship stats, complexity metrics, and potential issues.
*   **`get_node_context`**: Gathers comprehensive context for a specific code node, including its properties and its 2-hop neighborhood (nodes and relationships).