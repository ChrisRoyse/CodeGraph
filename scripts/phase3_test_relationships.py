#!/usr/bin/env python3
"""
Relationship Testing Module for Phase 3 Integration Tests.

This module tests the relationship extraction and resolution functionality:
- Creating two Python files where one file imports and calls functions from the other
- Verifying that both the :IMPORTS and :CALLS relationships are correctly created in Neo4j
- Checking that relationship properties are properly set
"""

import os
import time
import uuid
import logging
from pathlib import Path

from phase3_test_utils import IntegrationTestError, run_verification_checks, get_neo4j_driver

# Configure logging
logger = logging.getLogger(__name__)

# Test file content for the first file (module.py)
MODULE_FILE_CONTENT = """
def utility_function(value):
    \"\"\"A utility function that returns a formatted value.\"\"\"
    return f"Processed: {value}"

def another_utility(name, count=1):
    \"\"\"Another utility function with multiple parameters.\"\"\"
    result = []
    for i in range(count):
        result.append(f"{name}_{i}")
    return result

class UtilityClass:
    \"\"\"A utility class with methods.\"\"\"
    
    def __init__(self, prefix=""):
        \"\"\"Initialize with an optional prefix.\"\"\"
        self.prefix = prefix
        
    def format_value(self, value):
        \"\"\"Format a value with the prefix.\"\"\"
        return f"{self.prefix}{value}"
"""

# Test file content for the second file (main.py) that imports and calls functions from module.py
MAIN_FILE_CONTENT = """
# Import the module
import module

# Import specific functions
from module import utility_function, UtilityClass

def main_function():
    \"\"\"Main function that calls imported functions.\"\"\"
    # Call the imported function
    result1 = utility_function("test")
    
    # Call another function from the module
    result2 = module.another_utility("item", 3)
    
    # Create an instance of the imported class and call its method
    util = UtilityClass("PREFIX_")
    result3 = util.format_value("value")
    
    return result1, result2, result3

# Call the main function
if __name__ == "__main__":
    main_function()
"""

def create_test_files(watch_dir):
    """
    Create test Python files in the watched directory for relationship testing.
    
    Args:
        watch_dir (str): Path to the watched directory
        
    Returns:
        tuple: (module_path, module_name, main_path, main_name) with file paths and names
        
    Raises:
        IntegrationTestError: If file creation fails
    """
    logger.info(f"Creating test files in {watch_dir}...")
    
    try:
        # Create watched directory if it doesn't exist
        watch_path = Path(watch_dir)
        watch_path.mkdir(parents=True, exist_ok=True)
        
        # Generate unique identifiers for the files to avoid conflicts
        unique_id = uuid.uuid4().hex[:8]
        
        # Create module file
        module_name = f"module_{unique_id}.py"
        module_path = watch_path / module_name
        
        with open(module_path, 'w') as f:
            f.write(MODULE_FILE_CONTENT)
        
        logger.info(f"Created module file: {module_path}")
        
        # Create main file that imports and uses the module
        main_name = f"main_{unique_id}.py"
        main_path = watch_path / main_name
        
        # Replace generic module name with the actual module name in the main file content
        main_content = MAIN_FILE_CONTENT.replace("import module", f"import {module_name[:-3]}")
        main_content = main_content.replace("from module import", f"from {module_name[:-3]} import")
        main_content = main_content.replace("module.another_utility", f"{module_name[:-3]}.another_utility")
        
        with open(main_path, 'w') as f:
            f.write(main_content)
        
        logger.info(f"Created main file: {main_path}")
        
        return str(module_path), module_name, str(main_path), main_name
        
    except Exception as e:
        logger.error(f"Error creating test files: {e}")
        raise IntegrationTestError(f"Failed to create test files: {e}")

