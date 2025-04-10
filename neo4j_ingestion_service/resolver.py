# neo4j_ingestion_service/resolver.py
import logging
from typing import List, Dict, Any
from neo4j import Driver
from neo4j.exceptions import Neo4jError
from neo4j.exceptions import ServiceUnavailable
# ResultSummary and SummaryCounters are accessed via query results, no direct import needed

# Assuming database module provides get_neo4j_driver() and NEO4J_DATABASE
from .database import NEO4J_DATABASE # Import database name if needed for sessions

logger = logging.getLogger(__name__)

# --- Cypher Transaction Functions ---

def _resolve_and_remove_stubs_tx(tx, relationship_type: str, resolution_query: str, params: Dict[str, Any] = None) -> int:
    """
    Generic transaction function to run a resolution query and remove matched stubs.

    Args:
        tx: The Neo4j transaction object.
        relationship_type: The type of relationship being resolved (for logging).
        resolution_query: The Cypher query string. It MUST:
            - Match source nodes with pending relationships.
            - UNWIND pending relationships and filter by type.
            - Match the target node based on the specific logic.
            - MERGE the relationship between source and target.
            - Use SET source.pendingRelationships = [...] to remove the matched stub.
            - RETURN a count of resolved relationships (e.g., count(r) as resolved_count).
        params: Optional dictionary of parameters for the Cypher query.

    Returns:
        The number of relationships resolved in this transaction.

    Raises:
        Neo4jError: If the Cypher query fails.
    """
    resolved_count = 0
    full_params = params or {}
    full_params['rel_type'] = relationship_type # Add relationship type for filtering

    logger.debug(f"Executing resolution transaction for type '{relationship_type}'...")
    # logger.debug(f"Query: {resolution_query}") # Optional: Log query only if needed
    # logger.debug(f"Params: {full_params}") # Optional: Log params

    try:
        result = tx.run(resolution_query, **full_params)
        # Consume the result to get the summary and potentially check returned values
        record = result.single() # Use single() as we expect one summary row back
        summary = result.consume() # Consume after accessing record(s)

        if record and 'resolved_count' in record:
             resolved_count = record['resolved_count'] or 0
        else:
             # Fallback or estimate based on counters if query doesn't return count
             resolved_count = summary.counters.relationships_created
             logger.warning(f"Resolution query for '{relationship_type}' did not explicitly return 'resolved_count'. Using relationships_created counter from summary: {resolved_count}")


        logger.info(f"Resolved {resolved_count} '{relationship_type}' relationships in this transaction.")
        logger.debug(f"Transaction summary for '{relationship_type}': {summary.counters}")
        return resolved_count
    except Neo4jError as e:
        logger.exception(f"Neo4jError during resolution transaction for type '{relationship_type}': {e.code} - {e.message}")
        raise # Re-raise to potentially abort the process or handle upstream
    except Exception as e:
        logger.exception(f"Unexpected error during resolution transaction for type '{relationship_type}': {e}")
        raise # Re-raise

# --- Specific Resolution Functions ---

def resolve_intra_file_calls(driver: Driver) -> int:
    """
    Resolves pending 'CALLS' relationships where the target is expected
    to be a Function or Method within the same file as the source.
    """
    logger.info("Attempting to resolve intra-file 'CALLS' relationships...")
    relationship_type = "CALLS"

    # Query Logic:
    # 1. Match nodes with pending relationships.
    # 2. Unwind the list, filter for 'CALLS' type.
    # 3. Match target Function/Method in the same file using name.
    # 4. Merge the :CALLS relationship.
    # 5. Remove the resolved stub from the source's pending list.
    query = """
    MATCH (source)
    WHERE source.pendingRelationships IS NOT NULL AND size(source.pendingRelationships) > 0
    UNWIND source.pendingRelationships as pending
    WITH source, pending // Keep pending in scope for removal
    WHERE pending.type = $rel_type
      AND pending.targetIdentifier IS NOT NULL AND toString(pending.targetIdentifier) <> '' // Ensure target ID exists
      AND source.filePath IS NOT NULL // Source must have a file path

    // Match target Function/Method within the same file
    MATCH (target {filePath: source.filePath})
    WHERE (target:Function OR target:Method OR target:FUNCTION_DECLARATION OR target:METHOD_DEFINITION) // Add JS/TS types
      AND target.name = pending.targetIdentifier // Match by name

    // Use MERGE to avoid duplicate relationships if run multiple times (though pending removal should prevent it)
    MERGE (source)-[r:CALLS]->(target)
    ON CREATE SET r = pending.properties // Set properties from stub on creation

    // Atomically remove the *specific* resolved stub from the list
    // This requires 'pending' to be the exact map object from the list
    SET source.pendingRelationships = [item IN source.pendingRelationships WHERE item <> pending]

    RETURN count(r) as resolved_count // Count relationships created/merged in this run
    """

    total_resolved = 0
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            # Loop to handle potential large numbers of pending relationships in batches implicitly handled by UNWIND
            # We might need explicit batching if memory becomes an issue, but start simple.
            resolved_in_tx = session.execute_write(
                _resolve_and_remove_stubs_tx,
                relationship_type,
                query
                # No specific params needed beyond rel_type handled by generic function
            )
            total_resolved += resolved_in_tx
            # Add looping/batching logic here if needed based on performance testing

        logger.info(f"Finished resolving intra-file 'CALLS'. Total resolved: {total_resolved}")
        return total_resolved
    except (ServiceUnavailable, Neo4jError) as e:
        logger.error(f"Database error during intra-file 'CALLS' resolution: {e}")
        return 0 # Indicate failure or partial success
    except Exception as e:
        logger.error(f"Unexpected error during intra-file 'CALLS' resolution: {e}")
        return 0

