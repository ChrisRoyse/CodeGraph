# python_analyzer_service/Dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install git (needed for tree-sitter grammar installation) and build essentials
RUN apt-get update && apt-get install -y --no-install-recommends git build-essential && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY python_analyzer_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy protobuf definitions (assuming they are needed for response generation eventually)
COPY protobufs /app/protobufs

# Generate gRPC code (adjust paths as necessary if protos change)
# Create the target directory structure including __init__.py files
# Create the target directory structure including __init__.py files and generate gRPC code
RUN mkdir -p /app/generated/src && \
    touch /app/generated/__init__.py && \
    touch /app/generated/src/__init__.py && \
    python -m grpc_tools.protoc \
        -I=/app/protobufs \
        --python_out=/app/generated/src \
        --grpc_python_out=/app/generated/src \
        /app/protobufs/analyzer.proto

# Install tree-sitter library and Python grammar
# RUN pip install --no-cache-dir tree-sitter==0.20.4 # Use a specific version if needed
# RUN tree-sitter-languages install python # Or install via pip if available as a package

# Copy the rest of the service code
COPY python_analyzer_service/. .

# Expose the gRPC port (choose a unique one, e.g., 50056)
EXPOSE 50056

# Define environment variable for the port
ENV GRPC_PORT=50056
# Ensure generated code and service code are importable
ENV PYTHONPATH=/app

# Run the gRPC server
CMD ["python", "main.py"]