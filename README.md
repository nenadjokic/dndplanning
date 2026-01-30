# Quest Planner — D&D Session Scheduler

A web application where the Dungeon Master creates session time slots and players vote on their availability.
Dark fantasy theme, Node.js + SQLite backend, EJS server-side rendering.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Server Installation](#server-installation)
  - [1. Clone the Repository](#1-clone-the-repository)
  - [2. Install Dependencies](#2-install-dependencies)
  - [3. Configuration](#3-configuration)
  - [4. Start the App](#4-start-the-app)
  - [5. Process Manager (Production)](#5-process-manager-production)
  - [6. Reverse Proxy (Nginx)](#6-reverse-proxy-nginx)
- [Docker Installation](#docker-installation)
  - [1. Docker Build and Run](#1-docker-build-and-run)
  - [2. Docker Compose](#2-docker-compose)
  - [3. Docker on Raspberry Pi](#3-docker-on-raspberry-pi)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Database Backup](#database-backup)
- [Updating](#updating)
- [Changelog](#changelog)

---

## Features

- **Session Scheduling** — DM posts proposed time slots, players vote on availability
- **Availability Grid** — Visual overview of who can play when (available / maybe / unavailable)
- **DM Preferences** — DMs and admins can mark their preferred slot with a star
- **Session Lifecycle** — Open → Confirmed → Cancelled / Reopened
- **User Settings** — Avatar upload, 12h/24h time format toggle, password change
- **Unavailability Days** — Players mark dates they can't play; DM sees these when creating sessions
- **Calendar Feed (iCal)** — Subscribe to confirmed sessions and unavailability in any calendar app
- **Auto-Update Check** — Admin can check for new releases from the Guild Settings page
- **Role System** — Guild Master (admin), Dungeon Master, Adventurer (player)
- **Dark Fantasy Theme** — Medieval-inspired UI with custom fonts
- **SQLite Database** — Zero-config, file-based, easy to back up
- **Docker Ready** — Dockerfile and docker-compose.yml included

---

## Prerequisites

### Server Installation (without Docker)

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Git**

On Raspberry Pi (Debian/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs git
```

### Docker Installation

- **Docker** >= 20.x
- **Docker Compose** >= 2.x (optional but recommended)

On Raspberry Pi:

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
# Log out and back in for the group change to take effect
```

---

## Server Installation

### 1. Clone the Repository

```bash
cd /opt
git clone https://github.com/nenadjokic/dndplanning.git
cd dndplanning
```

Or manually copy the files to your desired directory (e.g. `/opt/dndplanning`).

### 2. Install Dependencies

```bash
npm install --production
```

The `--production` flag skips dev dependencies (nodemon) which aren't needed in production.

### 3. Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Open `.env` and set the values:

```env
PORT=3000
SESSION_SECRET=put-a-long-random-string-here
```

To generate a secure session secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output and set it as `SESSION_SECRET`.

### 4. Start the App

**Development** (with auto-reload):

```bash
npm run dev
```

**Production**:

```bash
npm start
```

The app will be available at `http://localhost:3000` (or whichever port you set in `.env`).

### 5. Process Manager (Production)

For production environments, use **PM2** to run the app as a service with automatic restarts:

```bash
# Install PM2
sudo npm install -g pm2

# Start the app
cd /opt/dndplanning
pm2 start server.js --name quest-planner

# Enable auto-start on boot
pm2 startup
pm2 save
```

Useful PM2 commands:

```bash
pm2 status              # Status of all processes
pm2 logs quest-planner  # Real-time logs
pm2 restart quest-planner
pm2 stop quest-planner
```

### 6. Reverse Proxy (Nginx)

To make the app available on port 80/443 (with or without a domain), set up Nginx as a reverse proxy.

Install Nginx:

```bash
sudo apt install -y nginx
```

Create the config file `/etc/nginx/sites-available/quest-planner`:

```nginx
server {
    listen 80;
    server_name quest.example.com;  # or your IP address

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/quest-planner /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

For HTTPS with Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d quest.example.com
```

---

## Docker Installation

### 1. Docker Build and Run

Clone the repository and enter the directory:

```bash
git clone https://github.com/nenadjokic/dndplanning.git
cd dndplanning
```

Then build and run:

```bash
# Build the image
docker build -t quest-planner .

# Run the container
docker run -d \
  --name quest-planner \
  -p 3000:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 48) \
  -v quest-planner-data:/app/data \
  --restart unless-stopped \
  quest-planner
```

Parameter reference:

| Parameter | Description |
|---|---|
| `-d` | Run the container in the background (detached) |
| `--name quest-planner` | Container name for easier management |
| `-p 3000:3000` | Map host port 3000 to container port 3000 |
| `-e SESSION_SECRET=...` | Set the session secret as an environment variable |
| `-v quest-planner-data:/app/data` | Persistent volume for the SQLite database |
| `--restart unless-stopped` | Auto-restart on boot and crash |

Useful Docker commands:

```bash
docker logs quest-planner          # View logs
docker logs -f quest-planner       # Real-time logs
docker stop quest-planner          # Stop
docker start quest-planner         # Start again
docker restart quest-planner       # Restart
docker rm -f quest-planner         # Remove container (data persists in volume)
```

### 2. Docker Compose

A simpler way to manage the container. Uses the `docker-compose.yml` included in the project:

```bash
# Clone repo (if you haven't already)
git clone https://github.com/nenadjokic/dndplanning.git
cd dndplanning

# Start (build + run)
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

The `docker-compose.yml` automatically:
- Builds the image from the Dockerfile
- Maps port 3000
- Creates a persistent volume for the database
- Sets a restart policy
- Loads environment variables from the `.env` file

### 3. Docker on Raspberry Pi

The Docker image works on ARM64 architecture (Raspberry Pi 4/5) without any modifications since it uses the Node.js Alpine image which supports multiple architectures.

```bash
# On Raspberry Pi
cd /opt/dndplanning
docker compose up -d
```

If the Pi is running an older 32-bit OS, change the base image in the `Dockerfile`:

```dockerfile
FROM node:20-bullseye-slim
```

instead of `node:20-alpine`.

#### Local Network Access

If the Pi is at `192.168.1.100`, the app is available at:

```
http://192.168.1.100:3000
```

For access with a custom domain, add to `/etc/hosts` on the client machine:

```
192.168.1.100  quest.local
```

---

## Usage

### First User

1. Open `http://localhost:3000` (or your server address)
2. Click **"Join the Guild"** to register
3. **The first registered user automatically becomes Guild Master (Admin)**
4. All subsequent users become Players (Adventurers)
5. The admin can assign the DM role to other users through the **Guild Settings** page

### DM Workflow

1. On the dashboard, click **"Post to Tavern Board"**
2. Enter a session title, description, and proposed time slots
3. Review any player unavailability dates shown above the form
4. Click **"Post to Tavern Board"** to publish
5. Review player votes in the availability grid
6. Select a slot and click **"Proclaim This Date"** to confirm

### Player Workflow

1. On the dashboard, see all posted sessions
2. Click on a session with the **"Needs your vote"** badge
3. For each slot, choose: **Available** / **Maybe** / **Unavailable**
4. Click **"Submit Availability"**

### Settings

All users can access **Settings** (pencil icon in the nav bar) to:
- Upload an avatar (displayed in the nav, availability grid, and preferences)
- Toggle between 12-hour and 24-hour time format
- Change their password
- Mark unavailability days with optional reasons
- Generate a calendar feed URL (iCal) for subscribing in external calendar apps

### Admin Features

The Guild Master can access **Guild Settings** (cogwheel icon) to:
- Manage user roles (promote/demote between DM and Player)
- Check for application updates

---

## Project Structure

```
dndplanning/
├── server.js              # Express entry point
├── package.json
├── .env                   # Environment variables (not in git)
├── .env.example           # Example env file
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── db/
│   ├── schema.sql         # DDL for SQLite tables
│   └── connection.js      # SQLite connection and initialization
├── helpers/
│   └── time.js            # Date/time formatting helpers (12h/24h)
├── middleware/
│   ├── auth.js            # Auth middleware (login, DM check, user data)
│   └── flash.js           # Flash messages
├── routes/
│   ├── auth.js            # Register, login, logout
│   ├── admin.js           # User management, update check
│   ├── calendar.js        # iCal feed endpoint
│   ├── dashboard.js       # Role-based redirect (DM/Player)
│   ├── sessions.js        # Session CRUD, slot confirmation
│   ├── settings.js        # User settings (avatar, time, password, unavailability)
│   └── votes.js           # Player voting
├── views/                 # EJS templates
│   ├── partials/          # Header, footer, nav, flash, slot grid
│   ├── auth/              # Login, register pages
│   ├── dm/                # DM dashboard, form, session detail
│   ├── player/            # Player dashboard, voting
│   └── settings.ejs       # User settings page
├── public/
│   ├── css/style.css      # Dark fantasy theme
│   └── js/app.js          # Slot picker, flash dismiss, update check
└── data/                  # SQLite files + avatars (not in git)
    └── avatars/           # User avatar uploads
```

---

## Database Backup

The SQLite database is located in the `data/` directory (or in the Docker volume).

### On the Server (without Docker)

```bash
# Manual backup
cp /opt/dndplanning/data/dndplanning.db /backup/dndplanning-$(date +%Y%m%d).db

# Cron job for daily backup (add with crontab -e)
0 3 * * * cp /opt/dndplanning/data/dndplanning.db /backup/dndplanning-$(date +\%Y\%m\%d).db
```

### From a Docker Volume

```bash
# Find the volume path
docker volume inspect quest-planner-data

# Copy the database from the container
docker cp quest-planner:/app/data/dndplanning.db ./backup-dndplanning.db
```

---

## Updating

### With Docker (recommended)

```bash
git pull
docker compose up -d --build
```

### Without Docker

```bash
cd /opt/dndplanning
git pull
npm install --production
pm2 restart quest-planner
```

The admin can also check for updates from the **Guild Settings** page using the "Check for Updates" button.

---

## Changelog

### v0.2.0

- **User Settings page** — accessible to all logged-in users via the pencil icon in the nav bar
- **Avatar uploads** — displayed in the nav, availability grid, and DM preference display
- **Time format toggle** — switch between 12-hour and 24-hour format; applied across all views
- **Password change** — requires current password for verification
- **Unavailability days** — players mark dates they can't play with optional reasons; shown to the DM when creating sessions and as warnings in the availability grid
- **iCal calendar feed** — subscribe to confirmed sessions and personal unavailability in any calendar app via a generated token-based URL
- **Auto-update check** — admin can check for new GitHub releases from Guild Settings
- **Version in footer** — current app version displayed on every page

### v0.1.0

- Initial release
- DM session creation with proposed time slots
- Player availability voting (available / maybe / unavailable)
- Availability grid with vote summary
- DM/Admin date preference with star display
- Session lifecycle: open → confirmed → cancelled / reopened
- Role system: Guild Master (admin), Dungeon Master, Adventurer (player)
- First registered user becomes admin automatically
- Admin user management (role assignment)
- Session deletion (admin only)
- Dark fantasy themed UI
- SQLite database with Docker volume persistence
- Docker and Docker Compose support