def resolve_imports(driver: Driver) -> int:
    """
    Resolves pending 'IMPORTS' relationships where the target is expected
    to be a File node. Matches based on targetIdentifier (assumed file path).
    """
    logger.info("Attempting to resolve 'IMPORTS' relationships...")
    relationship_type = "IMPORTS"

    # Query Logic:
    # 1. Match nodes with pending relationships.
    # 2. Unwind the list, filter for 'IMPORTS' type.
    # 3. Match target File node using targetIdentifier as filePath.
    #    NOTE: Assumes targetIdentifier is the *normalized* path. Path normalization
    #          should ideally happen *before* storing the stub or be handled here if needed.
    #          For now, assume it matches File.filePath directly.
    # 4. Merge the :IMPORTS relationship.
    # 5. Remove the resolved stub from the source's pending list.
    query = """
    MATCH (source)
    WHERE source.pendingRelationships IS NOT NULL AND size(source.pendingRelationships) > 0
    UNWIND source.pendingRelationships as pending
    WITH source, pending
    WHERE pending.type = $rel_type
      AND pending.targetIdentifier IS NOT NULL AND toString(pending.targetIdentifier) <> '' // Ensure target ID exists

    // Match target File node using the targetIdentifier as its filePath
    // WARNING: This assumes targetIdentifier is the exact, normalized filePath of the target File node.
    MATCH (target:File {filePath: pending.targetIdentifier})

    // Use MERGE for the relationship
    MERGE (source)-[r:IMPORTS]->(target)
    ON CREATE SET r = pending.properties

    // Atomically remove the resolved stub
    SET source.pendingRelationships = [item IN source.pendingRelationships WHERE item <> pending]

    RETURN count(r) as resolved_count
    """

    total_resolved = 0
    try:
        with driver.session(database=NEO4J_DATABASE) as session:
            resolved_in_tx = session.execute_write(
                _resolve_and_remove_stubs_tx,
                relationship_type,
                query
            )
            total_resolved += resolved_in_tx
            # Add looping/batching if needed

        logger.info(f"Finished resolving 'IMPORTS'. Total resolved: {total_resolved}")
        return total_resolved
    except (ServiceUnavailable, Neo4jError) as e:
        logger.error(f"Database error during 'IMPORTS' resolution: {e}")
        return 0
    except Exception as e:
        logger.error(f"Unexpected error during 'IMPORTS' resolution: {e}")
        return 0

# --- Add more resolution functions as needed ---
# e.g., resolve_cross_file_calls, resolve_db_interactions_neo4j, etc.
# Each would have its own specific Cypher query logic for matching the target.

# --- Main Orchestration Function ---

def resolve_pending_relationships(driver: Driver):
    """
    Runs all relationship resolution steps in a defined order.
    """
    if not driver:
        logger.error("Neo4j driver not available. Cannot resolve relationships.")
        return

    logger.info("Starting pending relationship resolution process...")
    try:
        # Define the order of resolution. Imports often need to be resolved before calls.
        resolution_steps = [
            resolve_imports,
            resolve_intra_file_calls,
            # Add other resolvers here in the desired order
            # e.g., resolve_cross_file_calls,
            # e.g., resolve_db_interactions_neo4j,
        ]

        for step_func in resolution_steps:
            try:
                step_func(driver)
            except Exception as e:
                logger.error(f"Error during resolution step {step_func.__name__}: {e}. Continuing with next step.", exc_info=True)
                # Decide if errors should halt the entire process or just log and continue

        logger.info("Relationship resolution process finished.")

    except Exception as e:
        logger.error(f"An unexpected error occurred during the overall resolution process: {e}", exc_info=True)

# Example of how this might be called from main.py or a service endpoint:
# if __name__ == "__main__":
#     from .database import get_neo4j_driver, close_neo4j_driver
#     logging.basicConfig(level=logging.INFO)
#     logger.info("Running Neo4j resolver independently.")
#     neo4j_driver = None
#     try:
#         neo4j_driver = get_neo4j_driver()
#         resolve_pending_relationships(neo4j_driver)
#     except Exception as e:
#         logger.error(f"Independent resolver run failed: {e}")
#     finally:
#         if neo4j_driver:
#             close_neo4j_driver()
#         logger.info("Neo4j resolver independent run finished.")