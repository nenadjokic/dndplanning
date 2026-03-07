'use strict';

module.exports = {
  version: 1,
  description: 'Create bulletin board tables: posts, replies, board_categories, post_reactions, reply_reactions, polls, poll_options, poll_votes',

  /**
   * @param {import('better-sqlite3').Database} db
   */
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS board_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id INTEGER,
        content TEXT NOT NULL,
        image_url TEXT,
        category_id INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (category_id) REFERENCES board_categories(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        image_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS post_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(post_id, user_id, emoji),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS reply_reactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reply_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(reply_id, user_id, emoji),
        FOREIGN KEY (reply_id) REFERENCES replies(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS poll_options (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        option_text TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (poll_id) REFERENCES polls(id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL,
        option_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(poll_id, user_id),
        FOREIGN KEY (poll_id) REFERENCES polls(id),
        FOREIGN KEY (option_id) REFERENCES poll_options(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Insert default category
    const existing = db.prepare("SELECT id FROM board_categories WHERE name = 'Tavern Talk'").get();
    if (!existing) {
      db.prepare("INSERT INTO board_categories (name, description, icon, sort_order) VALUES ('Tavern Talk', 'General discussion for the party', 'beer', 1)").run();
    }
  },

  /**
   * @param {import('better-sqlite3').Database} db
   */
  down(db) {
    db.exec('DROP TABLE IF EXISTS poll_votes');
    db.exec('DROP TABLE IF EXISTS poll_options');
    db.exec('DROP TABLE IF EXISTS polls');
    db.exec('DROP TABLE IF EXISTS reply_reactions');
    db.exec('DROP TABLE IF EXISTS post_reactions');
    db.exec('DROP TABLE IF EXISTS replies');
    db.exec('DROP TABLE IF EXISTS posts');
    db.exec('DROP TABLE IF EXISTS board_categories');
  }
};
