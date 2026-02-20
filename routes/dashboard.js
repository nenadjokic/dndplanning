const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const firstLogin = !!req.session.firstLogin;
  if (req.session.firstLogin) delete req.session.firstLogin;

  // Check if user needs to see "What's New"
  const appVersion = require('../package.json').version;
  let showWhatsNew = false;
  if (!firstLogin && req.user.last_seen_version && req.user.last_seen_version !== appVersion) {
    showWhatsNew = true;
  }
  // Update last_seen_version
  if (!req.user.last_seen_version || req.user.last_seen_version !== appVersion) {
    db.prepare('UPDATE users SET last_seen_version = ? WHERE id = ?').run(appVersion, req.user.id);
  }

  const birthdayUsers = db.prepare(`
    SELECT username, avatar FROM users
    WHERE birthday IS NOT NULL
    AND substr(birthday, 6) = strftime('%m-%d', 'now', 'localtime')
  `).all();

  if (req.user.role === 'dm' || req.user.role === 'admin') {
    const sessions = db.prepare(`
      SELECT s.*, sl.date_time as confirmed_date, sl.label as confirmed_label
      FROM sessions s
      LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
      ORDER BY
        CASE s.status
          WHEN 'open' THEN 0
          WHEN 'confirmed' THEN 1
          WHEN 'completed' THEN 2
          WHEN 'cancelled' THEN 3
        END,
        CASE WHEN s.status IN ('confirmed', 'completed') THEN sl.date_time END DESC,
        s.created_at DESC
    `).all();

    // Latest board posts for BB mini feed
    const boardPosts = db.prepare(`
      SELECT p.*, u.username, u.avatar, bc.name as category_name, bc.icon as category_icon,
        (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) as reply_count
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN board_categories bc ON p.category_id = bc.id
      WHERE p.session_id IS NULL
      ORDER BY p.created_at DESC
      LIMIT 5
    `).all();

    return res.render('dm/dashboard', { sessions, firstLogin, birthdayUsers, showWhatsNew, boardPosts });
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
        WHEN 'confirmed' THEN 1
        WHEN 'completed' THEN 2
        WHEN 'cancelled' THEN 3
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

  // Latest board posts for BB mini feed
  const boardPosts = db.prepare(`
    SELECT p.*, u.username, u.avatar, bc.name as category_name, bc.icon as category_icon,
      (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) as reply_count
    FROM posts p
    JOIN users u ON p.user_id = u.id
    LEFT JOIN board_categories bc ON p.category_id = bc.id
    WHERE p.session_id IS NULL
    ORDER BY p.created_at DESC
    LIMIT 5
  `).all();

  res.render('player/dashboard', { sessions, votedSessionIds, firstLogin, birthdayUsers, showWhatsNew, boardPosts });
});

module.exports = router;
