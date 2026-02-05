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

  // Load reactions for session posts
  const postReactions = {};
  const userPostReactions = {};
  if (sessionPostIds.length > 0) {
    const ph = sessionPostIds.map(() => '?').join(',');
    const reactions = db.prepare(`SELECT post_id, reaction_type, COUNT(*) as count FROM post_reactions WHERE post_id IN (${ph}) GROUP BY post_id, reaction_type`).all(...sessionPostIds);
    for (const r of reactions) {
      if (!postReactions[r.post_id]) postReactions[r.post_id] = { likes: 0, dislikes: 0 };
      if (r.reaction_type === 'like') postReactions[r.post_id].likes = r.count;
      else postReactions[r.post_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT post_id, reaction_type FROM post_reactions WHERE post_id IN (${ph}) AND user_id = ?`).all(...sessionPostIds, req.user.id);
    for (const ur of userReactions) {
      userPostReactions[ur.post_id] = ur.reaction_type;
    }
  }

  // Load reactions for session replies
  const allReplyIds = [];
  for (const pid of sessionPostIds) {
    if (sessionReplyMap[pid]) {
      for (const r of sessionReplyMap[pid]) {
        allReplyIds.push(r.id);
      }
    }
  }
  const replyReactions = {};
  const userReplyReactions = {};
  if (allReplyIds.length > 0) {
    const ph = allReplyIds.map(() => '?').join(',');
    const reactions = db.prepare(`SELECT reply_id, reaction_type, COUNT(*) as count FROM reply_reactions WHERE reply_id IN (${ph}) GROUP BY reply_id, reaction_type`).all(...allReplyIds);
    for (const r of reactions) {
      if (!replyReactions[r.reply_id]) replyReactions[r.reply_id] = { likes: 0, dislikes: 0 };
      if (r.reaction_type === 'like') replyReactions[r.reply_id].likes = r.count;
      else replyReactions[r.reply_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT reply_id, reaction_type FROM reply_reactions WHERE reply_id IN (${ph}) AND user_id = ?`).all(...allReplyIds, req.user.id);
    for (const ur of userReactions) {
      userReplyReactions[ur.reply_id] = ur.reaction_type;
    }
  }

  // Load polls for session posts
  const postPolls = {};
  if (sessionPostIds.length > 0) {
    const ph = sessionPostIds.map(() => '?').join(',');
    const polls = db.prepare(`SELECT * FROM polls WHERE post_id IN (${ph})`).all(...sessionPostIds);
    for (const poll of polls) {
      const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(poll.id);
      const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(poll.id);
      const voteMap = {};
      for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
      const userVote = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(poll.id, req.user.id);
      const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(poll.id).count;
      postPolls[poll.post_id] = {
        ...poll,
        options: options.map(o => ({ ...o, votes: voteMap[o.id] || 0 })),
        userVote: userVote ? userVote.option_id : null,
        totalVotes
      };
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
    res.render('dm/session-detail', { session, slots, players, voteMap, slotSummary, preferences, preferenceMap, myPreference, myVotes, allUsersMap, unavailabilityMap, sessionPosts, sessionReplyMap, locationName, postReactions, userPostReactions, replyReactions, userReplyReactions, postPolls });
  } else {
    // Get this player's votes
    const myVotes = {};
    for (const v of votes) {
      if (v.user_id === req.user.id) {
        myVotes[v.slot_id] = v.status;
      }
    }
    res.render('player/vote', { session, slots, myVotes, sessionPosts, sessionReplyMap, locationName, postReactions, userPostReactions, replyReactions, userReplyReactions, postPolls });
  }
});

// Image URL validation helper
function isValidImageUrl(url) {
  if (!url) return false;
  url = url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  const allowedHosts = ['giphy.com', 'tenor.com', 'imgur.com', 'i.imgur.com', 'media.giphy.com', 'media.tenor.com'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (allowedHosts.some(h => host.includes(h))) return true;
    if (allowedExts.some(ext => parsed.pathname.toLowerCase().endsWith(ext))) return true;
  } catch (e) {}
  return false;
}

router.post('/:id/comment', requireLogin, (req, res) => {
  const { content, image_url, poll_question } = req.body;
  let pollOptions = req.body['poll_options[]'];
  if (pollOptions && !Array.isArray(pollOptions)) pollOptions = [pollOptions];

  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Comment content is required.');
    return res.redirect('/sessions/' + session.id);
  }

  // Validate image URL if provided
  let validImageUrl = null;
  if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) {
      validImageUrl = image_url.trim();
    }
  }

  const result = db.prepare('INSERT INTO posts (user_id, session_id, content, image_url) VALUES (?, ?, ?, ?)').run(req.user.id, session.id, content.trim(), validImageUrl);
  const postId = result.lastInsertRowid;

  // Create poll if question and at least 2 options provided
  if (poll_question && poll_question.trim() && pollOptions) {
    const validOptions = pollOptions.filter(o => o && o.trim());
    if (validOptions.length >= 2) {
      const pollResult = db.prepare('INSERT INTO polls (post_id, question) VALUES (?, ?)').run(postId, poll_question.trim());
      const pollId = pollResult.lastInsertRowid;
      for (let i = 0; i < validOptions.length; i++) {
        db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, validOptions[i].trim(), i);
      }
    }
  }

  notifyMentions(content.trim(), req.user.id, req.user.username, '/sessions/' + session.id);
  req.flash('success', 'Comment posted.');
  res.redirect('/sessions/' + session.id);
});

