import logging
from neo4j import AsyncGraphDatabase, AsyncDriver
from contextlib import asynccontextmanager
from . import config # Import config to access Neo4j credentials

logger = logging.getLogger(__name__)

# Global variable to hold the driver instance
neo4j_driver: AsyncDriver | None = None

async def connect_to_neo4j():
    """Initializes the Neo4j driver."""
    global neo4j_driver
    uri = config.NEO4J_URI
    user = config.NEO4J_USER
    password = config.NEO4J_PASSWORD

    if not uri or not user or not password:
        logger.error("Neo4j connection details (URI, USER, PASSWORD) missing in configuration.")
        # Depending on requirements, you might raise an error or allow the app to start without DB connection
        # For now, we log an error and the driver will remain None.
        return

    logger.info(f"Attempting to connect to Neo4j at {uri}...")
    try:
        # Create an asynchronous driver instance
        neo4j_driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        # Verify connection by trying to get server info
        await neo4j_driver.verify_connectivity()
        logger.info("Successfully connected to Neo4j.")
    except Exception as e:
        logger.exception(f"Failed to connect to Neo4j: {e}")
        neo4j_driver = None # Ensure driver is None if connection failed

async def close_neo4j_connection():
    """Closes the Neo4j driver connection."""
    global neo4j_driver
    if neo4j_driver:
        logger.info("Closing Neo4j connection...")
        try:
            await neo4j_driver.close()
            logger.info("Neo4j connection closed.")
        except Exception as e:
            logger.exception(f"Error closing Neo4j connection: {e}")
        finally:
            neo4j_driver = None

def get_neo4j_driver() -> AsyncDriver:
    """Dependency function to get the Neo4j driver instance."""
    if neo4j_driver is None:
        # This should ideally not happen if lifespan management is correct
        logger.error("Neo4j driver requested but not initialized.")
        # Raise an exception or handle as appropriate for your application's needs
        # For now, raising an error might be safer than returning None unexpectedly.
        raise RuntimeError("Neo4j driver is not available. Check application startup and configuration.")
    return neo4j_driver

# Optional: Context manager for sessions if preferred over dependency injection in some cases
@asynccontextmanager
async def get_neo4j_session_context():
    """Provides a Neo4j session within an async context."""
    driver = get_neo4j_driver() # Get the initialized driver
    session = None
    try:
        async with driver.session() as session:
            yield session
    except Exception as e:
        logger.exception("Error during Neo4j session context.")
        raise # Re-raise the exception
    finally:
        # Session is automatically closed by the driver's context manager
        pass