FROM node:20-alpine

# Install dependencies for canvas and other native modules
RUN apk add --no-cache \
    python3 \
    py3-setuptools \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

# Clean up build dependencies but keep runtime libraries
RUN apk del python3 py3-setuptools make g++ \
    && apk add --no-cache cairo jpeg pango giflib pixman pangomm libjpeg-turbo freetype

COPY . .

RUN mkdir -p /app/data

VOLUME /app/data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server.js"]
