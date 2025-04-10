-- Table to store information about analyzed files
CREATE TABLE files (
    file_id SERIAL PRIMARY KEY,
    -- project_id INT NULL REFERENCES projects(project_id), -- Optional: Add if supporting multiple projects
    relative_path TEXT NOT NULL,                     -- Path relative to the analyzed root, normalized (e.g., using '/')
    language VARCHAR(50) NOT NULL,                   -- Language identifier (e.g., 'python', 'javascript')
    code_hash VARCHAR(64),                           -- SHA-256 hash of the file content when last analyzed
    last_analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Ensure unique file paths within a project (if project_id is added) or globally
    UNIQUE (relative_path) -- Adjust if project_id is added: UNIQUE (project_id, relative_path)
);

COMMENT ON COLUMN files.relative_path IS 'Path relative to the analyzed root, normalized using forward slashes.';
COMMENT ON COLUMN files.code_hash IS 'SHA-256 hash of the file content at the time of analysis, used for change detection.';

-- Table to store identified code elements (nodes)
CREATE TABLE nodes (
    node_id VARCHAR(255) PRIMARY KEY,              -- Global ID (lang:sha256(normalized_path:canonical_identifier))
    file_id INT NOT NULL REFERENCES files(file_id) ON DELETE CASCADE, -- Foreign key to the file containing this node
    node_type VARCHAR(100) NOT NULL,               -- High-level type (e.g., Function, Class, Variable, Import, Call, Table, Column, ApiEndpoint)
    name TEXT,                                     -- Common name or identifier (e.g., function name, class name, variable name)
    start_line INT,                                -- Start line number (1-based)
    start_column INT,                              -- Start column number (0-based)
    end_line INT,                                  -- End line number (1-based)
    end_column INT,                                -- End column number (0-based)
    properties JSONB DEFAULT '{}'::jsonb           -- Flexible key-value store for language-specific metadata (e.g., is_async, visibility, signature, parameters, return_type, decorators, url, http_method)

    -- Optional: Add full text search index later if needed on name/properties
    -- Optional: Add specific indexes on common properties within JSONB if performance requires it
);

COMMENT ON COLUMN nodes.node_id IS 'Global ID: lang:sha256(normalized_relative_path:canonical_identifier)';
COMMENT ON COLUMN nodes.node_type IS 'High-level, cross-language node type (e.g., Function, Class, Variable, Import, Call, Table, Column, ApiEndpoint). Original language-specific type can be stored in properties.';
COMMENT ON COLUMN nodes.properties IS 'JSONB field for flexible metadata: is_async, visibility, signature, parameters, return_type, decorators, url, http_method, original_node_type, etc.';

-- Table to store relationships between nodes
CREATE TABLE relationships (
    relationship_id SERIAL PRIMARY KEY,
    source_node_id VARCHAR(255) NOT NULL REFERENCES nodes(node_id) ON DELETE CASCADE, -- Source node Global ID
    target_node_id VARCHAR(255) NULL REFERENCES nodes(node_id) ON DELETE SET NULL, -- Target node Global ID (NULL if unresolved initially)
    target_identifier TEXT NULL,                     -- The raw identifier string used by the source to reference the target (e.g., import path, function name, URL)
    relationship_type VARCHAR(50) NOT NULL,          -- High-level type (e.g., CALLS, IMPORTS, INHERITS, DEFINES, REFERENCES, QUERIES, MODIFIES, USES_COLUMN, CALLS_API)
    file_id INT NOT NULL REFERENCES files(file_id) ON DELETE CASCADE, -- Foreign key to the file where the relationship originates
    start_line INT,                                -- Start line number (1-based) where relationship occurs
    start_column INT,                              -- Start column number (0-based)
    end_line INT,                                  -- End line number (1-based)
    end_column INT,                                -- End column number (0-based)
    properties JSONB DEFAULT '{}'::jsonb           -- Flexible key-value store for relationship metadata (e.g., alias for imports, type of call)
);

COMMENT ON COLUMN relationships.target_node_id IS 'Global ID of the target node. NULL if the relationship is unresolved (e.g., an import path or function name not yet linked to a specific node).';
COMMENT ON COLUMN relationships.target_identifier IS 'The raw string identifier used in the source code to reference the target (e.g., "requests.get", "../utils", "users.user_id"). Used during the resolution phase.';
COMMENT ON COLUMN relationships.relationship_type IS 'High-level, cross-language relationship type (e.g., CALLS, IMPORTS, INHERITS, DEFINES, REFERENCES, QUERIES_TABLE, CALLS_API). Original language-specific type can be stored in properties.';
COMMENT ON COLUMN relationships.properties IS 'JSONB field for flexible metadata: import alias, call arguments (simplified), etc.';

-- Optional: Table for tracking analysis errors
-- CREATE TABLE analysis_errors (
--     error_id SERIAL PRIMARY KEY,
--     file_id INT REFERENCES files(file_id) ON DELETE CASCADE,
--     analyzer_name VARCHAR(100),
--     error_type VARCHAR(100),
--     message TEXT,
--     line INT,
--     column INT,
--     timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
-- );

-- Indexes for nodes table
CREATE INDEX idx_nodes_file_id ON nodes(file_id);
CREATE INDEX idx_nodes_node_type ON nodes(node_type);
CREATE INDEX idx_nodes_name ON nodes(name);

-- Indexes for relationships table
CREATE INDEX idx_relationships_source_id ON relationships(source_node_id);
CREATE INDEX idx_relationships_target_id ON relationships(target_node_id);
CREATE INDEX idx_relationships_type ON relationships(relationship_type);
CREATE INDEX idx_relationships_file_id ON relationships(file_id);
CREATE INDEX idx_relationships_target_identifier ON relationships(target_identifier);