#!/usr/bin/env python3
"""
Integration Test Client for ID Service

This script tests the ID Service's gRPC API by connecting to a running
ID Service instance and testing both GenerateId and ParseId RPCs with
various inputs to verify the service is working correctly.
"""

import os
import sys
import json
import grpc
import argparse
from pathlib import Path

# Add the project root to the Python path to import the generated protobuf modules
sys.path.append(str(Path(__file__).parent.parent))

# Import the generated protobuf modules
try:
    from shared.proto import id_service_pb2, id_service_pb2_grpc
except ImportError:
    print("Error: Proto files not compiled. Please run the proto compilation script first.")
    print("Hint: You may need to run 'python -m scripts.proto.compile_python'")
    sys.exit(1)

# Configuration
DEFAULT_HOST = os.environ.get("ID_SERVICE_HOST", "localhost")
DEFAULT_PORT = os.environ.get("ID_SERVICE_PORT", "50051")

# Test cases for GenerateId
GENERATE_ID_TEST_CASES = [
    {
        "name": "Basic Function",
        "request": {
            "file_path": "src/app.js",
            "entity_type": "Function",
            "name": "calculateTotal"
        }
    },
    {
        "name": "Function with Parameters",
        "request": {
            "file_path": "src/app.js",
            "entity_type": "Function",
            "name": "calculateTotal",
            "param_types": ["number", "number"]
        }
    },
    {
        "name": "Class Method",
        "request": {
            "file_path": "src/models/user.ts",
            "entity_type": "Method",
            "name": "getUserById",
            "parent_canonical_id": "src/models/user.ts::Class::User",
            "param_types": ["string"]
        }
    },
    {
        "name": "Python Function",
        "request": {
            "file_path": "src/utils.py",
            "entity_type": "Function",
            "name": "process_data",
            "language_hint": "python"
        }
    },
    {
        "name": "File Entity",
        "request": {
            "file_path": "src/index.html",
            "entity_type": "File",
            "name": "index.html",
            "language_hint": "html"
        }
    },
    {
        "name": "SQL Table",
        "request": {
            "file_path": "db/schema.sql",
            "entity_type": "Table",
            "name": "users",
            "language_hint": "sql"
        }
    },
    {
        "name": "SQL Column",
        "request": {
            "file_path": "db/schema.sql",
            "entity_type": "Column",
            "name": "email",
            "parent_canonical_id": "db/schema.sql::Table::users",
            "language_hint": "sql"
        }
    },
    {
        "name": "React Component",
        "request": {
            "file_path": "src/components/Button.jsx",
            "entity_type": "Component",
            "name": "Button",
            "language_hint": "jsx"
        }
    },
    {
        "name": "CSS Rule",
        "request": {
            "file_path": "src/styles/main.css",
            "entity_type": "Rule",
            "name": ".container",
            "language_hint": "css"
        }
    },
    {
        "name": "Edge Case: Special Characters",
        "request": {
            "file_path": "src/utils.js",
            "entity_type": "Function",
            "name": "handle$special-chars!"
        }
    }
]

# Error test cases for GenerateId
GENERATE_ID_ERROR_CASES = [
    {
        "name": "Missing file_path",
        "request": {
            "entity_type": "Function",
            "name": "myFunction"
        }
    },
    {
        "name": "Missing entity_type",
        "request": {
            "file_path": "src/app.js",
            "name": "myFunction"
        }
    },
    {
        "name": "Missing name",
        "request": {
            "file_path": "src/app.js",
            "entity_type": "Function"
        }
    },
    {
        "name": "Invalid entity_type",
        "request": {
            "file_path": "src/app.js",
            "entity_type": "InvalidType",
            "name": "myFunction"
        }
    }
]

# Error test cases for ParseId
PARSE_ID_ERROR_CASES = [
    {
        "name": "Empty ID string",
        "request": {"id_string": ""}
    },
    {
        "name": "Invalid ID format",
        "request": {"id_string": "not-a-valid-id"}
    }
]


def create_generate_id_request(data):
    """Create a GenerateIdRequest from a dictionary"""
    request = id_service_pb2.GenerateIdRequest(
        file_path=data.get("file_path", ""),
        entity_type=data.get("entity_type", ""),
        name=data.get("name", "")
    )
    
    if "parent_canonical_id" in data:
        request.parent_canonical_id = data["parent_canonical_id"]
    
    if "param_types" in data:
        request.param_types.extend(data["param_types"])
    
    if "language_hint" in data:
        request.language_hint = data["language_hint"]
    
    return request


def create_parse_id_request(data):
    """Create a ParseIdRequest from a dictionary"""
    return id_service_pb2.ParseIdRequest(id_string=data.get("id_string", ""))


def message_to_dict(message):
    """Convert a protobuf message to a dictionary"""
    return json.loads(grpc.protobuf.json_format.MessageToJson(
        message, 
        preserving_proto_field_name=True,
        including_default_value_fields=True
    ))


