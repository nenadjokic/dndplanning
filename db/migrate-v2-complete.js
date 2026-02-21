#!/usr/bin/env node
/**
 * COMPLETE Database Migration for v2.0.x
 *
 * This script handles ALL possible legacy database schemas and migrates them
 * to the v2.0.x format. It covers:
 *
 * 1. Old "reaction_type" → new "emoji" column migration
 * 2. Old UNIQUE(post_id, user_id) → new UNIQUE(post_id, user_id, emoji)
 * 3. polls table missing "user_id" column
 * 4. polls table having "reply_id" (legacy, unused)
 * 5. Missing tables: comments, announcements, notification_reads
 * 6. Missing columns: users.socials, posts.image_url, replies.image_url
 *
 * Safe to run multiple times. Detects and handles all edge cases.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found at:', dbPath);
  process.exit(1);
}

console.log('🔧 Starting COMPLETE database migration for v2.0.x...\n');

const db = new Database(dbPath);

// Helper function to check if column exists
function columnExists(table, column) {
  try {
    const info = db.pragma(`table_info(${table})`);
    return info.some(col => col.name === column);
  } catch (e) {
    return false;
  }
}

// Helper function to check if table exists
function tableExists(table) {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!result;
}

// Helper to get table schema
function getTableSchema(table) {
  const result = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return result ? result.sql : null;
}

// Helper to count rows in table
function countRows(table) {
  try {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
    return result.count;
  } catch (e) {
    return 0;
  }
}

try {
  let changesMade = 0;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  PHASE 1: FIX REACTIONS TABLES');
  console.log('═══════════════════════════════════════════════════════\n');

  // ==========================================
  // 1. FIX post_reactions table
  // ==========================================
  if (tableExists('post_reactions')) {
    const schema = getTableSchema('post_reactions');
    const hasReactionType = columnExists('post_reactions', 'reaction_type');
    const hasEmoji = columnExists('post_reactions', 'emoji');
    const rowCount = countRows('post_reactions');

    console.log(`📊 post_reactions: ${rowCount} rows`);
    console.log(`   - Has reaction_type column: ${hasReactionType}`);
    console.log(`   - Has emoji column: ${hasEmoji}`);

    if (hasReactionType && !hasEmoji) {
      console.log('🔄 Migrating post_reactions: reaction_type → emoji');
      console.log('   This will preserve all existing reactions.');

      db.exec(`
        BEGIN TRANSACTION;

        -- Create new table with correct schema
        CREATE TABLE post_reactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(post_id, user_id, emoji)
        );

        -- Copy data from old table, renaming column
        INSERT INTO post_reactions_new (id, post_id, user_id, emoji, created_at)
        SELECT id, post_id, user_id, reaction_type, created_at FROM post_reactions;

        -- Drop old table
        DROP TABLE post_reactions;

        -- Rename new table to original name
        ALTER TABLE post_reactions_new RENAME TO post_reactions;

        COMMIT;
      `);
      changesMade++;
      console.log('✅ post_reactions migrated successfully\n');
    } else if (hasEmoji && schema.includes('UNIQUE(post_id, user_id)') && !schema.includes('UNIQUE(post_id, user_id, emoji)')) {
      console.log('🔄 Updating UNIQUE constraint to include emoji');

      db.exec(`
        BEGIN TRANSACTION;

        CREATE TABLE post_reactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(post_id, user_id, emoji)
        );

        INSERT INTO post_reactions_new (id, post_id, user_id, emoji, created_at)
        SELECT id, post_id, user_id, emoji, created_at FROM post_reactions;

        DROP TABLE post_reactions;
        ALTER TABLE post_reactions_new RENAME TO post_reactions;

        COMMIT;
      `);
      changesMade++;
      console.log('✅ UNIQUE constraint updated\n');
    } else {
      console.log('✓ post_reactions schema is already correct\n');
    }
  } else {
    // Create table if it doesn't exist
    console.log('➕ Creating post_reactions table...');
    db.exec(`
      CREATE TABLE post_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(post_id, user_id, emoji)
      )
    `);
    changesMade++;
    console.log('✅ post_reactions created\n');
  }

  // ==========================================
  // 2. FIX reply_reactions table
  // ==========================================
  if (tableExists('reply_reactions')) {
    const schema = getTableSchema('reply_reactions');
    const hasReactionType = columnExists('reply_reactions', 'reaction_type');
    const hasEmoji = columnExists('reply_reactions', 'emoji');
    const rowCount = countRows('reply_reactions');

    console.log(`📊 reply_reactions: ${rowCount} rows`);
    console.log(`   - Has reaction_type column: ${hasReactionType}`);
    console.log(`   - Has emoji column: ${hasEmoji}`);

    if (hasReactionType && !hasEmoji) {
      console.log('🔄 Migrating reply_reactions: reaction_type → emoji');

      db.exec(`
        BEGIN TRANSACTION;

        CREATE TABLE reply_reactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reply_id INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(reply_id, user_id, emoji)
        );

        INSERT INTO reply_reactions_new (id, reply_id, user_id, emoji, created_at)
        SELECT id, reply_id, user_id, reaction_type, created_at FROM reply_reactions;

        DROP TABLE reply_reactions;
        ALTER TABLE reply_reactions_new RENAME TO reply_reactions;

        COMMIT;
      `);
      changesMade++;
      console.log('✅ reply_reactions migrated successfully\n');
    } else if (hasEmoji && schema.includes('UNIQUE(reply_id, user_id)') && !schema.includes('UNIQUE(reply_id, user_id, emoji)')) {
      console.log('🔄 Updating UNIQUE constraint to include emoji');

      db.exec(`
        BEGIN TRANSACTION;

        CREATE TABLE reply_reactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reply_id INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          emoji TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(reply_id, user_id, emoji)
        );

        INSERT INTO reply_reactions_new (id, reply_id, user_id, emoji, created_at)
        SELECT id, reply_id, user_id, emoji, created_at FROM reply_reactions;

        DROP TABLE reply_reactions;
        ALTER TABLE reply_reactions_new RENAME TO reply_reactions;

        COMMIT;
      `);
      changesMade++;
      console.log('✅ UNIQUE constraint updated\n');
    } else {
      console.log('✓ reply_reactions schema is already correct\n');
    }
  } else {
    console.log('➕ Creating reply_reactions table...');
    db.exec(`
      CREATE TABLE reply_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reply_id INTEGER NOT NULL REFERENCES replies(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        emoji TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(reply_id, user_id, emoji)
      )
    `);
    changesMade++;
    console.log('✅ reply_reactions created\n');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  PHASE 2: FIX POLLS TABLES');
  console.log('═══════════════════════════════════════════════════════\n');

  // ==========================================
  // 3. FIX polls table
  // ==========================================
  if (tableExists('polls')) {
    const hasPostId = columnExists('polls', 'post_id');
    const hasUserId = columnExists('polls', 'user_id');
    const hasReplyId = columnExists('polls', 'reply_id');
    const hasSessionId = columnExists('polls', 'session_id');
    const rowCount = countRows('polls');

    console.log(`📊 polls: ${rowCount} rows`);
    console.log(`   - Has post_id: ${hasPostId}`);
    console.log(`   - Has user_id: ${hasUserId}`);
    console.log(`   - Has reply_id (legacy): ${hasReplyId}`);
    console.log(`   - Has session_id (wrong): ${hasSessionId}`);

    // If table has wrong schema, recreate it
    const needsRecreation = !hasPostId || !hasUserId || hasReplyId || hasSessionId;

    if (needsRecreation) {
      console.log('🔄 Recreating polls table with correct schema');

      if (rowCount > 0) {
        console.log(`⚠️  Warning: ${rowCount} existing polls will be LOST (incompatible schema)`);
      }

      // Drop dependent tables first (preserve order for foreign keys)
      db.exec('BEGIN TRANSACTION');

      if (tableExists('poll_votes')) {
        db.exec('DROP TABLE poll_votes');
      }
      if (tableExists('poll_options')) {
        db.exec('DROP TABLE poll_options');
      }
      db.exec('DROP TABLE polls');

      // Create new polls table with correct schema
      db.exec(`
        CREATE TABLE polls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          question TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // Recreate dependent tables
      db.exec(`
        CREATE TABLE poll_options (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          option_text TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0
        )
      `);

      db.exec(`
        CREATE TABLE poll_votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id),
          option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
          UNIQUE(poll_id, user_id)
        )
      `);

      db.exec('COMMIT');

      changesMade += 3;
      console.log('✅ polls, poll_options, poll_votes recreated\n');
    } else {
      console.log('✓ polls table schema is correct\n');
    }
  } else {
    // Create polls tables if they don't exist
    console.log('➕ Creating polls tables...');
    db.exec(`
      CREATE TABLE polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        question TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        UNIQUE(poll_id, user_id)
      )
    `);
    changesMade += 3;
    console.log('✅ polls tables created\n');
  }

  // Ensure poll_options has sort_order
  if (tableExists('poll_options') && !columnExists('poll_options', 'sort_order')) {
    console.log('➕ Adding sort_order column to poll_options...');
    db.exec('ALTER TABLE poll_options ADD COLUMN sort_order INTEGER DEFAULT 0');
    changesMade++;
    console.log('✅ sort_order added\n');
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  PHASE 3: ADD MISSING TABLES');
  console.log('═══════════════════════════════════════════════════════\n');

  // ==========================================
  // 4. Missing tables
  // ==========================================

  const missingTables = [
    {
      name: 'comments',
      sql: `CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'announcements',
      sql: `CREATE TABLE announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'notification_reads',
      sql: `CREATE TABLE notification_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        notification_type TEXT NOT NULL,
        notification_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, notification_type, notification_id)
      )`
    },
    {
      name: 'map_config',
      sql: `CREATE TABLE map_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        image_path TEXT,
        party_x REAL DEFAULT 50,
        party_y REAL DEFAULT 50
      )`
    },
    {
      name: 'map_locations',
      sql: `CREATE TABLE map_locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        x REAL NOT NULL DEFAULT 50,
        y REAL NOT NULL DEFAULT 50,
        icon TEXT NOT NULL DEFAULT 'pin',
        map_id INTEGER REFERENCES maps(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'maps',
      sql: `CREATE TABLE maps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        image_path TEXT,
        party_x REAL DEFAULT 50,
        party_y REAL DEFAULT 50,
        parent_id INTEGER REFERENCES maps(id),
        map_type TEXT NOT NULL DEFAULT 'overworld',
        pin_x REAL DEFAULT 50,
        pin_y REAL DEFAULT 50,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'map_tokens',
      sql: `CREATE TABLE map_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        map_id INTEGER NOT NULL REFERENCES maps(id),
        character_id INTEGER NOT NULL REFERENCES characters(id),
        x REAL NOT NULL DEFAULT 50,
        y REAL NOT NULL DEFAULT 50,
        scale REAL NOT NULL DEFAULT 1.0,
        placed_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(map_id, character_id)
      )`
    },
    {
      name: 'token_conditions',
      sql: `CREATE TABLE token_conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_id INTEGER NOT NULL REFERENCES map_tokens(id) ON DELETE CASCADE,
        condition_name TEXT NOT NULL,
        applied_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(token_id, condition_name)
      )`
    },
    {
      name: 'board_categories',
      sql: `CREATE TABLE board_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '📋',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'loot_items',
      sql: `CREATE TABLE loot_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        quantity INTEGER NOT NULL DEFAULT 1,
        category TEXT NOT NULL DEFAULT 'item',
        held_by INTEGER REFERENCES users(id),
        session_id INTEGER REFERENCES sessions(id),
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'dm_tools',
      sql: `CREATE TABLE dm_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'link',
        sort_order INTEGER NOT NULL DEFAULT 0,
        thumbnail TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'push_subscriptions',
      sql: `CREATE TABLE push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        endpoint TEXT NOT NULL UNIQUE,
        keys_p256dh TEXT NOT NULL,
        keys_auth TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'vapid_config',
      sql: `CREATE TABLE vapid_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL
      )`
    },
    {
      name: 'characters',
      sql: `CREATE TABLE characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        avatar TEXT,
        class TEXT,
        race TEXT,
        sheet_data TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'notification_config',
      sql: `CREATE TABLE notification_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_provider TEXT NOT NULL DEFAULT 'none',
        discord_bot_token TEXT,
        discord_channel_id TEXT,
        telegram_bot_token TEXT,
        telegram_chat_id TEXT,
        viber_auth_token TEXT,
        viber_admin_id TEXT,
        public_url TEXT
      )`
    },
    {
      name: 'google_oauth_config',
      sql: `CREATE TABLE google_oauth_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        client_id TEXT,
        client_secret TEXT
      )`
    },
    {
      name: 'user_notification_prefs',
      sql: `CREATE TABLE user_notification_prefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        notif_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(user_id, notif_type)
      )`
    }
  ];

  for (const table of missingTables) {
    if (!tableExists(table.name)) {
      console.log(`➕ Creating ${table.name} table...`);
      db.exec(table.sql);
      changesMade++;
      console.log(`✅ ${table.name} created`);
    } else {
      console.log(`✓ ${table.name} already exists`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PHASE 4: ADD MISSING COLUMNS');
  console.log('═══════════════════════════════════════════════════════\n');

  // ==========================================
  // 5. Missing columns
  // ==========================================

  const missingColumns = [
    { table: 'users', column: 'socials', sql: 'ALTER TABLE users ADD COLUMN socials TEXT' },
    { table: 'users', column: 'time_format', sql: "ALTER TABLE users ADD COLUMN time_format TEXT NOT NULL DEFAULT '24h'" },
    { table: 'users', column: 'avatar', sql: 'ALTER TABLE users ADD COLUMN avatar TEXT' },
    { table: 'users', column: 'calendar_token', sql: 'ALTER TABLE users ADD COLUMN calendar_token TEXT' },
    { table: 'users', column: 'theme', sql: "ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'" },
    { table: 'users', column: 'week_start', sql: "ALTER TABLE users ADD COLUMN week_start TEXT NOT NULL DEFAULT 'monday'" },
    { table: 'users', column: 'birthday', sql: 'ALTER TABLE users ADD COLUMN birthday TEXT' },
    { table: 'users', column: 'about', sql: 'ALTER TABLE users ADD COLUMN about TEXT' },
    { table: 'users', column: 'character_info', sql: 'ALTER TABLE users ADD COLUMN character_info TEXT' },
    { table: 'users', column: 'character_avatar', sql: 'ALTER TABLE users ADD COLUMN character_avatar TEXT' },
    { table: 'users', column: 'last_seen_version', sql: 'ALTER TABLE users ADD COLUMN last_seen_version TEXT' },
    { table: 'users', column: 'last_heartbeat', sql: 'ALTER TABLE users ADD COLUMN last_heartbeat TEXT' },
    { table: 'users', column: 'google_id', sql: 'ALTER TABLE users ADD COLUMN google_id TEXT' },
    { table: 'users', column: 'google_email', sql: 'ALTER TABLE users ADD COLUMN google_email TEXT' },
    { table: 'posts', column: 'image_url', sql: 'ALTER TABLE posts ADD COLUMN image_url TEXT' },
    { table: 'posts', column: 'category_id', sql: 'ALTER TABLE posts ADD COLUMN category_id INTEGER REFERENCES board_categories(id)' },
    { table: 'replies', column: 'image_url', sql: 'ALTER TABLE replies ADD COLUMN image_url TEXT' },
    { table: 'sessions', column: 'category', sql: "ALTER TABLE sessions ADD COLUMN category TEXT NOT NULL DEFAULT 'dnd'" },
    { table: 'sessions', column: 'summary', sql: 'ALTER TABLE sessions ADD COLUMN summary TEXT' },
    { table: 'sessions', column: 'location_id', sql: 'ALTER TABLE sessions ADD COLUMN location_id INTEGER REFERENCES map_locations(id)' },
    { table: 'maps', column: 'parent_id', sql: 'ALTER TABLE maps ADD COLUMN parent_id INTEGER REFERENCES maps(id)' },
    { table: 'maps', column: 'map_type', sql: "ALTER TABLE maps ADD COLUMN map_type TEXT NOT NULL DEFAULT 'overworld'" },
    { table: 'maps', column: 'pin_x', sql: 'ALTER TABLE maps ADD COLUMN pin_x REAL DEFAULT 50' },
    { table: 'maps', column: 'pin_y', sql: 'ALTER TABLE maps ADD COLUMN pin_y REAL DEFAULT 50' },
    { table: 'maps', column: 'description', sql: 'ALTER TABLE maps ADD COLUMN description TEXT' },
    { table: 'map_locations', column: 'map_id', sql: 'ALTER TABLE map_locations ADD COLUMN map_id INTEGER REFERENCES maps(id)' },
    { table: 'map_locations', column: 'created_by', sql: 'ALTER TABLE map_locations ADD COLUMN created_by INTEGER REFERENCES users(id)' },
    { table: 'dm_tools', column: 'thumbnail', sql: 'ALTER TABLE dm_tools ADD COLUMN thumbnail TEXT' },
    { table: 'dice_rolls', column: 'hidden', sql: 'ALTER TABLE dice_rolls ADD COLUMN hidden INTEGER DEFAULT 0' },
    { table: 'characters', column: 'class', sql: 'ALTER TABLE characters ADD COLUMN class TEXT' },
    { table: 'characters', column: 'race', sql: 'ALTER TABLE characters ADD COLUMN race TEXT' },
    { table: 'characters', column: 'sheet_data', sql: 'ALTER TABLE characters ADD COLUMN sheet_data TEXT' },
    { table: 'dnd_data_meta', column: 'feat_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN feat_count INTEGER DEFAULT 0' },
    { table: 'dnd_data_meta', column: 'optfeature_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN optfeature_count INTEGER DEFAULT 0' },
    { table: 'dnd_data_meta', column: 'background_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN background_count INTEGER DEFAULT 0' },
    { table: 'dnd_data_meta', column: 'monster_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN monster_count INTEGER DEFAULT 0' },
    { table: 'dnd_data_meta', column: 'condition_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN condition_count INTEGER DEFAULT 0' },
    { table: 'dnd_data_meta', column: 'rule_count', sql: 'ALTER TABLE dnd_data_meta ADD COLUMN rule_count INTEGER DEFAULT 0' }
  ];

  for (const col of missingColumns) {
    if (tableExists(col.table)) {
      if (!columnExists(col.table, col.column)) {
        console.log(`➕ Adding ${col.table}.${col.column}...`);
        db.exec(col.sql);
        changesMade++;
        console.log(`✅ ${col.table}.${col.column} added`);
      } else {
        console.log(`✓ ${col.table}.${col.column} already exists`);
      }
    }
  }

  // Token scale column
  if (tableExists('map_tokens') && !columnExists('map_tokens', 'scale')) {
    console.log('➕ Adding map_tokens.scale...');
    db.exec("ALTER TABLE map_tokens ADD COLUMN scale REAL NOT NULL DEFAULT 1.0");
    changesMade++;
    console.log('✅ map_tokens.scale added');
  } else if (tableExists('map_tokens')) {
    console.log('✓ map_tokens.scale already exists');
  }

  // Special handling for votes.created_at (SQLite doesn't allow DEFAULT datetime() in ALTER)
  if (tableExists('votes') && !columnExists('votes', 'created_at')) {
    console.log('➕ Adding votes.created_at (with backfill)...');
    db.exec(`
      ALTER TABLE votes ADD COLUMN created_at TEXT;
      UPDATE votes SET created_at = datetime('now') WHERE created_at IS NULL;
    `);
    changesMade++;
    console.log('✅ votes.created_at added and existing votes backfilled');
  } else if (tableExists('votes')) {
    console.log('✓ votes.created_at already exists');
  }

  db.close();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  MIGRATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`📊 Total changes made: ${changesMade}`);

  if (changesMade > 0) {
    console.log('\n🔄 IMPORTANT: Restart your application now:');
    console.log('   docker restart quest-planner');
    console.log('   OR');
    console.log('   pm2 restart quest-planner');
  } else {
    console.log('\n✓ Database is already up to date!');
  }

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error.stack);
  db.close();
  process.exit(1);
}
