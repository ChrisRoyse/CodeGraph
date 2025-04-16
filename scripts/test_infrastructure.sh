#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting CodeGraph infrastructure test...${NC}"

# Function to check if a port is open
check_port() {
  local host=$1
  local port=$2
  local service=$3
  echo -e "Testing connection to ${service} on ${host}:${port}..."
  
  # Use timeout to avoid hanging if the port is not accessible
  if timeout 5 bash -c ">/dev/tcp/${host}/${port}" 2>/dev/null; then
    echo -e "${GREEN}✓ ${service} is accessible on port ${port}${NC}"
    return 0
  else
    echo -e "${RED}✗ ${service} is not accessible on port ${port}${NC}"
    return 1
  fi
}

# Start the infrastructure in the background
echo -e "${YELLOW}Starting infrastructure services with docker-compose...${NC}"
docker-compose up -d rabbitmq neo4j postgres

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 10

# Check RabbitMQ
echo -e "\n${YELLOW}Testing RabbitMQ...${NC}"
RABBITMQ_HOST=$(grep RABBITMQ_HOST .env | cut -d '=' -f2)
RABBITMQ_PORT=$(grep RABBITMQ_PORT .env | cut -d '=' -f2)
RABBITMQ_UI_PORT=$(grep RABBITMQ_UI_PORT .env | cut -d '=' -f2)
RABBITMQ_USER=$(grep RABBITMQ_USER .env | cut -d '=' -f2)
RABBITMQ_PASSWORD=$(grep RABBITMQ_PASSWORD .env | cut -d '=' -f2)

check_port localhost $RABBITMQ_PORT "RabbitMQ AMQP"
check_port localhost $RABBITMQ_UI_PORT "RabbitMQ Management UI"

# Test RabbitMQ API
echo "Testing RabbitMQ Management API..."
if curl -s -u $RABBITMQ_USER:$RABBITMQ_PASSWORD http://localhost:$RABBITMQ_UI_PORT/api/overview | grep -q "management_version"; then
  echo -e "${GREEN}✓ RabbitMQ Management API is working${NC}"
else
  echo -e "${RED}✗ RabbitMQ Management API is not accessible${NC}"
fi

# Check Neo4j
echo -e "\n${YELLOW}Testing Neo4j...${NC}"
NEO4J_HOST=$(grep NEO4J_HOST .env | cut -d '=' -f2)
NEO4J_HTTP_PORT=$(grep NEO4J_HTTP_PORT .env | cut -d '=' -f2)
NEO4J_BOLT_PORT=$(grep NEO4J_BOLT_PORT .env | cut -d '=' -f2)

check_port localhost $NEO4J_HTTP_PORT "Neo4j HTTP"
check_port localhost $NEO4J_BOLT_PORT "Neo4j Bolt"

# Check Neo4j browser
echo "Testing Neo4j Browser..."
if curl -s http://localhost:$NEO4J_HTTP_PORT | grep -q "neo4j-web"; then
  echo -e "${GREEN}✓ Neo4j Browser is accessible${NC}"
else
  echo -e "${RED}✗ Neo4j Browser is not accessible${NC}"
fi

# Check PostgreSQL
echo -e "\n${YELLOW}Testing PostgreSQL...${NC}"
POSTGRES_HOST=$(grep POSTGRES_HOST .env | cut -d '=' -f2)
POSTGRES_PORT=$(grep POSTGRES_PORT .env | cut -d '=' -f2)
POSTGRES_USER=$(grep POSTGRES_USER .env | cut -d '=' -f2)
POSTGRES_PASSWORD=$(grep POSTGRES_PASSWORD .env | cut -d '=' -f2)
POSTGRES_DB=$(grep POSTGRES_DB .env | cut -d '=' -f2)

check_port localhost $POSTGRES_PORT "PostgreSQL"

# Test PostgreSQL connection
echo "Testing PostgreSQL connection..."
if PGPASSWORD=$POSTGRES_PASSWORD psql -h localhost -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1" > /dev/null 2>&1; then
  echo -e "${GREEN}✓ PostgreSQL connection successful${NC}"
else
  echo -e "${RED}✗ PostgreSQL connection failed${NC}"
fi

# Start application services
echo -e "\n${YELLOW}Starting application services...${NC}"
docker-compose up -d id_service file_watcher_service python_analyzer javascript_analyzer ingestion_worker api_gateway

# Wait for services to be ready
echo -e "${YELLOW}Waiting for application services to be ready...${NC}"
sleep 15

# Check ID Service
echo -e "\n${YELLOW}Testing ID Service...${NC}"
ID_SERVICE_HOST=$(grep ID_SERVICE_HOST .env | cut -d '=' -f2)
ID_SERVICE_PORT=$(grep ID_SERVICE_PORT .env | cut -d '=' -f2)

check_port localhost $ID_SERVICE_PORT "ID Service"

# Check API Gateway
echo -e "\n${YELLOW}Testing API Gateway...${NC}"
API_GATEWAY_HOST=$(grep API_GATEWAY_HOST .env | cut -d '=' -f2)
API_GATEWAY_PORT=$(grep API_GATEWAY_PORT .env | cut -d '=' -f2)

check_port localhost $API_GATEWAY_PORT "API Gateway"

# Test API Gateway health endpoint
echo "Testing API Gateway health endpoint..."
if curl -s http://localhost:$API_GATEWAY_PORT/health | grep -q "ok"; then
  echo -e "${GREEN}✓ API Gateway health check passed${NC}"
else
  echo -e "${RED}✗ API Gateway health check failed${NC}"
fi

echo -e "\n${YELLOW}Infrastructure test completed.${NC}"
echo -e "${YELLOW}You can access:${NC}"
echo -e "- RabbitMQ Management UI: http://localhost:$RABBITMQ_UI_PORT"
echo -e "- Neo4j Browser: http://localhost:$NEO4J_HTTP_PORT"
echo -e "- API Gateway: http://localhost:$API_GATEWAY_PORT"

# Optional: Stop all services
# echo -e "\n${YELLOW}Stopping all services...${NC}"
# docker-compose down