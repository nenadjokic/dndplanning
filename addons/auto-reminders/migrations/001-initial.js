'use strict';

module.exports = {
  version: 1,
  description: 'Add reminder tracking columns to sessions table',

  up(db) {
    const cols = [
      { name: 'reminder_24h_sent', sql: 'ALTER TABLE sessions ADD COLUMN reminder_24h_sent INTEGER DEFAULT 0' },
      { name: 'reminder_1h_sent', sql: 'ALTER TABLE sessions ADD COLUMN reminder_1h_sent INTEGER DEFAULT 0' }
    ];

    for (const col of cols) {
      try {
        db.exec(col.sql);
      } catch (err) {
        // Column likely already exists — safe to ignore
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }
    }
  },

  down(db) {
    // SQLite does not support DROP COLUMN in older versions.
    // These columns are harmless if left in place.
  }
};
