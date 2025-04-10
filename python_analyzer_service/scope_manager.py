# python_analyzer_service/scope_manager.py
import logging
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)

class ScopeManager:
    """Manages the scope stack during AST traversal."""

    def __init__(self, file_node_id: Optional[str]):
        """
        Initializes the ScopeManager.

        Args:
            file_node_id: The Global ID of the file node, representing the outermost scope.
        """
        self._file_node_id: Optional[str] = file_node_id
        # Stack stores tuples: (global_id, canonical_identifier, node_type)
        self._scope_stack: List[Tuple[str, str, str]] = []
        logger.debug(f"ScopeManager initialized with file_node_id: {file_node_id}")

    def enter_scope(self, global_id: str, canonical_identifier: str, node_type: str):
        """Enters a new scope (e.g., Class, Function, Method)."""
        self._scope_stack.append((global_id, canonical_identifier, node_type))
        logger.debug(f"Entered scope: {node_type} ({canonical_identifier}) - ID: {global_id}")

    def exit_scope(self):
        """Exits the current scope."""
        if self._scope_stack:
            exited_scope = self._scope_stack.pop()
            logger.debug(f"Exited scope: {exited_scope[2]} ({exited_scope[1]})")
        else:
            logger.warning("Attempted to exit scope, but stack is empty.")

    def get_current_scope_id(self) -> Optional[str]:
        """Returns the Global ID of the current scope."""
        if self._scope_stack:
            return self._scope_stack[-1][0]
        return self._file_node_id # Fallback to file scope

    def get_current_scope_canonical(self) -> Optional[str]:
        """Returns the canonical identifier of the current scope."""
        if self._scope_stack:
            return self._scope_stack[-1][1]
        return None # No specific canonical ID for the implicit file scope itself

    def get_current_scope_type(self) -> Optional[str]:
        """Returns the node type string of the current scope."""
        if self._scope_stack:
            return self._scope_stack[-1][2]
        return "File" # Implicit type for the outermost scope

    def get_current_scope_tuple(self) -> Optional[Tuple[str, str, str]]:
         """Returns the full tuple for the current scope."""
         if self._scope_stack:
             return self._scope_stack[-1]
         return None

    def is_in_class_scope(self) -> bool:
        """Checks if the current scope is directly within a Class."""
        return self.get_current_scope_type() == "Class"

    def get_current_class_canonical(self) -> Optional[str]:
        """Finds the canonical identifier of the nearest enclosing class scope."""
        for scope in reversed(self._scope_stack):
            if scope[2] == "Class":
                return scope[1]
        return None

    def get_current_scope_path(self) -> Optional[str]:
        """Constructs a path string representing the current scope hierarchy.

        Returns:
            A string like 'ClassName::MethodName' or 'FunctionName', or None if only in file scope.
        """
        if not self._scope_stack:
            return None # Only file scope

        path_parts = []
        for _id, canonical_id, node_type in self._scope_stack:
            # Extract the core name from the canonical ID
            # Assumes canonical IDs like 'type:ClassName', 'FunctionName(#params)', 'ClassName.MethodName(#params)'
            name_part = canonical_id
            if ':' in name_part:
                name_part = name_part.split(':', 1)[1] # Remove prefix like 'type:'
            if '(' in name_part:
                name_part = name_part.split('(', 1)[0] # Remove parameters
            if '.' in name_part and node_type == "Method": # Handle old method format if present
                 name_part = name_part.split('.', 1)[1]

            path_parts.append(name_part)

        return "::".join(path_parts) # Join with :: separator
