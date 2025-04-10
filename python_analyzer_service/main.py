# python_analyzer_service/main.py
import os
import sys
import grpc
import logging
import ast
import hashlib
import atexit # For pool cleanup
from concurrent import futures

# Import visitor component
from .visitor import CodeAnalyzerVisitor
# Ensure visitor_helpers and scope_manager are importable if visitor uses them
from . import api_client # Import the new API client
# (Python's import system should handle this if they are in the same package)

# Import protobufs - Assuming StatusResponse is defined in analyzer.proto
try:
    from generated.src import analyzer_pb2
    from generated.src import analyzer_pb2_grpc
except ImportError as e:
    print(f"Error importing generated gRPC modules: {e}", file=sys.stderr)
    print("Ensure protobufs are generated and PYTHONPATH includes 'generated/src'.", file=sys.stderr)
    sys.exit(1)

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Service Implementation ---
class PythonAnalyzerService(analyzer_pb2_grpc.AnalyzerServiceServicer):

    # __init__ removed as DB pool initialization is no longer needed.
    def AnalyzeCode(self, request: analyzer_pb2.AnalyzeCodeRequest, context) -> analyzer_pb2.StatusResponse:
        """
        Receives code analysis requests, parses using AST, extracts data,
        and writes results to the PostgreSQL database.
        Returns a StatusResponse indicating success or failure.
        """
        logger.info(f"Received analysis request for: {request.file_path} (Language: {request.language})")
        relative_path = request.file_path # Assuming file_path is relative
        language = request.language.lower()
        code_content = request.file_content

        if language != "python":
             logger.warning(f"Received request for non-python language: {language}")
             return analyzer_pb2.StatusResponse(
                 status="ERROR",
                 message=f"Unsupported language: {language}. Expected Python."
             )

        status = "SUCCESS"
        message = "Analysis complete and saved."
        # file_id removed as it was DB-specific

        try:
            # 1. Calculate code hash
            code_hash = hashlib.sha256(code_content.encode('utf-8')).hexdigest()
            logger.info(f"Code hash for {relative_path}: {code_hash[:8]}...")

            # 2. Get or Create File ID from DB
            # Database interaction for file_id removed
            logger.info(f"Processing file: {relative_path}")

            # 3. Parse code into AST
            logger.info(f"Parsing Python code for {relative_path}...")
            parsed_ast = ast.parse(code_content, filename=relative_path)
            logger.info(f"AST parsing successful for {relative_path}.")

            # 4. Run the visitor
            # Pass relative_path, file_id, and code_content
            # Pass relative_path and code_content (file_id removed)
            visitor = CodeAnalyzerVisitor(relative_path, code_content)
            visitor.visit(parsed_ast)
            nodes_data, relationships_data = visitor.get_results()
            logger.info(f"AST analysis complete. Nodes: {len(nodes_data)}, Relationships: {len(relationships_data)}")

            # 5. Prepare and send data via API
            analysis_data = {
                # "filePath": relative_path, # Removed: Not part of the AnalysisData schema
                "nodes": nodes_data,
                "relationships": relationships_data
            }
            logger.info(f"Prepared analysis data for API submission for {relative_path}.")

            # Call the API client to send data
            api_success = api_client.send_analysis_data(analysis_data)

            if not api_success:
                # If API call fails, set status to ERROR and update message
                status = "ERROR"
                message = f"Analysis complete but failed to send data to API for {relative_path}."
                logger.error(message)
            else:
                # Keep original success message if API call succeeds
                message = f"Analysis complete and data sent to API for {relative_path}."
                logger.info(message)

        except SyntaxError as e:
            logger.error(f"Syntax error during parsing of {relative_path}: {e}")
            status = "ERROR"
            line = getattr(e, 'lineno', 1)
            col = getattr(e, 'offset', 0)
            message = f"Syntax error in {relative_path} at line {line}, offset {col}: {e.msg}"
            # Optionally: Write an error marker to the DB if needed
        # Removed specific database error handling block entirely
        except Exception as e:
            logger.exception(f"Unexpected error during analysis for {relative_path}")
            status = "ERROR"
            message = f"Unexpected error analyzing {relative_path}: {str(e)}"

        # Return StatusResponse
        return analyzer_pb2.StatusResponse(
            status=status,
            message=message
        )

# --- Server Setup ---
def serve():
    """Starts the gRPC server and initializes the DB pool."""
    port = os.getenv('GRPC_PORT', '50056')
    max_workers = int(os.getenv('MAX_WORKERS', '10')) # Default to 10 workers

    # Initialize DB pool (moved to service __init__, but double-check if needed here)
    # Removed commented out DB pool initialization

    # Removed DB pool cleanup registration

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=max_workers))
    analyzer_pb2_grpc.add_AnalyzerServiceServicer_to_server(PythonAnalyzerService(), server)
    server_address = f'[::]:{port}'

    # TODO: Add support for secure connection based on environment variables
    server.add_insecure_port(server_address)
    logger.info(f"Starting Python Analyzer gRPC server on {server_address} with {max_workers} workers")
    server.start()
    logger.info("Server started. Waiting for termination...")
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Server stopping due to KeyboardInterrupt.")
        server.stop(0) # Graceful stop
        # Pool cleanup is handled by atexit

if __name__ == '__main__':
    serve()