'use strict';

module.exports = {
  version: 1,
  description: 'Create all 16 map system tables',

  up(db) {
    // ── map_config (singleton) ──────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        image_path TEXT,
        party_x REAL,
        party_y REAL
      )
    `);
    db.exec(`INSERT OR IGNORE INTO map_config (id) VALUES (1)`);

    // ── maps ────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_path TEXT,
        party_x REAL,
        party_y REAL,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        parent_id INTEGER REFERENCES maps(id) ON DELETE SET NULL,
        map_type TEXT DEFAULT 'overworld',
        pin_x REAL,
        pin_y REAL,
        description TEXT,
        hidden_by INTEGER,
        fog_enabled INTEGER DEFAULT 0,
        fog_data TEXT,
        fog_draft TEXT,
        fog_explored TEXT,
        grid_enabled INTEGER DEFAULT 0,
        grid_size INTEGER DEFAULT 50,
        grid_offset_x INTEGER DEFAULT 0,
        grid_offset_y INTEGER DEFAULT 0,
        grid_color TEXT DEFAULT '#000000',
        grid_opacity REAL DEFAULT 0.3,
        grid_type TEXT DEFAULT 'square',
        campaign_id INTEGER
      )
    `);

    // ── map_locations ───────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        x REAL NOT NULL,
        y REAL NOT NULL,
        icon TEXT DEFAULT 'pin',
        map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── map_tokens (player characters on maps) ─────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        placed_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        scale REAL DEFAULT 1.0,
        vision_radius REAL DEFAULT 0,
        UNIQUE(map_id, character_id)
      )
    `);

    // ── token_conditions (D&D 5e conditions on player tokens) ──────
    db.exec(`
      CREATE TABLE IF NOT EXISTS token_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id INTEGER NOT NULL REFERENCES map_tokens(id) ON DELETE CASCADE,
        condition_name TEXT NOT NULL,
        applied_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_rounds INTEGER,
        duration_type TEXT DEFAULT 'indefinite',
        UNIQUE(token_id, condition_name)
      )
    `);

    // ── npc_categories ──────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS npc_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── npc_tokens (NPC library) ────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS npc_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        avatar TEXT,
        source_type TEXT DEFAULT 'custom',
        source_key TEXT,
        category_id INTEGER,
        max_hp INTEGER,
        current_hp INTEGER,
        hp_visible INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        notes TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── npc_token_categories (many-to-many junction) ────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS npc_token_categories (
        npc_token_id INTEGER NOT NULL REFERENCES npc_tokens(id) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES npc_categories(id) ON DELETE CASCADE,
        PRIMARY KEY(npc_token_id, category_id)
      )
    `);

    // ── map_npc_tokens (NPC placements on maps) ─────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_npc_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        npc_token_id INTEGER NOT NULL REFERENCES npc_tokens(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        scale REAL DEFAULT 1.0,
        current_hp INTEGER,
        hp_visible INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        vision_radius REAL DEFAULT 0,
        placed_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        alignment TEXT DEFAULT 'hostile'
      )
    `);

    // ── npc_token_conditions (D&D 5e conditions on NPC tokens) ──────
    db.exec(`
      CREATE TABLE IF NOT EXISTS npc_token_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_map_token_id INTEGER NOT NULL REFERENCES map_npc_tokens(id) ON DELETE CASCADE,
        condition_name TEXT NOT NULL,
        applied_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        duration_rounds INTEGER,
        duration_type TEXT DEFAULT 'indefinite',
        UNIQUE(npc_map_token_id, condition_name)
      )
    `);

    // ── npc_token_assignments (delegate NPC control to players) ─────
    db.exec(`
      CREATE TABLE IF NOT EXISTS npc_token_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_token_id INTEGER NOT NULL REFERENCES map_npc_tokens(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        UNIQUE(npc_token_id, user_id)
      )
    `);

    // ── combat_encounters ───────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS combat_encounters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL UNIQUE REFERENCES maps(id) ON DELETE CASCADE,
        round_number INTEGER DEFAULT 1,
        current_turn_index INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'full' CHECK(visibility IN ('full', 'order_only', 'hidden')),
        started_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── combat_participants ─────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS combat_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        encounter_id INTEGER NOT NULL REFERENCES combat_encounters(id) ON DELETE CASCADE,
        token_id INTEGER REFERENCES map_tokens(id) ON DELETE CASCADE,
        npc_map_token_id INTEGER REFERENCES map_npc_tokens(id) ON DELETE CASCADE,
        initiative INTEGER,
        initiative_modifier INTEGER DEFAULT 0,
        legendary_actions_max INTEGER DEFAULT 0,
        legendary_actions_used INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        CHECK(token_id IS NOT NULL OR npc_map_token_id IS NOT NULL)
      )
    `);

    // ── map_links (non-hierarchical hyperlinks between maps) ────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        target_map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        pin_x REAL,
        pin_y REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(source_map_id, target_map_id)
      )
    `);

    // ── map_loot_chests ─────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS map_loot_chests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
        x REAL NOT NULL,
        y REAL NOT NULL,
        label TEXT,
        notes TEXT,
        pp INTEGER DEFAULT 0,
        gp INTEGER DEFAULT 0,
        sp INTEGER DEFAULT 0,
        cp INTEGER DEFAULT 0,
        hidden INTEGER DEFAULT 0,
        linked_npc_name TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ── chest_items ─────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS chest_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chest_id INTEGER NOT NULL REFERENCES map_loot_chests(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        quantity INTEGER DEFAULT 1
      )
    `);
  },

  down(db) {
    // Drop in reverse dependency order
    db.exec('DROP TABLE IF EXISTS chest_items');
    db.exec('DROP TABLE IF EXISTS map_loot_chests');
    db.exec('DROP TABLE IF EXISTS map_links');
    db.exec('DROP TABLE IF EXISTS combat_participants');
    db.exec('DROP TABLE IF EXISTS combat_encounters');
    db.exec('DROP TABLE IF EXISTS npc_token_assignments');
    db.exec('DROP TABLE IF EXISTS npc_token_conditions');
    db.exec('DROP TABLE IF EXISTS map_npc_tokens');
    db.exec('DROP TABLE IF EXISTS npc_token_categories');
    db.exec('DROP TABLE IF EXISTS npc_tokens');
    db.exec('DROP TABLE IF EXISTS npc_categories');
    db.exec('DROP TABLE IF EXISTS token_conditions');
    db.exec('DROP TABLE IF EXISTS map_tokens');
    db.exec('DROP TABLE IF EXISTS map_locations');
    db.exec('DROP TABLE IF EXISTS maps');
    db.exec('DROP TABLE IF EXISTS map_config');
  }
};
