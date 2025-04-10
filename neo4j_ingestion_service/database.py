# neo4j_ingestion_service/database.py
import logging
# Removed defaultdict import as it's not used in the basic node ingestion part
import os # Added for environment variable access (though config likely handles it)
from typing import List, Dict, Any # Added for type hinting
from neo4j import GraphDatabase, basic_auth, Driver # Added Driver type hint
# Removed duplicate import
from neo4j import ResultSummary # Import for type hinting

from neo4j.exceptions import Neo4jError
# ResultSummary and SummaryCounters are accessed via query results, no direct import needed

# Import generated gRPC code and utils
try:
    from generated.src import neo4j_ingestion_pb2
except ImportError as e:
    logging.warning(f"Could not import generated gRPC modules from 'generated.src': {e}. Proceeding without gRPC capabilities.")
    # Allow service to run without gRPC if only basic ingestion is used initially
    neo4j_ingestion_pb2 = None
    # raise # Or re-raise if gRPC is strictly required always
# Use config for credentials, ensure it's loaded correctly
# Assuming config.py loads from .env or environment variables
try:
    from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE
except ImportError:
    # Fallback to environment variables directly if config import fails
    # This might happen during testing or if structure changes
    logging.warning("Could not import from .config, falling back to environment variables.")
    NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
    NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")
    NEO4J_DATABASE = os.getenv("NEO4J_DATABASE", "neo4j") # Default to 'neo4j' database
# Removed redundant config import
from .utils import struct_to_dict, escape_cypher_label

logger = logging.getLogger(__name__)

# Removed old get_neo4j_driver signature remnant
# Global driver instance (consider managing lifecycle appropriately, e.g., in app context)
_driver = None

def get_neo4j_driver() -> Driver:
    """Initializes and returns a Neo4j driver instance, verifying connectivity."""
    global _driver
    if _driver is None:
        try:
            logger.info(f"Attempting to connect to Neo4j at {NEO4J_URI} database '{NEO4J_DATABASE}'")
            # Consider adding connection pool settings if needed (e.g., max_connection_lifetime)
            _driver = GraphDatabase.driver(
                NEO4J_URI,
                auth=basic_auth(NEO4J_USER, NEO4J_PASSWORD)
            )
            _driver.verify_connectivity()
            logger.info(f"Successfully connected to Neo4j database '{NEO4J_DATABASE}'")
        except Exception as e:
            logger.error(f"Failed to connect to Neo4j: {e}")
            # Propagate the exception to be handled by the caller (e.g., the service)
            raise
    return _driver

def close_neo4j_driver():
    """Closes the global Neo4j driver instance if it exists."""
    global _driver
    if _driver:
        logger.info("Closing Neo4j driver.")
        _driver.close()
        _driver = None
# Removed old get_neo4j_driver body remnant

# --- Basic Node Ingestion Logic ---

