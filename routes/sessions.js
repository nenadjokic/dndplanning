const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

router.get('/new', requireLogin, requireDM, (req, res) => {
  res.render('dm/session-form', { session: null, slots: [] });
});

router.post('/', requireLogin, requireDM, (req, res) => {
  const { title, description, slot_dates, slot_labels } = req.body;

  if (!title || !slot_dates || slot_dates.length === 0) {
    req.flash('error', 'Title and at least one time slot are required.');
    return res.redirect('/sessions/new');
  }

  const dates = Array.isArray(slot_dates) ? slot_dates : [slot_dates];
  const labels = Array.isArray(slot_labels) ? slot_labels : [slot_labels];

  const validDates = dates.filter(d => d && d.trim());
  if (validDates.length === 0) {
    req.flash('error', 'At least one valid time slot is required.');
    return res.redirect('/sessions/new');
  }

  const insertSession = db.prepare('INSERT INTO sessions (title, description, created_by) VALUES (?, ?, ?)');
  const insertSlot = db.prepare('INSERT INTO slots (session_id, date_time, label) VALUES (?, ?, ?)');

  const createSession = db.transaction(() => {
    const result = insertSession.run(title, description || null, req.user.id);
    const sessionId = result.lastInsertRowid;

    for (let i = 0; i < dates.length; i++) {
      if (dates[i] && dates[i].trim()) {
        insertSlot.run(sessionId, dates[i].trim(), (labels[i] && labels[i].trim()) || null);
      }
    }

    return sessionId;
  });

  const sessionId = createSession();
  req.flash('success', 'Quest session posted to the tavern board!');
  res.redirect('/sessions/' + sessionId);
});

router.get('/:id', requireLogin, (req, res) => {
  const session = db.prepare(`
    SELECT s.*, u.username as dm_name
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    WHERE s.id = ?
  `).get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  const slots = db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(session.id);

  const players = db.prepare("SELECT id, username FROM users WHERE role = 'player' ORDER BY username").all();

  const votes = db.prepare(`
    SELECT v.slot_id, v.user_id, v.status
    FROM votes v
    JOIN slots s ON v.slot_id = s.id
    WHERE s.session_id = ?
  `).all(session.id);

  // Build vote map: { slotId: { userId: status } }
  const voteMap = {};
  for (const v of votes) {
    if (!voteMap[v.slot_id]) voteMap[v.slot_id] = {};
    voteMap[v.slot_id][v.user_id] = v.status;
  }

  // Count available votes per slot
  const slotSummary = {};
  for (const slot of slots) {
    slotSummary[slot.id] = { available: 0, maybe: 0, unavailable: 0 };
    for (const player of players) {
      const status = (voteMap[slot.id] && voteMap[slot.id][player.id]) || null;
      if (status === 'available') slotSummary[slot.id].available++;
      else if (status === 'maybe') slotSummary[slot.id].maybe++;
      else if (status === 'unavailable') slotSummary[slot.id].unavailable++;
    }
  }

  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  // Load preferences for DM/admin users
  const preferences = db.prepare(`
    SELECT p.user_id, p.slot_id, u.username
    FROM preferences p
    JOIN users u ON p.user_id = u.id
    WHERE p.session_id = ?
  `).all(session.id);

  const preferenceMap = {};
  for (const p of preferences) {
    preferenceMap[p.user_id] = { slot_id: p.slot_id, username: p.username };
  }

  if (isDM) {
    const myPreference = preferenceMap[req.user.id] || null;
    res.render('dm/session-detail', { session, slots, players, voteMap, slotSummary, preferences, preferenceMap, myPreference });
  } else {
    // Get this player's votes
    const myVotes = {};
    for (const v of votes) {
      if (v.user_id === req.user.id) {
        myVotes[v.slot_id] = v.status;
      }
    }
    res.render('player/vote', { session, slots, myVotes });
  }
});

router.post('/:id/confirm', requireLogin, requireDM, (req, res) => {
  const { slot_id } = req.body;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  db.prepare('UPDATE sessions SET status = ?, confirmed_slot_id = ? WHERE id = ?')
    .run('confirmed', slot_id, session.id);

  req.flash('success', 'The quest date has been proclaimed!');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/cancel', requireLogin, requireDM, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  db.prepare('UPDATE sessions SET status = ?, confirmed_slot_id = NULL WHERE id = ?')
    .run('cancelled', session.id);

  req.flash('success', 'The quest has been cancelled.');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/prefer', requireLogin, requireDM, (req, res) => {
  const { slot_id } = req.body;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  if (!slot_id) {
    db.prepare('DELETE FROM preferences WHERE session_id = ? AND user_id = ?')
      .run(session.id, req.user.id);
    req.flash('success', 'Preference cleared.');
    return res.redirect('/sessions/' + session.id);
  }

  db.prepare(`
    INSERT INTO preferences (session_id, user_id, slot_id)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id, user_id)
    DO UPDATE SET slot_id = excluded.slot_id
  `).run(session.id, req.user.id, slot_id);

  req.flash('success', 'Your preferred date has been set!');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/reopen', requireLogin, requireDM, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  db.prepare('UPDATE sessions SET status = ?, confirmed_slot_id = NULL WHERE id = ?')
    .run('open', session.id);

  req.flash('success', 'The quest board has been reopened!');
  res.redirect('/sessions/' + session.id);
});

module.exports = router;
