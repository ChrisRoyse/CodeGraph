# SQL Analyzer Service

This service analyzes SQL files and extracts code structure information for the CodeGraph system. It connects to the ID Service to generate canonical IDs and GIDs for SQL entities.

## Features

- Parses SQL files using tree-sitter-sql grammar
- Identifies SQL entities:
  - Tables (CREATE TABLE statements)
  - Columns (including data types and constraints)
  - Views (CREATE VIEW statements)
  - Functions (CREATE FUNCTION statements)
  - Procedures (CREATE PROCEDURE statements)
- Extracts relationships:
  - Column definitions within Tables (:DEFINES_COLUMN)
  - View dependencies on Tables (:DEPENDS_ON)
  - Foreign key relationships between tables (:REFERENCES)
- Generates canonical IDs and GIDs for entities using the ID Service
- Publishes analysis results to RabbitMQ

## Architecture

The SQL Analyzer follows the same pattern as other analyzers in the CodeGraph system:

1. Consumes file events from the `bmcp.jobs.analysis` RabbitMQ queue
2. Analyzes SQL files using tree-sitter
3. Generates IDs for entities using the ID Service
4. Publishes results to the `bmcp.results.analysis` RabbitMQ queue

## Development

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Run

```bash
npm start
```

### Test

```bash
npm test
```

## Configuration

The service can be configured using environment variables. See `.env.example` for available options.

## Docker

A Dockerfile is provided to build a container image for the service:

```bash
docker build -t sql-analyzer .
```

## License

This project is part of the CodeGraph system.