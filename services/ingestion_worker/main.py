#!/usr/bin/env python3
"""
Ingestion Worker Service for CodeGraph

This service consumes analysis results and ingests them into Neo4j.
"""

import os
import json
import logging
import time
from typing import Dict, List, Any, Optional

import pika
from neo4j import GraphDatabase
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Configuration
RABBITMQ_HOST = os.getenv('RABBITMQ_HOST', 'rabbitmq')
RABBITMQ_PORT = int(os.getenv('RABBITMQ_PORT', '5672'))
RABBITMQ_USER = os.getenv('RABBITMQ_USER', 'guest')
RABBITMQ_PASSWORD = os.getenv('RABBITMQ_PASSWORD', 'guest')
RABBITMQ_RESULTS_QUEUE = os.getenv('RABBITMQ_RESULTS_QUEUE', 'bmcp.results.analysis')
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://neo4j:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'password')

# Relationship resolution configuration
RELATIONSHIP_BATCH_SIZE = int(os.getenv('RELATIONSHIP_BATCH_SIZE', '100'))
RELATIONSHIP_RESOLUTION_INTERVAL = int(os.getenv('RELATIONSHIP_RESOLUTION_INTERVAL', '30'))  # seconds


class Neo4jIngestionWorker:
    """Worker that ingests analysis results into Neo4j."""
    
    def __init__(self, uri: str, user: str, password: str):
        """Initialize the Neo4j driver and scheduler."""
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info(f"Connected to Neo4j at {uri}")
        self.setup_indexes_and_constraints()
        
        # Initialize the scheduler for periodic relationship resolution
        self.scheduler = BackgroundScheduler()
        self.setup_scheduler()
    
    def close(self):
        """Close the Neo4j driver and shutdown the scheduler."""
        if hasattr(self, 'scheduler') and self.scheduler.running:
            self.scheduler.shutdown()
        self.driver.close()
        
    def setup_scheduler(self):
        """Set up the scheduler for periodic relationship resolution."""
        # Add job for periodic relationship resolution
        self.scheduler.add_job(
            self.resolve_pending_relationships,
            IntervalTrigger(seconds=RELATIONSHIP_RESOLUTION_INTERVAL),
            id='resolve_pending_relationships',
            replace_existing=True,
            max_instances=1
        )
        
        # Start the scheduler
        self.scheduler.start()
        logger.info(f"Started scheduler for periodic relationship resolution every {RELATIONSHIP_RESOLUTION_INTERVAL} seconds")
    
    def setup_indexes_and_constraints(self):
        """
        Set up Neo4j indexes and constraints for optimal performance.
        
        Creates:
        - Unique constraint on gid property
        - Index on canonical_id property
        """
        with self.driver.session() as session:
            try:
                # Constraint creation removed - MERGE using gid handles uniqueness.
                # Ensure ID service guarantees unique GIDs.
                
                # Create index on canonical_id for all relevant labels (Neo4j 4.x/5.x syntax)
                labels = ["File", "Class", "Function", "Table", "Column", "HtmlElement"]
                for label in labels:
                    index_name = f"canonical_id_index_{label.lower()}"
                    cypher = f"""
                        CREATE INDEX {index_name} IF NOT EXISTS
                        FOR (n:{label}) ON (n.canonical_id)
                    """
                    session.run(cypher)
                    logger.info(f"Created index {index_name} on {label}(canonical_id)")
            except Exception as e:
                logger.error(f"Error setting up indexes and constraints: {e}")
    
    def ingest_nodes(self, nodes: List[Dict[str, Any]]):
        """
        Ingest nodes into Neo4j with dynamic labels using batch UNWIND for scalability.

        Args:
            nodes: List of node dictionaries with gid, canonical_id, labels, and properties
        """
        if not nodes:
            return

        # Group nodes by their label set for efficient batching
        from collections import defaultdict
        label_groups = defaultdict(list)
        for node in nodes:
            labels = tuple(node.get('labels', ['Node']))
            label_groups[labels].append(node)

        with self.driver.session() as session:
            for labels, group in label_groups.items():
                label_str = ':'.join(labels)
                batch = []
                canonical_ids = []
                for node in group:
                    node_data = {k: v for k, v in node.items() if k not in ['labels']}
                    batch.append(node_data)
                    canonical_ids.append(node.get('canonical_id', ''))

                query = f"""
                UNWIND $batch AS row
                MERGE (n:{label_str} {{gid: row.gid}})
                ON CREATE SET n += row
                ON MATCH SET n += row
                RETURN count(n) as count
                """

                try:
                    result = session.run(query, batch=batch)
                    count = result.single()["count"] if result.single() else 0
                    logger.info(f"Ingested {count} nodes with labels: {labels}")

                    # Immediate resolution attempt for pending relationships for all canonical_ids in this batch
                    for cid in canonical_ids:
                        self.resolve_pending_relationships_for_node(session, cid)
                except Exception as e:
                    logger.error(f"Error ingesting node batch with labels {labels}: {e}")
    
    def ingest_relationships(self, relationships: List[Dict[str, Any]]):
        """
        Ingest relationships into Neo4j using batch UNWIND and correct Cypher for relationship types.

        Args:
            relationships: List of relationship dictionaries with source_gid,
                          target_canonical_id, type, and properties
        """
        if not relationships:
            return

        from collections import defaultdict
        type_groups = defaultdict(list)
        for rel in relationships:
            rel_type = rel.get('type', 'RELATED_TO')
            type_groups[rel_type].append(rel)

        with self.driver.session() as session:
            for rel_type, group in type_groups.items():
                batch = []
                for rel in group:
                    rel_data = {k: v for k, v in rel.items() if k not in ['type']}
                    batch.append(rel_data)

                # First, try to create all relationships in batch
                query = f"""
                UNWIND $batch AS row
                MATCH (source {{gid: row.source_gid}})
                MATCH (target {{canonical_id: row.target_canonical_id}})
                MERGE (source)-[r:`{rel_type}`]->(target)
                SET r += row
                RETURN row.source_gid AS source_gid, row.target_canonical_id AS target_canonical_id
                """

                try:
                    result = session.run(query, batch=batch)
                    created_pairs = set((record["source_gid"], record["target_canonical_id"]) for record in result)
                    logger.info(f"Created {len(created_pairs)} relationships of type {rel_type}")

                    # Find relationships that could not be created (missing node)
                    pending_batch = []
                    for rel in batch:
                        key = (rel["source_gid"], rel["target_canonical_id"])
                        if key not in created_pairs:
                            pending_batch.append(rel)

                    # Batch create PendingRelationship nodes for unresolved relationships
                    if pending_batch:
                        pending_query = """
                        UNWIND $batch AS row
                        CREATE (pr:PendingRelationship {
                            sourceGid: row.source_gid,
                            targetCanonicalId: row.target_canonical_id,
                            type: $rel_type
                        })
                        RETURN count(pr) as count
                        """
                        pending_result = session.run(pending_query, batch=pending_batch, rel_type=rel_type)
                        count = pending_result.single()["count"] if pending_result.single() else 0
                        logger.info(f"Created {count} pending relationships of type {rel_type}")

                except Exception as e:
                    logger.error(f"Error creating relationships of type {rel_type}: {e}")
    
    def resolve_pending_relationships_for_node(self, session, canonical_id: str):
        """
        Resolve pending relationships for a specific node (as target or as source) in batch by type.
        """
        try:
            from collections import defaultdict

            # 1. Resolve relationships where this node is the target
            result = session.run(
                """
                MATCH (pr:PendingRelationship)
                WHERE pr.targetCanonicalId = $canonical_id
                RETURN pr.sourceGid AS source_gid, pr.targetCanonicalId AS target_canonical_id, pr.type AS rel_type, pr.properties AS properties
                """,
                canonical_id=canonical_id,
            )
            batch = [record.data() for record in result]
            type_groups = defaultdict(list)
            for rel in batch:
                type_groups[rel["rel_type"]].append(rel)
            for rel_type, group in type_groups.items():
                unwind_batch = []
                for rel in group:
                    unwind_batch.append({
                        "source_gid": rel["source_gid"],
                        "target_canonical_id": rel["target_canonical_id"],
                        "properties": rel["properties"]
                    })
                query = f"""
                UNWIND $batch AS row
                MATCH (source {{gid: row.source_gid}})
                MATCH (target {{canonical_id: row.target_canonical_id}})
                MATCH (pr:PendingRelationship {{sourceGid: row.source_gid, targetCanonicalId: row.target_canonical_id, type: '{rel_type}'}})
                MERGE (source)-[r:`{rel_type}`]->(target)
                SET r += row.properties
                DELETE pr
                RETURN count(pr) as resolved
                """
                try:
                    res = session.run(query, batch=unwind_batch)
                    resolved = res.single()["resolved"] if res.single() else 0
                    if resolved > 0:
                        logger.info(f"Immediately resolved {resolved} pending relationships for node {canonical_id} as target (type {rel_type})")
                except Exception as e:
                    logger.error(f"Error resolving pending relationships for node {canonical_id} as target (type {rel_type}): {e}")

            # 2. Resolve relationships where this node is the source
            result = session.run(
                """
                MATCH (source {canonical_id: $canonical_id})
                MATCH (pr:PendingRelationship)
                WHERE pr.sourceGid = source.gid
                RETURN pr.sourceGid AS source_gid, pr.targetCanonicalId AS target_canonical_id, pr.type AS rel_type, pr.properties AS properties
                """,
                canonical_id=canonical_id,
            )
            batch = [record.data() for record in result]
            type_groups = defaultdict(list)
            for rel in batch:
                type_groups[rel["rel_type"]].append(rel)
            for rel_type, group in type_groups.items():
                unwind_batch = []
                for rel in group:
                    unwind_batch.append({
                        "source_gid": rel["source_gid"],
                        "target_canonical_id": rel["target_canonical_id"],
                        "properties": rel["properties"]
                    })
                query = f"""
                UNWIND $batch AS row
                MATCH (source {{gid: row.source_gid}})
                MATCH (target {{canonical_id: row.target_canonical_id}})
                MATCH (pr:PendingRelationship {{sourceGid: row.source_gid, targetCanonicalId: row.target_canonical_id, type: '{rel_type}'}})
                MERGE (source)-[r:`{rel_type}`]->(target)
                SET r += row.properties
                DELETE pr
                RETURN count(pr) as resolved
                """
                try:
                    res = session.run(query, batch=unwind_batch)
                    resolved = res.single()["resolved"] if res.single() else 0
                    if resolved > 0:
                        logger.info(f"Immediately resolved {resolved} pending relationships for node {canonical_id} as source (type {rel_type})")
                except Exception as e:
                    logger.error(f"Error resolving pending relationships for node {canonical_id} as source (type {rel_type}): {e}")

        except Exception as e:
            logger.error(f"Error resolving pending relationships for node {canonical_id}: {e}")
    
    def resolve_pending_relationships(self):
        """
        Periodically resolve all pending relationships.
        This is a fallback mechanism for relationships that weren't resolved immediately.

        Processes relationships in batches of configurable size to avoid memory issues.
        """
        logger.info("Running periodic pending relationship resolution")
        with self.driver.session() as session:
            try:
                # Get all pending relationships in batches
                batch_size = RELATIONSHIP_BATCH_SIZE
                while True:
                    # Fetch a batch of pending relationships
                    result = session.run(
                        f"""
                        MATCH (pr:PendingRelationship)
                        RETURN pr.sourceGid AS source_gid, pr.targetCanonicalId AS target_canonical_id, pr.type AS rel_type, pr.properties AS properties
                        LIMIT {batch_size}
                        """
                    )
                    batch = [record.data() for record in result]
                    if not batch:
                        logger.debug("No pending relationships to resolve in this batch")
                        break

                    # Group by relationship type
                    from collections import defaultdict
                    type_groups = defaultdict(list)
                    for rel in batch:
                        type_groups[rel["rel_type"]].append(rel)

                    total_resolved = 0
                    for rel_type, group in type_groups.items():
                        unwind_batch = []
                        for rel in group:
                            unwind_batch.append({
                                "source_gid": rel["source_gid"],
                                "target_canonical_id": rel["target_canonical_id"],
                                "properties": rel["properties"]
                            })
                        # Try to resolve all of this type in one query
                        query = f"""
                        UNWIND $batch AS row
                        MATCH (source {{gid: row.source_gid}})
                        MATCH (target {{canonical_id: row.target_canonical_id}})
                        MATCH (pr:PendingRelationship {{sourceGid: row.source_gid, targetCanonicalId: row.target_canonical_id, type: '{rel_type}'}})
                        MERGE (source)-[r:`{rel_type}`]->(target)
                        SET r += row.properties
                        DELETE pr
                        RETURN count(pr) as resolved
                        """
                        try:
                            res = session.run(query, batch=unwind_batch)
                            resolved = res.single()["resolved"] if res.single() else 0
                            total_resolved += resolved
                            if resolved > 0:
                                logger.info(f"Resolved {resolved} pending relationships of type {rel_type} in batch")
                        except Exception as e:
                            logger.error(f"Error resolving pending relationships of type {rel_type}: {e}")

                    if len(batch) < batch_size:
                        break

            except Exception as e:
                logger.error(f"Error in batch resolution of pending relationships: {e}")
    
    def delete_nodes(self, node_gids: List[str]):
        """
        Delete nodes from Neo4j by their GIDs, including any relationships.
        
        This method handles cascading deletions - if a file is deleted, all its
        functions, classes, etc. should also be deleted.
        
        Args:
            node_gids: List of node GIDs to delete
        """
        with self.driver.session() as session:
            for gid in node_gids:
                try:
                    # First, find all nodes that should be deleted in a cascading manner
                    # This includes the node itself and any nodes that have this node as a parent
                    cascade_result = session.run(
                        """
                        MATCH (n {gid: $gid})
                        OPTIONAL MATCH (child)-[r:CONTAINS|DEFINES]->(n)
                        WITH n, collect(child) as parents
                        OPTIONAL MATCH (n)-[r:CONTAINS|DEFINES]->(child)
                        WITH n, parents, collect(child) as children
                        RETURN n, parents, children
                        """,
                        gid=gid
                    )
                    
                    record = cascade_result.single()
                    if record:
                        # Delete the node, its children, and any pending relationships
                        result = session.run(
                            """
                            // Match the node and its children
                            MATCH (n {gid: $gid})
                            OPTIONAL MATCH (n)-[r:CONTAINS|DEFINES]->(child)
                            
                            // Collect all nodes to be deleted
                            WITH collect(n) + collect(child) as nodes
                            
                            // Delete any pending relationships involving these nodes
                            OPTIONAL MATCH (pr:PendingRelationship)
                            WHERE pr.sourceGid IN [node.gid IN nodes | node.gid]
                            OR any(node IN nodes WHERE node.canonical_id = pr.targetCanonicalId)
                            
                            // Delete the pending relationships
                            WITH nodes, collect(pr) as pendingRels
                            DELETE pendingRels
                            
                            // Detach delete the nodes
                            WITH nodes
                            UNWIND nodes as node
                            DETACH DELETE node
                            
                            RETURN count(nodes) as deleted
                            """,
                            gid=gid
                        )
                        
                        deleted_count = result.single()["deleted"] if result.single() else 0
                        if deleted_count > 0:
                            logger.info(f"Deleted node with GID: {gid} and {deleted_count-1} related nodes")
                        else:
                            logger.debug(f"Node with GID {gid} not found for deletion")
                    else:
                        logger.debug(f"Node with GID {gid} not found for deletion")
                
                except Exception as e:
                    logger.error(f"Error deleting node with GID {gid}: {e}")
    
    def delete_relationships(self, relationship_identifiers: List[Dict[str, str]]):
        """
        Delete relationships from Neo4j by their identifiers.
        Also deletes any pending relationships that match the criteria.
        
        Args:
            relationship_identifiers: List of dictionaries with source_gid and target_canonical_id
        """
        with self.driver.session() as session:
            for rel_id in relationship_identifiers:
                try:
                    source_gid = rel_id.get('source_gid', '')
                    target_canonical_id = rel_id.get('target_canonical_id', '')
                    rel_type = rel_id.get('type', None)
                    
                    # Delete actual relationships
                    query = """
                    MATCH (source {gid: $source_gid})-[r]->(target {canonical_id: $target_canonical_id})
                    """
                    
                    if rel_type:
                        query += f"WHERE type(r) = '{rel_type}' "
                    
                    query += """
                    DELETE r
                    RETURN count(r) as deleted
                    """
                    
                    result = session.run(
                        query,
                        source_gid=source_gid,
                        target_canonical_id=target_canonical_id
                    )
                    
                    deleted_count = result.single()["deleted"] if result.single() else 0
                    
                    # Also delete any pending relationships
                    pending_query = """
                    MATCH (pr:PendingRelationship)
                    WHERE pr.sourceGid = $source_gid AND pr.targetCanonicalId = $target_canonical_id
                    """
                    
                    if rel_type:
                        pending_query += f"AND pr.type = '{rel_type}' "
                    
                    pending_query += """
                    DELETE pr
                    RETURN count(pr) as deleted
                    """
                    
                    pending_result = session.run(
                        pending_query,
                        source_gid=source_gid,
                        target_canonical_id=target_canonical_id
                    )
                    
                    pending_deleted_count = pending_result.single()["deleted"] if pending_result.single() else 0
                    
                    total_deleted = deleted_count + pending_deleted_count
                    if total_deleted > 0:
                        logger.info(f"Deleted {deleted_count} relationships and {pending_deleted_count} pending relationships: {source_gid} -> {target_canonical_id}")
                    else:
                        logger.debug(f"No relationships found for deletion: {source_gid} -> {target_canonical_id}")
                
                except Exception as e:
                    logger.error(f"Error deleting relationship {rel_id}: {e}")


