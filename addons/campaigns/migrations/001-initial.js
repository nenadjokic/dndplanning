'use strict';

module.exports = {
  version: 1,
  description: 'Create campaigns and campaign_arcs tables',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        cover_image TEXT,
        color TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS campaign_arcs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        color TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS campaign_arcs');
    db.exec('DROP TABLE IF EXISTS campaigns');
  }
};
