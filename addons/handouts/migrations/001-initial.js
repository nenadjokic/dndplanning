'use strict';

module.exports = {
  version: 1,
  description: 'Create handouts table for DM handout management',

  /**
   * @param {import('better-sqlite3').Database} db
   */
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS handouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        type TEXT DEFAULT 'text',
        content TEXT,
        image_path TEXT,
        linked_npc_id INTEGER,
        linked_location_id INTEGER,
        revealed INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        campaign_id INTEGER,
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);
  },

  /**
   * @param {import('better-sqlite3').Database} db
   */
  down(db) {
    db.exec('DROP TABLE IF EXISTS handouts');
  }
};
