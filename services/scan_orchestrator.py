import sys
import os
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))
def log_to_file_and_stdout(msg):
    print(msg, flush=True)
    try:
        with open("/app/orchestrator_debug.log", "a") as f:
            f.write(msg + "\n")
    except Exception as e:
        print(f"[ORCHESTRATOR] Failed to write log: {e}", flush=True)

log_to_file_and_stdout("[ORCHESTRATOR] Script started (very top)")
print("[ORCHESTRATOR] Imported os (before anything else)")
try:
    print(f"[ORCHESTRATOR] /app contents: {os.listdir('/app')}")
except Exception as e:
    print(f"[ORCHESTRATOR] Exception listing /app: {e}")
print("[ORCHESTRATOR] About to import dotenv...")

from dotenv import load_dotenv
print("[ORCHESTRATOR] Imported dotenv")
load_dotenv()
print("[ORCHESTRATOR] Loaded .env")
print("[ORCHESTRATOR] About to import wipe_sql_tables...")
print("RABBITMQ_HOST =", os.getenv("RABBITMQ_HOST"))
import json
import pika
print("[ORCHESTRATOR] Imported pika")
import time
from pathlib import Path
import logging
print("[ORCHESTRATOR] Imported logging")
try:
    from services.logging_utils import log_to_file_and_stdout
    from services.orchestrator_db_utils import wipe_sql_tables
    from services.dispatch_utils import scan_and_dispatch
    from services.orchestrator_main_utils import analyze_codebases_sequentially
except Exception as import_exc:
    def log_to_file_and_stdout(msg):
        print(msg, flush=True)
        try:
            with open("/app/orchestrator_debug.log", "a") as f:
                f.write(msg + "\n")
        except Exception as e:
            print(f"[ORCHESTRATOR] Failed to write log: {e}", flush=True)
    log_to_file_and_stdout(f"[ORCHESTRATOR] IMPORT ERROR: {import_exc}")
    import traceback
    log_to_file_and_stdout(traceback.format_exc())
    raise

logging.basicConfig(level=logging.INFO)

# Map file extensions to analyzer queues
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
    # Add more as needed
}

RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_SCAN_QUEUE = os.getenv('RABBITMQ_SCAN_QUEUE', 'bmcp.jobs.scan')


import uuid

def scan_and_dispatch(root_path, channel):
    """Recursively scan root_path and dispatch jobs to analyzer queues."""
    print(f"[DEBUG] Entered scan_and_dispatch with root_path: {root_path}", flush=True)
    try:
        if not os.path.exists(root_path):
            print(f"[ERROR] scan_and_dispatch: root_path does not exist: {root_path}", flush=True)
            return
        file_count = 0
        for dirpath, _, filenames in os.walk(root_path):
            print(f"[DEBUG] Scanning directory: {dirpath}, files: {filenames}", flush=True)
            for fname in filenames:
                ext = Path(fname).suffix.lower()
                queue = EXTENSION_TO_QUEUE.get(ext)
                print(f"[DEBUG] Found file: {fname} (ext: {ext}), queue: {queue}", flush=True)
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
                        print(f"[INFO] Dispatched {file_path} to {queue}", flush=True)
                        file_count += 1
                    except Exception as e:
                        print(f"[ERROR] Exception dispatching {file_path} to {queue}: {e}", flush=True)
                else:
                    print(f"[WARNING] No analyzer queue for extension: {ext} ({fname})", flush=True)
        print(f"[DEBUG] scan_and_dispatch finished. Total dispatched files: {file_count}", flush=True)
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in scan_and_dispatch: {e}", flush=True)
        traceback.print_exc()


def on_message(ch, method, properties, body):
    logging.debug("on_message callback triggered.")
    try:
        logging.debug(f"Received scan trigger message: {body}")
        msg = json.loads(body)
        action = msg.get('action')
        root_path = msg.get('root_path')
        logging.debug(f"Extracted action: {action}, root_path: {root_path}")
        if not root_path:
            logging.warning("No root_path specified in scan trigger. Skipping.")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        if action == 'full_scan':
            logging.info(f"Starting full scan of {root_path}")
            scan_and_dispatch(root_path, ch)
        else:
            logging.warning(f"Unknown action: {action}")
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logging.error(f"Exception in on_message: {e}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


import time

def analyze_codebases_sequentially(codebases):
    print(f"[ORCHESTRATOR] Entered analyze_codebases_sequentially with codebases: {codebases}", flush=True)
    try:
        if not codebases:
            print("[ORCHESTRATOR] ERROR: codebases list is empty!", flush=True)
            return
        params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD))
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        print(f"[ORCHESTRATOR] About to process codebases: {codebases}", flush=True)
        for codebase in codebases:
            print(f"[ORCHESTRATOR] Processing codebase: {codebase}", flush=True)
            if not os.path.exists(codebase):
                print(f"[ORCHESTRATOR] ERROR: codebase path does not exist: {codebase}", flush=True)
                continue
            print(f"\n[ORCHESTRATOR] Wiping SQL tables before analyzing: {codebase}", flush=True)
            try:
                wipe_sql_tables()
                print(f"[ORCHESTRATOR] Wipe complete for {codebase}", flush=True)
            except Exception as e:
                print(f"[ORCHESTRATOR] Exception during wipe_sql_tables: {e}", flush=True)
                import traceback; traceback.print_exc()
            print(f"[ORCHESTRATOR] Dispatching scan jobs for {codebase}...", flush=True)
            try:
                scan_and_dispatch(codebase, channel)
                print(f"[ORCHESTRATOR] Dispatched all files for {codebase}", flush=True)
            except Exception as e:
                print(f"[ORCHESTRATOR] Exception during scan_and_dispatch: {e}", flush=True)
                import traceback; traceback.print_exc()
            print("[ORCHESTRATOR] Proceeding automatically to the next codebase (non-interactive mode)...", flush=True)
        print("[ORCHESTRATOR] Closing RabbitMQ connection...", flush=True)
        connection.close()
        print("[ORCHESTRATOR] Connection closed.", flush=True)
    except Exception as e:
        import traceback
        print(f"[ORCHESTRATOR] Exception in analyze_codebases_sequentially: {e}", flush=True)
        traceback.print_exc()

