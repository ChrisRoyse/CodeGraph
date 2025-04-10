import os
import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, Body, status, Request # Add Request
from typing import List, Dict, Any, Optional

# Relative imports from within the api_gateway package
from .. import schemas, utils, config
from ..grpc_setup import get_analyzer_stub # Import only the stub factory

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/analyze-local",
    tags=["Local Analysis"],
)

# Dependency for Status enum
# GrpcStatus = Depends(get_status()) # Removed

@router.post(
    "", # Route path relative to prefix
    response_model=schemas.LocalAnalysisResponse,
    summary="Trigger Analysis for a Local Directory",
    description="""
Receives a local directory path (accessible within the container), scans for supported files,
dispatches analysis requests concurrently to relevant analyzer services via gRPC,
and reports the success/failure status of each analysis task.
"""
)
async def trigger_local_analysis(
    request: Request, # Add request for dependency injection state access
    request_body: schemas.LocalAnalysisRequest = Body(...), # Renamed to avoid conflict
    # status_enum = GrpcStatus # Removed
):
    logger.info(f"Received local analysis request for directory: {request_body.directory_path}")

    # --- Basic Validation ---
    if not os.path.isdir(request_body.directory_path):
        logger.error(f"Provided path is not a valid directory inside the container: {request_body.directory_path}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid directory_path: '{request_body.directory_path}' not found or not a directory inside the container.")

    # --- Scan Directory for Supported Files ---
    files_to_process: List[tuple[str, str]] = [] # List of (language, absolute_path)
    logger.info(f"Scanning directory '{request_body.directory_path}' for supported files...")
    for root, _, files in os.walk(request_body.directory_path):
        # Basic ignore patterns
        if any(ignored in root.split(os.sep) for ignored in ['.git', 'node_modules', '__pycache__']):
            continue
        for file in files:
            language = config.get_language_from_extension(file)
            if language:
                full_path = os.path.join(root, file)
                files_to_process.append((language, full_path))

    logger.info(f"Found {len(files_to_process)} supported files to analyze.")
    if not files_to_process:
        summary = schemas.LocalAnalysisSummary(files_scanned=0, tasks_dispatched=0, successful_tasks=0, failed_tasks=0)
        return schemas.LocalAnalysisResponse(message="No supported files found in the specified directory.", summary=summary, errors=[])

    # --- Prepare Analysis Tasks ---
    tasks = []
    files_skipped_reading: List[schemas.LocalAnalysisErrorDetail] = []
    files_pending_dispatch: List[tuple[str, str, str]] = [] # (language, file_path, file_content) - Removed target_address
    successful_analyses = 0
    failed_analyses = 0

    for language, file_path in files_to_process:
        target_address = config.get_analyzer_address(language)
        if not target_address:
            logger.warning(f"No analyzer service configured for language '{language}'. Skipping file: {file_path}")
            files_skipped_reading.append(schemas.LocalAnalysisErrorDetail(
                file=file_path, language=language, reason=f"No analyzer service configured for {language}"
            ))
            continue

        try:
            # Read file content synchronously. Consider aiofiles for large numbers of files.
            # Using 'errors=ignore' can hide encoding issues, but prevents crashes.
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                file_content = f.read()
            # Add to list for dispatching
            files_pending_dispatch.append((language, file_path, file_content)) # Removed target_address
        except FileNotFoundError:
            logger.error(f"File not found during read: {file_path}. Skipping analysis.")
            files_skipped_reading.append(schemas.LocalAnalysisErrorDetail(
                file=file_path, language=language, reason="File not found during read"
            ))
        except Exception as e:
            logger.exception(f"Unexpected error reading file {file_path}. Skipping analysis.")
            files_skipped_reading.append(schemas.LocalAnalysisErrorDetail(
                file=file_path, language=language, reason=f"Unexpected read error: {str(e)}"
            ))

    # Create asyncio tasks for dispatching
    # Get channel dependency function outside the loop
    get_channel = get_channel_dependency # Alias for clarity

    for lang, fpath, content in files_pending_dispatch:
         try:
             # Get the specific channel for the language using the dependency factory
             # Note: This still creates channel lookups per file, ideally inject the whole dict
             channel = get_channel(lang)(request) # Pass request for state access
             stub = analyzer_pb2_grpc.AnalyzerServiceStub(channel)
             # Pass the stub instead of the address
             tasks.append(utils.dispatch_analysis(stub, lang, fpath, content, timeout=config.DEFAULT_GRPC_TIMEOUT))
         except HTTPException as e:
             # Handle cases where the channel/stub for the language isn't available
             logger.error(f"Could not get gRPC stub for language '{lang}' for file {fpath}: {e.detail}")
             # Add to skipped files list
             files_skipped_reading.append(schemas.LocalAnalysisErrorDetail(
                 file=fpath, language=lang, reason=f"gRPC service for {lang} unavailable: {e.detail}"
             ))
             failed_analyses += 1 # Increment failure count here
         except Exception as e:
             logger.exception(f"Unexpected error getting gRPC stub for language '{lang}' for file {fpath}")
             files_skipped_reading.append(schemas.LocalAnalysisErrorDetail(
                 file=fpath, language=lang, reason=f"Unexpected error getting gRPC stub: {str(e)}"
             ))
             failed_analyses += 1 # Increment failure count here

    # --- Execute Tasks Concurrently ---
    logger.info(f"Dispatching {len(tasks)} analysis tasks concurrently...")
    # return_exceptions=True ensures all tasks complete, even if some fail.
    analysis_responses_or_exceptions: List[Optional[analyzer_pb2.StatusResponse] | BaseException] = await asyncio.gather(*tasks, return_exceptions=True)

    # --- Process Results ---
    error_details: List[schemas.LocalAnalysisErrorDetail] = []
    error_details.extend(files_skipped_reading) # Add errors from the reading phase
    failed_analyses += len(files_skipped_reading) # Count skipped reads as failures

    # Map results back to the files that were actually dispatched
    # Adjust dispatched_files_info as target_address was removed
    dispatched_files_info = [(lang, fpath) for lang, fpath, _ in files_pending_dispatch]

    for i, res_or_exc in enumerate(analysis_responses_or_exceptions):
        if i >= len(dispatched_files_info):
             logger.error(f"Result index {i} out of bounds for dispatched files ({len(dispatched_files_info)}). Skipping.")
             failed_analyses += 1
             error_details.append(schemas.LocalAnalysisErrorDetail(
                 file="Unknown (Index Error)", reason="Result index mismatch"
             ))
             continue

        original_language, original_file_path = dispatched_files_info[i]

        if isinstance(res_or_exc, analyzer_pb2.StatusResponse):
            # Assuming status is now a string like "SUCCESS" or "ERROR"
            if res_or_exc.status == "SUCCESS":
                successful_analyses += 1
            else:
                failed_analyses += 1
                status_name = res_or_exc.status # Status is now a string
                error_details.append(schemas.LocalAnalysisErrorDetail(
                    file=original_file_path,
                    language=original_language,
                    reason=f"Analyzer returned status '{status_name}'",
                    details=res_or_exc.message
                ))
        elif isinstance(res_or_exc, BaseException):
            failed_analyses += 1
            error_details.append(schemas.LocalAnalysisErrorDetail(
                file=original_file_path,
                language=original_language,
                reason="Exception during dispatch or analysis execution",
                details=str(res_or_exc)
            ))
        elif res_or_exc is None:
             failed_analyses += 1
             error_details.append(schemas.LocalAnalysisErrorDetail(
                file=original_file_path,
                language=original_language,
                reason="gRPC call failed or unexpected error in dispatch function",
                details="Check API Gateway logs for specific gRPC error details"
             ))
        else:
             failed_analyses += 1
             error_details.append(schemas.LocalAnalysisErrorDetail(
                file=original_file_path,
                language=original_language,
                reason="Unexpected result type received from analysis task",
                details=str(type(res_or_exc))
             ))

    logger.info(f"Analysis phase complete: {successful_analyses} successful, {failed_analyses} failed/skipped.")
    if error_details:
        logger.warning(f"Encountered {len(error_details)} errors/skipped files during analysis.")
        for error in error_details:
             logger.debug(f"Analysis Issue: File={error.file}, Reason={error.reason}, Details={error.details or 'N/A'}")

    # --- Return Summary ---
    final_message = f"Local analysis dispatch completed. Successful: {successful_analyses}, Failed/Skipped: {failed_analyses} out of {len(files_to_process)} files scanned."
    logger.info(final_message)

    summary = schemas.LocalAnalysisSummary(
        files_scanned=len(files_to_process),
        tasks_dispatched=len(tasks),
        successful_tasks=successful_analyses,
        failed_tasks=failed_analyses,
    )

    return schemas.LocalAnalysisResponse(
        message=final_message,
        summary=summary,
        errors=error_details
    )