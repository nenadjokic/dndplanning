'use strict';

module.exports = {
  version: 1,
  description: 'Create notification_config table for Discord/Telegram settings',

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notification_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        discord_webhook TEXT,
        telegram_bot_token TEXT,
        telegram_chat_id TEXT,
        enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  down(db) {
    db.exec('DROP TABLE IF EXISTS notification_config');
  }
};
