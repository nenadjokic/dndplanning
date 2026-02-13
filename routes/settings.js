const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const { isGoogleEnabled } = require('../helpers/google');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  // Re-read user to get latest data (e.g. after token generation)
  const freshUser = db.prepare('SELECT id, username, role, avatar, time_format, calendar_token, theme, week_start, google_id, google_email FROM users WHERE id = ?').get(req.user.id);
  const unavailabilities = db.prepare(
    'SELECT * FROM unavailability WHERE user_id = ? ORDER BY date'
  ).all(req.user.id);

  let calendarUrl = null;
  if (freshUser.calendar_token) {
    calendarUrl = `${req.protocol}://${req.get('host')}/calendar/${freshUser.calendar_token}/feed.ics`;
  }

  const publicCalendarUrl = `${req.protocol}://${req.get('host')}/calendar/sessions/feed.ics`;

  // Load notification preferences
  const NOTIF_TYPES = ['session_confirmed', 'session_cancelled', 'mention'];
  const notifPrefs = {};
  for (const t of NOTIF_TYPES) {
    const row = db.prepare('SELECT enabled FROM user_notification_prefs WHERE user_id = ? AND notif_type = ?').get(req.user.id, t);
    notifPrefs[t] = row ? row.enabled === 1 : true; // default: enabled
  }

  res.render('settings', { unavailabilities, calendarUrl, publicCalendarUrl, settingsUser: freshUser, notifPrefs, googleEnabled: isGoogleEnabled() });
});

// Unified settings endpoint for auto-save (Phase 2.3)
router.post('/', requireLogin, (req, res) => {
  const { theme, time_format, week_start } = req.body;
  const updates = [];
  const values = [];

  // Validate and add theme if provided
  if (theme) {
    if (!['dark', 'light', 'auto'].includes(theme)) {
      return res.json({ success: false, message: 'Invalid theme' });
    }
    updates.push('theme = ?');
    values.push(theme);
  }

  // Validate and add time_format if provided
  if (time_format) {
    if (!['12h', '24h'].includes(time_format)) {
      return res.json({ success: false, message: 'Invalid time format' });
    }
    updates.push('time_format = ?');
    values.push(time_format);
  }

  // Validate and add week_start if provided
  if (week_start) {
    if (!['monday', 'sunday'].includes(week_start)) {
      return res.json({ success: false, message: 'Invalid week start' });
    }
    updates.push('week_start = ?');
    values.push(week_start);
  }

  // Update database if there are changes
  if (updates.length > 0) {
    values.push(req.user.id);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);
  }

  res.json({ success: true });
});

router.post('/time-format', requireLogin, (req, res) => {
  const { time_format } = req.body;
  if (!['12h', '24h'].includes(time_format)) {
    req.flash('error', 'Invalid time format.');
    return res.redirect('/settings');
  }
  db.prepare('UPDATE users SET time_format = ? WHERE id = ?').run(time_format, req.user.id);
  req.flash('success', 'Time format updated.');
  res.redirect('/settings');
});

router.post('/week-start', requireLogin, (req, res) => {
  res.redirect('/settings');
});

router.post('/theme', requireLogin, (req, res) => {
  const { theme } = req.body;
  if (!['dark', 'light', 'auto'].includes(theme)) {
    req.flash('error', 'Invalid theme.');
    return res.redirect('/settings');
  }
  db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, req.user.id);
  req.flash('success', 'Theme updated.');
  res.redirect('/settings');
});

router.post('/password', requireLogin, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;

  if (!current_password || !new_password) {
    req.flash('error', 'All password fields are required.');
    return res.redirect('/settings');
  }

  if (new_password !== confirm_password) {
    req.flash('error', 'New passwords do not match.');
    return res.redirect('/settings');
  }

  if (new_password.length < 4) {
    req.flash('error', 'Password must be at least 4 characters.');
    return res.redirect('/settings');
  }

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password)) {
    req.flash('error', 'Current password is incorrect.');
    return res.redirect('/settings');
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/settings');
});

router.post('/avatar', requireLogin, (req, res) => {
  res.redirect('/profile');
});

router.post('/generate-calendar-token', requireLogin, (req, res) => {
  const token = crypto.randomUUID();
  db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, req.user.id);
  req.flash('success', 'Calendar feed URL generated.');
  res.redirect('/settings');
});

router.post('/unavailability', requireLogin, (req, res) => {
  const { date, reason } = req.body;
  if (!date) {
    req.flash('error', 'Date is required.');
    return res.redirect('/settings');
  }
  db.prepare('INSERT INTO unavailability (user_id, date, reason) VALUES (?, ?, ?)').run(
    req.user.id, date, reason || null
  );
  req.flash('success', 'Unavailability day added.');
  res.redirect('/settings');
});

router.post('/unavailability/:id/delete', requireLogin, (req, res) => {
  db.prepare('DELETE FROM unavailability WHERE id = ? AND user_id = ?').run(
    req.params.id, req.user.id
  );
  req.flash('success', 'Unavailability day removed.');
  res.redirect('/settings');
});

// --- Notification Preferences ---
router.post('/notifications', requireLogin, (req, res) => {
  const NOTIF_TYPES = ['session_confirmed', 'session_cancelled', 'mention'];
  for (const t of NOTIF_TYPES) {
    const enabled = req.body[`notif_${t}`] ? 1 : 0;
    db.prepare(`
      INSERT INTO user_notification_prefs (user_id, notif_type, enabled) VALUES (?, ?, ?)
      ON CONFLICT(user_id, notif_type) DO UPDATE SET enabled = excluded.enabled
    `).run(req.user.id, t, enabled);
  }
  req.flash('success', 'Notification preferences updated.');
  res.redirect('/settings');
});

// --- Google Account Link/Unlink ---
router.get('/google/link', requireLogin, (req, res) => {
  if (!isGoogleEnabled()) {
    req.flash('error', 'Google sign-in is not configured.');
    return res.redirect('/settings');
  }
  // Store intent in session, then redirect to the normal Google OAuth flow
  req.session.linkGoogleUserId = req.user.id;
  res.redirect('/auth/google');
});

router.post('/google/unlink', requireLogin, (req, res) => {
  db.prepare('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?').run(req.user.id);
  req.flash('success', 'Google account unlinked.');
  res.redirect('/settings');
});

module.exports = router;
