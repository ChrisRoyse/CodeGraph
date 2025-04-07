# python_analyzer_service/main.py
import os
import sys
import grpc
import logging
from concurrent import futures

# Ensure the generated directory is in the path
# This might be needed if PYTHONPATH isn't sufficient or for local execution
# generated_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'generated', 'src'))
# if generated_path not in sys.path:
#     sys.path.insert(0, generated_path)

try:
    # Assuming PYTHONPATH is set correctly in Docker environment to find 'generated.src'
    from generated.src import analyzer_pb2
    from generated.src import analyzer_pb2_grpc
except ImportError as e:
    print(f"Error importing generated gRPC modules: {e}", file=sys.stderr)
    print(f"Sys.path: {sys.path}", file=sys.stderr)
    sys.exit(1)

# Tree-sitter imports (will be used later)
# from tree_sitter import Language, Parser
# from tree_sitter_languages import get_language, get_parser

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Service Implementation ---
class PythonAnalyzerService(analyzer_pb2_grpc.AnalyzerServiceServicer):
    def AnalyzeCode(self, request, context):
        """
        Receives code analysis requests, performs parsing (stubbed),
        and eventually sends results to the ingestor.
        """
        logger.info(f"Received analysis request for: {request.file_path} (Language: {request.language})")

        # --- Placeholder for Tree-sitter Parsing ---
        try:
            # Example setup (actual parsing logic to be added later)
            # parser = get_parser('python')
            # language = get_language('python')
            # parser.set_language(language)
            # tree = parser.parse(bytes(request.file_content, "utf8"))
            # root_node = tree.root_node
            logger.info(f"Stub analysis for {request.file_path}...")
            # TODO: Implement actual Tree-sitter parsing and CPG generation
            # TODO: Generate persistent entity IDs
            # TODO: Convert CPG data to standardized Protobuf format
            # TODO: Implement gRPC client to send results to Neo4j Ingestion Service

            # For now, just return success
            return analyzer_pb2.AnalyzeCodeResponse(
                status="SUCCESS", # Or "DISPATCHED" depending on final design
                message=f"Successfully received analysis request for {request.file_path}"
            )
        except Exception as e:
            logger.exception(f"Error during stub analysis for {request.file_path}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Internal error during analysis: {str(e)}")
            return analyzer_pb2.AnalyzeCodeResponse(
                status="FAILED",
                message=f"Error analyzing {request.file_path}: {str(e)}"
            )

# --- Server Setup ---
def serve():
    """Starts the gRPC server."""
    port = os.getenv('GRPC_PORT', '50056') # Default to 50056 if not set
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    analyzer_pb2_grpc.add_AnalyzerServiceServicer_to_server(PythonAnalyzerService(), server)
    server_address = f'[::]:{port}' # Listen on all interfaces
    server.add_insecure_port(server_address)
    logger.info(f"Starting Python Analyzer gRPC server on {server_address}")
    server.start()
    logger.info("Server started.")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()