router.post('/:id/comment/:postId/reply', requireLogin, (req, res) => {
  const { content, image_url } = req.body;
  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND session_id = ?').get(req.params.postId, req.params.id);
  if (!post) {
    req.flash('error', 'Comment not found.');
    return res.redirect('/sessions/' + req.params.id);
  }
  if (!content || !content.trim()) {
    req.flash('error', 'Reply content is required.');
    return res.redirect('/sessions/' + req.params.id);
  }

  let validImageUrl = null;
  if (image_url && image_url.trim()) {
    if (isValidImageUrl(image_url)) {
      validImageUrl = image_url.trim();
    }
  }

  db.prepare('INSERT INTO replies (post_id, user_id, content, image_url) VALUES (?, ?, ?, ?)').run(post.id, req.user.id, content.trim(), validImageUrl);
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

// --- Session Comment Reactions ---

router.post('/:sessionId/comment/:postId/react', requireLogin, (req, res) => {
  const { reaction_type } = req.body;
  const postId = parseInt(req.params.postId, 10);
  const sessionId = parseInt(req.params.sessionId, 10);

  if (!['like', 'dislike'].includes(reaction_type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND session_id = ?').get(postId, sessionId);
  if (!post) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  const existing = db.prepare('SELECT * FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  if (existing) {
    if (existing.reaction_type === reaction_type) {
      db.prepare('DELETE FROM post_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE post_reactions SET reaction_type = ? WHERE id = ?').run(reaction_type, existing.id);
    }
  } else {
    db.prepare('INSERT INTO post_reactions (post_id, user_id, reaction_type) VALUES (?, ?, ?)').run(postId, req.user.id, reaction_type);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND reaction_type = ?').get(postId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND reaction_type = ?').get(postId, 'dislike').count;
  const userReaction = db.prepare('SELECT reaction_type FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.reaction_type : null });
});

router.post('/:sessionId/reply/:replyId/react', requireLogin, (req, res) => {
  const { reaction_type } = req.body;
  const replyId = parseInt(req.params.replyId, 10);

  if (!['like', 'dislike'].includes(reaction_type)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const reply = db.prepare('SELECT id FROM replies WHERE id = ?').get(replyId);
  if (!reply) {
    return res.status(404).json({ error: 'Reply not found' });
  }

  const existing = db.prepare('SELECT * FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  if (existing) {
    if (existing.reaction_type === reaction_type) {
      db.prepare('DELETE FROM reply_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE reply_reactions SET reaction_type = ? WHERE id = ?').run(reaction_type, existing.id);
    }
  } else {
    db.prepare('INSERT INTO reply_reactions (reply_id, user_id, reaction_type) VALUES (?, ?, ?)').run(replyId, req.user.id, reaction_type);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND reaction_type = ?').get(replyId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND reaction_type = ?').get(replyId, 'dislike').count;
  const userReaction = db.prepare('SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.reaction_type : null });
});

// --- Session Poll Voting ---

router.post('/:sessionId/poll/:pollId/vote', requireLogin, (req, res) => {
  const { option_id } = req.body;
  const pollId = parseInt(req.params.pollId, 10);
  const optionId = parseInt(option_id, 10);

  const poll = db.prepare('SELECT id FROM polls WHERE id = ?').get(pollId);
  if (!poll) {
    return res.status(404).json({ error: 'Poll not found' });
  }

  const option = db.prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?').get(optionId, pollId);
  if (!option) {
    return res.status(400).json({ error: 'Invalid option' });
  }

  const existing = db.prepare('SELECT * FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollId, req.user.id);
  if (existing) {
    db.prepare('UPDATE poll_votes SET option_id = ? WHERE id = ?').run(optionId, existing.id);
  } else {
    db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(pollId, optionId, req.user.id);
  }

  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(pollId);
  const voteCounts = db.prepare('SELECT option_id, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_id').all(pollId);
  const voteMap = {};
  for (const vc of voteCounts) voteMap[vc.option_id] = vc.count;
  const totalVotes = db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(pollId).count;

  res.json({
    options: options.map(o => ({ id: o.id, text: o.option_text, votes: voteMap[o.id] || 0 })),
    totalVotes,
    userVote: optionId
  });
});

module.exports = router;
