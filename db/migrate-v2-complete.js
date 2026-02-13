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
    { table: 'posts', column: 'image_url', sql: 'ALTER TABLE posts ADD COLUMN image_url TEXT' },
    { table: 'replies', column: 'image_url', sql: 'ALTER TABLE replies ADD COLUMN image_url TEXT' },
    { table: 'votes', column: 'created_at', sql: "ALTER TABLE votes ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))" }
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