def ingest_nodes(driver: Driver, nodes_data: List[Dict[str, Any]]) -> ResultSummary:
    """
    Ingests a list of nodes into Neo4j using MERGE based on uniqueId.

    Args:
        driver: The Neo4j driver instance.
        nodes_data: A list of dictionaries, where each dictionary represents a node.
                    Expected format: {'uniqueId': str, 'labels': List[str], **properties}
                    Example: {'uniqueId': 'file123', 'labels': ['File', 'Code'], 'filePath': '/path/to/file.py', 'language': 'Python'}

    Returns:
        A ResultSummary object containing counters for the transaction.

    Raises:
        ValueError: If the driver is not provided or nodes_data is empty/invalid.
        Neo4jError: If the database transaction fails.
        Exception: For other unexpected errors during data preparation or execution.
    """
    if not driver:
        raise ValueError("Neo4j driver is not initialized.")
    if not nodes_data:
        logger.warning("ingest_nodes called with empty nodes_data list. No action taken.")
        # Return an empty summary
        summary = ResultSummary(server=None, database=None, query=None, parameters=None)
        summary._counters = SummaryCounters({})
        return summary

    prepared_nodes = []
    try:
        for i, node in enumerate(nodes_data):
            if not isinstance(node, dict) or 'uniqueId' not in node:
                logger.error(f"Invalid node data at index {i}: Missing 'uniqueId' or not a dict. Skipping. Data: {node}")
                continue # Skip invalid node data

            # Ensure uniqueId is a string
            unique_id = str(node['uniqueId'])

            # Extract labels, default to empty list if missing or not a list
            labels = node.get('labels', [])
            if not isinstance(labels, list):
                logger.warning(f"Node {unique_id} has invalid 'labels' format (expected list, got {type(labels)}). Using empty list. Data: {node}")
                labels = []
            # Ensure all labels are strings and escape them if necessary (though APOC handles most cases)
            valid_labels = [str(lbl) for lbl in labels if lbl] # Filter out empty labels

            # Prepare properties map, excluding 'labels' key itself
            properties = {k: v for k, v in node.items() if k != 'labels'}
            # Ensure uniqueId is also part of the properties map for setting
            properties['uniqueId'] = unique_id

            prepared_nodes.append({
                'uniqueId': unique_id,
                'labels': valid_labels,
                'properties': properties
            })

        if not prepared_nodes:
             logger.warning("No valid nodes found in nodes_data after preparation.")
             summary = ResultSummary(server=None, database=None, query=None, parameters=None)
             summary._counters = SummaryCounters({})
             return summary

    except Exception as e:
        logger.exception("Error preparing data for basic node ingestion.")
        raise  # Re-raise the preparation error

    logger.info(f"Starting node ingestion database transaction for {len(prepared_nodes)} prepared nodes...")
    try:
        # Use the configured database name
        with driver.session(database=NEO4J_DATABASE) as session:
            summary = session.execute_write(
                _run_node_ingestion_transaction,
                prepared_nodes
            )
            logger.info(f"Basic node ingestion summary: {summary.counters}")
            logger.info("Finished node ingestion database transaction successfully.")
            return summary
    except Neo4jError as e:
        # Catch specific Neo4j driver errors
        logger.exception(f"Neo4jError during node ingestion transaction: {e.code} - {e.message}")
        raise # Propagate Neo4j errors
    except Exception as e:
        # Catch any other unexpected errors during the transaction
        logger.exception("Unexpected error during node ingestion transaction.")
        raise # Propagate other errors


def _run_node_ingestion_transaction(tx, nodes_list: List[Dict[str, Any]]) -> ResultSummary:
    """
    Executes the Cypher query for merging nodes within a managed transaction.
    Uses UNWIND for batching and APOC for dynamic label setting with fallback.
    """
    logger.info(f"Starting basic node ingestion transaction for {len(nodes_list)} nodes...")
    node_summary = None

    # Cypher query using MERGE on uniqueId and APOC for labels
    node_merge_query_apoc = """
    UNWIND $nodes_list AS node_map
    MERGE (n {uniqueId: node_map.uniqueId})
    ON CREATE SET n = node_map.properties // Set all properties on create
    ON MATCH SET n += node_map.properties // Add/update properties on match (overwrites existing)
    // Set labels using APOC
    WITH n, node_map.labels AS labels
    // Only call APOC if labels list is not empty
    CALL apoc.do.when(
        size(labels) > 0,
        'CALL apoc.create.addLabels(n, labels) YIELD node RETURN node',
        'RETURN n as node',
        {n: n, labels: labels}
    ) YIELD value
    RETURN count(value.node) as nodes_processed
    """

    # Fallback query if APOC is not available (only sets properties)
    node_merge_query_no_apoc = """
    UNWIND $nodes_list AS node_map
    MERGE (n {uniqueId: node_map.uniqueId})
    ON CREATE SET n = node_map.properties
    ON MATCH SET n += node_map.properties
    // Store labels as a property if APOC is unavailable
    SET n._labels_fallback = node_map.labels
    RETURN count(n) as nodes_processed
    """

    try:
        logger.debug(f"Executing node merge with APOC attempt...")
        node_result = tx.run(node_merge_query_apoc, nodes_list=nodes_list)
        node_summary = node_result.consume()
        logger.info(f"Node merge (APOC attempt) summary: {node_summary.counters}")
    except Neo4jError as e:
        # Check if it's specifically an APOC procedure error
        if "There is no procedure with the name `apoc.create.addLabels`" in e.message or \
           "There is no procedure with the name `apoc.do.when`" in e.message:
            logger.warning(f"APOC procedure not found ({e.message}). Node labels will not be set dynamically. Falling back to property-only merge and storing labels in '_labels_fallback' property.")
            # Rerun with the fallback query
            logger.debug("Retrying node merge without APOC label setting.")
            node_result = tx.run(node_merge_query_no_apoc, nodes_list=nodes_list)
            node_summary = node_result.consume()
            logger.warning(f"Node merge (fallback) completed without APOC label setting. Summary: {node_summary.counters}")
        else:
            # Re-raise other Neo4j errors
            logger.error(f"Neo4jError during node merge: {e.code} - {e.message}")
            raise e
    except Exception as e:
        logger.error(f"Unexpected error during node merge transaction: {e}")
        raise e

    # Ensure a summary object is returned even if the query fails before consume()
    if node_summary is None:
        logger.error("Node merge transaction failed before summary could be generated.")
        # Create a dummy summary indicating failure (0 nodes processed)
        node_summary = ResultSummary(server=None, database=None, query=None, parameters=None)
        node_summary._counters = SummaryCounters({}) # Zero counters

    logger.info("Basic node ingestion transaction finished.")
    return node_summary



