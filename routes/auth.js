const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login');
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    req.flash('error', 'Invalid username or password.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  req.flash('success', `Welcome back, ${user.username}!`);
  res.redirect('/');
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/register');
});

router.post('/register', async (req, res) => {
  const { username, password, confirm_password } = req.body;

  if (!username || !password) {
    req.flash('error', 'Username and password are required.');
    return res.redirect('/register');
  }

  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match.');
    return res.redirect('/register');
  }

  if (password.length < 4) {
    req.flash('error', 'Password must be at least 4 characters.');
    return res.redirect('/register');
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    req.flash('error', 'That username is already taken.');
    return res.redirect('/register');
  }

  const hash = await bcrypt.hash(password, 10);
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const role = userCount === 0 ? 'dm' : 'player';

  const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);

  req.session.userId = result.lastInsertRowid;
  const roleLabel = role === 'dm' ? 'Dungeon Master' : 'Adventurer';
  req.flash('success', `Welcome, ${username}! You have joined as ${roleLabel}.`);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
