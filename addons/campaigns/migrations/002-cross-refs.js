'use strict';

module.exports = {
  version: 2,
  description: 'Add campaign_id to related tables',

  up(db) {
    const tables = ['sessions', 'maps', 'quests', 'loot_items', 'handouts', 'encounters', 'campaign_arcs'];

    for (const table of tables) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL`);
      } catch (e) {
        // Column may already exist — ignore
      }
    }
  },

  down(db) {
    // Cannot remove columns in SQLite without table recreation
  }
};
