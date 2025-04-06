-- test_fixtures/comprehensive_multi_lang_test/database/schema.sql

-- Define the users table, referenced by backend/db_queries.py
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE
);

-- Example of another table
CREATE TABLE products (
    product_id INTEGER PRIMARY KEY,
    product_name VARCHAR(255) NOT NULL,
    price REAL
);

-- Insert some dummy data (optional, but can be helpful for testing queries)
INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');
INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com');