# --- Relationship Stub Storage ---

def _store_relationship_stubs(tx, relationship_stubs: List[Dict[str, Any]]) -> ResultSummary:
    """
    Stores relationship stubs as properties on the source nodes within a transaction.
    Assumes source nodes already exist.

    Args:
        tx: The Neo4j transaction object.
        relationship_stubs: A list of dictionaries, each representing a relationship stub.
                            Expected format: {'sourceId': str, 'type': str,
                                              'targetIdentifier': Any, 'properties': Dict}

    Returns:
        A ResultSummary object containing counters for the transaction.

    Raises:
        Neo4jError: If the database transaction fails.
        Exception: For other unexpected errors.
    """
    if not relationship_stubs:
        logger.warning("_store_relationship_stubs called with empty list.")
        summary = ResultSummary(server=None, database=None, query=None, parameters=None)
        summary._counters = SummaryCounters({})
        return summary

    logger.info(f"Storing {len(relationship_stubs)} relationship stubs...")
    # This query appends the stub info to a list property on the source node.
    # It uses coalesce to initialize the list if it doesn't exist.
    query = """
    UNWIND $relationships as rel_stub
    MATCH (source {uniqueId: rel_stub.sourceId})
    // Ensure properties is a map, default to empty map if null/missing in the input stub
    WITH source, rel_stub, coalesce(rel_stub.properties, {}) as props
    SET source.pendingRelationships = coalesce(source.pendingRelationships, []) +
        { type: rel_stub.type, targetIdentifier: rel_stub.targetIdentifier, properties: props }
    RETURN count(source) as stubs_stored
    """
    logger.info(f"Starting relationship stub storage transaction for {len(relationship_stubs)} stubs...")
    try:
        result = tx.run(query, relationships=relationship_stubs)
        summary = result.consume()
        logger.info(f"Relationship stub storage summary: {summary.counters}")
        logger.info("Finished relationship stub storage transaction successfully.")
        return summary
    except Neo4jError as e:
        # Catch specific Neo4j driver errors
        logger.exception(f"Neo4jError storing relationship stubs: {e.code} - {e.message}")
        # Log details of the failed stubs for debugging if helpful (consider data size/sensitivity)
        # logger.debug(f"Failed stubs data sample: {relationship_stubs[:5]}") # Log only a sample
        raise e # Re-raise to potentially abort the parent transaction
    except Exception as e:
        # Catch any other unexpected errors
        logger.exception(f"Unexpected error storing relationship stubs: {e}")
        raise e # Re-raise

# --- Analysis Data Processing ---

