# db_operations.py
import sqlite3 # Example import, not strictly necessary for parsing

# Assume conn is a database connection and cursor is obtained elsewhere
# For parsing purposes, we just need the structure

def get_user(cursor, user_id):
    """Fetches a user by ID."""
    sql_query = f"SELECT id, name, email FROM users WHERE id = ?"
    # This call should be detected
    cursor.execute(sql_query, (user_id,))
    result = cursor.fetchone()
    return result

def create_user(cursor, name, email):
    """Creates a new user."""
    # This SQL string should be detected
    sql_insert = "INSERT INTO users (name, email) VALUES (?, ?)"
    cursor.execute(sql_insert, (name, email))
    # Another potential SQL string (though less common pattern)
    sql_log = "INSERT INTO audit_log (action, user_name) VALUES ('create', ?)"
    cursor.execute(sql_log, (name,))
    return cursor.lastrowid

def complex_query(cursor, status):
    """Example with multi-line f-string SQL"""
    table_name = "orders"
    query = f"""
    SELECT
        o.id,
        o.order_date,
        c.name as customer_name
    FROM
        {table_name} o
    JOIN
        customers c ON o.customer_id = c.id
    WHERE
        o.status = ?
    ORDER BY
        o.order_date DESC
    """
    cursor.execute(query, (status,))
    return cursor.fetchall()

def not_sql(cursor):
    # This should not be detected as SQL
    message = "SELECT this is just a regular string, not SQL"
    cursor.execute("UPDATE logs SET message = ? WHERE id = 1", (message,)) # This SQL *should* be detected