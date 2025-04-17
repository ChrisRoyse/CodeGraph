import os
import json
import pika
import uuid
from pathlib import Path
from logging_utils import log_to_file_and_stdout

def scan_and_dispatch(root_path, channel):
    """Recursively scan root_path and dispatch jobs to analyzer queues."""
    log_to_file_and_stdout(f"[DEBUG] Entered scan_and_dispatch with root_path: {root_path}")
    try:
        if not os.path.exists(root_path):
            log_to_file_and_stdout(f"[ERROR] scan_and_dispatch: root_path does not exist: {root_path}")
            return
        file_count = 0
        EXTENSION_TO_QUEUE = {
            '.py': os.getenv('PYTHON_ANALYZER_QUEUE', 'bmcp.jobs.analysis.python'),
            '.js': os.getenv('JS_ANALYZER_QUEUE', 'bmcp.jobs.analysis.js'),
            '.ts': os.getenv('TS_ANALYZER_QUEUE', 'bmcp.jobs.analysis.ts'),
            '.java': os.getenv('JAVA_ANALYZER_QUEUE', 'bmcp.jobs.analysis.java'),
            '.go': os.getenv('GO_ANALYZER_QUEUE', 'bmcp.jobs.analysis.go'),
            '.rs': os.getenv('RUST_ANALYZER_QUEUE', 'bmcp.jobs.analysis.rust'),
            '.cs': os.getenv('CSHARP_ANALYZER_QUEUE', 'bmcp.jobs.analysis.csharp'),
            '.sql': os.getenv('SQL_ANALYZER_QUEUE', 'bmcp.jobs.analysis.sql'),
            '.html': os.getenv('HTML_ANALYZER_QUEUE', 'bmcp.jobs.analysis.html'),
        }
        for dirpath, _, filenames in os.walk(root_path):
            log_to_file_and_stdout(f"[DEBUG] Scanning directory: {dirpath}, files: {filenames}")
            for fname in filenames:
                ext = Path(fname).suffix.lower()
                queue = EXTENSION_TO_QUEUE.get(ext)
                log_to_file_and_stdout(f"[DEBUG] Found file: {fname} (ext: {ext}), queue: {queue}")
                if queue:
                    file_path = os.path.join(dirpath, fname)
                    message = json.dumps({'file_path': file_path, 'id': str(uuid.uuid4())})
                    try:
                        channel.basic_publish(
                            exchange='',
                            routing_key=queue,
                            body=message,
                            properties=pika.BasicProperties(delivery_mode=2, content_type='application/json')
                        )
                        log_to_file_and_stdout(f"[INFO] Dispatched {file_path} to {queue}")
                        file_count += 1
                    except Exception as e:
                        log_to_file_and_stdout(f"[ERROR] Exception dispatching {file_path} to {queue}: {e}")
                else:
                    log_to_file_and_stdout(f"[WARNING] No analyzer queue for extension: {ext} ({fname})")
        log_to_file_and_stdout(f"[DEBUG] scan_and_dispatch finished. Total dispatched files: {file_count}")
    except Exception as e:
        import traceback
        log_to_file_and_stdout(f"[ERROR] Exception in scan_and_dispatch: {e}")
        traceback.print_exc()
