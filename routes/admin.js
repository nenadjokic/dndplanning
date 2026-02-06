const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db/connection');
const { requireLogin, requireAdmin, requireDM } = require('../middleware/auth');
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

  // Helper function to safely delete from table (handles missing tables)
  const safeDelete = (query, params) => {
    try {
      db.prepare(query).run(...(Array.isArray(params) ? params : [params]));
    } catch (err) {
      // Table doesn't exist or other error - skip silently
      console.log('[Delete User] Skipped:', query, err.message);
    }
  };

  const deleteUser = db.transaction(() => {
    // Delete dice rolls by this user
    safeDelete('DELETE FROM dice_rolls WHERE user_id = ?', targetId);
    // Delete characters by this user
    safeDelete('DELETE FROM characters WHERE user_id = ?', targetId);
    // Delete push subscriptions by this user
    safeDelete('DELETE FROM push_subscriptions WHERE user_id = ?', targetId);
    // Delete notification preferences by this user
    safeDelete('DELETE FROM user_notification_prefs WHERE user_id = ?', targetId);
    // Delete loot items created by or held by this user
    safeDelete('UPDATE loot_items SET held_by = NULL WHERE held_by = ?', targetId);
    safeDelete('DELETE FROM loot_items WHERE created_by = ?', targetId);
    // Delete DM tools by this user
    safeDelete('DELETE FROM dm_tools WHERE created_by = ?', targetId);
    // Delete map locations created by this user
    safeDelete('DELETE FROM map_locations WHERE created_by = ?', targetId);
    // Delete maps created by this user
    safeDelete('DELETE FROM maps WHERE created_by = ?', targetId);
    // Delete votes by this user
    db.prepare('DELETE FROM votes WHERE user_id = ?').run(targetId);
    // Delete preferences by this user
    db.prepare('DELETE FROM preferences WHERE user_id = ?').run(targetId);
    // Delete unavailability by this user
    db.prepare('DELETE FROM unavailability WHERE user_id = ?').run(targetId);
    // Delete notifications for this user
    safeDelete('DELETE FROM notifications WHERE user_id = ?', targetId);
    // Delete replies by this user
    safeDelete('DELETE FROM replies WHERE user_id = ?', targetId);
    // Delete replies to posts by this user
    safeDelete('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)', targetId);
    // Delete posts by this user
    safeDelete('DELETE FROM posts WHERE user_id = ?', targetId);
    // Delete data related to sessions created by this user
    const sessionIds = db.prepare('SELECT id FROM sessions WHERE created_by = ?').all(targetId).map(s => s.id);
    for (const sid of sessionIds) {
      db.prepare('DELETE FROM votes WHERE slot_id IN (SELECT id FROM slots WHERE session_id = ?)').run(sid);
      db.prepare('DELETE FROM preferences WHERE session_id = ?').run(sid);
      safeDelete('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE session_id = ?)', sid);
      safeDelete('DELETE FROM posts WHERE session_id = ?', sid);
      db.prepare('UPDATE sessions SET confirmed_slot_id = NULL WHERE id = ?').run(sid);
      db.prepare('DELETE FROM slots WHERE session_id = ?').run(sid);
    }
    db.prepare('DELETE FROM sessions WHERE created_by = ?').run(targetId);
    // Delete notification reads by this user
    safeDelete('DELETE FROM notification_reads WHERE user_id = ?', targetId);
    // Delete poll votes by this user
    safeDelete('DELETE FROM poll_votes WHERE user_id = ?', targetId);
    // Delete polls created by this user (and cascade will handle options/votes)
    safeDelete('DELETE FROM polls WHERE created_by = ?', targetId);
    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });

  try {
    deleteUser();
    req.flash('success', 'User and all related data deleted.');
  } catch (err) {
    console.error('[Delete User] Error:', err);
    req.flash('error', 'Failed to delete user: ' + err.message);
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/reset-password', requireLogin, requireAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetId);

  if (!target) {
    req.flash('error', 'User not found.');
    return res.redirect('/admin/users');
  }

  if (target.role === 'admin') {
    req.flash('error', 'Cannot reset an admin password.');
    return res.redirect('/admin/users');
  }

  const tempPassword = crypto.randomBytes(4).toString('hex'); // 8-char hex string
  const hash = await bcrypt.hash(tempPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, targetId);

  req.flash('success', `Password reset for ${target.username}. Temporary password: ${tempPassword}`);
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

// --- D&D Data Management ---

// Get D&D data metadata
router.get('/dnd-data/status', requireLogin, requireAdmin, (req, res) => {
  try {
    const meta = db.prepare('SELECT * FROM dnd_data_meta WHERE id = 1').get();
    res.json(meta || {});
  } catch (e) {
    res.json({ error: 'Could not fetch D&D data status.' });
  }
});

// Trigger D&D data import
router.post('/dnd-data/import', requireLogin, requireAdmin, async (req, res) => {
  try {
    // Import the module functions
    const { importSpells, importClasses, importRaces, importItems } = require('../scripts/import-5etools-data');

    // Run imports
    const spellCount = await importSpells();
    const classCount = await importClasses();
    const raceCount = await importRaces();
    const itemCount = await importItems();

    // Update metadata
    db.prepare(`
      UPDATE dnd_data_meta SET
        last_import_date = datetime('now'),
        import_version = ?,
        spell_count = ?,
        class_count = ?,
        race_count = ?,
        item_count = ?
      WHERE id = 1
    `).run('5etools-mirror-3/master', spellCount, classCount, raceCount, itemCount);

    res.json({
      success: true,
      spellCount,
      classCount,
      raceCount,
      itemCount,
      message: `Successfully imported ${spellCount} spells, ${classCount} classes, ${raceCount} races, and ${itemCount} items.`
    });
  } catch (e) {
    console.error('[D&D Data Import] Error:', e);
    res.json({ success: false, error: e.message || 'Import failed.' });
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

// --- Google OAuth Config ---

router.get('/google-oauth/config', requireLogin, requireAdmin, (req, res) => {
  const config = db.prepare('SELECT * FROM google_oauth_config WHERE id = 1').get();
  if (!config) return res.json({});

  const mask = (val) => val ? val.slice(0, 6) + '****' + val.slice(-4) : '';
  res.json({
    enabled: config.enabled ? true : false,
    client_id: mask(config.client_id),
    client_secret: mask(config.client_secret)
  });
});

router.post('/google-oauth', requireLogin, requireAdmin, (req, res) => {
  const { google_enabled, google_client_id, google_client_secret } = req.body;
  const enabled = google_enabled ? 1 : 0;

  const current = db.prepare('SELECT * FROM google_oauth_config WHERE id = 1').get();
  const isMasked = (val) => val && val.includes('****');

  const clientId = isMasked(google_client_id) ? current.client_id : (google_client_id || null);
  const clientSecret = isMasked(google_client_secret) ? current.client_secret : (google_client_secret || null);

  db.prepare('UPDATE google_oauth_config SET enabled = ?, client_id = ?, client_secret = ? WHERE id = 1')
    .run(enabled, clientId, clientSecret);

  req.flash('success', 'Google Login settings saved.');
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

// --- Announcements ---

router.get('/announcements', requireLogin, requireDM, (req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.username as created_by_name
    FROM announcements a
    JOIN users u ON a.created_by = u.id
    ORDER BY a.created_at DESC
  `).all();
  res.render('admin/announcements', { announcements });
});

router.post('/announcements', requireLogin, requireDM, (req, res) => {
  const { content, expires_at } = req.body;

  if (!content || !content.trim()) {
    req.flash('error', 'Announcement content is required.');
    return res.redirect('/admin/announcements');
  }

  // Deactivate all other announcements
  db.prepare('UPDATE announcements SET active = 0').run();

  db.prepare('INSERT INTO announcements (content, created_by, expires_at) VALUES (?, ?, ?)').run(
    content.trim(),
    req.user.id,
    expires_at || null
  );

  req.flash('success', 'Announcement posted.');
  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/toggle', requireLogin, requireDM, (req, res) => {
  const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!announcement) {
    req.flash('error', 'Announcement not found.');
    return res.redirect('/admin/announcements');
  }

  if (announcement.active) {
    db.prepare('UPDATE announcements SET active = 0 WHERE id = ?').run(announcement.id);
    req.flash('success', 'Announcement deactivated.');
  } else {
    // Deactivate all others, activate this one
    db.prepare('UPDATE announcements SET active = 0').run();
    db.prepare('UPDATE announcements SET active = 1 WHERE id = ?').run(announcement.id);
    req.flash('success', 'Announcement activated.');
  }

  res.redirect('/admin/announcements');
});

router.post('/announcements/:id/delete', requireLogin, requireDM, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  req.flash('success', 'Announcement deleted.');
  res.redirect('/admin/announcements');
});

module.exports = router;
