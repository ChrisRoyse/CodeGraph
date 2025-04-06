import os
import psycopg2
from psycopg2 import OperationalError

def get_db_connection():
    """Establishes a connection to the PostgreSQL database."""
    try:
        conn = psycopg2.connect(
            dbname=os.getenv("DB_NAME", "polyglot_db"),
            user=os.getenv("DB_USER", "user"),
            password=os.getenv("DB_PASSWORD", "password"),
            host=os.getenv("DB_HOST", "localhost"), # Or the service name in Docker Compose
            port=os.getenv("DB_PORT", "5432")
        )
        print("Python: Database connection successful")
        return conn
    except OperationalError as e:
        print(f"Python: Error connecting to database: {e}")
        raise # Re-raise the exception to be handled by the caller

def check_connection_status(connection):
    """Checks if the database connection is active."""
    if connection is None:
        return "No connection object"
    try:
        # Execute a simple query to check the connection
        cursor = connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        return "Connected"
    except (psycopg2.OperationalError, psycopg2.InterfaceError) as e:
        print(f"Python: Database connection check failed: {e}")
        return f"Connection Error: {e}"
    except Exception as e:
        print(f"Python: Unexpected error checking DB status: {e}")
        return f"Unexpected Error: {e}"

def close_connection(connection):
    """Closes the database connection if it's open."""
    if connection:
        connection.close()
        print("Python: Database connection closed by helper.")

# Example function that might perform a query (for CPG analysis)
def get_user_count(connection):
    """Example function performing a simple DB query."""
    if not connection:
        raise ValueError("Database connection is required")
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM users;")
            count = cursor.fetchone()[0]
            return count
    except Exception as e:
        print(f"Python: Error querying user count: {e}")
        # Decide how to handle errors - re-raise, return None, etc.
        raise