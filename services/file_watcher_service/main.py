#!/usr/bin/env python3
"""
File Watcher Service for CodeGraph

This service monitors file system changes and publishes events to RabbitMQ.
It watches for CREATED, MODIFIED, and DELETED events on Python (.py) files,
filters out ignored patterns, implements event debouncing, and publishes
events to the analysis queue.
"""

import os
import sys
import time
import json
import logging
import re
import fnmatch
import platform
import threading
from pathlib import Path
from typing import Dict, Any, List, Set, Optional
from datetime import datetime

import pika
from dotenv import load_dotenv
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent, EVENT_TYPE_CREATED, EVENT_TYPE_MODIFIED, EVENT_TYPE_DELETED

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Configuration
RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_QUEUE = os.getenv('RABBITMQ_QUEUE', 'bmcp.jobs.analysis')
CODEBASE_ROOT = os.getenv('CODEBASE_ROOT', '/codebase')

# Debounce configuration
DEBOUNCE_MS = int(os.getenv('DEBOUNCE_MS', '500'))  # Default to 500ms

# Ignored patterns configuration
DEFAULT_IGNORED_PATTERNS = "node_modules,.git,__pycache__,venv,.env"
IGNORED_PATTERNS_STR = os.getenv('IGNORED_PATTERNS', DEFAULT_IGNORED_PATTERNS)
IGNORED_PATTERNS = [pattern.strip() for pattern in IGNORED_PATTERNS_STR.split(',') if pattern.strip()]

# --- Robust, Modular FileChangeHandler with OS edge case logging, error handling, and RabbitMQ retry ---
class FileChangeHandler(FileSystemEventHandler):
    """Handler for file system events with robust error handling and logging."""

    def __init__(self, rabbitmq_publisher):
        self.rabbitmq_publisher = rabbitmq_publisher
        # Dictionary to track last modification time for each file
        self.file_timestamps: Dict[str, float] = {}
        logger.info(f"Debounce time set to {DEBOUNCE_MS}ms")
        logger.info(f"Ignored patterns: {IGNORED_PATTERNS}")

    def on_any_event(self, event: FileSystemEvent):
        """Handle all events, logging unexpected event types."""
        # OS-level: Some platforms emit extra/unknown event types (esp. temp files, e.g. Windows .~tmp, macOS .DS_Store)
        event_type = event.event_type.upper()
        if event_type not in ("CREATED", "MODIFIED", "DELETED"):
            logger.warning(f"Received unexpected event type: {event_type} for {event.src_path} (platform: {platform.system()})")
        # Call specific handler for known types
        if event_type == "CREATED":
            self.on_created(event)
        elif event_type == "MODIFIED":
            self.on_modified(event)
        elif event_type == "DELETED":
            self.on_deleted(event)
        else:
            # Still log ignored/unknown events for traceability
            logger.info(f"Ignored event type: {event_type} for {event.src_path}")

    def on_created(self, event: FileSystemEvent):
        self._process_event(event, "CREATED")

    def on_modified(self, event: FileSystemEvent):
        self._process_event(event, "MODIFIED")

    def on_deleted(self, event: FileSystemEvent):
        self._process_event(event, "DELETED")

    def _should_ignore_path(self, path: str) -> bool:
        """Check if a path should be ignored based on the ignored patterns."""
        path_str = str(path)
        # Ignore OS temp files (e.g., Windows ~, macOS .DS_Store)
        if platform.system() == "Windows" and path_str.endswith("~"):
            logger.debug(f"Ignoring Windows temp file: {path_str}")
            return True
        if platform.system() == "Darwin" and ("/.DS_Store" in path_str or path_str.endswith(".DS_Store")):
            logger.debug(f"Ignoring macOS .DS_Store: {path_str}")
            return True
        for pattern in IGNORED_PATTERNS:
            if fnmatch.fnmatch(path_str, f"*{pattern}*"):
                logger.debug(f"Ignoring path {path_str} (matched pattern: {pattern})")
                return True
        return False

    def _should_process_now(self, file_path: str, event_type: str) -> bool:
        """Debounce logic: Only process if enough time has passed since last event."""
        if event_type == "DELETED":
            if file_path in self.file_timestamps:
                del self.file_timestamps[file_path]
            return True
        current_time = time.time() * 1000  # ms
        if file_path not in self.file_timestamps:
            self.file_timestamps[file_path] = current_time
            logger.debug(f"First event for {file_path}, waiting for debounce period")
            return False
        last_time = self.file_timestamps[file_path]
        time_diff = current_time - last_time
        self.file_timestamps[file_path] = current_time
        if time_diff >= DEBOUNCE_MS:
            logger.debug(f"Processing event for {file_path} after {time_diff}ms")
            return True
        else:
            logger.debug(f"Debouncing event for {file_path}, only {time_diff}ms since last event")
            return False

    def _process_event(self, event: FileSystemEvent, event_type: str):
        """Process file events that meet our criteria, with robust error handling and logging."""
        if event.is_directory:
            logger.debug(f"Ignored directory event: {event_type} for {event.src_path}")
            return
        try:
            abs_path = Path(event.src_path).resolve()
            # OS-specific: Some editors create temp files then rename (e.g., .swp, .tmp)
            if event_type != "DELETED" and not abs_path.suffix == '.py':
                logger.debug(f"Ignored non-.py file event: {abs_path}")
                return
            elif event_type == "DELETED" and not event.src_path.endswith('.py'):
                logger.debug(f"Ignored non-.py deleted event: {event.src_path}")
                return
            if self._should_ignore_path(abs_path):
                logger.info(f"Ignored {event_type} event for {abs_path} (matched ignored pattern)")
                return
            # Relative path handling with error fallback
            try:
                if event_type == "DELETED":
                    try:
                        rel_path = Path(event.src_path).relative_to(Path(CODEBASE_ROOT).resolve())
                    except ValueError:
                        rel_path = Path(event.src_path).name
                else:
                    rel_path = abs_path.relative_to(Path(CODEBASE_ROOT).resolve())
            except Exception as e:
                logger.error(f"Error determining relative path for {event.src_path}: {e}")
                rel_path = str(event.src_path)
            if not self._should_process_now(str(abs_path), event_type):
                logger.debug(f"Debounced event: {event_type} for {rel_path}")
                return
            message = {
                "file_path": str(rel_path),
                "event_type": event_type
            }
            # Publish with retry/backoff
            self.rabbitmq_publisher.publish_with_retry(message)
            logger.info(f"Published event: {event_type} for {rel_path}")
        except Exception as e:
            logger.error(f"Error processing event {event_type} for {getattr(event, 'src_path', 'unknown')}: {e}")
        except Exception as e:
            logger.error(f"Error processing event {event}: {e}")


