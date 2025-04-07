import os
import sys
import subprocess # Added for git diff
from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel, HttpUrl, Field
import grpc
import logging
import asyncio
from typing import Dict, Optional, List, Tuple, Any # For type hinting
import logging
import uuid # For generating batch IDs

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

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

# Removed sys.path manipulation. Imports will use the generated package structure.

# --- gRPC Imports ---
# Import generated gRPC code (ensure generate_grpc.sh has been run)
# Import generated gRPC code using the package structure
try:
    from generated.src import (
        code_fetcher_pb2,
        code_fetcher_pb2_grpc,
        joern_analysis_pb2,
        joern_analysis_pb2_grpc,
        neo4j_ingestion_pb2,
        neo4j_ingestion_pb2_grpc,
        sql_analysis_pb2,
        sql_analysis_pb2_grpc,
        analyzer_pb2,
        analyzer_pb2_grpc
    )
    # Assuming Status enum is consistent (defined in one, used by all for simplicity here)
    Status = code_fetcher_pb2.Status # Use the one from code_fetcher as the reference
    CORE_GRPC_MODULES_LOADED = True
    logger.info("Successfully imported generated gRPC modules.")
except ImportError as e:
    logger.error(f"Could not import generated gRPC modules from 'generated.src': {e}")
    # Set flags/placeholders to indicate failure
    CORE_GRPC_MODULES_LOADED = False
    code_fetcher_pb2 = None
    code_fetcher_pb2_grpc = None
    joern_analysis_pb2 = None
    joern_analysis_pb2_grpc = None
    neo4j_ingestion_pb2 = None
    neo4j_ingestion_pb2_grpc = None
    sql_analysis_pb2 = None
    sql_analysis_pb2_grpc = None
    analyzer_pb2 = None
    analyzer_pb2_grpc = None
    Status = None


# --- FastAPI Setup ---
app = FastAPI(
    title="BMCP API Gateway",
    description="Entry point for initiating code analysis workflows.",
    version="0.1.0",
)


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

class LocalAnalysisRequest(BaseModel):
    directory_path: str = Field(..., description="Absolute path accessible within the container")
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
    if not CORE_GRPC_MODULES_LOADED:
        logger.error("Core gRPC modules not loaded during startup. Cannot proceed with analysis.")
        raise HTTPException(status_code=500, detail="Internal server error: Core gRPC modules not loaded.")

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

# --- Helper Function for Dispatching Analysis ---
async def dispatch_analysis(language: str, file_path: str, file_content: str, target_address: str) -> Optional[analyzer_pb2.AnalysisResult]:
    """Sends an analysis request to a specific language analyzer service."""
    logger.debug(f"Dispatching analysis for {file_path} ({language}) to {target_address}")
    try:
        async with grpc.aio.insecure_channel(target_address) as channel:
            stub = analyzer_pb2_grpc.AnalyzerServiceStub(channel)
            grpc_request = analyzer_pb2.AnalyzeCodeRequest(
                file_path=file_path,
                file_content=file_content,
                language=language
            )
            # Increased timeout for potentially complex analysis
            response = await stub.AnalyzeCode(grpc_request, timeout=120.0)
            logger.debug(f"Received response from {target_address} for {file_path}: Status={response.status}")
            if response.status == "SUCCESS": # Assuming SUCCESS is the primary success indicator
                return response
            else:
                # Log non-success status from analyzer as a warning/error
                logger.error(f"Analyzer service for {language} at {target_address} returned status '{response.status}' for {file_path}: {response.error_message}")
                # Return the result even if not SUCCESS, orchestration might handle partial data
                return response # Or return None if only SUCCESS is acceptable downstream

    except grpc.aio.AioRpcError as e:
        logger.error(f"gRPC call to {target_address} for {file_path} failed: {e.details()} (Code: {e.code()})")
        return None # Indicate gRPC communication failure
    except Exception as e:
        logger.exception(f"Unexpected error during dispatch for {file_path} to {target_address}")
        return None # Indicate unexpected failure

