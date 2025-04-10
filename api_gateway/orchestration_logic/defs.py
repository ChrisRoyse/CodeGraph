# api_gateway/orchestration_logic/defs.py
import logging
from typing import Dict, List, Tuple, Any, Optional, Set, DefaultDict
from collections import defaultdict

# --- gRPC Imports ---
# Assuming generate_grpc.sh has been run and generated files are accessible
try:
    from generated.src import analyzer_pb2, neo4j_ingestion_pb2
    GRPC_MODULES_LOADED = True
except ImportError as e:
    logging.error(f"Orchestration Defs: Could not import generated gRPC modules: {e}")
    GRPC_MODULES_LOADED = False
    analyzer_pb2 = None
    neo4j_ingestion_pb2 = None

# --- Type Definitions ---
LocalKey = Tuple[str, str, int] # (analyzer_name, file_path, local_id)
GlobalId = str
NodeRegistry = Dict[LocalKey, analyzer_pb2.Node]
RelationshipMap = DefaultDict[LocalKey, List[analyzer_pb2.Relationship]]
CandidateRegistry = DefaultDict[str, List[LocalKey]]
ImportInfo = Dict[LocalKey, Dict[str, str]] # source_key -> {alias/symbol: imported_path_or_symbol} - Needs Refinement
DefinitionRegistry = Dict[GlobalId, LocalKey] # Resolved global_id -> local_key
ResolvedTargetMap = Dict[Tuple[LocalKey, int], GlobalId] # (source_key, target_local_id) -> resolved_target_global_id

# --- Type Mapping Constants ---
NODE_TYPE_MAP: Dict[str, str] = {
    # Core Types
    "File": "File", "FunctionDefinition": "Function", "ClassDefinition": "Class",
    "MethodDefinition": "Method", "VariableDeclaration": "Variable", "Import": "Import",
    "Parameter": "Parameter", "Module": "Module", "InterfaceDefinition": "Interface",
    "EnumDefinition": "Enum", "StructDefinition": "Struct", "TypeAlias": "TypeAlias",
    # Hint Types
    "ApiEndpointHint": "ApiEndpoint", "DatabaseTableHint": "Table", "DatabaseColumnHint": "Column",
    "ExternalUrlHint": "ExternalUrl", "EnvironmentVariableHint": "EnvironmentVariable",
    "ApiCallHint": "ApiCall", "DatabaseQueryHint": "DatabaseQuery",
    # Generic/Fallback
    "CodeIdentifier": "CodeIdentifier", "Unknown": "Unknown",
}

REL_TYPE_MAP: Dict[str, str] = {
    # Core Types
    "CALLS": "CALLS", "REFERENCES": "REFERENCES", "DEFINES": "DEFINES",
    "CONTAINS": "CONTAINS", "IMPORTS": "IMPORTS", "INHERITS_FROM": "INHERITS_FROM",
    "IMPLEMENTS": "IMPLEMENTS", "HAS_PARAMETER": "HAS_PARAMETER", "RETURNS": "RETURNS",
    "TYPE_ARGUMENT": "TYPE_ARGUMENT",
    # Hint Types (Initial mapping, may be refined)
    "CALLS_HINT": "CALLS", "FETCHES_HINT": "CALLS_API", "QUERIES_HINT": "QUERIES",
    "READS_HINT": "READS", "WRITES_HINT": "WRITES", "ACCESSES_HINT": "ACCESSES",
    "USES_ENV_VAR_HINT": "USES_ENVIRONMENT_VARIABLE",
    # Specific Resolved Types
    "CALLS_API": "CALLS_API", "QUERIES_TABLE": "QUERIES_TABLE", "USES_COLUMN": "USES_COLUMN",
    "MODIFIES_TABLE": "MODIFIES_TABLE", "READS_TABLE": "READS_TABLE", # Added from heuristic logic
    # Fallback
    "RELATED_TO": "RELATED_TO",
}

DEFINITION_NODE_TYPES = { # Neo4j Labels considered definitions
    "Function", "Class", "Method", "Interface", "Enum", "Struct",
    "Table", "Column", "ApiEndpoint", "EnvironmentVariable", "File", "Module", "Variable"
}