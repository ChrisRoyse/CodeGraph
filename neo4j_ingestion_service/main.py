# neo4j_ingestion_service/main.py

import grpc
from concurrent import futures
import time
import os
import logging
from neo4j import GraphDatabase, basic_auth
import json

from google.protobuf import json_format # Added for Struct conversion
# Assuming protobufs are generated in a 'protobufs' directory relative to project root
# and added to PYTHONPATH or installed. Adjust if necessary.
# Add the generated protobuf code directory to the Python path
GENERATED_SRC_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'generated', 'src'))
import sys
if GENERATED_SRC_PATH not in sys.path:
    sys.path.append(GENERATED_SRC_PATH)

# --- gRPC Imports ---
try:
    import neo4j_ingestion_pb2
    import neo4j_ingestion_pb2_grpc
    Status = neo4j_ingestion_pb2.Status # Use the enum from this service's proto
except ImportError:
    logging.error(f"Could not import generated gRPC modules. Did you run './generate_grpc.sh' and ensure '{GENERATED_SRC_PATH}' is in PYTHONPATH?")
    sys.exit(1)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)
# --- Configuration ---
NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password") # Replace with your actual default or raise error
# BATCH_SIZE = 1000 # Batch size for UNWIND, Neo4j handles this efficiently
# --- Helper Functions ---

