'use strict';

module.exports = {
  /**
   * Clean up journal data when a user is deleted.
   * @param {object} ctx - Context object with ctx.db
   * @param {number} userId
   */
  onUserDelete(ctx, userId) {
    const db = ctx.db;
    db.prepare('DELETE FROM session_notes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM session_images WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM session_attendance WHERE user_id = ?').run(userId);
  },

  /**
   * Provide "Previously On" data for dashboard widget.
   * Returns the latest completed session with a summary.
   * @param {object} ctx - Context object with ctx.db
   * @param {object} user - User object with user.id, user.role
   * @param {boolean} isDM
   * @returns {object} Keyed by widget ID
   */
  getDashboardData(ctx, user, isDM) {
    const db = ctx.db;
    const recap = db.prepare(`
      SELECT s.id, s.title, s.summary,
        sl.date_time AS confirmed_date
      FROM sessions s
      LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
      WHERE s.status = 'completed'
        AND s.summary IS NOT NULL
        AND s.summary != ''
      ORDER BY COALESCE(sl.date_time, s.created_at) DESC
      LIMIT 1
    `).get() || null;

    return { 'previously-on': { recap } };
  }
};
