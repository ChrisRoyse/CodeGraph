# Use the official Joern base image
FROM ghcr.io/joernio/joern:nightly

# Set environment variable for Java options if needed (adjust memory as necessary)
ENV _JAVA_OPTS="-Xmx4g"

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY joern_analysis_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Note: Attempt to install grpc_health_probe removed as base image package manager is unknown.
# Healthcheck is disabled in docker-compose.yml.

# Copy generated protobuf code first
COPY generated/src/joern_analysis_pb2.py .
COPY generated/src/joern_analysis_pb2_grpc.py .

# Copy only the application code for this service
COPY joern_analysis_service/ .

# Expose the gRPC port
EXPOSE 50053

# Command to run the gRPC server
CMD ["python", "main.py"]