def process_analysis_data(driver: Driver, data: Dict[str, Any]):
    """
    Processes analysis data containing nodes and relationship stubs.
    1. Ingests/merges nodes using ingest_nodes.
    2. Stores relationship stubs as properties on source nodes.

    Args:
        driver: The Neo4j driver instance.
        data: A dictionary containing 'nodes' (List[Dict]) and 'relationships' (List[Dict]).
              The format should align with the Pydantic models or expected structure.

    Raises:
        ValueError: If the driver is not provided or data format is invalid.
        Neo4jError: If any database transaction fails.
        Exception: For other unexpected errors.
    """
    if not driver:
        raise ValueError("Neo4j driver is not initialized.")
    if not data or not isinstance(data, dict):
        logger.warning("process_analysis_data called with invalid or empty data. No action taken.")
        return

    nodes_data = data.get('nodes', [])
    relationships_data = data.get('relationships', []) # Expects list of dicts

    # Basic validation
    if not isinstance(nodes_data, list):
        logger.error(f"Invalid format for 'nodes': expected list, got {type(nodes_data)}. Aborting processing.")
        raise ValueError("Invalid format for 'nodes' in data.")
    if not isinstance(relationships_data, list):
        logger.warning(f"Invalid format for 'relationships': expected list, got {type(relationships_data)}. Skipping stub storage.")
        relationships_data = [] # Treat as empty if format is wrong

    prepared_stubs = []
    if relationships_data:
        logger.debug(f"Preparing {len(relationships_data)} relationship stubs for storage.")
        for i, stub in enumerate(relationships_data):
            if not isinstance(stub, dict) or 'sourceId' not in stub or 'type' not in stub or 'targetIdentifier' not in stub:
                logger.warning(f"Invalid relationship stub at index {i}: Missing required fields (sourceId, type, targetIdentifier) or not a dict. Skipping. Data: {stub}")
                continue
            # Ensure required fields are present and add default properties if missing
            prepared_stubs.append({
                'sourceId': str(stub['sourceId']), # Ensure string ID matches node uniqueId
                'type': str(stub['type']),
                'targetIdentifier': stub['targetIdentifier'], # Type depends on identifier strategy (e.g., string, dict)
                'properties': stub.get('properties', {}) # Default to empty dict if missing
            })
        if not prepared_stubs:
            logger.warning("No valid relationship stubs found after preparation.")
            # No need to set relationships_data = [], prepared_stubs is already empty

    logger.info("Starting processing of analysis data...")
    try:
        # Step 1: Ingest Nodes (uses its own transaction management and error handling)
        if nodes_data:
            # logger.info(f"Starting node ingestion for {len(nodes_data)} nodes...") # Moved inside ingest_nodes
            node_summary = ingest_nodes(driver, nodes_data)
            # Check node summary for potential issues if needed (e.g., if counters are zero when expected otherwise)
            # logger.info(f"Node ingestion completed. Summary: {node_summary.counters}") # Moved inside ingest_nodes
        else:
            logger.info("No nodes provided in the data for ingestion.")

        # Step 2: Store Relationship Stubs (if any valid ones exist)
        # This runs in a separate transaction within its own session block.
        if prepared_stubs:
            # logger.info(f"Starting relationship stub storage for {len(prepared_stubs)} stubs...") # Moved inside _store_relationship_stubs
            with driver.session(database=NEO4J_DATABASE) as session:
                # The actual transaction logic and logging are now within _store_relationship_stubs
                stub_summary = session.execute_write(_store_relationship_stubs, prepared_stubs)
                # Check stub summary for potential issues if needed
                # logger.info(f"Relationship stub storage completed. Summary: {stub_summary.counters}") # Moved inside _store_relationship_stubs
        else:
            logger.info("No valid relationship stubs provided or found in the data to store.")

        logger.info("process_analysis_data completed successfully.")

    except (Neo4jError, ValueError) as e:
        # Catch specific errors from Neo4j or data validation issues raised earlier
        logger.exception(f"Database or Value Error during process_analysis_data: {e}")
        # Re-raise to signal failure to the caller (e.g., the gRPC service handler or API endpoint)
        raise
    except Exception as e:
        # Catch any other unexpected errors during the overall processing flow
        logger.exception(f"Unexpected error during process_analysis_data: {e}")
        raise # Re-raise unexpected errors


# --- Unified Graph Ingestion Logic ---

