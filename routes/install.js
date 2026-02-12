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
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        image_url TEXT,
        width INTEGER DEFAULT 1000,
        height INTEGER DEFAULT 1000,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS map_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        icon TEXT DEFAULT 'marker',
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS loot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        claimed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS dm_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tool_type TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        question TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
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

    // Create .env file
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

    fs.writeFileSync(envFile, envContent);

    // Create lock file
    fs.writeFileSync(lockFile, new Date().toISOString());

    // Success page
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
              <li><strong>Configuration:</strong> .env file generated</li>
            </ul>
          </div>

          <div class="warning">
            <h3>⚠️ Important: Restart Required</h3>
            <p>You must <strong>restart the Node.js server</strong> for the changes to take effect.</p>
            <p><strong>Command:</strong> <code>npm start</code> or <code>node server.js</code></p>
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
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Installation error:', error);
    res.render('install', {
      error: 'Installation failed: ' + error.message
    });
  }
});

module.exports = router;
