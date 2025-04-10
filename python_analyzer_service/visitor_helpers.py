# python_analyzer_service/visitor_helpers.py
import ast
import logging
import re
from typing import Dict, Optional, List, Any

logger = logging.getLogger(__name__)

# --- Constants for Heuristics ---
API_CALL_PATTERNS: List[re.Pattern] = [
    re.compile(r'.*\.requests\.(get|post|put|delete|patch|head|options)'),
    re.compile(r'.*\.urllib\.request\.urlopen'),
    re.compile(r'.*aiohttp\.ClientSession\.(get|post|put|delete|patch|head|options)'),
    re.compile(r'.*httpx\.(get|post|put|delete|patch|head|options)'),
    re.compile(r'.*Flask\.route'),
    re.compile(r'.*FastAPI\.(get|post|put|delete|patch|head|options)'),
    re.compile(r'.*django\.urls\.path'),
    re.compile(r'.*django\.urls\.re_path'),
]
DB_CALL_PATTERNS: List[re.Pattern] = [
    re.compile(r'.*\.cursor\.execute'),
    re.compile(r'.*\.connection\.execute'),
    re.compile(r'.*sqlalchemy\.orm\.Session\.query'),
    re.compile(r'.*sqlalchemy\.orm\.Session\.execute'),
    re.compile(r'.*sqlalchemy\.engine\.Connection\.execute'),
    re.compile(r'.*django\.db\.models\.Manager\.(filter|get|create|update|delete|all|count|aggregate|annotate)'),
    re.compile(r'.*django\.db\.connection\.cursor\.execute'),
    re.compile(r'.*psycopg2\..*\.execute'),
    re.compile(r'.*sqlite3\..*\.execute'),
    re.compile(r'.*mysql\.connector\..*\.execute'),
]

# --- Helper Functions ---

def get_location(node: ast.AST) -> Dict[str, Optional[int]]:
    """Extracts start/end line/column from an AST node."""
    if isinstance(node, ast.Module):
        # Module represents the whole file, default to start
        # Attempt to get end line from the last statement if possible
        end_line = node.body[-1].end_lineno if node.body and hasattr(node.body[-1], 'end_lineno') else 1
        end_col = node.body[-1].end_col_offset if node.body and hasattr(node.body[-1], 'end_col_offset') else 0
        return {
            "start_line": 1,
            "start_column": 0,
            "end_line": end_line,
            "end_column": end_col
        }
    else:
        # For other nodes, attempt to get location attributes
        start_line = getattr(node, 'lineno', None)
        start_col = getattr(node, 'col_offset', None)
        end_line = getattr(node, 'end_lineno', start_line) # Default end_line to start_line if missing
        end_col = getattr(node, 'end_col_offset', start_col) # Default end_col to start_col if missing
        return {
            "start_line": start_line,
            "start_column": start_col,
            "end_line": end_line,
            "end_column": end_col
        }

def get_code_snippet(code_content: str, node: ast.AST) -> str:
    """Extracts the code snippet for an AST node."""
    try:
        lines = code_content.splitlines()
        start_line = node.lineno - 1
        end_line = getattr(node, 'end_lineno', node.lineno) - 1
        start_col = node.col_offset
        end_col = getattr(node, 'end_col_offset', -1)

        if start_line < 0 or start_line >= len(lines):
             return f"<Error: Start line {node.lineno} out of bounds>"
        if end_line < 0 or end_line >= len(lines):
             end_line = len(lines) - 1
             end_col = -1 # Unknown end column if end line was adjusted

        # Ensure end_line is not before start_line
        if end_line < start_line:
            end_line = start_line
            end_col = -1 # Reset end column if lines were adjusted

        if start_line == end_line:
            line = lines[start_line]
            # Use max(start_col, 0) to handle potential negative offsets from AST?
            effective_start_col = max(start_col, 0)
            effective_end_col = end_col if end_col >= effective_start_col else len(line)
            return line[effective_start_col:effective_end_col]
        else:
            snippet_lines = []
            # Handle start line
            snippet_lines.append(lines[start_line][max(start_col, 0):])
            # Handle intermediate lines
            for i in range(start_line + 1, end_line):
                 if i < len(lines):
                    snippet_lines.append(lines[i])
            # Handle end line
            if end_line < len(lines):
                line = lines[end_line]
                effective_end_col = end_col if end_col >= 0 else len(line)
                snippet_lines.append(line[:effective_end_col])
            return "\n".join(snippet_lines)
    except Exception as e:
        logger.warning(f"Error getting code snippet for node at {node.lineno}:{node.col_offset}: {e}", exc_info=True)
        return "<Error extracting snippet>"


def unparse_safely(node: Optional[ast.AST]) -> str:
    """Safely unparses an AST node, returning '' on failure or if node is None."""
    if node is None:
        return ""
    try:
        # Prefer ast.unparse if available (Python 3.9+)
        if hasattr(ast, 'unparse'):
            return ast.unparse(node)
        else:
            # Basic fallback for older Python versions
            if isinstance(node, ast.Name): return node.id
            if isinstance(node, ast.Constant): return repr(node.value) # Handles strings, numbers, bools, None
            if isinstance(node, ast.Attribute): return f"{unparse_safely(node.value)}.{node.attr}"
            # Add more fallbacks as needed
            return "<?>" # Indicate unparse failure
    except Exception:
        logger.debug(f"Could not unparse node: {type(node)}", exc_info=True)
        return "<?>"

def extract_string_arg(node: ast.Call, arg_index: int = 0) -> Optional[str]:
    """Attempts to extract a literal string argument from a call node."""
    # Check positional arguments
    if len(node.args) > arg_index:
        arg = node.args[arg_index]
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            return arg.value
        # Deprecated Str node for older Python versions
        elif hasattr(ast, 'Str') and isinstance(arg, ast.Str):
             return arg.s # type: ignore

    # Check keyword arguments (less reliable for position)
    for kw in node.keywords:
        if isinstance(kw.value, ast.Constant) and isinstance(kw.value, str):
            return kw.value.value
        elif hasattr(ast, 'Str') and isinstance(kw.value, ast.Str):
             return kw.value.s # type: ignore
    return None