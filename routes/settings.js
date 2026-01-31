const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  // Re-read user to get latest data (e.g. after token generation)
  const freshUser = db.prepare('SELECT id, username, role, avatar, time_format, calendar_token, theme, week_start FROM users WHERE id = ?').get(req.user.id);
  const unavailabilities = db.prepare(
    'SELECT * FROM unavailability WHERE user_id = ? ORDER BY date'
  ).all(req.user.id);

  let calendarUrl = null;
  if (freshUser.calendar_token) {
    calendarUrl = `${req.protocol}://${req.get('host')}/calendar/${freshUser.calendar_token}/feed.ics`;
  }

  const publicCalendarUrl = `${req.protocol}://${req.get('host')}/calendar/sessions/feed.ics`;

  res.render('settings', { unavailabilities, calendarUrl, publicCalendarUrl, settingsUser: freshUser });
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

module.exports = router;
