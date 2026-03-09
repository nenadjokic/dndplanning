const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM, requireAdmin } = require('../middleware/auth');
const { notifyMentions, notifySessionConfirmed } = require('../helpers/notifications');
const notifier = require('../helpers/notifier');
const pushService = require('../helpers/push');
const sse = require('../helpers/sse');
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

  let campaigns = [];
  try { campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all(); } catch (e) {}

  const preselectedCampaign = req.query.campaign_id ? parseInt(req.query.campaign_id, 10) : null;

  res.render('dm/session-form', { session: null, slots: [], unavailabilities, mapLocations, campaigns, preselectedCampaign });
});

router.post('/', requireLogin, requireDM, (req, res) => {
  const { title, description, slot_dates, slot_labels, category, location_id, recurrence_day, recurrence_time, min_players, campaign_id } = req.body;
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

  // Build recurrence rule if provided
  let recurrenceRule = null;
  const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (recurrence_day && validDays.includes(recurrence_day)) {
    recurrenceRule = JSON.stringify({ day: recurrence_day, time: recurrence_time || '19:00' });
  }

  // Parse min_players
  const minPlayers = min_players ? Math.max(1, Math.min(20, parseInt(min_players, 10) || 0)) : null;

  const campId = campaign_id ? parseInt(campaign_id, 10) : null;

  const insertSession = db.prepare('INSERT INTO sessions (title, description, created_by, category, location_id, recurrence_rule, min_players, campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertSlot = db.prepare('INSERT INTO slots (session_id, date_time, label) VALUES (?, ?, ?)');

  const createSession = db.transaction(() => {
    const result = insertSession.run(title, description || null, req.user.id, sessionCategory, locId, recurrenceRule, minPlayers || null, campId);
    const sessionId = result.lastInsertRowid;

    for (let i = 0; i < dates.length; i++) {
      if (dates[i] && dates[i].trim()) {
        insertSlot.run(sessionId, dates[i].trim(), (labels[i] && labels[i].trim()) || null);
      }
    }

    return sessionId;
  });

  const sessionId = createSession();

  // Broadcast new session
  sse.broadcast('new-session', {
    username: req.user.username,
    title: title,
    sessionId: sessionId
  });

  const slots = db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(sessionId);
  const slotDates = slots.map(s => {
    const d = new Date(s.date_time);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  });
  const playerCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'dm' AND role != 'admin'").get().c;
  notifier.send('session_created', { title, description, category: sessionCategory, sessionId, slots, slotDates, playerCount, link: '/sessions/' + sessionId, actorName: req.user.username }).catch(() => {});
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

  // Load session notes for current user
  let myNotes = null;
  const noteType = isDM ? 'dm' : 'player';
  myNotes = db.prepare('SELECT * FROM session_notes WHERE session_id = ? AND user_id = ? AND note_type = ?').get(session.id, req.user.id, noteType);

  // Load session gallery images
  const sessionImages = db.prepare(`
    SELECT si.*, u.username
    FROM session_images si
    JOIN users u ON si.user_id = u.id
    WHERE si.session_id = ?
    ORDER BY si.created_at ASC
  `).all(session.id);

  // Load attendance data
  const attendance = db.prepare('SELECT sa.*, u.username FROM session_attendance sa JOIN users u ON sa.user_id = u.id WHERE sa.session_id = ?').all(session.id);
  const attendanceMap = {};
  for (const a of attendance) {
    attendanceMap[a.user_id] = a.attended;
  }

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
    const reactions = db.prepare(`SELECT post_id, emoji, COUNT(*) as count FROM post_reactions WHERE post_id IN (${ph}) GROUP BY post_id, emoji`).all(...sessionPostIds);
    for (const r of reactions) {
      if (!postReactions[r.post_id]) postReactions[r.post_id] = { likes: 0, dislikes: 0 };
      if (r.emoji === 'like') postReactions[r.post_id].likes = r.count;
      else postReactions[r.post_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT post_id, emoji FROM post_reactions WHERE post_id IN (${ph}) AND user_id = ?`).all(...sessionPostIds, req.user.id);
    for (const ur of userReactions) {
      userPostReactions[ur.post_id] = ur.emoji;
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
    const reactions = db.prepare(`SELECT reply_id, emoji, COUNT(*) as count FROM reply_reactions WHERE reply_id IN (${ph}) GROUP BY reply_id, emoji`).all(...allReplyIds);
    for (const r of reactions) {
      if (!replyReactions[r.reply_id]) replyReactions[r.reply_id] = { likes: 0, dislikes: 0 };
      if (r.emoji === 'like') replyReactions[r.reply_id].likes = r.count;
      else replyReactions[r.reply_id].dislikes = r.count;
    }
    const userReactions = db.prepare(`SELECT reply_id, emoji FROM reply_reactions WHERE reply_id IN (${ph}) AND user_id = ?`).all(...allReplyIds, req.user.id);
    for (const ur of userReactions) {
      userReplyReactions[ur.reply_id] = ur.emoji;
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

  const protocol = req.protocol;
  const host = req.get('host');
  const sessionForOG = session;

  // Compute per-slot quorum data
  const quorumData = {};
  if (session.min_players) {
    for (const slot of slots) {
      const available = slotSummary[slot.id].available;
      quorumData[slot.id] = {
        met: available >= session.min_players,
        needed: Math.max(0, session.min_players - available),
        available: available
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
    const arcs = db.prepare('SELECT * FROM campaign_arcs ORDER BY sort_order, name').all();
    res.render('dm/session-detail', { session, slots, players, voteMap, slotSummary, preferences, preferenceMap, myPreference, myVotes, allUsersMap, unavailabilityMap, sessionPosts, sessionReplyMap, locationName, postReactions, userPostReactions, replyReactions, userReplyReactions, postPolls, sessionForOG, protocol, host, myNotes, sessionImages, attendanceMap, quorumData, arcs });
  } else {
    // Get this player's votes
    const myVotes = {};
    for (const v of votes) {
      if (v.user_id === req.user.id) {
        myVotes[v.slot_id] = v.status;
      }
    }
    res.render('player/vote', { session, slots, myVotes, players, voteMap, slotSummary, allUsersMap, unavailabilityMap, sessionPosts, sessionReplyMap, locationName, postReactions, userPostReactions, replyReactions, userReplyReactions, postPolls, sessionForOG, protocol, host, myNotes, sessionImages, quorumData });
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
  // Express with extended:true parses poll_options[] as poll_options
  let pollOptions = req.body.poll_options || req.body['poll_options[]'];
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

  // Broadcast new comment
  sse.broadcast('new-comment', {
    username: req.user.username,
    sessionTitle: session.title,
    sessionId: session.id,
    postId: postId,
    content: content.trim()
  });

  // Create poll if question and at least 2 options provided
  if (poll_question && poll_question.trim() && pollOptions) {
    const validOptions = pollOptions.filter(o => o && o.trim());
    if (validOptions.length >= 2) {
      const pollResult = db.prepare('INSERT INTO polls (post_id, user_id, question) VALUES (?, ?, ?)').run(postId, req.user.id, poll_question.trim());
      const pollId = pollResult.lastInsertRowid;
      for (let i = 0; i < validOptions.length; i++) {
        db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, validOptions[i].trim(), i);
      }
      // Broadcast poll created
      sse.broadcast('poll-created', {
        username: req.user.username,
        question: poll_question.trim(),
        sessionId: session.id
      });
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

  // Broadcast new reply
  const session = db.prepare('SELECT title FROM sessions WHERE id = ?').get(req.params.id);
  sse.broadcast('new-comment', {
    username: req.user.username,
    sessionTitle: session ? session.title : null
  });

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

  // Broadcast session confirmed
  sse.broadcast('session-confirmed', {
    username: req.user.username,
    sessionTitle: session.title,
    sessionId: session.id
  });

  notifySessionConfirmed(session.id, session.title, req.user.username);

  const confirmedSlot = db.prepare('SELECT * FROM slots WHERE id = ?').get(slot_id);
  const slotDateTime = confirmedSlot ? confirmedSlot.date_time : '';
  const slotDate = slotDateTime ? slotDateTime.split('T')[0] : '';
  const slotTime = slotDateTime && slotDateTime.includes('T') ? slotDateTime.split('T')[1] : '';
  const confirmedPlayers = db.prepare(`
    SELECT u.username FROM votes v
    JOIN users u ON v.user_id = u.id
    WHERE v.slot_id = ? AND v.status = 'available'
  `).all(slot_id).map(r => r.username);
  const sessionLocation = session.location_id ? db.prepare('SELECT name FROM map_locations WHERE id = ?').get(session.location_id) : null;
  notifier.send('session_confirmed', {
    title: session.title, date: slotDate, time: slotTime,
    label: confirmedSlot ? confirmedSlot.label : '',
    playerList: confirmedPlayers,
    mapName: sessionLocation ? sessionLocation.name : null,
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

  // Broadcast session cancelled
  sse.broadcast('session-cancelled', {
    username: req.user.username,
    sessionTitle: session.title,
    sessionId: session.id
  });

  notifier.send('session_cancelled', { title: session.title, link: '/sessions/' + session.id, actorName: req.user.username }).catch(() => {});
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

  const slots = db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(session.id);
  notifier.send('session_reopened', { title: session.title, description: session.description, sessionId: session.id, slots, link: '/sessions/' + session.id, actorName: req.user.username }).catch(() => {});

  req.flash('success', 'The quest board has been reopened!');
  res.redirect('/sessions/' + session.id);
});

// --- Generate Next Recurring Session ---
router.post('/:id/generate-next', requireLogin, requireDM, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  if (!session.recurrence_rule) {
    req.flash('error', 'This session has no recurrence rule.');
    return res.redirect('/sessions/' + session.id);
  }

  const rule = JSON.parse(session.recurrence_rule);
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = dayNames.indexOf(rule.day);

  // Find latest slot date from this session
  const latestSlot = db.prepare('SELECT date_time FROM slots WHERE session_id = ? ORDER BY date_time DESC LIMIT 1').get(session.id);
  let baseDate = latestSlot ? new Date(latestSlot.date_time) : new Date();

  // Calculate next occurrence: advance to next matching weekday
  let nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + 1); // start from tomorrow
  while (nextDate.getDay() !== targetDay) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  const dateStr = nextDate.toISOString().split('T')[0];
  const timeStr = rule.time || '19:00';
  const slotDateTime = dateStr + 'T' + timeStr;

  const createNext = db.transaction(() => {
    const result = db.prepare('INSERT INTO sessions (title, description, created_by, category, location_id, recurrence_rule, parent_session_id, min_players, campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      session.title, session.description, req.user.id, session.category, session.location_id, session.recurrence_rule, session.id, session.min_players, session.campaign_id || null
    );
    const newId = result.lastInsertRowid;
    db.prepare('INSERT INTO slots (session_id, date_time) VALUES (?, ?)').run(newId, slotDateTime);
    return newId;
  });

  const newSessionId = createNext();

  sse.broadcast('new-session', {
    username: req.user.username,
    title: session.title,
    sessionId: newSessionId
  });
  const newSlots = db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(newSessionId);
  notifier.send('session_created', { title: session.title, description: session.description, category: session.category, sessionId: newSessionId, slots: newSlots, link: '/sessions/' + newSessionId, actorName: req.user.username }).catch(() => {});
  pushService.sendToAll('Next Session Posted', `"${session.title}" — Vote now!`, '/sessions/' + newSessionId).catch(() => {});

  req.flash('success', 'Next recurring session created!');
  res.redirect('/sessions/' + newSessionId);
});

// --- Skip and Generate Next ---
router.post('/:id/skip', requireLogin, requireDM, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  if (!session.recurrence_rule) {
    req.flash('error', 'This session has no recurrence rule.');
    return res.redirect('/sessions/' + session.id);
  }

  // Cancel current session
  db.prepare('UPDATE sessions SET status = ?, confirmed_slot_id = NULL WHERE id = ?').run('cancelled', session.id);

  sse.broadcast('session-cancelled', {
    username: req.user.username,
    sessionTitle: session.title,
    sessionId: session.id
  });

  const rule = JSON.parse(session.recurrence_rule);
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = dayNames.indexOf(rule.day);

  const latestSlot = db.prepare('SELECT date_time FROM slots WHERE session_id = ? ORDER BY date_time DESC LIMIT 1').get(session.id);
  let baseDate = latestSlot ? new Date(latestSlot.date_time) : new Date();

  let nextDate = new Date(baseDate);
  nextDate.setDate(nextDate.getDate() + 1);
  while (nextDate.getDay() !== targetDay) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  const dateStr = nextDate.toISOString().split('T')[0];
  const timeStr = rule.time || '19:00';
  const slotDateTime = dateStr + 'T' + timeStr;

  const createNext = db.transaction(() => {
    const result = db.prepare('INSERT INTO sessions (title, description, created_by, category, location_id, recurrence_rule, parent_session_id, min_players, campaign_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      session.title, session.description, req.user.id, session.category, session.location_id, session.recurrence_rule, session.id, session.min_players, session.campaign_id || null
    );
    const newId = result.lastInsertRowid;
    db.prepare('INSERT INTO slots (session_id, date_time) VALUES (?, ?)').run(newId, slotDateTime);
    return newId;
  });

  const newSessionId = createNext();

  sse.broadcast('new-session', {
    username: req.user.username,
    title: session.title,
    sessionId: newSessionId
  });
  const skipSlots = db.prepare('SELECT * FROM slots WHERE session_id = ? ORDER BY date_time').all(newSessionId);
  notifier.send('session_created', { title: session.title, description: session.description, category: session.category, sessionId: newSessionId, slots: skipSlots, link: '/sessions/' + newSessionId, actorName: req.user.username }).catch(() => {});
  pushService.sendToAll('Next Session Posted', `"${session.title}" (skipped this week)`, '/sessions/' + newSessionId).catch(() => {});

  req.flash('success', 'Session skipped — next recurring session created.');
  res.redirect('/sessions/' + newSessionId);
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
    notifier.send('session_completed', {
      title: session.title, summary: summary.trim(),
      link: '/sessions/' + session.id, actorName: req.user.username
    }).catch(() => {});
    pushService.sendToAll('Quest Completed', `"${session.title}" — Recap available!`, '/sessions/' + session.id).catch(() => {});
    req.flash('success', 'Session recap saved and quest completed!');
  } else {
    db.prepare('UPDATE sessions SET summary = ? WHERE id = ?')
      .run(summary.trim(), session.id);
    notifier.send('session_recap', {
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
    // Delete session notes, images, and attendance
    db.prepare('DELETE FROM session_notes WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM session_images WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM session_attendance WHERE session_id = ?').run(session.id);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
  });

  deleteSession();
  req.flash('success', 'The quest has been erased from the tavern board.');
  res.redirect('/');
});

// --- Session Comment Reactions ---

router.post('/:sessionId/comment/:postId/react', requireLogin, (req, res) => {
  const { emoji } = req.body;
  const postId = parseInt(req.params.postId, 10);
  const sessionId = parseInt(req.params.sessionId, 10);

  if (!['like', 'dislike'].includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const post = db.prepare('SELECT id FROM posts WHERE id = ? AND session_id = ?').get(postId, sessionId);
  if (!post) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  const existing = db.prepare('SELECT * FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  if (existing) {
    if (existing.emoji === emoji) {
      db.prepare('DELETE FROM post_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE post_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO post_reactions (post_id, user_id, emoji) VALUES (?, ?, ?)').run(postId, req.user.id, emoji);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND emoji = ?').get(postId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM post_reactions WHERE post_id = ? AND emoji = ?').get(postId, 'dislike').count;
  const userReaction = db.prepare('SELECT emoji FROM post_reactions WHERE post_id = ? AND user_id = ?').get(postId, req.user.id);

  // Broadcast to all clients
  sse.broadcast('post-reaction', { postId, likes, dislikes, sessionId });

  // Broadcast like activity
  if (emoji === 'like' && (!existing || existing.emoji !== 'like')) {
    const session = db.prepare('SELECT title FROM sessions WHERE id = ?').get(sessionId);
    sse.broadcast('like-activity', {
      username: req.user.username,
      postId: postId,
      sessionId: sessionId,
      sessionTitle: session ? session.title : null
    });
  }

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.emoji : null });
});

router.post('/:sessionId/reply/:replyId/react', requireLogin, (req, res) => {
  const { emoji } = req.body;
  const replyId = parseInt(req.params.replyId, 10);

  if (!['like', 'dislike'].includes(emoji)) {
    return res.status(400).json({ error: 'Invalid reaction type' });
  }

  const reply = db.prepare('SELECT id FROM replies WHERE id = ?').get(replyId);
  if (!reply) {
    return res.status(404).json({ error: 'Reply not found' });
  }

  const existing = db.prepare('SELECT * FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  if (existing) {
    if (existing.emoji === emoji) {
      db.prepare('DELETE FROM reply_reactions WHERE id = ?').run(existing.id);
    } else {
      db.prepare('UPDATE reply_reactions SET emoji = ? WHERE id = ?').run(emoji, existing.id);
    }
  } else {
    db.prepare('INSERT INTO reply_reactions (reply_id, user_id, emoji) VALUES (?, ?, ?)').run(replyId, req.user.id, emoji);
  }

  const likes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND emoji = ?').get(replyId, 'like').count;
  const dislikes = db.prepare('SELECT COUNT(*) as count FROM reply_reactions WHERE reply_id = ? AND emoji = ?').get(replyId, 'dislike').count;
  const userReaction = db.prepare('SELECT emoji FROM reply_reactions WHERE reply_id = ? AND user_id = ?').get(replyId, req.user.id);

  // Broadcast to all clients
  sse.broadcast('reply-reaction', { replyId, likes, dislikes });

  res.json({ likes, dislikes, userReaction: userReaction ? userReaction.emoji : null });
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

  const pollData = {
    options: options.map(o => ({ id: o.id, text: o.option_text, votes: voteMap[o.id] || 0 })),
    totalVotes
  };

  // Broadcast to all clients
  sse.broadcast('poll-vote', { pollId, ...pollData });

  res.json({
    ...pollData,
    userVote: optionId
  });
});

// --- Session Notes Auto-Save ---

router.post('/:id/notes', requireLogin, (req, res) => {
  const { content } = req.body;
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const noteType = isDM ? 'dm' : 'player';

  db.prepare(`
    INSERT INTO session_notes (session_id, user_id, content, note_type, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, user_id, note_type)
    DO UPDATE SET content = excluded.content, updated_at = datetime('now')
  `).run(session.id, req.user.id, content || '', noteType);

  res.json({ success: true, updatedAt: new Date().toISOString() });
});

// --- Session Attendance ---

router.post('/:id/attendance', requireLogin, requireDM, (req, res) => {
  const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
  if (!session) {
    req.flash('error', 'Session not found.');
    return res.redirect('/');
  }

  const attendees = req.body.attendees || [];
  const attendeeIds = Array.isArray(attendees) ? attendees.map(id => parseInt(id, 10)) : [parseInt(attendees, 10)];

  // Get all non-DM/admin players
  const allPlayers = db.prepare("SELECT id FROM users WHERE role = 'player'").all();

  const saveAttendance = db.transaction(() => {
    db.prepare('DELETE FROM session_attendance WHERE session_id = ?').run(session.id);
    for (const player of allPlayers) {
      const attended = attendeeIds.includes(player.id) ? 1 : 0;
      db.prepare('INSERT INTO session_attendance (session_id, user_id, attended) VALUES (?, ?, ?)').run(session.id, player.id, attended);
    }
  });

  saveAttendance();
  req.flash('success', 'Attendance saved.');
  res.redirect('/sessions/' + session.id);
});

// --- Session Gallery ---

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const galleryDir = path.join(__dirname, '..', 'data', 'uploads', 'sessions');
if (!fs.existsSync(galleryDir)) fs.mkdirSync(galleryDir, { recursive: true });

const galleryUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, galleryDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'session-' + uniqueSuffix + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

router.post('/:id/gallery', requireLogin, (req, res) => {
  galleryUpload.single('image')(req, res, function(err) {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        req.flash('error', 'Image too large. Maximum size is 5 MB.');
      } else {
        req.flash('error', 'Upload failed: ' + err.message);
      }
      return res.redirect('/sessions/' + req.params.id);
    }

    // Validate deferred CSRF for multipart
    if (req.app.locals.validateCSRF && !req.app.locals.validateCSRF(req, res)) return;

    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) {
      req.flash('error', 'Session not found.');
      return res.redirect('/');
    }

    if (!req.file) {
      req.flash('error', 'No image selected.');
      return res.redirect('/sessions/' + session.id);
    }

    const caption = req.body.caption ? req.body.caption.trim().substring(0, 200) : null;
    db.prepare('INSERT INTO session_images (session_id, user_id, image_path, caption) VALUES (?, ?, ?, ?)').run(
      session.id, req.user.id, req.file.filename, caption
    );

    req.flash('success', 'Image uploaded to gallery.');
    res.redirect('/sessions/' + session.id);
  });
});

router.post('/:id/gallery/:imageId/delete', requireLogin, (req, res) => {
  const image = db.prepare('SELECT * FROM session_images WHERE id = ? AND session_id = ?').get(req.params.imageId, req.params.id);
  if (!image) {
    req.flash('error', 'Image not found.');
    return res.redirect('/sessions/' + req.params.id);
  }

  // Only the uploader, DM, or admin can delete
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  if (image.user_id !== req.user.id && !isDM) {
    req.flash('error', 'You can only delete your own images.');
    return res.redirect('/sessions/' + req.params.id);
  }

  // Delete file from disk
  const filePath = path.join(galleryDir, image.image_path);
  try { fs.unlinkSync(filePath); } catch (e) { /* file may already be gone */ }

  db.prepare('DELETE FROM session_images WHERE id = ?').run(image.id);
  req.flash('success', 'Image deleted.');
  res.redirect('/sessions/' + req.params.id);
});

module.exports = router;
