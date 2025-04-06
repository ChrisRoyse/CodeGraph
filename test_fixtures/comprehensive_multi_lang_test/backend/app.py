# test_fixtures/comprehensive_multi_lang_test/backend/app.py
from flask import Flask, jsonify, request
import requests # For calling the Java microservice
import os

# Import functions from the local db_queries module
# This demonstrates Python -> Python import/export
from .db_queries import get_all_users, get_user_by_id, count_products

app = Flask(__name__)

# --- Configuration ---
# In a real app, use environment variables or a config file
MICROSERVICE_URL = os.getenv("MICROSERVICE_URL", "http://localhost:8080") # Default for local dev

# --- Inheritance Example ---
class BaseHandler:
    def handle(self, data):
        print("Base handling:", data)
        return {"status": "base_handled"}

class UserHandler(BaseHandler):
    def handle(self, user_data):
        print("User specific handling:")
        super().handle(user_data) # Call parent method
        # Add user-specific logic here
        return {"status": "user_handled", "user_name": user_data.get("name")}

# --- API Endpoints ---

@app.route('/api/users', methods=['GET'])
def api_get_users():
    """
    API endpoint called by the frontend (e.g., apiClient.ts).
    Fetches users from the database via db_queries.py.
    Demonstrates: FE (TS) -> BE (Python) -> DB (SQL)
    """
    print("Received request for /api/users")
    # Calls function imported from db_queries.py
    users = get_all_users()
    print(f"Returning {len(users)} users")
    return jsonify(users)

@app.route('/api/users/<int:user_id>', methods=['GET'])
def api_get_user(user_id):
    """ API endpoint to get a single user by ID. """
    print(f"Received request for /api/users/{user_id}")
    user = get_user_by_id(user_id)
    if user:
        # Example using the inheritance structure
        handler = UserHandler()
        handler.handle(user)
        return jsonify(user)
    else:
        return jsonify({"error": "User not found"}), 404

@app.route('/api/process_data', methods=['POST'])
def api_process_data():
    """
    API endpoint that calls the Java microservice.
    Demonstrates: BE (Python) -> Microservice (Java)
    """
    data_to_process = request.json
    print(f"Received data to process: {data_to_process}")
    print(f"Calling Java microservice at {MICROSERVICE_URL}/internal/process")

    try:
        # Call to endpoint defined in microservice/.../Controller.java
        response = requests.post(f"{MICROSERVICE_URL}/internal/process", json=data_to_process, timeout=5)
        response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)
        print(f"Microservice response: {response.status_code}")
        return jsonify(response.json()), response.status_code
    except requests.exceptions.RequestException as e:
        print(f"Error calling microservice: {e}")
        return jsonify({"error": "Failed to communicate with processing microservice"}), 503 # Service Unavailable

@app.route('/api/product_count', methods=['GET'])
def api_get_product_count():
    """ Example endpoint using another db_queries function. """
    count = count_products() # Calls function from db_queries.py
    return jsonify({"product_count": count})


# Basic run command for local testing (optional for fixture)
# if __name__ == '__main__':
#     app.run(debug=True, port=5000)