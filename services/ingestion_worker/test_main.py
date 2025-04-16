#!/usr/bin/env python3
"""
Unit tests for the Ingestion Worker Service
"""

import json
import os
import time
from unittest.mock import MagicMock, patch, call

import pytest
from neo4j import GraphDatabase
from apscheduler.schedulers.background import BackgroundScheduler

# Import the main module with proper path handling
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import main


@pytest.fixture
def mock_neo4j_session():
    """Fixture for mocking Neo4j session."""
    mock_session = MagicMock()
    mock_result = MagicMock()
    mock_session.run.return_value = mock_result
    mock_result.single.return_value = {"resolved": 1, "deleted": 1}
    return mock_session


@pytest.fixture
def mock_neo4j_driver(mock_neo4j_session):
    """Fixture for mocking Neo4j driver."""
    mock_driver = MagicMock()
    mock_driver.session.return_value.__enter__.return_value = mock_neo4j_session
    return mock_driver


@pytest.fixture
def neo4j_worker(mock_neo4j_driver):
    """Fixture for creating a Neo4jIngestionWorker with mocked Neo4j driver."""
    with patch('main.GraphDatabase') as mock_graph_db, \
         patch('main.BackgroundScheduler') as mock_scheduler_class:
        mock_graph_db.driver.return_value = mock_neo4j_driver
        mock_scheduler = MagicMock(spec=BackgroundScheduler)
        mock_scheduler_class.return_value = mock_scheduler
        worker = main.Neo4jIngestionWorker('bolt://localhost:7687', 'neo4j', 'password')
        return worker, mock_neo4j_driver, mock_neo4j_session, mock_scheduler


def test_init_creates_indexes_and_constraints(neo4j_worker):
    """Test that the worker initializes and creates indexes and constraints."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Verify indexes and constraints were created
    assert session.run.call_count >= 2
    
    # Check for unique constraint on gid
    constraint_call = [call for call in session.run.call_args_list
                       if "CREATE CONSTRAINT unique_gid" in call[0][0]]
    assert len(constraint_call) == 1
    
    # Check for index on canonical_id
    index_call = [call for call in session.run.call_args_list
                  if "CREATE INDEX canonical_id_index" in call[0][0]]
    assert len(index_call) == 1


def test_init_sets_up_scheduler(neo4j_worker):
    """Test that the worker initializes the scheduler correctly."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Verify scheduler was started
    scheduler.start.assert_called_once()
    
    # Verify job was added
    scheduler.add_job.assert_called_once()
    
    # Check job parameters
    job_args = scheduler.add_job.call_args[0]
    job_kwargs = scheduler.add_job.call_args[1]
    
    # Verify the function is resolve_pending_relationships
    assert job_args[0] == worker.resolve_pending_relationships
    
    # Verify job has max_instances=1 to prevent overlapping executions
    assert job_kwargs.get('max_instances') == 1
    
    # Verify job has replace_existing=True
    assert job_kwargs.get('replace_existing') is True


