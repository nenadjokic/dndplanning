const db = require('../db/connection');

function attachUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = user;
      res.locals.user = user;
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
  if (!req.user || req.user.role !== 'dm') {
    req.flash('error', 'Only the Dungeon Master may access that page.');
    return res.redirect('/');
  }
  next();
}

module.exports = { attachUser, requireLogin, requireDM };
