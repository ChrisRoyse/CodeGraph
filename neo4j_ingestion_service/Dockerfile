# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
# Copy only this service's requirements file
COPY neo4j_ingestion_service/requirements.txt .

# Install build dependencies for psycopg2
RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev && rm -rf /var/lib/apt/lists/*

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
RUN ls -l /app/generated/src


# Copy only this service's source code
# Ensure any old resolver.py is removed before copying
RUN rm -f resolver.py

COPY neo4j_ingestion_service/ /app/neo4j_ingestion_service/

# Make port 50053 available (as defined in docker-compose.yml)
EXPOSE 50053

# Define environment variable (can be overridden by docker-compose)
ENV GRPC_PORT=50053
ENV PYTHONPATH=/app:/app/generated/src



# Run main.py when the container launches
# Run the main script which now orchestrates resolve -> fetch -> ingest
CMD ["python", "-u", "-m", "neo4j_ingestion_service.main"]