# api_gateway/orchestration_logic/helpers.py
import logging
import re
from typing import Dict, List, Set, Optional

# Import types and protobufs from defs
from .defs import GlobalId, NODE_TYPE_MAP, analyzer_pb2

logger = logging.getLogger(__name__)

def generate_preliminary_global_id(node: analyzer_pb2.Node, analyzer_name: str, file_path: str) -> GlobalId:
    """Generates a preliminary, potentially unique global ID."""
    candidate = node.global_id_candidate
    lang = node.properties.get("language", analyzer_name.split('_')[0]).lower() # Infer from analyzer name if needed

    if not candidate:
        # Fallback if candidate is missing
        candidate = f"{file_path}::{node.node_type}::{node.local_id}"
        logger.warning(f"Node in {file_path} (local_id {node.local_id}, type {node.node_type}) missing global_id_candidate. Using fallback: {candidate}")

    # Basic namespacing: language::candidate (candidate might include path)
    # TODO: Improve normalization if needed (e.g., handle path separators consistently)
    normalized_candidate = candidate.replace("\\", "/") # Basic path normalization
    return f"{lang}::{normalized_candidate}"

def get_final_node_labels(node_type: str, language: Optional[str]) -> List[str]:
    """Determines the final Neo4j labels for a node."""
    labels = set()
    mapped_type = NODE_TYPE_MAP.get(node_type, "Unknown")
    labels.add(mapped_type)
    if language:
        labels.add(language.capitalize()) # Add language label, e.g., "Python"
    if mapped_type == "Unknown" and node_type != "Unknown":
        labels.add(f"Original_{node_type}") # Keep original type if mapping failed
    return list(labels)

def parse_sql_query(query: str) -> Dict[str, Set[str]]:
    """Basic parsing of SQL query to extract table and column names."""
    # Very basic regex matching - assumes simple queries. Needs improvement for complex SQL.
    # Consider using a dedicated SQL parser library for robustness.
    tables = set(re.findall(r'\b(?:FROM|JOIN|UPDATE|INTO)\s+`?(\w+)`?', query, re.IGNORECASE))
    # Basic column extraction (might capture functions or aliases)
    columns = set(re.findall(r'\b(?:SELECT|WHERE|SET|ON)\s+(?:`?(\w+)`?|\*)|(?:`?(\w+)`?\s*=\s*)', query, re.IGNORECASE))
    # Flatten list of tuples from regex and filter empty strings
    flat_columns = {c for group in columns for c in group if c}
    return {"tables": tables, "columns": flat_columns}