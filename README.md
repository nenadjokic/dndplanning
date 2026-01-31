# Quest Planner v0.5.5 — D&D Session Scheduler

> **Latest release:** v0.5.5 (2026-01-31)

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
- **User Profile** — Avatar upload, birthday, about section, character info with character avatar
- **Public Profiles** — View any guild member's profile page with avatar, birthday, about, and character
- **Guild Members Directory** — `/players` page showing all members with links to their profiles
- **User Settings** — Time format toggle, theme toggle, password change
- **Unavailability Days** — Players mark dates they can't play; DM sees these when creating sessions
- **Calendar Feed (iCal)** — Personal feed (sessions + unavailability) and public sessions-only feed
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
│   └── notifications.js   # Notification creation, @mention parsing
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
│   ├── profile.js         # User profile (avatar, birthday, about, character, public profiles)
│   ├── sessions.js        # Session CRUD, slot confirmation, recap, comments, replies
│   ├── settings.js        # User settings (theme, time, password, unavailability, calendar)
│   └── votes.js           # Player voting
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
│   └── settings.ejs       # User settings page (theme, time, password, unavailability, calendar)
├── public/
│   ├── css/style.css      # Dark + light theme, notifications, mentions, board styles
│   └── js/app.js          # Clock, notifications, time picker, unavailability warnings, theme recheck
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
