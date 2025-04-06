import pytest
import json
from unittest.mock import patch, mock_open, MagicMock

import sys
import sqlparse
import os

# Add project root to path to find generated files
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, project_root)

from sql_analysis_service import main as sql_service
try:
    # Import generated protobuf code
    from generated.src import sql_analysis_pb2
    from generated.src import sql_analysis_pb2_grpc
except ImportError:
    pytest.fail("Failed to import generated gRPC modules. Run generate_grpc.sh.")

# Use actual generated classes
SqlAnalysisRequest = sql_analysis_pb2.SqlAnalysisRequest
SqlAnalysisResponse = sql_analysis_pb2.SqlAnalysisResponse
AnalysisStatus = sql_analysis_pb2.AnalysisStatus

class MockContext:
    def abort(self, code, details):
        # In a real test, you might want to record the abort call
        # For now, raise an exception to signal failure like the real context might
        raise grpc.RpcError(f"Mock Abort: {code} - {details}")

@pytest.fixture
def servicer():
    """Fixture to create an instance of the SqlAnalysisServicer."""
    # Use the actual class name from main.py
    return sql_service.SqlAnalysisServicer()

# --- Test Cases ---

# Mocking sqlparse requires a bit more detail to simulate token iteration
def create_mock_statement(sql_type='SELECT', tokens=None):
    """Helper to create a mock sqlparse statement."""
    stmt = MagicMock()
    stmt.get_type.return_value = sql_type

    # Simulate the flatten() behavior needed by extract_tables_from_statement
    if tokens is None:
         # Default tokens for "SELECT * FROM users"
         tokens = [
             MagicMock(ttype=sqlparse.tokens.Keyword, value='SELECT'),
             MagicMock(ttype=sqlparse.tokens.Wildcard, value='*'),
             MagicMock(ttype=sqlparse.tokens.Keyword, value='FROM'),
             MagicMock(ttype=None, value=' '), # sqlparse includes whitespace tokens
             MagicMock(spec=sqlparse.sql.Identifier, get_real_name=lambda: 'users', ttype=sqlparse.tokens.Name),
             MagicMock(ttype=sqlparse.tokens.Punctuation, value=';')
         ]
    # Configure flatten to return our list of mock tokens
    stmt.flatten.return_value = tokens
    # Also need token_first for the check in main.py
    stmt.token_first.return_value = tokens[0] if tokens else None
    return stmt