def run_tests(host, port, verbose=False):
    """Run all tests against the ID Service"""
    # Create a gRPC channel
    channel = grpc.insecure_channel(f"{host}:{port}")
    
    # Create a stub (client)
    stub = id_service_pb2_grpc.IdServiceStub(channel)
    
    print(f"\nConnecting to ID Service at {host}:{port}...\n")
    
    # Test results storage
    generated_ids = []
    success_count = 0
    failure_count = 0
    
    # Test GenerateId RPC
    print("=== Testing GenerateId RPC ===\n")
    
    for test_case in GENERATE_ID_TEST_CASES:
        print(f"Test Case: {test_case['name']}")
        print(f"Request: {json.dumps(test_case['request'], indent=2)}")
        
        try:
            # Create the request
            request = create_generate_id_request(test_case["request"])
            
            # Call the RPC
            response = stub.GenerateId(request)
            
            # Convert response to dictionary for pretty printing
            response_dict = message_to_dict(response)
            print(f"Response: {json.dumps(response_dict, indent=2)}")
            
            # Store the generated IDs for testing ParseId
            generated_ids.append({
                "name": test_case["name"],
                "canonical_id": response.canonical_id,
                "gid": response.gid
            })
            
            print("✓ Test passed\n")
            success_count += 1
        except grpc.RpcError as e:
            print(f"✗ Test failed: {e.details()}\n")
            failure_count += 1
    
    # Test error cases for GenerateId
    print("=== Testing GenerateId Error Cases ===\n")
    
    for error_case in GENERATE_ID_ERROR_CASES:
        print(f"Error Case: {error_case['name']}")
        print(f"Request: {json.dumps(error_case['request'], indent=2)}")
        
        try:
            # Create the request
            request = create_generate_id_request(error_case["request"])
            
            # Call the RPC
            response = stub.GenerateId(request)
            
            # Convert response to dictionary for pretty printing
            response_dict = message_to_dict(response)
            print(f"Unexpected success: {json.dumps(response_dict, indent=2)}")
            print("✗ Test failed: Expected an error\n")
            failure_count += 1
        except grpc.RpcError as e:
            print(f"Expected error: {e.details()}")
            print("✓ Test passed\n")
            success_count += 1
    
    # Test ParseId RPC
    print("=== Testing ParseId RPC ===\n")
    
    # Test parsing the generated canonical IDs
    for id_info in generated_ids:
        print(f"Test Case: Parse Canonical ID from \"{id_info['name']}\"")
        print(f"Request: {{ \"id_string\": \"{id_info['canonical_id']}\" }}")
        
        try:
            # Create the request
            request = create_parse_id_request({"id_string": id_info["canonical_id"]})
            
            # Call the RPC
            response = stub.ParseId(request)
            
            # Convert response to dictionary for pretty printing
            response_dict = message_to_dict(response)
            print(f"Response: {json.dumps(response_dict, indent=2)}")
            
            print("✓ Test passed\n")
            success_count += 1
        except grpc.RpcError as e:
            print(f"✗ Test failed: {e.details()}\n")
            failure_count += 1
    
    # Test parsing the generated GIDs
    for id_info in generated_ids:
        print(f"Test Case: Parse GID from \"{id_info['name']}\"")
        print(f"Request: {{ \"id_string\": \"{id_info['gid']}\" }}")
        
        try:
            # Create the request
            request = create_parse_id_request({"id_string": id_info["gid"]})
            
            # Call the RPC
            response = stub.ParseId(request)
            
            # Convert response to dictionary for pretty printing
            response_dict = message_to_dict(response)
            print(f"Response: {json.dumps(response_dict, indent=2)}")
            
            print("✓ Test passed\n")
            success_count += 1
        except grpc.RpcError as e:
            print(f"✗ Test failed: {e.details()}\n")
            failure_count += 1
    
    # Test error cases for ParseId
    print("=== Testing ParseId Error Cases ===\n")
    
    for error_case in PARSE_ID_ERROR_CASES:
        print(f"Error Case: {error_case['name']}")
        print(f"Request: {json.dumps(error_case['request'], indent=2)}")
        
        try:
            # Create the request
            request = create_parse_id_request(error_case["request"])
            
            # Call the RPC
            response = stub.ParseId(request)
            
            # Convert response to dictionary for pretty printing
            response_dict = message_to_dict(response)
            print(f"Unexpected success: {json.dumps(response_dict, indent=2)}")
            print("✗ Test failed: Expected an error\n")
            failure_count += 1
        except grpc.RpcError as e:
            print(f"Expected error: {e.details()}")
            print("✓ Test passed\n")
            success_count += 1
    
    # Print test summary
    print("=== Test Summary ===\n")
    print(f"Tests passed: {success_count}")
    print(f"Tests failed: {failure_count}")
    print(f"Total tests: {success_count + failure_count}")
    
    return success_count, failure_count


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Test the ID Service gRPC API")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"ID Service host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", default=DEFAULT_PORT, help=f"ID Service port (default: {DEFAULT_PORT})")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose output")
    
    args = parser.parse_args()
    
    try:
        success_count, failure_count = run_tests(args.host, args.port, args.verbose)
        
        # Exit with non-zero status if any tests failed
        if failure_count > 0:
            sys.exit(1)
    except Exception as e:
        print(f"Error running tests: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()