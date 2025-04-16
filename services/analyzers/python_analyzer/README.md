# Python Analyzer Service

This service analyzes Python source code files and extracts code structure information for the CodeGraph system.

## Features

- Parses Python source code using Tree-sitter
- Extracts entities such as modules, classes, functions, variables, and imports
- Identifies relationships between entities (imports, calls, type usage, etc.)
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
2. Navigate to the python_analyzer directory
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

## Manual Relationship Hints

The Python Analyzer supports special comment-based hints to manually specify relationships in source code when automatic analysis is insufficient. These hints are parsed during analysis and used to generate relationship stubs.

### Supported Hint Types
- **Manual call targets:** `# bmcp:call-target <ID>`
- **Manual import relationships:** `# bmcp:imports <ID>`
- **Manual type relationships:** `# bmcp:uses-type <ID>`

### Usage
Insert the appropriate hint comment in your Python source code. The analyzer will detect and process these hints:

```python
# bmcp:call-target my.function.Target
def my_function():
    # ...
    pass

# bmcp:imports my.module.ClassName
from my.module import ClassName

# bmcp:uses-type my.module.TypeName
variable: TypeName = None
```

- The `<ID>` should be the canonical identifier for the target entity (function, class, type, etc.).
- Hints can be placed above or within relevant code blocks.
- The syntax is extensible for future hint types (e.g., `# bmcp:<hint-type> <ID>`).

### Supported Comment Syntax
- Single-line comments: `# ...`
- Multi-line comments/docstrings (not currently supported for hints)

## License

[MIT](LICENSE)