import grpc
import subprocess
import os
import tempfile
import shutil
import logging
from concurrent import futures
from fetcher import fetch_repository # Import the new function

# Assuming protobufs are compiled and available in the path
# If not, ensure generate_grpc.sh has been run and adjust imports if needed.
# Example: sys.path.append('../protobufs')
try:
    import code_fetcher_pb2
    import code_fetcher_pb2_grpc
except ImportError:
    logging.error("Failed to import generated protobuf files. Make sure they are generated and in the Python path.")
    # Depending on project structure, might need:
    # import sys
    # sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'protobufs')) # Adjust relative path as needed
    # import code_fetcher_pb2
    # import code_fetcher_pb2_grpc
    exit(1) # Exit if imports fail, as the service cannot run

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Define status constants based on the proto definition
STATUS_SUCCESS = code_fetcher_pb2.FetchResponse.Status.SUCCESS
STATUS_FAILED = code_fetcher_pb2.FetchResponse.Status.FAILED

class CodeFetcherService(code_fetcher_pb2_grpc.CodeFetcherServicer):
    """Provides methods for fetching code repositories."""

    def FetchRepository(self, request, context):
        """Fetches a repository, checks out a specific commit, and returns the path."""
        repo_url = request.repo_url
        commit_sha = request.commit_sha
        logging.info(f"Received request to fetch repo: {repo_url} at commit: {commit_sha}")

        # Use a temporary directory for cloning to avoid conflicts and ensure cleanup
        # Consider using CODE_STORAGE_PATH env var if persistent storage is needed later
        # base_path = os.environ.get('CODE_STORAGE_PATH', tempfile.gettempdir())
        # clone_path = tempfile.mkdtemp(dir=base_path)
        # For simplicity and guaranteed cleanup, using default temp dir for now:
        clone_path = tempfile.mkdtemp()
        logging.info(f"Created temporary directory for clone: {clone_path}")

        try:
            # Use the fetcher module to clone the repository
            fetch_repository(repo_url, clone_path)
            # fetch_repository logs success/failure and raises exceptions on error

            # Checkout the specific commit
            logging.info(f"Checking out commit {commit_sha} in {clone_path}...")
            checkout_command = ['git', 'checkout', commit_sha]
            # Execute checkout within the cloned directory
            checkout_result = subprocess.run(checkout_command, cwd=clone_path, check=True, capture_output=True, text=True)
            logging.info(f"Checkout successful: {checkout_result.stdout}")

            # If both operations succeed
            return code_fetcher_pb2.FetchResponse(
                status=STATUS_SUCCESS,
                code_path=clone_path
            )

        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            if isinstance(e, subprocess.CalledProcessError):
                logging.error(f"Git operation failed: {e}")
                logging.error(f"Command: {' '.join(e.cmd)}")
                logging.error(f"Return code: {e.returncode}")
                logging.error(f"Stderr: {e.stderr}")
                error_detail = f"Git operation failed: {e.stderr}"
            elif isinstance(e, FileNotFoundError):
                logging.error(f"Git command not found: {e}")
                error_detail = "Git command not found. Ensure Git is installed and in PATH."
            else: # Should not happen with the current except block, but for safety
                logging.error(f"Caught unexpected error type in specific block: {e}")
                error_detail = f"An unexpected error occurred during git operation: {str(e)}"
            # Clean up the temporary directory on failure
            shutil.rmtree(clone_path)
            logging.info(f"Cleaned up temporary directory: {clone_path}")
            context.set_details(error_detail)
            context.set_code(grpc.StatusCode.INTERNAL)
            return code_fetcher_pb2.FetchResponse(status=STATUS_FAILED, code_path="")

        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}")
            # Clean up the temporary directory on failure
            if os.path.exists(clone_path):
                shutil.rmtree(clone_path)
                logging.info(f"Cleaned up temporary directory: {clone_path}")
            context.set_details(f"An unexpected error occurred: {str(e)}")
            context.set_code(grpc.StatusCode.INTERNAL)
            return code_fetcher_pb2.FetchResponse(status=STATUS_FAILED, code_path="")

def serve():
    """Starts the gRPC server."""
    port = os.environ.get('CODE_FETCHER_PORT', '50051')
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    code_fetcher_pb2_grpc.add_CodeFetcherServicer_to_server(CodeFetcherService(), server)
    server.add_insecure_port(f'[::]:{port}')
    logging.info(f"Starting Code Fetcher Service on port {port}...")
    server.start()
    logging.info("Server started successfully.")
    server.wait_for_termination()

if __name__ == '__main__':
    serve()