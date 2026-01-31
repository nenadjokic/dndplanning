const db = require('../db/connection');
const { formatDate, formatTime } = require('../helpers/time');
const { marked } = require('marked');

function attachUser(req, res, next) {
  res.locals.user = null;
  res.locals.timeFormat = '24h';
  res.locals.formatDate = (iso, opts) => formatDate(iso, '24h', opts);
  res.locals.formatTime = (iso) => formatTime(iso, '24h');
  res.locals.renderMarkdown = (text) => text ? marked(text) : '';

  if (req.session.userId) {
    const user = db.prepare('SELECT id, username, role, avatar, time_format, calendar_token, theme, week_start, last_seen_version FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
      res.locals.timeFormat = user.time_format || '24h';
      res.locals.formatDate = (iso, opts) => formatDate(iso, user.time_format || '24h', opts);
      res.locals.formatTime = (iso) => formatTime(iso, user.time_format || '24h');

      // Load all usernames for @mention autocomplete
      const allUsernames = db.prepare('SELECT username FROM users ORDER BY username').all().map(u => u.username);
      res.locals.allUsernames = allUsernames;
    } else {
      delete req.session.userId;
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) {
    req.flash('error', 'You must be logged in to access that page.');
    return res.redirect('/login');
  }
  next();
}

function requireDM(req, res, next) {
  if (!req.user || (req.user.role !== 'dm' && req.user.role !== 'admin')) {
    req.flash('error', 'Only the Dungeon Master may access that page.');
    return res.redirect('/');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    req.flash('error', 'Only the Guild Master may access that page.');
    return res.redirect('/');
  }
  next();
}

module.exports = { attachUser, requireLogin, requireDM, requireAdmin };