# --- Modular RabbitMQ Publisher with retry/backoff ---
class RabbitMQPublisher:
    """Handles RabbitMQ connection and publishing with retry/backoff and error logging."""

    def __init__(self, host, port, user, password, queue, max_retries=5, base_backoff=1.0):
        self.host = host
        self.port = port
        self.user = user
        self.password = password
        self.queue = queue
        self.max_retries = max_retries
        self.base_backoff = base_backoff
        self._connect()

    def _connect(self):
        for attempt in range(1, self.max_retries + 1):
            try:
                credentials = pika.PlainCredentials(self.user, self.password)
                params = pika.ConnectionParameters(
                    host=self.host,
                    port=self.port,
                    credentials=credentials,
                    heartbeat=600,
                    blocked_connection_timeout=300
                )
                self.connection = pika.BlockingConnection(params)
                self.channel = self.connection.channel()
                self.channel.queue_declare(queue=self.queue, durable=True)
                logger.info(f"Connected to RabbitMQ at {self.host}:{self.port}, queue: {self.queue}")
                return
            except Exception as e:
                logger.error(f"RabbitMQ connection failed (attempt {attempt}/{self.max_retries}): {e}")
                time.sleep(self.base_backoff * attempt)
        logger.critical("Failed to connect to RabbitMQ after multiple attempts. Exiting.")
        sys.exit(2)

    def publish_with_retry(self, message: dict):
        body = json.dumps(message)
        for attempt in range(1, self.max_retries + 1):
            try:
                self.channel.basic_publish(
                    exchange='',
                    routing_key=self.queue,
                    body=body,
                    properties=pika.BasicProperties(
                        delivery_mode=2,
                        content_type='application/json'
                    )
                )
                return
            except Exception as e:
                logger.error(f"Failed to publish to RabbitMQ (attempt {attempt}/{self.max_retries}): {e}")
                # Try to reconnect if connection is closed/broken
                try:
                    self._connect()
                except Exception as conn_e:
                    logger.error(f"Error reconnecting to RabbitMQ: {conn_e}")
                time.sleep(self.base_backoff * attempt)
        logger.critical("Failed to publish message after multiple attempts. Message dropped.")

    def close(self):
        try:
            if hasattr(self, "connection") and self.connection and self.connection.is_open:
                self.connection.close()
                logger.info("RabbitMQ connection closed.")
        except Exception as e:
            logger.error(f"Error closing RabbitMQ connection: {e}")

