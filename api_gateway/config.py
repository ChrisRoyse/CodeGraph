import os
import logging

logger = logging.getLogger(__name__)

# --- Service Addresses from Environment Variables ---

def get_env_var(key: str, default: str) -> str:
    """Gets an environment variable or returns a default, logging the outcome."""
    value = os.getenv(key, default)
    # Log only if it's different from default or if default is explicitly set
    # Avoid logging defaults for potentially sensitive things if not overridden
    if value != default or os.getenv(key) is not None:
         logger.info(f"Configuration: {key}={value}")
    else:
         logger.info(f"Configuration: {key} not set, using default '{default}'")
    return value

# Code Fetcher Service
CODE_FETCHER_HOST = get_env_var("CODE_FETCHER_HOST", "code-fetcher-service") # Updated default service name
CODE_FETCHER_PORT = get_env_var("CODE_FETCHER_PORT", "50051")
CODE_FETCHER_ADDR = f"{CODE_FETCHER_HOST}:{CODE_FETCHER_PORT}"

# Joern Analysis Service (Handles Java, C, C++)
# Directly read the full address from the environment variable
JOERN_ANALYSIS_ADDR = get_env_var("JOERN_ANALYSIS_SERVICE_ADDRESS", "joern_analysis_service:50053") # Default matches docker-compose if var missing

# Neo4j Ingestion Service
# Directly read the full address from the environment variable
NEO4J_INGESTION_ADDR = get_env_var("NEO4J_INGESTION_SERVICE_ADDRESS", "neo4j_ingestion_service:50055") # Default matches docker-compose if var missing

# SQL Analysis Service (TreeSitter SQL)
# Directly read the full address from the environment variable
SQL_ANALYSIS_ADDR = get_env_var("SQL_ANALYSIS_SERVICE_ADDRESS", "treesitter_sql_analyzer:50054") # Default matches docker-compose if var missing

# --- Neo4j Connection Details ---
NEO4J_URI = get_env_var("NEO4J_URI", "neo4j://localhost:7687")
NEO4J_USER = get_env_var("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = get_env_var("NEO4J_PASSWORD", "password") # Note: Use a strong password & secrets management in production!

# --- Language-Specific Analyzer Addresses ---
# Provides a mapping from language name to its gRPC service address.
# Allows overriding specific addresses via environment variables.

SUPPORTED_LANGUAGES = {
    "python": get_env_var("PYTHON_ANALYZER_ADDRESS", None),
    "javascript": get_env_var("JAVASCRIPT_ANALYZER_ADDRESS", None),
    "typescript": get_env_var("TYPESCRIPT_ANALYZER_ADDRESS", None),
    "tsx": get_env_var("TYPESCRIPT_ANALYZER_ADDRESS", None), # Often uses TS analyzer
    "go": get_env_var("GO_ANALYZER_ADDRESS", None),
    "rust": get_env_var("RUST_ANALYZER_ADDRESS", None),
    "csharp": get_env_var("CSHARP_ANALYZER_ADDRESS", None),
    # Languages handled by Joern
    "java": get_env_var("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR),
    "c": get_env_var("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR),
    "cpp": get_env_var("JOERN_ANALYSIS_SERVICE_ADDRESS", JOERN_ANALYSIS_ADDR),
    # SQL handled by its own service
    "sql": SQL_ANALYSIS_ADDR, # Use the potentially overridden SQL address
}

# Log which analyzers are configured
CONFIGURED_ANALYZERS = {lang: addr for lang, addr in SUPPORTED_LANGUAGES.items() if addr}
logger.info(f"Configured language analyzers: {list(CONFIGURED_ANALYZERS.keys())}")
if len(CONFIGURED_ANALYZERS) < len(SUPPORTED_LANGUAGES):
    missing = [lang for lang, addr in SUPPORTED_LANGUAGES.items() if not addr]
    logger.warning(f"Analyzer addresses not configured for: {missing}")

def get_analyzer_address(language: str) -> str | None:
    """Returns the configured gRPC address for the given language analyzer."""
    return CONFIGURED_ANALYZERS.get(language.lower())

# --- File Extensions Mapping ---
SUPPORTED_EXTENSIONS = {
    ".py": "python",
    ".js": "tsx", # Route JS to the TSX analyzer (typescript_analyzer_service)
    ".jsx": "tsx", # Route JSX to the TSX analyzer (typescript_analyzer_service)
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

def get_language_from_extension(file_path: str) -> str | None:
    """Determines the language based on file extension."""
    ext = os.path.splitext(file_path)[1].lower()
    return SUPPORTED_EXTENSIONS.get(ext)

# --- Other Config ---
# Example: Timeout for gRPC calls (can be overridden per call if needed)
DEFAULT_GRPC_TIMEOUT = float(get_env_var("DEFAULT_GRPC_TIMEOUT", "120.0")) # seconds