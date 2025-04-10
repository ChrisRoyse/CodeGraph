# python_analyzer_service/id_generator.py

import hashlib
import os
from typing import List, Optional

LANGUAGE = "python"

def normalize_path(relative_path: str) -> str:
    """
    Normalizes a relative file path.

    - Uses forward slashes.
    - Removes leading './'.
    - Converts to lowercase.
    """
    normalized = relative_path.replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized.lower()

def create_canonical_file(normalized_relative_path: str) -> str:
    """Creates the canonical identifier for a file. It's simply the normalized path."""
    # Ensure path starts with / if it's not already absolute (it should be relative to repo root)
    if not normalized_relative_path.startswith('/'):
        return f"/{normalized_relative_path}"
    return normalized_relative_path

def create_canonical_class(normalized_file_path: str, class_name: str) -> str:
    """Creates the canonical identifier for a class, interface, enum, etc.
    Format: /path/to/file.ext#ClassName
    """
    return f"{normalized_file_path}#{class_name}"

def create_canonical_function(
    function_name: str,
    normalized_file_path: str,
    param_types: Optional[List[str]] = None, # Use type hints if available
    class_name: Optional[str] = None # Removed duplicate param_names
) -> str:
    """
    Creates the canonical identifier for a function or method.
    Includes parameter types for better uniqueness (handles overloading).
    Format: /path/file.ext#FunctionName(paramType1,paramType2)
            /path/file.ext#ClassName::MethodName(paramType1,paramType2)
    """
    # Use 'Any' if type information is missing
    param_types_str = ",".join(param_types) if param_types else ""
    signature_string = f"({param_types_str})"

    if class_name:
        # Method
        return f"{normalized_file_path}#{class_name}::{function_name}{signature_string}"
    else:
        # Function
        return f"{normalized_file_path}#{function_name}{signature_string}"

def create_canonical_variable(
    variable_name: str,
    normalized_file_path: str,
    scope_path: Optional[str] = None # e.g., ClassName or ClassName::MethodName. Removed duplicate scope_identifier
) -> str:
    """
    Creates the canonical identifier for a variable or property.
    Format: /path/file.ext#VariableName (for module scope)
            /path/file.ext#ScopePath.VariableName (for local/class scope)
    """
    if scope_path:
        # Local variable within function/method or class attribute
        return f"{normalized_file_path}#{scope_path}.{variable_name}"
    else:
        # Module-level variable
        return f"{normalized_file_path}#{variable_name}"

def create_canonical_import(
    normalized_file_path: str, # File where the import occurs
    imported_identifier: str, # The name being imported (e.g., 'path' or 'MyClass')
    source_module: str # The module/path it's imported from (e.g., 'os' or './utils')
) -> str:
    """
    Creates the canonical identifier for an import statement node itself.
    Format: /path/file.ext#IMPORT:ImportedIdentifier@SourceModule
    """
    # Normalize source module path slightly for consistency if needed
    normalized_source = source_module.replace('"', '').replace("'", "") # Remove quotes
    return f"{normalized_file_path}#IMPORT:{imported_identifier}@{normalized_source}"


def generate_global_id(
    language: str,
    relative_path: str,
    canonical_identifier: str
) -> str:
    """
    Generates a Global ID based on the defined strategy.

    Format: lang:sha256(normalized_relative_path:canonical_identifier)
    """
    # The canonical_identifier now contains the normalized path and element details
    input_string = canonical_identifier

    # Ensure consistent encoding before hashing
    encoded_string = input_string.encode('utf-8')
    hash_object = hashlib.sha256(encoded_string)
    hash_hex = hash_object.hexdigest()

    return f"{language}:{hash_hex}"

# --- TDD Anchor ---
# TODO: Implement unit tests for all canonical identifier functions and generate_global_id.
# Example test cases:
# - Path normalization (Windows/Linux separators, leading './')
# - Canonical identifiers for functions, methods, classes, variables, imports
# - Global ID generation consistency
# - Edge cases (empty params, complex scope identifiers)

if __name__ == '__main__':
    # Example Usage (for basic testing)
    test_path = "./src\\utils/helpers.py"
    norm_path = normalize_path(test_path)
    print(f"Normalized Path: {norm_path}")

    file_canon = create_canonical_file(norm_path)
    file_gid = generate_global_id(LANGUAGE, test_path, file_canon)
    print(f"File Canonical: {file_canon}")
    print(f"File GID: {file_gid}")

    class_canon = create_canonical_class("MyHelperClass")
    class_gid = generate_global_id(LANGUAGE, test_path, class_canon)
    print(f"Class Canonical: {class_canon}")
    print(f"Class GID: {class_gid}")

    func_canon = create_canonical_function("process_data", ["item", "config"])
    func_gid = generate_global_id(LANGUAGE, test_path, func_canon)
    print(f"Function Canonical: {func_canon}")
    print(f"Function GID: {func_gid}")

    method_canon = create_canonical_function("load_settings", ["self", "filename"], class_name="MyHelperClass")
    method_gid = generate_global_id(LANGUAGE, test_path, method_canon)
    print(f"Method Canonical: {method_canon}")
    print(f"Method GID: {method_gid}")

    var_scope = func_canon # Use function canonical as scope example
    var_canon = create_canonical_variable("temp_result", normalized_file_path=norm_path, scope_identifier=var_scope)
    var_gid = generate_global_id(LANGUAGE, test_path, var_canon)
    print(f"Variable Canonical: {var_canon}")
    print(f"Variable GID: {var_gid}")

    import_canon = create_canonical_import("HelperUtil", "./internal/utils")
    import_gid = generate_global_id(LANGUAGE, test_path, import_canon)
    print(f"Import Canonical: {import_canon}")
    print(f"Import GID: {import_gid}")

    import_canon_abs = create_canonical_import("os", "os")
    import_gid_abs = generate_global_id(LANGUAGE, test_path, import_canon_abs)
    print(f"Import Absolute Canonical: {import_canon_abs}")
    print(f"Import Absolute GID: {import_gid_abs}")