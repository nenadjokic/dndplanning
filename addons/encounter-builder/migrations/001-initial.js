'use strict';

module.exports = {
  version: 1,
  description: 'Create encounters table for the encounter builder',

  /**
   * @param {import('better-sqlite3').Database} db
   */
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS encounters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        party_size INTEGER DEFAULT 4,
        party_levels TEXT,
        monsters TEXT,
        template TEXT,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        campaign_id INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
  },

  /**
   * @param {import('better-sqlite3').Database} db
   */
  down(db) {
    db.exec('DROP TABLE IF EXISTS encounters');
  }
};
