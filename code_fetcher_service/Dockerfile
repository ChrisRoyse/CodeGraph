# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
# Copy only this service's requirements file
COPY code_fetcher_service/requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy protobuf definitions
COPY protobufs /app/protobufs

# Generate gRPC code
# Create the target directory structure including __init__.py files
RUN mkdir -p /app/generated/src && \
    touch /app/generated/__init__.py && \
    touch /app/generated/src/__init__.py && \
    python -m grpc_tools.protoc \
        -I=/app/protobufs \
        --python_out=/app/generated/src \
        --grpc_python_out=/app/generated/src \
        /app/protobufs/*.proto

# Copy only this service's source code
COPY code_fetcher_service/. .
COPY code_fetcher_service/. .

# Make port 50051 available to the world outside this container (as defined in docker-compose.yml)
# Note: This is informational; the actual port mapping is done in docker-compose.yml
EXPOSE 50051

# Define environment variable (can be overridden by docker-compose)
ENV GRPC_PORT=50051

# Run main.py when the container launches
CMD ["python", "main.py"]