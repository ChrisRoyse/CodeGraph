import os
import sys
import subprocess # Added for git diff
from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel, HttpUrl
import grpc
import logging
# --- Configuration ---
# Service Addresses from Environment Variables
CODE_FETCHER_HOST = os.getenv("CODE_FETCHER_HOST", "localhost")
CODE_FETCHER_PORT = os.getenv("CODE_FETCHER_PORT", "50051")
CODE_FETCHER_ADDR = f"{CODE_FETCHER_HOST}:{CODE_FETCHER_PORT}"

JOERN_ANALYSIS_HOST = os.getenv("JOERN_ANALYSIS_HOST", "localhost")
JOERN_ANALYSIS_PORT = os.getenv("JOERN_ANALYSIS_PORT", "50052")
JOERN_ANALYSIS_ADDR = f"{JOERN_ANALYSIS_HOST}:{JOERN_ANALYSIS_PORT}"

NEO4J_INGESTION_HOST = os.getenv("NEO4J_INGESTION_HOST", "localhost")
NEO4J_INGESTION_PORT = os.getenv("NEO4J_INGESTION_PORT", "50053")
NEO4J_INGESTION_ADDR = f"{NEO4J_INGESTION_HOST}:{NEO4J_INGESTION_PORT}"


SQL_ANALYSIS_HOST = os.getenv("SQL_ANALYSIS_HOST", "localhost")
SQL_ANALYSIS_PORT = os.getenv("SQL_ANALYSIS_PORT", "50054")
SQL_ANALYSIS_ADDR = f"{SQL_ANALYSIS_HOST}:{SQL_ANALYSIS_PORT}"

# Add the generated protobuf code directory to the Python path
# This is one way to make the generated code importable.
# Alternatively, install the 'generated' directory as a package.
GENERATED_SRC_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'generated', 'src'))
if GENERATED_SRC_PATH not in sys.path:
    sys.path.append(GENERATED_SRC_PATH)

# --- gRPC Imports ---
# Import generated gRPC code (ensure generate_grpc.sh has been run)
try:
    import code_fetcher_pb2
    import code_fetcher_pb2_grpc
    import joern_analysis_pb2
    import joern_analysis_pb2_grpc
    import neo4j_ingestion_pb2
    import neo4j_ingestion_pb2_grpc
    import sql_analysis_pb2
    import sql_analysis_pb2_grpc

    # Assuming Status enum is consistent (defined in one, used by all for simplicity here)
    # If they differ significantly, import each specifically.
    Status = code_fetcher_pb2.Status # Use the one from code_fetcher as the reference
except ImportError:
    logging.error(f"Could not import generated gRPC modules. Did you run './generate_grpc.sh' and ensure '{GENERATED_SRC_PATH}' is in PYTHONPATH?")
    # Allow app to start but endpoint will fail if imports are missing
    code_fetcher_pb2 = None
    code_fetcher_pb2_grpc = None
    joern_analysis_pb2 = None
    joern_analysis_pb2_grpc = None
    neo4j_ingestion_pb2 = None
    neo4j_ingestion_pb2_grpc = None
    sql_analysis_pb2 = None
    sql_analysis_pb2_grpc = None

    Status = None # Define Status as None if imports fail


