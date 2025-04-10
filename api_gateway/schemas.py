from pydantic import BaseModel, HttpUrl, Field
from typing import Optional, List, Dict, Any

# --- Request Models ---

class AnalysisRequest(BaseModel):
    """
    Request model for triggering analysis on a Git repository.
    """
    repo_url: HttpUrl = Field(..., description="URL of the Git repository to analyze.")
    current_commit_sha: str = Field(..., description="The target commit SHA to analyze.")
    previous_commit_sha: Optional[str] = Field(None, description="If provided, perform an incremental analysis diffing against this SHA.")

    class Config:
        json_schema_extra = {
            "example": {
                "repo_url": "https://github.com/example/repo.git",
                "current_commit_sha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
                "previous_commit_sha": "f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1"
            }
        }

class LocalAnalysisRequest(BaseModel):
    """
    Request model for triggering analysis on a local directory
    accessible within the API Gateway container's filesystem.
    """
    directory_path: str = Field(..., description="Absolute path to the directory to analyze within the container's filesystem.")

    class Config:
        json_schema_extra = {
            "example": {
                "directory_path": "/mnt/shared/my_local_project"
            }
        }

# --- Response Models (Optional but good practice) ---

class AnalysisResponseDetail(BaseModel):
    """Detailed breakdown of analysis results."""
    nodes_processed: int = 0
    relationships_processed: int = 0
    files_deleted_in_graph: int = 0
    sql_analysis_results_size_bytes: int = 0

class AnalysisResponse(BaseModel):
    """Response model for the /analyze endpoint."""
    message: str
    repository_url: HttpUrl
    current_commit_sha: str
    previous_commit_sha: Optional[str] = None
    code_path: Optional[str] = None # Path where code was fetched (can be None if fetch failed)
    analysis_details: Optional[AnalysisResponseDetail] = None

class LocalAnalysisErrorDetail(BaseModel):
    """Details about a specific error during local analysis."""
    file: str
    language: Optional[str] = None
    reason: str
    details: Optional[str] = None

class LocalAnalysisSummary(BaseModel):
    """Summary statistics for the local analysis task."""
    files_scanned: int
    tasks_dispatched: int
    successful_tasks: int
    failed_tasks: int

class LocalAnalysisResponse(BaseModel):
    """Response model for the /analyze-local endpoint."""
    message: str
    summary: LocalAnalysisSummary
    errors: List[LocalAnalysisErrorDetail] = []

class HealthResponse(BaseModel):
    """Response model for the /health endpoint."""
    status: str = "ok"