def verify_relationships(neo4j_uri, neo4j_user, neo4j_password, module_name, main_name):
    """
    Verify that relationships between files are correctly created in Neo4j.
    
    Args:
        neo4j_uri (str): Neo4j connection URI
        neo4j_user (str): Neo4j username
        neo4j_password (str): Neo4j password
        module_name (str): Name of the module file
        main_name (str): Name of the main file
        
    Returns:
        bool: True if verification passed, False otherwise
    """
    logger.info("Verifying relationships in Neo4j...")
    
    try:
        # Connect to Neo4j
        driver = get_neo4j_driver(neo4j_uri, neo4j_user, neo4j_password)
        
        # Define verification checks for relationships
        verification_checks = [
            {
                "name": "Import relationship exists",
                "query": """
                MATCH (main:File {name: $main_name})-[:CONTAINS]->(func:Function)
                MATCH (func)-[r:IMPORTS]->(target)
                WHERE target.canonical_id CONTAINS $module_name
                RETURN r
                """,
                "params": {"main_name": main_name, "module_name": module_name[:-3]},
                "assertion": lambda result: result is not None,
                "error_msg": f"Import relationship from {main_name} to {module_name} not found"
            },
            {
                "name": "Call relationship exists",
                "query": """
                MATCH (main:File {name: $main_name})-[:CONTAINS]->(func:Function)
                MATCH (func)-[r:CALLS]->()
                RETURN r
                """,
                "params": {"main_name": main_name},
                "assertion": lambda result: result is not None,
                "error_msg": f"Call relationship from {main_name} not found"
            },
            {
                "name": "Import relationship has correct properties",
                "query": """
                MATCH (main:File {name: $main_name})-[:CONTAINS]->(func:Function)
                MATCH (func)-[r:IMPORTS]->(target)
                WHERE target.canonical_id CONTAINS $module_name
                RETURN r.alias
                """,
                "params": {"main_name": main_name, "module_name": module_name[:-3]},
                "assertion": lambda result: result is not None,
                "error_msg": f"Import relationship from {main_name} to {module_name} has incorrect properties"
            },
            {
                "name": "Both files exist in Neo4j",
                "query": """
                MATCH (module:File {name: $module_name})
                MATCH (main:File {name: $main_name})
                RETURN module, main
                """,
                "params": {"module_name": module_name, "main_name": main_name},
                "assertion": lambda result: result is not None and len(result) == 2,
                "error_msg": f"Both files {module_name} and {main_name} should exist in Neo4j"
            },
            {
                "name": "Module file has functions",
                "query": """
                MATCH (module:File {name: $module_name})-[:CONTAINS]->(func:Function)
                RETURN count(func) as func_count
                """,
                "params": {"module_name": module_name},
                "assertion": lambda result: result is not None and result >= 2,
                "error_msg": f"Module file {module_name} should contain at least 2 functions"
            },
            {
                "name": "Module file has class",
                "query": """
                MATCH (module:File {name: $module_name})-[:CONTAINS]->(class:Class)
                RETURN class
                """,
                "params": {"module_name": module_name},
                "assertion": lambda result: result is not None,
                "error_msg": f"Module file {module_name} should contain a class"
            }
        ]
        
        # Run verification checks
        result = run_verification_checks(driver, verification_checks)
        
        # Close the driver
        driver.close()
        
        return result
        
    except Exception as e:
        logger.error(f"Error verifying relationships: {e}")
        raise IntegrationTestError(f"Failed to verify relationships: {e}")

def test_relationships(watch_dir, wait_time, neo4j_uri, neo4j_user, neo4j_password):
    """
    Run the relationship extraction and resolution test.
    
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
        # Create test files
        module_path, module_name, main_path, main_name = create_test_files(watch_dir)
        
        # Wait for files to be processed
        logger.info(f"Waiting {wait_time} seconds for relationship files to be processed...")
        time.sleep(wait_time)
        
        # Verify relationships
        return verify_relationships(
            neo4j_uri, 
            neo4j_user, 
            neo4j_password, 
            module_name, 
            main_name
        )
    except Exception as e:
        logger.error(f"Error in relationship test: {e}")
        return False