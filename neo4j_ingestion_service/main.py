# neo4j_ingestion_service/main.py
import logging
import os
import sys
import signal
import time
from concurrent import futures

import grpc
from dotenv import load_dotenv
from grpc_health.v1 import health_pb2_grpc
from grpc_health.v1 import health, health_pb2 # Import health_pb2


# --- Local Imports ---
# Import gRPC generated code
# Ensure the path is correct based on how generate_grpc.sh places the files
try:
    from generated.src import neo4j_ingestion_pb2, neo4j_ingestion_pb2_grpc # Import _pb2 as well
except ImportError:
    # Attempt relative import if the first fails (e.g., during local testing)
    # This might indicate an issue with PYTHONPATH or generation script structure
    logging.warning("Could not import from 'generated.src', trying relative import...")
    try:
        # Adjust path if necessary, assuming generated code is sibling to neo4j_ingestion_service
        # This is less standard for Docker builds where WORKDIR is usually set.
        # If this fails, check PYTHONPATH and the output location of generate_grpc.sh
        sys.path.append(os.path.join(os.path.dirname(__file__), '..')) # Add parent dir
        from generated.src import neo4j_ingestion_pb2, neo4j_ingestion_pb2_grpc # Import _pb2 as well
    except ImportError as e:
        logging.error(f"Failed to import generated gRPC code. Ensure 'generate_grpc.sh' ran correctly and PYTHONPATH is set. Error: {e}", exc_info=True)
        sys.exit(1)


# Import the Servicer implementation
from .services import Neo4jIngestionServicer

# Import Neo4j driver management functions
from .database import get_neo4j_driver, close_neo4j_driver, Neo4jError

# Load environment variables from .env file
load_dotenv()

# --- Logging Setup ---
# Use environment variable for log level, default to INFO
log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=log_level,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    stream=sys.stdout)
logger = logging.getLogger(__name__)

# --- Constants ---
SERVER_PORT = os.environ.get("NEO4J_INGESTION_PORT", "50055") # Get port from env or default
MAX_WORKERS = int(os.environ.get("GRPC_MAX_WORKERS", "10")) # Max threads for the server
GRACEFUL_SHUTDOWN_TIMEOUT = int(os.environ.get("GRPC_SHUTDOWN_TIMEOUT", "10")) # Seconds to wait

# Global server instance to allow graceful shutdown
server = None

def handle_shutdown(signum, frame):
    """Handles termination signals for graceful shutdown."""
    logger.info(f"Received signal {signal.Signals(signum).name}. Initiating graceful shutdown...")
    if server:
        # Stop accepting new connections and wait for ongoing RPCs
        # Returns a threading.Event that is set when shutdown is complete
        shutdown_event = server.stop(GRACEFUL_SHUTDOWN_TIMEOUT)
        logger.info(f"Waiting up to {GRACEFUL_SHUTDOWN_TIMEOUT} seconds for ongoing requests to complete...")
        shutdown_event.wait() # Wait for shutdown to complete or timeout
        logger.info("Server stop initiated.")
    else:
        logger.warning("Server instance not found during shutdown handler.")
    # Resources like the driver are closed in the finally block of serve()

