# Use Node.js LTS as the base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code and other necessary files
COPY . .

# Build TypeScript code
RUN npm run build

# Expose port if needed (for debugging or health checks)
# EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production

# Run the service
CMD ["node", "dist/index.js"]