def ingest_unified_graph_data(driver, nodes: list[neo4j_ingestion_pb2.AnalysisNode], relationships: list[neo4j_ingestion_pb2.RelationshipStub]) -> ResultSummary: # Corrected type hints
    """
    Ingests nodes and relationships from the unified graph format into Neo4j within a single transaction.

    Args:
        driver: The Neo4j driver instance.
        nodes: A list of GraphNode protobuf messages.
        relationships: A list of GraphRelationship protobuf messages.

    Returns:
        A ResultSummary object containing counters for the transaction.

    Raises:
        Neo4jError: If the database transaction fails.
        Exception: For other unexpected errors during data preparation.
    """
    if not driver:
        raise ValueError("Neo4j driver is not initialized.")

    try:
        # Prepare data lists for Cypher parameters
        nodes_data = []
        for node in nodes:
            properties = struct_to_dict(node.properties) if node.properties else {}
            # Ensure global_id is always present in properties for the query
            properties['global_id'] = node.global_id
            nodes_data.append({
                "global_id": node.global_id,
                "node_type": node.node_type, # Primary label
                "secondary_labels": list(node.secondary_labels), # Additional labels
                "properties": properties
            })

        rels_data = []
        for rel in relationships:
            rels_data.append({
                "source_global_id": rel.source_node_global_id,
                "target_global_id": rel.target_node_global_id,
                "relationship_type": rel.relationship_type,
                "properties": struct_to_dict(rel.properties) if rel.properties else {}
            })

    except Exception as e:
        logger.exception("Error preparing data for unified graph ingestion.")
        raise  # Re-raise the preparation error

    try:
        with driver.session(database="neo4j") as session:
            summary = session.execute_write(
                _run_unified_graph_transaction,
                nodes_data,
                rels_data
            )
            logger.info(f"Unified graph ingestion summary: {summary.counters}")
            return summary
    except Neo4jError as e:
        logger.exception(f"Neo4j transaction failed during unified graph ingestion: {e.code} - {e.message}")
        raise # Propagate Neo4j errors
    except Exception as e:
        logger.exception("Unexpected error during unified graph ingestion transaction.")
        raise # Propagate other errors


