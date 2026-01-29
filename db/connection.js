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
  "ALTER TABLE users ADD COLUMN calendar_token TEXT"
];

for (const sql of alterStatements) {
  try {
    db.exec(sql);
  } catch (e) {
    // Column already exists — ignore
  }
}

module.exports = db;
