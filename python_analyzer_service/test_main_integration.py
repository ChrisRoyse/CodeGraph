import pytest
import os
import tempfile
from unittest.mock import MagicMock, patch

# Assuming the main analysis function is in main.py and the API client in api_client.py
# Adjust imports if the structure is different
from python_analyzer_service.main import PythonAnalyzerService # Import the service class
from python_analyzer_service import api_client
from generated.src import analyzer_pb2 # Import request/response types

# Sample Python code for integration testing
SAMPLE_PYTHON_CODE = """
import sys

class Greeter:
    def __init__(self, greeting="Hello"):
        self.greeting = greeting

    def greet(self, name):
        message = f"{self.greeting}, {name}!"
        print(message)
        return message

def main_func():
    g = Greeter("Hi")
    g.greet("World")

if __name__ == "__main__":
    main_func()
"""

@pytest.fixture
def temp_py_file():
    """Creates a temporary Python file for testing."""
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as tmp_file:
        tmp_file.write(SAMPLE_PYTHON_CODE)
        file_path = tmp_file.name
    yield file_path
    os.remove(file_path) # Clean up the file afterwards

# --- Integration Tests for Main Workflow ---

@patch('python_analyzer_service.api_client.send_analysis_data')
def test_analyze_file_and_send_data_success(mock_send_data, temp_py_file):
    """
    Test the main analysis workflow: analyze a file and check the data sent to the API.
    Mocks the api_client.send_analysis_data function.
    """
    # Configure the mock API client function
    mock_send_data.return_value = True # Simulate successful API call

    # Instantiate the service
    service = PythonAnalyzerService()

    # Create a mock request
    request = analyzer_pb2.AnalyzeCodeRequest(
        file_path=temp_py_file,
        file_content=SAMPLE_PYTHON_CODE,
        language="python"
    )
    # Create a mock context (optional, depends if service uses it)
    context = MagicMock()

    # Call the AnalyzeCode method
    response = service.AnalyzeCode(request, context)

    # Assertions
    mock_send_data.assert_called_once() # Check if API client was called
    assert response.status == "SUCCESS" # Check response status

    # Get the arguments passed to the mock
    args, kwargs = mock_send_data.call_args
    sent_data = args[0] # Assuming data is the first positional argument

    # Assert that the sent data has the expected top-level keys
    assert "nodes" in sent_data, "Sent data should contain 'nodes'"
    assert "relationships" in sent_data, "Sent data should contain 'relationships'"

    # Add more specific assertions about the structure and content of nodes/relationships
    # This test will likely fail until the structure is validated correctly
    assert isinstance(sent_data["nodes"], list), "'nodes' should be a list"
    assert isinstance(sent_data["relationships"], list), "'relationships' should be a list"
    # TODO: Add more detailed assertions for the structure of sent_data["nodes"] and sent_data["relationships"]
    # Example: Check if a specific node type exists
    # has_class_node = any(n.get("node_type") == "Class" and n.get("name") == "Greeter" for n in sent_data["nodes"])
    # assert has_class_node, "Expected a 'Greeter' class node"


@patch('python_analyzer_service.api_client.send_analysis_data')
def test_analyze_file_and_send_data_api_error(mock_send_data, temp_py_file):
    """
    Test the main analysis workflow when the API call fails.
    Mocks the api_client.send_analysis_data function to raise an error.
    """
    # Configure the mock API client function to simulate failure
    mock_send_data.return_value = False # Simulate failed API call

    # Instantiate the service
    service = PythonAnalyzerService()

    # Create a mock request
    request = analyzer_pb2.AnalyzeCodeRequest(
        file_path=temp_py_file,
        file_content=SAMPLE_PYTHON_CODE,
        language="python"
    )
    # Create a mock context
    context = MagicMock()

    # Call the AnalyzeCode method
    response = service.AnalyzeCode(request, context)

    # Assert that the mocked send_analysis_data was called
    mock_send_data.assert_called_once()

    # Assertions
    mock_send_data.assert_called_once() # API client should still be called
    assert response.status == "ERROR" # Expect ERROR status in response
    assert "failed to send data to api" in response.message.lower() # Check error message (lowercase)
    # TODO: Optionally use caplog fixture to check log output for error messages