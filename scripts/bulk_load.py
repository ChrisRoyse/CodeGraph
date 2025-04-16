#!/usr/bin/env python3
"""
Bulk Loader Script for CodeGraph Phase 6.6

- Recursively scans CODEBASE_ROOT for supported file types.
- Publishes analysis jobs to the bmcp.jobs.analysis RabbitMQ queue for each file.
- Uses environment variables for configuration.
- Supports parallel publishing for efficiency.
- Logs progress and errors.
- Modular and extensible for new analyzers/file types.

Supported file types and message formats are mapped per analyzer.
"""

import os
import sys
import json
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Callable
import pika
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

# Configuration
CODEBASE_ROOT = os.getenv("CODEBASE_ROOT")
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "guest")
RABBITMQ_PASSWORD = os.getenv("RABBITMQ_PASSWORD", "guest")
RABBITMQ_JOBS_QUEUE = os.getenv("RABBITMQ_JOBS_QUEUE", "bmcp.jobs.analysis")
MAX_WORKERS = int(os.getenv("BULK_LOAD_MAX_WORKERS", "8"))

if not CODEBASE_ROOT:
    print("ERROR: CODEBASE_ROOT environment variable must be set.")
    sys.exit(1)

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger("bulk_load")

# File extension to analyzer message format mapping
FILE_TYPE_MAP: Dict[str, Dict] = {
    # Python
    ".py": {"format": lambda f: {"file_path": f, "event_type": "CREATED"}},
    # Java
    ".java": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # JavaScript/TypeScript
    ".js": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".jsx": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".ts": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".tsx": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # Go
    ".go": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # C#
    ".cs": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # C++
    ".cpp": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".cc": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".cxx": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".h": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".hpp": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # Rust
    ".rs": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # SQL
    ".sql": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    # HTML
    ".html": {"format": lambda f: {"file_path": f, "action": "analyze"}},
    ".htm": {"format": lambda f: {"file_path": f, "action": "analyze"}},
}

def get_supported_files(root: str) -> List[Path]:
    """Recursively find all supported files under root."""
    root_path = Path(root)
    files = []
    for ext in FILE_TYPE_MAP:
        files.extend(root_path.rglob(f"*{ext}"))
    return files

def publish_job(file_path: Path, connection_params: pika.ConnectionParameters) -> bool:
    """Publish a single job message for the given file."""
    ext = file_path.suffix.lower()
    if ext not in FILE_TYPE_MAP:
        logger.warning(f"Unsupported file extension: {file_path}")
        return False
    msg = FILE_TYPE_MAP[ext]["format"](str(file_path))
    try:
        connection = pika.BlockingConnection(connection_params)
        channel = connection.channel()
        channel.queue_declare(queue=RABBITMQ_JOBS_QUEUE, durable=True)
        channel.basic_publish(
            exchange="",
            routing_key=RABBITMQ_JOBS_QUEUE,
            body=json.dumps(msg),
            properties=pika.BasicProperties(
                delivery_mode=2,  # persistent
                content_type="application/json"
            )
        )
        connection.close()
        logger.info(f"Published job for {file_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to publish job for {file_path}: {e}")
        return False

def main():
    logger.info(f"Bulk loading from CODEBASE_ROOT={CODEBASE_ROOT}")
    files = get_supported_files(CODEBASE_ROOT)
    logger.info(f"Found {len(files)} supported files to process.")

    connection_params = pika.ConnectionParameters(
        host=RABBITMQ_HOST,
        port=RABBITMQ_PORT,
        credentials=pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD),
        heartbeat=600,
        blocked_connection_timeout=300
    )

    success_count = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_file = {
            executor.submit(publish_job, file_path, connection_params): file_path
            for file_path in files
        }
        for future in as_completed(future_to_file):
            file_path = future_to_file[future]
            try:
                if future.result():
                    success_count += 1
            except Exception as exc:
                logger.error(f"Error processing {file_path}: {exc}")

    logger.info(f"Published {success_count}/{len(files)} jobs successfully.")

    logger.info("Bulk loading complete. Monitor analyzers and ingestion worker for progress.")

if __name__ == "__main__":
    main()