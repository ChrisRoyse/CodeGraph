#!/usr/bin/env python3
import ast
"""
Unit Tests for Python Analyzer Service

This module contains unit tests for the Python Analyzer service.
"""

import os
import sys
import json
import unittest
from unittest.mock import patch, MagicMock, mock_open
from pathlib import Path

# Add the project root to the Python path
sys.path.append(str(Path(__file__).parent.parent.parent.parent))

# Import the module to test
from services.analyzers.python_analyzer.main import (
    PythonAstVisitor,
    analyze_python_file,
    process_message,
    create_analysis_node_stubs,
    create_analysis_relationship_stubs,
    IdServiceClient
)

# Import shared models
from shared.models.python.models import AnalysisNodeStub, AnalysisRelationshipStub, AnalyzerResultPayload


class TestIdServiceClient(unittest.TestCase):
    """Tests for the IdServiceClient class."""

    @patch('services.analyzers.python_analyzer.main.id_service_pb2_grpc.IdServiceStub')
    @patch('services.analyzers.python_analyzer.main.grpc.insecure_channel')
    def test_init(self, mock_channel, mock_stub):
        """Test IdServiceClient initialization."""
        # Arrange
        host = "localhost"
        port = "50051"
        
        # Act
        client = IdServiceClient(host, port)
        
        # Assert
        mock_channel.assert_called_once_with(f"{host}:{port}")
        mock_stub.assert_called_once_with(mock_channel.return_value)
        self.assertEqual(client.channel, mock_channel.return_value)
        self.assertEqual(client.stub, mock_stub.return_value)

    @patch('services.analyzers.python_analyzer.main.id_service_pb2.GenerateIdRequest')
    @patch('services.analyzers.python_analyzer.main.id_service_pb2_grpc.IdServiceStub')
    @patch('services.analyzers.python_analyzer.main.grpc.insecure_channel')
    def test_generate_id(self, mock_channel, mock_stub, mock_request):
        """Test generate_id method."""
        # Arrange
        client = IdServiceClient("localhost", "50051")
        
        # Mock the response
        mock_response = MagicMock()
        mock_response.canonical_id = "test/file.py::Function::test_func"
        mock_response.gid = "py:test/file.py::Function::test_func"
        
        # Set up the stub's GenerateId method to return the mock response
        client.stub.GenerateId.return_value = mock_response
        
        # Act
        canonical_id, gid = client.generate_id(
            file_path="test/file.py",
            entity_type="Function",
            name="test_func",
            param_types=["arg1", "arg2"]
        )
        
        # Assert
        mock_request.assert_called_once()
        client.stub.GenerateId.assert_called_once()
        self.assertEqual(canonical_id, "test/file.py::Function::test_func")
        self.assertEqual(gid, "py:test/file.py::Function::test_func")


