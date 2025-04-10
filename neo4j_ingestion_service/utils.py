# neo4j_ingestion_service/utils.py
import logging
from google.protobuf import json_format

logger = logging.getLogger(__name__)

def struct_to_dict(struct_proto):
    """Converts a Protobuf Struct to a Python dictionary."""
    try:
        # Use json_format which handles nested structures and types correctly
        return json_format.MessageToDict(struct_proto, preserving_proto_field_name=True)
    except Exception as e:
        logger.error(f"Error converting protobuf Struct to dict: {e}")
        # Return an empty dict or re-raise depending on desired error handling
        return {}


import re

def escape_cypher_label(label: str) -> str:
    """Escapes a string for safe use as a Cypher label or relationship type."""
    # Basic sanitization: remove backticks and non-alphanumeric characters (except underscore)
    # Neo4j labels/types are quite restrictive.
    sanitized = re.sub(r'[^a-zA-Z0-9_]', '', label)
    # Ensure it doesn't start with a number (though MERGE might handle this)
    if sanitized and sanitized[0].isdigit():
        sanitized = '_' + sanitized
    # Add backticks for safety, especially if it matches keywords or contains underscores
    # If empty after sanitization, provide a default or raise error
    if not sanitized:
        logger.warning(f"Label '{label}' sanitized to empty string. Using '_UNKNOWN'.")
        return '`_UNKNOWN`'
    return f'`{sanitized}`'

# Add other utility functions as needed