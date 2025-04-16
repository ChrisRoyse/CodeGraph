# Go Analyzer

A service that analyzes Go source code files and extracts code structure information for the CodeGraph system.

## Features

- Parses Go files using Tree-sitter
- Identifies Go files, packages, functions, methods, structs, interfaces, variables, constants, and imports
- Extracts relationships between entities (function calls, imports, interface implementations, struct embedding, type usage)
- Generates canonical IDs and GIDs for entities using the ID Service
- Handles both analysis and deletion operations
- Publishes analysis and deletion results to RabbitMQ

## Requirements

- Node.js 16+
- RabbitMQ
- ID Service

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

4. Build the TypeScript code:

```bash
npm run build
```

## Usage

### Running the service

```bash
npm start
```

### Development mode

```bash
npm run dev
```

### Running tests

```bash
npm test
```

## Architecture

The Go Analyzer consists of the following components:

- **index.ts**: Main entry point that sets up RabbitMQ connections and message handling for both analysis and deletion operations
- **ast-visitor.ts**: Core logic for traversing Go ASTs and extracting code structure
- **ast-visitor-utils.ts**: Utility functions for processing relationships and formatting results
- **id-service-client.ts**: Client for the ID Service gRPC API
- **models.ts**: Shared data models and type definitions

The service handles two types of operations:
1. **Analysis**: When a Go file is created or modified, the service parses the file, extracts entities and relationships, and publishes the results.
2. **Deletion**: When a Go file is deleted, the service creates a deletion payload with the file path in the `nodes_deleted` array and publishes it.

## Message Format
## Message Format

### Input Message (from RabbitMQ)

#### Analysis Request

```json
{
  "file_path": "/path/to/file.go",
  "language": "go"
}
```

#### Deletion Request

```json
{
  "file_path": "/path/to/file.go",
  "language": "go",
  "event_type": "DELETED"
}
```

### Output Message (to RabbitMQ)

#### Analysis Result

```json
{
  "file_path": "/path/to/file.go",
  "language": "go",
  "nodes_upserted": [
    {
      "gid": "unique-global-id",
      "canonical_id": "path/to/file.go::Function::main",
      "name": "main",
      "file_path": "/path/to/file.go",
      "language": "go",
      "labels": ["Function"],
      "properties": {
        "name": "main",
        "parameters": [],
        "return_types": [],
        "is_exported": false
      }
    }
  ],
  "relationships_upserted": [
    {
      "source_gid": "source-global-id",
      "target_canonical_id": "target-canonical-id",
      "type": ":CALLS",
      "properties": {}
    }
  ],
  "nodes_deleted": [],
  "relationships_deleted": []
}
```

#### Deletion Result

```json
{
  "file_path": "/path/to/file.go",
  "language": "go",
  "nodes_upserted": [],
  "relationships_upserted": [],
  "nodes_deleted": ["/path/to/file.go"],
  "relationships_deleted": []
}
```
## Docker

Build the Docker image:

```bash
docker build -t go-analyzer .
```

Run the container:

```bash
docker run -d --name go-analyzer --env-file .env go-analyzer
```

## License

[MIT](LICENSE)