'use strict';

module.exports = {
  version: 1,
  description: 'Create announcements table',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS announcements');
  }
};