class TestPythonAstVisitor(unittest.TestCase):
    """Tests for the PythonAstVisitor class."""

    def setUp(self):
        """Set up test fixtures."""
        # Mock the ID Service client
        self.mock_id_service_client = MagicMock()
        
        # Set up the generate_id method to return predictable values
        def mock_generate_id(file_path, entity_type, name, parent_canonical_id="", param_types=None, language_hint="python"):
            canonical_id = f"{file_path}::{entity_type}::{name}"
            gid = f"py:{canonical_id}"
            return canonical_id, gid
            
        self.mock_id_service_client.generate_id.side_effect = mock_generate_id

    def test_visit_module(self):
        """Test visiting a module node."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST
        code = "# Empty module"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 1)
        self.assertEqual(visitor.nodes[0]['type'], 'File')
        self.assertEqual(visitor.nodes[0]['name'], 'file.py')
        self.assertEqual(visitor.nodes[0]['path'], file_path)
        self.assertEqual(visitor.nodes[0]['canonical_id'], f"{file_path}::File::file.py")
        self.assertEqual(visitor.nodes[0]['gid'], f"py:{file_path}::File::file.py")

    def test_visit_class_def(self):
        """Test visiting a class definition."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with a class
        code = "class TestClass:\n    pass"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 2)  # File and Class
        
        # Check class node
        class_node = next((n for n in visitor.nodes if n['type'] == 'Class'), None)
        self.assertIsNotNone(class_node)
        self.assertEqual(class_node['name'], 'TestClass')
        self.assertEqual(class_node['path'], file_path)
        self.assertEqual(class_node['canonical_id'], f"{file_path}::Class::TestClass")
        self.assertEqual(class_node['gid'], f"py:{file_path}::Class::TestClass")

    def test_visit_function_def(self):
        """Test visiting a function definition."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with a function
        code = "def test_func(arg1, arg2):\n    pass"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 2)  # File and Function
        
        # Check function node
        func_node = next((n for n in visitor.nodes if n['type'] == 'Function'), None)
        self.assertIsNotNone(func_node)
        self.assertEqual(func_node['name'], 'test_func')
        self.assertEqual(func_node['path'], file_path)
        self.assertEqual(func_node['param_types'], ['arg1', 'arg2'])
        self.assertEqual(func_node['canonical_id'], f"{file_path}::Function::test_func")
        self.assertEqual(func_node['gid'], f"py:{file_path}::Function::test_func")

    def test_visit_method_def(self):
        """Test visiting a method definition."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with a class and method
        code = "class TestClass:\n    def test_method(self, arg1):\n        pass"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 3)  # File, Class, and Method
        
        # Check method node
        method_node = next((n for n in visitor.nodes if n['type'] == 'Method'), None)
        self.assertIsNotNone(method_node)
        self.assertEqual(method_node['name'], 'test_method')
        self.assertEqual(method_node['path'], file_path)
        self.assertEqual(method_node['param_types'], ['self', 'arg1'])
        self.assertEqual(method_node['canonical_id'], f"{file_path}::Method::test_method")
        self.assertEqual(method_node['gid'], f"py:{file_path}::Method::test_method")
    
    def test_visit_import(self):
        """Test visiting an import statement."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with an import
        code = "import os, sys as system"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 1)  # File only
        self.assertEqual(len(visitor.relationships), 2)  # Two imports
        
        # Check import relationships
        os_import = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Module::os'), None)
        self.assertIsNotNone(os_import)
        self.assertEqual(os_import['type'], ':IMPORTS')
        self.assertEqual(os_import['properties']['alias'], 'os')
        
        sys_import = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Module::sys'), None)
        self.assertIsNotNone(sys_import)
        self.assertEqual(sys_import['type'], ':IMPORTS')
        self.assertEqual(sys_import['properties']['alias'], 'system')
    
    def test_visit_import_from(self):
        """Test visiting an import from statement."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with an import from
        code = "from os import path, environ as env"
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 1)  # File only
        self.assertEqual(len(visitor.relationships), 2)  # Two imports
        
        # Check import relationships
        path_import = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Module::os::Entity::path'), None)
        self.assertIsNotNone(path_import)
        self.assertEqual(path_import['type'], ':IMPORTS')
        self.assertEqual(path_import['properties']['alias'], 'path')
        self.assertEqual(path_import['properties']['from_module'], 'os')
        
        env_import = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Module::os::Entity::environ'), None)
        self.assertIsNotNone(env_import)
        self.assertEqual(env_import['type'], ':IMPORTS')
        self.assertEqual(env_import['properties']['alias'], 'env')
        self.assertEqual(env_import['properties']['from_module'], 'os')
    
    def test_visit_call(self):
        """Test visiting a function call."""
        # Arrange
        file_path = "test/file.py"
        visitor = PythonAstVisitor(file_path, self.mock_id_service_client)
        
        # Create a simple AST with function calls
        code = """
import os
import math

def test_func():
    print('hello')
    os.path.join('a', 'b')
    math.sqrt(4)
"""
        tree = ast.parse(code, file_path, 'exec')
        
        # Act
        visitor.visit(tree)
        
        # Assert
        self.assertEqual(len(visitor.nodes), 2)  # File and Function
        self.assertEqual(len(visitor.relationships), 5)  # Two imports and three function calls
        
        # Check call relationships
        print_call = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Function::print'), None)
        self.assertIsNotNone(print_call)
        self.assertEqual(print_call['type'], ':CALLS')
        
        join_call = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Object::os::Method::path::Method::join'), None)
        if not join_call:
            # Try alternative format
            join_call = next((r for r in visitor.relationships if 'join' in r['target_canonical_id']), None)
        self.assertIsNotNone(join_call)
        self.assertEqual(join_call['type'], ':CALLS')
        
        sqrt_call = next((r for r in visitor.relationships if r['target_canonical_id'] == 'python::Object::math::Method::sqrt'), None)
        self.assertIsNotNone(sqrt_call)
        self.assertEqual(sqrt_call['type'], ':CALLS')

    def test_parse_hint_comments(self):
        """Test parsing bmcp hint comments for manual relationships."""
        import tempfile
        file_content = '''
# bmcp:call-target my.module.Helper.doSomething
def foo():
    pass

# bmcp:imports my.module.Helper
import my.module.Helper

# bmcp:uses-type my.module.CustomType
custom_field = None
        '''
        with tempfile.NamedTemporaryFile('w+', delete=False, suffix='.py') as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name

        visitor = PythonAstVisitor(tmp_path, self.mock_id_service_client)
        # Simulate file node creation
        visitor.file_gid = 'py:test/file.py::File::file.py'
        visitor.parse_hint_comments()
        manual_rels = [r for r in visitor.relationships if r.get('properties', {}).get('manual_hint')]
        assert len(manual_rels) >= 3
        assert any(r['type'] == ':CALLS' and r['properties']['hint_type'] == 'call-target' for r in manual_rels)
        assert any(r['type'] == ':IMPORTS' and r['properties']['hint_type'] == 'imports' for r in manual_rels)
        assert any(r['type'] == ':USES_TYPE' and r['properties']['hint_type'] == 'uses-type' for r in manual_rels)

        os.unlink(tmp_path)