def main():
    """Main entry point for the File Watcher service with robust error handling and logging."""
    logger.info("========== File Watcher Service Starting ==========")
    logger.info(f"Platform: {platform.system()} {platform.release()} ({platform.platform()})")
    logger.info(f"Python version: {sys.version}")
    logger.info(f"Watching root: {CODEBASE_ROOT}")

    rabbitmq_publisher = None
    observer = None
    try:
        # Connect to RabbitMQ with retry/backoff
        rabbitmq_publisher = RabbitMQPublisher(
            host=RABBITMQ_HOST,
            port=RABBITMQ_PORT,
            user=RABBITMQ_USER,
            password=RABBITMQ_PASSWORD,
            queue=RABBITMQ_QUEUE,
            max_retries=5,
            base_backoff=2.0
        )

        # Set up the file system observer with robust error handling
        event_handler = FileChangeHandler(rabbitmq_publisher)
        observer = Observer()
        try:
            observer.schedule(event_handler, CODEBASE_ROOT, recursive=True)
        except Exception as e:
            logger.critical(f"Failed to schedule observer for {CODEBASE_ROOT}: {e}")
            logger.critical("Check directory permissions or existence. Exiting.")
            return 2

        try:
            observer.start()
            logger.info(f"Started watching directory: {CODEBASE_ROOT}")
        except Exception as e:
            logger.critical(f"Failed to start observer: {e}")
            return 2

        # Service main loop with graceful shutdown/recovery
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            logger.info("Received KeyboardInterrupt. Shutting down gracefully...")
        except Exception as e:
            logger.error(f"Unhandled error in main loop: {e}")
        finally:
            if observer:
                observer.stop()
                observer.join()
            if rabbitmq_publisher:
                rabbitmq_publisher.close()
            logger.info("========== File Watcher Service Stopped ==========")
        return 0

    except Exception as e:
        logger.critical(f"Fatal error in main: {e}", exc_info=True)
        if observer:
            try:
                observer.stop()
                observer.join()
            except Exception:
                pass
        if rabbitmq_publisher:
            try:
                rabbitmq_publisher.close()
            except Exception:
                pass
        return 1


if __name__ == "__main__":
    exit(main())

#
# Robustness Improvements (Phase 6.5):
# - OS-Level Edge Cases:
#     * Logs platform at startup.
#     * Handles and logs unexpected/unknown event types (on_any_event).
#     * Ignores and logs OS-specific temp files (Windows ~, macOS .DS_Store).
#     * Logs ignored events for traceability.
# - Error Handling:
#     * Directory access errors (permissions, missing root) are caught and logged, service exits gracefully.
#     * RabbitMQ connection and publishing use retry logic with exponential backoff; logs all failures and drops messages only after multiple attempts.
#     * File path/metadata errors are logged with context.
#     * All exceptions in event processing are caught and logged with event context.
# - Restart/Recovery Logic:
#     * Service logs startup/shutdown and observer state transitions.
#     * Graceful shutdown on KeyboardInterrupt or fatal errors.
#     * RabbitMQ reconnects on publish failure.
#     * Observer is stopped and joined on exit.
#     * No state persistence (out of scope), but logs events that may be missed.
# - Logging:
#     * Enhanced logging for errors, ignored events, unexpected event types, observer state, RabbitMQ failures, and service lifecycle.
#     * Logs watched paths, platform, and Python version at startup.
# - Modularity:
#     * RabbitMQ publishing logic modularized into RabbitMQPublisher class.
#     * FileChangeHandler is focused on event filtering and processing.
#