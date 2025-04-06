import grpc
import subprocess
import os
import logging
from concurrent import futures
import time

# Import generated classes
# These imports assume the generated files are in the same directory or PYTHONPATH includes ../generated
# Adjust if your generation script places them elsewhere relative to this main.py
try:
    import joern_analysis_pb2
    import joern_analysis_pb2_grpc
except ImportError:
    # If running locally without Docker build context, try relative path
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'generated'))
    import joern_analysis_pb2
    import joern_analysis_pb2_grpc


# Import health checking services
from grpc_health.v1 import health
from grpc_health.v1 import health_pb2
from grpc_health.v1 import health_pb2_grpc

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Define the shared volume base path within the container
# This MUST match the volume mount point in docker-compose.yml
SHARED_VOLUME_BASE = "/analysis-data"
# Define the path where Joern expects to find its installation within the container
# This might vary depending on the base image, adjust if necessary
JOERN_INSTALL_DIR = "/opt/joern" # Default Joern install location in official images

class JoernAnalysisServiceImpl(joern_analysis_pb2_grpc.JoernAnalysisServiceServicer):
    def AnalyzeCode(self, request, context):
        """
        Handles the gRPC request to analyze code using Joern.
        """
        logging.info(f"Received AnalyzeCode request for code_path: {request.code_path}, output_path: {request.output_path}")

        # --- Path Validation and Construction ---
        if not request.code_path or ".." in request.code_path or request.code_path.startswith("/"):
            error_message = "Invalid code_path provided. Must be a relative path within the shared volume."
            logging.error(error_message)
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        if not request.output_path or ".." in request.output_path or request.output_path.startswith("/"):
            error_message = "Invalid output_path provided. Must be a relative path within the shared volume."
            logging.error(error_message)
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        absolute_code_path = os.path.normpath(os.path.join(SHARED_VOLUME_BASE, request.code_path))
        absolute_output_path = os.path.normpath(os.path.join(SHARED_VOLUME_BASE, request.output_path))

        # Security check: Ensure paths stay within the shared volume
        if not absolute_code_path.startswith(SHARED_VOLUME_BASE):
             error_message = f"Security Error: Resolved code_path '{absolute_code_path}' is outside the allowed directory '{SHARED_VOLUME_BASE}'."
             logging.error(error_message)
             context.set_code(grpc.StatusCode.PERMISSION_DENIED)
             context.set_details(error_message)
             return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        if not absolute_output_path.startswith(SHARED_VOLUME_BASE):
             error_message = f"Security Error: Resolved output_path '{absolute_output_path}' is outside the allowed directory '{SHARED_VOLUME_BASE}'."
             logging.error(error_message)
             context.set_code(grpc.StatusCode.PERMISSION_DENIED)
             context.set_details(error_message)
             return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        # Check if input code path exists
        if not os.path.exists(absolute_code_path) or not os.path.isdir(absolute_code_path):
            error_message = f"Input code path does not exist or is not a directory: {absolute_code_path}"
            logging.error(error_message)
            context.set_code(grpc.StatusCode.NOT_FOUND)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        # Ensure the target output directory exists
        output_dir = os.path.dirname(absolute_output_path)
        try:
            os.makedirs(output_dir, exist_ok=True)
            logging.info(f"Ensured output directory exists: {output_dir}")
        except OSError as e:
            error_message = f"Failed to create output directory {output_dir}: {e}"
            logging.error(error_message)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

        # --- Joern Command Execution ---
        # Use joern-parse script provided within the Joern installation
        joern_parse_script = os.path.join(JOERN_INSTALL_DIR, "joern-parse")

        # Check if joern-parse script exists
        if not os.path.isfile(joern_parse_script):
             error_message = f"Joern parse script not found at expected location: {joern_parse_script}"
             logging.error(error_message)
             context.set_code(grpc.StatusCode.FAILED_PRECONDITION)
             context.set_details(error_message)
             return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)


        joern_command = [
            joern_parse_script,
            absolute_code_path,
            "--output",
            absolute_output_path
        ]

        logging.info(f"Executing Joern command: {' '.join(joern_command)}")
        process = None # Initialize process variable
        try:
            # Execute the Joern command
            # Consider adding a timeout if Joern might hang
            process = subprocess.run(
                joern_command,
                capture_output=True,
                text=True,
                check=True,  # Raise an exception for non-zero exit codes
                env=os.environ.copy() # Pass environment variables like _JAVA_OPTS
            )
            logging.info(f"Joern process completed successfully.")
            # Joern often logs useful info to stderr, even on success
            if process.stdout:
                logging.info(f"Joern stdout:\n{process.stdout}")
            if process.stderr:
                logging.info(f"Joern stderr:\n{process.stderr}")

            # Verify output file creation
            if not os.path.exists(absolute_output_path):
                 # Sometimes Joern might succeed (exit 0) but not create the file if input is empty/invalid
                 error_message = f"Joern command executed but output file not found at {absolute_output_path}. Check Joern logs (stderr)."
                 logging.error(error_message)
                 # Include stderr in the response if available
                 if process and process.stderr:
                     error_message += f"\nJoern stderr:\n{process.stderr}"
                 context.set_code(grpc.StatusCode.INTERNAL)
                 context.set_details(error_message)
                 return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)


            success_message = f"Joern analysis successful. CPG saved to {request.output_path} (relative to shared volume)."
            logging.info(success_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(
                success=True,
                message=success_message,
                cpg_output_path=request.output_path # Return relative path as confirmation
            )

        except subprocess.CalledProcessError as e:
            error_message = f"Joern execution failed with exit code {e.returncode}."
            # Log and include stdout/stderr for debugging
            if e.stdout:
                error_message += f"\nStdout:\n{e.stdout}"
                logging.error(f"Joern stdout (error):\n{e.stdout}")
            if e.stderr:
                error_message += f"\nStderr:\n{e.stderr}"
                logging.error(f"Joern stderr (error):\n{e.stderr}")
            else:
                 error_message += " No stderr captured."

            logging.error(f"Joern execution failed: {error_message}")
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(error_message) # Provide detailed error
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=f"Joern execution failed. Exit code: {e.returncode}. Check service logs for details.") # User-friendly message
        except FileNotFoundError as e:
            # This usually means joern-parse script wasn't found
            error_message = f"Error during Joern execution: {e}. Is Joern correctly installed and path configured?"
            logging.error(error_message)
            context.set_code(grpc.StatusCode.FAILED_PRECONDITION)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)
        except Exception as e:
            # Catch any other unexpected errors
            error_message = f"An unexpected error occurred during Joern analysis: {type(e).__name__}: {e}"
            logging.exception("Unexpected error in AnalyzeCode") # Log full traceback
            context.set_code(grpc.StatusCode.UNKNOWN)
            context.set_details(error_message)
            return joern_analysis_pb2.AnalyzeCodeResponse(success=False, message=error_message)

