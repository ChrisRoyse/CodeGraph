import os
from dotenv import load_dotenv
load_dotenv()
import psycopg2
import psycopg2.extras

PG_HOST = os.getenv("POSTGRES_HOST", "localhost")
PG_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
PG_USER = os.getenv("POSTGRES_USER", "postgres")
PG_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
PG_DATABASE = os.getenv("POSTGRES_DB", "codegraph")

def get_pg_conn():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        user=PG_USER,
        password=PG_PASSWORD,
        dbname=PG_DATABASE
    )

def wipe_tables():
    """Truncate code_nodes and code_relationships tables before analysis."""
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE code_relationships, code_nodes RESTART IDENTITY CASCADE;")
        conn.commit()

def batch_insert_nodes(nodes):
    """Insert a list of node dicts into code_nodes."""
    if not nodes:
        return
    import logging
    logger = logging.getLogger(__name__)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            args = [
                (
                    n['canonical_id'], n['name'], n['type'], 'python', n['path'],
                    psycopg2.extras.Json(n.get('properties', {}))
                )
                for n in nodes
            ]
            logger.info(f"[DEBUG] batch_insert_nodes: inserting node canonical_ids: {[n['canonical_id'] for n in nodes]}")
            cur.executemany(
                """
                INSERT INTO code_nodes (id, name, type, language, file_path, properties)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING;
                """,
                args
            )
        conn.commit()

def batch_insert_relationships(rels):
    """Insert a list of relationship dicts into code_relationships."""
    if not rels:
        return
    import logging
    logger = logging.getLogger(__name__)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            args = [
                (
                    r['source_canonical_id'], r['target_canonical_id'], r['type'],
                    psycopg2.extras.Json(r.get('properties', {}))
                )
                for r in rels
            ]
            logger.info(f"[DEBUG] batch_insert_relationships: inserting source_ids: {[r['source_canonical_id'] for r in rels]}")
            cur.executemany(
                """
                INSERT INTO code_relationships (source_id, target_id, type, properties)
                VALUES (%s, %s, %s, %s);
                """,
                args
            )
        conn.commit()
