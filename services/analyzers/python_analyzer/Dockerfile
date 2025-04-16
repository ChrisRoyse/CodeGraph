FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY services/analyzers/python_analyzer/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --upgrade --force-reinstall protobuf

# Copy python_analyzer source code
COPY services/analyzers/python_analyzer/ .
# Copy shared directory from project root
COPY shared ./shared

# DEBUG: List contents of /app/generated
RUN ls -l /app/generated || true

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH="/app/generated:/app"

# No ports exposed as this service primarily uses RabbitMQ

# Set default command for development
CMD ["python", "main.py"]