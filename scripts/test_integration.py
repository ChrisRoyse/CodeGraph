#!/usr/bin/env python3
"""
Integration Test for CodeGraph Pipeline

This script tests the complete Phase 2 pipeline by:
1. Checking if all required services are running
2. Creating a test Python file in the watched directory
3. Waiting for the file to be processed through the pipeline
4. Querying Neo4j to verify that nodes were created correctly

Usage:
    python scripts/test_integration.py [--watch-dir WATCH_DIR] [--wait-time WAIT_TIME]

Options:
    --watch-dir WATCH_DIR    Directory being watched by the file watcher service [default: ./watched/paths]
    --wait-time WAIT_TIME    Time to wait for file processing in seconds [default: 30]
    --neo4j-uri NEO4J_URI    Neo4j connection URI [default: bolt://localhost:7687]
    --neo4j-user NEO4J_USER  Neo4j username [default: neo4j]
    --neo4j-pass NEO4J_PASS  Neo4j password [default: password]
"""

import os
import sys
import time
import uuid
import argparse
import subprocess
from pathlib import Path
import logging

import docker
from neo4j import GraphDatabase

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Test file content with functions and classes
TEST_FILE_CONTENT = """
class TestClass:
    \"\"\"A test class for integration testing.\"\"\"
    
    def __init__(self, name):
        \"\"\"Initialize with a name.\"\"\"
        self.name = name
        
    def test_method(self, value):
        \"\"\"A test method that returns a value.\"\"\"
        return f"{self.name}: {value}"

def test_function(arg1, arg2):
    \"\"\"A test function that adds two arguments.\"\"\"
    return arg1 + arg2

def another_function():
    \"\"\"Another test function with no arguments.\"\"\"
    test_obj = TestClass("Test")
    return test_obj.test_method(test_function(10, 20))
"""

class IntegrationTestError(Exception):
    """Custom exception for integration test errors."""
    pass

def check_services_running():
    """
    Check if all required services are running using docker-compose ps.
    
    Returns:
        dict: A dictionary of service names and their status
    
    Raises:
        IntegrationTestError: If docker-compose command fails
    """
    logger.info("Checking if all required services are running...")
    
    try:
        # Use Docker API to check container status
        client = docker.from_env()
        containers = client.containers.list(all=True)
        
        # Define required services
        required_services = [
            'codegraph-rabbitmq',
            'codegraph-neo4j',
            'codegraph-id-service',
            'codegraph-file-watcher',
            'codegraph-python-analyzer',
            'codegraph-ingestion-worker'
        ]
        
        # Check status of each required service
        service_status = {}
        for service_name in required_services:
            service_containers = [c for c in containers if c.name == service_name]
            
            if not service_containers:
                service_status[service_name] = "not found"
            else:
                container = service_containers[0]
                service_status[service_name] = container.status
        
        # Log status of each service
        for service, status in service_status.items():
            if status == "running":
                logger.info(f"✅ {service} is running")
            else:
                logger.error(f"❌ {service} is not running (status: {status})")
        
        # Check if all required services are running
        all_running = all(status == "running" for status in service_status.values())
        if not all_running:
            raise IntegrationTestError("Not all required services are running")
        
        return service_status
        
    except docker.errors.DockerException as e:
        logger.error(f"Error connecting to Docker: {e}")
        raise IntegrationTestError(f"Failed to check service status: {e}")
    except Exception as e:
        logger.error(f"Unexpected error checking services: {e}")
        raise IntegrationTestError(f"Failed to check service status: {e}")

def create_test_file(watch_dir):
    """
    Create a test Python file in the watched directory.
    
    Args:
        watch_dir (str): Path to the watched directory
        
    Returns:
        tuple: (file_path, file_name) where file_path is the full path and file_name is just the name
        
    Raises:
        IntegrationTestError: If file creation fails
    """
    logger.info(f"Creating test file in {watch_dir}...")
    
    try:
        # Create watched directory if it doesn't exist
        watch_path = Path(watch_dir)
        watch_path.mkdir(parents=True, exist_ok=True)
        
        # Generate a unique file name to avoid conflicts
        file_name = f"test_integration_{uuid.uuid4().hex[:8]}.py"
        file_path = watch_path / file_name
        
        # Write test content to file
        with open(file_path, 'w') as f:
            f.write(TEST_FILE_CONTENT)
        
        logger.info(f"Created test file: {file_path}")
        return str(file_path), file_name
        
    except Exception as e:
        logger.error(f"Error creating test file: {e}")
        raise IntegrationTestError(f"Failed to create test file: {e}")

