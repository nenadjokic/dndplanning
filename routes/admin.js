const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const messenger = require('../helpers/messenger');
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

// --- Notification Config ---

router.get('/notifications/config', requireLogin, requireAdmin, (req, res) => {
  const config = db.prepare('SELECT * FROM notification_config WHERE id = 1').get();
  if (!config) return res.json({});

  // Mask tokens for display
  const mask = (val) => val ? val.slice(0, 4) + '****' + val.slice(-4) : '';
  res.json({
    active_provider: config.active_provider,
    discord_bot_token: mask(config.discord_bot_token),
    discord_channel_id: config.discord_channel_id || '',
    telegram_bot_token: mask(config.telegram_bot_token),
    telegram_chat_id: config.telegram_chat_id || '',
    viber_auth_token: mask(config.viber_auth_token),
    viber_admin_id: config.viber_admin_id || '',
    public_url: config.public_url || ''
  });
});

router.post('/notifications', requireLogin, requireAdmin, async (req, res) => {
  const { active_provider, discord_bot_token, discord_channel_id, telegram_bot_token, telegram_chat_id, viber_auth_token, viber_admin_id, public_url } = req.body;

  const validProviders = ['none', 'discord', 'telegram', 'viber'];
  if (!validProviders.includes(active_provider)) {
    req.flash('error', 'Invalid provider.');
    return res.redirect('/admin/users');
  }

  // Get current config to detect provider switch
  const current = db.prepare('SELECT * FROM notification_config WHERE id = 1').get();
  const prevProvider = current ? current.active_provider : 'none';

  // If switching away from Discord, destroy the client
  if (prevProvider === 'discord' && active_provider !== 'discord') {
    messenger.destroy();
  }

  // Only update token fields if they don't look like masked values
  const isMasked = (val) => val && val.includes('****');

  const discordToken = isMasked(discord_bot_token) ? current.discord_bot_token : (discord_bot_token || null);
  const telegramToken = isMasked(telegram_bot_token) ? current.telegram_bot_token : (telegram_bot_token || null);
  const viberToken = isMasked(viber_auth_token) ? current.viber_auth_token : (viber_auth_token || null);

  db.prepare(`
    UPDATE notification_config SET
      active_provider = ?,
      discord_bot_token = ?,
      discord_channel_id = ?,
      telegram_bot_token = ?,
      telegram_chat_id = ?,
      viber_auth_token = ?,
      viber_admin_id = ?,
      public_url = ?
    WHERE id = 1
  `).run(
    active_provider,
    discordToken,
    discord_channel_id || null,
    telegramToken,
    telegram_chat_id || null,
    viberToken,
    viber_admin_id || null,
    public_url || null
  );

  messenger.reload();

  // If Viber selected and public_url set, register webhook
  if (active_provider === 'viber' && public_url) {
    try {
      await messenger.registerViberWebhook(public_url);
    } catch (err) {
      console.error('[Admin] Viber webhook registration failed:', err.message);
    }
  }

  req.flash('success', 'Communications settings saved.');
  res.redirect('/admin/users');
});

router.post('/notifications/test', requireLogin, requireAdmin, async (req, res) => {
  try {
    await messenger.test();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
