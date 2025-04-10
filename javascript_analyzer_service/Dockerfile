# javascript_analyzer_service/Dockerfile
FROM node:18-slim

WORKDIR /app

# Install necessary tools for gRPC code generation and tree-sitter native modules
# Install necessary tools for gRPC code generation, tree-sitter native modules, and TCP healthcheck (netcat)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libpq-dev netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY javascript_analyzer_service/package*.json ./
# Use --legacy-peer-deps if needed for tree-sitter compatibility
RUN npm install -g tree-sitter-cli && npm install --production --legacy-peer-deps && cd node_modules/tree-sitter-javascript && tree-sitter build

# Copy protobuf definitions
COPY protobufs /app/protobufs

# Generate gRPC code using the script defined in package.json
# Install devDependencies needed for generation, generate, then remove them
RUN npm install --only=dev --legacy-peer-deps && npm run generate && npm prune --production

# Copy the rest of the service code
COPY javascript_analyzer_service/. .

# Expose the gRPC port (choose a unique one, e.g., 50057)
EXPOSE 50057

# Define environment variable for the port
ENV GRPC_PORT=50057

# Run the gRPC server
CMD ["node", "server.js"]