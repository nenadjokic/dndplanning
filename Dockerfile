FROM node:20-alpine AS builder

# Install build dependencies for native modules (better-sqlite3, sharp)
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++

WORKDIR /app

# Copy package files for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --production --ignore-scripts && npm rebuild

FROM node:20-alpine

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY . .

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Create data directories with proper permissions
RUN mkdir -p /app/data/avatars && \
    mkdir -p /app/data/uploads/board && \
    mkdir -p /app/data/maps && \
    mkdir -p /app/data/thumbnails && \
    chown -R node:node /app/data

# Switch to non-root user
USER node

# Volume for data persistence (SQLite database, avatars, uploads)
# For Railway deployment: See Dockerfile.railway (VOLUME keyword not supported)
VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 302 || r.statusCode === 200 ? 0 : 1)})"

# Use entrypoint script that runs migrations before starting server
ENTRYPOINT ["/app/docker-entrypoint.sh"]
