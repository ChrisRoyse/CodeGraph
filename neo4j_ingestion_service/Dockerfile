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

# Make port 50053 available (as defined in docker-compose.yml)
EXPOSE 50053

# Define environment variable (can be overridden by docker-compose)
ENV GRPC_PORT=50053

# Run main.py when the container launches
CMD ["python", "main.py"]