# C# Analyzer

A C# code analyzer for CodeGraph that extracts code structure and relationships from C# source files.

## Features

- Parses C# files using Tree-sitter
- Identifies C# entities:
  - Files and namespaces
  - Classes and interfaces
  - Methods and properties
  - Fields and events
  - Attributes (annotations)
  - Using statements (imports)
- Extracts relationships:
  - Method calls (:CALLS)
  - Using statements (:IMPORTS)
  - Interface implementation (:IMPLEMENTS)
  - Class inheritance (:EXTENDS)
  - Attribute usage (:ANNOTATED_WITH)
  - Type usage (:USES_TYPE)
  - Dependency injection (:DEPENDS_ON)
- Generates canonical IDs and GIDs for entities
- Publishes analysis results to RabbitMQ

## Prerequisites

- Node.js (v16 or higher)
- npm
- RabbitMQ
- ID Service

## Installation

1. Clone the repository
2. Navigate to the C# analyzer directory:
   ```
   cd services/analyzers/csharp_analyzer
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```
5. Edit the `.env` file to configure your environment

## Usage

### Development

To run the analyzer in development mode:

```
npm run dev
```

### Production

To build and run the analyzer in production mode:

```
npm run build
npm start
```

### Docker

To build and run the analyzer using Docker:

```
docker build -t csharp-analyzer .
docker run -d --name csharp-analyzer --env-file .env csharp-analyzer
```

## Testing

To run the tests:

```
npm test
```

To run the tests with coverage:

```
npm test -- --coverage
```

## Message Format

### Input Message (from RabbitMQ)

```json
{
  "file_path": "/path/to/file.cs"
}
```

### Output Message (to RabbitMQ)

```json
{
  "file_path": "/path/to/file.cs",
  "language": "csharp",
  "nodes_upserted": [
    {
      "gid": "unique-global-id",
      "canonical_id": "file/path/to/file.cs::Class::MyClass",
      "name": "MyClass",
      "file_path": "/path/to/file.cs",
      "language": "csharp",
      "labels": ["Class"],
      "properties": {
        "name": "MyClass",
        "namespace": "MyNamespace",
        "is_public": true
      }
    }
  ],
  "relationships_upserted": [
    {
      "source_gid": "source-global-id",
      "target_canonical_id": "file/path/to/file.cs::Method::MyMethod",
      "type": "CALLS",
      "properties": {}
    }
  ],
  "nodes_deleted": [],
  "relationships_deleted": []
}
```

## Architecture

The C# analyzer consists of the following components:

- `index.ts`: Entry point that handles RabbitMQ connections and message processing
- `ast-visitor.ts`: Core visitor that traverses the C# AST and extracts entities and relationships
- `ast-visitor-utils.ts`: Utility functions for AST traversal
- `id-service-client.ts`: Client for the ID Service to generate canonical IDs and GIDs
- `models.ts`: Data models and interfaces

## License

This project is licensed under the MIT License.