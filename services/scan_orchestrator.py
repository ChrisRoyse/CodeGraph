# Minimal Scan Orchestrator Worker for CodeGraph
import os
from dotenv import load_dotenv
load_dotenv()
print("RABBITMQ_HOST =", os.getenv("RABBITMQ_HOST"))
import json
import pika
import sys
from pathlib import Path
import logging
import time
from scan_orchestrator_utils import wipe_sql_tables

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
    logging.debug(f"scan_and_dispatch called with root_path: {root_path}")
    file_count = 0
    for dirpath, _, filenames in os.walk(root_path):
        logging.debug(f"Scanning directory: {dirpath}, files: {filenames}")
        for fname in filenames:
            ext = Path(fname).suffix.lower()
            queue = EXTENSION_TO_QUEUE.get(ext)
            if queue:
                file_path = os.path.join(dirpath, fname)
                message = json.dumps({'file_path': file_path, 'id': str(uuid.uuid4())})
                channel.basic_publish(
                    exchange='',
                    routing_key=queue,
                    body=message,
                    properties=pika.BasicProperties(delivery_mode=2, content_type='application/json')
                )
                logging.info(f"Dispatched {file_path} to {queue}")
                file_count += 1
            else:
                logging.warning(f"No analyzer queue for extension: {ext} ({fname})")
    logging.debug(f"scan_and_dispatch finished. Total dispatched files: {file_count}")


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
    credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
    params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=credentials)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    for codebase in codebases:
        print(f"\n[ORCHESTRATOR] Wiping SQL tables before analyzing: {codebase}")
        wipe_sql_tables()
        print(f"[ORCHESTRATOR] Wipe complete. Dispatching scan jobs for {codebase}...")
        scan_and_dispatch(codebase, channel)
        print(f"[ORCHESTRATOR] Dispatched all files for {codebase}. Please verify SQL tables now.")
        print("[ORCHESTRATOR] Proceeding automatically to the next codebase (non-interactive mode)...")
    connection.close()

if __name__ == "__main__":
    # List of codebases to analyze
    base_dir = Path(__file__).parent.parent
    codebases = [
        str(base_dir / "test_polyglot_app"),
        str(base_dir / "test_polyglot_app2"),
        str(base_dir / "test_polyglot_app3"),
    ]
    analyze_codebases_sequentially(codebases)
