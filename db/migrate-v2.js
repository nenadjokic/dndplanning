#!/usr/bin/env node
/**
 * Database Migration Script for v2.0.x
 *
 * This script updates older databases to v2.0.x schema by adding:
 * - Missing columns (socials, emoji)
 * - Missing tables (comments, post_reactions, reply_reactions, etc.)
 *
 * Safe to run multiple times - checks if migrations are needed first.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');

if (!fs.existsSync(dbPath)) {
  console.error('❌ Database file not found at:', dbPath);
  process.exit(1);
}

console.log('🔧 Starting database migration for v2.0.x...\n');

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

  // 1. Add socials column to users table
  if (!columnExists('users', 'socials')) {
    console.log('➕ Adding socials column to users table...');
    db.exec('ALTER TABLE users ADD COLUMN socials TEXT');
    changesMade++;
  } else {
    console.log('✓ users.socials already exists');
  }

  // 2. Create comments table if it doesn't exist
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

  // 3. Create post_reactions table if it doesn't exist
  if (!tableExists('post_reactions')) {
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
  } else {
    console.log('✓ post_reactions table already exists');

    // Check if emoji column exists in post_reactions
    if (!columnExists('post_reactions', 'emoji')) {
      console.log('➕ Adding emoji column to post_reactions table...');
      db.exec('ALTER TABLE post_reactions ADD COLUMN emoji TEXT NOT NULL DEFAULT "like"');
      changesMade++;
    } else {
      console.log('✓ post_reactions.emoji already exists');
    }
  }

  // 4. Create reply_reactions table if it doesn't exist
  if (!tableExists('reply_reactions')) {
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
  } else {
    console.log('✓ reply_reactions table already exists');

    // Check if emoji column exists in reply_reactions
    if (!columnExists('reply_reactions', 'emoji')) {
      console.log('➕ Adding emoji column to reply_reactions table...');
      db.exec('ALTER TABLE reply_reactions ADD COLUMN emoji TEXT NOT NULL DEFAULT "like"');
      changesMade++;
    } else {
      console.log('✓ reply_reactions.emoji already exists');
    }
  }

  // 5. Create other missing tables from v2.0.0
  const tablesToCreate = [
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
      name: 'polls',
      sql: `CREATE TABLE polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        question TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'poll_options',
      sql: `CREATE TABLE poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL
      )`
    },
    {
      name: 'poll_votes',
      sql: `CREATE TABLE poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
        UNIQUE(poll_id, user_id)
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

  for (const table of tablesToCreate) {
    if (!tableExists(table.name)) {
      console.log(`➕ Creating ${table.name} table...`);
      db.exec(table.sql);
      changesMade++;
    } else {
      console.log(`✓ ${table.name} table already exists`);
    }
  }

  db.close();

  console.log('\n✅ Migration completed!');
  console.log(`📊 Changes made: ${changesMade}`);

  if (changesMade > 0) {
    console.log('\n🔄 Please restart your application:');
    console.log('   docker restart quest-planner');
  } else {
    console.log('\n✓ Database is already up to date!');
  }

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error);
  db.close();
  process.exit(1);
}
