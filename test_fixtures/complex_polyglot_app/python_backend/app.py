import os
import psycopg2
import requests # For calling Deno service
from flask import Flask, request, jsonify
from dotenv import load_dotenv

# Import local utility (inter-file dependency)
from utils.db_helper import get_db_connection, check_connection_status
# Import another local module (inter-directory dependency)
from services.data_processor import process_data

load_dotenv() # Load environment variables from .env file

app = Flask(__name__)

# --- Basic Endpoint ---
@app.route('/greet', methods=['GET'])
def greet():
    """Greets the caller. Called by Frontend and potentially Deno."""
    name = request.args.get('name', 'World')
    print(f"Python: Received request for /greet with name={name}")
    # Use the imported processing function
    processed_name = process_data(name)
    return jsonify(greeting=f"Hello, {processed_name}, from Python!")

# --- Database Interaction Endpoint ---
@app.route('/db-status', methods=['GET'])
def db_status():
    """Checks the database connection status. Called by Frontend."""
    print("Python: Received request for /db-status")
    conn = None
    try:
        # Use imported function to get connection
        conn = get_db_connection()
        # Use imported function to check status
        status = check_connection_status(conn)
        return jsonify(status=status)
    except Exception as e:
        print(f"Python: Database connection error: {e}")
        # Ensure connection is closed even on error during check
        if conn:
            conn.close()
        return jsonify(status=f"Error connecting to DB: {e}"), 500
    finally:
        # Ensure connection is always closed
        if conn:
            conn.close()
            print("Python: Database connection closed.")


# --- Cross-Language Interaction (Conceptual) ---
# Example of Python calling the Deno service

DENO_SERVICE_URL = os.getenv("DENO_SERVICE_URL", "http://localhost:8000")

@app.route('/call-deno-hello', methods=['GET'])
def call_deno():
    """Calls the Deno service's /hello endpoint."""
    print("Python: Received request for /call-deno-hello")
    deno_endpoint = f"{DENO_SERVICE_URL}/hello"
    try:
        # NOTE: This requests.get call represents the cross-language dependency
        response = requests.get(deno_endpoint, timeout=5) # Add timeout
        response.raise_for_status() # Raise HTTPError for bad responses (4xx or 5xx)
        data = response.json()
        print(f"Python: Received response from Deno: {data}")
        return jsonify(python_says="Called Deno!", deno_response=data)
    except requests.exceptions.RequestException as e:
        print(f"Python: Error calling Deno service ({deno_endpoint}): {e}")
        return jsonify(error=f"Failed to call Deno service: {e}"), 503 # Service Unavailable

# --- End Cross-Language Interaction ---


if __name__ == '__main__':
    # Use environment variable for port or default to 5001
    port = int(os.getenv('PYTHON_PORT', 5001))
    print(f"Python backend starting on http://localhost:{port}")
    # Use host='0.0.0.0' to be accessible externally if needed (e.g., in Docker)
    app.run(debug=True, port=port, host='0.0.0.0')