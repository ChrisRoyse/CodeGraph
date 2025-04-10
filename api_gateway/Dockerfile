# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
# Copy only this service's requirements file
COPY api_gateway/requirements.txt .

# Install any needed packages specified in requirements.txt
# Assuming FastAPI/Uvicorn based on typical Python API gateways
RUN pip install --no-cache-dir -r requirements.txt


# Copy protobuf definitions
COPY protobufs /app/protobufs

# Generate gRPC code
# Create the target directory structure including __init__.py files
# Generate gRPC code to a temporary location
RUN mkdir -p /tmp/generated/src && \
    touch /tmp/generated/__init__.py && \
    touch /tmp/generated/src/__init__.py && \
    python -m grpc_tools.protoc \
        -I=/app/protobufs \
        --python_out=/tmp/generated/src \
        --grpc_python_out=/tmp/generated/src \
        /app/protobufs/*.proto


# Copy the rest of the application code into the container at /app
# Copy only this service's source code
# Copy the api_gateway source code FIRST
COPY api_gateway/ /app/api_gateway/
# Ensure the __init__.py exists for the package
# Copy the generated code structure to the final location (/app/generated)
RUN cp -r /tmp/generated /app/
# Clean up temporary generated files
RUN rm -rf /tmp/generated

# Make port 8000 available (as defined in docker-compose.yml)

# Define environment variable (can be overridden by docker-compose)
# ENV HTTP_PORT is now set via docker-compose.yml

# Ensure the working directory is in the Python path for imports
ENV PYTHONPATH=/app:/app/generated:/app/generated/src

# Run the API server using uvicorn (adjust if using a different server like gunicorn)
# Assumes main.py contains the FastAPI app instance named 'app'
# Use shell form to allow environment variable expansion for the port
# Run the main script directly using python -m; it will start uvicorn internally
CMD ["uvicorn", "api_gateway.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]