# Quest Planner v0.9.17 — D&D Session Scheduler

> **Latest release:** v0.9.17 (2026-02-02)

A free, open-source web application where the Dungeon Master creates session time slots and players vote on their availability.
Dark/light fantasy theme, Node.js + SQLite backend, EJS server-side rendering. Licensed under GPL-3.0.

---

### Support the Project

If you enjoy Quest Planner, consider buying me a coffee:

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/nenadjokic)
[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/nenadjokicRS)

---

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
- [License](#license)

---

## Features

- **Session Scheduling** — DM posts proposed time slots, players vote on availability
- **Availability Grid** — Visual overview of who can play when (available / maybe / unavailable)
- **DM Preferences** — DMs and admins can mark their preferred slot with a star
- **Session Lifecycle** — Open -> Confirmed -> Completed / Cancelled / Reopened
- **Session Recap** — DMs write a recap/summary when completing a session; supports full Markdown (headings, bold, lists, etc.); players see it read-only
- **Session History** — Dedicated `/history` page showing all completed D&D/RPG sessions in reverse chronological order
- **Date + Time Picker** — Separate date and time select (30-min increments, 12h/24h)
- **Dynamic Unavailability Warnings** — Inline warnings when a selected date conflicts with player unavailability
- **Bulletin Board** — Global post/reply board for tavern gossip and announcements
- **Session Comments** — Per-session "Quest Discussion" threads with replies
- **@Mentions** — Tag users with `@username`; mentioned names highlighted in gold
- **Notifications** — Bell icon in nav bar with unread badge, dropdown history, auto-polling
  - Triggered by: session confirmation, @mentions in posts/replies/comments
- **Light / Dark / Auto Theme** — Dark (Dungeon), Light (Parchment), Auto (switches at 6AM/7PM)
- **Live Clock** — Current date and time in the nav bar, updates every second
- **D&D 5e Character Sheet** — Full character sheet with 3 tabs (Stats & Combat, Biography, Spellcasting); owner-editable with read-only public view; stores all data as a JSON blob per character
- **User Profile** — Avatar upload, birthday, about section (Markdown), multiple characters with avatars and descriptions
- **Public Profiles** — View any guild member's profile page with avatar, birthday, about, and characters grid
- **Push Notifications** — PWA push notifications for session events (create, confirm, cancel, complete, recap) via Web Push API
- **Guild Members Directory** — `/players` page showing all members with links to their profiles
- **User Settings** — Time format toggle, theme toggle, password change
- **Unavailability Days** — Players mark dates they can't play; DM sees these when creating sessions
- **Calendar Feed (iCal)** — Personal feed (sessions + unavailability) and public sessions-only feed
- **Omni-Channel Notifications** — Broadcast session events (created, confirmed, cancelled, reopened, completed, recap) to Discord, Telegram, or Viber; configured per-guild in Guild Settings
- **Multiple Maps** — Create and manage multiple interactive Leaflet.js maps at `/map` with custom image upload, location pins (city, dungeon, tavern), draggable party marker, click-to-add locations
- **Party Inventory (Loot Tracker)** — Shared inventory at `/loot` with categories (weapon, armor, potion, quest, gold, item), item assignment to players, quest item highlights
- **Session Analytics** — Chart.js dashboard at `/analytics` with sessions-per-month, preferred day, player attendance %, streak counter, and summary stats
- **Session Locations** — Optional location dropdown on session creation, linking sessions to map locations
- **Map Fullscreen** — View the world map in immersive fullscreen mode (Escape or button to exit)
- **Pin Editing** — DMs can edit any map location's name, description, and icon type directly from the map or table
- **DM Tools** — Streamdeck-style customizable tool board at `/dm-tools` for quick access to external resources (generators, music, references)
- **DM Tools Favicon Scraping** — Auto-fetch website favicons as tool thumbnails (apple-touch-icon preferred, falls back to favicon.ico)
- **Completion & Recap Notifications** — Bot broadcasts when sessions are completed and when recaps are added/updated
- **Map Pin Navigation** — Clickable pin icons in the location table center the map on that location
- **PWA Support** — Progressive Web App with manifest, service worker, offline page; installable on mobile and desktop with dedicated install instructions page
- **3D Dice Roller** — Interactive 3D dice roller (D4–D100) with Three.js rendering and cannon-es physics; floating D20 button, bubble menu for dice selection, results banner with auto-hide
- **What's New Modal** — Post-update changelog popup shown to users on first login after a version update, with GitHub release link and support badges
- **Auto-Update Check** — Admin can check for new releases from the Guild Settings page
- **Welcome Popup** — First-login modal thanking users with support links
- **Role System** — Guild Master (admin), Dungeon Master, Adventurer (player)
- **Open Source** — GPL-3.0 licensed, footer with GitHub/license/support links
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
4. A welcome popup appears thanking you for using the software (shown only once)
5. All subsequent users become Players (Adventurers)
6. The admin can assign the DM role to other users through the **Guild Settings** page

### DM Workflow

1. On the dashboard, click **"Post to Tavern Board"**
2. Enter a session title, description, and proposed time slots (date + time select)
3. Yellow warnings appear if any player is unavailable on a selected date
4. Click **"Post to Tavern Board"** to publish
5. Review player votes in the availability grid
6. Select a slot and click **"Proclaim This Date"** to confirm
7. All voters receive a notification when the session is confirmed
8. After the session, write a recap and click **"Save & Complete Quest"** to mark it as completed
9. Completed sessions appear on the **Session History** page

### Player Workflow

1. On the dashboard, see all posted sessions
2. Click on a session with the **"Needs your vote"** badge
3. For each slot, choose: **Available** / **Maybe** / **Unavailable**
4. Click **"Submit Availability"**
5. Add comments in the **Quest Discussion** section

### Bulletin Board

- Click **"Bulletin Board"** in the nav bar
- Post messages, reply to others, delete your own posts (admins can delete any)
- Use `@username` to mention someone (e.g., `@nenad.jokic`) — they'll receive a notification

### Settings

All users can access **Settings** (pencil icon in the nav bar) to:
- Upload an avatar (displayed in nav, grid, posts, and preferences)
- Switch theme: Dark (Dungeon), Light (Parchment), or Auto (6AM-7PM)
- Toggle between 12-hour and 24-hour time format
- Change their password
- Mark unavailability days with optional reasons
- Generate a personal calendar feed URL (iCal) with sessions + unavailability
- View the public sessions-only calendar feed URL (shareable, no auth required)

### Notifications

- The **bell icon** in the nav bar shows a red dot when you have unread notifications
- Click the bell to see your last 5 notifications
- Notifications are triggered by:
  - A session being confirmed (all voters + session creator notified)
  - Being mentioned with `@yourusername` in any post, reply, or comment
- Notifications auto-poll every 30 seconds

### Maps

- Click **"Maps"** in the hamburger menu to view the maps index
- Create multiple maps, each with their own name, image, locations, and party marker
- Click a map name or thumbnail to view the interactive Leaflet.js map
- **DM/Admin**: click anywhere on the map to add a location (name, description, icon type)
- **DM/Admin**: drag the gold party marker to update the party's current position
- **DM/Admin**: upload a custom map image (JPG, PNG, GIF, WebP, max 5MB)
- Default: a parchment placeholder is shown until a map image is uploaded
- Location pins are color-coded: red (pin), blue (city), purple (dungeon), green (tavern)
- When creating a session, DMs can optionally link it to a map location (shows map name alongside location name)

### Party Inventory (Loot Tracker)

- Click **"Party Loot"** in the hamburger menu to view the shared inventory
- **DM/Admin**: add items with name, description, quantity, category, and optional player assignment
- Categories: weapon, armor, potion, quest item, gold, general item
- Quest items are displayed in highlighted gold-bordered cards at the top
- Items can be assigned to specific players or kept in the "Party Bag"
- **DM/Admin**: reassign, edit, or delete items at any time
- Players see a read-only view of all inventory

### Session Analytics

- Click **"Analytics"** in the hamburger menu to view session statistics
- **Summary cards**: total sessions, completed, cancelled, average players per session
- **Sessions per Month**: bar chart showing session frequency over the last 12 months
- **Preferred Day**: bar chart of which days of the week confirmed sessions fall on
- **Player Attendance**: horizontal bar chart showing each player's attendance percentage
- **Streak**: consecutive weeks with at least one confirmed/completed session

### DM Tools

- Click **"DM Tools"** in the hamburger menu (DM/admin only)
- A streamdeck-style grid of customizable buttons linking to external tools
- Click **"+ Add Tool"** to create a new button with a name, icon, and URL
- Choose from 16 thematic icons: link, dice, scroll, book, music, map, sword, shield, potion, skull, dragon, wand, gem, crown, hammer, eye
- Upload a custom thumbnail or auto-fetch the website's favicon with the "Fetch Favicon" button
- Click any tool button to open it in a new tab
- Edit or delete buttons at any time

### Admin Features

The Guild Master can access **Guild Settings** (cogwheel icon) to:
- Manage user roles (promote/demote between DM and Player)
- Check for application updates
- **Communications Setup** — configure Discord, Telegram, or Viber to receive session event broadcasts:
  1. Select a provider from the dropdown
  2. Enter the required credentials (bot token, channel/chat ID)
  3. Optionally set a Public URL for clickable links in messages
  4. Click **Save**, then **Test Connection** to verify
  5. Session events (create, confirm, cancel, reopen, complete, recap) will be broadcast automatically

---

## Project Structure

```
dndplanning/
├── server.js              # Express entry point
├── package.json
├── LICENSE                # GPL-3.0 license
├── .env                   # Environment variables (not in git)
├── .env.example           # Example env file
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── db/
│   ├── schema.sql         # DDL for SQLite tables (users, sessions, slots, votes, preferences, unavailability, posts, replies, notifications)
│   └── connection.js      # SQLite connection and initialization
├── helpers/
│   ├── time.js            # Date/time formatting helpers (12h/24h)
│   ├── notifications.js   # Notification creation, @mention parsing
│   ├── messenger.js       # Omni-channel messaging (Discord, Telegram, Viber)
│   └── push.js            # PWA push notification service (Web Push / VAPID)
├── middleware/
│   ├── auth.js            # Auth middleware (login, DM check, user data, theme)
│   └── flash.js           # Flash messages
├── routes/
│   ├── auth.js            # Register, login, logout (first-login flag)
│   ├── admin.js           # User management, update check
│   ├── board.js           # Bulletin board posts, replies, delete
│   ├── calendar.js        # Personal iCal feed + public sessions-only feed
│   ├── dashboard.js       # Role-based redirect (DM/Player), welcome popup
│   ├── notifications.js   # Notification API (fetch, mark read)
│   ├── history.js          # Session history page (completed D&D/RPG sessions)
│   ├── players.js         # Guild members directory
│   ├── profile.js         # User profile (avatar, birthday, about, multiple characters, public profiles)
│   ├── sessions.js        # Session CRUD, slot confirmation, recap, comments, replies
│   ├── settings.js        # User settings (theme, time, password, unavailability, calendar)
│   ├── votes.js           # Player voting
│   ├── map.js             # Multiple maps, locations, party marker, image upload
│   ├── loot.js            # Party inventory (loot tracker)
│   ├── analytics.js       # Session analytics and charts
│   ├── dice.js            # Dice roll history API (save & retrieve rolls)
│   └── dm-tools.js        # DM Tools streamdeck page
├── views/                 # EJS templates
│   ├── partials/          # Header (theme), footer (about/GPL/support), nav (bell/clock), flash, slot grid, comments
│   ├── auth/              # Login, register pages
│   ├── dm/                # DM dashboard, session form (date+time picker), session detail
│   ├── player/            # Player dashboard, voting
│   ├── board.ejs          # Bulletin board page
│   ├── history.ejs        # Session history page
│   ├── players.ejs        # Guild members directory page
│   ├── profile.ejs        # Edit own profile page
│   ├── profile-public.ejs # Public read-only profile page
│   ├── maps.ejs           # Maps index page
│   ├── map.ejs            # Single map view (Leaflet.js)
│   ├── loot.ejs           # Party inventory page
│   ├── analytics.ejs      # Session analytics page (Chart.js)
│   ├── pwa.ejs            # PWA installation instructions page
│   └── settings.ejs       # User settings page (theme, time, password, unavailability, calendar)
├── public/
│   ├── css/style.css      # Dark + light theme, notifications, mentions, board, map, loot, analytics, PWA, characters styles
│   ├── js/app.js          # Clock, notifications, time picker, unavailability warnings, theme recheck
│   ├── manifest.json      # PWA web app manifest
│   ├── sw.js              # Service worker for PWA offline support
│   ├── offline.html       # Offline fallback page
│   └── icons/             # PWA app icons (192x192, 512x512)
└── data/                  # SQLite files + avatars + maps + thumbnails (not in git)
    ├── avatars/           # User avatar uploads
    ├── maps/              # Uploaded world map images
    └── thumbnails/        # DM Tools thumbnails (128x128)
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

### v0.9.17 (2026-02-02)

- **Google Login Admin UI** — Google OAuth credentials are now configured from Guild Settings (stored in the database) instead of .env variables; includes a step-by-step setup guide with the correct redirect URI

### v0.9.16 (2026-02-02)

**Features:**
- **Google Login** — Sign in with Google or link your existing account from Settings
- **Hidden Dice Rolls** — Toggle the lock icon to roll secretly; hidden results don't appear in public dice history
- **Dice Long-Press to Subtract** — Long-press (500ms) a die bubble on mobile to remove one die (with haptic feedback)
- **Dice History on Left + Mobile Toasts** — Desktop history sidebar moved to the left side; on mobile the sidebar is hidden and new rolls appear as auto-fading toast notifications
- **Map Fullscreen Close Button** — Floating ✕ button visible in fullscreen mode for easy exit on touch devices
- **Notification Preferences** — Choose which notification types you receive (session confirmed, session cancelled, @mentions) in Settings
- **Password Reset** — Admins can reset any player's password from Guild Settings; generates a temporary 8-character password
- **Forgot Password Hint** — Login page now shows a hint to ask the Guild Master for a password reset

**Bug Fixes:**
- Fixed user deletion failing with foreign key constraint errors (missing DELETEs for dice_rolls, characters, push_subscriptions, loot_items, dm_tools, map_locations, maps)
- Fixed confirmed session deletion failing with FK constraint (confirmed_slot_id not cleared before slot deletion)
- Fixed birthday banner persisting past midnight due to UTC vs local time comparison

### v0.9.15 (2026-02-01)

- **Faster dice history fade** — dice roll history now fades out over 60 seconds instead of 5 minutes; rolls disappear quickly to keep the screen clean, especially on mobile

### v0.9.14 (2026-02-01)

- **Fix: Active players avatar** — avatar images in the footer were missing the `/avatars/` path prefix, showing a broken image icon instead of the user's avatar

### v0.9.13 (2026-02-01)

- **Dice rolling sound** — procedural dice-on-wood sound effect plays when rolling dice; generated via Web Audio API with filtered noise bursts and low wood resonance, no external audio files needed

### v0.9.12 (2026-02-01)

- **Active Players footer** — real-time footer bar showing who's currently online with avatars, usernames, and activity duration; players marked "away" after 1 minute of inactivity (dimmed); removed after 5 minutes
- **Real-time dice history** — heartbeat-driven polling every 15 seconds detects new dice rolls and refreshes the history sidebar for all active users; max ~15s latency instead of 10s fixed polling
- **Presence heartbeat API** — new `POST /api/dice/presence/heartbeat` endpoint for presence tracking and dice change detection

### v0.9.11 (2026-02-01)

- **Inactivity fade** — Dice roll history gradually fades out over 5 minutes of inactivity; rolls disappear completely when idle and reappear bright when someone rolls again
- **Fix: iPhone home gesture** — Replaced mobile bottom drawer with a narrower right sidebar; no more accidental app exits on iPhone when interacting with the history strip

### v0.9.10 (2026-02-01)

- **Fix: History order** — Dice roll history now correctly shows oldest at top (faded) and newest at bottom (bright); oldest rolls fade out and disappear naturally

### v0.9.9 (2026-02-01)

- **Dice Roll History** — global sidebar showing the last 10 dice rolls from all users in real-time; newest rolls appear at the bottom with an opacity gradient (oldest fades out)
- **History API** — new `POST /api/dice/roll` and `GET /api/dice/history` endpoints for saving and retrieving dice rolls
- **Desktop sidebar** — thin fixed right sidebar (200px) with non-blocking pointer-events; rolls displayed with username, description, and result
- **Mobile bottom drawer** — collapsible bottom strip on portrait screens; tap the grab handle to expand and see full history
- **Auto-polling** — history refreshes every 10 seconds and immediately after each roll

### v0.9.8 (2026-02-01)

- **Center drop spawn** — Dice now spawn above the center of the screen and drop down with random scatter, always fully visible on any device
- **Staggered horizontal layout** — Multiple dice spread evenly along the X axis above center before dropping

### v0.9.7 (2026-02-01)

- **Per-die frustum bounds** — Visible area is now computed at each die's actual spawn height, not at ground level; fixes dice appearing outside the screen on all devices
- **Lower spawn height** — Dice spawn at y=0.5 (near ground) instead of y=1.5, keeping them well within the visible frustum
- **Larger margin** — Increased edge margin from 1.2 to 1.5 units so entire dice are visible including edges

### v0.9.6 (2026-02-01)

- **Camera-aware spawn** — Dice spawn positions are calculated from actual visible screen bounds (camera FOV + aspect ratio), so they're always fully visible on any device and orientation
- **Top-right corner to center** — Dice spawn in the visible top-right corner and travel diagonally toward the center of the screen
- **Responsive walls** — Invisible physics walls now match the visible screen edges, adapting to portrait/landscape
- **Adaptive grid** — Grid columns and spacing auto-adjust to the available screen width; narrow portrait phones use fewer columns

### v0.9.5 (2026-02-01)

- **Staggered dice spawning** — Dice spawn in a grid pattern with 1.5-unit spacing so they never overlap, even D100 pairs
- **50% canvas travel** — Dice now travel at least half the play area from top-left toward center before settling
- **Proper dice-dice collisions** — Reduced ground friction (0.5) and increased dice-dice restitution (0.35) for natural bouncing interactions

### v0.9.4 (2026-02-01)

- **Top-left corner spawn** — Dice now spawn from the top-left corner and travel toward the center of the screen
- **Elongated D10 shape** — D10 now has proper pentagonal trapezohedron proportions with taller poles and narrower ring for a realistic shape
- **D100 as two D10 dice** — Rolling D100 now throws two physical D10 dice: one with 00-90 (tens) and one with 0-9 (units), combined for the final result
- **Faster physics** — Stronger gravity (-80), higher damping (0.4), and aggressive sleep detection for quicker settling

### v0.9.3 (2026-02-01)

- **Dice edge outlines** — Thin dark brown lines on all die edges highlight the shape and dimensions of each die face

### v0.9.2 (2026-02-01)

- **Fast dice animation** — Entire roll animation completes within 1 second max; dice settle quickly with strong gravity (-50) and high damping (0.3)
- **Top-right corner throw** — Dice now fall from the top-right corner and travel toward the center of the page with a natural arc
- **2-second display** — After dice stop, they remain visible for 2 seconds before cleanup
- **Dice-dice collisions** — Multiple dice properly bump off each other during the throw

### v0.9.1 (2026-02-01)

- **Automatic cache busting** — All CSS and JS asset URLs now include a `?v=` query string tied to the app version; when the app updates, browsers automatically fetch fresh files on the next page load
- **Network-first service worker** — Service worker fetch strategy changed from cache-first to network-first for assets; fresh content is always served when online, cached copies used only when offline
- **Service worker no-cache headers** — `sw.js` is now served with `Cache-Control: no-cache` so the browser always checks for a new version on every page load

### v0.9.0 (2026-02-01)

- **Two-phase animation** — Pure physics simulation runs first with zero quaternion manipulation, allowing natural trajectories with inertia and real bouncing; after all dice sleep, a smooth 400ms visual slerp corrects orientation to the pre-determined result
- **Real dice-dice collisions** — NaiveBroadphase guarantees all-pairs collision detection; dedicated dice-dice contact material (friction 0.4, restitution 0.4) makes dice bounce off each other naturally
- **Balanced D10/D100 shape** — Retuned pentagonal trapezohedron proportions (poles ±0.88r, ring ±0.31r, radius 0.77r) for a balanced shape that's slightly taller than wide
- **Even spawn distribution** — Multiple dice are distributed evenly around a circle based on index, ensuring they converge and collide in the center
- **Lower angular velocity** — Reduced from ±20 to ±12 so individual face transitions are visible during the roll

### v0.8.9 (2026-02-01)

- **Dice-dice collisions** — Multiple dice now physically collide and bounce off each other using SAP broadphase collision detection; no more ghost dice passing through
- **Pre-determined rolls** — Results are computed before the throw; each die starts oriented to show a different number than the final result, then the physics simulation rolls it with a smooth quaternion slerp correction to land on the target face
- **Initial orientation guarantee** — The starting face is always different from the final face, so you see a real transition during every roll

### v0.8.8 (2026-02-01)

- **Results banner at bottom** — Dice roll results now appear at the bottom of the screen instead of the top for better visibility
- **Fix: Dice actually roll across faces** — 120 Hz sub-stepped physics (was 60 Hz single-step) with proper delta-time accumulation eliminates jitter; higher angular velocity (±20) and lower damping (0.02/0.08) ensure dice tumble across many faces before settling
- **Fix: D10/D100 shape** — Taller, pointier proportions (poles at ±1.1r, ring at ±0.28r, radius 0.72r) matching a real pentagonal trapezohedron
- **Higher spawn + stronger throw** — Dice spawn at height 2-3 (was 1-1.5) with throw speed 6-10 (was 5-8) for longer visible arcs

### v0.8.7 (2026-02-01)

- **Realistic dice throwing** — Dice are now thrown laterally from the edge of the play area toward the center with momentum, bouncing off walls and rolling across the surface face-by-face before settling; replaces the old "drop and vibrate" behavior
- **Sleep-based settling** — Uses cannon-es body sleep detection instead of manual velocity thresholds; dice stop cleanly with zero vibration once at rest
- **Random initial orientation** — Each die starts with a random quaternion rotation so the initial face shown is unpredictable
- **Fix: D10/D100 triangle seams** — Rebuilt D10 mesh with shared kite-face normals computed from face diagonals; auto-corrects triangle winding to always face outward; eliminates visible triangle artifacts
- **Stronger gravity** — Increased to -20 for faster ground contact and more natural arc
- **Minimal air damping** — Reduced linear/angular damping to 0.05/0.15; ground friction now does the actual slowing like real physics

### v0.8.6 (2026-02-01)

- **Fix: Dice actually tumble** — Angular velocity increased to ±16 with 0.5 damping; dice now visibly roll across multiple faces before settling instead of vibrating in place
- **Fix: D10/D100 rendering** — Reversed face triangle winding so normals point outward; faces are no longer invisible due to backface culling
- **Bouncier physics** — Restitution increased to 0.35 so dice bounce on impact and roll naturally
- **Higher lateral velocity** — Dice spread across the surface with visible rolling motion

### v0.8.5 (2026-02-01)

- **Slower dice rotation** — Angular velocity reduced from ±10 to ±3 and damping increased to 0.4 for a much more natural, readable roll
- **Shorter display time** — Dice and results banner now stay on screen for 5 seconds instead of 10

### v0.8.4 (2026-02-01)

- **Fix: Dice not visible on desktop** — removed CSS canvas sizing conflict and bumped service worker cache to force fresh file loading on all browsers
- **Fix: Numbers on all dice faces** — converted all polyhedra to non-indexed geometry with proper per-face UV mapping via face-plane projection; numbers now appear centered on every face of D4, D8, D10, D12, and D20
- **Fix: D10 geometry spikes** — adjusted pentagonal trapezohedron vertex proportions for a rounder, more realistic shape
- **Fix: Physics realism** — reduced gravity (-12 vs -30), added linear/angular damping (0.3), increased friction (0.6), lower angular velocity; dice now tumble naturally instead of shaking
- **Fix: Roll duration** — dice settle in ~2 seconds (120 frames max) instead of 6 seconds
- **No overlay background** — removed dark backdrop behind rolling dice for a cleaner look
- **No shadows** — removed shadow rendering entirely for better performance and appearance
- **Smaller face numbers** — font size adapts to digit count (35%/28%/22%) for clean centered display on all die types
- **D4 bottom-face reading** — D4 result is now read from the ground face (standard convention) instead of ambiguous top-face detection
- **D6 opposite faces** — D6 face values now follow standard convention where opposite faces sum to 7
- **Proper texture cleanup** — canvas textures are now explicitly disposed alongside materials to prevent memory leaks

### v0.8.3 (2026-02-01)

- **Fix: 3D dice not rendering** — cannon-es is an ES module and was not loading as a global; converted dice-roller.js to an ES module with proper `import` statement; dice now physically tumble on screen with full 3D animation
- **Visible dice overlay** — added dark semi-transparent backdrop behind dice so they stand out against page content
- **Dice persist on screen** — 3D dice now stay visible for the full 10 seconds alongside the results banner, then both fade away together; hovering the banner also keeps the dice visible
- **Brighter dice textures** — changed face number color from dark to light gold (#f0d9a0) for better readability on the brown dice surfaces

### v0.8.2 (2026-02-01)

- **3D Dice Roller** — interactive 3D dice roller with realistic physics powered by Three.js and cannon-es; supports D4, D6, D8, D10, D12, D20, and D100 with numbered face textures using MedievalSharp font
- **Floating D20 Button** — gold-themed D20 FAB button in the bottom-right corner (logged-in users only); click to expand the dice selection bubble menu
- **Bubble Menu** — 7 die-type buttons expand upward with staggered animation; click to add dice, right-click to remove; counter badges show quantity
- **Split Roll/Clear** — when dice are selected, the D20 button transforms into a ROLL button with a clear (X) button alongside
- **Canvas Overlay** — full-screen transparent WebGL canvas for 3D dice rendering with top-down camera, warm lighting, and shadow-catching ground plane
- **Physics Simulation** — cannon-es physics with gravity, invisible walls, restitution, and friction for natural dice tumbling; velocity-based settling detection with 6-second safety timeout
- **Results Banner** — fixed top-center gold-bordered banner showing individual die results and total; auto-hides after 10 seconds, persists on hover
- **WebGL Fallback** — text-only random results if WebGL is unavailable
- **CDN Dependencies** — Three.js r160 and cannon-es 0.20 loaded from unpkg CDN only for logged-in users

### v0.8.1 (2026-02-01)

- **Tavern Login Page** — redesigned login page with Quest Planner logo above the "Enter the Tavern" heading, warm ambient glow effect, and floating ember particles for a cozy tavern atmosphere
- **Fix: Safari character grid** — characters were not displayed in grid layout on Safari (MacBook); added missing `--bg-input` CSS variable and `-webkit-` vendor prefixes for cross-browser grid support
- **Fix: Character card outlines** — card outline/shadow was missing on Safari; added explicit `box-shadow` with vendor prefixes
- **Fix: Character sheet tabs** — tab buttons appeared as plain OS buttons on desktop Safari and Chrome instead of styled tabs; added `appearance: none` and `-webkit-appearance: none` resets
- **Fix: Character sheet layout** — added intermediate responsive breakpoint (900px) for medium-width screens so the sheet doesn't jump directly from 3-column to 1-column layout
- **Improved sheet header grid** — added 768px breakpoint for 2-column header on tablets

### v0.8.0 (2026-02-01)

- **D&D 5e Character Sheet** — full character sheet with 3 tabbed sections: Stats & Combat (ability scores, saving throws, 18 skills, AC/initiative/speed, HP, attacks, personality, equipment, currency), Biography (age, height, weight, appearance, backstory, allies, treasure), and Spellcasting (cantrips, spell levels 1-9 with slots and prepared checkboxes)
- **Edit & read-only modes** — character owners get an editable form with sticky save bar; other logged-in users see the same layout with all fields disabled
- **Sheet on profile cards** — "Create Sheet" / "View Sheet" button on each character card on your own profile; "Character Sheet Available" text indicator on public profile character cards
- **Sheet in edit modal** — "Open Character Sheet" link in the character edit modal for quick access
- **Sheet on character detail** — "View Character Sheet" button on the public character detail page
- **JSON blob storage** — entire sheet stored as a single `sheet_data` TEXT column (JSON) on the `characters` table; avoids 100+ column sprawl
- **Removed nav icon** — removed the app icon from the navigation bar brand; kept in welcome modal
- **Class/race styling** — bumped character name to 1.05rem, reduced class/race meta to 0.75rem with gold-dim color
- **DB migration** — added `sheet_data` column to the `characters` table

### v0.7.5.2 (2026-02-01)

- **Multiple Maps** — replaced single World Map with a multi-map system; create and manage multiple maps, each with their own name, image, locations, and party marker
- **Maps index page** — new `/map` listing page with thumbnails, names, and links to individual maps; DMs can create new maps and admins can delete them
- **Auto-migration** — existing World Map data (image, locations, party position) is automatically migrated to the new multi-map system on first startup
- **App icon in header** — Quest Planner icon now displayed in the navigation bar next to the app name
- **Welcome modal icon** — app icon shown in the first-login welcome popup above the "Enter the Tavern" button
- **iOS push notification fixes** — unique notification tags (`renotify: true`), VAPID subject validation for Safari, service worker cache bump to force re-registration, `purpose: "any maskable"` on manifest icons
- **iOS troubleshooting guide** — new section on the Install App page with step-by-step iOS push notification troubleshooting
- **Location dropdown with map name** — session creation location selector now shows "Map Name — Location Name" for clarity across multiple maps
- **DB migration** — added `maps` table and `map_id` column on `map_locations`

### v0.7.5.1 (2026-02-01)

- **Character Class & Race** — characters now have Class and Race fields; displayed below the character name on profile grids and the detail page
- **Character detail page** — dedicated page for viewing a character's full backstory, class, race, and description; accessible by clicking a character on any player profile
- **Higher quality character thumbnails** — character avatars are now cropped to 256x256 (up from 128x128) for sharper thumbnails
- **Improved player profiles** — public profiles now show a clean character grid with thumbnails, names, and class/race; click to view full details
- **Clickable character cards** — on your own profile page, clicking any character card opens the edit modal directly
- **Fix: Settings radio buttons** — Theme and Time Format radio buttons are now properly aligned on the same line
- **DB migration** — added `class` and `race` columns to the `characters` table

### v0.7.5 (2026-02-01)

- **Push notifications** — PWA push notifications for session events (create, confirm, cancel, complete, recap) via Web Push API with auto-generated VAPID keys; enable/disable from the Install App page
- **Multiple characters** — create and manage multiple characters on your profile, each with a name, description (Markdown), and avatar (center-cropped to 256x256)
- **Characters grid** — profile and public profile pages display characters in a responsive thumbnail grid with avatars and names
- **Markdown profiles** — About section and character descriptions now support full Markdown rendering (bold, italic, lists, links, etc.)
- **Legacy character migration** — old single-character data shown in a "Legacy Character" section; users can recreate as a new character
- **Fix: Favicon fetch** — DM Tools "Fetch Favicon" button now works correctly (added JSON body parser middleware)
- **Fix: What's New popup** — popup now shows current version changelog instead of stale v0.7.0 content
- **DB migration** — added `characters`, `push_subscriptions`, and `vapid_config` tables
- **New dependency** — `web-push` for VAPID-based push notifications

### v0.7.4 (2026-02-01)

- **Fix: Completed session dates** — completed sessions on the dashboard now show the session date (not creation date) in the card footer; confirmed date is also displayed for completed sessions alongside confirmed ones
- **Session date in detail view** — completed session detail now shows the session date below the "Reopen Quest Board" button
- **DM Tools favicon scraping** — new "Fetch Favicon" button in the add/edit tool forms; auto-fetches the website's apple-touch-icon or favicon.ico, crops to 128x128, saves as thumbnail
- **Completion notifications** — Discord/Telegram/Viber bot now sends a notification when a session is completed (with recap preview) and when a recap is updated
- **Map pin navigation** — clickable pin icon added before each location name in the map locations table; clicking scrolls to map and centers on that location
- **PWA support** — Progressive Web App with manifest.json, service worker (offline page), and app icons; installable on mobile and desktop
- **Install App page** — new `/pwa` page with step-by-step installation instructions for Android, iOS, and desktop browsers; includes real-time install status detection
- **Navigation update** — "Install App" link added to hamburger menu

### v0.7.3 (2026-01-31)

- **Discord setup guide** — replaced one-line tooltip with a full 11-step walkthrough embedded in the Guild Settings page, covering app creation, token copy, OAuth2 bot invite with correct permissions, and channel ID retrieval
- **Better Discord error messages** — "Missing Access" now explains that the bot needs to be invited via OAuth2 URL; "Unknown Channel" suggests checking the channel ID; "Missing Permissions" lists which permissions are needed; invalid token errors direct to the Reset Token page
- **Actionable error diagnostics** — all Discord errors now include specific fix instructions instead of raw API error codes

### v0.7.2 (2026-01-31)

- **Thumbnail center-crop** — uploaded thumbnails are now automatically center-cropped and resized to 128x128px using sharp (server-side)
- **Grid size selector** — DM Tools page now has a grid size picker (16x16, 32x32, 64x64, 128x128) that controls icon/thumbnail and card size; preference saved to localStorage
- **Scalable SVG icons** — tool icons now use viewBox-only SVGs so they scale correctly at all grid sizes
- **New dependency** — `sharp` for server-side image processing (center-crop thumbnails on upload)

### v0.7.1 (2026-01-31)

- **Fix: Map fullscreen** — fullscreen now properly overrides card padding and box-shadow for true full-viewport display
- **Fix: Pin editing** — all map pins (including default "pin" type) are now fully editable and deletable; replaced fragile string escaping with data-driven event handlers
- **DM Tools thumbnails** — option to upload custom thumbnail images for tool buttons; thumbnails replace the SVG icon when set
- **Thumbnail management** — edit modal shows current thumbnail with option to remove or replace; old files are cleaned up on replacement or deletion

### v0.7.0 (2026-01-31)

- **Map fullscreen** — immersive fullscreen mode for the world map; toggle via button or Escape key
- **Pin editing** — DMs can edit any map location's name, description, and icon type from map popups or the locations table
- **DM Tools** — streamdeck-style customizable tool board at `/dm-tools` for quick access to external resources
- **Tool CRUD** — add, edit, delete tool buttons with 16 thematic icons (dice, scroll, book, music, sword, etc.)
- **What's New modal** — post-update changelog popup shown to users on first login after a version update
- **Support badges** — Buy Me a Coffee and PayPal badges (shields.io) in the What's New modal
- **GitHub release link** — direct link to full changelog on GitHub from the What's New modal
- **Version tracking** — `last_seen_version` column on users table to track which version each user has seen
- **Navigation update** — DM Tools link added to hamburger menu (DM/admin only)
- **DB migration** — added `dm_tools` table and `last_seen_version` column on users

### v0.6.1 (2026-01-31)

- **World Map** — interactive Leaflet.js map at `/map` with L.CRS.Simple coordinate system
- **Map locations** — DM/admin can click to add locations with name, description, and icon type (pin, city, dungeon, tavern)
- **Party marker** — draggable gold pulsing marker showing party position; auto-saves on drag
- **Custom map upload** — admin can upload a world map image (max 5MB); default parchment SVG placeholder
- **Session locations** — optional location dropdown on session creation form; location name shown in session detail
- **Party Inventory (Loot Tracker)** — shared inventory at `/loot` with add, assign, edit, delete
- **Loot categories** — weapon, armor, potion, quest item, gold, general item with color-coded badges
- **Quest items** — highlighted gold-bordered cards displayed at top of inventory
- **Item assignment** — DM can assign items to specific players or keep in party bag
- **Session Analytics** — Chart.js dashboard at `/analytics` with four stat cards and three charts
- **Sessions per month** — bar chart of session frequency over the last 12 months
- **Preferred day** — bar chart of confirmed session day-of-week distribution
- **Player attendance** — horizontal bar chart showing attendance percentage per player
- **Streak counter** — consecutive weeks with sessions, displayed with fire emoji
- **Comms tooltips** — help text added under each provider field in Communications Center
- **Navigation update** — World Map, Party Loot, and Analytics links added to hamburger menu
- **DB migration** — added `map_locations`, `map_config`, `loot_items` tables and `location_id` column on sessions

### v0.6.0 (2026-01-31)

- **Omni-Channel Notifications** — broadcast session lifecycle events to Discord, Telegram, or Viber
- **Communications Center** — new admin UI section in Guild Settings to configure messaging provider
- **Discord integration** — rich embed messages with color-coded session events via discord.js bot
- **Telegram integration** — HTML-formatted messages with clickable links via Telegram Bot API
- **Viber integration** — rich media messages with action buttons via Viber REST API; automatic webhook registration
- **Messenger service** — strategy-pattern `helpers/messenger.js` dispatches to active provider; fire-and-forget (never blocks requests)
- **Session lifecycle hooks** — session create, confirm, cancel, and reopen events trigger broadcasts
- **Test connection** — admin can send a test message to verify provider configuration
- **Token masking** — saved tokens are masked in the UI for security
- **Viber webhook endpoint** — `/webhooks/viber` route responds to Viber validation pings

### v0.5.5 (2026-01-31)

- **Profile page** — dedicated `/profile` page for editing avatar, birthday, about text, and character info with character avatar
- **Public profiles** — read-only `/profile/:username` pages showing user info, birthday (month + day), about, and character
- **Guild Members directory** — `/players` page with a grid of all members linking to their profiles
- **Profile links** — usernames in bulletin board and session comments now link to public profiles
- **Birthday banner** — dashboard shows a festive banner when a guild member has a birthday today
- **Vote confirmation** — "Submit Availability" button now shows a JS confirm dialog before submitting
- **Settings cleanup** — avatar moved to Profile page, removed First Day of Week setting; Settings now contains only preferences
- **Hamburger menu update** — Profile and All Players links added; reordered to Profile → All Players → Settings → ...
- **DB migration** — added `birthday`, `about`, `character_info`, `character_avatar` columns to users table

### v0.5.1 (2026-01-30)

- **Dashboard sorting** — sessions are now sorted by status: open first, then confirmed by date, then completed by date (newest first)

### v0.5.0 (2026-01-30)

- **Session Recap** — DMs can write a recap/summary on confirmed sessions; saving completes the quest
- **Completed status** — new `completed` session status with blue/teal badge styling
- **Editable recap** — DMs can toggle between read-only and edit mode on completed sessions (no page reload)
- **Player recap view** — players see the recap as a read-only styled card
- **Session History page** — `/history` shows all completed D&D/RPG sessions in reverse chronological order
- **Hamburger menu** — added "Session History" link with book icon between Bulletin Board and Feedback
- **Markdown recaps** — recap text supports full Markdown rendering (headings, bold, italic, lists, horizontal rules) via `marked`
- **DB migration** — idempotent SQLite table rebuild to add `completed` to CHECK constraint and `summary` column

### v0.4.0 (2026-01-30)

- **Hamburger menu** — collapsible navigation menu with profile, settings, guild settings, bulletin board, feedback, and logout
- **Session categories** — D&D, RPG, Game Night, Casual with color-coded left border on cards
- **User delete** — admin can delete users from Guild Settings
- **Mention autocomplete** — typing `@` in text fields shows a dropdown of matching usernames

### v0.3.2 (2026-01-30)

- **Notifications** — bell icon in nav with unread badge, dropdown with last 5 notifications, auto-polls every 30s
- **Session confirmation notifications** — all voters and the session creator are notified when a quest date is confirmed
- **@Mentions** — type `@username` in board posts, replies, or session comments to tag users
- **Mention highlighting** — mentioned usernames rendered in gold accent with background
- **Mention notifications** — tagged users receive a notification linking to the relevant page

### v0.3.1 (2026-01-30)

- **GPL-3.0 License** — LICENSE file added, project is now officially open source
- **Redesigned footer** — about section, GitHub link, GPL-3.0 link, Buy Me a Coffee, PayPal
- **First-login welcome popup** — thanks users and shows support links (only shown once per account)
- **Author and license fields** in package.json

### v0.3.0 (2026-01-30)

- **Light / Dark / Auto theme** — three modes stored per user; CSS custom property overrides; auto switches at 6AM/7PM
- **Live clock in nav bar** — updates every second, respects 12h/24h format
- **Bulletin Board** — global post/reply board at `/board` with delete (author + admin)
- **Session comments** — "Quest Discussion" threads on every session detail page with replies
- **Public sessions-only iCal feed** — `/calendar/sessions/feed.ics`, no auth required
- **Date + time picker** — replaced `datetime-local` with separate date input and time select (30-min increments)
- **Dynamic unavailability warnings** — inline yellow warnings on session form when a date conflicts with player availability

### v0.2.0 (2026-01-29)

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
- Session lifecycle: open -> confirmed -> cancelled / reopened
- Role system: Guild Master (admin), Dungeon Master, Adventurer (player)
- First registered user becomes admin automatically
- Admin user management (role assignment)
- Session deletion (admin only)
- Dark fantasy themed UI
- SQLite database with Docker volume persistence
- Docker and Docker Compose support

---

## License

Quest Planner is free software: you can redistribute it and/or modify it under the terms of the **GNU General Public License v3.0** as published by the Free Software Foundation.

See the [LICENSE](LICENSE) file for details, or visit https://www.gnu.org/licenses/gpl-3.0.html.

---

## Support

If you find Quest Planner useful, consider supporting the project:

- [Buy Me a Coffee](https://buymeacoffee.com/nenadjokic)
- [PayPal](https://paypal.me/nenadjokicRS)

Made with love by [Nenad Jokic](https://github.com/nenadjokic)
