# C++ Analyzer Service

This service analyzes C++ source code files and extracts code structure information for the CodeGraph system.

## Features

- Parses C++ source code using Tree-sitter
- Extracts entities such as namespaces, classes, structs, functions, methods, templates, and enumerations
- Identifies relationships between entities (#includes, inheritance, function calls, template instantiations)
- Integrates with the ID Service for canonical ID generation
- Processes both analyze and delete operations

## Setup

### Prerequisites

- Node.js 16+
- npm or yarn
- RabbitMQ (for message queue)
- ID Service (for ID generation)

### Installation

1. Clone the repository
2. Navigate to the cpp_analyzer directory
3. Install dependencies:

```bash
npm install
```

4. Create a `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

5. Update the environment variables in the `.env` file as needed

### Building

Build the TypeScript code:

```bash
npm run build
```

### Running

Start the service:

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Testing

Run the tests:

```bash
npm test
```

## Docker

Build the Docker image:

```bash
docker build -t cpp-analyzer .
```

Run the container:

```bash
docker run -d --name cpp-analyzer --env-file .env cpp-analyzer
```

## Architecture

The C++ Analyzer service consists of the following components:

- **index.ts**: Main entry point and message handling
- **id-service-client.ts**: Client for the ID Service
- **models.ts**: Data models and type definitions
- **ast-visitor.ts**: AST traversal and entity extraction
- **ast-visitor-utils.ts**: Utility functions for AST processing
- **visitors/**: Specialized visitors for different C++ constructs

## Message Format

### Input (analyze)

```json
{
  "file_path": "/path/to/file.cpp",
  "action": "analyze"
}
```

### Input (delete)

```json
{
  "file_path": "/path/to/file.cpp",
  "action": "delete"
}
```

### Output

```json
{
  "file_path": "/path/to/file.cpp",
  "language": "cpp",
  "nodes_upserted": [...],
  "relationships_upserted": [...],
  "nodes_deleted": [...],
  "relationships_deleted": [...]
}
```

## License

[MIT](LICENSE)