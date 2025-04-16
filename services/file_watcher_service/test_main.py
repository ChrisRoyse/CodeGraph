#!/usr/bin/env python3
"""
Unit tests for the File Watcher Service
"""

import json
import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest
from watchdog.events import FileCreatedEvent, FileModifiedEvent, FileDeletedEvent

# Import the main module with proper path handling
import sys
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import main
import pika


@pytest.fixture
def mock_rabbitmq_connection():
    """Fixture for mocking RabbitMQ connection."""
    mock_connection = MagicMock()
    mock_channel = MagicMock()
    mock_connection.channel.return_value = mock_channel
    return mock_connection, mock_channel


@pytest.fixture
def file_change_handler(mock_rabbitmq_connection):
    """Fixture for creating a FileChangeHandler with mocked RabbitMQ."""
    connection, _ = mock_rabbitmq_connection
    return main.FileChangeHandler(connection)


def test_init_declares_queue(mock_rabbitmq_connection):
    """Test that the handler initializes and declares the queue."""
    connection, channel = mock_rabbitmq_connection
    
    # Create handler
    main.FileChangeHandler(connection)
    
    # Verify queue was declared
    channel.queue_declare.assert_called_once_with(
        queue=main.RABBITMQ_QUEUE,
        durable=True
    )

def test_on_created_processes_py_files(file_change_handler, mock_rabbitmq_connection):
    """Test that on_created processes Python files."""
    _, channel = mock_rabbitmq_connection
    
    # Create a mock event for a Python file
    mock_event = MagicMock(spec=FileCreatedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/test_file.py"
    
    # Mock Path.resolve and Path.relative_to
    with patch('main.Path') as mock_path, \
         patch.object(file_change_handler, '_should_process_now', return_value=True), \
         patch.object(file_change_handler, '_should_ignore_path', return_value=False):
        
        mock_resolved_path = MagicMock()
        mock_resolved_path.suffix = '.py'
        mock_resolved_path.relative_to.return_value = Path("test_file.py")
        mock_path.return_value.resolve.return_value = mock_resolved_path
        
        # Call the handler
        file_change_handler.on_created(mock_event)
        
        # Verify message was published with correct format
        expected_message = {
            "file_path": "test_file.py",
            "event_type": "CREATED"
        }
        
        channel.basic_publish.assert_called_once_with(
            exchange='',
            routing_key=main.RABBITMQ_QUEUE,
            body=json.dumps(expected_message),
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type='application/json'
            )
        )

def test_on_modified_processes_py_files(file_change_handler, mock_rabbitmq_connection):
    """Test that on_modified processes Python files."""
    _, channel = mock_rabbitmq_connection
    
    # Create a mock event for a Python file
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/test_file.py"
    
    # Mock Path.resolve and Path.relative_to
    with patch('main.Path') as mock_path, \
         patch.object(file_change_handler, '_should_process_now', return_value=True), \
         patch.object(file_change_handler, '_should_ignore_path', return_value=False):
        
        mock_resolved_path = MagicMock()
        mock_resolved_path.suffix = '.py'
        mock_resolved_path.relative_to.return_value = Path("test_file.py")
        mock_path.return_value.resolve.return_value = mock_resolved_path
        
        # Call the handler
        file_change_handler.on_modified(mock_event)
        
        # Verify message was published with correct format
        expected_message = {
            "file_path": "test_file.py",
            "event_type": "MODIFIED"
        }
        
        channel.basic_publish.assert_called_once_with(
            exchange='',
            routing_key=main.RABBITMQ_QUEUE,
            body=json.dumps(expected_message),
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type='application/json'
            )
        )


def test_ignores_non_py_files(file_change_handler, mock_rabbitmq_connection):
    """Test that non-Python files are ignored."""
    _, channel = mock_rabbitmq_connection
    
    # Create a mock event for a non-Python file
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/test_file.txt"
    
    # Mock Path.resolve
    with patch('main.Path') as mock_path:
        mock_resolved_path = MagicMock()
        mock_resolved_path.suffix = '.txt'  # Non-Python file
        mock_path.return_value.resolve.return_value = mock_resolved_path
        
        # Call the handler
        file_change_handler.on_modified(mock_event)
        
        # Verify no message was published
        channel.basic_publish.assert_not_called()


def test_ignores_directories(file_change_handler, mock_rabbitmq_connection):
    """Test that directories are ignored."""
    _, channel = mock_rabbitmq_connection
    
    # Create a mock event for a directory
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = True
    mock_event.src_path = "/codebase/test_dir"
    
    # Call the handler
    file_change_handler.on_modified(mock_event)
    
    # Verify no message was published
    channel.basic_publish.assert_not_called()


