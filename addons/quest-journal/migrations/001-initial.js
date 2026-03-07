'use strict';

module.exports = {
  version: 1,
  description: 'Create session_notes, session_images, session_attendance tables and add arc_id to sessions',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT,
        note_type TEXT NOT NULL CHECK(note_type IN ('dm', 'player')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, user_id, note_type)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        caption TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        attended INTEGER DEFAULT 0,
        UNIQUE(session_id, user_id)
      )
    `);

    // Add arc_id to sessions for story arc linking
    try {
      db.exec('ALTER TABLE sessions ADD COLUMN arc_id INTEGER');
    } catch (e) {
      // Column may already exist
    }
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS session_attendance');
    db.exec('DROP TABLE IF EXISTS session_images');
    db.exec('DROP TABLE IF EXISTS session_notes');
  }
};
