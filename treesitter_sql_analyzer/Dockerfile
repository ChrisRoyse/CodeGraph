# Use an appropriate Node.js base image
FROM node:18-slim

# Set the working directory
WORKDIR /app

# Install build tools needed for native modules (like tree-sitter) and netcat for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ node-gyp netcat-openbsd && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY treesitter_sql_analyzer/package*.json ./

# Install production dependencies, using legacy peer deps for tree-sitter compatibility
RUN npm install --production --legacy-peer-deps

# Copy protobuf definitions into the image
COPY protobufs /app/protobufs


# Copy the rest of the application code
COPY treesitter_sql_analyzer/. .

# Install tree-sitter-cli globally
RUN npm install -g tree-sitter-cli

# Expose the gRPC port
EXPOSE 50054

# Define the command to run the server
CMD ["node", "server.js"]