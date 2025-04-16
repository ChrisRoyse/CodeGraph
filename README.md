# Broad Multi-language Code Parser (BMCP) - Real-time System

A real-time system for analyzing large, complex, polyglot codebases by continuously monitoring the file system for changes, building a high-fidelity Neo4j knowledge graph of all code entities and their relationships, and supporting efficient, near real-time querying and visualization reflecting the latest code state.

## Bulk Loading the CodeGraph Database

The `scripts/bulk_load.py` script automates the initial population of the Neo4j database by publishing analysis jobs for all supported files in a codebase to the message queue. This is recommended for the first-time ingestion of large codebases.

### Prerequisites
- Python 3.8+
- `pip install -r requirements.txt` (ensure `pika` and `python-dotenv` are installed)
- RabbitMQ and analyzers running (see Environment Setup)

### Configuration
Set the following environment variables (e.g., in your `.env` file):

- `CODEBASE_ROOT` – Absolute or relative path to the root of the codebase to analyze (required)
- `RABBITMQ_HOST` – Hostname of RabbitMQ (default: `rabbitmq`)
- `RABBITMQ_PORT` – Port for RabbitMQ (default: `5672`)
- `RABBITMQ_USER` – RabbitMQ username (default: `guest`)
- `RABBITMQ_PASSWORD` – RabbitMQ password (default: `guest`)
- `RABBITMQ_JOBS_QUEUE` – Queue name (default: `bmcp.jobs.analysis`)
- `BULK_LOAD_MAX_WORKERS` – (Optional) Number of parallel workers (default: 8)

### Usage

1. Ensure all analyzers and RabbitMQ are running.
2. Set `CODEBASE_ROOT` to your codebase directory.
3. Run:
   ```sh
   python scripts/bulk_load.py
   ```
4. The script will recursively scan for supported files and publish jobs to the queue. Progress and errors are logged to the console.

### Supported File Types
- Python (`.py`)
- Java (`.java`)
- JavaScript/TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`)
- Go (`.go`)
- C# (`.cs`)
- C++ (`.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`)
- Rust (`.rs`)
- SQL (`.sql`)
- HTML (`.html`, `.htm`)

### Notes
- The script automatically uses the correct message format for each analyzer.
- For very large codebases, you can increase `BULK_LOAD_MAX_WORKERS` for faster publishing.
- Monitor analyzer and ingestion worker logs for progress.
- For advanced/alternative bulk loading (e.g., direct Neo4j CSV import), see future documentation.

## Overview

The BMCP Real-time System is designed to:
- Monitor file system changes in real-time
- Parse and analyze code across multiple languages
- Build and maintain a knowledge graph of code entities and relationships
- Support efficient querying and visualization

## Project Structure

```
bmcp-realtime/
├── docker-compose.yml
├── .env.example
├── shared/
│   ├── proto/
│   └── models/python/
├── services/
│   ├── id_service/
│   ├── file_watcher_service/
│   ├── analyzers/
│   │   ├── python_analyzer/
│   │   ├── javascript_analyzer/
│   │   ├── typescript_analyzer/
│   │   └── go_analyzer/
│   ├── ingestion_worker/
│   └── api_gateway/
├── tests/
└── scripts/
```

## Environment Setup

### Prerequisites

- Docker and Docker Compose
- Git
- PostgreSQL client (for testing connections)
- curl (for testing API endpoints)

### Configuration

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/bmcp-realtime.git
   cd bmcp-realtime
   ```

2. Create and configure the environment file:
   ```
   cp .env.example .env
   ```

3. Edit the `.env` file to customize your configuration:
   - Set database credentials
   - Configure service ports
   - Set monitored paths for file watcher
   - Adjust log levels

### Starting the Infrastructure

1. Start all services using Docker Compose:
   ```
   docker-compose up -d
   ```

2. Verify that all services are running:
   ```
   docker-compose ps
   ```

## Testing the Infrastructure

The project includes a test script to verify that all infrastructure components are running correctly:

```
./scripts/test_infrastructure.sh
```

This script:
- Starts the infrastructure services (RabbitMQ, Neo4j, PostgreSQL)
- Verifies that all required ports are accessible
- Tests basic connectivity to each service
- Starts the application services
- Verifies that the API Gateway is responding

## Accessing Service UIs

Once the infrastructure is running, you can access the following UIs:

- **RabbitMQ Management UI**: http://localhost:15672
  - Default credentials: guest/guest

- **Neo4j Browser**: http://localhost:7474
  - Default credentials: neo4j/test1234
  - Database: codegraph

- **API Gateway**: http://localhost:8000
  - API documentation: http://localhost:8000/docs

## Development Workflow

1. Start the infrastructure services:
   ```
   docker-compose up -d rabbitmq neo4j postgres
   ```

2. Run individual services in development mode:
   ```
   # For Node.js services
   cd services/id_service
   npm install
   npm run dev

   # For Python services
   cd services/file_watcher_service
   pip install -r requirements.txt
   python main.py
   ```

## Troubleshooting

- **Service not starting**: Check the logs with `docker-compose logs <service_name>`
- **Connection issues**: Verify that the ports are correctly mapped in the docker-compose.yml file
- **Database connection failures**: Ensure that the credentials in the .env file match those in the docker-compose.yml file

## Contributing

Please see the CONTRIBUTING.md file for guidelines on how to contribute to this project.