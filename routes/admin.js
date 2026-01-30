const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/users', requireLogin, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at').all();
  res.render('admin/users', { users });
});

router.post('/users/:id/role', requireLogin, requireAdmin, (req, res) => {
  const { role } = req.body;
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.user.id) {
    req.flash('error', 'You cannot change your own role.');
    return res.redirect('/admin/users');
  }

  if (!['dm', 'player'].includes(role)) {
    req.flash('error', 'Invalid role.');
    return res.redirect('/admin/users');
  }

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
  req.flash('success', `Role updated successfully.`);
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireLogin, requireAdmin, (req, res) => {
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.user.id) {
    req.flash('error', 'You cannot delete yourself.');
    return res.redirect('/admin/users');
  }

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(targetId);
  if (!target) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  if (target.role === 'admin') {
    req.flash('error', 'Cannot delete an admin user.');
    return res.redirect('/admin/users');
  }

  const deleteUser = db.transaction(() => {
    // Delete votes by this user
    db.prepare('DELETE FROM votes WHERE user_id = ?').run(targetId);
    // Delete preferences by this user
    db.prepare('DELETE FROM preferences WHERE user_id = ?').run(targetId);
    // Delete unavailability by this user
    db.prepare('DELETE FROM unavailability WHERE user_id = ?').run(targetId);
    // Delete notifications for this user
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(targetId);
    // Delete replies by this user
    db.prepare('DELETE FROM replies WHERE user_id = ?').run(targetId);
    // Delete replies to posts by this user
    db.prepare('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').run(targetId);
    // Delete posts by this user
    db.prepare('DELETE FROM posts WHERE user_id = ?').run(targetId);
    // Delete data related to sessions created by this user
    const sessionIds = db.prepare('SELECT id FROM sessions WHERE created_by = ?').all(targetId).map(s => s.id);
    for (const sid of sessionIds) {
      db.prepare('DELETE FROM votes WHERE slot_id IN (SELECT id FROM slots WHERE session_id = ?)').run(sid);
      db.prepare('DELETE FROM preferences WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE session_id = ?)').run(sid);
      db.prepare('DELETE FROM posts WHERE session_id = ?').run(sid);
      db.prepare('DELETE FROM slots WHERE session_id = ?').run(sid);
    }
    db.prepare('DELETE FROM sessions WHERE created_by = ?').run(targetId);
    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });

  deleteUser();
  req.flash('success', 'User and all related data deleted.');
  res.redirect('/admin/users');
});

router.get('/check-update', requireLogin, requireAdmin, async (req, res) => {
  try {
    const response = await fetch('https://api.github.com/repos/nenadjokic/dndplanning/releases/latest');
    if (!response.ok) {
      return res.json({ error: 'Could not check for updates.' });
    }
    const release = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, '');
    const currentVersion = require('../package.json').version;

    res.json({
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion !== currentVersion,
      releaseUrl: release.html_url,
      releaseName: release.name,
      releaseBody: release.body
    });
  } catch (e) {
    res.json({ error: 'Could not check for updates.' });
  }
});

module.exports = router;
