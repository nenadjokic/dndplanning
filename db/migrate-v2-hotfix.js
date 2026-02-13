#!/usr/bin/env node
/**
 * Database Migration HOTFIX for v2.0.x
 *
 * Fixes critical migration issues:
 * 1. Renames old "reaction_type" column to "emoji" in post_reactions/reply_reactions
 * 2. Recreates polls table with correct schema (post_id instead of session_id)
 * 3. Adds missing columns
 *
 * Safe to run multiple times.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found at:', dbPath);
  process.exit(1);
}

console.log('🔧 Starting database migration HOTFIX for v2.0.x...\n');

const db = new Database(dbPath);

// Helper function to check if column exists
function columnExists(table, column) {
  const info = db.pragma(`table_info(${table})`);
  return info.some(col => col.name === column);
}

// Helper function to check if table exists
function tableExists(table) {
  const result = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  return !!result;
}

try {
  let changesMade = 0;

  // ==========================================
  // 1. FIX post_reactions table
  // ==========================================
  if (tableExists('post_reactions')) {
    // Check if old "reaction_type" column exists
    if (columnExists('post_reactions', 'reaction_type')) {
      console.log('🔄 Migrating post_reactions: reaction_type → emoji');

      // SQLite doesn't support RENAME COLUMN directly in older versions
      // So we need to recreate the table
      db.exec(`
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
      `);
      changesMade++;
      console.log('✅ post_reactions migrated successfully');
    } else if (!columnExists('post_reactions', 'emoji')) {
      console.log('➕ Adding emoji column to post_reactions...');
      db.exec('ALTER TABLE post_reactions ADD COLUMN emoji TEXT NOT NULL DEFAULT "like"');
      changesMade++;
    } else {
      console.log('✓ post_reactions.emoji already correct');
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
  }

  // ==========================================
  // 2. FIX reply_reactions table
  // ==========================================
  if (tableExists('reply_reactions')) {
    // Check if old "reaction_type" column exists
    if (columnExists('reply_reactions', 'reaction_type')) {
      console.log('🔄 Migrating reply_reactions: reaction_type → emoji');

      db.exec(`
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
      `);
      changesMade++;
      console.log('✅ reply_reactions migrated successfully');
    } else if (!columnExists('reply_reactions', 'emoji')) {
      console.log('➕ Adding emoji column to reply_reactions...');
      db.exec('ALTER TABLE reply_reactions ADD COLUMN emoji TEXT NOT NULL DEFAULT "like"');
      changesMade++;
    } else {
      console.log('✓ reply_reactions.emoji already correct');
    }
  } else {
    // Create table if it doesn't exist
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
  }

  // ==========================================
  // 3. FIX polls table
  // ==========================================
  if (tableExists('polls')) {
    const hasPostId = columnExists('polls', 'post_id');
    const hasUserId = columnExists('polls', 'user_id');
    const hasSessionId = columnExists('polls', 'session_id');

    // If table has wrong schema, recreate it
    if (!hasPostId || !hasUserId) {
      console.log('🔄 Recreating polls table with correct schema (post_id, user_id)');

      // Backup any existing polls data
      const existingPolls = db.prepare('SELECT * FROM polls').all();

      // Drop dependent tables first
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

      changesMade += 3;
      console.log('✅ polls, poll_options, poll_votes recreated with correct schema');
      console.log('⚠️  Note: Existing poll data was lost (old schema was incompatible)');
    } else {
      console.log('✓ polls table schema is correct');
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
      )
    `);

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
    changesMade += 3;
  }

  // ==========================================
  // 4. Ensure poll_options has sort_order
  // ==========================================
  if (tableExists('poll_options') && !columnExists('poll_options', 'sort_order')) {
    console.log('➕ Adding sort_order column to poll_options...');
    db.exec('ALTER TABLE poll_options ADD COLUMN sort_order INTEGER DEFAULT 0');
    changesMade++;
  }

  // ==========================================
  // 5. Other missing tables (from original migration)
  // ==========================================

  // socials column in users
  if (!columnExists('users', 'socials')) {
    console.log('➕ Adding socials column to users table...');
    db.exec('ALTER TABLE users ADD COLUMN socials TEXT');
    changesMade++;
  } else {
    console.log('✓ users.socials already exists');
  }

  // comments table
  if (!tableExists('comments')) {
    console.log('➕ Creating comments table...');
    db.exec(`
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    changesMade++;
  } else {
    console.log('✓ comments table already exists');
  }

  // announcements table
  if (!tableExists('announcements')) {
    console.log('➕ Creating announcements table...');
    db.exec(`
      CREATE TABLE announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id),
        expires_at TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    changesMade++;
  } else {
    console.log('✓ announcements table already exists');
  }

  // notification_reads table
  if (!tableExists('notification_reads')) {
    console.log('➕ Creating notification_reads table...');
    db.exec(`
      CREATE TABLE notification_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        notification_type TEXT NOT NULL,
        notification_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, notification_type, notification_id)
      )
    `);
    changesMade++;
  } else {
    console.log('✓ notification_reads table already exists');
  }

  db.close();

  console.log('\n✅ Migration HOTFIX completed!');
  console.log(`📊 Changes made: ${changesMade}`);

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
  console.error(error);
  db.close();
  process.exit(1);
}
