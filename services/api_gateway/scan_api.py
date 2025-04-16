from fastapi import APIRouter, HTTPException, status, Request
import os
import pika
import json

router = APIRouter(prefix="/scan", tags=["Scan Trigger"])

RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_SCAN_QUEUE = os.getenv('RABBITMQ_SCAN_QUEUE', 'bmcp.jobs.scan')

@router.post("/trigger")
async def trigger_full_scan(request: Request):
    try:
        body = await request.json()
        if 'action' not in body or 'root_path' not in body:
            raise HTTPException(status_code=400, detail="'action' and 'root_path' are required fields.")
        credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
        params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=credentials)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue=RABBITMQ_SCAN_QUEUE, durable=True)
        print(f"[DEBUG] About to publish to queue: {RABBITMQ_SCAN_QUEUE}, body: {json.dumps(body)}")
        channel.basic_publish(
            exchange='',
            routing_key=RABBITMQ_SCAN_QUEUE,
            body=json.dumps(body),
            properties=pika.BasicProperties(delivery_mode=2)
        )
        print(f"[DEBUG] Published to queue: {RABBITMQ_SCAN_QUEUE}")
        connection.close()
        return {"status": "scan_triggered"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger scan: {str(e)}")