def _run_unified_graph_transaction(tx, nodes_data, rels_data):
    """
    Executes the Cypher queries for merging nodes and relationships within a managed transaction.
    Uses UNWIND for efficient batching. Groups relationships by type.
    """
    logger.info(f"Starting unified graph ingestion transaction...")
    total_counters = SummaryCounters({})
    node_summary = None
    rel_summaries = {} # Store summary per relationship type

    # --- 1. Merge Nodes ---
    # Note: This query handles multiple labels (primary type + secondary labels)
    # It merges based on global_id and updates/sets properties.
    if nodes_data:
        node_merge_query = """
        UNWIND $nodes_list AS node_map
        MERGE (n {global_id: node_map.global_id})
        ON CREATE SET n = node_map.properties // Set all properties on create
        ON MATCH SET n += node_map.properties // Add/update properties on match
        // Dynamically set labels (primary type + secondary labels)
        // Need to construct the label string carefully
        WITH n, node_map.node_type AS primary_label, node_map.secondary_labels AS secondary_labels
        CALL apoc.create.addLabels(n, [primary_label] + secondary_labels) YIELD node
        RETURN count(node) as nodes_processed
        """
        # Alternative label setting without APOC (less robust if labels change):
        # SET n:`Label1`:`Label2`... requires building the query string, which is risky.
        # Using ON CREATE SET n:Label, ON MATCH SET n:Label is also possible but verbose.
        # APOC is generally the cleanest way if available.
        # If APOC is NOT available, a simpler SET n:`PrimaryLabel` might be used,
        # ignoring secondary_labels or handling them differently.

        logger.info(f"Executing merge for {len(nodes_data)} nodes...")
        try:
            node_result = tx.run(node_merge_query, nodes_list=nodes_data)
            node_summary = node_result.consume()
            total_counters += node_summary.counters
            logger.info(f"Node merge summary: {node_summary.counters}")
        except Neo4jError as e:
            # Check if it's an APOC error
            if "apoc.create.addLabels" in e.message:
                 logger.error("APOC procedure 'apoc.create.addLabels' not found. Node labels might not be fully set. Falling back to primary label only.")
                 # Fallback query without APOC for labels
                 node_merge_query_fallback = """
                 UNWIND $nodes_list AS node_map
                 MERGE (n {global_id: node_map.global_id})
                 ON CREATE SET n = node_map.properties, n:`""" + escape_cypher_label("DefaultNode") + """` // Set properties and a default label
                 ON MATCH SET n += node_map.properties // Add/update properties
                 // Set primary label (handle potential escaping issues if type is complex)
                 WITH n, node_map.node_type as primary_label_str
                 CALL db.index.fulltext.createNodeIndex("TEMP_LABEL_INDEX", [primary_label_str], ["global_id"]) // Hacky way to set label? No.
                 // Correct fallback: SET n:`label` requires dynamic query string or multiple SET clauses.
                 // Simplest fallback: Only merge properties, labels might need manual adjustment or separate query.
                 // Let's try setting the primary label directly, escaping it.
                 WITH n, node_map
                 CALL apoc.util.validate(apoc.util.validatePredicate(node_map.node_type IS NOT NULL AND node_map.node_type <> ''), 'Node type cannot be null or empty', [0]) // Basic check
                 // This SET n:`label` approach requires building the query string, let's avoid for now.
                 // Safest fallback: Just merge properties, log warning about labels.
                 SET n.node_type_property = node_map.node_type // Store type as property if labels fail
                 RETURN count(n) as nodes_processed
                 """
                 # Rerun with a simplified query (just properties) if APOC fails for labels
                 node_merge_query_no_labels = """
                 UNWIND $nodes_list AS node_map
                 MERGE (n {global_id: node_map.global_id})
                 ON CREATE SET n = node_map.properties
                 ON MATCH SET n += node_map.properties
                 RETURN count(n) as nodes_processed
                 """
                 logger.info("Retrying node merge without dynamic label setting using APOC.")
                 node_result = tx.run(node_merge_query_no_labels, nodes_list=nodes_data)
                 node_summary = node_result.consume()
                 total_counters += node_summary.counters
                 logger.warning(f"Node merge completed without APOC label setting. Summary: {node_summary.counters}")

            else:
                logger.error(f"Neo4jError during node merge: {e.code} - {e.message}")
                raise e # Re-raise other Neo4j errors
    else:
        logger.info("No nodes to merge.")

    # --- 2. Merge Relationships (Grouped by Type) ---
    if rels_data:
        # Group relationships by type
        rels_by_type = defaultdict(list)
        for rel in rels_data:
            rels_by_type[rel['relationship_type']].append(rel)

        logger.info(f"Processing {len(rels_data)} relationships grouped into {len(rels_by_type)} types.")

        for rel_type, rel_list in rels_by_type.items():
            escaped_rel_type = escape_cypher_label(rel_type)
            if not escaped_rel_type or escaped_rel_type == '``': # Skip if type becomes invalid
                 logger.warning(f"Skipping relationship type '{rel_type}' because it resulted in an invalid Cypher label.")
                 continue

            # Construct query specific to this relationship type
            # MERGE creates or matches the *entire* pattern.
            # We match nodes first, then MERGE the relationship.
            rel_merge_query = f"""
            UNWIND $rels_list AS rel_map
            MATCH (source {{global_id: rel_map.source_global_id}})
            MATCH (target {{global_id: rel_map.target_global_id}})
            MERGE (source)-[r:{escaped_rel_type}]->(target)
            ON CREATE SET r = rel_map.properties
            ON MATCH SET r += rel_map.properties // Add/update properties on match
            RETURN count(r) as relationships_processed
            """
            # Note: If relationships need unique IDs beyond source/target/type, MERGE needs adjustment.
            # Example: MERGE (source)-[r:TYPE {rel_id: rel_map.unique_id}]->(target)

            logger.info(f"Executing merge for {len(rel_list)} relationships of type {escaped_rel_type}...")
            try:
                rel_result = tx.run(rel_merge_query, rels_list=rel_list)
                rel_summary = rel_result.consume()
                rel_summaries[rel_type] = rel_summary.counters
                total_counters += rel_summary.counters # Aggregate counters
                logger.info(f"Relationship merge summary for type {escaped_rel_type}: {rel_summary.counters}")
            except Neo4jError as e:
                 logger.error(f"Neo4jError during relationship merge for type {escaped_rel_type}: {e.code} - {e.message}")
                 # Decide whether to continue with other types or raise immediately
                 # For now, log the error and continue
                 # raise e # Uncomment to fail the whole transaction on one type's error
            except Exception as e:
                 logger.error(f"Unexpected error during relationship merge for type {escaped_rel_type}: {e}")
                 # raise e # Uncomment to fail the whole transaction

    else:
        logger.info("No relationships to merge.")

    logger.info("Unified graph ingestion transaction finished.")

    # Return a mock summary object with aggregated counters
    # The driver session's execute_write returns the summary of the *last* query run inside.
    # We need to return the *aggregated* summary.
    final_summary_obj = ResultSummary(server=None, database=None, query=None, parameters=None)
    final_summary_obj._counters = total_counters # Use the aggregated counters

    return final_summary_obj

# --- Existing CPG Ingestion Logic (for reference, unchanged) ---
# ... (keep the existing IngestCpg logic below) ...