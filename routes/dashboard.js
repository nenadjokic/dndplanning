const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  if (req.user.role === 'dm' || req.user.role === 'admin') {
    const sessions = db.prepare(`
      SELECT s.*, sl.date_time as confirmed_date, sl.label as confirmed_label
      FROM sessions s
      LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
      ORDER BY s.created_at DESC
    `).all();

    return res.render('dm/dashboard', { sessions });
  }

  // Player dashboard
  const sessions = db.prepare(`
    SELECT s.*, u.username as dm_name,
      sl.date_time as confirmed_date, sl.label as confirmed_label
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    ORDER BY s.created_at DESC
  `).all();

  // Check which sessions the player has voted on
  const votedSessionIds = db.prepare(`
    SELECT DISTINCT sl.session_id
    FROM votes v
    JOIN slots sl ON v.slot_id = sl.id
    WHERE v.user_id = ?
  `).all(req.user.id).map(r => r.session_id);

  res.render('player/dashboard', { sessions, votedSessionIds });
});

module.exports = router;
