const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const firstLogin = !!req.session.firstLogin;
  if (req.session.firstLogin) delete req.session.firstLogin;

  if (req.user.role === 'dm' || req.user.role === 'admin') {
    const sessions = db.prepare(`
      SELECT s.*, sl.date_time as confirmed_date, sl.label as confirmed_label
      FROM sessions s
      LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
      ORDER BY
        CASE s.status
          WHEN 'open' THEN 0
          WHEN 'cancelled' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'completed' THEN 3
        END,
        CASE WHEN s.status IN ('confirmed', 'completed') THEN sl.date_time END DESC,
        s.created_at DESC
    `).all();

    return res.render('dm/dashboard', { sessions, firstLogin });
  }

  // Player dashboard
  const sessions = db.prepare(`
    SELECT s.*, u.username as dm_name,
      sl.date_time as confirmed_date, sl.label as confirmed_label
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    ORDER BY
      CASE s.status
        WHEN 'open' THEN 0
        WHEN 'cancelled' THEN 1
        WHEN 'confirmed' THEN 2
        WHEN 'completed' THEN 3
      END,
      CASE WHEN s.status IN ('confirmed', 'completed') THEN sl.date_time END DESC,
      s.created_at DESC
  `).all();

  // Check which sessions the player has voted on
  const votedSessionIds = db.prepare(`
    SELECT DISTINCT sl.session_id
    FROM votes v
    JOIN slots sl ON v.slot_id = sl.id
    WHERE v.user_id = ?
  `).all(req.user.id).map(r => r.session_id);

  res.render('player/dashboard', { sessions, votedSessionIds, firstLogin });
});

module.exports = router;
