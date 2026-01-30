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
  "ALTER TABLE sessions ADD COLUMN summary TEXT"
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

module.exports = db;
