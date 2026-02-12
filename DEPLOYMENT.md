# Quest Planner - Deployment Guide

Complete guide for deploying Quest Planner to various platforms.

## Table of Contents

- [One-Click Deployments](#one-click-deployments)
- [Docker Hub](#docker-hub)
- [VPS Auto-Install](#vps-auto-install)
- [Manual Installation](#manual-installation)
- [Platform-Specific Guides](#platform-specific-guides)

---

## One-Click Deployments

### Railway (Recommended - Easiest)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/dndplanning)

**Features:**
- ✅ Free tier ($5 credit/month)
- ✅ Automatic HTTPS
- ✅ No credit card required
- ✅ Deploy in 60 seconds

**Steps:**
1. Click "Deploy on Railway" button
2. Login with GitHub
3. Click "Deploy Now"
4. Wait 1-2 minutes for deployment
5. Click generated URL → `/install` to complete setup

**Cost:** $0-5/month (free tier often sufficient for small groups)

---

### Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/nenadjokic/dndplanning)

**Features:**
- ✅ Free tier available
- ✅ Automatic HTTPS
- ✅ GitHub integration
- ⚠️ Sleeps after 15min inactivity (free tier)

**Steps:**
1. Click "Deploy to Render"
2. Connect GitHub account
3. Click "Create Web Service"
4. Wait for build to complete
5. Access your app URL → `/install`

**Cost:** $0-7/month

---

### Fly.io

**Features:**
- ✅ 3 free VMs
- ✅ Global CDN
- ✅ Automatic scaling

**Steps:**
1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Clone repo: `git clone https://github.com/nenadjokic/dndplanning.git`
3. Run: `fly launch`
4. Access your app → `/install`

**Cost:** $0-5/month

---

## Docker Hub

Pull and run the official Docker image:

```bash
# Pull latest image
docker pull nenadjokic/quest-planner:latest

# Run with volume for data persistence
docker run -d \
  --name quest-planner \
  -p 3000:3000 \
  -v quest-planner-data:/app/data \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  nenadjokic/quest-planner:latest

# Access at http://localhost:3000/install
```

### Using Docker Compose (Production)

```bash
# Download production compose file
curl -o docker-compose.yml https://raw.githubusercontent.com/nenadjokic/dndplanning/main/docker-compose.prod.yml

# Set session secret
export SESSION_SECRET=$(openssl rand -hex 32)

# Start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### With Nginx Reverse Proxy

```bash
# Start with Nginx
docker-compose --profile with-nginx up -d
```

---

## VPS Auto-Install

**One-command installation** on any VPS (Ubuntu/Debian):

```bash
curl -sSL https://raw.githubusercontent.com/nenadjokic/dndplanning/main/scripts/vps-install.sh | bash
```

**What it does:**
- ✅ Installs Node.js 20
- ✅ Installs PM2 process manager
- ✅ Clones Quest Planner
- ✅ Installs dependencies
- ✅ Configures environment
- ✅ Starts app with PM2
- ✅ (Optional) Configures Nginx + SSL

**Supported OS:**
- Ubuntu 20.04, 22.04, 24.04
- Debian 11, 12

**Requirements:**
- Clean VPS with sudo access
- 1GB RAM minimum

**Recommended VPS Providers:**

| Provider | Cost | RAM | Link |
|----------|------|-----|------|
| DigitalOcean | $4/mo | 512MB | [Sign up](https://digitalocean.com) |
| Linode | $5/mo | 1GB | [Sign up](https://linode.com) |
| Hetzner | €4/mo | 2GB | [Sign up](https://hetzner.com) |
| Contabo | €5/mo | 4GB | [Sign up](https://contabo.com) |

---

## Manual Installation

See [README.md](README.md#server-installation-manual) for detailed manual installation steps.

---

## Platform-Specific Guides

### Railway Detailed Setup

1. **Fork the repository** (optional but recommended)
2. **Go to [Railway](https://railway.app)**
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `nenadjokic/dndplanning`
5. Railway automatically detects Node.js and deploys
6. **Environment variables** (auto-generated):
   - `SESSION_SECRET` - Auto-generated
   - `PORT` - Auto-set to 3000
   - `NODE_ENV` - Set to production
7. **Add persistent volume:**
   - Go to "Variables" tab
   - Click "Add Volume"
   - Mount path: `/app/data`
8. Access your deployment URL → `/install`

### Render Detailed Setup

1. **Fork the repository**
2. **Go to [Render Dashboard](https://dashboard.render.com)**
3. Click "New +" → "Web Service"
4. Connect your GitHub repository
5. Configure:
   - **Name:** quest-planner
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
6. **Add Disk:**
   - Name: quest-planner-data
   - Mount Path: `/app/data`
   - Size: 1GB
7. **Environment Variables:**
   - `NODE_ENV` = production
   - `SESSION_SECRET` = (click "Generate" button)
   - `TRUST_PROXY` = true
   - `SECURE_COOKIES` = true
8. Click "Create Web Service"
9. Wait for deployment (5-10 minutes)
10. Access your URL → `/install`

### Fly.io Detailed Setup

1. **Install Fly CLI:**
   ```bash
   # macOS
   brew install flyctl

   # Linux
   curl -L https://fly.io/install.sh | sh

   # Windows (PowerShell)
   iwr https://fly.io/install.ps1 -useb | iex
   ```

2. **Login:**
   ```bash
   fly auth login
   ```

3. **Clone and deploy:**
   ```bash
   git clone https://github.com/nenadjokic/dndplanning.git
   cd dndplanning
   fly launch
   ```

4. **Configure when prompted:**
   - App name: (choose unique name)
   - Region: (select closest to you)
   - Database: No
   - Deploy now: Yes

5. **Create volume for data:**
   ```bash
   fly volumes create quest_planner_data --size 1
   ```

6. **Set secrets:**
   ```bash
   fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
   ```

7. **Deploy:**
   ```bash
   fly deploy
   ```

8. **Open app:**
   ```bash
   fly open
   # Navigate to /install
   ```

### DigitalOcean Droplet Setup

1. **Create Droplet:**
   - Distribution: Ubuntu 22.04 LTS
   - Plan: Basic ($4/mo)
   - Datacenter: Closest to you
   - Authentication: SSH key (recommended)

2. **SSH into droplet:**
   ```bash
   ssh root@your-droplet-ip
   ```

3. **Run auto-installer:**
   ```bash
   # Create sudo user (recommended)
   adduser questplanner
   usermod -aG sudo questplanner
   su - questplanner

   # Run installer
   curl -sSL https://raw.githubusercontent.com/nenadjokic/dndplanning/main/scripts/vps-install.sh | bash
   ```

4. **Configure firewall:**
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```

5. **Point domain** (optional):
   - Add A record pointing to droplet IP
   - Run installer again and configure SSL

---

## Post-Deployment

### Complete Web Installer

After deployment, navigate to `/install`:

1. **Create admin account**
   - Username (min 3 characters)
   - Password (min 6 characters)

2. **Configure settings**
   - Application name
   - Session secret (auto-generated if left empty)

3. **Click "Install Quest Planner"**

4. **Restart application** (if required)

5. **Login** at `/login` with admin credentials

### Security Checklist

- ✅ Change default session secret (if not auto-generated)
- ✅ Enable HTTPS (via platform or reverse proxy)
- ✅ Set `TRUST_PROXY=true` if behind reverse proxy
- ✅ Set `SECURE_COOKIES=true` if using HTTPS
- ✅ Regular database backups
- ✅ Keep Node.js and dependencies updated

### Monitoring

**Railway:**
- Dashboard → Metrics tab
- Logs available in real-time

**Render:**
- Logs tab in service dashboard
- Metrics for CPU/memory usage

**Fly.io:**
```bash
fly logs
fly status
```

**PM2 (VPS):**
```bash
pm2 status
pm2 logs quest-planner
pm2 monit
```

---

## Troubleshooting

### Port already in use
```bash
# Find process using port 3000
lsof -ti:3000

# Kill process
kill -9 $(lsof -ti:3000)
```

### Database locked
```bash
# Stop all instances
pm2 stop quest-planner  # or docker-compose down

# Remove lock file
rm data/dndplanning.db-wal
rm data/dndplanning.db-shm

# Restart
pm2 start quest-planner  # or docker-compose up -d
```

### Session errors
- Ensure `SESSION_SECRET` is set and persistent
- Check `TRUST_PROXY` setting if behind reverse proxy

### Out of memory
- Increase container/VM memory
- Use swap on VPS (not recommended for production)

---

## Updating

### Railway/Render
- Push to GitHub
- Automatic deployment triggered

### Fly.io
```bash
fly deploy
```

### Docker
```bash
docker pull nenadjokic/quest-planner:latest
docker-compose up -d
```

### VPS (PM2)
```bash
cd /opt/quest-planner
git pull
npm install
pm2 restart quest-planner
```

---

## Support

- **Documentation:** [README.md](README.md)
- **Issues:** [GitHub Issues](https://github.com/nenadjokic/dndplanning/issues)
- **Discussions:** [GitHub Discussions](https://github.com/nenadjokic/dndplanning/discussions)

---

**Quest Planner** - D&D Session Planning Made Easy
