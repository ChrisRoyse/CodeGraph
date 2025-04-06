# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container at /app
COPY . .

# Make port 50051 available to the world outside this container (as defined in docker-compose.yml)
# Note: This is informational; the actual port mapping is done in docker-compose.yml
EXPOSE 50051

# Define environment variable (can be overridden by docker-compose)
ENV GRPC_PORT=50051

# Run main.py when the container launches
CMD ["python", "main.py"]