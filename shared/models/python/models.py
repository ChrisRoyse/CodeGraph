from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field


class AnalysisNodeStub(BaseModel):
    """
    Represents a node to be created or updated in the Neo4j graph.
    
    Attributes:
        gid: Global ID (primary key for Neo4j)
        canonical_id: Canonical identifier
        name: Name of the entity
        file_path: Path to the file containing the entity
        language: Programming language
        labels: Neo4j labels to apply
        properties: Additional properties
    """
    gid: str
    canonical_id: str
    name: str
    file_path: str
    language: str
    labels: List[str]
    properties: Dict[str, Any]


class AnalysisRelationshipStub(BaseModel):
    """
    Represents a relationship to be created or updated in the Neo4j graph.
    
    Attributes:
        source_gid: GID of the source node
        target_canonical_id: Canonical ID of the target node
        type: Relationship type (e.g., CALLS, IMPORTS)
        properties: Additional properties
    """
    source_gid: str
    target_canonical_id: str
    type: str
    properties: Dict[str, Any]


class AnalyzerResultPayload(BaseModel):
    """
    Represents the result of analyzing a file.
    
    Attributes:
        file_path: Path to the analyzed file
        language: Programming language of the file
        error: Error message if analysis failed
        nodes_upserted: Nodes to create/update
        relationships_upserted: Relationships to create/update
        nodes_deleted: GIDs of nodes to delete
        relationships_deleted: Relationship identifiers to delete
    """
    file_path: str
    language: str
    error: Optional[str] = None
    nodes_upserted: List[AnalysisNodeStub] = Field(default_factory=list)
    relationships_upserted: List[AnalysisRelationshipStub] = Field(default_factory=list)
    nodes_deleted: List[str] = Field(default_factory=list)
    relationships_deleted: List[Dict[str, str]] = Field(default_factory=list)