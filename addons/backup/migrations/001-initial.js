'use strict';

module.exports = {
  version: 1,
  description: 'Create backup_config table for backup scheduling and settings',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS backup_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        schedule TEXT DEFAULT 'daily',
        retention_days INTEGER DEFAULT 7,
        last_backup_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS backup_config');
  }
};
