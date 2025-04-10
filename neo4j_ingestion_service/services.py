# neo4j_ingestion_service/services.py
import logging
from typing import List, Dict, Any
import grpc # Added for status codes

# Import generated gRPC code
from generated.src import neo4j_ingestion_pb2
from generated.src import neo4j_ingestion_pb2_grpc

# Import database and resolver functions
# Ensure driver is initialized before servicer uses it
from .database import process_analysis_data, get_neo4j_driver, close_neo4j_driver, Neo4jError
from .resolver import resolve_pending_relationships, ServiceUnavailable

logger = logging.getLogger(__name__)

# Helper function to convert protobuf messages to dictionaries
def analysis_node_to_dict(node: neo4j_ingestion_pb2.AnalysisNode) -> Dict[str, Any]:
    """Converts an AnalysisNode protobuf message to a Python dictionary."""
    # This format should align with what database.process_analysis_data expects
    # which in turn relies on database.ingest_nodes
    return {
        'uniqueId': node.unique_id,
        'name': node.name,
        'filePath': node.file_path,
        'start_line': node.start_line,
        'end_line': node.end_line,
        'language': node.language,
        'labels': list(node.labels)
        # Note: database.ingest_nodes primarily uses uniqueId and labels,
        # other fields are added to the properties map. This conversion seems okay.
    }

def relationship_stub_to_dict(stub: neo4j_ingestion_pb2.RelationshipStub) -> Dict[str, Any]:
    """Converts a RelationshipStub protobuf message to a Python dictionary."""
    # This format should align with what database.process_analysis_data expects
    # which in turn relies on database._store_relationship_stubs
    return {
        'sourceId': stub.source_id,
        'targetIdentifier': stub.target_identifier,
        'type': stub.type,
        'properties': dict(stub.properties) # Convert map<string, string> to dict
    }


class Neo4jIngestionServicer(neo4j_ingestion_pb2_grpc.Neo4jIngestionServiceServicer):
    """
    Provides methods that implement functionality of Neo4j Ingestion Service.
    """

    def __init__(self):
        # Get the driver instance when the servicer is initialized
        # The actual driver initialization should happen in main.py before server start
        # Here we just get the potentially already initialized driver.
        try:
            # Use the getter which returns the global instance or initializes it
            self.neo4j_driver = get_neo4j_driver()
            if self.neo4j_driver:
                 logger.info("Neo4j driver obtained successfully for Neo4jIngestionServicer.")
            else:
                 # This case should ideally not happen if main.py initializes first
                 logger.error("Failed to obtain Neo4j driver in servicer initialization (was None).")
                 # Raise an error or handle appropriately? For now, log and proceed.
                 # The methods below will check self.neo4j_driver anyway.
                 pass
        except Exception as e:
            logger.error(f"Error obtaining Neo4j driver during servicer initialization: {e}", exc_info=True)
            self.neo4j_driver = None # Ensure it's None if failed

    def IngestAnalysisData(self, request: neo4j_ingestion_pb2.IngestAnalysisDataRequest, context) -> neo4j_ingestion_pb2.IngestAnalysisDataResponse:
        """
        Accepts raw analysis data (nodes and relationship stubs) for initial storage.
        """
        logger.info(f"Received IngestAnalysisData request.")
        if not self.neo4j_driver:
            logger.error("Neo4j driver not available in servicer. Cannot process IngestAnalysisData.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details("Neo4j driver not initialized or unavailable.")
            return neo4j_ingestion_pb2.IngestAnalysisDataResponse(success=False, message="Internal Server Error: Neo4j driver unavailable.")

        try:
            payload = request.payload
            node_count = len(payload.nodes)
            rel_count = len(payload.relationships)
            logger.info(f"Processing payload with {node_count} nodes and {rel_count} relationship stubs.")

            # Convert protobuf messages to Python dictionaries expected by database.py
            nodes_list = [analysis_node_to_dict(node) for node in payload.nodes]
            relationships_list = [relationship_stub_to_dict(stub) for stub in payload.relationships]

            converted_data = {
                "nodes": nodes_list,
                "relationships": relationships_list
            }

            # Call the database processing function
            process_analysis_data(self.neo4j_driver, converted_data)

            logger.info(f"Successfully processed {node_count} nodes and {rel_count} relationship stubs.")
            return neo4j_ingestion_pb2.IngestAnalysisDataResponse(success=True, message=f"Ingested {node_count} nodes and {rel_count} relationship stubs.")

        except (Neo4jError, ValueError) as e: # Removed ServiceUnavailable as process_analysis_data doesn't raise it directly
            logger.error(f"Database or Value Error during IngestAnalysisData: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Database or Value error processing data: {e}")
            return neo4j_ingestion_pb2.IngestAnalysisDataResponse(success=False, message=f"Error processing data: {e}")
        except ServiceUnavailable as e: # Catch ServiceUnavailable specifically if driver fails mid-request
             logger.error(f"Neo4j Service Unavailable during IngestAnalysisData: {e}", exc_info=True)
             context.set_code(grpc.StatusCode.UNAVAILABLE)
             context.set_details(f"Neo4j service unavailable: {e}")
             return neo4j_ingestion_pb2.IngestAnalysisDataResponse(success=False, message=f"Neo4j service unavailable: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during IngestAnalysisData: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"An unexpected error occurred: {e}")
            return neo4j_ingestion_pb2.IngestAnalysisDataResponse(success=False, message=f"An unexpected error occurred: {e}")

    def TriggerResolution(self, request: neo4j_ingestion_pb2.TriggerResolutionRequest, context) -> neo4j_ingestion_pb2.TriggerResolutionResponse:
        """
        Triggers the process to resolve relationship stubs and finalize graph connections.
        """
        logger.info("Received TriggerResolution request.")
        if not self.neo4j_driver:
            logger.error("Neo4j driver not available in servicer. Cannot process TriggerResolution.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details("Neo4j driver not initialized or unavailable.")
            return neo4j_ingestion_pb2.TriggerResolutionResponse(success=False, message="Internal Server Error: Neo4j driver unavailable.")

        try:
            # Call the main resolution function from resolver.py
            # Consider if this should run asynchronously or return immediately
            logger.info("Starting relationship resolution process...")
            resolve_pending_relationships(self.neo4j_driver) # This is synchronous

            logger.info("Successfully completed relationship resolution process.")
            # Consider making the response more informative if resolver returns details
            return neo4j_ingestion_pb2.TriggerResolutionResponse(success=True, message="Relationship resolution process completed.")

        except ServiceUnavailable as e:
            logger.error(f"Neo4j Service Unavailable during TriggerResolution: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details(f"Neo4j service unavailable during resolution: {e}")
            return neo4j_ingestion_pb2.TriggerResolutionResponse(success=False, message=f"Neo4j service unavailable during resolution: {e}")
        except Neo4jError as e:
             logger.error(f"Neo4j Database error during TriggerResolution: {e}", exc_info=True)
             context.set_code(grpc.StatusCode.INTERNAL)
             context.set_details(f"Neo4j database error during resolution: {e}")
             return neo4j_ingestion_pb2.TriggerResolutionResponse(success=False, message=f"Neo4j database error during resolution: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during TriggerResolution: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"An unexpected error occurred during resolution: {e}")
            return neo4j_ingestion_pb2.TriggerResolutionResponse(success=False, message=f"An unexpected error occurred during resolution: {e}")