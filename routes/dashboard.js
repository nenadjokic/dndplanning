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

  const addonManager = req.app.locals.addonManager;
  const addonEnabled = (id) => addonManager ? addonManager.isEnabled(id) : false;

  const birthdayUsers = db.prepare(`
    SELECT username, avatar FROM users
    WHERE birthday IS NOT NULL
    AND substr(birthday, 6) = strftime('%m-%d', 'now', 'localtime')
  `).all();

  // Latest recap — only query if quest-journal addon is enabled
  let latestRecap = null;
  if (addonEnabled('quest-journal')) {
    try {
      latestRecap = db.prepare(`
        SELECT s.id, s.title, s.summary, sl.date_time as confirmed_date, u.username as dm_name
        FROM sessions s
        JOIN users u ON s.created_by = u.id
        LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
        WHERE s.status = 'completed' AND s.summary IS NOT NULL AND s.summary != ''
        ORDER BY COALESCE(sl.date_time, s.created_at) DESC LIMIT 1
      `).get() || null;
    } catch (e) { /* ignore */ }
  }

  // Campaign JOIN (only if campaigns addon is enabled)
  const campJoin = addonEnabled('campaigns') ? 'LEFT JOIN campaigns camp ON s.campaign_id = camp.id' : '';
  const campSelect = addonEnabled('campaigns') ? ', camp.name as campaign_name, camp.color as campaign_color' : '';

  const effectiveRole = res.locals.effectiveRole || req.user.role;
  if (effectiveRole === 'dm' || effectiveRole === 'admin') {
    const sessions = db.prepare(`
      SELECT s.*, sl.date_time as confirmed_date, sl.label as confirmed_label
        ${campSelect}
      FROM sessions s
      LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
      ${campJoin}
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

    // Vote progress per open session
    const totalPlayers = db.prepare(`SELECT COUNT(*) as cnt FROM users WHERE role != 'admin' OR role = 'admin'`).get().cnt;
    const openSessionIds = sessions.filter(s => s.status === 'open').map(s => s.id);
    const voteProgress = {};
    for (const sid of openSessionIds) {
      const voted = db.prepare(`
        SELECT COUNT(DISTINCT v.user_id) as cnt
        FROM votes v
        JOIN slots sl ON v.slot_id = sl.id
        WHERE sl.session_id = ?
      `).get(sid);
      voteProgress[sid] = { voted: voted.cnt, total: totalPlayers };
    }

    // Get dashboard widgets from addons
    const dashboardWidgets = addonManager ? addonManager.getDashboardWidgets(req.user, true) : [];

    return res.render('dm/dashboard', { sessions, firstLogin, birthdayUsers, showWhatsNew, latestRecap, voteProgress, dashboardWidgets });
  }

  // Player dashboard
  const sessions = db.prepare(`
    SELECT s.*, u.username as dm_name,
      sl.date_time as confirmed_date, sl.label as confirmed_label
      ${campSelect}
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    ${campJoin}
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

  // Get dashboard widgets from addons
  const dashboardWidgets = addonManager ? addonManager.getDashboardWidgets(req.user, false) : [];

  res.render('player/dashboard', { sessions, votedSessionIds, firstLogin, birthdayUsers, showWhatsNew, latestRecap, dashboardWidgets });
});

module.exports = router;
