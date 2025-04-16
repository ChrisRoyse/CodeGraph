# Java Analyzer Service

This service analyzes Java source code files and extracts code structure information for the CodeGraph system.

## Features

- Parses Java source code using Tree-sitter
- Extracts entities such as packages, classes, interfaces, methods, fields, and annotations
- Identifies relationships between entities (imports, inheritance, implementation, method calls, etc.)
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
2. Navigate to the java_analyzer directory
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
docker build -t java-analyzer .
```

Run the container:

```bash
docker run -d --name java-analyzer --env-file .env java-analyzer
```

## Architecture

The Java Analyzer service consists of the following components:

- **index.ts**: Main entry point and message handling
- **id-service-client.ts**: Client for the ID Service
- **models.ts**: Data models and type definitions
- **ast-visitor.ts**: AST traversal and entity extraction
- **ast-visitor-utils.ts**: Utility functions for AST processing
- **visitors/**: Specialized visitors for different Java constructs

## Manual Relationship Hints

The Java Analyzer supports special comment-based hints to manually specify relationships in source code when automatic analysis is insufficient. These hints are parsed during analysis and used to generate relationship stubs.

### Supported Hint Types
- **Manual call targets:** `// bmcp:call-target <ID>`
- **Manual import relationships:** `// bmcp:imports <ID>`
- **Manual type relationships:** `// bmcp:uses-type <ID>`

### Usage
Insert the appropriate hint comment in your Java source code. The analyzer will detect and process these hints:

```java
// bmcp:call-target my.function.Target
public void myMethod() {
    // ...
}

// bmcp:imports my.package.ClassName
import my.package.ClassName;

// bmcp:uses-type my.package.TypeName
private TypeName field;
```

- The `<ID>` should be the canonical identifier for the target entity (function, class, type, etc.).
- Hints can be placed above or within relevant code blocks.
- The syntax is extensible for future hint types (e.g., `// bmcp:<hint-type> <ID>`).

### Supported Comment Syntax
- Single-line comments: `// ...`
- Multi-line comments (not currently supported for hints)

## Message Format

### Input (analyze)

```json
{
  "file_path": "/path/to/file.java",
  "action": "analyze"
}
```

### Input (delete)

```json
{
  "file_path": "/path/to/file.java",
  "action": "delete"
}
```

### Output

```json
{
  "file_path": "/path/to/file.java",
  "language": "java",
  "nodes_upserted": [...],
  "relationships_upserted": [...],
  "nodes_deleted": [...],
  "relationships_deleted": [...]
}
```

## License

[MIT](LICENSE)