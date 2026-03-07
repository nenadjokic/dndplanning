'use strict';

module.exports = {
  /**
   * Nullify held_by references and delete loot created by the deleted user.
   * @param {import('better-sqlite3').Database} db
   * @param {number} userId
   */
  onUserDelete(db, userId) {
    // Unassign loot held by this user (don't delete — party loot stays)
    db.prepare('UPDATE loot_items SET held_by = NULL WHERE held_by = ?').run(userId);
    db.prepare('UPDATE loot_items SET attuned_to = NULL WHERE attuned_to = ?').run(userId);

    // Delete loot items this user created
    db.prepare('DELETE FROM loot_items WHERE created_by = ?').run(userId);

    // Delete character currency records
    db.prepare('DELETE FROM character_currency WHERE user_id = ?').run(userId);

    // Delete currency log entries by this user
    db.prepare('DELETE FROM currency_log WHERE user_id = ?').run(userId);
  }
};
