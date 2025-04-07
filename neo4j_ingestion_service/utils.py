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

# Add other utility functions as needed