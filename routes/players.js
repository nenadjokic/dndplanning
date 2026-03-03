const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const players = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.role, u.about, u.last_heartbeat,
           c.name AS char_name, c.race AS char_race, c.class AS char_class
    FROM users u
    LEFT JOIN (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id) AS rn
      FROM characters
    ) c ON c.user_id = u.id AND c.rn = 1
    ORDER BY u.username
  `).all();
  res.render('players', { players });
});

module.exports = router;
