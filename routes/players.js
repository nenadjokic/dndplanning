const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const players = db.prepare('SELECT id, username, avatar, role, about FROM users ORDER BY username').all();
  res.render('players', { players });
});

module.exports = router;
