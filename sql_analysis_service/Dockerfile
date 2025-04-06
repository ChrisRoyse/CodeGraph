# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the current directory contents into the container at /app
COPY . .

# Make port 50054 available to the world outside this container (as defined in docker-compose.yml)
EXPOSE 50054

# Define environment variable from docker-compose.yml
ENV GRPC_PORT=50054

# Add generated protobuf code and current directory to PYTHONPATH
ENV PYTHONPATH=/app:/app/generated/src
# Run main.py when the container launches
CMD ["python", "main.py"]