/**
 * Migration: Add socials column to users table
 * Run with: node db/add-socials-column.js
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');
const db = new Database(dbPath);

try {
  console.log('Adding socials column to users table...');

  // Check if column exists
  const tableInfo = db.prepare("PRAGMA table_info(users)").all();
  const hasSocials = tableInfo.some(col => col.name === 'socials');

  if (hasSocials) {
    console.log('✓ socials column already exists');
  } else {
    db.prepare('ALTER TABLE users ADD COLUMN socials TEXT').run();
    console.log('✓ socials column added successfully');
  }

  db.close();
  console.log('\nMigration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error.message);
  db.close();
  process.exit(1);
}
