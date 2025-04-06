-- database/schema.sql

-- Ensure tables are dropped if they exist for a clean setup
DROP TABLE IF EXISTS users;

-- Database Schema Definition
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Insert sample data for testing
INSERT INTO users (username, email) VALUES ('testuser1', 'test1@example.com');
INSERT INTO users (username, email) VALUES ('testuser2', 'test2@example.com');