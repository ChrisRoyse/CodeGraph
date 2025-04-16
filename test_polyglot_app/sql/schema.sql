-- Basic schema for the polyglot test application

CREATE TABLE IF NOT EXISTS items (
    item_id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_data (
    data_id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    data TEXT,
    FOREIGN KEY (item_id) REFERENCES items(item_id)
);

-- Example query referenced conceptually in db.ts
-- SELECT data FROM item_data WHERE item_id = ?;

-- Example insert
-- INSERT INTO items (item_id, name, description) VALUES (?, ?, ?);
-- INSERT INTO item_data (item_id, data) VALUES (?, ?);