#!/bin/bash

# Define directories
PROTO_DIR=protobufs
OUTPUT_DIR=generated/src # Outputting to a src subdir for better structure

# Create the output directory if it doesn't exist
mkdir -p ${OUTPUT_DIR}

# Generate Python gRPC code
echo "Generating Python gRPC code..."
python -m grpc_tools.protoc \
    -I${PROTO_DIR} \
    --python_out=${OUTPUT_DIR} \
    --pyi_out=${OUTPUT_DIR} \
    --grpc_python_out=${OUTPUT_DIR} \
    ${PROTO_DIR}/analyzer.proto \
    ${PROTO_DIR}/code_fetcher.proto \
    ${PROTO_DIR}/joern_analysis.proto \
    ${PROTO_DIR}/neo4j_ingestion.proto \
    ${PROTO_DIR}/sql_analysis.proto

# Create __init__.py files to make the generated code importable as packages
echo "Creating __init__.py files..."
touch ${OUTPUT_DIR}/__init__.py

# Convert absolute imports to relative imports in *_pb2_grpc.py files
echo "Converting imports in *_pb2_grpc.py files to relative..."
# Use find and sed to perform the replacement. Handle potential macOS sed differences if needed.
find ${OUTPUT_DIR} -name '*_pb2_grpc.py' -exec sed -i -E 's/^import (.+_pb2.*)/from . import \1/' {} \;

# If packages are generated within subdirs based on proto packages, add init files there too
# Example: find ${OUTPUT_DIR} -type d -exec touch {}/__init__.py \;

# Add a basic setup.py to potentially install the generated code as a package
echo "Creating basic setup.py for generated code..."
cat << EOF > generated/setup.py
from setuptools import setup, find_packages

setup(
    name='bmcp_grpc_generated',
    version='0.1.0',
    packages=find_packages(where='src'),
    package_dir={'': 'src'},
    install_requires=[
        'grpcio',
        'protobuf',
    ],
    # Add grpcio-tools only if needed at runtime, usually it's a build dependency
)
EOF

echo "Done."

# Instructions:
# 1. Ensure you have Python and pip installed.
# 2. Install grpcio-tools: pip install grpcio-tools
# 3. Run this script from the project root: ./generate_grpc.sh
# 4. The generated Python code will be in the 'generated/src/' directory.
# 5. You can potentially install this as a package using 'pip install ./generated'
#    or add 'generated/src' to your PYTHONPATH for services to import.