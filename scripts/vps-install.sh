#!/bin/bash

#############################################
# Quest Planner VPS Auto-Install Script
# Supports: Ubuntu 20.04+, Debian 11+
# Usage: curl -sSL https://raw.githubusercontent.com/nenadjokic/dndplanning/main/scripts/vps-install.sh | bash
#############################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║   Quest Planner VPS Auto-Installer    ║"
echo "║   D&D Session Planning Made Easy      ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -eq 0 ]; then
  echo -e "${RED}⚠️  Please do not run this script as root${NC}"
  echo "Run as a regular user with sudo privileges"
  exit 1
fi

# Check OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo -e "${RED}Cannot detect OS. This script supports Ubuntu 20.04+ and Debian 11+${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Detected OS: $OS $VER${NC}"

# Install Node.js
echo -e "\n${BLUE}📦 Installing Node.js 20.x...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo -e "${GREEN}✓ Node.js installed: $(node --version)${NC}"
else
    echo -e "${GREEN}✓ Node.js already installed: $(node --version)${NC}"
fi

# Install Git
echo -e "\n${BLUE}📦 Installing Git...${NC}"
if ! command -v git &> /dev/null; then
    sudo apt-get install -y git
    echo -e "${GREEN}✓ Git installed${NC}"
else
    echo -e "${GREEN}✓ Git already installed${NC}"
fi

# Install PM2
echo -e "\n${BLUE}📦 Installing PM2 process manager...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo -e "${GREEN}✓ PM2 installed${NC}"
else
    echo -e "${GREEN}✓ PM2 already installed${NC}"
fi

# Install Nginx (optional)
read -p "$(echo -e ${YELLOW}Do you want to install Nginx as reverse proxy? [y/N]: ${NC})" -n 1 -r
echo
INSTALL_NGINX=$REPLY

if [[ $INSTALL_NGINX =~ ^[Yy]$ ]]; then
    echo -e "\n${BLUE}📦 Installing Nginx...${NC}"
    sudo apt-get install -y nginx
    echo -e "${GREEN}✓ Nginx installed${NC}"
fi

# Clone Quest Planner
INSTALL_DIR="/opt/quest-planner"
echo -e "\n${BLUE}📥 Cloning Quest Planner to $INSTALL_DIR...${NC}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}⚠️  Directory $INSTALL_DIR already exists${NC}"
    read -p "$(echo -e ${YELLOW}Do you want to remove it and reinstall? [y/N]: ${NC})" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo rm -rf "$INSTALL_DIR"
    else
        echo -e "${RED}Installation aborted${NC}"
        exit 1
    fi
fi

sudo mkdir -p "$INSTALL_DIR"
sudo chown $USER:$USER "$INSTALL_DIR"
git clone https://github.com/nenadjokic/dndplanning.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

# Install dependencies
echo -e "\n${BLUE}📦 Installing dependencies...${NC}"
npm install --production
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Generate session secret
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# Create .env file
echo -e "\n${BLUE}⚙️  Creating configuration file...${NC}"
cat > .env << EOF
# Quest Planner Configuration
NODE_ENV=production
PORT=3000
SESSION_SECRET=$SESSION_SECRET
TRUST_PROXY=true
SECURE_COOKIES=false
DB_PATH=./data/dndplanning.db
EOF
echo -e "${GREEN}✓ Configuration created${NC}"

# Create data directory
mkdir -p data
chmod 755 data

# Start with PM2
echo -e "\n${BLUE}🚀 Starting Quest Planner with PM2...${NC}"
pm2 start server.js --name quest-planner
pm2 save
pm2 startup | tail -n 1 | bash
echo -e "${GREEN}✓ Quest Planner started${NC}"

# Configure Nginx if installed
if [[ $INSTALL_NGINX =~ ^[Yy]$ ]]; then
    echo -e "\n${BLUE}⚙️  Configuring Nginx...${NC}"

    read -p "$(echo -e ${YELLOW}Enter your domain name (e.g., questplanner.example.com): ${NC})" DOMAIN

    sudo tee /etc/nginx/sites-available/quest-planner > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    sudo ln -sf /etc/nginx/sites-available/quest-planner /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
    echo -e "${GREEN}✓ Nginx configured${NC}"

    # Offer SSL setup
    read -p "$(echo -e ${YELLOW}Do you want to setup SSL with Let's Encrypt? [y/N]: ${NC})" -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "\n${BLUE}🔒 Installing Certbot...${NC}"
        sudo apt-get install -y certbot python3-certbot-nginx
        sudo certbot --nginx -d $DOMAIN

        # Update .env for HTTPS
        sed -i 's/SECURE_COOKIES=false/SECURE_COOKIES=true/' .env
        pm2 restart quest-planner
        echo -e "${GREEN}✓ SSL configured${NC}"
    fi
fi

# Get server IP
SERVER_IP=$(curl -s ifconfig.me)

echo -e "\n${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Installation Complete! 🎉          ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📍 Installation Directory:${NC} $INSTALL_DIR"
echo -e "${BLUE}🌐 Access Quest Planner at:${NC}"

if [[ $INSTALL_NGINX =~ ^[Yy]$ ]] && [ ! -z "$DOMAIN" ]; then
    echo -e "   http://$DOMAIN/install"
else
    echo -e "   http://$SERVER_IP:3000/install"
fi

echo ""
echo -e "${YELLOW}⚠️  IMPORTANT: Complete the web installer to:${NC}"
echo "   1. Create admin account"
echo "   2. Configure application settings"
echo "   3. Initialize database"
echo ""
echo -e "${BLUE}📚 Useful Commands:${NC}"
echo "   pm2 status              - Check status"
echo "   pm2 logs quest-planner  - View logs"
echo "   pm2 restart quest-planner - Restart app"
echo "   pm2 stop quest-planner  - Stop app"
echo ""
echo -e "${GREEN}🎲 Enjoy Quest Planner!${NC}"
