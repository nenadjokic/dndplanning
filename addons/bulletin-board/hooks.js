'use strict';

module.exports = {
  /**
   * Clean up all user-owned bulletin board data when a user is deleted.
   * @param {object} ctx - Context object with ctx.db
   * @param {number} userId
   */
  onUserDelete(ctx, userId) {
    const db = ctx.db;
    db.prepare('DELETE FROM poll_votes WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM reply_reactions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM post_reactions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM replies WHERE user_id = ?').run(userId);
    // Delete polls owned by this user (cascade options & votes)
    const userPolls = db.prepare('SELECT id FROM polls WHERE user_id = ?').all(userId);
    for (const poll of userPolls) {
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(poll.id);
      db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(poll.id);
    }
    db.prepare('DELETE FROM polls WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(userId);
  },

  /**
   * Return latest 5 board posts for the dashboard mini-feed widget.
   * @param {object} ctx - Context object with ctx.db
   * @param {object} user - User object with user.id, user.role
   * @param {boolean} isDM
   * @returns {object} Keyed by widget ID
   */
  getDashboardData(ctx, user, isDM) {
    const db = ctx.db;
    const posts = db.prepare(`
      SELECT p.id, p.content, p.created_at, u.username, u.avatar,
        bc.name as category_name, bc.icon as category_icon,
        (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN board_categories bc ON p.category_id = bc.id
      WHERE p.session_id IS NULL
      ORDER BY p.created_at DESC
      LIMIT 5
    `).all();

    return { 'bb-mini-feed': { posts } };
  }
};