def process_message(ch, method, properties, body, neo4j_worker):
    """Process a message from the results queue."""
    try:
        # Parse the message
        payload = json.loads(body)
        
        logger.info(f"Received analysis result payload")
        
        # Extract nodes and relationships for upsert
        nodes = payload.get('nodes_upserted', [])
        relationships = payload.get('relationships_upserted', [])
        
        # Extract nodes and relationships for deletion
        nodes_deleted = payload.get('nodes_deleted', [])
        relationships_deleted = payload.get('relationships_deleted', [])
        
        # Ingest nodes
        if nodes:
            logger.info(f"Ingesting {len(nodes)} nodes")
            neo4j_worker.ingest_nodes(nodes)
        
        # Ingest relationships
        if relationships:
            logger.info(f"Creating {len(relationships)} relationships")
            neo4j_worker.ingest_relationships(relationships)
        
        # Delete nodes
        if nodes_deleted:
            logger.info(f"Deleting {len(nodes_deleted)} nodes")
            neo4j_worker.delete_nodes(nodes_deleted)
        
        # Delete relationships
        if relationships_deleted:
            logger.info(f"Deleting {len(relationships_deleted)} relationships")
            neo4j_worker.delete_relationships(relationships_deleted)
        # Run the relationship resolver to ensure any pending relationships are processed
        # This is in addition to the periodic scheduler, to ensure immediate processing
        neo4j_worker.resolve_pending_relationships()
        # as it's now scheduled to run periodically in the background
        
        # Acknowledge the message
        ch.basic_ack(delivery_tag=method.delivery_tag)
        
    except Exception as e:
        logger.error(f"Error processing message: {e}")
        # Negative acknowledgment, requeue the message
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)


def main():
    """Main entry point for the Ingestion Worker service."""
    try:
        # Initialize Neo4j worker
        neo4j_worker = Neo4jIngestionWorker(
            uri=NEO4J_URI,
            user=NEO4J_USER,
            password=NEO4J_PASSWORD
        )
        
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
        
        # Declare queue
        channel.queue_declare(queue=RABBITMQ_RESULTS_QUEUE, durable=True)
        
        # Set up consumer
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(
            queue=RABBITMQ_RESULTS_QUEUE,
            on_message_callback=lambda ch, method, properties, body: 
                process_message(ch, method, properties, body, neo4j_worker)
        )
        
        logger.info(f"Ingestion Worker started, consuming from {RABBITMQ_RESULTS_QUEUE}")
        
        # Start consuming
        channel.start_consuming()
        
    except KeyboardInterrupt:
        logger.info("Shutting down Ingestion Worker...")
        if 'neo4j_worker' in locals():
            neo4j_worker.close()
    except Exception as e:
        logger.error(f"Error in main: {e}")
        if 'neo4j_worker' in locals():
            neo4j_worker.close()
        return 1
    
    return 0


if __name__ == "__main__":
    exit(main())