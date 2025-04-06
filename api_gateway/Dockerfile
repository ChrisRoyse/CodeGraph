# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# Assuming FastAPI/Uvicorn based on typical Python API gateways
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container at /app
COPY . .

# Make port 8000 available (as defined in docker-compose.yml)
EXPOSE 8000

# Define environment variable (can be overridden by docker-compose)
ENV HTTP_PORT=8000

# Run the API server using uvicorn (adjust if using a different server like gunicorn)
# Assumes main.py contains the FastAPI app instance named 'app'
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]