class TestAnalyzePythonFile(unittest.TestCase):
    """Tests for the analyze_python_file function."""

    @patch('builtins.open', new_callable=mock_open, read_data="def test_func():\n    pass")
    def test_analyze_python_file(self, mock_file):
        """Test analyzing a Python file."""
        # Arrange
        file_path = "test/file.py"
        
        # Mock the ID Service client
        mock_id_service_client = MagicMock()
        
        # Set up the generate_id method to return predictable values
        def mock_generate_id(file_path, entity_type, name, parent_canonical_id="", param_types=None, language_hint="python"):
            canonical_id = f"{file_path}::{entity_type}::{name}"
            gid = f"py:{canonical_id}"
            return canonical_id, gid
            
        mock_id_service_client.generate_id.side_effect = mock_generate_id
        
        # Act
        nodes, relationships = analyze_python_file(file_path, mock_id_service_client)
        
        # Assert
        mock_file.assert_called_once_with(file_path, 'r', encoding='utf-8')
        self.assertEqual(len(nodes), 2)  # File and Function
        self.assertEqual(len(relationships), 0)  # No relationships in this simple file
        
        # Check function node
        func_node = next((n for n in nodes if n['type'] == 'Function'), None)
        self.assertIsNotNone(func_node)
        self.assertEqual(func_node['name'], 'test_func')
        self.assertEqual(func_node['path'], file_path)
        self.assertEqual(func_node['canonical_id'], f"{file_path}::Function::test_func")
        self.assertEqual(func_node['gid'], f"py:{file_path}::Function::test_func")

    @patch('builtins.open', side_effect=Exception("Test error"))
    def test_analyze_python_file_error(self, mock_file):
        """Test error handling when analyzing a Python file."""
        # Arrange
        file_path = "test/file.py"
        mock_id_service_client = MagicMock()
        
        # Act
        nodes, relationships = analyze_python_file(file_path, mock_id_service_client)
        
        # Assert
        mock_file.assert_called_once_with(file_path, 'r', encoding='utf-8')
        self.assertEqual(len(nodes), 0)  # Should return empty list on error
        self.assertEqual(len(relationships), 0)  # Should return empty list on error


