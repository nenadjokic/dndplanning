#!/usr/bin/env node
/**
 * Database Migration for v3.0.0 — Addon System
 *
 * This script handles upgrading from v2.x to v3.0.
 * It ensures:
 * 1. addon_state and addon_migrations tables exist
 * 2. All preinstalled addons are registered as enabled
 * 3. All existing addon migrations are marked as already applied
 *    (so existing data is not re-created or lost)
 *
 * Safe to run multiple times (fully idempotent).
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');

if (!fs.existsSync(dbPath)) {
  console.log('[v3 Migration] No database found — fresh install, skipping migration.');
  process.exit(0);
}

console.log('[v3 Migration] Starting v3.0 addon system migration...\n');

const db = new Database(dbPath);

function tableExists(name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

// Step 1: Create addon system tables
console.log('[v3 Migration] Step 1: Creating addon system tables...');
db.exec(`
  CREATE TABLE IF NOT EXISTS addon_state (
    addon_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    installed_at TEXT NOT NULL DEFAULT (datetime('now')),
    version TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'preinstalled'
      CHECK(type IN ('preinstalled', 'community'))
  );

  CREATE TABLE IF NOT EXISTS addon_migrations (
    addon_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    description TEXT,
    applied_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(addon_id, version)
  );

  CREATE TABLE IF NOT EXISTS addon_repositories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
console.log('  addon_state: OK');
console.log('  addon_migrations: OK');

// Step 2: Register all preinstalled addons as enabled
// Map addon_id -> { version, tables_to_check }
// We check if at least one table exists to know if the addon's data is already present
const preinstalledAddons = [
  { id: 'bulletin-board', version: '1.0.0', checkTable: 'posts' },
  { id: 'maps', version: '1.0.0', checkTable: 'maps' },
  { id: 'campaigns', version: '1.0.0', checkTable: 'campaigns' },
  { id: 'loot-tracker', version: '1.0.0', checkTable: 'loot_items' },
  { id: 'quest-board', version: '1.0.0', checkTable: 'quests' },
  { id: 'quest-journal', version: '1.0.0', checkTable: 'session_notes' },
  { id: 'handouts', version: '1.0.0', checkTable: 'handouts' },
  { id: 'dice-roller', version: '1.0.0', checkTable: 'dice_rolls' },
  { id: 'encounter-builder', version: '1.0.0', checkTable: 'encounters' },
  { id: 'generators', version: '1.0.0', checkTable: null },
  { id: 'analytics', version: '1.0.0', checkTable: null },
  { id: 'sound-board', version: '1.0.0', checkTable: null },
  { id: 'announcements', version: '1.0.0', checkTable: 'announcements' },
  { id: 'messenger', version: '1.0.0', checkTable: 'notification_config' },
  { id: 'google-auth', version: '1.0.0', checkTable: 'google_oauth_config' },
  { id: 'backup', version: '1.0.0', checkTable: 'backup_config' },
  { id: 'auto-reminders', version: '1.0.0', checkTable: null }
];

console.log('\n[v3 Migration] Step 2: Registering preinstalled addons...');

const insertState = db.prepare(
  'INSERT OR IGNORE INTO addon_state (addon_id, enabled, version, type) VALUES (?, 1, ?, ?)'
);

for (const addon of preinstalledAddons) {
  insertState.run(addon.id, addon.version, 'preinstalled');
  console.log(`  ${addon.id}: registered (enabled)`);
}

// Step 3: Mark initial migrations as applied for addons that already have data
console.log('\n[v3 Migration] Step 3: Marking existing addon migrations as applied...');

const insertMigration = db.prepare(
  'INSERT OR IGNORE INTO addon_migrations (addon_id, version, description) VALUES (?, ?, ?)'
);

for (const addon of preinstalledAddons) {
  // If the addon has a table and it exists, mark migration 1 as applied
  if (addon.checkTable && tableExists(addon.checkTable)) {
    insertMigration.run(addon.id, 1, 'Initial tables (pre-v3 migration)');
    console.log(`  ${addon.id}: migration v1 marked as applied (tables exist)`);
  } else if (!addon.checkTable) {
    // Addons with no tables still need migration marked
    insertMigration.run(addon.id, 1, 'Initial setup (no tables needed)');
    console.log(`  ${addon.id}: migration v1 marked as applied (no tables)`);
  } else {
    console.log(`  ${addon.id}: no existing data found, migrations will run on first enable`);
  }
}

// Step 4: Mark campaigns addon migration v2 as applied if campaign_id columns exist
try {
  const sessionsInfo = db.pragma('table_info(sessions)');
  if (sessionsInfo.some(col => col.name === 'campaign_id')) {
    insertMigration.run('campaigns', 2, 'Add campaign_id to related tables (pre-v3 migration)');
    console.log('  campaigns: migration v2 marked as applied (campaign_id columns exist)');
  }
} catch (e) { /* ignore */ }

// Adventure Packs tables
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
console.log('  adventure_packs + adventure_pack_repositories tables ensured');

console.log('\n[v3 Migration] Migration complete!\n');

db.close();
