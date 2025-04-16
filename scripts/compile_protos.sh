#!/bin/bash
# Main script to compile Protocol Buffer definitions into language-specific code
# This script runs both Python and Node.js compilation scripts
# Can be used in development and CI/CD

set -e  # Exit immediately if a command exits with a non-zero status

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "=== BMCP Realtime Protocol Buffer Compilation ==="
echo "Project root: $PROJECT_ROOT"
echo ""

# Check if required tools are installed
check_dependencies() {
  echo "Checking dependencies..."
  
  # Check Python dependencies
  if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is not installed or not in PATH"
    exit 1
  fi
  
  # Check if grpcio-tools is installed
  if ! python3 -c "import grpc_tools.protoc" &> /dev/null; then
    echo "Error: grpcio-tools is not installed. Install with: pip install grpcio-tools"
    exit 1
  fi
  
  # Check Node.js dependencies
  if ! command -v node &> /dev/null; then
    echo "Error: node is not installed or not in PATH"
    exit 1
  fi
  
  # Check if grpc-tools is installed
  if ! command -v grpc_tools_node_protoc &> /dev/null; then
    echo "Error: grpc-tools is not installed. Install with: npm install -g grpc-tools"
    exit 1
  fi
  
  echo "All dependencies are installed."
  echo ""
}

# Compile Python code
compile_python() {
  echo "=== Compiling Protocol Buffers for Python ==="
  python3 "$SCRIPT_DIR/proto/compile_python.py"
  
  if [ $? -ne 0 ]; then
    echo "Error: Python compilation failed"
    exit 1
  fi
  
  echo "Python compilation completed successfully."
  echo ""
}

# Compile Node.js code
compile_node() {
  echo "=== Compiling Protocol Buffers for Node.js ==="
  node "$SCRIPT_DIR/proto/compile_node.js"
  
  if [ $? -ne 0 ]; then
    echo "Error: Node.js compilation failed"
    exit 1
  fi
  
  echo "Node.js compilation completed successfully."
  echo ""
}

# Main function
main() {
  check_dependencies
  compile_python
  compile_node
  
  echo "=== All Protocol Buffer compilations completed successfully ==="
}

# Run the main function
main