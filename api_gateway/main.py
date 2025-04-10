import logging
import uvicorn
from fastapi import FastAPI

# Import modules from the api_gateway package
from . import config # Ensure config is loaded early if needed elsewhere implicitly
from .grpc_setup import lifespan # Import the lifespan manager
# Import routers (add query_router)
from .routers import analysis_router, local_analysis_router, ingestion_router, query_router
from .schemas import HealthResponse # Import response model for health check

# --- Logging Setup ---
# Configure logging basic settings
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__) # Get logger for this module

logger.info("Initializing BMCP API Gateway...")

# --- FastAPI Application Setup ---
# Initialize the FastAPI application
# Pass the lifespan context manager to handle gRPC channel setup/teardown
app = FastAPI(
    title="BMCP API Gateway",
    description="Entry point for initiating code analysis workflows.",
    version="0.2.0", # Increment version due to refactor
    lifespan=lifespan # Register the lifespan handler
)

# --- Include Routers ---
# Mount the routers defined in separate modules
logger.info("Including API routers...")
app.include_router(analysis_router.router)
app.include_router(local_analysis_router.router)
app.include_router(ingestion_router.router)
app.include_router(query_router.router) # Include the new query router
logger.info("Routers included successfully.")

# --- Health Check Endpoint ---
@app.get("/health", response_model=HealthResponse, summary="Health Check", tags=["Health"])
async def health_check():
    """Basic health check endpoint to verify the service is running."""
    # Future enhancement: Could check gRPC channel readiness here if needed
    # channels = grpc_setup.get_grpc_channels() # Requires Request object or different DI approach
    # status = "ok" if channels else "degraded" # Example check
    return HealthResponse(status="ok")

# --- Main Execution Guard ---
# This block runs the Uvicorn server when the script is executed directly.
if __name__ == "__main__":
    logger.info("Starting Uvicorn server...")
    # Use host "0.0.0.0" to be accessible within Docker network
    # Port 8000 is standard for FastAPI development
    # log_level="info" provides reasonable detail without being too verbose
    # Read port from environment variable, default to 8043 if not set
    http_port = int(os.getenv("HTTP_PORT", "8043"))
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=http_port,
        log_level="info"
    )