FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Clean up development dependencies
RUN npm prune --production

# Set environment variables
ENV NODE_ENV=production

# Run the service
CMD ["node", "dist/index.js"]