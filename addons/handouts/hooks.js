'use strict';

module.exports = {
  /**
   * Handouts belong to the DM/campaign, not individual users.
   * No cleanup needed on user deletion.
   * @param {import('better-sqlite3').Database} db
   * @param {number} userId
   */
  onUserDelete(db, userId) {
    // Intentionally empty — handouts are campaign assets owned by the DM.
    // They should persist even if the creating user is removed.
  }
};
