import sqlite3

DATABASE = 'test_db.sqlite'

def get_connection():
    """Establishes a connection to the SQLite database."""
    return sqlite3.connect(DATABASE)

def add_user(name, email):
    """Adds a new user to the users table."""
    conn = get_connection()
    cursor = conn.cursor()
    sql = "INSERT INTO users (name, email) VALUES (?, ?)"
    try:
        cursor.execute(sql, (name, email))
        conn.commit()
        print(f"User {name} added.")
    except sqlite3.IntegrityError:
        print(f"Email {email} already exists.")
    finally:
        conn.close()

def get_user_by_email(email):
    """Retrieves a user by their email address."""
    conn = get_connection()
    cursor = conn.cursor()
    # Using f-string for demonstration (less safe, but common pattern)
    sql_fstring = f"SELECT id, name, email FROM users WHERE email = '{email}'"
    cursor.execute(sql_fstring)
    user = cursor.fetchone()
    conn.close()
    return user

def get_expensive_products(min_price):
    """Retrieves products above a certain price."""
    conn = get_connection()
    cursor = conn.cursor()
    sql = """
        SELECT product_name, price
        FROM products
        WHERE price > ?
        ORDER BY price DESC
    """
    cursor.execute(sql, (min_price,))
    products = cursor.fetchall()
    conn.close()
    return products

if __name__ == "__main__":
    # Example usage (won't run without db setup, just for analysis)
    add_user("Alice", "alice@example.com")
    user_data = get_user_by_email("alice@example.com")
    expensive = get_expensive_products(50.0)