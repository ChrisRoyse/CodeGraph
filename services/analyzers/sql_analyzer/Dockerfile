FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port for debugging/health checks if needed
EXPOSE 8080

# Start the service
CMD ["node", "dist/index.js"]