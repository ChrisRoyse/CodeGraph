#!/usr/bin/env python3
"""
API Gateway Service for CodeGraph

This service provides a RESTful API for interacting with the CodeGraph system.
"""

import os
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Import modular routers
from config_api import router as config_router
from status_api import router as status_router
from query_proxy_api import router as query_proxy_router
from scan_api import router as scan_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Configuration is handled in each router module via env vars

# Initialize FastAPI app
app = FastAPI(
    title="CodeGraph API",
    description="API for interacting with the CodeGraph system",
    version="0.1.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development only, restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modular routers handle their own dependencies and connections

# Models are now defined in their respective routers if needed

@app.get("/")
async def root():
    return {"message": "Welcome to CodeGraph API"}

# Include modular routers
app.include_router(config_router)
app.include_router(status_router)
app.include_router(query_proxy_router)
app.include_router(scan_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
