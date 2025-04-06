from flask import Flask, jsonify, request
import database # Import the database module

app = Flask(__name__)

@app.route('/api/data', methods=['GET'])
def get_data():
    """
    API endpoint to fetch data.
    Uses a query parameter 'id' to fetch specific data.
    """
    item_id = request.args.get('id', 'default') # Get 'id' query param
    try:
        # Call a function from the database module
        data = database.get_item_by_id(item_id)
        if data:
            return jsonify({"message": f"Data for {item_id}: {data}"})
        else:
            return jsonify({"message": f"No data found for {item_id}"}), 404
    except Exception as e:
        # Log the error in a real app
        print(f"Error fetching data: {e}")
        return jsonify({"error": "Failed to fetch data"}), 500

@app.route('/api/users', methods=['GET'])
def get_users():
    """ Fetches all users from the database. """
    try:
        users = database.get_all_users()
        return jsonify(users)
    except Exception as e:
        print(f"Error fetching users: {e}")
        return jsonify({"error": "Failed to fetch users"}), 500

# Placeholder function representing interaction with the Java UserService
def get_user_from_java_service(user_id):
    # In a real scenario, this would involve an RPC/HTTP call to the Java service
    print(f"Simulating call to Java UserService for user_id: {user_id}")
    # Simulate receiving data structure similar to what Java service might return
    return {"userId": user_id, "name": "Data from Java Service (Simulated)"}

@app.route('/java-user/<int:user_id>')
def java_user_data(user_id):
    data = get_user_from_java_service(user_id)
    return jsonify(data)



if __name__ == '__main__':
    # In a real app, use a proper WSGI server like gunicorn
    app.run(debug=True, port=5001) # Run on a different port than default 5000