def serve():
    """Starts the gRPC server."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=int(os.environ.get('MAX_WORKERS', 10))))

    # Add Joern Analysis Service implementation
    joern_analysis_pb2_grpc.add_JoernAnalysisServiceServicer_to_server(
        JoernAnalysisServiceImpl(), server
    )

    # Add Health Checking Service
    health_servicer = health.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    # Set initial health status
    service_name = joern_analysis_pb2.DESCRIPTOR.services_by_name['JoernAnalysisService'].full_name
    health_servicer.set(service_name, health_pb2.HealthCheckResponse.SERVING)
    health_servicer.set("", health_pb2.HealthCheckResponse.SERVING) # Server-wide


    port = os.environ.get('GRPC_PORT', '50053')
    bind_address = f"[::]:{port}"

    # Use add_secure_port if TLS credentials are configured
    # For now, using insecure port as per typical internal service setup
    server.add_insecure_port(bind_address)

    logging.info(f"Starting Joern Analysis gRPC server on {bind_address}")
    server.start()
    logging.info("Server started successfully.")

    # Keep the server running gracefully
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logging.info("Shutting down server due to KeyboardInterrupt...")
        # Graceful shutdown
        server.stop(grace=5.0).wait() # Allow 5 seconds for ongoing requests
        logging.info("Server shut down gracefully.")
    except Exception as e:
        logging.exception("Server encountered an error during runtime.")
        server.stop(grace=1.0) # Quick shutdown on unexpected error
        logging.info("Server shut down due to error.")


if __name__ == '__main__':
    # Ensure generated files exist before starting server
    generated_files = ['joern_analysis_pb2.py', 'joern_analysis_pb2_grpc.py']
    missing_files = [f for f in generated_files if not os.path.exists(f)]

    # Attempt to find them in the ../generated directory as a fallback
    if missing_files:
        generated_dir = os.path.join(os.path.dirname(__file__), '..', 'generated')
        missing_in_fallback = [f for f in missing_files if not os.path.exists(os.path.join(generated_dir, f))]
        if missing_in_fallback:
             logging.error(f"Missing generated protobuf files: {', '.join(missing_in_fallback)}. Please run generate_grpc.sh first.")
             exit(1)
        else:
            # Add generated dir to path if files found there
             sys.path.append(generated_dir)
             logging.info(f"Found generated files in {generated_dir}, adding to sys.path.")
             # Re-import now that path is set
             import joern_analysis_pb2
             import joern_analysis_pb2_grpc


    serve()