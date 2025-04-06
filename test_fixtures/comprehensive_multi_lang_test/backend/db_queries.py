# test_fixtures/comprehensive_multi_lang_test/backend/db_queries.py
import sqlite3 # Using sqlite3 for simplicity, no external deps needed

DATABASE_PATH = '../database/schema.sql' # Relative path to the schema

def get_user_by_id(user_id: int) -> dict | None:
    """
    Fetches a user from the database by their ID.
    This demonstrates a Backend (Python) -> Database (SQL) interaction.
    It references the 'users' table defined in database/schema.sql.
    NOTE: In a real app, use a proper ORM or connection pooling.
          This is simplified for fixture purposes.
    """
    conn = None
    try:
        # This connection doesn't actually use the schema file directly,
        # but assumes a database exists based on that schema.
        # For testing, the analyzer just needs to see the SQL query string.
        conn = sqlite3.connect(':memory:') # Use in-memory DB for example
        cursor = conn.cursor()

        # SQL Query referencing the 'users' table from schema.sql
        query = "SELECT id, name, email FROM users WHERE id = ?"
        cursor.execute(query, (user_id,))

        user_row = cursor.fetchone()
        if user_row:
            return {"id": user_row[0], "name": user_row[1], "email": user_row[2]}
        return None
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        return None
    finally:
        if conn:
            conn.close()

def get_all_users() -> list[dict]:
    """ Fetches all users from the database. """
    conn = None
    try:
        conn = sqlite3.connect(':memory:')
        cursor = conn.cursor()
        query = "SELECT id, name, email FROM users" # References 'users' table
        cursor.execute(query)
        users = []
        for row in cursor.fetchall():
             users.append({"id": row[0], "name": row[1], "email": row[2]})
        # Simulate data based on schema.sql inserts
        if not users:
             users = [
                 {"id": 1, "name": "Alice", "email": "alice@example.com"},
                 {"id": 2, "name": "Bob", "email": "bob@example.com"}
             ]
        return users
    except sqlite3.Error as e:
        print(f"Database error: {e}")
        return []
    finally:
        if conn:
            conn.close()

# Example of another function that might interact with the DB
def count_products() -> int:
    """ Counts products in the products table (defined in schema.sql) """
    # Simplified: In reality, this would execute "SELECT COUNT(*) FROM products"
    return 5 # Dummy value