def test_ingest_nodes_with_labels(neo4j_worker):
    """Test that ingest_nodes uses dynamic labels from the node data."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Create test nodes with labels
    nodes = [
        {
            'gid': 'test-gid-1',
            'canonical_id': 'test-canonical-id-1',
            'labels': ['File', 'Python'],
            'name': 'test.py',
            'path': '/test/test.py'
        },
        {
            'gid': 'test-gid-2',
            'canonical_id': 'test-canonical-id-2',
            'labels': ['Function'],
            'name': 'test_func',
            'path': '/test/test.py'
        }
    ]
    
    # Call the method
    worker.ingest_nodes(nodes)
    
    # Verify correct calls were made - now we expect 4 calls (2 for node creation, 2 for relationship resolution)
    assert session.run.call_count == 4
    
    # Check first call (File:Python labels)
    first_call = session.run.call_args_list[0]
    assert "MERGE (n:File:Python {gid: $gid})" in first_call[0][0]
    assert first_call[1]['gid'] == 'test-gid-1'
    assert first_call[1]['canonical_id'] == 'test-canonical-id-1'
    assert first_call[1]['properties'] == {'name': 'test.py', 'path': '/test/test.py'}
    
    # Check second call (relationship resolution for first node)
    second_call = session.run.call_args_list[1]
    assert "MATCH (pr:PendingRelationship)" in second_call[0][0]
    assert "WHERE pr.targetCanonicalId = $canonical_id" in second_call[0][0]
    assert second_call[1]['canonical_id'] == 'test-canonical-id-1'
    
    # Check third call (Function label)
    third_call = session.run.call_args_list[2]
    assert "MERGE (n:Function {gid: $gid})" in third_call[0][0]
    assert third_call[1]['gid'] == 'test-gid-2'
    assert third_call[1]['canonical_id'] == 'test-canonical-id-2'
    assert third_call[1]['properties'] == {'name': 'test_func', 'path': '/test/test.py'}
    
    # Check fourth call (relationship resolution for second node)
    fourth_call = session.run.call_args_list[3]
    assert "MATCH (pr:PendingRelationship)" in fourth_call[0][0]
    assert "WHERE pr.targetCanonicalId = $canonical_id" in fourth_call[0][0]
    assert fourth_call[1]['canonical_id'] == 'test-canonical-id-2'


def test_ingest_nodes_resolves_pending_relationships(neo4j_worker):
    """Test that ingest_nodes attempts to resolve pending relationships for both target and source."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Create a test node
    node = {
        'gid': 'test-gid',
        'canonical_id': 'test-canonical-id',
        'labels': ['File'],
        'name': 'test.py',
        'path': '/test/test.py'
    }
    
    # Call the method
    worker.ingest_nodes([node])
    
    # Verify node was ingested and relationships were resolved
    assert session.run.call_count == 2
    
    # Check first call (node creation)
    first_call = session.run.call_args_list[0]
    assert "MERGE (n:File {gid: $gid})" in first_call[0][0]
    
    # Check second call (relationship resolution for target)
    second_call = session.run.call_args_list[1]
    assert "MATCH (pr:PendingRelationship)" in second_call[0][0]
    assert "WHERE pr.targetCanonicalId = $canonical_id" in second_call[0][0]
    assert second_call[1]['canonical_id'] == 'test-canonical-id'
    
    # Configure mock to simulate successful relationship resolution
    mock_result = MagicMock()
    mock_result.single.return_value = {"resolved": 2}
    session.run.return_value = mock_result
    
    # Call the method again
    worker.resolve_pending_relationships_for_node(session, 'test-canonical-id')
    
    # Verify both target and source relationships were checked
    assert session.run.call_count == 4
    
    # Check third call (relationship resolution for target)
    third_call = session.run.call_args_list[2]
    assert "MATCH (pr:PendingRelationship)" in third_call[0][0]
    assert "WHERE pr.targetCanonicalId = $canonical_id" in third_call[0][0]
    
    # Check fourth call (relationship resolution for source)
    fourth_call = session.run.call_args_list[3]
    assert "MATCH (source {canonical_id: $canonical_id})" in fourth_call[0][0]
    assert "WHERE pr.sourceGid = source.gid" in fourth_call[0][0]


def test_ingest_relationships_direct_creation(neo4j_worker):
    """Test that ingest_relationships attempts direct relationship creation first."""
    worker, driver, session = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate successful direct relationship creation
    mock_result = MagicMock()
    mock_result.single.return_value = {'r': 'some-relationship'}
    session.run.return_value = mock_result
    
    # Create a test relationship
    relationship = {
        'source_gid': 'source-gid',
        'target_canonical_id': 'target-canonical-id',
        'type': 'CALLS',
        'line': 42
    }
    
    # Call the method
    worker.ingest_relationships([relationship])
    
    # Verify direct relationship creation was attempted
    assert session.run.call_count == 1
    
    # Check the call
    call_args = session.run.call_args
    assert "MATCH (source {gid: $source_gid})" in call_args[0][0]
    assert "MATCH (target {canonical_id: $target_canonical_id})" in call_args[0][0]
    assert "MERGE (source)-[r:`$rel_type`]->(target)" in call_args[0][0]
    assert call_args[1]['source_gid'] == 'source-gid'
    assert call_args[1]['target_canonical_id'] == 'target-canonical-id'
    assert call_args[1]['rel_type'] == 'CALLS'
    assert call_args[1]['properties'] == {'line': 42}