# --- Helper Function for Orchestration ---
def orchestrate_results(analysis_results: List[analyzer_pb2.AnalysisResult]) -> Tuple[List[neo4j_ingestion_pb2.GraphNode], List[neo4j_ingestion_pb2.GraphRelationship]]:
    """
    Aggregates results from multiple analyzers, resolves IDs/types (placeholder),
    and creates unified GraphNode and GraphRelationship messages.
    """
    logger.info(f"Starting orchestration for {len(analysis_results)} analysis results.")
    unified_nodes: List[neo4j_ingestion_pb2.GraphNode] = []
    unified_relationships: List[neo4j_ingestion_pb2.GraphRelationship] = []
    # Map: (analyzer_name, file_path, local_id) -> global_id
    local_to_global_id_map: Dict[Tuple[str, str, int], str] = {}
    node_counter = 0 # Simple counter for placeholder uniqueness

    # --- First Pass: Create Nodes and Map IDs ---
    for result in analysis_results:
        # Skip results that are None (dispatch error) or have an error status
        if not result or result.status != "SUCCESS":
            logger.warning(f"Skipping orchestration for failed/missing result: Analyzer={getattr(result, 'analyzer_name', 'N/A')}, File={getattr(result, 'file_path', 'N/A')}, Status={getattr(result, 'status', 'N/A')}")
            continue

        logger.debug(f"Orchestrating nodes from {result.analyzer_name} for {result.file_path} ({len(result.nodes)} nodes)")
        for node in result.nodes:
            # Placeholder global ID generation: Use analyzer, file, local ID, and counter for uniqueness
            # A more robust approach would involve hashing content or using stable identifiers.
            global_id = f"placeholder_{result.analyzer_name}_{os.path.basename(result.file_path)}_{node.local_id}_{node_counter}"
            node_counter += 1
            map_key = (result.analyzer_name, result.file_path, node.local_id)
            local_to_global_id_map[map_key] = global_id

            # Placeholder type mapping (use original type for now)
            # Future: Implement mapping rules (e.g., "FunctionDefinitionHint" -> "FunctionDefinition")
            final_node_type = node.node_type

            # Add language and original analyzer as properties
            props = dict(node.properties) if node.properties else {}
            props["language"] = result.analyzer_name # Store which language analyzer found it
            props["analyzer"] = result.analyzer_name
            props["original_node_type"] = node.node_type # Keep original type for reference
            props["original_file_path"] = result.file_path # Store original file path

            unified_nodes.append(neo4j_ingestion_pb2.GraphNode(
                global_id=global_id,
                node_type=final_node_type, # Use placeholder resolved type
                properties=props,
                location=node.location,
                code_snippet=node.code_snippet
                # secondary_labels could be added based on node_type mapping later
            ))

    logger.info(f"Orchestration - Node pass complete. {len(unified_nodes)} unified nodes created. ID map size: {len(local_to_global_id_map)}")

    # --- Second Pass: Create Relationships using Mapped Global IDs ---
    rel_counter = 0
    skipped_rels = 0
    for result in analysis_results:
        if not result or result.status != "SUCCESS":
            continue # Skip failed analyses again

        logger.debug(f"Orchestrating relationships from {result.analyzer_name} for {result.file_path} ({len(result.relationships)} relationships)")
        for rel in result.relationships:
            source_key = (result.analyzer_name, result.file_path, rel.source_node_local_id)
            target_key = (result.analyzer_name, result.file_path, rel.target_node_local_id)

            # Check if both source and target nodes were successfully mapped
            if source_key in local_to_global_id_map and target_key in local_to_global_id_map:
                source_global_id = local_to_global_id_map[source_key]
                target_global_id = local_to_global_id_map[target_key]

                # Placeholder relationship type mapping (use original type for now)
                # Future: Implement mapping rules (e.g., "CALLS_HINT" -> "CALLS")
                final_rel_type = rel.relationship_type

                # Add analyzer info to relationship properties
                rel_props = dict(rel.properties) if rel.properties else {}
                rel_props["analyzer"] = result.analyzer_name
                rel_props["original_relationship_type"] = rel.relationship_type

                unified_relationships.append(neo4j_ingestion_pb2.GraphRelationship(
                    source_node_global_id=source_global_id,
                    target_node_global_id=target_global_id,
                    relationship_type=final_rel_type, # Use placeholder resolved type
                    properties=rel_props,
                    location=rel.location
                ))
                rel_counter += 1
            else:
                skipped_rels += 1
                # Log only if source or target ID was expected but not found
                if source_key not in local_to_global_id_map:
                     logger.warning(f"Relationship source node ID not found in map for {result.file_path}: Key={source_key}")
                if target_key not in local_to_global_id_map:
                     logger.warning(f"Relationship target node ID not found in map for {result.file_path}: Key={target_key}")

    logger.info(f"Orchestration - Relationship pass complete. {rel_counter} unified relationships created. {skipped_rels} skipped due to missing node mappings.")
    return unified_nodes, unified_relationships

