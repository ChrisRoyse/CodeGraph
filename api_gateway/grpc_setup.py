import grpc
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Dict, AsyncGenerator, Any
from fastapi import FastAPI, Request, HTTPException, status

# Import config variables and database functions
from . import config
from . import database # Import the new database module

logger = logging.getLogger(__name__)

# Imports for gRPC modules will be attempted within the functions that need them.

# --- gRPC Channel Management with Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Manages the lifecycle of gRPC channels for the FastAPI application.
    Creates channels on startup and closes them gracefully on shutdown.
    Stores channels and potentially other resources (like DB driver) in app.state.
    """
    # --- Connect to Neo4j ---
    await database.connect_to_neo4j()
    # Check if connection was successful before proceeding with gRPC
    if database.neo4j_driver is None:
        logger.warning("Neo4j connection failed, gRPC setup might be affected if dependent.")
        # Decide if app should proceed without Neo4j. For now, we continue.

    # --- Setup gRPC Channels ---
    grpc_channels: Dict[str, grpc.aio.Channel] = {}
    channel_configs = {
        # "code_fetcher": config.CODE_FETCHER_ADDR, # Removed
        "joern_analysis": config.JOERN_ANALYSIS_ADDR,
        "neo4j_ingestion": config.NEO4J_INGESTION_ADDR,
        "sql_analysis": config.SQL_ANALYSIS_ADDR,
        # Add generic analyzer channels if needed, mapping language to address
        # Example: Add channels for configured language analyzers
        **{lang: addr for lang, addr in config.CONFIGURED_ANALYZERS.items() if addr}
    }

    logger.info("Creating gRPC channels...")
    for name, address in channel_configs.items():
        if address: # Only create if address is configured
            try:
                # Options can be added here for keepalive, etc.
                # Example: options=[('grpc.keepalive_time_ms', 10000)]
                grpc_channels[name] = grpc.aio.insecure_channel(address)
                logger.info(f"gRPC channel '{name}' created for address: {address}")
            except Exception as e:
                logger.error(f"Failed to create gRPC channel '{name}' for {address}: {e}")
        else:
             logger.warning(f"Skipping gRPC channel creation for '{name}' as address is not configured.")


    # Store channels in app state for dependency injection
    app.state.grpc_channels = grpc_channels
    # app.state.grpc_status_enum = Status # Removed - Status enum no longer used directly here

    # Store Neo4j driver in app state as well
    app.state.neo4j_driver = database.neo4j_driver

    try:
        # Yield combined state
        yield {
            "grpc_channels": grpc_channels,
            "neo4j_driver": database.neo4j_driver
        }
    finally:
        # --- Close gRPC Channels ---
        logger.info("Closing gRPC channels...")
        grpc_closers = [channel.close() for name, channel in grpc_channels.items()]
        if grpc_closers:
            results = await asyncio.gather(*grpc_closers, return_exceptions=True)
            closed_count = sum(1 for r in results if r is None or not isinstance(r, Exception))
            failed_count = len(results) - closed_count
            logger.info(f"Closed {closed_count} gRPC channels.")
            if failed_count > 0:
                 logger.error(f"Failed to close {failed_count} gRPC channels.")
        else:
            logger.info("No gRPC channels to close.")

        # --- Close Neo4j Connection ---
        await database.close_neo4j_connection()
# --- Dependency Injection Helpers ---

def get_grpc_channels(request: Request) -> Dict[str, grpc.aio.Channel]:
    """Dependency to get the dictionary of all managed gRPC channels."""
    channels = getattr(request.app.state, 'grpc_channels', {})
    if not channels:
         logger.warning("Attempted to get gRPC channels, but none were initialized.")
         # Depending on strictness, could raise 503 here too.
    return channels

# def get_status_enum(request: Request): # Removed - Status enum no longer used directly here
#     """Dependency to get the gRPC Status enum."""
#     if not getattr(request.app.state, 'grpc_modules_loaded', False):
#         raise HTTPException(
#             status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
#             detail="Core gRPC modules not loaded. Cannot provide Status enum."
#         )
#     s = getattr(request.app.state, 'grpc_status_enum', None)
#     if s is None:
#          raise HTTPException(
#             status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
#             detail="gRPC Status enum not available."
#         )
#     return s


def get_channel_dependency(channel_name: str):
    """Factory function to create a dependency for a specific gRPC channel."""
    def _get_channel(request: Request) -> grpc.aio.Channel:
        channels = get_grpc_channels(request) # Reuse the check
        channel = channels.get(channel_name)
        if channel is None:
            logger.error(f"gRPC channel '{channel_name}' requested but not found or not initialized.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Service channel '{channel_name}' is not available."
            )
        return channel
    return _get_channel

def get_stub_dependency(channel_name: str, module_name: str, stub_classname: str):
    """
    Factory function to create a dependency for a specific gRPC stub.
    Imports the necessary module dynamically.
    """
    def _get_stub(request: Request) -> Any:
        try:
            # Dynamically import the _pb2_grpc module
            grpc_module = __import__(f"generated.src.{module_name}_pb2_grpc", fromlist=[stub_classname])
            stub_class = getattr(grpc_module, stub_classname, None)

            if stub_class is None:
                 logger.error(f"Stub class '{stub_classname}' not found in module 'generated.src.{module_name}_pb2_grpc'.")
                 raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Internal configuration error for service '{channel_name}'."
                )

            channel = get_channel_dependency(channel_name)(request) # Get the specific channel
            return stub_class(channel)

        except ImportError:
            logger.error(f"Failed to import gRPC module 'generated.src.{module_name}_pb2_grpc' for channel '{channel_name}'.")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Service '{channel_name}' modules not loaded."
            )
        except Exception as e:
             logger.exception(f"Failed to instantiate gRPC stub '{stub_classname}' for channel '{channel_name}'")
             raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Failed to create gRPC stub for service '{channel_name}'."
            )
    return _get_stub

# --- Pre-defined Dependencies for Core Services ---
# These can be imported directly into routers

# Stubs
# def get_code_fetcher_stub() -> Any: # Removed
#     return get_stub_dependency("code_fetcher", getattr(code_fetcher_pb2_grpc, 'CodeFetcherStub', None)) # Removed

def get_joern_analysis_stub() -> Any:
    return get_stub_dependency("joern_analysis", "joern_analysis", "JoernAnalysisStub")

def get_neo4j_ingestion_stub() -> Any:
    return get_stub_dependency("neo4j_ingestion", "neo4j_ingestion", "Neo4jIngestionStub")

def get_sql_analysis_stub() -> Any:
    return get_stub_dependency("sql_analysis", "sql_analysis", "SqlAnalysisStub")

# Generic Analyzer Stub (used by dispatch or local analysis)
def get_analyzer_stub(language: str):
     """Gets the stub for a specific language analyzer channel."""
     # Assumes a common AnalyzerServiceStub structure defined in analyzer.proto
     # The channel name is assumed to be the language name (e.g., 'python', 'javascript')
     return get_stub_dependency(language, "analyzer", "AnalyzerServiceStub")

# Channels (if direct channel access is needed)
# def get_code_fetcher_channel() -> grpc.aio.Channel: # Removed
#     return get_channel_dependency("code_fetcher") # Removed

# Add others as needed...

# Status Enum
# def get_status() -> Any: # Removed - Status enum no longer used directly here
#     def _get_status_dep(request: Request):
#         return get_status_enum(request)
#     return _get_status_dep