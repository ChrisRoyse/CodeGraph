from fastapi import APIRouter, HTTPException, status, Depends, Request
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from typing import Dict, Any
import os
from neo4j import GraphDatabase

router = APIRouter(prefix="/proxy", tags=["Query Proxy"])

API_KEY_NAME = "X-API-Key"
API_KEY = os.getenv("CODEGRAPH_API_KEY", "changeme")

api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

def verify_api_key(api_key: str = Depends(api_key_header)):
    if api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key",
        )

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://neo4j:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'password')

class CypherQueryModel(BaseModel):
    query: str
    params: Dict[str, Any] = {}

@router.post("/cypher", dependencies=[Depends(verify_api_key)])
def execute_cypher_query(data: CypherQueryModel):
    # Basic security: block destructive queries
    forbidden = ["delete", "detach", "remove", "drop", "call dbms", "apoc.", "load csv"]
    lowered = data.query.lower()
    if any(f in lowered for f in forbidden):
        raise HTTPException(status_code=400, detail="Destructive queries are not allowed via proxy")
    try:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        with driver.session() as session:
            result = session.run(data.query, data.params)
            records = [dict(record) for record in result]
        driver.close()
        return {"results": records}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute Cypher query: {str(e)}")