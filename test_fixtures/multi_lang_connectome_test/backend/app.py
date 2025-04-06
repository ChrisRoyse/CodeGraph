# backend/app.py
from flask import Flask, jsonify, request
import subprocess
from db_utils import get_user_email # Intra-language call

app = Flask(__name__)

# API Definition
@app.route('/api/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    """API endpoint to get user data."""
    email = get_user_email(user_id) # Intra-language call

    # Cross-language call (Python -> Java via subprocess)
    try:
        # Assumes Java service source is accessible relative to where Python runs
        # Adjust classpath based on actual build/deployment structure if needed
        java_class_path = "../java_service/src/main/java" 
        java_class_name = "com.example.utils.StringProcessor"
        result = subprocess.run(
            ['java', '-cp', java_class_path, java_class_name, f"user_id:{user_id}"],
            capture_output=True, text=True, check=True, timeout=5 # Added timeout
        )
        processed_data = result.stdout.strip()
    except subprocess.TimeoutExpired:
         processed_data = "Error: Java call timed out"
    except Exception as e:
        processed_data = f"Error calling Java: {e}"

    if email:
        return jsonify({"user_id": user_id, "email": email, "processed": processed_data})
    else:
        return jsonify({"error": "User not found"}), 404

if __name__ == '__main__':
    # Use 0.0.0.0 to be accessible externally if needed, e.g. from frontend running elsewhere
    app.run(host='0.0.0.0', port=5000)