def test_deleted_events_processed(file_change_handler, mock_rabbitmq_connection):
    """Test that deleted events are processed correctly."""
    _, channel = mock_rabbitmq_connection
    
    # Create a mock delete event
    mock_event = MagicMock(spec=FileDeletedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/test_file.py"
    
    # Mock Path.resolve, Path.relative_to, and _should_ignore_path
    with patch('main.Path') as mock_path, \
         patch.object(file_change_handler, '_should_ignore_path', return_value=False):
        
        # Create a mock path object with proper string representation
        mock_rel_path = MagicMock()
        mock_rel_path.__str__.return_value = "test_file.py"
        mock_path.return_value.relative_to.return_value = mock_rel_path
        
        # Call the handler
        file_change_handler.on_deleted(mock_event)
        
        # Verify message was published with correct format
        expected_message = {
            "file_path": "test_file.py",
            "event_type": "DELETED"
        }
        
        channel.basic_publish.assert_called_once_with(
            exchange='',
            routing_key=main.RABBITMQ_QUEUE,
            body=json.dumps(expected_message),
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type='application/json'
            )
        )


def test_exception_handling(file_change_handler, mock_rabbitmq_connection):
    """Test that exceptions are properly handled."""
    # Create a mock event
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/test_file.py"
    
    # Mock Path.resolve to raise an exception
    with patch('main.Path') as mock_path, \
         patch('main.logger') as mock_logger:
        mock_path.return_value.resolve.side_effect = Exception("Test exception")
        
        # Call the handler
        file_change_handler.on_modified(mock_event)
        
        # Verify error was logged
        mock_logger.error.assert_called_once()
        assert "Test exception" in str(mock_logger.error.call_args)


def test_should_ignore_path():
    """Test that paths matching ignored patterns are ignored."""
    # Create a handler with mocked connection
    mock_connection = MagicMock()
    handler = main.FileChangeHandler(mock_connection)
    
    # Test with various paths
    # Should ignore
    assert handler._should_ignore_path("/codebase/node_modules/test.py") is True
    assert handler._should_ignore_path("/codebase/src/.git/config") is True
    assert handler._should_ignore_path("/codebase/__pycache__/test.py") is True
    assert handler._should_ignore_path("/codebase/venv/lib/python3.8") is True
    
    # Should not ignore
    assert handler._should_ignore_path("/codebase/src/main.py") is False
    assert handler._should_ignore_path("/codebase/tests/test_main.py") is False


def test_debounce_logic():
    """Test that events are debounced correctly."""
    # Create a handler with mocked connection
    mock_connection = MagicMock()
    handler = main.FileChangeHandler(mock_connection)
    
    # Test file path
    file_path = "/codebase/src/test.py"
    
    # First event for a file should not be processed immediately
    assert handler._should_process_now(file_path, "MODIFIED") is False
    
    # Second event within debounce period should not be processed
    assert handler._should_process_now(file_path, "MODIFIED") is False
    
    # Simulate time passing
    original_time = time.time
    try:
        # Mock time.time to return a time after the debounce period
        with patch('time.time') as mock_time:
            # Set time to be after debounce period (DEBOUNCE_MS milliseconds later)
            mock_time.return_value = original_time() + (main.DEBOUNCE_MS / 1000) + 0.1
            
            # Now the event should be processed
            assert handler._should_process_now(file_path, "MODIFIED") is True
    finally:
        # Restore original time function
        time.time = original_time
    
    # DELETE events should always be processed immediately
    new_file = "/codebase/src/another.py"
    assert handler._should_process_now(new_file, "DELETED") is True


def test_integration_with_ignored_patterns_and_debounce():
    """Test the integration of ignored patterns and debounce logic."""
    # Create a handler with mocked connection and channel
    mock_connection = MagicMock()
    mock_channel = MagicMock()
    mock_connection.channel.return_value = mock_channel
    
    handler = main.FileChangeHandler(mock_connection)
    
    # Create a mock event for a file in an ignored directory
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/node_modules/test.py"
    
    # Mock Path.resolve
    with patch('main.Path') as mock_path:
        mock_resolved_path = MagicMock()
        mock_resolved_path.suffix = '.py'
        mock_path.return_value.resolve.return_value = mock_resolved_path
        
        # Call the handler
        handler._process_event(mock_event, "MODIFIED")
        
        # Verify no message was published (due to ignored pattern)
        mock_channel.basic_publish.assert_not_called()
    
    # Create a mock event for a valid file
    mock_event = MagicMock(spec=FileModifiedEvent)
    mock_event.is_directory = False
    mock_event.src_path = "/codebase/src/test.py"
    
    # Mock Path.resolve and Path.relative_to
    with patch('main.Path') as mock_path:
        mock_resolved_path = MagicMock()
        mock_resolved_path.suffix = '.py'
        mock_resolved_path.relative_to.return_value = Path("src/test.py")
        mock_path.return_value.resolve.return_value = mock_resolved_path
        
        # First call should not publish (due to debounce)
        handler._process_event(mock_event, "MODIFIED")
        mock_channel.basic_publish.assert_not_called()
        
        # Simulate time passing beyond debounce period
        original_time = time.time
        try:
            with patch('time.time') as mock_time:
                # Set time to be after debounce period
                mock_time.return_value = original_time() + (main.DEBOUNCE_MS / 1000) + 0.1
                
                # Second call should publish (enough time has passed)
                handler._process_event(mock_event, "MODIFIED")
                mock_channel.basic_publish.assert_called_once()
        finally:
            # Restore original time function
            time.time = original_time