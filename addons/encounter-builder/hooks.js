'use strict';

module.exports = {
  /**
   * Delete all encounters created by the deleted user.
   * @param {import('better-sqlite3').Database} db
   * @param {number} userId
   */
  onUserDelete(db, userId) {
    db.prepare('DELETE FROM encounters WHERE created_by = ?').run(userId);
  }
};
