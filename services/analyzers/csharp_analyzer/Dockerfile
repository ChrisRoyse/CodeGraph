FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install tree-sitter and tree-sitter-c-sharp dependencies
RUN apk add --no-cache python3 make g++ git

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Remove development dependencies
RUN npm prune --production

# Expose port if needed
# EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production

# Run the service
CMD ["node", "dist/index.js"]