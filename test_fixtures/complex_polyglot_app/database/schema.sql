-- Basic schema for the polyglot test application database (PostgreSQL)

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products table (example)
CREATE TABLE IF NOT EXISTS products (
    product_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Orders table linking users and products (Many-to-Many relationship example)
CREATE TABLE IF NOT EXISTS orders (
    order_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    order_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE -- Link to users table
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    price_at_time DECIMAL(10, 2) NOT NULL, -- Price when the order was placed
    FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE, -- Link to orders table
    FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE RESTRICT -- Link to products table
);

-- Add some initial data for testing
INSERT INTO users (username, email) VALUES
('testuser1', 'test1@example.com'),
('deno_caller', 'deno@example.com'),
('python_user', 'python@example.com')
ON CONFLICT (username) DO NOTHING; -- Avoid errors if run multiple times

INSERT INTO products (name, description, price) VALUES
('Test Widget', 'A standard widget for testing.', 19.99),
('Polyglot Gadget', 'Works with multiple languages!', 49.50)
ON CONFLICT (name) DO NOTHING;

-- Example index
CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_order_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_item_product ON order_items(product_id);

-- A stored procedure or function example (PostgreSQL syntax)
CREATE OR REPLACE FUNCTION get_user_order_count(p_user_id INT)
RETURNS INT AS $$
DECLARE
    order_count INT;
BEGIN
    SELECT COUNT(*)
    INTO order_count
    FROM orders
    WHERE user_id = p_user_id;

    RETURN order_count;
END;
$$ LANGUAGE plpgsql;

-- Grant usage (adjust permissions as needed for your DB user)
-- GRANT EXECUTE ON FUNCTION get_user_order_count(INT) TO testuser;

-- End of schema