const db = require('../db/connection');

function isNotifEnabled(userId, notifType) {
  const pref = db.prepare('SELECT enabled FROM user_notification_prefs WHERE user_id = ? AND notif_type = ?').get(userId, notifType);
  // Default: enabled (if no row exists)
  return !pref || pref.enabled === 1;
}

function createNotification(userId, type, message, link) {
  if (!isNotifEnabled(userId, type)) return;
  db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(userId, type, message, link || null);
}

function extractMentions(content) {
  const matches = content.match(/@([\w.]+)/g);
  if (!matches) return [];
  const usernames = [...new Set(matches.map(m => m.slice(1)))];
  if (usernames.length === 0) return [];
  const placeholders = usernames.map(() => '?').join(',');
  return db.prepare(`SELECT id, username FROM users WHERE username IN (${placeholders})`).all(...usernames);
}

function notifyMentions(content, authorId, authorName, link) {
  const mentioned = extractMentions(content);
  for (const u of mentioned) {
    if (u.id !== authorId) {
      createNotification(u.id, 'mention', `${authorName} mentioned you`, link);
    }
  }
}

function notifySessionConfirmed(sessionId, sessionTitle, confirmedByName) {
  const voters = db.prepare(`
    SELECT DISTINCT v.user_id
    FROM votes v
    JOIN slots s ON v.slot_id = s.id
    WHERE s.session_id = ?
  `).all(sessionId);

  const creator = db.prepare('SELECT created_by FROM sessions WHERE id = ?').get(sessionId);

  const notifiedIds = new Set();
  const link = '/sessions/' + sessionId;
  const message = `"${sessionTitle}" has been confirmed by ${confirmedByName}`;

  for (const v of voters) {
    if (!notifiedIds.has(v.user_id)) {
      createNotification(v.user_id, 'session_confirmed', message, link);
      notifiedIds.add(v.user_id);
    }
  }

  if (creator && !notifiedIds.has(creator.created_by)) {
    createNotification(creator.created_by, 'session_confirmed', message, link);
  }
}

module.exports = { createNotification, extractMentions, notifyMentions, notifySessionConfirmed };