# --- Helper Function for Ingestion ---
async def ingest_graph_data(nodes: List[neo4j_ingestion_pb2.GraphNode], relationships: List[neo4j_ingestion_pb2.GraphRelationship]) -> Optional[neo4j_ingestion_pb2.IngestGraphResponse]:
    """Sends the unified graph data to the Neo4j Ingestion service."""
    if not nodes and not relationships:
        logger.info("No nodes or relationships to ingest.")
        # Return a synthetic success response indicating nothing was done
        return neo4j_ingestion_pb2.IngestGraphResponse(success=True, nodes_processed=0, relationships_processed=0)

    batch_id = str(uuid.uuid4())
    logger.info(f"Preparing ingestion request batch ID: {batch_id} ({len(nodes)} nodes, {len(relationships)} relationships)")

    ingestion_request = neo4j_ingestion_pb2.IngestGraphRequest(
        batch_id=batch_id,
        nodes=nodes,
        relationships=relationships,
        full_update=False # Assuming incremental updates for now
    )

    try:
        async with grpc.aio.insecure_channel(NEO4J_INGESTION_ADDR) as channel:
            stub = neo4j_ingestion_pb2_grpc.Neo4jIngestionServiceStub(channel)
            logger.info(f"Connecting to Neo4j Ingestion service at {NEO4J_INGESTION_ADDR}...")
            # Increased timeout for potentially large ingestion batches
            response = await stub.IngestGraph(ingestion_request, timeout=180.0)
            logger.info(f"Received response from Neo4j Ingestion: Success={response.success}, Nodes={response.nodes_processed}, Rels={response.relationships_processed}, Msg={response.error_message}")
            return response
    except grpc.aio.AioRpcError as e:
        logger.error(f"gRPC call to Neo4j Ingestion service failed: {e.details()} (Code: {e.code()})")
        return None # Indicate gRPC communication failure
    except Exception as e:
        logger.exception("Unexpected error during Neo4j ingestion call.")
        return None # Indicate unexpected failure

