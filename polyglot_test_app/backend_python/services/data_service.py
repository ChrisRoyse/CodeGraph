# polyglot_test_app/backend_python/services/data_service.py

# This class conceptually interacts with a database.
# It references table and column names that would be defined in schema.sql
class DataService:
    DB_TABLE_ITEMS = "items" # Reference to SQL table
    DB_TABLE_USERS = "users" # Reference to SQL table

    def __init__(self, db_connection_string: str):
        self.db_connection_string = db_connection_string
        print(f"DataService initialized with {db_connection_string}")

    def get_item_details(self, item_id: int) -> dict:
        # Conceptually, this would execute:
        # query = f"SELECT id, name, description FROM {self.DB_TABLE_ITEMS} WHERE id = ?"
        # For simulation, we return mock data.
        print(f"Fetching item with id: {item_id} from table '{self.DB_TABLE_ITEMS}'")
        if item_id == 1:
            return {"id": item_id, "name": "Test Item 1", "description": "Description for item 1. Uses column 'name' and 'description'."}
        return {}

    def create_item(self, name: str, description: str) -> dict:
        # Conceptually, this would execute:
        # query = f"INSERT INTO {self.DB_TABLE_ITEMS} (name, description) VALUES (?, ?)"
        # For simulation, we return mock data.
        new_id = 123 # Mock new ID
        print(f"Creating item with name: {name} in table '{self.DB_TABLE_ITEMS}' using columns 'name', 'description'")
        return {"id": new_id, "name": name, "description": description, "status": "created"}

    def get_user_by_username(self, username: str) -> dict:
        # query = f"SELECT user_id, username, email FROM {self.DB_TABLE_USERS} WHERE username = ?"
        print(f"Fetching user with username: {username} from table '{self.DB_TABLE_USERS}'")
        if username == "testuser":
            return {"user_id": 1, "username": "testuser", "email": "testuser@example.com"}
        return {}

GLOBAL_DATA_SERVICE_INSTANCE = DataService("sqlite:///./test_db.sqlite")
# End of data_service.py
