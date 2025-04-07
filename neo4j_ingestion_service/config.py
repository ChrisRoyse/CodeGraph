# neo4j_ingestion_service/config.py
import os
import logging

logger = logging.getLogger(__name__)

# --- Configuration ---
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
# Consider raising an error if the password is not set in production
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")
if not NEO4J_PASSWORD:
    logger.warning("NEO4J_PASSWORD environment variable not set. Using default 'password'. This is insecure for production.")
    NEO4J_PASSWORD = "password" # Default fallback, insecure

GRPC_PORT = os.getenv("NEO4J_INGESTION_PORT", "50053")
MAX_WORKERS = int(os.getenv("NEO4J_INGESTION_MAX_WORKERS", "10"))

# BATCH_SIZE = 1000 # Example if needed later

logger.info(f"Neo4j URI: {NEO4J_URI}")
logger.info(f"Neo4j User: {NEO4J_USER}")
logger.info(f"gRPC Port: {GRPC_PORT}")
logger.info(f"Max Workers: {MAX_WORKERS}")