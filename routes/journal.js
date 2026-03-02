const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

// Quest Journal — timeline of completed sessions with recaps
router.get('/', requireLogin, (req, res) => {
  const arcFilter = req.query.arc || '';
  const playerFilter = req.query.player || '';
  const locationFilter = req.query.location || '';

  let sql = `
    SELECT s.id, s.title, s.summary, s.category, s.created_at, s.arc_id,
      sl.date_time as confirmed_date,
      u.username as dm_name,
      ca.name as arc_name, ca.color as arc_color,
      (SELECT COUNT(*) FROM session_attendance sa WHERE sa.session_id = s.id AND sa.attended = 1) as attendee_count,
      (SELECT COUNT(*) FROM session_images si WHERE si.session_id = s.id) as image_count
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    LEFT JOIN campaign_arcs ca ON s.arc_id = ca.id
    WHERE s.status = 'completed'
  `;
  const params = [];

  if (arcFilter) {
    sql += ' AND s.arc_id = ?';
    params.push(parseInt(arcFilter, 10));
  }
  if (playerFilter) {
    sql += ' AND EXISTS (SELECT 1 FROM session_attendance sa2 WHERE sa2.session_id = s.id AND sa2.user_id = ? AND sa2.attended = 1)';
    params.push(parseInt(playerFilter, 10));
  }
  if (locationFilter) {
    sql += ' AND s.location_id = ?';
    params.push(parseInt(locationFilter, 10));
  }

  sql += ' ORDER BY COALESCE(sl.date_time, s.created_at) DESC';

  const sessions = db.prepare(sql).all(...params);
  const arcs = db.prepare('SELECT * FROM campaign_arcs ORDER BY sort_order, name').all();
  const allPlayers = db.prepare("SELECT id, username FROM users ORDER BY username").all();
  const locations = db.prepare("SELECT id, name FROM map_locations ORDER BY name").all();
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  res.render('journal', { sessions, arcs, allPlayers, locations, isDM, arcFilter, playerFilter, locationFilter });
});

// Missed a Session? — sessions the current player missed
router.get('/missed', requireLogin, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.id, s.title, s.summary, s.category, s.created_at,
      sl.date_time as confirmed_date,
      u.username as dm_name
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    JOIN session_attendance sa ON sa.session_id = s.id AND sa.user_id = ? AND sa.attended = 0
    WHERE s.status = 'completed'
    ORDER BY COALESCE(sl.date_time, s.created_at) DESC
  `).all(req.user.id);

  res.render('journal-missed', { sessions });
});

// Arc CRUD (DM only)
router.post('/arcs', requireLogin, requireDM, (req, res) => {
  const { name, description, color } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Arc name is required.');
    return res.redirect('/journal');
  }
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM campaign_arcs').get();
  db.prepare('INSERT INTO campaign_arcs (name, description, color, sort_order, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), (description && description.trim()) || null, color || '#d4a843', (maxOrder.m || 0) + 1, req.user.id);
  req.flash('success', 'Arc created.');
  res.redirect('/journal');
});

router.post('/arcs/:id', requireLogin, requireDM, (req, res) => {
  const { name, description, color } = req.body;
  const arc = db.prepare('SELECT id FROM campaign_arcs WHERE id = ?').get(req.params.id);
  if (!arc) {
    req.flash('error', 'Arc not found.');
    return res.redirect('/journal');
  }
  db.prepare('UPDATE campaign_arcs SET name = ?, description = ?, color = ? WHERE id = ?')
    .run((name && name.trim()) || 'Untitled Arc', (description && description.trim()) || null, color || '#d4a843', arc.id);
  req.flash('success', 'Arc updated.');
  res.redirect('/journal');
});

router.post('/arcs/:id/delete', requireLogin, requireDM, (req, res) => {
  const arc = db.prepare('SELECT id FROM campaign_arcs WHERE id = ?').get(req.params.id);
  if (!arc) {
    req.flash('error', 'Arc not found.');
    return res.redirect('/journal');
  }
  db.prepare('UPDATE sessions SET arc_id = NULL WHERE arc_id = ?').run(arc.id);
  db.prepare('DELETE FROM campaign_arcs WHERE id = ?').run(arc.id);
  req.flash('success', 'Arc deleted.');
  res.redirect('/journal');
});

// Assign session to arc
router.post('/sessions/:id/arc', requireLogin, requireDM, (req, res) => {
  const { arc_id } = req.body;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/journal');
  }
  db.prepare('UPDATE sessions SET arc_id = ? WHERE id = ?').run(arc_id ? parseInt(arc_id, 10) : null, session.id);
  req.flash('success', 'Arc assigned.');
  res.redirect('/journal');
});

module.exports = router;
