'use strict';

module.exports = {
  onEnable(app, db) {},
  onDisable(app, db) {},

  onUserDelete(db, userId) {
    db.prepare('DELETE FROM dice_rolls WHERE user_id = ?').run(userId);
  },

  getDashboardData(db, userId) { return null; }
};
