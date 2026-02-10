FROM node:20-alpine

# Install build dependencies for native modules (better-sqlite3, sharp)
RUN apk add --no-cache \
    python3 \
    make \
    g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

# Clean up build dependencies
RUN apk del python3 make g++

COPY . .

RUN mkdir -p /app/data

VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
