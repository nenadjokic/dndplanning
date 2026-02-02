const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM, requireAdmin } = require('../middleware/auth');
const { notifyMentions, notifySessionConfirmed } = require('../helpers/notifications');
const messenger = require('../helpers/messenger');
const pushService = require('../helpers/push');
const router = express.Router();

router.get('/new', requireLogin, requireDM, (req, res) => {
  // Query future unavailabilities for all players
  const today = new Date().toISOString().split('T')[0];
  const unavailabilities = db.prepare(`
    SELECT u.date, u.reason, usr.username
    FROM unavailability u
    JOIN users usr ON u.user_id = usr.id
    WHERE u.date >= ?
    ORDER BY u.date
  `).all(today);

  const mapLocations = db.prepare('SELECT ml.id, ml.name, m.name as map_name FROM map_locations ml LEFT JOIN maps m ON ml.map_id = m.id ORDER BY m.name, ml.name').all();

  res.render('dm/session-form', { session: null, slots: [], unavailabilities, mapLocations });
});

router.post('/', requireLogin, requireDM, (req, res) => {
  const { title, description, slot_dates, slot_labels, category, location_id } = req.body;
  const validCategories = ['dnd', 'rpg', 'gamenight', 'casual'];
  const sessionCategory = validCategories.includes(category) ? category : 'dnd';
  const slotDatesDate = req.body['slot_dates_date'];
  const slotDatesTime = req.body['slot_dates_time'];

  // Support both legacy datetime-local (slot_dates) and new split date+time inputs
  let dates, labels;
  if (slotDatesDate) {
    const dArr = Array.isArray(slotDatesDate) ? slotDatesDate : [slotDatesDate];
    const tArr = Array.isArray(slotDatesTime) ? slotDatesTime : [slotDatesTime || ''];
    dates = dArr.map((d, i) => {
      if (!d || !d.trim()) return '';
      const time = (tArr[i] && tArr[i].trim()) || '00:00';
      return d.trim() + 'T' + time;
    });
    labels = Array.isArray(slot_labels) ? slot_labels : [slot_labels];
  } else {
    if (!slot_dates || slot_dates.length === 0) {
      req.flash('error', 'Title and at least one time slot are required.');
      return res.redirect('/sessions/new');
    }
    dates = Array.isArray(slot_dates) ? slot_dates : [slot_dates];
    labels = Array.isArray(slot_labels) ? slot_labels : [slot_labels];
  }

  if (!title) {
    req.flash('error', 'Title and at least one time slot are required.');
    return res.redirect('/sessions/new');
  }

  const validDates = dates.filter(d => d && d.trim());
  if (validDates.length === 0) {
    req.flash('error', 'At least one valid time slot is required.');
    return res.redirect('/sessions/new');
  }

  const locId = location_id ? parseInt(location_id, 10) : null;
  const insertSession = db.prepare('INSERT INTO sessions (title, description, created_by, category, location_id) VALUES (?, ?, ?, ?, ?)');
  const insertSlot = db.prepare('INSERT INTO slots (session_id, date_time, label) VALUES (?, ?, ?)');

  const createSession = db.transaction(() => {
    const result = insertSession.run(title, description || null, req.user.id, sessionCategory, locId);
    const sessionId = result.lastInsertRowid;

    for (let i = 0; i < dates.length; i++) {
      if (dates[i] && dates[i].trim()) {
        insertSlot.run(sessionId, dates[i].trim(), (labels[i] && labels[i].trim()) || null);
      }
    }

    return sessionId;
  });

  const sessionId = createSession();
  messenger.send('session_created', { title, category: sessionCategory, link: '/sessions/' + sessionId, actorName: req.user.username }).catch(() => {});
  pushService.sendToAll('New Quest Posted', `"${title}" — Vote now!`, '/sessions/' + sessionId).catch(() => {});
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

  const players = db.prepare("SELECT id, username FROM users ORDER BY username").all();

  // Build allUsersMap for avatars
  const allUsers = db.prepare('SELECT id, username, avatar FROM users').all();
  const allUsersMap = {};
  for (const u of allUsers) {
    allUsersMap[u.id] = { username: u.username, avatar: u.avatar };
  }

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

  // Build unavailabilityMap: { 'YYYY-MM-DD': [{ username, reason }] }
  const slotDates = slots.map(s => s.date_time.split('T')[0]);
  const unavailabilityMap = {};
  if (slotDates.length > 0) {
    const placeholders = slotDates.map(() => '?').join(',');
    const unavails = db.prepare(`
      SELECT u.date, u.reason, usr.username
      FROM unavailability u
      JOIN users usr ON u.user_id = usr.id
      WHERE u.date IN (${placeholders})
    `).all(...slotDates);

    for (const u of unavails) {
      if (!unavailabilityMap[u.date]) unavailabilityMap[u.date] = [];
      unavailabilityMap[u.date].push({ username: u.username, reason: u.reason });
    }
  }

  // Load location name if set
  let locationName = null;
  if (session.location_id) {
    const loc = db.prepare('SELECT name FROM map_locations WHERE id = ?').get(session.location_id);
    if (loc) locationName = loc.name;
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

  // Load session comments
  const sessionPosts = db.prepare(`
    SELECT p.*, u.username, u.avatar
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.session_id = ?
    ORDER BY p.created_at ASC
  `).all(session.id);

  const sessionPostIds = sessionPosts.map(p => p.id);
  const sessionReplyMap = {};
  if (sessionPostIds.length > 0) {
    const ph = sessionPostIds.map(() => '?').join(',');
    const replies = db.prepare(`
      SELECT r.*, u.username, u.avatar
      FROM replies r
      JOIN users u ON r.user_id = u.id
      WHERE r.post_id IN (${ph})
      ORDER BY r.created_at ASC
    `).all(...sessionPostIds);
    for (const r of replies) {
      if (!sessionReplyMap[r.post_id]) sessionReplyMap[r.post_id] = [];
      sessionReplyMap[r.post_id].push(r);
    }
  }

  if (isDM) {
    const myPreference = preferenceMap[req.user.id] || null;
    const myVotes = {};
    for (const v of votes) {
      if (v.user_id === req.user.id) {
        myVotes[v.slot_id] = v.status;
      }
    }
    res.render('dm/session-detail', { session, slots, players, voteMap, slotSummary, preferences, preferenceMap, myPreference, myVotes, allUsersMap, unavailabilityMap, sessionPosts, sessionReplyMap, locationName });
  } else {
    // Get this player's votes
    const myVotes = {};
    for (const v of votes) {
      if (v.user_id === req.user.id) {
        myVotes[v.slot_id] = v.status;
      }
    }
    res.render('player/vote', { session, slots, myVotes, sessionPosts, sessionReplyMap, locationName });
  }
});

router.post('/:id/comment', requireLogin, (req, res) => {
  const { content } = req.body;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Comment content is required.');
    return res.redirect('/sessions/' + session.id);
  }
  db.prepare('INSERT INTO posts (user_id, session_id, content) VALUES (?, ?, ?)').run(req.user.id, session.id, content.trim());
  notifyMentions(content.trim(), req.user.id, req.user.username, '/sessions/' + session.id);
  req.flash('success', 'Comment posted.');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/comment/:postId/reply', requireLogin, (req, res) => {
  const { content } = req.body;
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND session_id = ?').get(req.params.postId, req.params.id);
  if (!post) {
    req.flash('error', 'Comment not found.');
    return res.redirect('/sessions/' + req.params.id);
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Reply content is required.');
    return res.redirect('/sessions/' + req.params.id);
  }
  db.prepare('INSERT INTO replies (post_id, user_id, content) VALUES (?, ?, ?)').run(post.id, req.user.id, content.trim());
  notifyMentions(content.trim(), req.user.id, req.user.username, '/sessions/' + req.params.id);
  req.flash('success', 'Reply posted.');
  res.redirect('/sessions/' + req.params.id);
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

  notifySessionConfirmed(session.id, session.title, req.user.username);

  const confirmedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot_id);
  const slotDateTime = confirmedSlot ? confirmedSlot.date_time : '';
  const slotDate = slotDateTime ? slotDateTime.split('T')[0] : '';
  const slotTime = slotDateTime && slotDateTime.includes('T') ? slotDateTime.split('T')[1] : '';
  messenger.send('session_confirmed', {
    title: session.title, date: slotDate, time: slotTime,
    label: confirmedSlot ? confirmedSlot.label : '',
    link: '/sessions/' + session.id, actorName: req.user.username
  }).catch(() => {});
  pushService.sendToAll('Quest Confirmed', `"${session.title}" on ${slotDate}`, '/sessions/' + session.id).catch(() => {});

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

  messenger.send('session_cancelled', { title: session.title, link: '/sessions/' + session.id, actorName: req.user.username }).catch(() => {});
  pushService.sendToAll('Quest Cancelled', `"${session.title}" has been cancelled.`, '/sessions/' + session.id).catch(() => {});

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

  messenger.send('session_reopened', { title: session.title, link: '/sessions/' + session.id, actorName: req.user.username }).catch(() => {});

  req.flash('success', 'The quest board has been reopened!');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/summary', requireLogin, requireDM, (req, res) => {
  const { summary } = req.body;
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  if (!summary || !summary.trim()) {
    req.flash('error', 'Recap content is required.');
    return res.redirect('/sessions/' + session.id);
  }

  if (session.status === 'confirmed') {
    db.prepare('UPDATE sessions SET summary = ?, status = ? WHERE id = ?')
      .run(summary.trim(), 'completed', session.id);
    messenger.send('session_completed', {
      title: session.title, summary: summary.trim(),
      link: '/sessions/' + session.id, actorName: req.user.username
    }).catch(() => {});
    pushService.sendToAll('Quest Completed', `"${session.title}" — Recap available!`, '/sessions/' + session.id).catch(() => {});
    req.flash('success', 'Session recap saved and quest completed!');
  } else {
    db.prepare('UPDATE sessions SET summary = ? WHERE id = ?')
      .run(summary.trim(), session.id);
    messenger.send('session_recap', {
      title: session.title, summary: summary.trim(),
      link: '/sessions/' + session.id, actorName: req.user.username
    }).catch(() => {});
    pushService.sendToAll('Recap Updated', `Recap updated for "${session.title}"`, '/sessions/' + session.id).catch(() => {});
    req.flash('success', 'Session recap updated.');
  }

  res.redirect('/sessions/' + session.id);
});

router.post('/:id/delete', requireLogin, requireAdmin, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  const deleteSession = db.transaction(() => {
    // Clear confirmed_slot_id FK before deleting slots
    db.prepare('UPDATE sessions SET confirmed_slot_id = NULL WHERE id = ?').run(session.id);
    db.prepare('DELETE FROM preferences WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM votes WHERE slot_id IN (SELECT id FROM slots WHERE session_id = ?)').run(session.id);
    // Delete replies and posts for this session
    db.prepare('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE session_id = ?)').run(session.id);
    db.prepare('DELETE FROM posts WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM slots WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  });

  deleteSession();
  req.flash('success', 'The quest has been erased from the tavern board.');
  res.redirect('/');
});

module.exports = router;
