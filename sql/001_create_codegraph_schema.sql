-- CodeGraph SQL Schema Migration

CREATE TABLE IF NOT EXISTS code_nodes (
    id VARCHAR(64) PRIMARY KEY, -- canonical ID
    name TEXT NOT NULL,
    type TEXT NOT NULL,         -- function, class, variable, etc.
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    properties JSONB,           -- async, params, visibility, etc.
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS code_relationships (
    id SERIAL PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL REFERENCES code_nodes(id),
    target_id VARCHAR(64) NOT NULL REFERENCES code_nodes(id),
    type TEXT NOT NULL,         -- calls, imports, uses, inherits, etc.
    properties JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
