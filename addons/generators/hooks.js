'use strict';

module.exports = {
  /**
   * Generators have no own tables — nothing to clean up.
   * Generated data lives in other addons' tables (maps, loot-tracker).
   * @param {import('better-sqlite3').Database} db
   * @param {number} userId
   */
  onUserDelete(db, userId) {
    // No-op: generators don't own any data
  }
};
