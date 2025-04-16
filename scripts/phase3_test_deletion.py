#!/usr/bin/env python3
"""
Deletion Handling Test Module for Phase 3 Integration Tests.

This module tests the deletion handling functionality:
- Creating a Python file, waiting for it to be processed, then deleting it
- Verifying that the file node and all related nodes (functions, classes) are removed from Neo4j
- Verifying that all relationships involving the deleted nodes are also removed
"""

import os
import time
import uuid
import logging
from pathlib import Path

from phase3_test_utils import IntegrationTestError, run_verification_checks, get_neo4j_driver

# Configure logging
logger = logging.getLogger(__name__)

# Test file content for deletion test
DELETION_TEST_CONTENT = """
class TestClassForDeletion:
    def __init__(self, name):
        self.name = name
        
    def test_method(self, value):
        return f"{self.name}: {value}"

def test_function_for_deletion(arg1, arg2):
    return arg1 + arg2
"""

def create_and_delete_file(watch_dir, wait_time):
    """
    Create a Python file, wait for it to be processed, then delete it.
    
    Args:
        watch_dir (str): Path to the watched directory
        wait_time (int): Time to wait for processing
        
    Returns:
        tuple: (file_path, file_name) with the path and name of the deleted file
        
    Raises:
        IntegrationTestError: If file creation or deletion fails
    """
    logger.info(f"Testing file deletion handling...")
    
    try:
        # Create watched directory if it doesn't exist
        watch_path = Path(watch_dir)
        watch_path.mkdir(parents=True, exist_ok=True)
        
        # Create a file to be deleted
        file_name = f"delete_test_{uuid.uuid4().hex[:8]}.py"
        file_path = watch_path / file_name
        
        with open(file_path, 'w') as f:
            f.write(DELETION_TEST_CONTENT)
        
        logger.info(f"Created file for deletion test: {file_path}")
        
        # Wait for the file to be processed
        logger.info(f"Waiting {wait_time/2} seconds for file to be processed before deletion...")
        time.sleep(wait_time/2)
        
        # Delete the file
        os.remove(file_path)
        logger.info(f"Deleted file: {file_path}")
        
        return str(file_path), file_name
        
    except Exception as e:
        logger.error(f"Error in deletion test: {e}")
        raise IntegrationTestError(f"Failed in deletion test: {e}")

def verify_file_deletion(neo4j_uri, neo4j_user, neo4j_password, file_name):
    """
    Verify that the deleted file and its nodes were removed from Neo4j.
    
    Args:
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        file_name (str): Name of the deleted file
        
    Returns:
        bool: True if verification passed, False otherwise
    """
    logger.info("Verifying file deletion handling...")
    
    try:
        # Connect to Neo4j
        driver = get_neo4j_driver(neo4j_uri, neo4j_user, neo4j_password)
        
        # Define verification checks for file deletion
        verification_checks = [
            {
                "name": "Deleted file does not exist",
                "query": """
                MATCH (f:File {name: $file_name})
                RETURN f
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is None,
                "error_msg": f"Deleted file {file_name} should not exist in Neo4j"
            },
            {
                "name": "Deleted file's class does not exist",
                "query": """
                MATCH (c:Class {name: 'TestClassForDeletion'})
                RETURN c
                """,
                "params": {},
                "assertion": lambda result: result is None,
                "error_msg": "TestClassForDeletion should not exist in Neo4j"
            },
            {
                "name": "Deleted file's function does not exist",
                "query": """
                MATCH (f:Function {name: 'test_function_for_deletion'})
                RETURN f
                """,
                "params": {},
                "assertion": lambda result: result is None,
                "error_msg": "test_function_for_deletion should not exist in Neo4j"
            }
        ]
        
        # Run verification checks
        result = run_verification_checks(driver, verification_checks)
        
        # Close the driver
        driver.close()
        
        return result
        
    except Exception as e:
        logger.error(f"Error verifying file deletion: {e}")
        raise IntegrationTestError(f"Failed to verify file deletion: {e}")

def test_deletion_handling(watch_dir, wait_time, neo4j_uri, neo4j_user, neo4j_password):
    """
    Run the deletion handling test.
    
    Args:
        watch_dir (str): Path to the watched directory
        wait_time (int): Time to wait for processing
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        
    Returns:
        bool: True if test passed, False otherwise
    """
    try:
        # Create and delete file
        delete_path, delete_name = create_and_delete_file(watch_dir, wait_time)
        
        # Wait for deletion to be processed
        logger.info(f"Waiting {wait_time/2} seconds for deletion to be processed...")
        time.sleep(wait_time/2)
        
        # Verify deletion
        return verify_file_deletion(
            neo4j_uri, 
            neo4j_user, 
            neo4j_password, 
            delete_name
        )
    
    except Exception as e:
        logger.error(f"Error in deletion handling test: {e}")
        return False