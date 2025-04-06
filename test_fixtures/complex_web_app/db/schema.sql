-- Basic schema for the complex web app example

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE items (
    id VARCHAR(50) PRIMARY KEY, -- Using VARCHAR for potentially non-numeric IDs like 'test'
    data TEXT,
    user_id INTEGER REFERENCES users(id), -- Link items to users
    last_updated TIMESTAMP
);

-- Add indexes for faster lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_items_user_id ON items(user_id);