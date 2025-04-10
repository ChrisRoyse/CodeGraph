# python_app_service/main.py
import os
import time
import psycopg2
from psycopg2 import OperationalError

def connect_db():
    """Connects to the PostgreSQL database using environment variables."""
    try:
        conn = psycopg2.connect(
            dbname=os.environ.get("DB_NAME", "bmcp_db"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", "postgres"),
            host=os.environ.get("DB_HOST", "postgres_db"), # Service name in docker-compose
            port=os.environ.get("DB_PORT", "5432")
        )
        print("Database connection successful")
        return conn
    except OperationalError as e:
        print(f"Database connection failed: {e}")
        return None

def main():
    print("Starting Python App Service...")
    conn = None
    # Retry connection for a while in case the DB is not ready immediately
    retries = 5
    while retries > 0 and conn is None:
        conn = connect_db()
        if conn is None:
            retries -= 1
            print(f"Retrying connection in 5 seconds... ({retries} retries left)")
            time.sleep(5)

    if conn:
        print("Successfully connected to the database.")
        # Example: You can perform database operations here
        # cur = conn.cursor()
        # cur.execute("SELECT version();")
        # db_version = cur.fetchone()
        # print(f"PostgreSQL version: {db_version}")
        # cur.close()
        conn.close()
        print("Database connection closed.")
    else:
        print("Could not connect to the database after several retries.")

    # Keep the service running (optional, depends on the app's purpose)
    print("Python App Service finished its task.")
    # while True:
    #     time.sleep(60)


if __name__ == "__main__":
    main()