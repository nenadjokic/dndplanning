'use strict';

module.exports = {
  version: 1,
  description: 'Create loot tracking tables: loot_items, party_currency, character_currency, currency_log',

  /**
   * @param {import('better-sqlite3').Database} db
   */
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS loot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        quantity INTEGER DEFAULT 1,
        category TEXT DEFAULT 'misc',
        held_by INTEGER,
        session_id INTEGER,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        hidden INTEGER DEFAULT 0,
        attuned_to INTEGER,
        vault_item_name TEXT,
        rarity TEXT DEFAULT 'common',
        linked_npc_id INTEGER,
        campaign_id INTEGER,
        FOREIGN KEY (held_by) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id),
        FOREIGN KEY (attuned_to) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS party_currency (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cp INTEGER DEFAULT 0,
        sp INTEGER DEFAULT 0,
        ep INTEGER DEFAULT 0,
        gp INTEGER DEFAULT 0,
        pp INTEGER DEFAULT 0,
        campaign_id INTEGER,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS character_currency (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        cp INTEGER DEFAULT 0,
        sp INTEGER DEFAULT 0,
        ep INTEGER DEFAULT 0,
        gp INTEGER DEFAULT 0,
        pp INTEGER DEFAULT 0,
        campaign_id INTEGER,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS currency_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        action TEXT NOT NULL,
        amount TEXT NOT NULL,
        currency_type TEXT NOT NULL,
        note TEXT,
        campaign_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
  },

  /**
   * @param {import('better-sqlite3').Database} db
   */
  down(db) {
    db.exec('DROP TABLE IF EXISTS currency_log');
    db.exec('DROP TABLE IF EXISTS character_currency');
    db.exec('DROP TABLE IF EXISTS party_currency');
    db.exec('DROP TABLE IF EXISTS loot_items');
  }
};
