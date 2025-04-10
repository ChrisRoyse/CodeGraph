import os
import subprocess
import logging
import asyncio
import grpc
from typing import List, Tuple, Optional, Dict, Any
from fastapi import HTTPException

# Removed dummy imports/classes. Actual modules should be accessed
# via dependency injection provided by grpc_setup.py
# Use absolute import from /app (assuming PYTHONPATH includes /app)
# Use relative import from within the api_gateway package
# analyzer_pb2 will be imported inside the function that needs it.
# analyzer_pb2_grpc is not directly used here.

logger = logging.getLogger(__name__)

# --- Git Diff Helper ---
def get_changed_files(repo_path: str, old_sha: str, new_sha: str) -> tuple[list[str], list[str]]:
    """
    Uses git diff to find changed and deleted files between two commits.
    Returns (changed_files, deleted_files). Changed files include added, modified, and the 'new' path of renamed files.
    Deleted files include deleted and the 'old' path of renamed files.
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
                status, filepath_info = line.split('\t', 1)
                # Strip potential extra whitespace from status or filepath
                status = status.strip()
                filepath_info = filepath_info.strip()

                if status.startswith('A') or status.startswith('M'): # Added, Modified
                    changed_files.append(filepath_info)
                elif status.startswith('D'): # Deleted
                    deleted_files.append(filepath_info)
                elif status.startswith('R'): # Renamed (RXXX\told_path\tnew_path)
                    parts = filepath_info.split('\t')
                    if len(parts) == 2:
                        old_path, new_path = parts[0].strip(), parts[1].strip()
                        # Treat rename as delete old, add new for analysis purposes
                        deleted_files.append(old_path)
                        changed_files.append(new_path)
                        logger.debug(f"Parsed rename: {old_path} -> {new_path}")
                    else:
                        logger.warning(f"Could not parse rename line format: {line}")
                elif status.startswith('C'): # Copied (CXXX\told_path\tnew_path)
                     parts = filepath_info.split('\t')
                     if len(parts) == 2:
                         new_path = parts[1].strip()
                         # Treat copy as an added file
                         changed_files.append(new_path)
                         logger.debug(f"Parsed copy as added: {new_path}")
                     else:
                         logger.warning(f"Could not parse copy line format: {line}")
                # Ignore T (Type change), U (Unmerged), X (Unknown), B (Broken) for now
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


# --- Analysis Dispatch Helper ---
async def dispatch_analysis(
    stub: Any, # Accept the pre-created stub
    language: str,
    file_path: str,
    file_content: str,
    # target_address: str, # No longer needed, stub has channel
    timeout: float = 120.0 # Default timeout
) -> Optional["analyzer_pb2.StatusResponse"]: # Use string literal for deferred type evaluation
    """
    Sends an analysis request to a specific language analyzer service via gRPC.

    Args:
        language: The programming language of the file.
        file_path: The path to the file being analyzed (used for logging/context).
        file_content: The content of the file to be analyzed.
        target_address: The gRPC address (host:port) of the target analyzer service.
        timeout: Optional timeout in seconds for the gRPC call.

    Returns:
        An analyzer_pb2.StatusResponse object if the call completes (even if analysis failed),
        or None if there was a gRPC communication error or unexpected exception during dispatch.
    """
    # Removed check for dummy modules. Dependency injection handles unavailable stubs.
    if stub is None:
        logger.error(f"Cannot dispatch analysis for {file_path}: Provided stub is None.")
        return None

    logger.debug(f"Dispatching analysis for {file_path} ({language}) using provided stub.")
    try:
        # Removed local channel creation, using injected stub directly

        # Import analyzer_pb2 here, inside the function
        try:
            from generated.src import analyzer_pb2
        except ImportError:
            logger.error(f"Failed to import generated.src.analyzer_pb2 for {language}")
            return None # Cannot proceed without the message type

        # Ensure the request message type is available
        if not hasattr(analyzer_pb2, 'AnalyzeCodeRequest'):
             logger.error(f"AnalyzeCodeRequest not found in imported analyzer_pb2 for {language}")
             return None # Cannot proceed without request type

        grpc_request = analyzer_pb2.AnalyzeCodeRequest(
            file_path=file_path,
            file_content=file_content, # Revert to the correct proto field name
            language=language
        )

        # Log content being sent
        content_type = type(file_content)
        content_snippet = file_content[:100].replace('\n', '\\n') if isinstance(file_content, str) else 'N/A'
        logger.debug(f"Sending gRPC request for {file_path}: content_type={content_type}, content_snippet='{content_snippet}...'")

        # target_address is no longer passed, log based on stub/language if needed, or simplify
        logger.debug(f"Calling AnalyzeCode RPC for {file_path} ({language}) with timeout {timeout}s")
        response: analyzer_pb2.StatusResponse = await stub.AnalyzeCode(grpc_request, timeout=timeout)

        # Ensure the response type is as expected
        if not isinstance(response, analyzer_pb2.StatusResponse):
             logger.error(f"Unexpected response type {type(response)} received for {file_path}")
             # Create a synthetic failure response
             # Return a synthetic failure response using the string status
             return analyzer_pb2.StatusResponse(status="ERROR", message=f"Unexpected response type {type(response)} from analyzer")

        # Log the status and message directly from the StatusResponse
        # Status is now a string field in StatusResponse
        logger.debug(f"Received response from analyzer for {file_path}: Status={response.status}, Message='{response.message}'")

        # Return the entire StatusResponse object regardless of internal status
        return response

    except grpc.aio.AioRpcError as e:
        # Log specific gRPC error details
        error_code = e.code()
        error_details = e.details()
        logger.error(f"gRPC call using provided stub for {file_path} failed: {error_details} (Code: {error_code})")
        # Consider mapping gRPC codes (e.g., UNAVAILABLE, DEADLINE_EXCEEDED) to specific return statuses if needed
        # For now, return None to indicate communication failure
        return None
    except Exception as e:
        logger.exception(f"Unexpected error during dispatch for {file_path}")
        # Return None for unexpected errors during the dispatch process itself
        return None