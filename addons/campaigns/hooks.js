'use strict';

module.exports = {
  /**
   * Provide campaign data for dashboard widgets.
   * Returns campaigns with session/map/quest counts.
   * @param {object} ctx - Context object with ctx.db
   * @param {object} user - User object with user.id, user.role
   * @param {boolean} isDM
   * @returns {object} Keyed by widget ID
   */
  getDashboardData(ctx, user, isDM) {
    const db = ctx.db;
    const campaigns = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM sessions s WHERE s.campaign_id = c.id) AS session_count,
        (SELECT COUNT(*) FROM maps m WHERE m.campaign_id = c.id) AS map_count,
        (SELECT COUNT(*) FROM quests q WHERE q.campaign_id = c.id) AS quest_count
      FROM campaigns c
      ORDER BY c.created_at DESC
    `).all();

    return { 'campaigns-grid': { campaigns } };
  },

  /**
   * Clean up campaigns when a user is deleted.
   * @param {object} ctx - Context object with ctx.db
   * @param {number} userId
   */
  onUserDelete(ctx, userId) {
    const db = ctx.db;
    db.prepare('DELETE FROM campaign_arcs WHERE created_by = ?').run(userId);
    db.prepare('DELETE FROM campaigns WHERE created_by = ?').run(userId);
  }
};
