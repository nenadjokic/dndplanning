'use strict';

module.exports = {
  version: 1,
  description: 'Create dice_rolls table for roll history',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dice_rolls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        roll_desc TEXT,
        result INTEGER,
        detail TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        hidden INTEGER DEFAULT 0
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS dice_rolls');
  }
};
