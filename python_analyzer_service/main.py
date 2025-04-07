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
    def AnalyzeCode(self, request: analyzer_pb2.AnalyzeCodeRequest, context) -> analyzer_pb2.AnalysisResult:
        """
        Receives code analysis requests, performs placeholder parsing,
        and returns a structured AnalysisResult.
        """
        logger.info(f"Received analysis request for: {request.file_path} (Language: {request.language})")

        nodes = []
        relationships = []
        status = "SUCCESS"
        error_message = ""

        try:
            logger.info(f"Performing placeholder analysis for {request.file_path}...")

            # Placeholder CodeLocation for the entire file
            file_loc = analyzer_pb2.CodeLocation(
                file_path=request.file_path,
                start_line=1,
                start_column=0,
                end_line=len(request.file_content.splitlines()), # Approximate end line
                end_column=0
            )

            # Placeholder Node for the File
            file_node = analyzer_pb2.Node(
                local_id=1,
                global_id_candidate=request.file_path,
                node_type="File",
                properties={"name": os.path.basename(request.file_path)},
                location=file_loc,
                code_snippet=request.file_content[:100] # First 100 chars as snippet
            )
            nodes.append(file_node)

            # Placeholder CodeLocation for a function
            func_loc = analyzer_pb2.CodeLocation(
                file_path=request.file_path,
                start_line=5, # Placeholder line
                start_column=0,
                end_line=10, # Placeholder line
                end_column=0
            )

            # Placeholder Node for a Function
            func_node = analyzer_pb2.Node(
                local_id=2,
                global_id_candidate=f"{request.file_path}::placeholder_function",
                node_type="FunctionDefinition",
                properties={"name": "placeholder_function", "signature": "()"},
                location=func_loc,
                code_snippet="def placeholder_function():\n  pass"
            )
            nodes.append(func_node)

            # Placeholder Relationship: File DEFINES Function
            defines_rel = analyzer_pb2.Relationship(
                source_node_local_id=file_node.local_id,
                target_node_local_id=func_node.local_id,
                relationship_type="DEFINES",
                location=func_loc # Relationship observed at function definition
            )
            relationships.append(defines_rel)

            logger.info(f"Placeholder analysis complete for {request.file_path}. Nodes: {len(nodes)}, Relationships: {len(relationships)}")

        except Exception as e:
            logger.exception(f"Error during placeholder analysis for {request.file_path}")
            status = "ERROR"
            error_message = f"Error analyzing {request.file_path}: {str(e)}"
            # Set gRPC context for error
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(error_message)
            # Clear nodes/relationships on error? Or return partial? For now, clear.
            nodes = []
            relationships = []


        return analyzer_pb2.AnalysisResult(
            analyzer_name="python_analyzer",
            file_path=request.file_path,
            nodes=nodes,
            relationships=relationships,
            status=status,
            error_message=error_message
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