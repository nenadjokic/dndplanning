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
  "ALTER TABLE dm_tools ADD COLUMN thumbnail TEXT",
  "ALTER TABLE users ADD COLUMN last_heartbeat TEXT",
  "ALTER TABLE dice_rolls ADD COLUMN hidden INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN google_id TEXT",
  "ALTER TABLE users ADD COLUMN google_email TEXT"
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

// Map tables (legacy + multi-map)
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

// Multi-map system
db.exec(`
  CREATE TABLE IF NOT EXISTS maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    image_path TEXT,
    party_x REAL DEFAULT 50,
    party_y REAL DEFAULT 50,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add map_id column to map_locations (idempotent)
try { db.exec("ALTER TABLE map_locations ADD COLUMN map_id INTEGER REFERENCES maps(id)"); } catch (e) { /* already exists */ }

// Migrate existing data from map_config to maps table
const existingMaps = db.prepare('SELECT COUNT(*) as count FROM maps').get();
if (existingMaps.count === 0) {
  const oldConfig = db.prepare('SELECT * FROM map_config WHERE id = 1').get();
  if (oldConfig && oldConfig.image_path) {
    const result = db.prepare('INSERT INTO maps (name, image_path, party_x, party_y) VALUES (?, ?, ?, ?)')
      .run('World Map', oldConfig.image_path, oldConfig.party_x, oldConfig.party_y);
    db.prepare('UPDATE map_locations SET map_id = ? WHERE map_id IS NULL').run(result.lastInsertRowid);
  }
}

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

// Push notification subscriptions
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// VAPID config (single-row, auto-generated)
db.exec(`
  CREATE TABLE IF NOT EXISTS vapid_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL
  );
`);

// Auto-generate VAPID keys if not present
const vapidRow = db.prepare('SELECT * FROM vapid_config WHERE id = 1').get();
if (!vapidRow) {
  const webpush = require('web-push');
  const vapidKeys = webpush.generateVAPIDKeys();
  db.prepare('INSERT INTO vapid_config (id, public_key, private_key) VALUES (1, ?, ?)').run(vapidKeys.publicKey, vapidKeys.privateKey);
}

// Characters table (multiple characters per user)
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    avatar TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Add class, race, and sheet_data columns to characters table (idempotent)
for (const col of [
  "ALTER TABLE characters ADD COLUMN class TEXT",
  "ALTER TABLE characters ADD COLUMN race TEXT",
  "ALTER TABLE characters ADD COLUMN sheet_data TEXT"
]) {
  try { db.exec(col); } catch (e) { /* already exists */ }
}

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

// User notification preferences (per-type opt-in/out)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_notification_prefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    notif_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, notif_type)
  );
`);

module.exports = db;
