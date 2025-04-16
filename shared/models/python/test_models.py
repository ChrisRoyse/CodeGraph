import json
import unittest
from typing import Dict, Any, List

import pytest
from pydantic import ValidationError

from models import (
    AnalysisNodeStub,
    AnalysisRelationshipStub,
    AnalyzerResultPayload,
)


class TestAnalysisNodeStub(unittest.TestCase):
    def test_valid_node_stub(self):
        """Test creating a valid AnalysisNodeStub instance."""
        node_data = {
            "gid": "py:abc123",
            "canonical_id": "path/to/file.py::Function::my_func",
            "name": "my_func",
            "file_path": "path/to/file.py",
            "language": "python",
            "labels": ["Function", "Node"],
            "properties": {"line_number": 42, "is_async": False},
        }
        
        # Create instance
        node = AnalysisNodeStub(**node_data)
        
        # Verify attributes
        self.assertEqual(node.gid, "py:abc123")
        self.assertEqual(node.canonical_id, "path/to/file.py::Function::my_func")
        self.assertEqual(node.name, "my_func")
        self.assertEqual(node.file_path, "path/to/file.py")
        self.assertEqual(node.language, "python")
        self.assertEqual(node.labels, ["Function", "Node"])
        self.assertEqual(node.properties, {"line_number": 42, "is_async": False})
        
        # Test serialization
        json_str = node.model_dump_json()
        deserialized = json.loads(json_str)
        self.assertEqual(deserialized["gid"], "py:abc123")
        
        # Test deserialization
        node2 = AnalysisNodeStub.model_validate_json(json_str)
        self.assertEqual(node2.gid, node.gid)
        self.assertEqual(node2.properties, node.properties)
    
    def test_invalid_node_stub(self):
        """Test validation error when required fields are missing."""
        # Missing required fields
        invalid_data = {
            "gid": "py:abc123",
            "name": "my_func",
            # Missing canonical_id, file_path, language, labels, properties
        }
        
        with pytest.raises(ValidationError):
            AnalysisNodeStub(**invalid_data)


class TestAnalysisRelationshipStub(unittest.TestCase):
    def test_valid_relationship_stub(self):
        """Test creating a valid AnalysisRelationshipStub instance."""
        rel_data = {
            "source_gid": "py:abc123",
            "target_canonical_id": "path/to/file.py::Function::other_func",
            "type": "CALLS",
            "properties": {"line_number": 45, "is_async": True},
        }
        
        # Create instance
        rel = AnalysisRelationshipStub(**rel_data)
        
        # Verify attributes
        self.assertEqual(rel.source_gid, "py:abc123")
        self.assertEqual(rel.target_canonical_id, "path/to/file.py::Function::other_func")
        self.assertEqual(rel.type, "CALLS")
        self.assertEqual(rel.properties, {"line_number": 45, "is_async": True})
        
        # Test serialization
        json_str = rel.model_dump_json()
        deserialized = json.loads(json_str)
        self.assertEqual(deserialized["source_gid"], "py:abc123")
        
        # Test deserialization
        rel2 = AnalysisRelationshipStub.model_validate_json(json_str)
        self.assertEqual(rel2.source_gid, rel.source_gid)
        self.assertEqual(rel2.properties, rel.properties)
    
    def test_invalid_relationship_stub(self):
        """Test validation error when required fields are missing."""
        # Missing required fields
        invalid_data = {
            "source_gid": "py:abc123",
            # Missing target_canonical_id, type, properties
        }
        
        with pytest.raises(ValidationError):
            AnalysisRelationshipStub(**invalid_data)


class TestAnalyzerResultPayload(unittest.TestCase):
    def test_valid_result_payload(self):
        """Test creating a valid AnalyzerResultPayload instance."""
        # Create node and relationship stubs
        node = AnalysisNodeStub(
            gid="py:abc123",
            canonical_id="path/to/file.py::Function::my_func",
            name="my_func",
            file_path="path/to/file.py",
            language="python",
            labels=["Function", "Node"],
            properties={"line_number": 42, "is_async": False},
        )
        
        rel = AnalysisRelationshipStub(
            source_gid="py:abc123",
            target_canonical_id="path/to/file.py::Function::other_func",
            type="CALLS",
            properties={"line_number": 45, "is_async": True},
        )
        
        # Create payload
        payload_data = {
            "file_path": "path/to/file.py",
            "language": "python",
            "nodes_upserted": [node],
            "relationships_upserted": [rel],
            "nodes_deleted": ["py:def456"],
            "relationships_deleted": [{"source_gid": "py:abc123", "target_canonical_id": "path/to/file.py::Function::deleted_func"}],
        }
        
        payload = AnalyzerResultPayload(**payload_data)
        
        # Verify attributes
        self.assertEqual(payload.file_path, "path/to/file.py")
        self.assertEqual(payload.language, "python")
        self.assertEqual(len(payload.nodes_upserted), 1)
        self.assertEqual(len(payload.relationships_upserted), 1)
        self.assertEqual(payload.nodes_deleted, ["py:def456"])
        self.assertEqual(len(payload.relationships_deleted), 1)
        self.assertIsNone(payload.error)
        
        # Test serialization
        json_str = payload.model_dump_json()
        deserialized = json.loads(json_str)
        self.assertEqual(deserialized["file_path"], "path/to/file.py")
        
        # Test deserialization
        payload2 = AnalyzerResultPayload.model_validate_json(json_str)
        self.assertEqual(payload2.file_path, payload.file_path)
        self.assertEqual(len(payload2.nodes_upserted), len(payload.nodes_upserted))
    
    def test_minimal_result_payload(self):
        """Test creating a minimal AnalyzerResultPayload with only required fields."""
        # Only required fields
        payload_data = {
            "file_path": "path/to/file.py",
            "language": "python",
        }
        
        payload = AnalyzerResultPayload(**payload_data)
        
        # Verify attributes and default values
        self.assertEqual(payload.file_path, "path/to/file.py")
        self.assertEqual(payload.language, "python")
        self.assertEqual(payload.nodes_upserted, [])
        self.assertEqual(payload.relationships_upserted, [])
        self.assertEqual(payload.nodes_deleted, [])
        self.assertEqual(payload.relationships_deleted, [])
        self.assertIsNone(payload.error)
    
    def test_error_result_payload(self):
        """Test creating an AnalyzerResultPayload with an error message."""
        payload_data = {
            "file_path": "path/to/file.py",
            "language": "python",
            "error": "Failed to parse file: syntax error at line 42",
        }
        
        payload = AnalyzerResultPayload(**payload_data)
        
        # Verify error message
        self.assertEqual(payload.error, "Failed to parse file: syntax error at line 42")
        
        # Test serialization with error
        json_str = payload.model_dump_json()
        deserialized = json.loads(json_str)
        self.assertEqual(deserialized["error"], "Failed to parse file: syntax error at line 42")


if __name__ == "__main__":
    unittest.main()