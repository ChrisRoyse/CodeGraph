#!/usr/bin/env python3
"""
Python Analyzer Service for CodeGraph

This service analyzes Python files and extracts code structure information.
It connects to the ID Service to generate canonical IDs and GIDs for Python entities.
"""

import os
import ast
import json
import logging
import grpc
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from pg_writer import wipe_tables, batch_insert_nodes, batch_insert_relationships

print(f"[DEBUG] CWD: {os.getcwd()}")
print(f"[DEBUG] sys.path: {sys.path}")
generated_dir = os.path.join(os.path.dirname(__file__), "generated")
print(f"[DEBUG] Listing files in {generated_dir}:", os.listdir(generated_dir) if os.path.isdir(generated_dir) else "[NOT FOUND]")
import importlib.util
spec = importlib.util.find_spec("generated")
print("[DEBUG] Location of 'generated' module:", spec.origin if spec else "Not found")

import pika
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Add the project root to the Python path to import the generated protobuf modules
sys.path.append(str(Path(__file__).parent.parent.parent.parent))

# Import the generated protobuf modules
try:
    import generated.id_service_pb2
    import generated.id_service_pb2_grpc
    import generated.id_service_pb2 as id_service_pb2
except ImportError as e:
    logger.error("Error: Proto files not compiled. Please run the proto compilation script first.")
    logger.error(f"Actual ImportError: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Import shared models
from shared.models.python.models import AnalysisNodeStub, AnalysisRelationshipStub, AnalyzerResultPayload

# Load environment variables
load_dotenv()

# Configuration
RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_JOBS_QUEUE = os.getenv('RABBITMQ_JOBS_QUEUE', 'bmcp.jobs.analysis.python')
RABBITMQ_RESULTS_QUEUE = os.getenv('RABBITMQ_RESULTS_QUEUE', 'bmcp.results.analysis')
ID_SERVICE_HOST = os.getenv('ID_SERVICE_HOST', 'id_service')
ID_SERVICE_PORT = os.getenv('ID_SERVICE_PORT', '50051')


class IdServiceClient:
    """Client for the ID Service gRPC API."""
    
    def __init__(self, host: str, port: str):
        """
        Initialize the ID Service client.
        
        Args:
            host: ID Service host
            port: ID Service port
        """
        self.channel = grpc.insecure_channel(f"{host}:{port}")
        self.stub = generated.id_service_pb2_grpc.IdServiceStub(self.channel)
        logger.info(f"Connected to ID Service at {host}:{port}")
    
    def generate_id(self, file_path: str, entity_type: str, name: str,
                   parent_canonical_id: str = "", param_types: List[str] = None,
                   language_hint: str = "python") -> Tuple[str, str]:
        """
        Generate a canonical ID and GID for an entity.
        
        Args:
            file_path: Path to the file containing the entity
            entity_type: Type of entity (Function, Class, Method, etc.)
            name: Name of the entity
            parent_canonical_id: Canonical ID of the parent entity (optional)
            param_types: Parameter types for functions/methods (optional)
            language_hint: Language hint to help with ID generation
            
        Returns:
            Tuple of (canonical_id, gid)
            
        Raises:
            grpc.RpcError: If the RPC call fails
        """
        try:
            # Create the request
            request = id_service_pb2.GenerateIdRequest(
                file_path=file_path,
                entity_type=entity_type,
                name=name,
                parent_canonical_id=parent_canonical_id,
                language_hint=language_hint
            )
            
            # Add parameter types if provided
            if param_types:
                request.param_types.extend(param_types)
            
            # Call the RPC
            response = self.stub.GenerateId(request)
            
            return response.canonical_id, response.gid
        
        except grpc.RpcError as e:
            logger.error(f"Error calling ID Service: {e.details()}")
            raise

class PythonAstVisitor(ast.NodeVisitor):
    """AST visitor to extract Python code structure and relationships, including bmcp hint parsing."""
    
    def __init__(self, file_path: str, id_service_client: IdServiceClient):
        self.file_path = file_path
        self.id_service_client = id_service_client
        self.nodes = []
        self.relationships = []
        self.current_class = None
        self.current_class_canonical_id = None
        self.current_function = None
        self.current_function_gid = None
        self.current_function_canonical_id = None
        self.file_canonical_id = None
        self.file_gid = None
        # Optimization: cache for ID service calls
        self._id_cache = {}
    def parse_hint_comments(self):
        """
        Parse bmcp hint comments in the Python file and add manual relationships.
        Supported: # bmcp:call-target <ID>, # bmcp:imports <ID>, # bmcp:uses-type <ID>
        """
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            for i, line in enumerate(lines):
                line = line.strip()
                if line.startswith('# bmcp:'):
                    parts = line[1:].strip().split(None, 1)
                    if len(parts) != 2:
                        continue
                    hint_type_full, target = parts
                    if ':' not in hint_type_full:
                        continue
                    _, hint_type = hint_type_full.split(':', 1)
                    hint_type = hint_type.strip()
                    target = target.strip()
                    rel_type = None
                    if hint_type == 'call-target':
                        rel_type = ':CALLS'
                    elif hint_type == 'imports':
                        rel_type = ':IMPORTS'
                    elif hint_type == 'uses-type':
                        rel_type = ':USES_TYPE'
                    if rel_type:
                        self.relationships.append({
                            'source_canonical_id': self.file_canonical_id or '',
                            'target_canonical_id': f'manual::{hint_type}::{target}',
                            'type': rel_type,
                            'properties': {
                                'manual_hint': True,
                                'hint_type': hint_type
                            }
                        })
        except Exception as e:
            logger.error(f"Error parsing bmcp hint comments in {self.file_path}: {e}")

    def visit_Module(self, node):
        """Visit a module node."""
        # Generate ID for the file
        file_name = os.path.basename(self.file_path)
        try:
            cache_key = (self.file_path, 'File', file_name, '', None)
            if cache_key in self._id_cache:
                canonical_id, gid = self._id_cache[cache_key]
            else:
                canonical_id, gid = self.id_service_client.generate_id(
                    file_path=self.file_path,
                    entity_type='File',
                    name=file_name
                )
                self._id_cache[cache_key] = (canonical_id, gid)
            self.file_canonical_id = canonical_id
            self.file_gid = gid

            # Add file node
            node_dict = {
                'type': 'File',
                'name': file_name,
                'path': self.file_path,
                'parent_canonical_id': '',
                'canonical_id': canonical_id,
                'gid': gid
            }
            # Remove empty values
            node_dict = {k: v for k, v in node_dict.items() if v not in ('', None, [], {})}
            # Always include at least 'type' and 'canonical_id' for File nodes
            if 'type' in node_dict and 'canonical_id' in node_dict:
                self.nodes.append(node_dict)

            # Parse bmcp hint comments for manual relationships
            self.parse_hint_comments()

            # Visit all child nodes
            self.generic_visit(node)
        except Exception as e:
            logger.error(f"Error generating ID for file {self.file_path}: {e}")
    
    def visit_ClassDef(self, node):
        """Visit a class definition."""
        prev_class = self.current_class
        prev_class_canonical_id = self.current_class_canonical_id
        self.current_class = node.name
        
        try:
            # Generate ID for the class
            cache_key = (self.file_path, 'Class', node.name, self.file_canonical_id, None)
            if cache_key in self._id_cache:
                canonical_id, gid = self._id_cache[cache_key]
            else:
                canonical_id, gid = self.id_service_client.generate_id(
                    file_path=self.file_path,
                    entity_type='Class',
                    name=node.name,
                    parent_canonical_id=self.file_canonical_id
                )
                self._id_cache[cache_key] = (canonical_id, gid)
            self.current_class_canonical_id = canonical_id
            
            # Add class node
            self.nodes.append({
                'type': 'Class',
                'name': node.name,
                'path': self.file_path,
                'parent_canonical_id': self.file_canonical_id,
                'canonical_id': canonical_id,
                'gid': gid
            })
            
            # Visit all child nodes
            self.generic_visit(node)
            
            self.current_class = prev_class
            self.current_class_canonical_id = prev_class_canonical_id
        except Exception as e:
            logger.error(f"Error generating ID for class {node.name} in {self.file_path}: {e}")
            self.current_class = prev_class
            self.current_class_canonical_id = prev_class_canonical_id
    
    def visit_FunctionDef(self, node):
        """Visit a function definition."""
        # Determine if this is a method or a function
        node_type = 'Method' if self.current_class else 'Function'
        parent_id = self.current_class_canonical_id if self.current_class else self.file_canonical_id
        
        # Save previous function context
        prev_function = self.current_function
        prev_function_gid = self.current_function_gid
        prev_function_canonical_id = self.current_function_canonical_id
        
        try:
            # Get parameter types
            param_types = [arg.arg for arg in node.args.args]
            
            # Generate ID for the function/method
            cache_key = (self.file_path, node_type, node.name, parent_id, tuple(param_types) if param_types else None)
            if cache_key in self._id_cache:
                canonical_id, gid = self._id_cache[cache_key]
            else:
                canonical_id, gid = self.id_service_client.generate_id(
                    file_path=self.file_path,
                    entity_type=node_type,
                    name=node.name,
                    parent_canonical_id=parent_id,
                    param_types=param_types
                )
                self._id_cache[cache_key] = (canonical_id, gid)
            
            # Set current function context
            self.current_function = node.name
            self.current_function_gid = gid
            self.current_function_canonical_id = canonical_id
            
            # Add function/method node
            node_dict = {
                'type': node_type,
                'name': node.name,
                'path': self.file_path,
                'parent_canonical_id': parent_id,
                'canonical_id': canonical_id,
                'gid': gid
            }
            if param_types:
                node_dict['param_types'] = param_types
            self.nodes.append(node_dict)
            
            # Visit all child nodes
            self.generic_visit(node)
            
            # Restore previous function context
            self.current_function = prev_function
            self.current_function_gid = prev_function_gid
            self.current_function_canonical_id = prev_function_canonical_id
        except Exception as e:
            logger.error(f"Error generating ID for {node_type.lower()} {node.name} in {self.file_path}: {e}")
            # Restore previous function context
            self.current_function = prev_function
    
    def visit_Call(self, node):
        """Visit a function call."""
        if not self.current_function_gid:
            return
        
        # Get the function name being called
        func_name = None
        if isinstance(node.func, ast.Name):
            # Simple function call: func()
            func_name = node.func.id
            target_canonical_id = f"python::Function::{func_name}"
        elif isinstance(node.func, ast.Attribute):
            # Method call or qualified name: obj.method() or module.func()
            if isinstance(node.func.value, ast.Name):
                # Simple attribute: obj.method()
                obj_name = node.func.value.id
                method_name = node.func.attr
                target_canonical_id = f"python::Object::{obj_name}::Method::{method_name}"
            else:
                # More complex attribute, just use the method name
                method_name = node.func.attr
                target_canonical_id = f"python::Method::{method_name}"
        else:
            # Complex call expression, skip
            return
        
        # Add call relationship
        self.relationships.append({
            'source_canonical_id': self.current_function_canonical_id,
            'target_canonical_id': target_canonical_id,
            'type': ':CALLS',
            'properties': {}
        })

def analyze_python_file(file_path: str, id_service_client: IdServiceClient) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Analyze a Python file and extract its structure and relationships.
    
    Args:
        file_path: Path to the Python file
        id_service_client: Client for the ID Service
        
    Returns:
        Tuple of (nodes, relationships) where:
            - nodes: List of node dictionaries representing the file structure
            - relationships: List of relationship dictionaries representing code relationships
    """
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Parse the AST
        tree = ast.parse(content)
        
        # Visit the AST
        visitor = PythonAstVisitor(file_path, id_service_client)
        visitor.visit(tree)
        
        return visitor.nodes, visitor.relationships
    
    except Exception as e:
        logger.error(f"Error analyzing file {file_path}: {e}")
        return [], []


def create_analysis_node_stubs(nodes: List[Dict[str, Any]]) -> List[AnalysisNodeStub]:
    """
    Create AnalysisNodeStub objects from node dictionaries.
    
    Args:
        nodes: List of node dictionaries
        
    Returns:
        List of AnalysisNodeStub objects
    """
    node_stubs = []
    
    for node in nodes:
        # Create properties dictionary
        properties = {}
        
        # Add param_types to properties if present
        if 'param_types' in node:
            properties['param_types'] = node['param_types']
        
        # Create labels list
        labels = [node['type']]
        
        # Create AnalysisNodeStub
        node_stub = AnalysisNodeStub(
            gid=node.get('gid', ''),
            canonical_id=node.get('canonical_id', ''),
            name=node.get('name', ''),
            file_path=node.get('path', ''),
            language='python',
            labels=labels,
            properties=properties
        )
        
        node_stubs.append(node_stub)
    
    return node_stubs


def create_analysis_relationship_stubs(relationships: List[Dict[str, Any]]) -> List[AnalysisRelationshipStub]:
    """
    Create AnalysisRelationshipStub objects from relationship dictionaries.
    
    Args:
        relationships: List of relationship dictionaries
        
    Returns:
        List of AnalysisRelationshipStub objects
    """
    relationship_stubs = []
    
    for rel in relationships:
        # Create AnalysisRelationshipStub
        rel_stub = AnalysisRelationshipStub(
            source_gid=rel['source_canonical_id'],
            target_canonical_id=rel['target_canonical_id'],
            type=rel['type'],
            properties=rel['properties']
        )
        
        relationship_stubs.append(rel_stub)
    
    return relationship_stubs


def process_message(ch, method, properties, body):
    """Process a message from the jobs queue."""
    try:
        # Parse the message
        message = json.loads(body)
        file_path = message.get('file_path')
        event_type = message.get('event_type')
        msg_id = message.get('id')
        
        logger.info(f"Received message: {message}")
        if not msg_id:
            logger.error(f"Message missing 'id' field: {message}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        
        # Skip non-Python files
        if not file_path.endswith('.py'):
            logger.info(f"Skipping non-Python file: {file_path}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        
        # Handle file deletion
        if event_type == 'DELETED':
            # In a real implementation, we would create a deletion payload
            logger.info(f"File deleted: {file_path}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return
        
        # Create ID Service client
        id_service_client = IdServiceClient(ID_SERVICE_HOST, ID_SERVICE_PORT)
        
        # Analyze the file
        nodes, relationships = analyze_python_file(file_path, id_service_client)
        
        if not nodes:
            logger.warning(f"No nodes found in {file_path}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        # Build set of all node canonical_ids
        node_canonical_ids = set(n['canonical_id'] for n in nodes)
        
        # Identify missing targets for relationships
        missing_targets = set(
            r['target_canonical_id'] for r in relationships
            if r['target_canonical_id'] not in node_canonical_ids
        )
        # Synthesize 'external' nodes for missing targets
        external_nodes = [
            {k: v for k, v in {
                'type': 'External',
                'name': t,
                'canonical_id': t,
                'external': True,
                'path': ''  # Ensure 'path' is present for external nodes
            }.items() if v not in ('', None, [], {})}
            for t in missing_targets
        ]
        # Filter to ensure required keys are present
        external_nodes = [node for node in external_nodes if 'type' in node and 'canonical_id' in node and 'external' in node]
        if external_nodes:
            logger.info(f"Synthesizing {len(external_nodes)} external nodes: {missing_targets}")
            batch_insert_nodes(external_nodes)
            node_canonical_ids.update(missing_targets)
            nodes.extend(external_nodes)
        # Filter relationships to only those with both ends present
        filtered_relationships = [
            r for r in relationships
            if r['source_canonical_id'] in node_canonical_ids and r['target_canonical_id'] in node_canonical_ids
        ]
        logger.info(f"Inserting {len(nodes)} nodes into code_nodes...")
        batch_insert_nodes(nodes)
        logger.info(f"Inserting {len(filtered_relationships)} relationships into code_relationships...")
        batch_insert_relationships(filtered_relationships)
        logger.info("Insert complete.")
        relationships = filtered_relationships

        # Create AnalysisNodeStub objects
        node_stubs = create_analysis_node_stubs(nodes)
        
        # Create AnalysisRelationshipStub objects
        relationship_stubs = create_analysis_relationship_stubs(relationships)
        
        # Create AnalyzerResultPayload
        payload = AnalyzerResultPayload(
            file_path=file_path,
            language='python',
            nodes_upserted=node_stubs,
            relationships_upserted=relationship_stubs
        )
        # Publish the payload to the results queue
        channel = ch.connection.channel()
        channel.basic_publish(
            exchange='',  # Default exchange
            routing_key=RABBITMQ_RESULTS_QUEUE,  # Queue name as routing key
            body=payload.json(),
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
                content_type='application/json'
            )
        )
        
        logger.info(f"Published analysis results for {file_path} with {len(node_stubs)} nodes and {len(relationship_stubs)} relationships")
        
        # Acknowledge the message
        ch.basic_ack(delivery_tag=method.delivery_tag)
    
    except Exception as e:
        logger.error(f"Error processing message: {e}. Full message: {locals().get('message', body)}")
        # Negative acknowledgment, requeue the message
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)


def main():
    """Main entry point for the Python Analyzer service."""
    try:
        # Test connection to ID Service
        try:
            id_service_client = IdServiceClient(ID_SERVICE_HOST, ID_SERVICE_PORT)
            logger.info("Successfully connected to ID Service")
        except Exception as e:
            logger.error(f"Failed to connect to ID Service: {e}")
            return 1
        
        # Connect to RabbitMQ
        credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD)
        connection_params = pika.ConnectionParameters(
            host=RABBITMQ_HOST,
            port=RABBITMQ_PORT,
            credentials=credentials,
            heartbeat=600,
            blocked_connection_timeout=300
        )
        
        connection = pika.BlockingConnection(connection_params)
        channel = connection.channel()
        
        # Declare queues
        channel.queue_declare(queue=RABBITMQ_JOBS_QUEUE, durable=True)
        channel.queue_declare(queue=RABBITMQ_RESULTS_QUEUE, durable=True)
        
        # Set up consumer
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(
            queue=RABBITMQ_JOBS_QUEUE,
            on_message_callback=process_message
        )
        
        logger.info(f"Python Analyzer started, consuming from {RABBITMQ_JOBS_QUEUE}")
        
        # Start consuming
        channel.start_consuming()
        
    except KeyboardInterrupt:
        logger.info("Shutting down Python Analyzer...")
    except Exception as e:
        logger.error(f"Error in main: {e}")
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())