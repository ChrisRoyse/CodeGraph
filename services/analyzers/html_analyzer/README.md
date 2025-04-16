# HTML/CSS Analyzer Service

This service is part of the CodeGraph system and is responsible for analyzing HTML and CSS files to extract code structure information. It integrates with the ID Service to generate canonical IDs and GIDs for HTML/CSS entities.

## Features

- Analyzes HTML files to identify elements, attributes, and structure
- Analyzes CSS files to identify rules, selectors, and properties
- Processes inline styles and style tags within HTML
- Identifies relationships between HTML elements (nesting)
- Identifies relationships between CSS rules and HTML elements (styling)
- Tracks external resources referenced in HTML (scripts, stylesheets)
- Integrates with Tree-sitter for accurate parsing
- Communicates with other services via RabbitMQ

## Architecture

The HTML/CSS Analyzer follows the same architecture as other analyzers in the CodeGraph system:

1. It consumes messages from the `bmcp.jobs.analysis` queue
2. It analyzes the file content using Tree-sitter parsers
3. It generates canonical IDs and GIDs for entities using the ID Service
4. It publishes analysis results to the `bmcp.results.analysis` queue

## Entity Types

### HTML Entities

- `File`: HTML file
- `Element`: HTML element (div, span, etc.)
- `Attribute`: HTML attribute (id, class, etc.)
- `Script`: Script tag
- `Style`: Style tag

### CSS Entities

- `File`: CSS file
- `Rule`: CSS rule
- `Selector`: CSS selector
- `Property`: CSS property

## Relationship Types

- `:CONTAINS`: Parent-child relationship between elements
- `:HAS_ATTRIBUTE`: Relationship between element and attribute
- `:REFERENCES`: Reference to external resource
- `:INCLUDES`: Inclusion of script or style
- `:STYLES`: CSS rule styling an HTML element
- `:DEFINES`: CSS rule defining a property

## Development

### Prerequisites

- Node.js 18 or higher
- npm 8 or higher

### Installation

```bash
npm install
```

### Building

```bash
npm run build
```

### Running

```bash
npm start
```

### Testing

```bash
npm test
```

## Environment Variables

The service can be configured using the following environment variables:

- `RABBITMQ_HOST`: RabbitMQ host (default: "rabbitmq")
- `RABBITMQ_PORT`: RabbitMQ port (default: 5672)
- `RABBITMQ_USER`: RabbitMQ username (default: "guest")
- `RABBITMQ_PASSWORD`: RabbitMQ password (default: "guest")
- `RABBITMQ_JOBS_QUEUE`: RabbitMQ jobs queue (default: "bmcp.jobs.analysis")
- `RABBITMQ_RESULTS_QUEUE`: RabbitMQ results queue (default: "bmcp.results.analysis")
- `ID_SERVICE_HOST`: ID Service host (default: "id_service")
- `ID_SERVICE_PORT`: ID Service port (default: 50051)
- `LOG_LEVEL`: Logging level (default: "info")

## Docker

A Dockerfile is provided to build a container image for the service:

```bash
docker build -t html-analyzer .
```

Running the container:

```bash
docker run -d --name html-analyzer html-analyzer