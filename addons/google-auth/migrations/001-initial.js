'use strict';

module.exports = {
  version: 1,
  description: 'Create google_oauth_config table for OAuth credentials',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS google_oauth_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        client_id TEXT,
        client_secret TEXT,
        redirect_uri TEXT,
        enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS google_oauth_config');
  }
};
