#!/usr/bin/env python3
"""
Enhanced Integration Test for CodeGraph Phase 3 Pipeline

This script tests the Phase 3 functionality of the CodeGraph pipeline by:
1. Testing relationship extraction and resolution:
   - Creating two Python files where one file imports and calls functions from the other
   - Verifying that both the :IMPORTS and :CALLS relationships are correctly created in Neo4j
   - Checking that relationship properties are properly set

2. Testing debouncing and filtering:
   - Creating multiple rapid changes to a file and verifying only one analysis job is triggered
   - Creating files that should be ignored (e.g., in a node_modules directory) and verifying they are not processed

3. Testing deletion handling:
   - Creating a Python file, waiting for it to be processed, then deleting it
   - Verifying that the file node and all related nodes (functions, classes) are removed from Neo4j
   - Verifying that all relationships involving the deleted nodes are also removed

Usage:
    python scripts/test_integration_phase3.py [--watch-dir WATCH_DIR] [--wait-time WAIT_TIME]

Requirements:
    - All CodeGraph services must be running (rabbitmq, neo4j, id-service, file-watcher, python-analyzer, ingestion-worker)
    - Neo4j database should be accessible
    - The watched directory should be accessible and writable

Environment Setup:
    1. Start all services using docker-compose:
       docker-compose up -d
    
    2. Ensure the watched directory exists and is writable:
       mkdir -p ./watched/paths
    
    3. Run the test:
       python scripts/test_integration_phase3.py
"""

import sys
import argparse
import logging

from phase3_test_utils import check_services_running, IntegrationTestError
from phase3_test_relationships import test_relationships
from phase3_test_debouncing import test_debouncing_and_filtering
from phase3_test_deletion import test_deletion_handling

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Phase 3 integration test for CodeGraph pipeline")
    parser.add_argument("--watch-dir", default="./watched/paths", help="Directory being watched by the file watcher service")
    parser.add_argument("--wait-time", type=int, default=30, help="Time to wait for file processing in seconds")
    parser.add_argument("--neo4j-uri", default="bolt://localhost:7687", help="Neo4j connection URI")
    parser.add_argument("--neo4j-user", default="neo4j", help="Neo4j username")
    parser.add_argument("--neo4j-pass", default="password", help="Neo4j password")
    return parser.parse_args()

def run_integration_test(args):
    """
    Run the complete Phase 3 integration test.
    
    Args:
        args: Command line arguments
        
    Returns:
        int: 0 for success, 1 for failure
    """
    try:
        # Step 1: Check if all services are running
        check_services_running()
        
        # Step 2: Test relationship extraction and resolution
        logger.info("=== Starting Relationship Extraction and Resolution Test ===")
        relationship_success = test_relationships(
            args.watch_dir,
            args.wait_time,
            args.neo4j_uri,
            args.neo4j_user,
            args.neo4j_pass
        )
        
        # Step 3: Test debouncing and filtering
        logger.info("=== Starting Debouncing and Filtering Test ===")
        debouncing_success = test_debouncing_and_filtering(
            args.watch_dir,
            args.wait_time,
            args.neo4j_uri,
            args.neo4j_user,
            args.neo4j_pass
        )
        
        # Step 4: Test deletion handling
        logger.info("=== Starting Deletion Handling Test ===")
        deletion_success = test_deletion_handling(
            args.watch_dir,
            args.wait_time,
            args.neo4j_uri,
            args.neo4j_user,
            args.neo4j_pass
        )
        
        # Determine overall success
        overall_success = (
            relationship_success and 
            debouncing_success and 
            deletion_success
        )
        
        if overall_success:
            logger.info("🎉 Phase 3 integration test passed!")
            return 0
        else:
            logger.error("❌ Phase 3 integration test failed!")
            # Log which parts failed
            if not relationship_success:
                logger.error("❌ Relationship extraction and resolution test failed")
            if not debouncing_success:
                logger.error("❌ Debouncing and filtering test failed")
            if not deletion_success:
                logger.error("❌ Deletion handling test failed")
            return 1
            
    except IntegrationTestError as e:
        logger.error(f"Integration test error: {e}")
        return 1
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return 1

def main():
    """Main entry point."""
    args = parse_args()
    return run_integration_test(args)

if __name__ == "__main__":
    sys.exit(main())
