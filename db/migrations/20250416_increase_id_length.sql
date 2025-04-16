-- Migration: Increase id column length for code_nodes and code_relationships foreign keys
ALTER TABLE code_nodes ALTER COLUMN id TYPE character varying(256);
ALTER TABLE code_relationships ALTER COLUMN source_id TYPE character varying(256);
ALTER TABLE code_relationships ALTER COLUMN target_id TYPE character varying(256);
