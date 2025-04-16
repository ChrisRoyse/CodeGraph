import os
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)

def test_root():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Welcome to CodeGraph API" in resp.json().get("message", "")

# --- Config API ---
def test_config_watched_dirs():
    resp = client.get("/config/watched_dirs")
    assert resp.status_code == 200
    dirs = resp.json()["watched_dirs"]
    resp2 = client.post("/config/watched_dirs", json={"watched_dirs": ["a", "b"]})
    assert resp2.status_code == 200
    assert resp2.json()["watched_dirs"] == ["a", "b"]

def test_config_ignored_patterns():
    resp = client.get("/config/ignored_patterns")
    assert resp.status_code == 200
    resp2 = client.post("/config/ignored_patterns", json={"ignored_patterns": ["*.tmp"]})
    assert resp2.status_code == 200
    assert resp2.json()["ignored_patterns"] == ["*.tmp"]

def test_config_lang_extension_map():
    resp = client.get("/config/lang_extension_map")
    assert resp.status_code == 200
    resp2 = client.post("/config/lang_extension_map", json={"lang_extension_map": {"python": [".py"]}})
    assert resp2.status_code == 200
    assert resp2.json()["lang_extension_map"] == {"python": [".py"]}

# --- Status API ---
def test_status_health():
    resp = client.get("/status/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"

@pytest.mark.skip("Requires running Neo4j instance")
def test_status_neo4j():
    resp = client.get("/status/neo4j")
    assert resp.status_code in (200, 503)

@pytest.mark.skip("Requires running RabbitMQ instance")
def test_status_rabbitmq():
    resp = client.get("/status/rabbitmq")
    assert resp.status_code in (200, 503)

@pytest.mark.skip("Requires running RabbitMQ instance")
def test_status_rabbitmq_queue_depth():
    resp = client.get("/status/rabbitmq/queue_depth")
    assert resp.status_code in (200, 503)

@pytest.mark.skip("Requires running ID Service")
def test_status_id_service():
    resp = client.get("/status/id_service")
    assert resp.status_code in (200, 503)

# --- Query Proxy API ---
def test_query_proxy_auth_required():
    resp = client.post("/proxy/cypher", json={"query": "RETURN 1"})
    assert resp.status_code == 401

def test_query_proxy_forbidden_query():
    api_key = os.getenv("CODEGRAPH_API_KEY", "changeme")
    headers = {"X-API-Key": api_key}
    resp = client.post("/proxy/cypher", json={"query": "MATCH (n) DELETE n"}, headers=headers)
    assert resp.status_code == 400

@pytest.mark.skip("Requires running Neo4j instance")
def test_query_proxy_valid_query():
    api_key = os.getenv("CODEGRAPH_API_KEY", "changeme")
    headers = {"X-API-Key": api_key}
    resp = client.post("/proxy/cypher", json={"query": "RETURN 1"}, headers=headers)
    assert resp.status_code in (200, 500)

# --- Scan API ---
@pytest.mark.skip("Requires running RabbitMQ instance")
def test_scan_trigger():
    resp = client.post("/scan/trigger")
    assert resp.status_code in (200, 500)