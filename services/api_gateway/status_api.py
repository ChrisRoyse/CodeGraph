from fastapi import APIRouter, HTTPException, status
from typing import Dict, Any
import os
import pika
from neo4j import GraphDatabase
import requests

router = APIRouter(prefix="/status", tags=["Status Monitoring"])

# Load service config from env
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://neo4j:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'password')
RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_JOBS_QUEUE = os.getenv('RABBITMQ_JOBS_QUEUE', 'bmcp.jobs.analysis')
ID_SERVICE_URL = os.getenv('ID_SERVICE_URL', 'http://id_service:8080/health')

@router.get("/health")
def health_check():
    return {"status": "healthy"}

@router.get("/neo4j")
def neo4j_status():
    try:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        with driver.session() as session:
            session.run("RETURN 1")
        driver.close()
        return {"neo4j": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Neo4j connection failed: {str(e)}")

@router.get("/rabbitmq")
def rabbitmq_status():
    try:
        credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
        params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=credentials)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue=RABBITMQ_JOBS_QUEUE, durable=True)
        connection.close()
        return {"rabbitmq": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"RabbitMQ connection failed: {str(e)}")

@router.get("/rabbitmq/queue_depth")
def rabbitmq_queue_depth():
    try:
        credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
        params = pika.ConnectionParameters(host=RABBITMQ_HOST, port=RABBITMQ_PORT, credentials=credentials)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        queue = channel.queue_declare(queue=RABBITMQ_JOBS_QUEUE, durable=True, passive=True)
        message_count = queue.method.message_count
        connection.close()
        return {"queue": RABBITMQ_JOBS_QUEUE, "depth": message_count}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Failed to get queue depth: {str(e)}")

@router.get("/id_service")
def id_service_status():
    try:
        resp = requests.get(ID_SERVICE_URL, timeout=2)
        if resp.status_code == 200:
            return {"id_service": "healthy"}
        else:
            raise HTTPException(status_code=503, detail=f"ID Service unhealthy: {resp.status_code}")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"ID Service connection failed: {str(e)}")