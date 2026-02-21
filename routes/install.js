const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const router = express.Router();

const lockFile = path.join(__dirname, '..', 'data', 'installed.lock');
const envFile = path.join(__dirname, '..', '.env');
const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');
const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');

// Check if already installed
function isInstalled() {
  return fs.existsSync(lockFile);
}

// Middleware to prevent access if already installed
function requireNotInstalled(req, res, next) {
  if (isInstalled()) {
    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Already Installed</title>
        <style>
          body { font-family: sans-serif; max-width: 600px; margin: 100px auto; text-align: center; }
          h1 { color: #c0392b; }
        </style>
      </head>
      <body>
        <h1>⚠️ Already Installed</h1>
        <p>Quest Planner is already installed on this server.</p>
        <p>To reinstall, delete the <code>data/installed.lock</code> file and restart the application.</p>
        <p><a href="/">Go to Quest Planner</a></p>
      </body>
      </html>
    `);
  }
  next();
}

// GET /install - Show installation form
router.get('/', requireNotInstalled, (req, res) => {
  res.render('install', { error: null });
});

// POST /install - Process installation
router.post('/', requireNotInstalled, async (req, res) => {
  try {
    const { admin_username, admin_password, admin_password_confirm, app_name, session_secret } = req.body;

    // Validation
    const errors = [];

    if (!admin_username || admin_username.length < 3) {
      errors.push('Admin username must be at least 3 characters');
    }

    if (!admin_password || admin_password.length < 6) {
      errors.push('Admin password must be at least 6 characters');
    }

    if (admin_password !== admin_password_confirm) {
      errors.push('Passwords do not match');
    }

    if (!app_name || app_name.trim().length === 0) {
      errors.push('Application name is required');
    }

    if (errors.length > 0) {
      return res.render('install', { error: errors.join('<br>') });
    }

    // Create data directory if it doesn't exist
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Check if database already exists with users
    let db;
    if (fs.existsSync(dbPath)) {
      db = new Database(dbPath);
      const existingUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
      if (existingUsers && existingUsers.count > 0) {
        db.close();
        return res.render('install', {
          error: 'Database already exists with users. To reinstall, delete the database file at: data/dndplanning.db'
        });
      }
    } else {
      // Create new database
      db = new Database(dbPath);

      // Read and execute schema
      const schema = fs.readFileSync(schemaPath, 'utf8');
      db.exec(schema);
    }

    // Add columns that are in migrations (not in base schema)
    try {
      db.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN birthday TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN about TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN character_info TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN character_avatar TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN socials TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN theme TEXT DEFAULT \'dark\'');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN time_format TEXT DEFAULT \'24h\'');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN calendar_token TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN week_start TEXT DEFAULT \'monday\'');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN last_seen_version TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN google_id TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE users ADD COLUMN google_email TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN category TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN recap TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN recap_author_id INTEGER REFERENCES users(id)');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN recap_posted_at TEXT');
    } catch (e) { /* already exists */ }
    try {
      db.exec('ALTER TABLE votes ADD COLUMN created_at TEXT DEFAULT (datetime(\'now\'))');
    } catch (e) { /* already exists */ }

    // Create additional tables that might not be in base schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        race TEXT,
        class TEXT,
        description TEXT,
        avatar TEXT,
        sheet_data TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dice_rolls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        session_id INTEGER REFERENCES sessions(id),
        dice_type TEXT NOT NULL,
        result INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_path TEXT,
        party_x REAL DEFAULT 50,
        party_y REAL DEFAULT 50,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        parent_id INTEGER REFERENCES maps(id),
        map_type TEXT NOT NULL DEFAULT 'overworld',
        pin_x REAL DEFAULT 50,
        pin_y REAL DEFAULT 50
      );

      CREATE TABLE IF NOT EXISTS map_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        x REAL NOT NULL DEFAULT 50,
        y REAL NOT NULL DEFAULT 50,
        icon TEXT NOT NULL DEFAULT 'pin',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        map_id INTEGER REFERENCES maps(id)
      );

      CREATE TABLE IF NOT EXISTS loot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        quantity INTEGER DEFAULT 1,
        category TEXT,
        held_by INTEGER REFERENCES users(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dm_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT DEFAULT 'link',
        sort_order INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        thumbnail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        question TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        UNIQUE(poll_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS post_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(post_id, user_id, emoji)
      );

      CREATE TABLE IF NOT EXISTS reply_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reply_id INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(reply_id, user_id, emoji)
      );

      CREATE TABLE IF NOT EXISTS notification_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        notification_type TEXT NOT NULL,
        notification_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, notification_type, notification_id)
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Create admin user
    const hashedPassword = bcrypt.hashSync(admin_password, 10);
    try {
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(
        admin_username,
        hashedPassword,
        'admin'
      );
    } catch (err) {
      db.close();
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.render('install', {
          error: 'Admin username already exists. Please choose a different username or delete the database to start fresh.'
        });
      }
      throw err;
    }

    db.close();

    // Generate session secret if not provided
    const finalSessionSecret = session_secret || require('crypto').randomBytes(32).toString('hex');

    // Try to create .env file (optional - may fail on read-only platforms like Render)
    const envContent = `# Quest Planner Configuration
# Generated by installer on ${new Date().toISOString()}

# Application
NODE_ENV=production
PORT=3000
APP_NAME=${app_name}

# Session
SESSION_SECRET=${finalSessionSecret}

# Security (set to true if behind reverse proxy with HTTPS)
TRUST_PROXY=false
SECURE_COOKIES=false

# Database path (relative to project root)
DB_PATH=./data/dndplanning.db
`;

    let envCreated = false;
    let isCloudPlatform = false;

    // Detect if running on cloud platform (read-only filesystem)
    const cloudPlatforms = ['RENDER', 'RAILWAY_ENVIRONMENT', 'FLY_APP_NAME', 'HEROKU_APP_NAME'];
    isCloudPlatform = cloudPlatforms.some(envVar => process.env[envVar]);

    try {
      fs.writeFileSync(envFile, envContent);
      envCreated = true;
    } catch (err) {
      // .env creation failed - this is OK on cloud platforms
      console.log('[Installer] Could not create .env file (platform may be read-only):', err.message);

      // On cloud platforms, this is expected and fine
      if (!isCloudPlatform) {
        console.warn('[Installer] Warning: .env file creation failed on non-cloud platform');
      }
    }

    // Create lock file
    fs.writeFileSync(lockFile, new Date().toISOString());

    // Success page with auto-restart attempt
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Installation Complete</title>
        <style>
          body {
            font-family: 'MedievalSharp', cursive;
            max-width: 700px;
            margin: 50px auto;
            padding: 2rem;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            color: #e8e6e3;
          }
          .success-box {
            background: #1e2a1e;
            border: 2px solid #27ae60;
            border-radius: 8px;
            padding: 2rem;
            text-align: center;
          }
          h1 { color: #27ae60; margin-top: 0; }
          .check { font-size: 4rem; color: #27ae60; }
          .info-box {
            background: rgba(212, 168, 67, 0.1);
            border: 1px solid #d4a843;
            border-radius: 6px;
            padding: 1.5rem;
            margin: 1.5rem 0;
            text-align: left;
          }
          .info-box h3 { color: #d4a843; margin-top: 0; }
          code {
            background: rgba(0,0,0,0.3);
            padding: 2px 6px;
            border-radius: 3px;
            color: #d4a843;
            font-family: monospace;
          }
          .btn {
            display: inline-block;
            padding: 12px 24px;
            background: #d4a843;
            color: #1a1a1a;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            margin-top: 1rem;
            transition: background 0.2s;
            border: none;
            cursor: pointer;
            font-size: 1rem;
          }
          .btn:hover { background: #e8c468; }
          ul { text-align: left; line-height: 1.8; }
          .warning {
            background: rgba(192, 57, 43, 0.1);
            border: 1px solid #c0392b;
            border-radius: 6px;
            padding: 1rem;
            margin: 1rem 0;
          }
          .restart-box {
            background: rgba(39, 174, 96, 0.1);
            border: 2px solid #27ae60;
            border-radius: 6px;
            padding: 1.5rem;
            margin: 1.5rem 0;
          }
          .restart-box h3 { color: #27ae60; margin-top: 0; }
          .countdown {
            font-size: 2rem;
            color: #27ae60;
            font-weight: bold;
            margin: 1rem 0;
          }
          .spinner {
            border: 3px solid rgba(39, 174, 96, 0.3);
            border-top: 3px solid #27ae60;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 1rem auto;
            display: none;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .manual-instructions {
            display: none;
            background: rgba(212, 168, 67, 0.1);
            border: 1px solid #d4a843;
            border-radius: 6px;
            padding: 1.5rem;
            margin: 1.5rem 0;
          }
          .manual-instructions h3 { color: #d4a843; margin-top: 0; }
        </style>
        <link href="https://fonts.googleapis.com/css2?family=MedievalSharp&display=swap" rel="stylesheet">
      </head>
      <body>
        <div class="success-box">
          <div class="check">✓</div>
          <h1>Quest Planner Installed Successfully!</h1>
          <p>Your D&D session planning tool is ready to use.</p>

          <div class="info-box">
            <h3>📋 Installation Summary</h3>
            <ul>
              <li><strong>Application Name:</strong> ${app_name}</li>
              <li><strong>Admin Username:</strong> ${admin_username}</li>
              <li><strong>Database:</strong> Created with schema and tables</li>
              <li><strong>Configuration:</strong> ${envCreated ? '.env file generated' : 'Using platform environment variables'}</li>
              ${isCloudPlatform ? '<li><strong>Platform:</strong> Cloud platform detected (Render/Railway/Fly.io)</li>' : ''}
            </ul>
          </div>

          ${!envCreated && isCloudPlatform ? `
          <div class="info-box">
            <h3>☁️ Cloud Platform Configuration</h3>
            <p>Running on a cloud platform. Environment variables should be set in your platform dashboard:</p>
            <ul>
              <li><code>SESSION_SECRET</code> = ${finalSessionSecret}</li>
              <li><code>NODE_ENV</code> = production</li>
              <li><code>TRUST_PROXY</code> = true</li>
              <li><code>SECURE_COOKIES</code> = true</li>
            </ul>
            <p><small>💡 Copy the SESSION_SECRET above and set it in your platform's environment variables for security.</small></p>
          </div>
          ` : ''}

          <div class="restart-box" id="restart-box">
            <h3>🔄 Auto-Restart in Progress...</h3>
            <p>The server will restart automatically in <span class="countdown" id="countdown">5</span> seconds.</p>
            <div class="spinner" id="spinner"></div>
            <p id="status-msg" style="margin-top: 1rem; color: #27ae60;">Preparing to restart...</p>
          </div>

          <div class="manual-instructions" id="manual-instructions">
            <h3>⚠️ Manual Restart Required</h3>
            <p><strong>If auto-restart didn't work, please restart manually:</strong></p>

            <h4 style="color: #d4a843; margin-top: 1rem;">Option 1: Using Terminal</h4>
            <ol style="line-height: 1.8;">
              <li>Go to your terminal where the server is running</li>
              <li>Press <code>Ctrl + C</code> to stop the server</li>
              <li>Run: <code>npm start</code> or <code>node server.js</code></li>
              <li>Open: <code>http://localhost:3000</code></li>
            </ol>

            <h4 style="color: #d4a843; margin-top: 1rem;">Option 2: Using PM2</h4>
            <p><code>pm2 restart quest-planner</code></p>

            <h4 style="color: #d4a843; margin-top: 1rem;">Option 3: Using Docker</h4>
            <p><code>docker-compose restart</code> or <code>docker restart quest-planner</code></p>

            <h4 style="color: #d4a843; margin-top: 1rem;">Option 4: Platform Restart</h4>
            <ul>
              <li><strong>Railway:</strong> Auto-restarts (wait 30 seconds)</li>
              <li><strong>Render:</strong> Auto-restarts (wait 30 seconds)</li>
              <li><strong>Fly.io:</strong> Run <code>fly deploy</code></li>
            </ul>
          </div>

          <div class="info-box">
            <h3>🔒 Security Recommendations</h3>
            <ul>
              <li><strong>Optional:</strong> Delete <code>routes/install.js</code> for extra security</li>
              <li>The installer is locked via <code>data/installed.lock</code></li>
              <li>If behind HTTPS reverse proxy, set <code>TRUST_PROXY=true</code> and <code>SECURE_COOKIES=true</code> in .env</li>
              <li>Change the <code>SESSION_SECRET</code> in .env for production</li>
            </ul>
          </div>

          <p style="margin-top: 2rem; font-size: 0.9rem; color: #888;">
            After restarting, you can login at <code>/login</code> with your admin credentials.
          </p>
        </div>

        <script>
          let countdown = 5;
          const countdownEl = document.getElementById('countdown');
          const statusMsg = document.getElementById('status-msg');
          const spinner = document.getElementById('spinner');
          const manualInstructions = document.getElementById('manual-instructions');

          // Countdown timer
          const timer = setInterval(() => {
            countdown--;
            countdownEl.textContent = countdown;

            if (countdown <= 0) {
              clearInterval(timer);
              attemptRestart();
            }
          }, 1000);

          async function attemptRestart() {
            statusMsg.textContent = 'Restarting server...';
            spinner.style.display = 'block';

            try {
              // Trigger server restart
              await fetch('/install/restart', { method: 'POST' });

              // Wait and check if server is back up
              setTimeout(checkServerStatus, 3000);
            } catch (err) {
              showManualInstructions();
            }
          }

          async function checkServerStatus() {
            let attempts = 0;
            const maxAttempts = 10;

            const checkInterval = setInterval(async () => {
              attempts++;

              try {
                const response = await fetch('/');

                if (response.ok || response.status === 302) {
                  clearInterval(checkInterval);
                  statusMsg.textContent = 'Server restarted successfully! Redirecting...';
                  statusMsg.style.color = '#27ae60';

                  setTimeout(() => {
                    window.location.href = '/';
                  }, 1000);
                }
              } catch (err) {
                if (attempts >= maxAttempts) {
                  clearInterval(checkInterval);
                  showManualInstructions();
                }
              }
            }, 2000);
          }

          function showManualInstructions() {
            document.getElementById('restart-box').style.display = 'none';
            manualInstructions.style.display = 'block';

            // Scroll to manual instructions
            manualInstructions.scrollIntoView({ behavior: 'smooth' });
          }
        </script>
      </body>
      </html>
    `);

    // Trigger server restart after sending response
    setTimeout(() => {
      console.log('\n✅ Installation complete. Restarting server...\n');
      process.exit(0); // Exit cleanly - PM2/Docker/systemd will auto-restart
    }, 6000); // 6 seconds delay to allow response to be sent

  } catch (error) {
    console.error('Installation error:', error);
    res.render('install', {
      error: 'Installation failed: ' + error.message
    });
  }
});

// POST /install/restart - Trigger server restart
router.post('/restart', requireNotInstalled, (req, res) => {
  res.json({ success: true, message: 'Restarting server...' });

  // Restart after response is sent
  setTimeout(() => {
    console.log('\n🔄 Manual restart triggered from installer\n');
    process.exit(0);
  }, 500);
});

module.exports = router;
