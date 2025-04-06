-- schema.sql

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    order_date DATE NOT NULL,
    status TEXT CHECK(status IN ('pending', 'shipped', 'delivered', 'cancelled')),
    total_amount REAL,
    FOREIGN KEY (customer_id) REFERENCES users(id)
);

CREATE TABLE audit_log (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    user_name TEXT,
    log_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_email ON users(email);
CREATE INDEX idx_order_customer ON orders(customer_id);
CREATE INDEX idx_order_status ON orders(status);

-- Example View (if supported by parser)
CREATE VIEW user_orders AS
SELECT
    u.name AS user_name,
    o.id AS order_id,
    o.order_date,
    o.status
FROM
    users u
JOIN
    orders o ON u.id = o.customer_id;