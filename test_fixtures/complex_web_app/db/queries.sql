-- Sample queries for the complex web app example

-- name: GET_ITEM_BY_ID
SELECT id, data, user_id, last_updated
FROM items
WHERE id = ?; -- Parameter placeholder (e.g., for prepared statements)

-- name: GET_ALL_USERS
SELECT id, name, email, created_at
FROM users
ORDER BY created_at DESC;

-- name: UPDATE_ITEM_DATA
UPDATE items
SET data = ?, last_updated = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: INSERT_USER
INSERT INTO users (name, email)
VALUES (?, ?);