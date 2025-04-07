# neo4j_ingestion_service/services.py
import grpc
import logging
import json
from neo4j.summary import ResultSummary, SummaryCounters

# Import generated gRPC code
try:
    from generated.src import neo4j_ingestion_pb2, neo4j_ingestion_pb2_grpc
    # Use the enum from this service's proto if needed, e.g., Status = neo4j_ingestion_pb2.Status
except ImportError as e:
    logging.critical(f"Could not import generated gRPC modules from 'generated.src': {e}")
    raise  # Re-raise critical import error

from .database import get_neo4j_driver
from .utils import struct_to_dict

logger = logging.getLogger(__name__)

class Neo4jIngestionServicer(neo4j_ingestion_pb2_grpc.Neo4jIngestionServicer):
    """
    gRPC Servicer implementation for Neo4j Ingestion.
    Handles both CPG-based ingestion (IngestCpg) and unified graph ingestion (IngestGraph).
    """
    def __init__(self):
        self.driver = None
        try:
            self.driver = get_neo4j_driver()
        except Exception as e:
            logger.critical(f"Initial Neo4j connection failed: {e}. Service starting without connection.")
            # Server will still start, but requests will fail until DB is available and reconnect succeeds

    def __del__(self):
        if self.driver:
            logger.info("Closing Neo4j driver.")
            self.driver.close()
            logger.info("Neo4j driver closed.")

    def _ensure_driver(self, context):
        """Checks for driver availability and attempts reconnect if necessary. Returns True if driver is available."""
        if not self.driver:
            logger.error("Neo4j driver not available. Attempting to reconnect...")
            try:
                self.driver = get_neo4j_driver()
                logger.info("Successfully reconnected to Neo4j.")
                return True
            except Exception as e:
                logger.error(f"Reconnection attempt failed: {e}")
                context.set_code(grpc.StatusCode.UNAVAILABLE)
                context.set_details(f"Neo4j connection failed: {e}")
                return False
        return True

    # --- IngestGraph Implementation (New Unified Graph Ingestion) ---
    def IngestGraph(self, request, context):
        """Handles the gRPC request to ingest unified graph data."""
        if not self._ensure_driver(context):
             # Use the specific response type for this RPC
            return neo4j_ingestion_pb2.IngestGraphResponse(
                success=False,
                error_message="Neo4j connection unavailable."
            )

        batch_id = request.batch_id
        nodes = request.nodes
        relationships = request.relationships

        logger.info(f"Received IngestGraph request (Batch ID: {batch_id})")
        logger.info(f"  Nodes received: {len(nodes)}")
        logger.info(f"  Relationships received: {len(relationships)}")

        # Placeholder processing logic
        processed_nodes_count = 0
        for node in nodes:
            # Convert properties map correctly
            node_props = dict(node.properties)
            logger.info(f"  Processing Node - Global ID: {node.global_id}, Type: {node.node_type}, Properties: {node_props}")
            # TODO: Implement actual Cypher generation/execution for node merge using global_id, node_type, secondary_labels, properties
            processed_nodes_count += 1

        processed_relationships_count = 0
        for rel in relationships:
            # Convert properties map correctly
            rel_props = dict(rel.properties)
            logger.info(f"  Processing Relationship - Source: {rel.source_node_global_id}, Target: {rel.target_node_global_id}, Type: {rel.relationship_type}, Properties: {rel_props}")
            # TODO: Implement actual Cypher generation/execution for relationship merge using global_ids, relationship_type, properties
            processed_relationships_count += 1

        logger.info(f"Placeholder processing complete for Batch ID: {batch_id}")

        # Return placeholder success response
        return neo4j_ingestion_pb2.IngestGraphResponse(
            success=True,
            nodes_processed=processed_nodes_count,
            relationships_processed=processed_relationships_count,
            error_message=""
        )

    # --- IngestCpg Implementation (Existing CPG-based Ingestion) ---
    def IngestCpg(self, request, context):
        """Handles the gRPC request to ingest filtered CPG data for incremental updates."""
        if not self._ensure_driver(context):
            # Use the specific response type for this RPC
            return neo4j_ingestion_pb2.IngestCpgResponse(
                status=neo4j_ingestion_pb2.Status.FAILURE, # Assuming Status enum exists
                message="Neo4j connection unavailable."
            )

        nodes = request.filtered_nodes
        relationships = request.filtered_relationships
        deleted_files = list(request.deleted_files)
        sql_results_json = request.sql_analysis_results_json

        logger.info(f"Received IngestCpg request:")
        logger.info(f"  Nodes to merge/update: {len(nodes)}")
        logger.info(f"  Relationships to merge/update: {len(relationships)}")
        logger.info(f"  Files to delete nodes for: {len(deleted_files)}")
        logger.info(f"  SQL Results JSON size: {len(sql_results_json)} bytes")

        # Prepare data for Cypher queries
        try:
            nodes_data = [
                {
                    "entity_id": node.entity_id,
                    "filepath": node.filepath,
                    "properties": struct_to_dict(node.properties) # Use imported util
                } for node in nodes
            ]
            rels_data = [
                {
                    "entity_id": rel.entity_id,
                    "start_node_id": rel.start_node_id,
                    "end_node_id": rel.end_node_id,
                    "type": rel.type,
                    "properties": struct_to_dict(rel.properties) # Use imported util
                } for rel in relationships
            ]
            modified_files = list(set(node.filepath for node in nodes if node.filepath))

            sql_data = None
            if sql_results_json and sql_results_json != '{}':
                try:
                    sql_data = json.loads(sql_results_json)
                    logger.info(f"Successfully parsed SQL analysis JSON. Found {len(sql_data.get('tables', []))} tables, {len(sql_data.get('statements', []))} statements.")
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse SQL analysis JSON: {e}. Proceeding without SQL ingestion.")
                    sql_data = None
            else:
                logger.info("No SQL analysis results provided or JSON is empty.")

        except Exception as e:
            logger.exception("Error preparing data for Cypher parameters.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Error preparing data: {e}")
            return neo4j_ingestion_pb2.IngestCpgResponse(status=neo4j_ingestion_pb2.Status.FAILURE, message=f"Error preparing data: {e}")

        # Define Cypher queries (Keep them here or move to a dedicated cypher_queries.py)
        delete_by_deleted_file_query = """
        UNWIND $deleted_files AS filepath
        MATCH (n) WHERE n.filepath = filepath
        DETACH DELETE n
        """
        delete_by_modified_file_query = """
        UNWIND $modified_files AS filepath
        MATCH (n) WHERE n.filepath = filepath
        DETACH DELETE n
        """
        merge_nodes_query = """
        UNWIND $nodes_data AS node_map
        MERGE (n {entityId: node_map.entity_id})
        SET n += node_map.properties
        SET n.filepath = node_map.filepath
        """
        merge_rels_query = """
        UNWIND $rels_data AS rel_map
        MATCH (a {entityId: rel_map.start_node_id})
        MATCH (b {entityId: rel_map.end_node_id})
        MERGE (a)-[r:REL {entityId: rel_map.entity_id}]->(b)
        SET r += rel_map.properties
        SET r.type = rel_map.type
        SET r.entityId = rel_map.entity_id
        """
        merge_sql_tables_cols_query = """
        UNWIND $sql_tables AS table_data
        MERGE (t:SqlTable {name: table_data.name})
        SET t.filepath = table_data.filepath
        WITH t, table_data.columns AS column_names
        UNWIND column_names AS col_name
        MERGE (c:SqlColumn {name: t.name + '.' + col_name})
        SET c.tableName = t.name
        MERGE (t)-[:CONTAINS_COLUMN]->(c)
        """
        merge_sql_statements_query = """
        UNWIND $sql_statements AS stmt_data
        MERGE (s:SqlStatement {id: stmt_data.id})
        SET s += apoc.map.clean(stmt_data, ['id', 'references_tables', 'references_columns'], [])

        WITH s, stmt_data
        UNWIND stmt_data.references_tables AS table_name
        MATCH (t:SqlTable {name: table_name})
        MERGE (s)-[:REFERENCES_TABLE]->(t)

        WITH s, stmt_data
        UNWIND stmt_data.references_columns AS col_ref_name
        MATCH (c:SqlColumn {name: col_ref_name})
        MERGE (s)-[:REFERENCES_COLUMN]->(c)
        """

        # Execute in a single transaction
        try:
            with self.driver.session(database="neo4j") as session:
                summary = session.execute_write(
                    self._run_ingestion_transaction,
                    deleted_files,
                    modified_files,
                    nodes_data,
                    rels_data,
                    sql_data,
                    delete_by_deleted_file_query,
                    delete_by_modified_file_query,
                    merge_nodes_query,
                    merge_rels_query,
                    merge_sql_tables_cols_query,
                    merge_sql_statements_query
                )
                nodes_deleted = summary.counters.nodes_deleted
                rels_deleted = summary.counters.relationships_deleted
                nodes_created = summary.counters.nodes_created
                rels_created = summary.counters.relationships_created
                props_set = summary.counters.properties_set
                # Approximate SQL counts (consider more precise tracking if needed)
                sql_nodes_created = summary.counters.nodes_created - nodes_created
                sql_rels_created = summary.counters.relationships_created - rels_created

                success_msg = (
                    f"Ingestion successful. "
                    f"Deleted Nodes: {nodes_deleted}, Deleted Rels: {rels_deleted}. "
                    f"Created Nodes: {nodes_created}, Created Rels: {rels_created}. "
                    f"Properties Set: {props_set}. "
                    f"SQL Nodes Approx: {sql_nodes_created}, SQL Rels Approx: {sql_rels_created}."
                )
                logger.info(success_msg)
                return neo4j_ingestion_pb2.IngestCpgResponse(status=neo4j_ingestion_pb2.Status.SUCCESS, message=success_msg)

        except Exception as e:
            logger.exception("Error during Neo4j ingestion transaction.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Neo4j transaction failed: {e}")
            return neo4j_ingestion_pb2.IngestCpgResponse(status=neo4j_ingestion_pb2.Status.FAILURE, message=f"Neo4j transaction failed: {e}")

    @staticmethod
    def _run_ingestion_transaction(tx, deleted_files, modified_files, nodes_data, rels_data,
                                   sql_data,
                                   delete_del_query, delete_mod_query, merge_nodes_query, merge_rels_query,
                                   merge_sql_tables_cols_query, merge_sql_statements_query):
        """Function executed within a managed Neo4j transaction for IngestCpg."""
        logger.info("Starting CPG ingestion transaction...")
        summary_del_deleted = None
        summary_del_modified = None
        summary_nodes = None
        summary_rels = None
        summary_sql_tables = None
        summary_sql_statements = None

        # 1. Delete nodes related to explicitly deleted files
        if deleted_files:
            logger.info(f"Executing delete for {len(deleted_files)} deleted files...")
            result_del_deleted = tx.run(delete_del_query, deleted_files=deleted_files)
            summary_del_deleted = result_del_deleted.consume()
            logger.info(f"Deletion for deleted files summary: {summary_del_deleted.counters}")
        else:
            logger.info("No files in deleted_files list, skipping deletion step 1.")

        # 2. Delete nodes related to modified files (to ensure clean update)
        if modified_files:
            logger.info(f"Executing delete for {len(modified_files)} modified files...")
            result_del_modified = tx.run(delete_mod_query, modified_files=modified_files)
            summary_del_modified = result_del_modified.consume()
            logger.info(f"Deletion for modified files summary: {summary_del_modified.counters}")
        else:
             logger.info("No modified files detected from input nodes, skipping deletion step 2.")

        # 3. Merge nodes
        if nodes_data:
            logger.info(f"Executing merge for {len(nodes_data)} nodes...")
            result_nodes = tx.run(merge_nodes_query, nodes_data=nodes_data)
            summary_nodes = result_nodes.consume()
            logger.info(f"Node merge summary: {summary_nodes.counters}")
        else:
            logger.info("No nodes to merge.")

        # 4. Merge relationships
        if rels_data:
            logger.info(f"Executing merge for {len(rels_data)} relationships...")
            result_rels = tx.run(merge_rels_query, rels_data=rels_data)
            summary_rels = result_rels.consume()
            logger.info(f"Relationship merge summary: {summary_rels.counters}")
        else:
            logger.info("No relationships to merge.")

        # --- SQL Data Ingestion ---
        if sql_data:
            # 5. Merge SQL Tables and Columns
            sql_tables = sql_data.get('tables', [])
            if sql_tables:
                logger.info(f"Executing merge for {len(sql_tables)} SQL tables and their columns...")
                result_sql_tables = tx.run(merge_sql_tables_cols_query, sql_tables=sql_tables)
                summary_sql_tables = result_sql_tables.consume()
                logger.info(f"SQL Table/Column merge summary: {summary_sql_tables.counters}")
            else:
                logger.info("No SQL tables found in data to merge.")

            # 6. Merge SQL Statements and Relationships
            sql_statements = sql_data.get('statements', [])
            if sql_statements:
                # Preprocess column names if necessary (e.g., ensure 'table.column' format)
                for stmt in sql_statements:
                    if 'references_columns' in stmt:
                        pass # Assuming qualified names provided

                logger.info(f"Executing merge for {len(sql_statements)} SQL statements and relationships...")
                try:
                    result_sql_statements = tx.run(merge_sql_statements_query, sql_statements=sql_statements)
                    summary_sql_statements = result_sql_statements.consume()
                    logger.info(f"SQL Statement merge summary: {summary_sql_statements.counters}")
                except Exception as apoc_error:
                     logger.error(f"Error executing SQL statement merge (check APOC availability?): {apoc_error}")
                     # Decide how to handle: raise error, or just log and continue?
                     # For now, log and potentially skip this step if APOC isn't crucial
                     # raise apoc_error # Re-raise to fail the transaction
            else:
                logger.info("No SQL statements found in data to merge.")
        else:
            logger.info("No SQL data provided, skipping SQL ingestion steps.")

        logger.info("CPG Ingestion transaction finished.")
        # Aggregate all summaries
        total_counters = {
            'nodes_created': 0, 'nodes_deleted': 0,
            'relationships_created': 0, 'relationships_deleted': 0,
            'properties_set': 0, 'labels_added': 0, 'labels_removed': 0,
            'indexes_added': 0, 'indexes_removed': 0,
            'constraints_added': 0, 'constraints_removed': 0
        }
        summaries = [summary_del_deleted, summary_del_modified, summary_nodes, summary_rels, summary_sql_tables, summary_sql_statements]
        for s in summaries:
            if s:
                for key, value in s.counters.__dict__.items():
                    if key in total_counters:
                        total_counters[key] += value

        # Create a mock summary object with aggregated counters for the final return
        final_summary_obj = ResultSummary(server=None, database=None, query=None, parameters=None)
        final_summary_obj._counters = SummaryCounters(total_counters)

        return final_summary_obj