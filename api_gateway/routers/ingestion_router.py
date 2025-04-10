import logging
import grpc
from fastapi import APIRouter, Body, HTTPException, Depends, status
from typing import Any # Removed Dict as it's replaced by AnalysisData
from ..ingestion_schemas import AnalysisData # Import from api_gateway/ingestion_schemas.py
from ..grpc_setup import get_neo4j_ingestion_stub # Removed CORE_GRPC_MODULES_LOADED import

# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Attempt to import generated protobuf types specifically for this router
try:
    from generated.src import neo4j_ingestion_pb2
    from generated.src import neo4j_ingestion_pb2_grpc
    NEO4J_INGESTION_MODULES_LOADED = True
except ImportError:
    # Logger is defined now, this should work
    logger.error("Failed to import neo4j_ingestion modules in ingestion_router.", exc_info=True)
    neo4j_ingestion_pb2 = None
    neo4j_ingestion_pb2_grpc = None # Define placeholder
    NEO4J_INGESTION_MODULES_LOADED = False

router = APIRouter(
    prefix="/ingest",
    tags=["ingestion"],
)

@router.post("/analysis_data", status_code=status.HTTP_200_OK)
async def ingest_analysis_data(
    payload: AnalysisData = Body(...), # Use the Pydantic model for validation
    # Use string literal for type hint to avoid import-time evaluation error
    neo4j_stub: "neo4j_ingestion_pb2_grpc.Neo4jIngestionStub" = Depends(get_neo4j_ingestion_stub())
):
    """
    Receives analysis data for ingestion.
    Currently logs receipt and returns a success message.
    """
    try:
        logger.info("Received ingestion request for analysis data.")
        logger.info(f"Successfully validated and received analysis data. Nodes: {len(payload.nodes)}, Relationships: {len(payload.relationships)}")

        # Check if the specific modules needed here were loaded, and if the stub was created
        if not NEO4J_INGESTION_MODULES_LOADED or not neo4j_ingestion_pb2_grpc or neo4j_stub is None:
            logger.error("Neo4j ingestion gRPC modules/stub not loaded. Cannot forward data.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Neo4j ingestion service connection not available."
            )

        # 1. Convert Pydantic payload to gRPC request message
        grpc_request = neo4j_ingestion_pb2.IngestAnalysisDataRequest()

        # Map nodes
        for node_data in payload.nodes:
            grpc_node = neo4j_ingestion_pb2.AnalysisNode(
                unique_id=node_data.uniqueId,
                name=node_data.name,
                file_path=node_data.filePath,
                start_line=node_data.startLine, # Fix attribute name
                end_line=node_data.endLine, # Fix attribute name
                language=node_data.language,
                labels=node_data.labels
            )
            grpc_request.payload.nodes.append(grpc_node)

        # Map relationships
        for rel_data in payload.relationships:
            grpc_rel = neo4j_ingestion_pb2.RelationshipStub(
                source_id=rel_data.sourceId, # Fix attribute name
                target_identifier=rel_data.target_identifier,
                type=rel_data.type,
                properties=rel_data.properties if rel_data.properties else {} # Ensure properties is a dict
            )
            grpc_request.payload.relationships.append(grpc_rel)

        logger.info(f"Forwarding {len(payload.nodes)} nodes and {len(payload.relationships)} relationships to Neo4j Ingestion Service...")

        # 2. Call the gRPC service
        try:
            grpc_response = await neo4j_stub.IngestAnalysisData(grpc_request)

            # 3. Handle gRPC response
            if grpc_response.success:
                logger.info(f"Successfully ingested data via gRPC: {grpc_response.message}")
                return {"status": "ingested", "detail": grpc_response.message}
            else:
                logger.error(f"Neo4j Ingestion Service reported failure: {grpc_response.message}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Neo4j ingestion failed: {grpc_response.message}"
                )

        except grpc.aio.AioRpcError as e:
            logger.error(f"gRPC call to Neo4j Ingestion Service failed: {e.details()} (Code: {e.code()})", exc_info=True)
            detail = f"Failed to communicate with Neo4j Ingestion Service: {e.details()}"
            status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            if e.code() == grpc.StatusCode.UNAVAILABLE:
                 detail = "Neo4j Ingestion Service is unavailable."
            elif e.code() == grpc.StatusCode.DEADLINE_EXCEEDED:
                 detail = "Request to Neo4j Ingestion Service timed out."
                 status_code = status.HTTP_504_GATEWAY_TIMEOUT
            # Add more specific error handling based on grpc.StatusCode if needed
            raise HTTPException(status_code=status_code, detail=detail)

    except HTTPException as http_exc:
        # Re-raise HTTPException to let FastAPI handle it
        raise http_exc
    except Exception as e:
        # Catch any other unexpected errors during conversion or logging
        logger.error(f"Unexpected error processing analysis data ingestion: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during data ingestion processing")