def get_neo4j_driver():
    """Establishes connection to Neo4j."""
    try:
        # Consider adding connection pool settings if needed (e.g., max_connection_lifetime)
        driver = GraphDatabase.driver(NEO4J_URI, auth=basic_auth(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        logger.info(f"Successfully connected to Neo4j at {NEO4J_URI}")
        return driver
    except Exception as e:
        logger.error(f"Failed to connect to Neo4j: {e}")
        raise

def _struct_to_dict(struct_proto):
    """Converts a Protobuf Struct to a Python dictionary."""
    # Use json_format which handles nested structures and types correctly
    return json_format.MessageToDict(struct_proto)
# Removed CSV reading and Cypher generation helpers, replaced by direct logic in IngestCpg
# --- gRPC Service Implementation ---

class Neo4jIngestionServicer(neo4j_ingestion_pb2_grpc.Neo4jIngestionServicer):
    def __init__(self):
        self.driver = None # Initialize later
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

    def IngestCpg(self, request, context):
        """Handles the gRPC request to ingest filtered CPG data for incremental updates."""
        nodes = request.filtered_nodes
        relationships = request.filtered_relationships
        deleted_files = list(request.deleted_files) # Convert to list
        sql_results_json = request.sql_analysis_results_json # Added for SQL data


        logger.info(f"Received IngestCpg request:")
        logger.info(f"  Nodes to merge/update: {len(nodes)}")
        logger.info(f"  Relationships to merge/update: {len(relationships)}")
        logger.info(f"  Files to delete nodes for: {len(deleted_files)}")

        logger.info(f"  SQL Results JSON size: {len(sql_results_json)} bytes")

        # Ensure driver is available
        if not self.driver:
             logger.error("Neo4j driver not available. Attempting to reconnect...")
             try:
                 self.driver = get_neo4j_driver()
             except Exception as e:
                 logger.error(f"Reconnection attempt failed: {e}")
                 context.set_code(grpc.StatusCode.UNAVAILABLE)
                 context.set_details(f"Neo4j connection failed: {e}")
                 return neo4j_ingestion_pb2.IngestCpgResponse(status=Status.FAILURE, message=f"Neo4j connection failed: {e}")

        # Prepare data for Cypher queries
        try:
            nodes_data = [
                {
                    "entity_id": node.entity_id,
                    "filepath": node.filepath,
                    "properties": _struct_to_dict(node.properties)
                } for node in nodes
            ]
            rels_data = [
                {
                    "entity_id": rel.entity_id,
                    "start_node_id": rel.start_node_id,
                    "end_node_id": rel.end_node_id,
                    "type": rel.type,
                    "properties": _struct_to_dict(rel.properties)
                } for rel in relationships
            ]
            # Extract filepaths associated with the nodes being updated/added
            modified_files = list(set(node.filepath for node in nodes if node.filepath))


            # Parse SQL JSON data
            sql_data = None
            if sql_results_json and sql_results_json != '{}': # Check if JSON is not empty
                try:
                    sql_data = json.loads(sql_results_json)
                    logger.info(f"Successfully parsed SQL analysis JSON. Found {len(sql_data.get('tables', []))} tables, {len(sql_data.get('statements', []))} statements.")
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse SQL analysis JSON: {e}. Proceeding without SQL ingestion.")
                    sql_data = None # Ensure sql_data is None if parsing fails
            else:
                logger.info("No SQL analysis results provided or JSON is empty.")

        except Exception as e:
            logger.exception("Error preparing data for Cypher parameters.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Error preparing data: {e}")
            return neo4j_ingestion_pb2.IngestCpgResponse(status=Status.FAILURE, message=f"Error preparing data: {e}")


        # Define Cypher queries
        # Note: Using filepath property for deletion assumes it exists and is consistent.
        delete_by_deleted_file_query = """
        UNWIND $deleted_files AS filepath
        MATCH (n) WHERE n.filepath = filepath
        DETACH DELETE n
        """
        # Delete nodes associated with *modified* files first before merging new data for them
        delete_by_modified_file_query = """
        UNWIND $modified_files AS filepath
        MATCH (n) WHERE n.filepath = filepath
        DETACH DELETE n
        """
        # Merge nodes based on entityId, update properties and filepath
        merge_nodes_query = """
        UNWIND $nodes_data AS node_map
        MERGE (n {entityId: node_map.entity_id})
        SET n += node_map.properties // Add/update properties
        SET n.filepath = node_map.filepath // Set/update filepath
        // Add label handling here if needed, e.g., using node_map.properties.labels
        """
        # Merge relationships based on entityId, store type as property
        merge_rels_query = """
        UNWIND $rels_data AS rel_map
        MATCH (a {entityId: rel_map.start_node_id})
        MATCH (b {entityId: rel_map.end_node_id})
        MERGE (a)-[r:REL {entityId: rel_map.entity_id}]->(b) // Generic :REL label
        SET r += rel_map.properties // Add/update properties
        SET r.type = rel_map.type // Store specific type as property
        SET r.entityId = rel_map.entity_id // Ensure entityId is set
        """


        # --- SQL Ingestion Queries ---
        # Merge SQL Tables and Columns
        merge_sql_tables_cols_query = """
        UNWIND $sql_tables AS table_data
        MERGE (t:SqlTable {name: table_data.name})
        SET t.filepath = table_data.filepath
        WITH t, table_data.columns AS column_names
        UNWIND column_names AS col_name
        MERGE (c:SqlColumn {name: t.name + '.' + col_name}) // Create unique name
        SET c.tableName = t.name
        MERGE (t)-[:CONTAINS_COLUMN]->(c)
        """

        # Merge SQL Statements and link them
        merge_sql_statements_query = """
        UNWIND $sql_statements AS stmt_data
        MERGE (s:SqlStatement {id: stmt_data.id})
        SET s += apoc.map.clean(stmt_data, ['id', 'references_tables', 'references_columns'], []) // Set properties except linking keys

        // Link statement to tables it references
        WITH s, stmt_data
        UNWIND stmt_data.references_tables AS table_name
        MATCH (t:SqlTable {name: table_name})
        MERGE (s)-[:REFERENCES_TABLE]->(t)

        // Link statement to columns it references
        WITH s, stmt_data
        UNWIND stmt_data.references_columns AS col_ref_name // Assuming format 'table.column'
        MATCH (c:SqlColumn {name: col_ref_name})
        MERGE (s)-[:REFERENCES_COLUMN]->(c)
        """

        # Execute in a single transaction
        try:
            with self.driver.session(database="neo4j") as session: # Specify database if needed
                summary = session.execute_write(
                    self._run_ingestion_transaction,
                    deleted_files,
                    modified_files,
                    nodes_data,
                    rels_data,
                    sql_data, # Added

                    delete_by_deleted_file_query,
                    delete_by_modified_file_query,
                    merge_nodes_query,
                    merge_rels_query,
                    merge_sql_tables_cols_query, # Added
                    merge_sql_statements_query # Added
                )
                # summary contains counters like nodes_created, relationships_deleted etc.
                nodes_deleted = summary.counters.nodes_deleted
                rels_deleted = summary.counters.relationships_deleted
                nodes_created = summary.counters.nodes_created
                rels_created = summary.counters.relationships_created
                props_set = summary.counters.properties_set
                sql_nodes_created = summary.counters.nodes_created - nodes_created # Approx SQL nodes
                sql_rels_created = summary.counters.relationships_created - rels_created # Approx SQL rels


                success_msg = (
                    f"Ingestion successful. "
                    f"Deleted Nodes: {nodes_deleted}, Deleted Rels: {rels_deleted}. "
                    f"Created Nodes: {nodes_created}, Created Rels: {rels_created}. "
                    f"Properties Set: {props_set}."
                    f"SQL Nodes Approx: {sql_nodes_created}, SQL Rels Approx: {sql_rels_created}. "

                )
                logger.info(success_msg)
                return neo4j_ingestion_pb2.IngestCpgResponse(status=Status.SUCCESS, message=success_msg)

        except Exception as e:
            logger.exception("Error during Neo4j ingestion transaction.")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Neo4j transaction failed: {e}")
            return neo4j_ingestion_pb2.IngestCpgResponse(status=Status.FAILURE, message=f"Neo4j transaction failed: {e}")

    @staticmethod
    def _run_ingestion_transaction(tx, deleted_files, modified_files, nodes_data, rels_data,
                                   sql_data, # Added
                                   delete_del_query, delete_mod_query, merge_nodes_query, merge_rels_query,
                                   merge_sql_tables_cols_query, merge_sql_statements_query): # Added SQL queries & corrected name
        """Function executed within a managed Neo4j transaction."""
        logger.info("Starting ingestion transaction...")
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
                result_sql_tables = tx.run(merge_sql_tables_query, sql_tables=sql_tables)
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
                        # Assuming the analysis service provides column names already qualified
                        pass # No preprocessing needed based on current assumption

                logger.info(f"Executing merge for {len(sql_statements)} SQL statements and relationships...")
                # Ensure APOC is available for map.clean
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

        logger.info("Ingestion transaction finished.")
        # Combine summaries if needed, or just return the last one (or a combined object)
        # For simplicity, just returning the last summary, but ideally combine counters.
        # Let's return the final relationship summary as it's the last step.
        # A better approach would be to aggregate counters from all steps.
        # final_summary = summary_rels or summary_nodes or summary_del_modified or summary_del_deleted # Replaced by aggregation below
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
        from neo4j.summary import ResultSummary, SummaryCounters
        final_summary_obj = ResultSummary(server=None, database=None, query=None, parameters=None)
        final_summary_obj._counters = SummaryCounters(total_counters)

        return final_summary_obj # Return the aggregated summary object

        # return final_summary # Replaced by aggregated summary object return

# --- Server Setup ---

def serve():
    """Starts the gRPC server."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    # Create service instance here
    service_instance = Neo4jIngestionServicer()
    neo4j_ingestion_pb2_grpc.add_Neo4jIngestionServicer_to_server(
        service_instance, server
    )
    port = os.getenv("NEO4J_INGESTION_PORT", "50053") # Allow port configuration via env var
    try:
        server.add_insecure_port(f"[::]:{port}")
        server.start()
        logging.info(f"Neo4j Ingestion Service started on port {port}")
        server.wait_for_termination() # Keep server running until terminated
    except OSError as e:
         logger.error(f"Failed to start server on port {port}: {e}. Port might be in use.")
    except KeyboardInterrupt:
        logger.info("Stopping Neo4j Ingestion Service...")
    finally:
        # Ensure driver is closed if server stops unexpectedly
        if service_instance and service_instance.driver:
             logger.info("Neo4j driver closed during server shutdown.")
        server.stop(0) # Graceful stop
        logger.info("Server stopped.")

if __name__ == "__main__":
    serve()