@patch("builtins.open", new_callable=mock_open, read_data="SELECT * FROM users;")
@patch("sqlparse.parse") # We'll configure the return value inside the test
@patch("os.path.exists", return_value=True) # Assume file exists for this test
def test_analyze_sql_simple_select(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with a simple SELECT statement.
    """
    # --- Arrange ---
    # Configure the mock for sqlparse.parse
    mock_statement = create_mock_statement(sql_type='SELECT')
    mock_sqlparse.return_value = [mock_statement]

    request = SqlAnalysisRequest(file_path="dummy/path/select.sql")
    context = MockContext() # Using the refined MockContext

    # --- Act ---
    response = servicer.AnalyzeSql(request, context) # Call the actual method

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/select.sql")
    mock_file_open.assert_called_once_with("dummy/path/select.sql", 'r', encoding='utf-8')
    mock_sqlparse.assert_called_once_with("SELECT * FROM users;")

    assert response.status == AnalysisStatus.SUCCESS
    assert response.analysis_results_json is not None


@patch("os.path.exists", return_value=False) # Simulate file not existing
def test_analyze_sql_file_not_found(mock_exists, servicer):
    """
    Test AnalyzeSql when the requested file does not exist.
    """
    # --- Arrange ---
    request = SqlAnalysisRequest(file_path="non/existent/file.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("non/existent/file.sql")
    assert response.status == AnalysisStatus.FAILED
    assert response.analysis_results_json is not None



@patch("builtins.open", new_callable=mock_open, read_data="CREATE TABLE products (id INT, name VARCHAR(100));")
@patch("sqlparse.parse")
@patch("os.path.exists", return_value=True)
def test_analyze_sql_create_table(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with a simple CREATE TABLE statement.
    """
    # --- Arrange ---
    # Mock tokens for CREATE TABLE (simplified, focus on type)
    mock_tokens = [
        MagicMock(ttype=sqlparse.tokens.Keyword.DDL, value='CREATE'),
        MagicMock(ttype=sqlparse.tokens.Keyword, value='TABLE'),
        MagicMock(ttype=None, value=' '), 
        MagicMock(spec=sqlparse.sql.Identifier, get_real_name=lambda: 'products', ttype=sqlparse.tokens.Name),
        # ... other tokens for columns etc. - not strictly needed for type check
        MagicMock(ttype=sqlparse.tokens.Punctuation, value=';')
    ]
    mock_statement = create_mock_statement(sql_type='CREATE', tokens=mock_tokens)
    mock_sqlparse.return_value = [mock_statement]

    request = SqlAnalysisRequest(file_path="dummy/path/create.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/create.sql")


@patch("builtins.open", new_callable=mock_open, read_data="INSERT INTO users (name, email) VALUES ('Test', 'test@example.com');")
@patch("sqlparse.parse")
@patch("os.path.exists", return_value=True)
def test_analyze_sql_insert(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with a simple INSERT statement.
    """
    # --- Arrange ---
    # Mock tokens for INSERT INTO (simplified)
    mock_tokens = [
        MagicMock(ttype=sqlparse.tokens.Keyword.DML, value='INSERT'),
        MagicMock(ttype=sqlparse.tokens.Keyword, value='INTO'),
        MagicMock(ttype=None, value=' '), 
        MagicMock(spec=sqlparse.sql.Identifier, get_real_name=lambda: 'users', ttype=sqlparse.tokens.Name),
        # ... other tokens ...
        MagicMock(ttype=sqlparse.tokens.Punctuation, value=';')
    ]
    mock_statement = create_mock_statement(sql_type='INSERT', tokens=mock_tokens)
    mock_sqlparse.return_value = [mock_statement]

    request = SqlAnalysisRequest(file_path="dummy/path/insert.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/insert.sql")


@patch("builtins.open", new_callable=mock_open, read_data="CREATE TABLE t1 (id INT);\nINSERT INTO t1 (id) VALUES (1);")
@patch("sqlparse.parse")
@patch("os.path.exists", return_value=True)
def test_analyze_sql_multiple_statements(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with multiple statements in one file.
    """
    # --- Arrange ---
    # Mock tokens for CREATE
    create_tokens = [
        MagicMock(ttype=sqlparse.tokens.Keyword.DDL, value='CREATE'),
        MagicMock(ttype=sqlparse.tokens.Keyword, value='TABLE'),
        MagicMock(ttype=None, value=' '), 
        MagicMock(spec=sqlparse.sql.Identifier, get_real_name=lambda: 't1', ttype=sqlparse.tokens.Name),
        MagicMock(ttype=sqlparse.tokens.Punctuation, value=';')
    ]
    # Mock tokens for INSERT
    insert_tokens = [
        MagicMock(ttype=sqlparse.tokens.Keyword.DML, value='INSERT'),
        MagicMock(ttype=sqlparse.tokens.Keyword, value='INTO'),
        MagicMock(ttype=None, value=' '), 
        MagicMock(spec=sqlparse.sql.Identifier, get_real_name=lambda: 't1', ttype=sqlparse.tokens.Name),
        MagicMock(ttype=sqlparse.tokens.Punctuation, value=';')
    ]

    mock_stmt_create = create_mock_statement(sql_type='CREATE', tokens=create_tokens)
    mock_stmt_insert = create_mock_statement(sql_type='INSERT', tokens=insert_tokens)
    mock_sqlparse.return_value = [mock_stmt_create, mock_stmt_insert]

    request = SqlAnalysisRequest(file_path="dummy/path/multiple.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/multiple.sql")
    mock_file_open.assert_called_once_with("dummy/path/multiple.sql", 'r', encoding='utf-8')
    mock_sqlparse.assert_called_once_with("CREATE TABLE t1 (id INT);\nINSERT INTO t1 (id) VALUES (1);")


@patch("builtins.open", new_callable=mock_open, read_data="") # Empty file content
@patch("sqlparse.parse", return_value=[]) # sqlparse returns empty list for empty input
@patch("os.path.exists", return_value=True)
def test_analyze_sql_empty_file(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with an empty input file.
    """
    # --- Arrange ---
    request = SqlAnalysisRequest(file_path="dummy/path/empty.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/empty.sql")
    mock_file_open.assert_called_once_with("dummy/path/empty.sql", 'r', encoding='utf-8')
    mock_sqlparse.assert_called_once_with("")


@patch("builtins.open", new_callable=mock_open, read_data="-- This is a comment\n-- Another comment")
@patch("sqlparse.parse") # Mock sqlparse
@patch("os.path.exists", return_value=True)
def test_analyze_sql_comments_only(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql with a file containing only comments.
    """
    # --- Arrange ---
    # sqlparse might return an empty list or statements containing only comments.
    # Let's assume it returns an empty list for simplicity in this mock setup.
    # A more precise mock might return statement objects containing only comment tokens.
    mock_sqlparse.return_value = [] 

    request = SqlAnalysisRequest(file_path="dummy/path/comments.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/comments.sql")


@patch("builtins.open", new_callable=mock_open, read_data="SELECT * FROM table WHERE; -- Invalid SQL")
@patch("sqlparse.parse", side_effect=Exception("Simulated parsing error")) # Make parse raise an error
@patch("os.path.exists", return_value=True)
def test_analyze_sql_parse_error(mock_exists, mock_sqlparse, mock_file_open, servicer):
    """
    Test AnalyzeSql when sqlparse raises an exception during parsing.
    """
    # --- Arrange ---
    request = SqlAnalysisRequest(file_path="dummy/path/invalid.sql")
    context = MockContext()

    # --- Act ---
    response = servicer.AnalyzeSql(request, context)

    # --- Assert ---
    mock_exists.assert_called_once_with("dummy/path/invalid.sql")
    mock_file_open.assert_called_once_with("dummy/path/invalid.sql", 'r', encoding='utf-8')
    mock_sqlparse.assert_called_once_with("SELECT * FROM table WHERE; -- Invalid SQL")

    assert response.status == AnalysisStatus.FAILED
    results = json.loads(response.analysis_results_json)
    assert "error" in results
    assert "internal error occurred" in results["error"].lower()
    assert "Simulated parsing error" in results["error"] # Check if the original error message is included

    mock_file_open.assert_called_once_with("dummy/path/invalid.sql", 'r', encoding='utf-8')
    mock_sqlparse.assert_called_once_with("SELECT * FROM table WHERE; -- Invalid SQL")

    assert response.status == AnalysisStatus.FAILED
    results = json.loads(response.analysis_results_json)









    # Current extract_tables_from_statement looks for FROM/JOIN, so it won't find 'products'

    # Check the error message in the JSON
    results = json.loads(response.analysis_results_json)
    assert "error" in results


    # Parse the JSON response for detailed checks
    results = json.loads(response.analysis_results_json)

# TODO: Add more tests here for:
# - CREATE TABLE statements (verify table name extraction)
# - INSERT statements (verify table name extraction)
# - Statements with JOINs (verify multiple table extraction)
# - Multiple statements in one file
# - File not found error (using mock_exists)
# - Empty file
# - File with only comments
# - Invalid SQL (how does sqlparse handle it? Does the service need specific error handling?)
# - JSON serialization errors (though less likely with simple structures)