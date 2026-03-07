'use strict';

module.exports = {
  onEnable(app, db) {},
  onDisable(app, db) {},

  onUserDelete(db, userId) {
    db.prepare('DELETE FROM announcements WHERE created_by = ?').run(userId);
  },

  getDashboardData(db, userId) {
    const announcement = db.prepare(
      `SELECT content, created_at FROM announcements
       WHERE active = 1
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC
       LIMIT 1`
    ).get();
    return announcement ? { announcement } : null;
  }
};
