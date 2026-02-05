const express = require('express');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const db = require('../db/connection');
const { getGoogleConfig, isGoogleEnabled } = require('../helpers/google');
const router = express.Router();

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('auth/login', { googleEnabled: isGoogleEnabled() });
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

// Username validation helper
function isValidUsername(username) {
  const usernameRegex = /^[a-zA-Z0-9._-]+$/;
  return username && username.length >= 3 && username.length <= 20 && usernameRegex.test(username);
}

function sanitizeUsername(username) {
  // Remove invalid characters, keep alphanumeric, dots, underscores, dashes
  let sanitized = username.replace(/[^a-zA-Z0-9._-]/g, '');
  // Ensure length constraints
  if (sanitized.length < 3) sanitized = sanitized.padEnd(3, '0');
  if (sanitized.length > 20) sanitized = sanitized.substring(0, 20);
  return sanitized;
}

router.post('/register', async (req, res) => {
  const { username, password, confirm_password } = req.body;

  if (!username || !password) {
    req.flash('error', 'Username and password are required.');
    return res.redirect('/register');
  }

  if (!isValidUsername(username)) {
    req.flash('error', 'Username must be 3-20 characters and contain only letters, numbers, dots, underscores, or dashes.');
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
  const role = userCount === 0 ? 'admin' : 'player';

  const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, role);

  req.session.userId = result.lastInsertRowid;
  req.session.firstLogin = true;
  const roleLabel = role === 'admin' ? 'Guild Master' : 'Adventurer';
  req.flash('success', `Welcome, ${username}! You have joined as ${roleLabel}.`);
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --- Google OAuth ---
function getGoogleRedirectUri(req) {
  return `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

router.get('/auth/google', (req, res) => {
  if (!isGoogleEnabled()) return res.redirect('/login');
  const cfg = getGoogleConfig();
  const redirectUri = getGoogleRedirectUri(req);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account'
  }).toString();
  res.redirect(url);
});

router.get('/auth/google/callback', async (req, res) => {
  if (!isGoogleEnabled()) return res.redirect('/login');
  const cfg = getGoogleConfig();
  const { code } = req.query;
  if (!code) {
    req.flash('error', 'Google sign-in was cancelled.');
    return res.redirect('/login');
  }

  try {
    const redirectUri = getGoogleRedirectUri(req);
    // Exchange code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });
    const { access_token } = tokenRes.data;

    // Get user info
    const userInfoRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const { id: googleId, email: googleEmail, name: googleName } = userInfoRes.data;

    // Check if a user with this google_id already exists
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    if (user) {
      req.session.userId = user.id;
      req.flash('success', `Welcome back, ${user.username}!`);
      return res.redirect('/');
    }

    // Check if the user is linking from settings (session has linkGoogleUserId)
    if (req.session.linkGoogleUserId) {
      const linkUserId = req.session.linkGoogleUserId;
      delete req.session.linkGoogleUserId;
      db.prepare('UPDATE users SET google_id = ?, google_email = ? WHERE id = ?').run(googleId, googleEmail, linkUserId);
      req.flash('success', 'Google account linked successfully.');
      return res.redirect('/settings');
    }

    // Check if a user with matching email exists (auto-link)
    const emailUser = db.prepare('SELECT * FROM users WHERE google_email = ?').get(googleEmail);
    if (emailUser) {
      db.prepare('UPDATE users SET google_id = ? WHERE id = ?').run(googleId, emailUser.id);
      req.session.userId = emailUser.id;
      req.flash('success', `Welcome back, ${emailUser.username}!`);
      return res.redirect('/');
    }

    // Create new user account
    const rawUsername = googleName || googleEmail.split('@')[0];
    // Sanitize the username to remove invalid characters
    const sanitizedUsername = sanitizeUsername(rawUsername);
    // Ensure unique username
    let finalUsername = sanitizedUsername;
    let suffix = 1;
    while (db.prepare('SELECT id FROM users WHERE username = ?').get(finalUsername)) {
      const baseName = sanitizedUsername.length > 17 ? sanitizedUsername.substring(0, 17) : sanitizedUsername;
      finalUsername = baseName + suffix;
      suffix++;
    }

    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const role = userCount === 0 ? 'admin' : 'player';
    // No password for Google-only accounts — set random hash
    const hash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), 10);
    const result = db.prepare('INSERT INTO users (username, password, role, google_id, google_email) VALUES (?, ?, ?, ?, ?)').run(finalUsername, hash, role, googleId, googleEmail);
    req.session.userId = result.lastInsertRowid;
    req.session.firstLogin = true;
    req.flash('success', `Welcome, ${finalUsername}! You have joined via Google.`);
    res.redirect('/');
  } catch (err) {
    console.error('[Google OAuth] Error:', err.message);
    req.flash('error', 'Google sign-in failed. Please try again.');
    res.redirect('/login');
  }
});

module.exports = router;
