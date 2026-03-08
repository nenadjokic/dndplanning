module.exports = {
  version: '1.0.0',
  description: 'Create adventure_packs and adventure_pack_repositories tables',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS adventure_packs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pack_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        level_min INTEGER,
        level_max INTEGER,
        campaign_id INTEGER REFERENCES campaigns(id),
        map_ids TEXT,
        npc_ids TEXT,
        import_source TEXT DEFAULT 'local',
        imported_by INTEGER NOT NULL REFERENCES users(id),
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS adventure_pack_repositories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        added_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
};
