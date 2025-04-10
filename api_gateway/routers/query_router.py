from fastapi import APIRouter, Depends, HTTPException, Query
from neo4j import AsyncGraphDatabase, AsyncSession, Record, Result
from typing import List, Dict, Any
import logging
from neo4j import AsyncDriver # Import AsyncDriver for type hinting
from ..database import get_neo4j_driver # Import the actual dependency function

# Placeholder for config access if needed (e.g., for logging levels)
# from ..config import settings

router = APIRouter(
    prefix="/query",
    tags=["query"],
    responses={404: {"description": "Not found"}},
)

logger = logging.getLogger(__name__)

# --- Helper Function to get Neo4j Session (using Dependency Injection) ---
async def get_neo4j_session(driver: AsyncDriver = Depends(get_neo4j_driver)):
    """Dependency to get an async Neo4j session from the driver."""
    if not driver:
        logger.error("Neo4j driver not available.")
        raise HTTPException(status_code=503, detail="Database connection not available.")
    try:
        async with driver.session() as session:
            yield session
    except Exception as e:
        logger.exception("Failed to create Neo4j session.")
        raise HTTPException(status_code=503, detail=f"Database session error: {e}")


# --- Helper Function to process Neo4j results ---
def process_node_result(record: Record, key: str = "n") -> Dict[str, Any]:
    """Converts a Neo4j Node record into a dictionary."""
    if not record or key not in record.data():
        return {}
    node = record.data()[key]
    # Convert Node object to a dictionary including labels
    node_dict = dict(node.items())
    node_dict["labels"] = list(node.labels)
    # Ensure uniqueId is present, although MERGE should guarantee it
    if 'uniqueId' not in node_dict:
        logger.warning(f"Node found without uniqueId: {node_dict.get('name', 'N/A')}")
        # Handle missing uniqueId if necessary, maybe skip or log error
    return node_dict

# --- API Endpoints ---

# Placeholder - Implement endpoints based on docs/relationship_rework_plan.md
# GET /callers/{node_unique_id}
# GET /callees/{node_unique_id}
# GET /nodes_in_file?filePath=...
# GET /node/{node_unique_id}

@router.get("/node/{node_unique_id}", response_model=Dict[str, Any])
async def get_node_details(
    node_unique_id: str,
    session: AsyncSession = Depends(get_neo4j_session)
):
    """
    Retrieve detailed information for a specific node by its unique ID.

    Args:
        node_unique_id: The unique identifier of the node to retrieve.
        session: Async Neo4j database session dependency.

    Returns:
        A dictionary containing the properties and labels of the found node.

    Raises:
        HTTPException(404): If no node with the given uniqueId is found.
        HTTPException(500): If there is a database query error.
        HTTPException(503): If the database connection is unavailable.
    """
    logger.info(f"Fetching details for node: {node_unique_id}")
    query = """
    MATCH (n {uniqueId: $nodeId})
    RETURN n
    """
    try:
        result: Result = await session.run(query, nodeId=node_unique_id)
        record = await result.single()
        if not record:
            logger.warning(f"Node not found: {node_unique_id}")
            raise HTTPException(status_code=404, detail=f"Node with uniqueId '{node_unique_id}' not found")

        node_details = process_node_result(record)
        logger.debug(f"Node details found for {node_unique_id}: {node_details}")
        return node_details
    except HTTPException as http_exc:
        # Re-raise HTTPExceptions (like 404 or 503 from session)
        raise http_exc
    except Exception as e:
        logger.exception(f"Error fetching node details for {node_unique_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")