# --- Endpoint for Local Directory Analysis ---
@app.post("/analyze-local", summary="Trigger Analysis, Orchestration, and Ingestion for a Local Directory")
async def trigger_local_analysis(request: LocalAnalysisRequest = Body(...)):
    """
    Receives a local directory path, scans for supported files, dispatches
    analysis requests concurrently, orchestrates the results, and ingests
    the unified graph into Neo4j.
    """
    logger.info(f"Received local analysis request for directory: {request.directory_path}")

    # --- Basic Validation and Setup ---
    if not os.path.isdir(request.directory_path):
        logger.error(f"Provided path is not a valid directory inside the container: {request.directory_path}")
        raise HTTPException(status_code=400, detail=f"Invalid directory_path: Not found or not a directory inside the container.")

    # Check if gRPC modules were loaded correctly (including new analyzer)
    if not CORE_GRPC_MODULES_LOADED:
        logger.error("Core gRPC modules not loaded during startup. Cannot proceed with local analysis.")
        raise HTTPException(status_code=500, detail="Internal server error: Core gRPC modules not loaded.")

    supported_extensions = {
        ".py": "python",
        ".js": "javascript",
        ".jsx": "javascript", # Assuming JSX uses JS grammar for now
        ".ts": "typescript",
        ".tsx": "tsx",
        ".c": "c",
        ".cpp": "cpp",
        ".h": "cpp", # Often use cpp grammar for headers
        ".hpp": "cpp",
        ".cs": "csharp",
        ".go": "go",
        ".java": "java",
        ".rs": "rust",
        ".sql": "sql",
    }
    # Map language to its gRPC service address (from env vars)
    # Using the map defined in parser-service refactor
    # Map language to its gRPC service address (from env vars)
    # Using Python type hints
    analyzer_service_addresses: Dict[str, Optional[str]] = {
        # Dynamically create entries for base languages
        lang: os.getenv(f"{lang.upper()}_ANALYZER_ADDRESS")
        for lang in set(supported_extensions.values()) # Use set to avoid duplicates
    }
    # Special handling for potentially combined services or different env var names
    analyzer_service_addresses["sql"] = os.getenv("SQL_ANALYSIS_SERVICE_ADDRESS", SQL_ANALYSIS_ADDR) # Use specific var if set
    analyzer_service_addresses["java"] = os.getenv("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR) # Joern handles Java
    # Add other mappings as needed (e.g., C/CPP to Joern)
    analyzer_service_addresses["c"] = os.getenv("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR)
    analyzer_service_addresses["cpp"] = os.getenv("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR)


    files_to_process: List[Tuple[str, str]] = [] # List of (language, absolute_path)

    # --- Scan Directory ---
    logger.info(f"Scanning directory '{request.directory_path}' for supported files...")
    for root, _, files in os.walk(request.directory_path):
        # Basic ignore patterns (can be expanded)
        if '.git' in root.split(os.sep) or 'node_modules' in root.split(os.sep) or '__pycache__' in root.split(os.sep):
            continue
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            language = supported_extensions.get(ext)
            if language:
                full_path = os.path.join(root, file)
                files_to_process.append((language, full_path))

    logger.info(f"Found {len(files_to_process)} supported files to analyze.")
    if not files_to_process:
        return {"message": "No supported files found in the specified directory.", "analysis_summary": {"files_scanned": 0}, "orchestration_summary": {}, "ingestion_summary": {}}

    # --- Dispatch Analysis Requests (Concurrently) ---
    tasks = []
    files_skipped_reading = []
    for language, file_path in files_to_process:
        target_address = analyzer_service_addresses.get(language)
        if not target_address:
            logger.warning(f"No analyzer service configured for language '{language}'. Skipping file: {file_path}")
            # Record skipped file due to missing service configuration
            files_skipped_reading.append({"file": file_path, "reason": f"No analyzer service configured for {language}"})
            continue
        try:
            # Read file content synchronously for now. Consider aiofiles for async read if needed.
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                file_content = f.read()
            # Create a task for the dispatch_analysis coroutine
            tasks.append(dispatch_analysis(language, file_path, file_content, target_address))
        except FileNotFoundError:
            logger.error(f"File not found during read: {file_path}. Skipping analysis.")
            files_skipped_reading.append({"file": file_path, "reason": "File not found during read"})
        except Exception as e:
            logger.exception(f"Unexpected error reading file {file_path}. Skipping analysis.")
            files_skipped_reading.append({"file": file_path, "reason": f"Unexpected read error: {str(e)}"})

    logger.info(f"Dispatching {len(tasks)} analysis tasks concurrently...")
    # Use asyncio.gather to run tasks concurrently. return_exceptions=True ensures all tasks complete.
    analysis_results_or_exceptions: List[Optional[analyzer_pb2.AnalysisResult] | BaseException] = await asyncio.gather(*tasks, return_exceptions=True)

    # Process results, separating successful AnalysisResult objects from exceptions/None
    successful_results: List[analyzer_pb2.AnalysisResult] = []
    failed_tasks_details: List[Dict[str, Any]] = []

    for i, res_or_exc in enumerate(analysis_results_or_exceptions):
        original_language, original_file_path = files_to_process[i] # Get corresponding file info
        if isinstance(res_or_exc, analyzer_pb2.AnalysisResult):
            if res_or_exc.status == "SUCCESS":
                successful_results.append(res_or_exc)
            else:
                # Analyzer returned a non-SUCCESS status
                failed_tasks_details.append({
                    "file": original_file_path,
                    "language": original_language,
                    "reason": f"Analyzer returned status '{res_or_exc.status}'",
                    "details": res_or_exc.error_message
                })
        elif isinstance(res_or_exc, BaseException):
            # asyncio.gather caught an exception from dispatch_analysis
            failed_tasks_details.append({
                "file": original_file_path,
                "language": original_language,
                "reason": "Exception during dispatch/analysis",
                "details": str(res_or_exc)
            })
        elif res_or_exc is None:
             # dispatch_analysis returned None (likely gRPC error)
             failed_tasks_details.append({
                "file": original_file_path,
                "language": original_language,
                "reason": "gRPC call failed or unexpected error in dispatch",
                "details": "Check logs for specific gRPC error"
             })
        else:
            # Should not happen, but catch unexpected return types
            failed_tasks_details.append({
                "file": original_file_path,
                "language": original_language,
                "reason": "Unexpected result type from dispatch",
                "details": str(type(res_or_exc))
            })

    logger.info(f"Received {len(successful_results)} successful analysis results.")
    if failed_tasks_details:
        logger.warning(f"{len(failed_tasks_details)} analysis tasks failed or returned errors.")
        # Log details for debugging
        for failure in failed_tasks_details:
             logger.debug(f"Analysis Failure: File={failure['file']}, Reason={failure['reason']}, Details={failure.get('details', 'N/A')}")

    # --- Orchestration Phase ---
    logger.info("Starting orchestration phase...")
    # Pass only the successful results to the orchestrator
    unified_nodes, unified_relationships = orchestrate_results(successful_results)
    logger.info(f"Orchestration complete: {len(unified_nodes)} nodes, {len(unified_relationships)} relationships generated.")

    # --- Ingestion Phase ---
    ingestion_response = None
    ingestion_status = "Skipped"
    ingestion_details = {"nodes_processed": 0, "relationships_processed": 0, "error": None}

    if unified_nodes or unified_relationships:
        logger.info("Starting ingestion phase...")
        ingestion_response_or_none = await ingest_graph_data(unified_nodes, unified_relationships)
        if ingestion_response_or_none:
            ingestion_response = ingestion_response_or_none # Keep the actual response object
            if ingestion_response.success:
                ingestion_status = "Success"
                ingestion_details["nodes_processed"] = ingestion_response.nodes_processed
                ingestion_details["relationships_processed"] = ingestion_response.relationships_processed
                logger.info(f"Ingestion successful: {ingestion_response.nodes_processed} nodes, {ingestion_response.relationships_processed} relationships processed.")
            else:
                ingestion_status = "Failed"
                ingestion_details["error"] = ingestion_response.error_message
                logger.error(f"Ingestion failed: {ingestion_response.error_message}")
        else:
            # ingest_graph_data returned None (gRPC error or unexpected exception)
            ingestion_status = "Failed"
            ingestion_details["error"] = "Ingestion service call failed or unexpected error occurred."
            logger.error(f"Ingestion failed: {ingestion_details['error']}")
    else:
        logger.info("Skipping ingestion phase: No unified nodes or relationships generated.")

    # --- Return Summary ---
    final_message = f"Local analysis process completed. Status: Analysis({len(successful_results)}/{len(tasks)} successful), Orchestration({len(unified_nodes)} nodes, {len(unified_relationships)} relationships), Ingestion({ingestion_status})."
    logger.info(final_message)

    # Combine all errors/skipped files for reporting
    all_errors = files_skipped_reading + failed_tasks_details
    if ingestion_status == "Failed" and ingestion_details["error"]:
         all_errors.append({"service": "ingestion", "reason": ingestion_details["error"]})

    # Use status code 200 but indicate issues in the response body
    return {
        "message": final_message,
        "analysis_summary": {
            "files_scanned": len(files_to_process),
            "tasks_dispatched": len(tasks),
            "successful_analyses": len(successful_results),
            "failed_or_skipped_analyses": len(all_errors) - (1 if ingestion_status == "Failed" else 0), # Adjust count based on ingestion error
        },
        "orchestration_summary": {
            "unified_nodes_generated": len(unified_nodes),
            "unified_relationships_generated": len(unified_relationships),
        },
        "ingestion_summary": {
            "status": ingestion_status,
            "nodes_processed": ingestion_details["nodes_processed"],
            "relationships_processed": ingestion_details["relationships_processed"],
            "error": ingestion_details["error"]
        },
        "errors_and_skipped_files": all_errors # Provide detailed list of issues
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