def test_ingest_relationships_pending_creation(neo4j_worker):
    """Test that ingest_relationships creates pending relationships when direct creation fails."""
    worker, driver, session = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate failed direct relationship creation
    mock_result_direct = MagicMock()
    mock_result_direct.single.return_value = None
    
    mock_result_pending = MagicMock()
    mock_result_pending.single.return_value = {'pr': 'some-pending-relationship'}
    
    session.run.side_effect = [mock_result_direct, mock_result_pending]
    
    # Create a test relationship
    relationship = {
        'source_gid': 'source-gid',
        'target_canonical_id': 'target-canonical-id',
        'type': 'CALLS',
        'line': 42
    }
    
    # Call the method
    worker.ingest_relationships([relationship])
    
    # Verify both direct and pending relationship creation were attempted
    assert session.run.call_count == 2
    
    # Check first call (direct creation attempt)
    first_call = session.run.call_args_list[0]
    assert "MATCH (source {gid: $source_gid})" in first_call[0][0]
    assert "MATCH (target {canonical_id: $target_canonical_id})" in first_call[0][0]
    
    # Check second call (pending relationship creation)
    second_call = session.run.call_args_list[1]
    assert "CREATE (pr:PendingRelationship" in second_call[0][0]
    assert second_call[1]['source_gid'] == 'source-gid'
    assert second_call[1]['target_canonical_id'] == 'target-canonical-id'
    assert second_call[1]['rel_type'] == 'CALLS'
    assert second_call[1]['properties'] == {'line': 42}


def test_resolve_pending_relationships_for_node(neo4j_worker):
    """Test resolving pending relationships for a specific node."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate successful relationship resolution
    mock_result1 = MagicMock()
    mock_result1.single.return_value = {"resolved": 2}
    
    mock_result2 = MagicMock()
    mock_result2.single.return_value = {"resolved": 1}
    
    session.run.side_effect = [mock_result1, mock_result2]
    
    # Call the method
    worker.resolve_pending_relationships_for_node(session, 'test-canonical-id')
    
    # Verify correct queries were executed
    assert session.run.call_count == 2
    
    # Check the first call (target relationships)
    first_call = session.run.call_args_list[0]
    assert "MATCH (pr:PendingRelationship)" in first_call[0][0]
    assert "WHERE pr.targetCanonicalId = $canonical_id" in first_call[0][0]
    assert "MATCH (source {gid: pr.sourceGid})" in first_call[0][0]
    assert "MATCH (target {canonical_id: pr.targetCanonicalId})" in first_call[0][0]
    assert "DELETE pr" in first_call[0][0]
    assert first_call[1]['canonical_id'] == 'test-canonical-id'
    
    # Check the second call (source relationships)
    second_call = session.run.call_args_list[1]
    assert "MATCH (source {canonical_id: $canonical_id})" in second_call[0][0]
    assert "MATCH (pr:PendingRelationship)" in second_call[0][0]
    assert "WHERE pr.sourceGid = source.gid" in second_call[0][0]
    assert "MATCH (target {canonical_id: pr.targetCanonicalId})" in second_call[0][0]
    assert "DELETE pr" in second_call[0][0]
    assert second_call[1]['canonical_id'] == 'test-canonical-id'


def test_resolve_pending_relationships_batch(neo4j_worker):
    """Test batch resolution of pending relationships."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate pending relationships
    mock_count_result = MagicMock()
    mock_count_result.single.return_value = {"total": 150}
    
    mock_batch_result1 = MagicMock()
    mock_batch_result1.single.return_value = {"resolved": 100}
    
    mock_batch_result2 = MagicMock()
    mock_batch_result2.single.return_value = {"resolved": 50}
    
    session.run.side_effect = [mock_count_result, mock_batch_result1, mock_batch_result2]
    
    # Call the method
    worker.resolve_pending_relationships()
    
    # Verify correct queries were executed
    assert session.run.call_count == 3
    
    # Check the first call (count query)
    first_call = session.run.call_args_list[0]
    assert "MATCH (pr:PendingRelationship)" in first_call[0][0]
    assert "RETURN count(pr) as total" in first_call[0][0]
    
    # Check the second call (first batch)
    second_call = session.run.call_args_list[1]
    assert "MATCH (pr:PendingRelationship)" in second_call[0][0]
    assert "WITH pr LIMIT" in second_call[0][0]
    assert "MATCH (source {gid: pr.sourceGid})" in second_call[0][0]
    assert "MATCH (target {canonical_id: pr.targetCanonicalId})" in second_call[0][0]
    assert "DELETE pr" in second_call[0][0]
    
    # Check the third call (second batch)
    third_call = session.run.call_args_list[2]
    assert "MATCH (pr:PendingRelationship)" in third_call[0][0]
    assert "WITH pr LIMIT" in third_call[0][0]
    assert "MATCH (source {gid: pr.sourceGid})" in third_call[0][0]
    assert "MATCH (target {canonical_id: pr.targetCanonicalId})" in third_call[0][0]
    assert "DELETE pr" in third_call[0][0]


