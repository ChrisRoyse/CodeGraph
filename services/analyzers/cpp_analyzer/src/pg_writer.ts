import { Pool } from 'pg';

const PG_HOST = process.env.PG_HOST || 'localhost';
const PG_PORT = parseInt(process.env.PG_PORT || '5432', 10);
const PG_USER = process.env.PG_USER || 'codegraph';
const PG_PASSWORD = process.env.PG_PASSWORD || 'codegraph';
const PG_DATABASE = process.env.PG_DATABASE || 'codegraph';

export const pgPool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
});

export async function wipeTables() {
  await pgPool.query('TRUNCATE TABLE code_relationships, code_nodes RESTART IDENTITY CASCADE;');
}

export async function batchInsertNodes(nodes: any[]) {
  if (!nodes || nodes.length === 0) return;
  const query = `
    INSERT INTO code_nodes (id, name, type, language, file_path, properties)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO NOTHING;
  `;
  for (const n of nodes) {
    await pgPool.query(query, [
      n.id,
      n.name,
      n.type,
      n.language,
      n.file_path,
      JSON.stringify(n.properties || {})
    ]);
  }
}

export async function batchInsertRelationships(rels: any[]) {
  if (!rels || rels.length === 0) return;
  const query = `
    INSERT INTO code_relationships (source_id, target_id, type, properties)
    VALUES ($1, $2, $3, $4);
  `;
  for (const r of rels) {
    await pgPool.query(query, [
      r.source_id,
      r.target_id,
      r.type,
      JSON.stringify(r.properties || {})
    ]);
  }
}