class TestCreateAnalysisRelationshipStubs(unittest.TestCase):
    """Tests for the create_analysis_relationship_stubs function."""
    
    def test_create_analysis_relationship_stubs(self):
        """Test creating AnalysisRelationshipStub objects from relationship dictionaries."""
        # Arrange
        relationships = [
            {
                'source_gid': 'py:test/file.py::Function::test_func',
                'target_canonical_id': 'python::Function::print',
                'type': ':CALLS',
                'properties': {}
            },
            {
                'source_gid': 'py:test/file.py::Function::test_func',
                'target_canonical_id': 'python::Module::os',
                'type': ':IMPORTS',
                'properties': {'alias': 'os'}
            }
        ]
        
        # Act
        relationship_stubs = create_analysis_relationship_stubs(relationships)
        
        # Assert
        self.assertEqual(len(relationship_stubs), 2)
        
        # Check call relationship stub
        call_rel_stub = next((r for r in relationship_stubs if r.type == ':CALLS'), None)
        self.assertIsNotNone(call_rel_stub)
        self.assertEqual(call_rel_stub.source_gid, 'py:test/file.py::Function::test_func')
        self.assertEqual(call_rel_stub.target_canonical_id, 'python::Function::print')
        self.assertEqual(call_rel_stub.properties, {})
        
        # Check import relationship stub
        import_rel_stub = next((r for r in relationship_stubs if r.type == ':IMPORTS'), None)
        self.assertIsNotNone(import_rel_stub)
        self.assertEqual(import_rel_stub.source_gid, 'py:test/file.py::Function::test_func')
        self.assertEqual(import_rel_stub.target_canonical_id, 'python::Module::os')
        self.assertEqual(import_rel_stub.properties, {'alias': 'os'})


class TestCreateAnalysisNodeStubs(unittest.TestCase):
    """Tests for the create_analysis_node_stubs function."""

    def test_create_analysis_node_stubs(self):
        """Test creating AnalysisNodeStub objects from node dictionaries."""
        # Arrange
        nodes = [
            {
                'type': 'File',
                'name': 'file.py',
                'path': 'test/file.py',
                'parent_canonical_id': '',
                'canonical_id': 'test/file.py::File::file.py',
                'gid': 'py:test/file.py::File::file.py'
            },
            {
                'type': 'Function',
                'name': 'test_func',
                'path': 'test/file.py',
                'parent_canonical_id': 'test/file.py::File::file.py',
                'param_types': ['arg1', 'arg2'],
                'canonical_id': 'test/file.py::Function::test_func',
                'gid': 'py:test/file.py::Function::test_func'
            }
        ]
        
        # Act
        node_stubs = create_analysis_node_stubs(nodes)
        
        # Assert
        self.assertEqual(len(node_stubs), 2)
        
        # Check file node stub
        file_node_stub = next((n for n in node_stubs if 'File' in n.labels), None)
        self.assertIsNotNone(file_node_stub)
        self.assertEqual(file_node_stub.gid, 'py:test/file.py::File::file.py')
        self.assertEqual(file_node_stub.canonical_id, 'test/file.py::File::file.py')
        self.assertEqual(file_node_stub.name, 'file.py')
        self.assertEqual(file_node_stub.file_path, 'test/file.py')
        self.assertEqual(file_node_stub.language, 'python')
        self.assertEqual(file_node_stub.labels, ['File'])
        self.assertEqual(file_node_stub.properties, {})
        
        # Check function node stub
        func_node_stub = next((n for n in node_stubs if 'Function' in n.labels), None)
        self.assertIsNotNone(func_node_stub)
        self.assertEqual(func_node_stub.gid, 'py:test/file.py::Function::test_func')
        self.assertEqual(func_node_stub.canonical_id, 'test/file.py::Function::test_func')
        self.assertEqual(func_node_stub.name, 'test_func')
        self.assertEqual(func_node_stub.file_path, 'test/file.py')
        self.assertEqual(func_node_stub.language, 'python')
        self.assertEqual(func_node_stub.labels, ['Function'])
        self.assertEqual(func_node_stub.properties, {'param_types': ['arg1', 'arg2']})


