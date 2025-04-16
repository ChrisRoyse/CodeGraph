#!/usr/bin/env python3
"""
Utility functions for Phase 3 integration tests.

This module provides common utility functions used across the Phase 3 integration tests.
"""

import os
import sys
import time
import uuid
import logging
from pathlib import Path

import docker
from neo4j import GraphDatabase

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

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

def run_verification_checks(driver, verification_checks):
    """
    Run a set of verification checks against Neo4j.
    
    Args:
        driver: Neo4j driver
        verification_checks: List of verification check dictionaries
        
    Returns:
        bool: True if all checks passed, False otherwise
    """
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
    
    # Log summary
    logger.info(f"Verification complete: {success_count} passed, {failure_count} failed")
    
    return failure_count == 0

def get_neo4j_driver(neo4j_uri, neo4j_user, neo4j_password):
    """
    Create and return a Neo4j driver.
    
    Args:
        neo4j_uri: Neo4j URI
        neo4j_user: Neo4j username
        neo4j_password: Neo4j password
        
    Returns:
        Neo4j driver
    """
    return GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))