'use strict';

module.exports = {
  /**
   * Provide active quest data for dashboard widgets.
   * Returns up to 3 quests with available/active status.
   * @param {object} ctx - Context object with ctx.db
   * @param {object} user - User object with user.id, user.role
   * @param {boolean} isDM
   * @returns {object} Keyed by widget ID
   */
  getDashboardData(ctx, user, isDM) {
    const db = ctx.db;
    const quests = db.prepare(`
      SELECT q.*,
        (SELECT COUNT(*) FROM quest_objectives o WHERE o.quest_id = q.id) AS total_objectives,
        (SELECT COUNT(*) FROM quest_objectives o WHERE o.quest_id = q.id AND o.completed = 1) AS completed_objectives
      FROM quests q
      WHERE q.status IN ('available', 'active')
        AND q.revealed = 1
      ORDER BY q.sort_order ASC, q.created_at DESC
      LIMIT 3
    `).all();

    return { 'active-quests': { quests } };
  },

  /**
   * Clean up quests when a user is deleted.
   * @param {object} ctx - Context object with ctx.db
   * @param {number} userId
   */
  onUserDelete(ctx, userId) {
    const db = ctx.db;
    // Delete objectives for quests created by this user
    const questIds = db.prepare('SELECT id FROM quests WHERE created_by = ?').all(userId);
    for (const q of questIds) {
      db.prepare('DELETE FROM quest_objectives WHERE quest_id = ?').run(q.id);
    }
    db.prepare('DELETE FROM quests WHERE created_by = ?').run(userId);
  }
};
