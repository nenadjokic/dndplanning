const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'dndplanning.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Add new columns to users table (idempotent)
const alterStatements = [
  "ALTER TABLE users ADD COLUMN time_format TEXT NOT NULL DEFAULT '24h'",
  "ALTER TABLE users ADD COLUMN avatar TEXT",
  "ALTER TABLE users ADD COLUMN calendar_token TEXT",
  "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'",
  "ALTER TABLE users ADD COLUMN week_start TEXT NOT NULL DEFAULT 'monday'",
  "ALTER TABLE sessions ADD COLUMN category TEXT NOT NULL DEFAULT 'dnd'",
  "ALTER TABLE sessions ADD COLUMN summary TEXT",
  "ALTER TABLE users ADD COLUMN birthday TEXT",
  "ALTER TABLE users ADD COLUMN about TEXT",
  "ALTER TABLE users ADD COLUMN character_info TEXT",
  "ALTER TABLE users ADD COLUMN character_avatar TEXT",
  "ALTER TABLE sessions ADD COLUMN location_id INTEGER REFERENCES map_locations(id)",
  "ALTER TABLE users ADD COLUMN last_seen_version TEXT",
  "ALTER TABLE dm_tools ADD COLUMN thumbnail TEXT"
];

for (const sql of alterStatements) {
  try {
    db.exec(sql);
  } catch (e) {
    // Column already exists — ignore
  }
}

// Migrate sessions table CHECK constraint to allow 'completed' status
// SQLite doesn't support ALTER CHECK, so rebuild the table if needed
const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get();
if (tableInfo && tableInfo.sql && !tableInfo.sql.includes('completed')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE sessions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'confirmed', 'cancelled', 'completed')),
      confirmed_slot_id INTEGER REFERENCES slots(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL DEFAULT 'dnd',
      summary TEXT
    );
    INSERT INTO sessions_new (id, title, description, status, confirmed_slot_id, created_by, created_at, category, summary)
      SELECT id, title, description, status, confirmed_slot_id, created_by, created_at, category, summary FROM sessions;
    DROP TABLE sessions;
    ALTER TABLE sessions_new RENAME TO sessions;
  `);
  db.pragma('foreign_keys = ON');
}

// Map tables
db.exec(`
  CREATE TABLE IF NOT EXISTS map_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    x REAL NOT NULL DEFAULT 50,
    y REAL NOT NULL DEFAULT 50,
    icon TEXT NOT NULL DEFAULT 'pin',
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS map_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    image_path TEXT,
    party_x REAL DEFAULT 50,
    party_y REAL DEFAULT 50
  );
  INSERT OR IGNORE INTO map_config (id) VALUES (1);
`);

// Loot tracker table
db.exec(`
  CREATE TABLE IF NOT EXISTS loot_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    category TEXT NOT NULL DEFAULT 'item',
    held_by INTEGER REFERENCES users(id),
    session_id INTEGER REFERENCES sessions(id),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// DM Tools buttons
db.exec(`
  CREATE TABLE IF NOT EXISTS dm_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'link',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Notification config table (single-row)
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_provider TEXT NOT NULL DEFAULT 'none',
    discord_bot_token TEXT,
    discord_channel_id TEXT,
    telegram_bot_token TEXT,
    telegram_chat_id TEXT,
    viber_auth_token TEXT,
    viber_admin_id TEXT,
    public_url TEXT
  );
  INSERT OR IGNORE INTO notification_config (id) VALUES (1);
`);

module.exports = db;
