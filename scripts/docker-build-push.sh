#!/bin/bash

###############################################
# Docker Build & Push Script
# Builds multi-platform images and pushes to Docker Hub
###############################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Quest Planner Docker Build & Push   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}\n"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
DOCKER_USERNAME="nenadjokic"
IMAGE_NAME="quest-planner"
FULL_IMAGE="$DOCKER_USERNAME/$IMAGE_NAME"

echo -e "${GREEN}📦 Version: ${VERSION}${NC}"
echo -e "${GREEN}🐳 Image: ${FULL_IMAGE}${NC}\n"

# Check if logged in to Docker Hub
if ! docker info | grep -q "Username: $DOCKER_USERNAME"; then
    echo -e "${YELLOW}⚠️  Not logged in to Docker Hub${NC}"
    echo -e "${BLUE}Please login:${NC}"
    docker login
fi

# Check if buildx is available
if ! docker buildx version &> /dev/null; then
    echo -e "${RED}❌ Docker Buildx not available${NC}"
    echo "Install Docker Desktop or enable buildx"
    exit 1
fi

# Create builder if it doesn't exist
if ! docker buildx inspect multiplatform-builder &> /dev/null; then
    echo -e "${BLUE}🔧 Creating multi-platform builder...${NC}"
    docker buildx create --name multiplatform-builder --use
    docker buildx inspect --bootstrap
fi

# Build and push multi-platform images
echo -e "\n${BLUE}🏗️  Building multi-platform images...${NC}"
echo -e "${YELLOW}This may take several minutes...${NC}\n"

docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag "$FULL_IMAGE:latest" \
    --tag "$FULL_IMAGE:$VERSION" \
    --tag "$FULL_IMAGE:$(echo $VERSION | cut -d. -f1).$(echo $VERSION | cut -d. -f2)" \
    --push \
    .

echo -e "\n${GREEN}✅ Build and push complete!${NC}\n"
echo -e "${BLUE}📦 Images pushed:${NC}"
echo -e "   • ${FULL_IMAGE}:latest"
echo -e "   • ${FULL_IMAGE}:${VERSION}"
echo -e "   • ${FULL_IMAGE}:$(echo $VERSION | cut -d. -f1).$(echo $VERSION | cut -d. -f2)"

echo -e "\n${BLUE}🔍 View on Docker Hub:${NC}"
echo -e "   https://hub.docker.com/r/${FULL_IMAGE}\n"

echo -e "${BLUE}🚀 Test the image:${NC}"
echo -e "   docker run -d -p 3000:3000 -v quest-planner-data:/app/data ${FULL_IMAGE}:latest\n"

echo -e "${GREEN}🎉 Done!${NC}"
