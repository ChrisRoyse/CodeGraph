from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

class Node(BaseModel):
    """Represents a code entity node."""
    uniqueId: str = Field(..., description="Unique identifier for the node")
    name: str = Field(..., description="Name of the code entity (e.g., function name, class name)")
    filePath: str = Field(..., description="Relative path to the file containing the node")
    startLine: int = Field(..., description="Starting line number of the entity in the file")
    endLine: int = Field(..., description="Ending line number of the entity in the file")
    language: str = Field(..., description="Programming language of the file")
    labels: List[str] = Field(..., description="List of labels classifying the node (e.g., 'Function', 'Class', 'Variable')")

class RelationshipStub(BaseModel):
    """Represents a potential relationship identified by an analyzer."""
    sourceId: str = Field(..., description="uniqueId of the source node")
    targetIdentifier: str = Field(..., description="An identifier for the target node (e.g., function name, module path) to be resolved later")
    type: str = Field(..., description="The type of the relationship (e.g., 'CALLS', 'IMPORTS', 'REFERENCES')")
    properties: Optional[Dict[str, Any]] = Field(None, description="Optional properties for the relationship")

class AnalysisData(BaseModel):
    """Defines the structure for analysis data submitted by analyzers."""
    nodes: List[Node] = Field(..., description="List of nodes identified in the analysis")
    relationships: List[RelationshipStub] = Field(..., description="List of potential relationships identified")