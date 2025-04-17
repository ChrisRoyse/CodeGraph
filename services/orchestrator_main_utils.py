import os
from logging_utils import log_to_file_and_stdout
from orchestrator_db_utils import wipe_sql_tables
from dispatch_utils import scan_and_dispatch

log_to_file_and_stdout(f"[orchestrator_main_utils.py] TOP OF MODULE IMPORTED, __file__ = {__file__}")

def analyze_codebases_sequentially(codebases):
    log_to_file_and_stdout(f"[orchestrator_main_utils.py] ENTERED analyze_codebases_sequentially with codebases: {codebases}")
    import pika
    RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
    RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
    RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
    RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
    params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD))
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    for codebase in codebases:
        log_to_file_and_stdout(f"[orchestrator_main_utils.py] Processing codebase: {codebase}")
        wipe_sql_tables()
        scan_and_dispatch(codebase, channel)
    connection.close()
    log_to_file_and_stdout("[orchestrator_main_utils.py] RabbitMQ connection closed")
