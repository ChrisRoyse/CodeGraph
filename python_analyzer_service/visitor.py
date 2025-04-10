# python_analyzer_service/visitor.py
import ast
import logging
import os
from typing import List, Dict, Any, Optional, Tuple

# Import local modules
from . import id_generator
from .scope_manager import ScopeManager
from . import visitor_helpers as helpers # Use alias for clarity

logger = logging.getLogger(__name__)

class CodeAnalyzerVisitor(ast.NodeVisitor):
    """
    Traverses the Python Abstract Syntax Tree (AST) to extract nodes
    (Files, Classes, Functions, Variables, etc.) and relationships
    (CONTAINS, CALLS, IMPORTS, REFERENCES, etc.), generating Global IDs
    and preparing data for database insertion. Uses ScopeManager for
    scope tracking and visitor_helpers for utility functions.
    """
    def __init__(self, relative_path: str, code_content: str):
        self.relative_path: str = relative_path
        self.normalized_path: str = id_generator.normalize_path(relative_path)
        # self.file_id: int = file_id # Removed DB file_id
        self.code_content: str = code_content
        self.language: str = id_generator.LANGUAGE # Should be 'python'

        # Data stores for db_writer
        self.nodes_data: List[Dict[str, Any]] = []
        self.relationships_data: List[Dict[str, Any]] = []

        # Initialize ScopeManager without file_node_id first
        self.scope_manager = ScopeManager(None)
        # Track defined variables/nodes within this visitor run to prevent duplicates
        self.defined_node_ids_in_run: set[str] = set()

        # TODO: Implement a proper symbol table for accurate relationship resolution
        self.import_map: Dict[str, str] = {} # Maps alias -> full module/symbol path

    def _add_node(self, node_type: str, name: str, canonical_identifier: str, ast_node: ast.AST, properties: Optional[Dict[str, Any]] = None) -> str:
        """Creates a node dictionary, generates its Global ID, and adds it to nodes_data."""
        global_id = id_generator.generate_global_id(
            language=self.language,
            relative_path=self.relative_path, # Use original relative path for generation
            canonical_identifier=canonical_identifier
        )
        location = helpers.get_location(ast_node)
        props = properties if properties else {}
        # Ensure 'name' is in properties if provided, otherwise use the name arg
        if 'name' not in props:
             props['name'] = name
        props['canonical_identifier'] = canonical_identifier # Store for reference/debugging
        props['original_node_type'] = type(ast_node).__name__ # Store original AST type

        # Format according to API schema (api_gateway/ingestion_schemas.py -> Node)
        node_dict = {
            "uniqueId": global_id,
            "name": name,
            "filePath": self.relative_path,
            "startLine": location["start_line"], # Use camelCase
            "endLine": location["end_line"],     # Use camelCase
            "language": self.language,           # Added required language field
            "labels": [node_type]                # Added required labels field (using node_type)
            # Removed non-schema fields: node_type, start_column, end_column, properties
            # If extra properties are needed, they should be part of relationships targeting this node.
        }
        # Prevent adding nodes with duplicate Global IDs within the same file analysis run
        if global_id in self.defined_node_ids_in_run:
            logger.debug(f"Skipping duplicate node addition for ID: {global_id} (Type: {node_type}, Name: {name})")
            return global_id # Return existing ID but don't add again

        self.defined_node_ids_in_run.add(global_id)
        self.nodes_data.append(node_dict)
        return global_id

    def _add_relationship(self, source_node_id: str, target_identifier: str, rel_type: str, ast_node: ast.AST, properties: Optional[Dict[str, Any]] = None):
        """Creates a relationship dictionary and adds it to relationships_data."""
        # target_identifier is the canonical identifier or global id of the target
        # This might need resolution later if it's just a name/string
        location = helpers.get_location(ast_node)
        props = properties if properties else {}
        props['original_node_type'] = type(ast_node).__name__

        # Format according to API schema (api_gateway/ingestion_schemas.py -> RelationshipStub)
        rel_dict = {
            "sourceId": source_node_id,
            "targetIdentifier": target_identifier,
            "type": rel_type,
            "properties": props if props else None # Optional properties field (ensure it's None if empty)
            # Removed non-schema fields: start_line, start_column, end_line, end_column
        }
        self.relationships_data.append(rel_dict)

    # --- Visitor Methods ---

    def visit_Module(self, node: ast.Module):
        """Visit the root of the AST (the file itself)."""
        logger.debug(f"Visiting Module: {self.relative_path}")
        file_canonical = id_generator.create_canonical_file(self.normalized_path)
        file_props = {"path": self.relative_path}
        file_global_id = self._add_node("File", os.path.basename(self.relative_path), file_canonical, node, file_props)

        # --- CRITICAL: Update ScopeManager with the file's Global ID ---
        self.scope_manager = ScopeManager(file_global_id)
        # ---

        # Process imports first to populate import_map (basic approach)
        for item in node.body:
            if isinstance(item, (ast.Import, ast.ImportFrom)):
                self.visit(item)
        # Process the rest of the body
        for item in node.body:
             if not isinstance(item, (ast.Import, ast.ImportFrom)):
                self.visit(item)
        logger.debug(f"Finished visiting Module: {self.relative_path}")

    def visit_ClassDef(self, node: ast.ClassDef):
        logger.debug(f"Visiting ClassDef: {node.name}")
        class_canonical = id_generator.create_canonical_class(self.normalized_path, node.name)
        class_props = {
            "bases": [helpers.unparse_safely(b) for b in node.bases],
            "keywords": {kw.arg: helpers.unparse_safely(kw.value) for kw in node.keywords if kw.arg},
            "decorators": [helpers.unparse_safely(d) for d in node.decorator_list],
        }
        class_global_id = self._add_node("Class", node.name, class_canonical, node, class_props)

        parent_scope_id = self.scope_manager.get_current_scope_id()
        if parent_scope_id:
            # Target is the class itself (using its global ID for linking)
            self._add_relationship(parent_scope_id, class_global_id, "CONTAINS", node)

        self.scope_manager.enter_scope(class_global_id, class_canonical, "Class")
        self.generic_visit(node)
        self.scope_manager.exit_scope()
        logger.debug(f"Finished visiting ClassDef: {node.name}")

    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Handles both Functions and Methods."""
        logger.debug(f"Visiting FunctionDef/MethodDef: {node.name}")
        is_method = self.scope_manager.is_in_class_scope()
        node_type = "Method" if is_method else "Function"
        class_canonical = self.scope_manager.get_current_class_canonical() if is_method else None
        class_name = class_canonical.split('(')[0] if class_canonical else None # Extract class name

        # Extract parameter names and type hints
        param_details = []
        param_types = [] # For canonical ID
        for arg in node.args.args:
            param_name = arg.arg
            type_hint = helpers.unparse_safely(arg.annotation) if arg.annotation else "Any" # Default to Any if no hint
            param_details.append({"name": param_name, "type_hint": type_hint})
            param_types.append(type_hint)

        func_canonical = id_generator.create_canonical_function(
            normalized_file_path=self.normalized_path,
            function_name=node.name,
            param_types=param_types,
            class_name=class_name
        )
        return_type = helpers.unparse_safely(node.returns)
        signature = f"({', '.join(p['name'] for p in param_details)})"
        if return_type:
            signature += f" -> {return_type}"

        func_props = {
            "signature": signature,
            "parameters": param_details,
            "return_type": return_type,
            "decorators": [helpers.unparse_safely(d) for d in node.decorator_list],
            "is_async": isinstance(node, ast.AsyncFunctionDef),
            "is_method": is_method,
        }
        func_global_id = self._add_node(node_type, node.name, func_canonical, node, func_props)

        parent_scope_id = self.scope_manager.get_current_scope_id()
        if parent_scope_id:
            self._add_relationship(parent_scope_id, func_global_id, "CONTAINS", node)

        self.scope_manager.enter_scope(func_global_id, func_canonical, node_type)
        # Visit function body
        for item in node.body:
            self.visit(item)
        self.scope_manager.exit_scope()
        logger.debug(f"Finished visiting FunctionDef/MethodDef: {node.name}")

    visit_AsyncFunctionDef = visit_FunctionDef # Alias for async functions

    def visit_Assign(self, node: ast.Assign):
        """Visit an assignment statement (e.g., x = 1, self.y = obj)."""
        logger.debug(f"Visiting Assign at line {node.lineno}")
        value_str = helpers.unparse_safely(node.value)
        value_type = type(node.value).__name__
        current_scope_path = self.scope_manager.get_current_scope_path() # Get ClassName::MethodName etc.

        for target in node.targets:
            var_name = helpers.unparse_safely(target)
            if not var_name or var_name == "<?>": continue

            is_attribute = isinstance(target, ast.Attribute)
            node_type = "Attribute" if is_attribute else "Variable"

            # Generate canonical ID using scope path
            var_canonical = id_generator.create_canonical_variable(
                normalized_file_path=self.normalized_path,
                variable_name=var_name,
                scope_path=current_scope_path # Pass the constructed scope path
            )
            var_props = {
                "value_snippet": value_str[:100], # Limit snippet size
                "value_node_type": value_type,
                "is_attribute": is_attribute,
                "assignment_type": "simple",
            }
            var_global_id = self._add_node(node_type, var_name, var_canonical, target, var_props)

            parent_scope_id = self.scope_manager.get_current_scope_id()
            if parent_scope_id:
                self._add_relationship(parent_scope_id, var_global_id, "CONTAINS", target)

            # TODO: Add relationship from variable to the value (requires symbol table)

        # Visit the value part of the assignment
        self.visit(node.value)

    def visit_AnnAssign(self, node: ast.AnnAssign):
        """Visit an annotated assignment (e.g., x: int = 5 or y: str)."""
        logger.debug(f"Visiting AnnAssign at line {node.lineno}")
        target = node.target
        var_name = helpers.unparse_safely(target)
        if not var_name or var_name == "<?>":
             if node.value: self.visit(node.value) # Still visit value if target is complex
             self.visit(node.annotation)
             return

        is_attribute = isinstance(target, ast.Attribute)
        node_type = "Attribute" if is_attribute else "Variable"
        type_hint_str = helpers.unparse_safely(node.annotation)
        value_str = helpers.unparse_safely(node.value) if node.value else "<No Value>"
        value_type = type(node.value).__name__ if node.value else "None"
        current_scope_path = self.scope_manager.get_current_scope_path() # Get ClassName::MethodName etc.

        # Generate canonical ID using scope path
        var_canonical = id_generator.create_canonical_variable(
             normalized_file_path=self.normalized_path,
             variable_name=var_name,
             scope_path=current_scope_path # Pass the constructed scope path
        )
        var_props = {
            "type_hint": type_hint_str,
            "value_snippet": value_str[:100],
            "value_node_type": value_type,
            "is_attribute": is_attribute,
            "assignment_type": "annotated",
        }
        var_global_id = self._add_node(node_type, var_name, var_canonical, target, var_props)

        parent_scope_id = self.scope_manager.get_current_scope_id()
        if parent_scope_id:
            self._add_relationship(parent_scope_id, var_global_id, "CONTAINS", target)

        # Visit annotation and value
        self.visit(node.annotation)
        if node.value:
            self.visit(node.value)
            # TODO: Add relationship from variable to value node if possible

    def visit_Name(self, node: ast.Name):
        """Visit a variable name usage (loading)."""
        # Only create relationships for loads, definitions are handled elsewhere
        if isinstance(node.ctx, ast.Load):
            logger.debug(f"Visiting Name (Load): {node.id} at {node.lineno}")
            parent_scope_id = self.scope_manager.get_current_scope_id()
            if parent_scope_id:
                 # Create a canonical identifier for the *potential* variable being referenced.
                 # This requires resolving the scope where node.id is defined.
                 # For now, create a plausible canonical ID based on current scope.
                 # A second pass or symbol table is needed for accuracy.
                 # Speculative canonical ID generation for the referenced variable
                 # Determine potential scope path
                 potential_scope_path = self.scope_manager.get_current_scope_path() # Get ClassName::MethodName etc.
                 target_canonical = id_generator.create_canonical_variable(
                     normalized_file_path=self.normalized_path,
                     variable_name=node.id,
                     scope_path=potential_scope_path
                 )
                 # Generate the potential target Global ID (won't match if var is defined elsewhere)
                 target_potential_gid = id_generator.generate_global_id(self.language, self.relative_path, target_canonical)

                 # Add a 'REFERENCES' relationship. The target_identifier should be the variable NAME itself.
                 # The resolver will look up this name in the appropriate scope.
                 self._add_relationship(parent_scope_id, node.id, "REFERENCES", node, {"variable_name": node.id})
        # Continue traversal in case the name is part of a larger expression
        self.generic_visit(node)


    def visit_Call(self, node: ast.Call):
        """Visit a function or method call."""
        call_target_str = helpers.unparse_safely(node.func)
        logger.debug(f"Visiting Call: {call_target_str} at {node.lineno}")

        # Determine call type and relationship type based on heuristics
        call_type = "FunctionCall"
        rel_type = "CALLS"
        properties = {
            "call_target_string": call_target_str,
            "args_count": len(node.args),
            "keywords_count": len(node.keywords),
            "is_method_call": isinstance(node.func, ast.Attribute), # Basic check
        }
        for pattern in helpers.API_CALL_PATTERNS:
            if pattern.match(call_target_str):
                call_type = "ApiCall"
                rel_type = "CALLS_API" # More specific relationship
                url_hint = helpers.extract_string_arg(node, 0)
                if url_hint: properties["api_url_hint"] = url_hint[:200]
                logger.debug(f"Identified potential API call: {call_target_str}")
                break
        if call_type == "FunctionCall": # Only check DB if not already API
            for pattern in helpers.DB_CALL_PATTERNS:
                if pattern.match(call_target_str):
                    call_type = "DatabaseQuery"
                    rel_type = "QUERIES_DB" # More specific relationship
                    query_str = helpers.extract_string_arg(node, 0)
                    if query_str: properties["db_query_string"] = query_str[:500]
                    logger.debug(f"Identified potential DB query call: {call_target_str}")
                    break

        # Determine the calling scope (function, method, class, or file)
        parent_scope_id = self.scope_manager.get_current_scope_id()

        # Create a direct relationship from the caller to the callee identifier.
        # The resolver will later attempt to link this identifier to a specific node.
        if parent_scope_id:
            # Use the determined rel_type (CALLS, CALLS_API, QUERIES_DB)
            # The target_identifier is the string name of the function/method being called.
            self._add_relationship(parent_scope_id, call_target_str, rel_type, node, properties)
        else:
             logger.warning(f"Could not determine parent scope for call '{call_target_str}' at {node.lineno}:{node.col_offset} in {self.relative_path}")

        # Removed the creation of an intermediate node for the call itself.
        # Removed the relationship linking the call instance to the target identifier ("CALLS_TARGET").


        # Visit arguments and function expression
        self.visit(node.func)
        for arg in node.args:
            self.visit(arg)
        for kw in node.keywords:
            self.visit(kw.value)

        logger.debug(f"Finished visiting Call: {call_target_str}")


    def visit_Import(self, node: ast.Import):
        """Visit an import statement (e.g., import os, sys)."""
        logger.debug(f"Visiting Import at line {node.lineno}")
        # snippet = helpers.get_code_snippet(self.code_content, node) # Optional
        for alias in node.names:
            module_name = alias.name
            alias_name = alias.asname
            # Use module name as the imported identifier for canonical ID
            import_canonical = id_generator.create_canonical_import(self.normalized_path, module_name, module_name)
            props = {"module": module_name, "import_type": "module"}
            if alias_name:
                props["alias"] = alias_name
                self.import_map[alias_name] = module_name # Map alias to module
            else:
                self.import_map[module_name] = module_name # Map name to itself

            import_global_id = self._add_node("Import", module_name, import_canonical, alias, props)

            file_node_id = self.scope_manager.get_current_scope_id() # Should be file ID here
            if file_node_id:
                 # Target identifier should be the MODULE NAME for resolution.
                 self._add_relationship(file_node_id, module_name, "IMPORTS", node, {"import_type": "module"})

    def visit_ImportFrom(self, node: ast.ImportFrom):
        """Visit a from ... import statement (e.g., from os import path)."""
        logger.debug(f"Visiting ImportFrom: from {node.module} at line {node.lineno}")
        # snippet = helpers.get_code_snippet(self.code_content, node) # Optional
        module_source = node.module if node.module else ""
        level = node.level
        # Construct base path for relative imports if needed (simplistic)
        relative_prefix = "." * level
        source_path_for_id = f"{relative_prefix}{module_source}" if level > 0 else module_source

        for alias in node.names:
            imported_name = alias.name
            alias_name = alias.asname

            # Canonical ID uses the specific imported name, the source path, and the file it's in
            import_canonical = id_generator.create_canonical_import(self.normalized_path, imported_name, source_path_for_id)

            # Store mapping from alias/name to a potential full path
            full_import_path = f"{source_path_for_id}.{imported_name}" if source_path_for_id else imported_name
            self.import_map[alias_name if alias_name else imported_name] = full_import_path

            props = {
                "source_module": module_source,
                "imported_name": imported_name,
                "level": level,
                "import_type": "from"
            }
            if alias_name: props["alias"] = alias_name

            import_global_id = self._add_node("Import", imported_name, import_canonical, alias, props)

            file_node_id = self.scope_manager.get_current_scope_id() # Should be file ID here
            if file_node_id:
                 # Target identifier should be the specific IMPORTED NAME or the full path for resolution.
                 # RESOLVER FIX: Use the module path (source_path_for_id) as the target identifier for IMPORTS,
                 # as the resolver links to the imported *file*, not the specific symbol.
                 self._add_relationship(file_node_id, source_path_for_id, "IMPORTS", node, {"import_type": "from", "imported_name": imported_name})

    # Add generic visit to ensure all nodes are visited if specific visitors are missing
    def generic_visit(self, node):
        """Called if no explicit visitor function exists for a node."""
        # logger.debug(f"Generic visit: {type(node).__name__}")
        super().generic_visit(node)

    def get_results(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Returns the collected nodes and relationships data.
        Node de-duplication is now handled within _add_node.
        """
        return self.nodes_data, self.relationships_data