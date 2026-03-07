'use strict';

module.exports = {
  version: 1,
  description: 'Create quests and quest_objectives tables',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'available',
        difficulty TEXT,
        reward TEXT,
        quest_giver_npc_id INTEGER,
        quest_giver_name TEXT,
        linked_map_id INTEGER,
        linked_location_id INTEGER,
        arc_id INTEGER,
        revealed INTEGER DEFAULT 1,
        dm_notes TEXT,
        sort_order INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        pin_x REAL,
        pin_y REAL,
        campaign_id INTEGER
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS quest_objectives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quest_id INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        completed INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS quest_objectives');
    db.exec('DROP TABLE IF EXISTS quests');
  }
};
