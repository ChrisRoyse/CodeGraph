# python_app_service/Dockerfile
FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY python_app_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY python_app_service/. .

# Expose port (if needed, e.g., for a web framework like Flask/FastAPI)
# EXPOSE 5000

# Command to run the application (adjust as needed)
CMD ["python", "main.py"]