def test_delete_nodes(neo4j_worker):
    """Test deleting nodes by GID with cascading deletion."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate nodes with children
    mock_cascade_result = MagicMock()
    mock_cascade_result.single.return_value = {"n": "node", "parents": ["parent"], "children": ["child1", "child2"]}
    
    mock_delete_result = MagicMock()
    mock_delete_result.single.return_value = {"deleted": 3}
    
    session.run.side_effect = [mock_cascade_result, mock_delete_result, mock_cascade_result, mock_delete_result]
    
    # Call the method
    worker.delete_nodes(['gid-1', 'gid-2'])
    
    # Verify correct queries were executed
    assert session.run.call_count == 4
    
    # Check cascade query calls
    for i, call_args in enumerate(session.run.call_args_list[::2]):
        assert "MATCH (n {gid: $gid})" in call_args[0][0]
        assert "OPTIONAL MATCH (child)-[r:CONTAINS|DEFINES]->(n)" in call_args[0][0]
        assert "OPTIONAL MATCH (n)-[r:CONTAINS|DEFINES]->(child)" in call_args[0][0]
        assert call_args[1]['gid'] == f'gid-{i+1}'
    
    # Check delete query calls
    for i, call_args in enumerate(session.run.call_args_list[1::2]):
        assert "MATCH (n {gid: $gid})" in call_args[0][0]
        assert "OPTIONAL MATCH (n)-[r:CONTAINS|DEFINES]->(child)" in call_args[0][0]
        assert "WITH collect(n) + collect(child) as nodes" in call_args[0][0]
        assert "OPTIONAL MATCH (pr:PendingRelationship)" in call_args[0][0]
        assert "WHERE pr.sourceGid IN [node.gid IN nodes | node.gid]" in call_args[0][0]
        assert "OR any(node IN nodes WHERE node.canonical_id = pr.targetCanonicalId)" in call_args[0][0]
        assert "DELETE pendingRels" in call_args[0][0]
        assert "DETACH DELETE node" in call_args[0][0]
        assert call_args[1]['gid'] == f'gid-{i+1}'


def test_delete_relationships(neo4j_worker):
    """Test deleting relationships by identifiers, including pending relationships."""
    worker, driver, session, scheduler = neo4j_worker
    
    # Reset mock to clear setup calls
    session.reset_mock()
    
    # Configure mock to simulate relationship deletion
    mock_result1 = MagicMock()
    mock_result1.single.return_value = {"deleted": 1}
    
    mock_result2 = MagicMock()
    mock_result2.single.return_value = {"deleted": 2}
    
    mock_result3 = MagicMock()
    mock_result3.single.return_value = {"deleted": 1}
    
    mock_result4 = MagicMock()
    mock_result4.single.return_value = {"deleted": 3}
    
    session.run.side_effect = [mock_result1, mock_result2, mock_result3, mock_result4]
    
    # Call the method with different relationship identifiers
    worker.delete_relationships([
        {'source_gid': 'source-1', 'target_canonical_id': 'target-1'},
        {'source_gid': 'source-2', 'target_canonical_id': 'target-2', 'type': 'CALLS'}
    ])
    
    # Verify correct queries were executed - now 4 calls (2 for actual relationships, 2 for pending)
    assert session.run.call_count == 4
    
    # Check first call (actual relationship without type)
    first_call = session.run.call_args_list[0]
    assert "MATCH (source {gid: $source_gid})-[r]->(target {canonical_id: $target_canonical_id})" in first_call[0][0]
    assert "WHERE type(r) = 'CALLS'" not in first_call[0][0]
    assert first_call[1]['source_gid'] == 'source-1'
    assert first_call[1]['target_canonical_id'] == 'target-1'
    
    # Check second call (pending relationship without type)
    second_call = session.run.call_args_list[1]
    assert "MATCH (pr:PendingRelationship)" in second_call[0][0]
    assert "WHERE pr.sourceGid = $source_gid AND pr.targetCanonicalId = $target_canonical_id" in second_call[0][0]
    assert "AND pr.type = 'CALLS'" not in second_call[0][0]
    assert second_call[1]['source_gid'] == 'source-1'
    assert second_call[1]['target_canonical_id'] == 'target-1'
    
    # Check third call (actual relationship with type)
    third_call = session.run.call_args_list[2]
    assert "MATCH (source {gid: $source_gid})-[r]->(target {canonical_id: $target_canonical_id})" in third_call[0][0]
    assert "WHERE type(r) = 'CALLS'" in third_call[0][0]
    assert third_call[1]['source_gid'] == 'source-2'
    assert third_call[1]['target_canonical_id'] == 'target-2'
    
    # Check fourth call (pending relationship with type)
    fourth_call = session.run.call_args_list[3]
    assert "MATCH (pr:PendingRelationship)" in fourth_call[0][0]
    assert "WHERE pr.sourceGid = $source_gid AND pr.targetCanonicalId = $target_canonical_id" in fourth_call[0][0]
    assert "AND pr.type = 'CALLS'" in fourth_call[0][0]
    assert fourth_call[1]['source_gid'] == 'source-2'
    assert fourth_call[1]['target_canonical_id'] == 'target-2'


@patch('main.Neo4jIngestionWorker')
def test_process_message_handles_all_fields(mock_worker_class):
    """Test that process_message handles all fields from AnalyzerResultPayload."""
    # Create mock objects
    ch = MagicMock()
    method = MagicMock()
    properties = MagicMock()
    neo4j_worker = mock_worker_class.return_value
    
    # Create a test payload with all fields
    payload = {
        'nodes_upserted': [{'gid': 'test-gid', 'canonical_id': 'test-canonical-id'}],
        'relationships_upserted': [{'source_gid': 'source-gid', 'target_canonical_id': 'target-canonical-id'}],
        'nodes_deleted': ['delete-gid-1'],
        'relationships_deleted': [{'source_gid': 'del-source', 'target_canonical_id': 'del-target'}]
    }
    
    # Call the function
    main.process_message(ch, method, properties, json.dumps(payload).encode(), neo4j_worker)
    
    # Verify all methods were called with correct arguments
    neo4j_worker.ingest_nodes.assert_called_once_with(payload['nodes_upserted'])
    neo4j_worker.ingest_relationships.assert_called_once_with(payload['relationships_upserted'])
    neo4j_worker.delete_nodes.assert_called_once_with(payload['nodes_deleted'])
    neo4j_worker.delete_relationships.assert_called_once_with(payload['relationships_deleted'])
    neo4j_worker.resolve_pending_relationships.assert_called_once()
    ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)


@patch('main.Neo4jIngestionWorker')
def test_process_message_handles_partial_payload(mock_worker_class):
    """Test that process_message handles partial payloads correctly."""
    # Create mock objects
    ch = MagicMock()
    method = MagicMock()
    properties = MagicMock()
    neo4j_worker = mock_worker_class.return_value
    
    # Create a test payload with only some fields
    payload = {
        'nodes_upserted': [{'gid': 'test-gid', 'canonical_id': 'test-canonical-id'}]
    }
    
    # Call the function
    main.process_message(ch, method, properties, json.dumps(payload).encode(), neo4j_worker)
    
    # Verify only the relevant methods were called
    neo4j_worker.ingest_nodes.assert_called_once_with(payload['nodes_upserted'])
    neo4j_worker.ingest_relationships.assert_not_called()
    neo4j_worker.delete_nodes.assert_not_called()
    neo4j_worker.delete_relationships.assert_not_called()
    neo4j_worker.resolve_pending_relationships.assert_called_once()
    ch.basic_ack.assert_called_once_with(delivery_tag=method.delivery_tag)


@patch('main.Neo4jIngestionWorker')
def test_process_message_error_handling(mock_worker_class):
    """Test error handling in process_message."""
    # Create mock objects
    ch = MagicMock()
    method = MagicMock()
    properties = MagicMock()
    neo4j_worker = mock_worker_class.return_value
    
    # Configure worker to raise an exception
    neo4j_worker.ingest_nodes.side_effect = Exception("Test error")
    
    # Create a test payload
    payload = {
        'nodes_upserted': [{'gid': 'test-gid', 'canonical_id': 'test-canonical-id'}]
    }
    
    # Call the function
    main.process_message(ch, method, properties, json.dumps(payload).encode(), neo4j_worker)
    
    # Verify error handling
    ch.basic_nack.assert_called_once_with(delivery_tag=method.delivery_tag, requeue=True)


if __name__ == '__main__':
    pytest.main()