def verify_neo4j_nodes(neo4j_uri, neo4j_user, neo4j_password, file_name, file_path):
    """
    Query Neo4j to verify that nodes were created correctly.
    
    Args:
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        file_name (str): Name of the test file
        file_path (str): Full path to the test file
        
    Returns:
        bool: True if verification passed, False otherwise
        
    Raises:
        IntegrationTestError: If Neo4j connection fails
    """
    logger.info("Verifying nodes in Neo4j...")
    
    try:
        # Connect to Neo4j
        driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))
        
        # Define verification checks
        verification_checks = [
            {
                "name": "File node exists",
                "query": """
                MATCH (f:File)
                WHERE f.name = $file_name
                RETURN f
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is not None,
                "error_msg": f"File node for {file_name} not found"
            },
            {
                "name": "TestClass node exists",
                "query": """
                MATCH (c:Class)
                WHERE c.name = 'TestClass'
                RETURN c
                """,
                "params": {},
                "assertion": lambda result: result is not None,
                "error_msg": "TestClass node not found"
            },
            {
                "name": "test_function node exists",
                "query": """
                MATCH (f:Function)
                WHERE f.name = 'test_function'
                RETURN f
                """,
                "params": {},
                "assertion": lambda result: result is not None,
                "error_msg": "test_function node not found"
            },
            {
                "name": "another_function node exists",
                "query": """
                MATCH (f:Function)
                WHERE f.name = 'another_function'
                RETURN f
                """,
                "params": {},
                "assertion": lambda result: result is not None,
                "error_msg": "another_function node not found"
            },
            {
                "name": "test_method node exists",
                "query": """
                MATCH (m:Method)
                WHERE m.name = 'test_method'
                RETURN m
                """,
                "params": {},
                "assertion": lambda result: result is not None,
                "error_msg": "test_method node not found"
            },
            {
                "name": "File has correct canonical ID",
                "query": """
                MATCH (f:File)
                WHERE f.name = $file_name
                RETURN f.canonical_id
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is not None and file_name in result,
                "error_msg": "File node has incorrect canonical ID"
            },
            {
                "name": "File has correct GID",
                "query": """
                MATCH (f:File)
                WHERE f.name = $file_name
                RETURN f.gid
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is not None and "py:" in result and file_name in result,
                "error_msg": "File node has incorrect GID"
            },
            {
                "name": "TestClass has correct properties",
                "query": """
                MATCH (c:Class)
                WHERE c.name = 'TestClass'
                RETURN c.canonical_id, c.gid
                """,
                "params": {},
                "assertion": lambda result: result is not None and len(result) == 2 and "Class::TestClass" in result[0],
                "error_msg": "TestClass node has incorrect properties"
            }
        ]
        
        # Run verification checks
        success_count = 0
        failure_count = 0
        
        with driver.session() as session:
            for check in verification_checks:
                try:
                    logger.info(f"Running check: {check['name']}")
                    result = session.run(check["query"], check["params"]).single()
                    
                    # Extract the value if result is not None
                    value = None
                    if result:
                        if len(result) == 1:
                            value = result[0]
                        else:
                            value = [result[i] for i in range(len(result))]
                    
                    if check["assertion"](value):
                        logger.info(f"✅ {check['name']} - Passed")
                        success_count += 1
                    else:
                        logger.error(f"❌ {check['name']} - Failed: {check['error_msg']}")
                        logger.error(f"   Result: {value}")
                        failure_count += 1
                except Exception as e:
                    logger.error(f"❌ {check['name']} - Error: {e}")
                    failure_count += 1
        
        # Close the driver
        driver.close()
        
        # Log summary
        logger.info(f"Verification complete: {success_count} passed, {failure_count} failed")
        
        return failure_count == 0
        
    except Exception as e:
        logger.error(f"Error verifying Neo4j nodes: {e}")
        raise IntegrationTestError(f"Failed to verify Neo4j nodes: {e}")

def run_integration_test(args):
    """
    Run the complete integration test.
    
    Args:
        args: Command line arguments
        
    Returns:
        int: 0 for success, 1 for failure
    """
    try:
        # Step 1: Check if all services are running
        check_services_running()
        
        # Step 2: Create a test file in the watched directory
        file_path, file_name = create_test_file(args.watch_dir)
        
        # Step 3: Wait for the file to be processed
        logger.info(f"Waiting {args.wait_time} seconds for file to be processed...")
        time.sleep(args.wait_time)
        
        # Step 4: Verify that nodes were created in Neo4j
        success = verify_neo4j_nodes(
            args.neo4j_uri, 
            args.neo4j_user, 
            args.neo4j_pass, 
            file_name, 
            file_path
        )
        
        if success:
            logger.info("🎉 Integration test passed!")
            return 0
        else:
            logger.error("❌ Integration test failed!")
            return 1
            
    except IntegrationTestError as e:
        logger.error(f"Integration test error: {e}")
        return 1
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return 1

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Integration test for CodeGraph pipeline")
    parser.add_argument("--watch-dir", default="./watched/paths", help="Directory being watched by the file watcher service")
    parser.add_argument("--wait-time", type=int, default=30, help="Time to wait for file processing in seconds")
    parser.add_argument("--neo4j-uri", default="bolt://localhost:7687", help="Neo4j connection URI")
    parser.add_argument("--neo4j-user", default="neo4j", help="Neo4j username")
    parser.add_argument("--neo4j-pass", default="password", help="Neo4j password")
    return parser.parse_args()

def main():
    """Main entry point."""
    args = parse_args()
    return run_integration_test(args)

if __name__ == "__main__":
    sys.exit(main())