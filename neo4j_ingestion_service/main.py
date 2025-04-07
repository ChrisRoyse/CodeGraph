# neo4j_ingestion_service/main.py
import grpc
from concurrent import futures
import logging
import sys

# --- Local Imports ---
from .config import GRPC_PORT, MAX_WORKERS
from .services import Neo4jIngestionServicer

# --- gRPC Imports ---
# Import generated gRPC code using the package structure
try:
    from generated.src import neo4j_ingestion_pb2_grpc
    logging.info("Successfully imported generated gRPC modules.")
except ImportError as e:
    logging.critical(f"Could not import generated gRPC modules from 'generated.src': {e}")
    sys.exit(1) # Exit if imports fail, as the service cannot run

# --- Logging Setup ---
# Configure logging early
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# --- Server Setup ---
def serve():
    """Starts the gRPC server."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=MAX_WORKERS))

    # Create service instance (driver connection is handled within the servicer)
    service_instance = Neo4jIngestionServicer()

    # Register the servicer
    neo4j_ingestion_pb2_grpc.add_Neo4jIngestionServicer_to_server(
        service_instance, server
    )

    try:
        server.add_insecure_port(f"[::]:{GRPC_PORT}")
        server.start()
        logger.info(f"Neo4j Ingestion Service started on port {GRPC_PORT}")
        # Keep server running until terminated (e.g., Ctrl+C)
        server.wait_for_termination()
    except OSError as e:
         logger.error(f"Failed to start server on port {GRPC_PORT}: {e}. Port might be in use.")
         # Attempt graceful shutdown if start fails
         server.stop(0)
    except KeyboardInterrupt:
        logger.info("Stopping Neo4j Ingestion Service due to KeyboardInterrupt...")
    finally:
        # Ensure graceful shutdown
        # The service_instance.__del__ should handle driver closing
        server.stop(0) # Graceful stop with 0 seconds timeout
        logger.info("Server stopped.")

# --- Main Execution ---
if __name__ == "__main__":
    serve()