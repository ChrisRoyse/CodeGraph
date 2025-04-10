# python_analyzer_service/api_client.py
import requests
import logging
import os
import json
from typing import Dict, Any

logger = logging.getLogger(__name__)

# Get API Gateway endpoint from environment variable or use default
# Default assumes docker-compose network alias 'api_gateway' on port 8000
API_GATEWAY_ENDPOINT = os.getenv('API_GATEWAY_ENDPOINT', 'http://api_gateway:8043') # Updated default port
INGEST_URL = f"{API_GATEWAY_ENDPOINT}/ingest/analysis_data"
REQUEST_TIMEOUT = 30 # Timeout in seconds

def send_analysis_data(data: Dict[str, Any]):
    """
    Sends the formatted analysis data (nodes and relationships) to the API Gateway ingestion endpoint.

    Args:
        data: A dictionary containing 'filePath', 'nodes', and 'relationships'.
    """
    file_path = data.get("filePath", "unknown file")
    logger.info(f"Attempting to send analysis data for {file_path} to {INGEST_URL}")

    try:
        # Construct the payload expected by the API Gateway
        payload_to_send = {
            "nodes": data.get("nodes", []),
            "relationships": data.get("relationships", [])
        }
        response = requests.post(
            INGEST_URL,
            json=payload_to_send, # Send the correctly structured payload
            timeout=REQUEST_TIMEOUT,
            headers={'Content-Type': 'application/json'}
        )
        response.raise_for_status() # Raises HTTPError for bad responses (4xx or 5xx)
        logger.info(f"Successfully sent analysis data for {file_path}. Status code: {response.status_code}")
        return True

    except requests.exceptions.Timeout:
        logger.error(f"Timeout error sending analysis data for {file_path} to {INGEST_URL} after {REQUEST_TIMEOUT} seconds.")
        return False
    except requests.exceptions.ConnectionError as conn_err:
        logger.error(f"Connection error sending analysis data for {file_path} to {INGEST_URL}: {conn_err}")
        return False
    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error sending analysis data for {file_path}: {http_err.response.status_code} - {http_err.response.text}")
        return False
    except requests.exceptions.RequestException as req_err:
        logger.exception(f"An unexpected error occurred sending analysis data for {file_path}: {req_err}")
        return False
    except Exception as e:
        # Catch any other unexpected errors during the process
        logger.exception(f"A non-request error occurred during API submission for {file_path}: {e}")
        return False