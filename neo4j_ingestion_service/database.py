# neo4j_ingestion_service/database.py
import logging
from neo4j import GraphDatabase, basic_auth
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

logger = logging.getLogger(__name__)

def get_neo4j_driver():
    """Establishes and verifies connection to Neo4j."""
    try:
        # Consider adding connection pool settings if needed (e.g., max_connection_lifetime)
        driver = GraphDatabase.driver(NEO4J_URI, auth=basic_auth(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        logger.info(f"Successfully connected to Neo4j at {NEO4J_URI}")
        return driver
    except Exception as e:
        logger.error(f"Failed to connect to Neo4j: {e}")
        # Propagate the exception to be handled by the caller (e.g., the service)
        raise

# Potential future database helper functions can be added here.