def serve():
    """Starts the gRPC server and waits for termination."""
    global server
    neo4j_driver = None # Initialize driver variable

    try:
        # --- Initialize Neo4j Driver ---
        # This must happen before the servicer is instantiated
        logger.info("Initializing Neo4j driver...")
        neo4j_driver = get_neo4j_driver() # Handles connection and verification
        logger.info("Neo4j driver initialized successfully.")

        # --- Create gRPC Server ---
        server = grpc.server(
            futures.ThreadPoolExecutor(max_workers=MAX_WORKERS),
            # Add options like keepalive if needed
            # options=[
            #     ('grpc.keepalive_time_ms', 10000),
            #     ('grpc.keepalive_timeout_ms', 5000),
            #     ('grpc.keepalive_permit_without_calls', True),
            #     ('grpc.http2.min_ping_interval_without_data_ms', 5000),
            # ]
            )

        # --- Setup Health Check Servicer ---
        health_servicer = health.HealthServicer(
            experimental_non_blocking=True
            # experimental_generic_interval_seconds=15, # Removed: Argument no longer valid
        )
        health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
        logger.info("gRPC Health Check Servicer added.")

        # --- Register Servicer ---
        # The servicer's __init__ will use the driver initialized above
        neo4j_ingestion_pb2_grpc.add_Neo4jIngestionServiceServicer_to_server(
            Neo4jIngestionServicer(), server
        )

        # --- Start Server ---
        listen_addr = f'[::]:{SERVER_PORT}'
        # Consider adding reflection service for tools like grpcurl
        # from grpc_reflection.v1alpha import reflection
        # SERVICE_NAMES = (
        #     neo4j_ingestion_pb2.DESCRIPTOR.services_by_name['Neo4jIngestionService'].full_name,
        #     reflection.SERVICE_NAME,
        # )
        # reflection.enable_server_reflection(SERVICE_NAMES, server)
        # logger.info("gRPC Reflection enabled.")

        server.add_insecure_port(listen_addr) # Use add_secure_port for TLS
        server.start()
        logger.info(f"Neo4j Ingestion gRPC Server started successfully on {listen_addr}")
        # Set initial health status for the main service
        # Empty string '' means the overall server health
        health_servicer.set("", health_pb2.HealthCheckResponse.SERVING) # Use health_pb2
        # Set status for the specific service (optional, but good practice)
        service_name = neo4j_ingestion_pb2.DESCRIPTOR.services_by_name['Neo4jIngestionService'].full_name # Use _pb2.DESCRIPTOR
        health_servicer.set(service_name, health_pb2.HealthCheckResponse.SERVING) # Use health_pb2
        logger.info(f"Initial health status set to SERVING for '' and '{service_name}'.")

        logger.info(f"Log level set to: {log_level}")
        logger.info(f"Max workers: {MAX_WORKERS}")


        # --- Setup Signal Handlers for Graceful Shutdown ---
        signal.signal(signal.SIGINT, handle_shutdown)
        signal.signal(signal.SIGTERM, handle_shutdown)

        # --- Keep Server Running ---
        # server.wait_for_termination() will block until server.stop() is called
        logger.info("Server running. Waiting for termination signal (Ctrl+C)...")
        # Instead of blocking indefinitely, we can loop to allow other checks if needed
        # Or just use wait_for_termination() which is simpler
        server.wait_for_termination() # Blocks here until shutdown signal handled

    except Neo4jError as ne:
        logger.critical(f"CRITICAL: Failed to initialize Neo4j driver: {ne}", exc_info=True)
        sys.exit(1) # Exit if driver fails to initialize
    except ImportError as ie:
         logger.critical(f"CRITICAL: Failed to import necessary modules: {ie}", exc_info=True)
         sys.exit(1)
    except Exception as e:
        logger.critical(f"CRITICAL: An error occurred during server setup or runtime: {e}", exc_info=True)
        # Attempt to stop the server if it was started
        if server:
            server.stop(0) # Immediate stop on unexpected error
        sys.exit(1)
    finally:
        # --- Cleanup Resources ---
        logger.info("Server shutdown sequence initiated or unexpected exit. Cleaning up resources...")
        # Close Neo4j driver if it was successfully initialized
        # The close_neo4j_driver function handles the check if _driver exists
        # Clear health status on shutdown
        if 'health_servicer' in locals():
            health_servicer.set("", health_pb2.HealthCheckResponse.NOT_SERVING) # Use health_pb2
            service_name = neo4j_ingestion_pb2.DESCRIPTOR.services_by_name['Neo4jIngestionService'].full_name # Use _pb2.DESCRIPTOR
            health_servicer.set(service_name, health_pb2.HealthCheckResponse.NOT_SERVING) # Use health_pb2
            logger.info("Health status set to NOT_SERVING.")

        close_neo4j_driver()
        logger.info("Cleanup complete. Exiting.")

if __name__ == "__main__":
    serve()