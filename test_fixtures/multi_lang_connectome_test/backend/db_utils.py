# backend/db_utils.py
import sqlite3 # Using sqlite for simplicity, no external DB needed
import os

# Construct path relative to this file's directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, '..', 'database', 'test_db.sqlite') 

def _ensure_db_exists():
    """Creates the DB from schema if it doesn't exist."""
    if not os.path.exists(DATABASE_PATH):
        print(f"Database not found at {DATABASE_PATH}. Creating...")
        SCHEMA_PATH = os.path.join(BASE_DIR, '..', 'database', 'schema.sql')
        if not os.path.exists(SCHEMA_PATH):
             print(f"ERROR: Schema file not found at {SCHEMA_PATH}")
             return False
        try:
            conn = sqlite3.connect(DATABASE_PATH)
            cursor = conn.cursor()
            with open(SCHEMA_PATH, 'r') as f:
                schema_sql = f.read()
            cursor.executescript(schema_sql)
            conn.commit()
            print("Database created and schema applied.")
            return True
        except sqlite3.Error as e:
            print(f"Database creation error: {e}")
            return False
        finally:
            if conn:
                conn.close()
    return True


def get_user_email(user_id):
    """Queries the database for a user's email."""
    if not _ensure_db_exists():
        return None
        
    conn = None
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()

        # Database Query (Raw SQL)
        query = "SELECT email FROM users WHERE id = ?"
        cursor.execute(query, (user_id,))
        result = cursor.fetchone()

        return result[0] if result else None
    except sqlite3.Error as e:
        print(f"Database query error: {e}")
        return None
    finally:
        if conn:
            conn.close()