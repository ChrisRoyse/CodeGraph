import grpc
import json
import logging
import os
import sys
from concurrent import futures
import sqlparse

# Add the project root directory to the Python path to find the generated module
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, project_root)

# Import generated gRPC files
try:
    from generated.src import sql_analysis_pb2
    from generated.src import sql_analysis_pb2_grpc
except ImportError:
    logging.error("Failed to import generated gRPC modules. Make sure 'generate_grpc.sh' ran successfully and 'generated/src' is in the PYTHONPATH.")
    sys.exit(1)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Helper function to extract tables (simplified) ---
def extract_tables_from_statement(statement):
    """
    Extracts potential table names from a parsed SQL statement.
    This is a simplified implementation focusing on identifiers after FROM/JOIN.
    """
    tables = set()
    from_or_join_seen = False
    for token in statement.flatten():
        # Check for FROM or JOIN keywords
        if token.ttype is sqlparse.tokens.Keyword and token.value.upper() in ('FROM', 'JOIN'):
            from_or_join_seen = True
            continue # Move to the next token after FROM/JOIN

        # If we just saw FROM/JOIN, look for identifiers (potential table names)
        if from_or_join_seen:
            if isinstance(token, sqlparse.sql.Identifier):
                tables.add(token.get_real_name())
                from_or_join_seen = False # Reset after finding the first identifier
            elif isinstance(token, sqlparse.sql.IdentifierList):
                 for identifier in token.get_identifiers():
                     tables.add(identifier.get_real_name())
                 from_or_join_seen = False # Reset after processing list
            # Simple heuristic: stop looking for tables after the first identifier/list
            # This avoids capturing column names or aliases in simple cases.
            # More robust parsing would be needed for complex queries.

        # Reset if we encounter punctuation like a comma or semicolon in some contexts
        # or another keyword that isn't part of a table name sequence
        if token.ttype is sqlparse.tokens.Punctuation or \
           (token.ttype is sqlparse.tokens.Keyword and token.value.upper() not in ('AS',)): # Allow AS for aliases
             from_or_join_seen = False

    return list(tables)

# --- Servicer Implementation ---
class SqlAnalysisServicer(sql_analysis_pb2_grpc.SqlAnalysisServicer):
    """Provides methods that implement functionality of SQL analysis server."""

    def AnalyzeSql(self, request, context):
        """
        Analyzes the SQL file specified in the request.
        Reads the file, parses it using sqlparse, extracts basic info,
        and returns results as JSON.
        """
        file_path = request.file_path
        logging.info(f"Received request to analyze SQL file: {file_path}")
        analysis_results = {'statements': []}
        status = sql_analysis_pb2.AnalysisStatus.SUCCESS

        try:
            # Ensure the file path is absolute or resolve it relative to a base path if necessary
            # For simplicity, assuming file_path is accessible directly for now.
            # In a real scenario, consider security and path validation carefully.
            if not os.path.exists(file_path):
                 logging.error(f"File not found: {file_path}")
                 # Returning FAILED status but empty results for now
                 return sql_analysis_pb2.SqlAnalysisResponse(
                     analysis_results_json=json.dumps({"error": f"File not found: {file_path}"}),
                     status=sql_analysis_pb2.AnalysisStatus.FAILED
                 )

            with open(file_path, 'r', encoding='utf-8') as f:
                sql_content = f.read()

            parsed_statements = sqlparse.parse(sql_content)

            if not parsed_statements:
                logging.warning(f"No SQL statements found or parsed in file: {file_path}")
                # Return success but indicate no statements found
                analysis_results['message'] = "No SQL statements found or parsed."


            for stmt in parsed_statements:
                if not stmt.token_first(skip_ws=True): # Skip empty statements
                    continue
                stmt_type = stmt.get_type()
                tables = extract_tables_from_statement(stmt)
                analysis_results['statements'].append({
                    'type': stmt_type,
                    'tables': tables,
                    # 'raw': str(stmt) # Optionally include raw statement text
                })
            logging.info(f"Successfully parsed {len(analysis_results['statements'])} statements from {file_path}")

        except FileNotFoundError:
            logging.error(f"File not found during analysis: {file_path}")
            analysis_results = {'error': f"File not found: {file_path}"}
            status = sql_analysis_pb2.AnalysisStatus.FAILED
        except Exception as e:
            logging.error(f"An error occurred during SQL analysis for {file_path}: {e}", exc_info=True)
            analysis_results = {'error': f"An internal error occurred during parsing: {str(e)}"}
            status = sql_analysis_pb2.AnalysisStatus.FAILED

        # Convert results dictionary to JSON string
        try:
            results_json = json.dumps(analysis_results, indent=2)
        except TypeError as e:
             logging.error(f"Failed to serialize analysis results to JSON: {e}")
             results_json = json.dumps({'error': 'Failed to serialize results to JSON.'})
             status = sql_analysis_pb2.AnalysisStatus.FAILED


        return sql_analysis_pb2.SqlAnalysisResponse(
            analysis_results_json=results_json,
            status=status
        )

# --- Server Setup ---
def serve():
    """Starts the gRPC server."""
    port = os.environ.get('SQL_ANALYSIS_PORT', '50054') # Use env var or default
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    sql_analysis_pb2_grpc.add_SqlAnalysisServicer_to_server(SqlAnalysisServicer(), server)
    server.add_insecure_port(f'[::]:{port}')
    server.start()
    logging.info(f"SQL Analysis Service started on port {port}")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()