"""
Orchestrator entrypoint for CodeGraph.

Usage:
    python services/scan_orchestrator.py [PATH_TO_SCAN]

- If PATH_TO_SCAN is provided, that directory will be scanned and analyzed.
- If not provided, defaults to test_polyglot_app/ in the project root.
"""

import os
print(f"[ORCHESTRATOR] TOP OF FILE: cwd={os.getcwd()} __file__={__file__}", flush=True)
try:
    print(f"[ORCHESTRATOR] TOP OF FILE: os.listdir('.')={os.listdir('.')} os.listdir('/app')={os.listdir('/app')}", flush=True)
except Exception as e:
    print(f"[ORCHESTRATOR] TOP OF FILE: Exception listing dirs: {e}", flush=True)

if __name__ == "__main__":
    import sys
    print(f"[ORCHESTRATOR] __main__ OUTSIDE TRY cwd={os.getcwd()} __file__={__file__}")
    sys.stdout.flush()
    try:
        print(f"[ORCHESTRATOR] __main__ INSIDE TRY - very first line")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ BEFORE os.listdir('.')")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ os.listdir('.')={os.listdir('.')} ")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ BEFORE os.listdir('/app')")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ os.listdir('/app')={os.listdir('/app')}")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ AFTER dir listings")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] __main__ BEFORE arg parse")
        sys.stdout.flush()
        if len(sys.argv) > 1:
            scan_path = sys.argv[1]
            print(f"[ORCHESTRATOR] Using directory from argument: {scan_path}")
            sys.stdout.flush()
        else:
            project_root = Path(__file__).parent.parent
            scan_path = str(project_root / "test_polyglot_app")
            print(f"[ORCHESTRATOR] No directory argument provided. Defaulting to: {scan_path}")
            sys.stdout.flush()
        print(f"[ORCHESTRATOR] scan_path = {scan_path}")
        sys.stdout.flush()
        print(f"[ORCHESTRATOR] Path exists: {os.path.exists(scan_path)}")
        sys.stdout.flush()
        try:
            print(f"[ORCHESTRATOR] Scan target contents: {os.listdir(scan_path)}")
            sys.stdout.flush()
        except Exception as e:
            print(f"[ORCHESTRATOR] Exception listing scan_path contents: {e}")
            sys.stdout.flush()
        codebases = [scan_path]
        log_to_file_and_stdout(f"[ORCHESTRATOR] About to call analyze_codebases_sequentially with: {codebases}")
        log_to_file_and_stdout(f"[ORCHESTRATOR] BEFORE analyze_codebases_sequentially")
        analyze_codebases_sequentially(codebases)
        log_to_file_and_stdout(f"[ORCHESTRATOR] AFTER analyze_codebases_sequentially")
        log_to_file_and_stdout("[ORCHESTRATOR] <<< END OF __main__ block >>>")

    except Exception as e:
        import traceback
        exc_type, exc_value, exc_tb = sys.exc_info()
        tb_str = ''.join(traceback.format_exception(exc_type, exc_value, exc_tb))
        print("\n[ORCHESTRATOR] >>> EXCEPTION DURING STARTUP <<<")
        print(f"Exception: {e}")
        print(tb_str)
        print("[ORCHESTRATOR] <<< END EXCEPTION >>>\n")
        sys.stdout.flush()
        # Write to file
        try:
            with open("/app/orchestrator_error.log", "w") as f:
                f.write("[ORCHESTRATOR] >>> EXCEPTION DURING STARTUP <<<\n")
                f.write(f"Exception: {e}\n")
                f.write(tb_str)
                f.write("[ORCHESTRATOR] <<< END EXCEPTION >>>\n")
        except Exception as file_exc:
            print(f"[ORCHESTRATOR] Failed to write exception to log file: {file_exc}")
            sys.stdout.flush()
    print(f"[ORCHESTRATOR] __main__ AFTER TRY/EXCEPT")
    sys.stdout.flush()
    sys.exit(0)