class TestProcessMessage(unittest.TestCase):
    """Tests for the process_message function."""

    @patch('services.analyzers.python_analyzer.main.AnalyzerResultPayload')
    @patch('services.analyzers.python_analyzer.main.IdServiceClient')
    @patch('services.analyzers.python_analyzer.main.analyze_python_file')
    @patch('services.analyzers.python_analyzer.main.create_analysis_node_stubs')
    @patch('services.analyzers.python_analyzer.main.create_analysis_relationship_stubs')
    def test_process_message_python_file(self, mock_create_rel_stubs, mock_create_node_stubs, mock_analyze, mock_id_client, mock_payload):
        """Test processing a message for a Python file."""
        # Arrange
        # Create mocks
        ch = MagicMock()
        method = MagicMock()
        # Mock the connection and channel
        connection = MagicMock()
        channel = MagicMock()
        ch.connection = connection
        connection.channel.return_value = channel
        properties = MagicMock()
        body = json.dumps({
            'file_path': 'test/file.py',
            'event_type': 'MODIFIED'
        }).encode('utf-8')
        
        # Mock analyze_python_file to return some nodes
        mock_nodes = [
            {
                'type': 'File',
                'name': 'file.py',
                'path': 'test/file.py',
                'parent_canonical_id': '',
                'canonical_id': 'test/file.py::File::file.py',
                'gid': 'py:test/file.py::File::file.py'
            }
        ]
        # Mock analyze_python_file to return nodes and empty relationships
        mock_analyze.return_value = (mock_nodes, [])
        
        # Mock create_analysis_node_stubs to return some stubs
        mock_node_stubs = [MagicMock()]
        mock_create_node_stubs.return_value = mock_node_stubs
        
        mock_rel_stubs = []
        mock_create_rel_stubs.return_value = mock_rel_stubs
        
        # Mock the payload
        mock_payload.return_value.json.return_value = json.dumps({
            'file_path': 'test/file.py',
            'language': 'python',
            'nodes_upserted': [],
            'relationships_upserted': []
        })
        
        # Act
        process_message(ch, method, properties, body)
        
        # Assert
        mock_id_client.assert_called_once_with(
            os.getenv('ID_SERVICE_HOST', 'id_service'),
            os.getenv('ID_SERVICE_PORT', '50051')
        )
        mock_analyze.assert_called_once_with('test/file.py', mock_id_client.return_value)
        # Node stubs should be created
        mock_create_node_stubs.assert_called_once_with(mock_nodes)
        # Relationship stubs should be created with empty list
        mock_create_rel_stubs.assert_called_once_with([])
        ch.connection.channel.assert_called_once()
        ch.connection.channel.return_value.basic_publish.assert_called_once()
        ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)

    def test_process_message_non_python_file(self):
        """Test processing a message for a non-Python file."""
        # Arrange
        # Create mocks
        ch = MagicMock()
        method = MagicMock()
        # Mock the connection and channel
        connection = MagicMock()
        channel = MagicMock()
        ch.connection = connection
        connection.channel.return_value = channel
        properties = MagicMock()
        body = json.dumps({
            'file_path': 'test/file.js',
            'event_type': 'MODIFIED'
        }).encode('utf-8')
        
        # Act
        process_message(ch, method, properties, body)
        
        # Assert
        ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)
        ch.connection.channel.assert_not_called()

    @patch('services.analyzers.python_analyzer.main.AnalyzerResultPayload')
    def test_process_message_deleted_file(self, mock_payload):
        """Test processing a message for a deleted file."""
        # Arrange
        # Create mocks
        ch = MagicMock()
        method = MagicMock()
        # Mock the connection and channel
        connection = MagicMock()
        channel = MagicMock()
        ch.connection = connection
        connection.channel.return_value = channel
        properties = MagicMock()
        body = json.dumps({
            'file_path': 'test/file.py',
            'event_type': 'DELETED'
        }).encode('utf-8')
        
        # Mock the payload
        mock_payload.return_value.json.return_value = json.dumps({
            'file_path': 'test/file.py',
            'language': 'python',
            'nodes_upserted': [],
            'relationships_upserted': []
        })
        
        # Act
        process_message(ch, method, properties, body)
        
        # Assert
        ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)
        ch.connection.channel.assert_not_called()

    @patch('services.analyzers.python_analyzer.main.AnalyzerResultPayload')
    @patch('services.analyzers.python_analyzer.main.IdServiceClient')
    @patch('services.analyzers.python_analyzer.main.analyze_python_file')
    @patch('services.analyzers.python_analyzer.main.create_analysis_node_stubs')
    @patch('services.analyzers.python_analyzer.main.create_analysis_relationship_stubs')
    def test_process_message_with_relationships(self, mock_create_rel_stubs, mock_create_node_stubs, mock_analyze, mock_id_client, mock_payload):
        """Test processing a message for a Python file with relationships."""
        # Arrange
        # Create mocks
        ch = MagicMock()
        method = MagicMock()
        # Mock the connection and channel
        connection = MagicMock()
        channel = MagicMock()
        ch.connection = connection
        connection.channel.return_value = channel
        properties = MagicMock()
        body = json.dumps({
            'file_path': 'test/file.py',
            'event_type': 'MODIFIED'
        }).encode('utf-8')
        
        # Mock analyze_python_file to return nodes and relationships
        mock_nodes = [
            {
                'type': 'File',
                'name': 'file.py',
                'path': 'test/file.py',
                'parent_canonical_id': '',
                'canonical_id': 'test/file.py::File::file.py',
                'gid': 'py:test/file.py::File::file.py'
            }
        ]
        mock_relationships = [
            {
                'source_gid': 'py:test/file.py::Function::test_func',
                'target_canonical_id': 'python::Function::print',
                'type': ':CALLS',
                'properties': {}
            }
        ]
        mock_analyze.return_value = mock_nodes, mock_relationships
        
        # Mock create_analysis_node_stubs and create_analysis_relationship_stubs
        mock_node_stubs = [MagicMock()]
        mock_create_node_stubs.return_value = mock_node_stubs
        
        mock_rel_stubs = [MagicMock()]
        mock_create_rel_stubs.return_value = mock_rel_stubs
        
        # Act
        process_message(ch, method, properties, body)
        
        # Assert
        mock_id_client.assert_called_once_with(
            os.getenv('ID_SERVICE_HOST', 'id_service'),
            os.getenv('ID_SERVICE_PORT', '50051')
        )
        mock_analyze.assert_called_once_with('test/file.py', mock_id_client.return_value)
        mock_create_node_stubs.assert_called_once_with(mock_nodes)
        mock_create_rel_stubs.assert_called_once_with(mock_relationships)
        
        # Check that both node and relationship stubs are included in the payload
        ch.connection.channel.assert_called_once()
        ch.connection.channel.return_value.basic_publish.assert_called_once()
        
        # Mock the payload
        mock_payload.return_value.json.return_value = json.dumps({
            'file_path': 'test/file.py',
            'language': 'python',
            'nodes_upserted': [{}],
            'relationships_upserted': [{}]
        })
        
        ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)

    @patch('services.analyzers.python_analyzer.main.json.loads', side_effect=Exception("Test error"))
    def test_process_message_error(self, mock_loads):
        """Test error handling when processing a message."""
        # Arrange
        # Create mocks
        ch = MagicMock()
        method = MagicMock()
        # Mock the connection and channel
        connection = MagicMock()
        channel = MagicMock()
        ch.connection = connection
        connection.channel.return_value = channel
        properties = MagicMock()
        body = b'invalid json'
        
        # Act
        process_message(ch, method, properties, body)
        
        # Assert
        ch.basic_nack.assert_called_once_with(delivery_tag=method.delivery_tag, requeue=True)


if __name__ == '__main__':
    unittest.main()