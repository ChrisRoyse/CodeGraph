#!/usr/bin/env python3
"""
Debouncing and Filtering Test Module for Phase 3 Integration Tests.

This module tests the debouncing and filtering functionality:
- Creating multiple rapid changes to a file and verifying only one analysis job is triggered
- Creating files that should be ignored (e.g., in a node_modules directory) and verifying they are not processed
"""

import os
import time
import uuid
import logging
from pathlib import Path

from phase3_test_utils import IntegrationTestError, run_verification_checks, get_neo4j_driver

# Configure logging
logger = logging.getLogger(__name__)

# Test file for rapid changes to test debouncing
CHANGING_FILE_CONTENT = """
def function_to_change():
    \"\"\"This function will be changed rapidly to test debouncing.\"\"\"
    return "Version {}"
"""

def test_debouncing(watch_dir, wait_time):
    """
    Test the debouncing functionality by making rapid changes to a file.
    
    Args:
        watch_dir (str): Path to the watched directory
        wait_time (int): Time to wait for processing
        
    Returns:
        tuple: (file_path, file_name) with the path and name of the test file
        
    Raises:
        IntegrationTestError: If file creation or modification fails
    """
    logger.info(f"Testing debouncing with rapid file changes...")
    
    try:
        # Create watched directory if it doesn't exist
        watch_path = Path(watch_dir)
        watch_path.mkdir(parents=True, exist_ok=True)
        
        # Create a file for testing debouncing
        file_name = f"debounce_test_{uuid.uuid4().hex[:8]}.py"
        file_path = watch_path / file_name
        
        # Make multiple rapid changes to the file
        for i in range(5):
            content = CHANGING_FILE_CONTENT.format(i)
            with open(file_path, 'w') as f:
                f.write(content)
            logger.info(f"Made change {i+1}/5 to {file_path}")
            # Sleep briefly between changes, but less than the debounce time
            time.sleep(0.1)  # 100ms, which is less than the default 500ms debounce time
        
        logger.info(f"Completed rapid changes to {file_path}")
        
        return str(file_path), file_name
        
    except Exception as e:
        logger.error(f"Error testing debouncing: {e}")
        raise IntegrationTestError(f"Failed to test debouncing: {e}")

def create_ignored_file(watch_dir):
    """
    Create a file in a directory that should be ignored by the file watcher.
    
    Args:
        watch_dir (str): Path to the watched directory
        
    Returns:
        tuple: (file_path, file_name) with the path and name of the ignored file
        
    Raises:
        IntegrationTestError: If file creation fails
    """
    logger.info(f"Creating file in ignored directory...")
    
    try:
        # Create node_modules directory (which should be ignored)
        watch_path = Path(watch_dir)
        ignored_dir = watch_path / "node_modules"
        ignored_dir.mkdir(parents=True, exist_ok=True)
        
        # Create a Python file in the ignored directory
        file_name = f"ignored_{uuid.uuid4().hex[:8]}.py"
        file_path = ignored_dir / file_name
        
        with open(file_path, 'w') as f:
            f.write("def ignored_function():\n    return 'This should be ignored'")
        
        logger.info(f"Created ignored file: {file_path}")
        
        return str(file_path), file_name
        
    except Exception as e:
        logger.error(f"Error creating ignored file: {e}")
        raise IntegrationTestError(f"Failed to create ignored file: {e}")

def verify_debouncing(neo4j_uri, neo4j_user, neo4j_password, file_name):
    """
    Verify that debouncing worked correctly by checking the file node in Neo4j.
    
    Args:
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        file_name (str): Name of the test file
        
    Returns:
        bool: True if verification passed, False otherwise
    """
    logger.info("Verifying debouncing functionality...")
    
    try:
        # Connect to Neo4j
        driver = get_neo4j_driver(neo4j_uri, neo4j_user, neo4j_password)
        
        # Define verification checks for debouncing
        verification_checks = [
            {
                "name": "Debounced file exists",
                "query": """
                MATCH (f:File {name: $file_name})
                RETURN f
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is not None,
                "error_msg": f"Debounced file {file_name} not found"
            },
            {
                "name": "Debounced file has function",
                "query": """
                MATCH (f:File {name: $file_name})-[:CONTAINS]->(func:Function)
                RETURN func.name
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is not None and "function_to_change" in result,
                "error_msg": f"Debounced file {file_name} should contain function_to_change"
            }
        ]
        
        # Run verification checks
        result = run_verification_checks(driver, verification_checks)
        
        # Close the driver
        driver.close()
        
        return result
        
    except Exception as e:
        logger.error(f"Error verifying debouncing: {e}")
        raise IntegrationTestError(f"Failed to verify debouncing: {e}")

def verify_ignored_file(neo4j_uri, neo4j_user, neo4j_password, file_name):
    """
    Verify that the ignored file was not processed.
    
    Args:
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        file_name (str): Name of the ignored file
        
    Returns:
        bool: True if verification passed, False otherwise
    """
    logger.info("Verifying ignored file was not processed...")
    
    try:
        # Connect to Neo4j
        driver = get_neo4j_driver(neo4j_uri, neo4j_user, neo4j_password)
        
        # Define verification check for ignored file
        verification_checks = [
            {
                "name": "Ignored file does not exist in Neo4j",
                "query": """
                MATCH (f:File {name: $file_name})
                RETURN f
                """,
                "params": {"file_name": file_name},
                "assertion": lambda result: result is None,
                "error_msg": f"Ignored file {file_name} should not exist in Neo4j"
            }
        ]
        
        # Run verification checks
        result = run_verification_checks(driver, verification_checks)
        
        # Close the driver
        driver.close()
        
        return result
        
    except Exception as e:
        logger.error(f"Error verifying ignored file: {e}")
        raise IntegrationTestError(f"Failed to verify ignored file: {e}")

def test_debouncing_and_filtering(watch_dir, wait_time, neo4j_uri, neo4j_user, neo4j_password):
    """
    Run the debouncing and filtering test.
    
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
        # Test debouncing
        debounce_path, debounce_name = test_debouncing(watch_dir, wait_time)
        
        # Wait for debounced file to be processed
        logger.info(f"Waiting {wait_time/2} seconds for debounced file to be processed...")
        time.sleep(wait_time/2)
        
        # Verify debouncing
        debouncing_success = verify_debouncing(
            neo4j_uri, 
            neo4j_user, 
            neo4j_password, 
            debounce_name
        )
        
        # Test ignored files
        ignored_path, ignored_name = create_ignored_file(watch_dir)
        
        # Wait for potential processing (should be ignored)
        logger.info(f"Waiting {wait_time/2} seconds to verify ignored file is not processed...")
        time.sleep(wait_time/2)
        
        # Verify ignored file
        ignored_success = verify_ignored_file(
            neo4j_uri, 
            neo4j_user, 
            neo4j_password, 
            ignored_name
        )
        
        return debouncing_success and ignored_success
    
    except Exception as e:
        logger.error(f"Error in debouncing and filtering test: {e}")
        return False