# --- FastAPI Setup ---
app = FastAPI(
    title="BMCP API Gateway",
    description="Entry point for initiating code analysis workflows.",
    version="0.1.0",
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Helper Function ---
def get_changed_files(repo_path: str, old_sha: str, new_sha: str) -> tuple[list[str], list[str]]:
    """
    Uses git diff to find changed and deleted files between two commits.
    Returns (changed_files, deleted_files).
    Raises HTTPException on errors.
    """
    changed_files = []
    deleted_files = []
    # Use the '..' notation which is common for ranges, ensure SHAs are valid
    command = ["git", "diff", "--name-status", f"{old_sha}..{new_sha}"]
    try:
        logger.info(f"Running git diff in '{repo_path}': {' '.join(command)}")
        # Ensure repo_path exists and is a directory before running
        if not os.path.isdir(repo_path):
             logger.error(f"Repository path does not exist or is not a directory: {repo_path}")
             raise HTTPException(status_code=500, detail=f"Internal error: Invalid repository path provided for git diff: {repo_path}")

        result = subprocess.run(
            command,
            cwd=repo_path,
            capture_output=True,
            text=True,
            check=True, # Raise exception on non-zero exit code
            encoding='utf-8', # Explicitly set encoding
            errors='ignore' # Ignore potential decoding errors in file paths
        )
        logger.debug(f"Git diff raw output:\n{result.stdout}")
        output_lines = result.stdout.strip().split('\n')
        if not output_lines or (len(output_lines) == 1 and not output_lines[0]):
             logger.info("Git diff returned no changes.")
             return [], [] # No changes detected

        for line in output_lines:
            if not line:
                continue
            try:
                status, filepath = line.split('\t', 1)
                # Strip potential extra whitespace from status or filepath
                status = status.strip()
                filepath = filepath.strip()
                if status.startswith('A') or status.startswith('M'): # Handle statuses like A, M, AM
                    changed_files.append(filepath)
                elif status.startswith('D'): # Handle D
                    deleted_files.append(filepath)
                elif status.startswith('R'): # Handle Rename (RXXX\tnew_path\told_path)
                    # Treat rename as delete old, add new
                    parts = line.split('\t')
                    if len(parts) == 3:
                        deleted_files.append(parts[1]) # old_path
                        changed_files.append(parts[2]) # new_path
                    else:
                         logger.warning(f"Could not parse rename line: {line}")
                # Ignore C (Copy), T (Type change), U (Unmerged), X (Unknown), B (Broken) for now
            except ValueError:
                logger.warning(f"Could not parse git diff line: '{line}'")
                continue # Skip malformed lines

        logger.info(f"Detected changes: {len(changed_files)} changed/added/renamed, {len(deleted_files)} deleted/renamed.")
        return changed_files, deleted_files
    except FileNotFoundError:
        logger.error(f"Git command not found. Ensure git is installed and in PATH.")
        # Raise 500 because it's a server configuration issue
        raise HTTPException(status_code=500, detail="Git command not found on server.")
    except subprocess.CalledProcessError as e:
        stderr_output = e.stderr.strip() if e.stderr else "No stderr output"
        logger.error(f"Git diff command failed in '{repo_path}' with exit code {e.returncode}. Command: {' '.join(command)}")
        logger.error(f"Stderr: {stderr_output}")
        # Check stderr for common user errors (invalid SHA) vs internal errors
        if "unknown revision" in stderr_output or "bad object" in stderr_output:
             detail = f"Git diff failed: Invalid commit SHA provided ('{old_sha}' or '{new_sha}')."
             raise HTTPException(status_code=400, detail=detail) # 400 Bad Request for invalid SHAs
        elif "not a git repository" in stderr_output:
             detail = f"Internal error: Fetched code path '{repo_path}' is not a valid git repository."
             raise HTTPException(status_code=500, detail=detail)
        else:
            # Generic internal server error for other git failures
            detail = f"Git diff command failed: {stderr_output}"
            raise HTTPException(status_code=500, detail=detail)
    except HTTPException: # Re-raise HTTPExceptions raised internally (e.g., path check)
        raise
    except Exception as e:
        logger.exception(f"An unexpected error occurred during git diff processing in '{repo_path}'")
        raise HTTPException(status_code=500, detail=f"Internal server error processing git diff: {str(e)}")

# --- Request Models ---
class AnalysisRequest(BaseModel):
    repo_url: HttpUrl
    current_commit_sha: str # Required for both full and incremental analysis
    previous_commit_sha: str | None = None # If provided, triggers incremental analysis
# --- API Endpoints ---
@app.post("/analyze", summary="Trigger Code Analysis (Full or Incremental)")
async def trigger_analysis(request: AnalysisRequest = Body(...)):
    """
    Receives a repository URL and commit SHAs, triggers the analysis pipeline:
    1. Calls Code Fetcher service to clone/fetch the repository at `current_commit_sha`.
    2. If `previous_commit_sha` is provided, calculates changed/deleted files using `git diff`.
    3. Calls Joern Analysis service with code path and change lists (if any).
    4. Calls Neo4j Ingestion service with filtered CPG data and deleted files list from Joern.
    """
    is_incremental = request.previous_commit_sha is not None
    logger.info(f"Received analysis request for: {request.repo_url}")
    logger.info(f"  Current SHA: {request.current_commit_sha}")
    if is_incremental:
        logger.info(f"  Previous SHA: {request.previous_commit_sha} (Incremental Analysis)")
    else:
        logger.info("  Full Analysis (no previous SHA provided)")
    # Check if gRPC modules were loaded correctly
    if not all([code_fetcher_pb2, code_fetcher_pb2_grpc,
                joern_analysis_pb2, joern_analysis_pb2_grpc,
                neo4j_ingestion_pb2, neo4j_ingestion_pb2_grpc,
                 sql_analysis_pb2, sql_analysis_pb2_grpc,

                Status]):
        logger.error("gRPC modules not loaded. Cannot proceed.")
        raise HTTPException(status_code=500, detail="Internal server error: gRPC modules not loaded. Check server logs.")

    code_path = None
    changed_files = []
    deleted_files = []
    joern_response = None # To store the response from Joern service
    # --- Step 1: Call Code Fetcher Service ---
    try:
        async with grpc.aio.insecure_channel(CODE_FETCHER_ADDR) as channel:
            stub = code_fetcher_pb2_grpc.CodeFetcherStub(channel)
            logger.info(f"Connecting to Code Fetcher service at {CODE_FETCHER_ADDR}...")
            fetch_request = code_fetcher_pb2.FetchRepositoryRequest(
                repo_url=str(request.repo_url),
                commit_sha=request.current_commit_sha # Fetch the target state
            )
            logger.info(f"Calling FetchRepository RPC for {request.repo_url} (SHA: {request.current_commit_sha})")
            fetch_response = await stub.FetchRepository(fetch_request)
            logger.info(f"Received response from Code Fetcher: Status={Status.Name(fetch_response.status)}, Path={fetch_response.code_path}, Msg={fetch_response.message}")

            if fetch_response.status != Status.SUCCESS:
                logger.error(f"Code fetching failed: {fetch_response.message}")
                raise HTTPException(status_code=500, detail=f"Code fetching failed: {fetch_response.message}")

            code_path = fetch_response.code_path
            logger.info(f"Code successfully fetched to: {code_path}")

    except grpc.aio.AioRpcError as e:
        logger.error(f"gRPC call to Code Fetcher service failed: {e.details()} (Code: {e.code()})")
        raise HTTPException(status_code=503, detail=f"Code Fetcher service unavailable or failed: {e.details()}")
    except HTTPException as e: # Re-raise HTTP exceptions from above
        raise e
    except Exception as e:
        logger.exception("An unexpected error occurred during code fetching.")
        raise HTTPException(status_code=500, detail=f"Internal server error during code fetching: {str(e)}")

    # --- Step 1.5: Get Changed Files (if incremental) ---
    if is_incremental and code_path:
        logger.info(f"Calculating diff between {request.previous_commit_sha} and {request.current_commit_sha}...")
        try:
            # Ensure previous_commit_sha is not None before calling
            if request.previous_commit_sha:
                 changed_files, deleted_files = get_changed_files(
                      code_path, request.previous_commit_sha, request.current_commit_sha
                 )
            else:
                 # This case should ideally not be reached due to is_incremental check, but safety first
                 logger.warning("Incremental analysis requested but previous_commit_sha is missing.")
                 raise HTTPException(status_code=400, detail="Previous commit SHA is required for incremental analysis.")
        except HTTPException as e: # Catch exceptions from get_changed_files
            logger.error(f"Failed to get changed files: {e.detail}")
            raise e # Re-raise to stop processing
        except Exception as e: # Catch unexpected errors
             logger.exception("Unexpected error during get_changed_files call.")
             raise HTTPException(status_code=500, detail=f"Internal server error during file diff calculation: {str(e)}")



    # --- Identify SQL files --- 
    sql_files_to_analyze = []
    if code_path:
        if is_incremental:
            # Analyze only changed/added SQL files
            sql_files_to_analyze = [os.path.join(code_path, f) for f in changed_files if f.endswith('.sql')]
            logger.info(f"Found {len(sql_files_to_analyze)} changed/added SQL files for incremental analysis.")
        else:
            # Analyze all SQL files in the repo for full analysis
            logger.info(f"Scanning for all SQL files in {code_path} for full analysis...")
            for root, _, files in os.walk(code_path):
                # Skip .git directory
                if '.git' in root.split(os.sep):
                    continue
                for file in files:
                    if file.endswith('.sql'):
                        full_path = os.path.join(root, file)
                        # Get relative path from code_path
                        relative_path = os.path.relpath(full_path, code_path)
                        sql_files_to_analyze.append(relative_path) # Store relative paths
            logger.info(f"Found {len(sql_files_to_analyze)} total SQL files for full analysis.")

    sql_analysis_results_json = "{}" # Default to empty JSON object

    # --- Step 2: Call Joern Analysis Service ---
    if not code_path: # Should not happen if fetch succeeded, but safety check
         raise HTTPException(status_code=500, detail="Internal error: Code path not available after fetch.")
    try:
        async with grpc.aio.insecure_channel(JOERN_ANALYSIS_ADDR) as channel:
            stub = joern_analysis_pb2_grpc.JoernAnalysisStub(channel)
            logger.info(f"Connecting to Joern Analysis service at {JOERN_ANALYSIS_ADDR}...")
            # Pass change lists (empty if full analysis)
            analysis_request = joern_analysis_pb2.AnalyzeCodeRequest(
                code_path=code_path,
                changed_files=changed_files,
                deleted_files=deleted_files
            )

            logger.info(f"Calling AnalyzeCode RPC with path: {code_path}, changed: {len(changed_files)}, deleted: {len(deleted_files)}")
            analysis_response = await stub.AnalyzeCode(analysis_request)
            # Log the new response structure
            # Check if fields exist before accessing length, in case of errors or unexpected responses
            nodes_count = len(analysis_response.filtered_nodes) if hasattr(analysis_response, 'filtered_nodes') else 'N/A'
            rels_count = len(analysis_response.filtered_relationships) if hasattr(analysis_response, 'filtered_relationships') else 'N/A'
            deleted_count = len(analysis_response.deleted_files) if hasattr(analysis_response, 'deleted_files') else 'N/A'
            logger.info(f"Received response from Joern Analysis: Status={Status.Name(analysis_response.status)}, Nodes={nodes_count}, Rels={rels_count}, Deleted={deleted_count}, Msg={analysis_response.message}")

            if analysis_response.status != Status.SUCCESS:
                logger.error(f"Joern analysis failed: {analysis_response.message}")
                raise HTTPException(status_code=500, detail=f"Joern analysis failed: {analysis_response.message}")

            joern_response = analysis_response # Store the full response
            logger.info(f"Joern analysis successful.")

    except grpc.aio.AioRpcError as e:
        logger.error(f"gRPC call to Joern Analysis service failed: {e.details()} (Code: {e.code()})")
        raise HTTPException(status_code=503, detail=f"Joern Analysis service unavailable or failed: {e.details()}")
    except HTTPException as e: # Re-raise HTTP exceptions from above
        raise e
    except Exception as e:
        logger.exception("An unexpected error occurred during Joern analysis call.")
        raise HTTPException(status_code=500, detail=f"Internal server error during Joern analysis: {str(e)}")


    # --- Step 2.5: Call SQL Analysis Service (if SQL files exist) ---
    if sql_files_to_analyze:
        logger.info(f"Calling SQL Analysis service for {len(sql_files_to_analyze)} files...")
        try:
            async with grpc.aio.insecure_channel(SQL_ANALYSIS_ADDR) as channel:
                stub = sql_analysis_pb2_grpc.SqlAnalysisStub(channel)
                logger.info(f"Connecting to SQL Analysis service at {SQL_ANALYSIS_ADDR}...")
                # Prepare request: Send relative paths from the repo root
                sql_analysis_request = sql_analysis_pb2.AnalyzeSqlRequest(
                    code_path=code_path, # Pass the root path
                    sql_file_paths=sql_files_to_analyze # Pass relative paths
                )
                sql_response = await stub.AnalyzeSql(sql_analysis_request)
                logger.info(f"Received response from SQL Analysis: Status={Status.Name(sql_response.status)}, Msg={sql_response.message}")

                if sql_response.status != Status.SUCCESS:
                    logger.error(f"SQL analysis failed: {sql_response.message}")
                    # Decide if this is fatal. For now, log error and continue with CPG data.
                    # raise HTTPException(status_code=500, detail=f"SQL analysis failed: {sql_response.message}")
                    logger.warning("Proceeding without SQL analysis results due to error.")
                else:
                    sql_analysis_results_json = sql_response.analysis_results_json
                    logger.info(f"SQL analysis successful. Result size: {len(sql_analysis_results_json)} bytes.")

        except grpc.aio.AioRpcError as e:
            logger.error(f"gRPC call to SQL Analysis service failed: {e.details()} (Code: {e.code()})")
            # Decide if this is fatal. For now, log error and continue.
            logger.warning(f"SQL Analysis service unavailable or failed: {e.details()}. Proceeding without SQL analysis.")
            # raise HTTPException(status_code=503, detail=f"SQL Analysis service unavailable or failed: {e.details()}")
        except Exception as e:
            logger.exception("An unexpected error occurred during SQL analysis call.")
            logger.warning(f"Unexpected error during SQL analysis: {str(e)}. Proceeding without SQL analysis.")
            # raise HTTPException(status_code=500, detail=f"Internal server error during SQL analysis: {str(e)}")
    else:
        logger.info("No SQL files found or specified for analysis. Skipping SQL Analysis service call.")

    # --- Step 3: Call Neo4j Ingestion Service ---
    if not joern_response: # Check if Joern response was received
        raise HTTPException(status_code=500, detail="Internal error: Joern analysis response not available.")
    try:
        async with grpc.aio.insecure_channel(NEO4J_INGESTION_ADDR) as channel:
            stub = neo4j_ingestion_pb2_grpc.Neo4jIngestionStub(channel)
            logger.info(f"Connecting to Neo4j Ingestion service at {NEO4J_INGESTION_ADDR}...")
            # Use the new request structure with data from Joern response
            ingestion_request = neo4j_ingestion_pb2.IngestCpgRequest(
                filtered_nodes=joern_response.filtered_nodes,
                filtered_relationships=joern_response.filtered_relationships,
                deleted_files=joern_response.deleted_files, # Pass deleted files from Joern response
                sql_analysis_results_json=sql_analysis_results_json # Add SQL results

            )

            logger.info(f"Calling IngestCpg RPC with Nodes={len(ingestion_request.filtered_nodes)}, Rels={len(ingestion_request.filtered_relationships)}, Deleted={len(ingestion_request.deleted_files)}, SQL Results Size={len(sql_analysis_results_json)} bytes")

            ingestion_response = await stub.IngestCpg(ingestion_request) # Use correct RPC name 'IngestCpg'
            logger.info(f"Received response from Neo4j Ingestion: Status={Status.Name(ingestion_response.status)}, Msg={ingestion_response.message}")

            if ingestion_response.status != Status.SUCCESS:
                logger.error(f"Neo4j ingestion failed: {ingestion_response.message}")
                raise HTTPException(status_code=500, detail=f"Neo4j ingestion failed: {ingestion_response.message}")

            logger.info("Neo4j ingestion successful.")

    except grpc.aio.AioRpcError as e:
        logger.error(f"gRPC call to Neo4j Ingestion service failed: {e.details()} (Code: {e.code()})")
        raise HTTPException(status_code=503, detail=f"Neo4j Ingestion service unavailable or failed: {e.details()}")
    except HTTPException as e: # Re-raise HTTP exceptions from above
        raise e
    except Exception as e:
        logger.exception("An unexpected error occurred during Neo4j ingestion call.")
        raise HTTPException(status_code=500, detail=f"Internal server error during Neo4j ingestion: {str(e)}")

    # --- Success Response ---
    # Adjust response to reflect incremental nature if applicable
    analysis_details = {}
    if joern_response:
        analysis_details = {
            "nodes_processed": len(joern_response.filtered_nodes),
            "relationships_processed": len(joern_response.filtered_relationships),
            "files_deleted_in_graph": len(joern_response.deleted_files),
            "sql_analysis_results_size_bytes": len(sql_analysis_results_json),
        }


    return {
        "message": f"Analysis pipeline ({'Incremental' if is_incremental else 'Full'}) completed successfully.",
        "repository_url": str(request.repo_url),
        "current_commit_sha": request.current_commit_sha,
        "previous_commit_sha": request.previous_commit_sha if is_incremental else None,
        "code_path": code_path,
        "analysis_details": analysis_details
    }

@app.get("/health", summary="Health Check")
async def health_check():
    """Basic health check endpoint."""
    return {"status": "ok"}

# --- Main Execution ---
if __name__ == "__main__":
    import uvicorn
    # Use 0.0.0.0 to be accessible externally if needed, default port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")