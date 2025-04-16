FROM node:18-slim

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
# Install Python and build tools needed for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (using install as ci requires lock file)
RUN npm install

# Copy tsconfig before copying the rest of the source
COPY tsconfig.json ./

# Copy source code AFTER dependencies are installed
COPY . .

# Ensure node_modules are present relative to source before building
RUN npm install

# Build TypeScript code
RUN npm run build

# No ports exposed as this service primarily uses RabbitMQ

# Set default command for development
CMD ["npm", "start"]