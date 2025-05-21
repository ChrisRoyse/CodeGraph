-- polyglot_test_app/database_sql/queries.sql
-- Sample queries used conceptually by the backend

-- Fetch an item by its ID
SELECT id, name, description FROM items WHERE id = ?;

-- Insert a new item
INSERT INTO items (name, description) VALUES (?, ?);

-- Fetch a user by username
SELECT user_id, username, email FROM users WHERE username = ?;

-- End of queries.sql
