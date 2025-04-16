FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Set environment variables
ENV PYTHONUNBUFFERED=1

# No ports exposed as this service primarily uses RabbitMQ

# Set default command for development
CMD ["python", "main.py"]