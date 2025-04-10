# typescript_analyzer_service/Dockerfile
FROM node:18-slim

WORKDIR /app

# Install necessary tools for gRPC code generation and tree-sitter native modules
# Install necessary tools for gRPC code generation, tree-sitter native modules, and TCP healthcheck (netcat)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ libpq-dev netcat-openbsd && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY typescript_analyzer_service/package*.json ./
# Remove node_modules for a completely clean install
RUN rm -rf node_modules
# Remove lock file to ensure clean install based on package.json
RUN rm -f package-lock.json
# Force clear npm cache to avoid issues with removed dependencies
RUN npm cache clean --force
# Install ALL dependencies first (including dev for build and types)
# Use --legacy-peer-deps if needed for tree-sitter compatibility
RUN npm install --legacy-peer-deps

# Copy protobuf definitions
COPY protobufs /app/protobufs

# Generate gRPC code (needs dev deps already installed)
RUN npm run generate
# Note: No need to install/prune dev deps here as they are installed above

# Copy the rest of the service code (including .ts files and tsconfig.json)
COPY typescript_analyzer_service/. .

# Build the TypeScript code
RUN npm run build

# Prune dev dependencies AFTER the build is complete
RUN npm prune --production

# Expose the gRPC port (choose a unique one, e.g., 50058)
EXPOSE 50058

# Define environment variable for the port
ENV GRPC_PORT=50058

# Run the gRPC server
# Run the compiled gRPC server from the dist directory
CMD ["node", "dist/server.js"]