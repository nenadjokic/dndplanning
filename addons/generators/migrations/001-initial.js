'use strict';

module.exports = {
  version: 1,
  description: 'Placeholder migration — generators addon has no own database tables',

  /**
   * @param {import('better-sqlite3').Database} db
   */
  up(db) {
    // No tables to create.
    // Generators write to tables owned by other addons (maps, loot-tracker).
  },

  /**
   * @param {import('better-sqlite3').Database} db
   */
  down(db) {
    // Nothing to drop
  }
};