@router.get("/callers/{node_unique_id}", response_model=List[Dict[str, Any]])
async def find_callers(
    node_unique_id: str,
    session: AsyncSession = Depends(get_neo4j_session)
):
    """
    Find all nodes (callers) that have a ``CALLS`` relationship pointing TO the specified node.

    Args:
        node_unique_id: The unique identifier of the target node (callee).
        session: Async Neo4j database session dependency.

    Returns:
        A list of dictionaries, each representing a caller node's properties and labels.
        Returns an empty list if no callers are found.

    Raises:
        HTTPException(500): If there is a database query error.
        HTTPException(503): If the database connection is unavailable.
    """
    logger.info(f"Finding callers for node: {node_unique_id}")
    query = """
    MATCH (caller)-[:CALLS]->(n {uniqueId: $nodeId})
    RETURN caller
    """
    try:
        result: Result = await session.run(query, nodeId=node_unique_id)
        callers = [process_node_result(record, key="caller") async for record in result]
        # Filter out empty results if process_node_result returns {} for bad data
        callers = [c for c in callers if c]
        logger.debug(f"Found {len(callers)} callers for {node_unique_id}")
        return callers
    except Exception as e:
        logger.exception(f"Error finding callers for {node_unique_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")


@router.get("/callees/{node_unique_id}", response_model=List[Dict[str, Any]])
async def find_callees(
    node_unique_id: str,
    session: AsyncSession = Depends(get_neo4j_session)
):
    """
    Find all nodes (callees) that the specified node has a ``CALLS`` relationship pointing TO.

    Args:
        node_unique_id: The unique identifier of the source node (caller).
        session: Async Neo4j database session dependency.

    Returns:
        A list of dictionaries, each representing a callee node's properties and labels.
        Returns an empty list if no callees are found.

    Raises:
        HTTPException(500): If there is a database query error.
        HTTPException(503): If the database connection is unavailable.
    """
    logger.info(f"Finding callees for node: {node_unique_id}")
    query = """
    MATCH (n {uniqueId: $nodeId})-[:CALLS]->(callee)
    RETURN callee
    """
    try:
        result: Result = await session.run(query, nodeId=node_unique_id)
        callees = [process_node_result(record, key="callee") async for record in result]
        callees = [c for c in callees if c]
        logger.debug(f"Found {len(callees)} callees for {node_unique_id}")
        return callees
    except Exception as e:
        logger.exception(f"Error finding callees for {node_unique_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")


@router.get("/nodes_in_file", response_model=List[Dict[str, Any]])
async def find_nodes_in_file(
    filePath: str = Query(..., description="The exact file path property stored on the nodes."),
    session: AsyncSession = Depends(get_neo4j_session)
):
    """
    Find all code construct nodes (functions, classes, etc.) associated with a specific file path.

    Args:
        filePath: The exact file path string used to identify nodes belonging to that file.
                  Must match the 'filePath' property stored in the database.
        session: Async Neo4j database session dependency.

    Returns:
        A list of dictionaries, each representing a node's properties and labels found within the file.
        Nodes are ordered by starting line number and then name.
        Returns an empty list if no nodes are found for the given file path.

    Raises:
        HTTPException(500): If there is a database query error.
        HTTPException(503): If the database connection is unavailable.
    """
    logger.info(f"Finding nodes in file: {filePath}")
    # Using filePath property which should be set during ingestion
    query = """
    MATCH (n {filePath: $filePath})
    RETURN n
    ORDER BY n.startLine, n.name // Order for consistency
    """
    try:
        result: Result = await session.run(query, filePath=filePath)
        nodes = [process_node_result(record, key="n") async for record in result]
        nodes = [n for n in nodes if n]
        logger.debug(f"Found {len(nodes)} nodes in file {filePath}")
        if not nodes:
             # Return 404 if the file itself isn't represented or has no nodes
             # Check if the file node exists at all might be better?
             # For now, return empty list which is valid, but maybe 404 is better UX?
             pass # Keep returning empty list for now
        return nodes
    except Exception as e:
        logger.exception(f"Error finding nodes in file {filePath}: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

# Removed the duplicated/misplaced block for get_node_details logic here.
# It has been moved into the get_node_details function definition above.
# Add other endpoints here...