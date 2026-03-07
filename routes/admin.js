const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db/connection');
const { requireLogin, requireAdmin, requireDM } = require('../middleware/auth');
const messenger = require('../helpers/messenger');
const backup = require('../helpers/backup');
const router = express.Router();

// Multer for database restore upload (temp storage)
const uploadTemp = path.join(__dirname, '..', 'data', 'temp');
if (!fs.existsSync(uploadTemp)) fs.mkdirSync(uploadTemp, { recursive: true });

const restoreUpload = multer({
  dest: uploadTemp,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.db') || file.originalname.endsWith('.sqlite') || file.originalname.endsWith('.sqlite3')) {
      cb(null, true);
    } else {
      cb(new Error('Only .db, .sqlite, and .sqlite3 files are allowed'));
    }
  }
});

const jsonUpload = multer({
  dest: uploadTemp,
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB max for JSON
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only .json files are allowed'));
    }
  }
});

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
    // Delete map tokens placed by this user or for their characters
    safeDelete('DELETE FROM map_tokens WHERE placed_by = ?', targetId);
    safeDelete('DELETE FROM map_tokens WHERE character_id IN (SELECT id FROM characters WHERE user_id = ?)', targetId);
    // Delete map locations created by this user
    safeDelete('DELETE FROM map_locations WHERE created_by = ?', targetId);
    // Delete NPC token assignments for this user
    safeDelete('DELETE FROM npc_token_assignments WHERE user_id = ?', targetId);
    // Delete NPC token conditions + map placements for maps by this user
    safeDelete('DELETE FROM npc_token_conditions WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE map_id IN (SELECT id FROM maps WHERE created_by = ?))', targetId);
    safeDelete('DELETE FROM map_npc_tokens WHERE map_id IN (SELECT id FROM maps WHERE created_by = ?)', targetId);
    safeDelete('DELETE FROM map_npc_tokens WHERE placed_by = ?', targetId);
    // Delete NPC tokens created by this user
    safeDelete('DELETE FROM npc_token_conditions WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE npc_token_id IN (SELECT id FROM npc_tokens WHERE created_by = ?))', targetId);
    safeDelete('DELETE FROM map_npc_tokens WHERE npc_token_id IN (SELECT id FROM npc_tokens WHERE created_by = ?)', targetId);
    safeDelete('DELETE FROM npc_tokens WHERE created_by = ?', targetId);
    safeDelete('DELETE FROM npc_categories WHERE created_by = ?', targetId);
    // Delete maps created by this user (handle children first)
    safeDelete('DELETE FROM map_tokens WHERE map_id IN (SELECT id FROM maps WHERE created_by = ?)', targetId);
    safeDelete('UPDATE maps SET parent_id = NULL WHERE parent_id IN (SELECT id FROM maps WHERE created_by = ?)', targetId);
    safeDelete('UPDATE maps SET hidden_by = NULL WHERE hidden_by = ?', targetId);
    safeDelete('DELETE FROM maps WHERE created_by = ?', targetId);
    // Delete session notes, images, and attendance for this user
    safeDelete('DELETE FROM session_notes WHERE user_id = ?', targetId);
    safeDelete('DELETE FROM session_images WHERE user_id = ?', targetId);
    safeDelete('DELETE FROM session_attendance WHERE user_id = ?', targetId);
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
      safeDelete('DELETE FROM session_notes WHERE session_id = ?', sid);
      safeDelete('DELETE FROM session_images WHERE session_id = ?', sid);
      safeDelete('DELETE FROM session_attendance WHERE session_id = ?', sid);
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
    // Delete announcements created by this user
    safeDelete('DELETE FROM announcements WHERE created_by = ?', targetId);
    // Delete post reactions by this user
    safeDelete('DELETE FROM post_reactions WHERE user_id = ?', targetId);
    // Delete reply reactions by this user
    safeDelete('DELETE FROM reply_reactions WHERE user_id = ?', targetId);
    // Delete the user
    db.prepare('DELETE FROM users WHERE id = ?').run(targetId);
  });

  try {
    deleteUser();
    req.flash('success', 'User and all related data deleted.');
  } catch (err) {
    console.error('[Delete User] Full Error:', err);
    console.error('[Delete User] Stack:', err.stack);
    // Try to get more details about which table is causing the issue
    if (err.message.includes('FOREIGN KEY')) {
      req.flash('error', 'Cannot delete user: some data still references this user. Check server logs for details.');
    } else {
      req.flash('error', 'Failed to delete user: ' + err.message);
    }
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

// --- Database Backup & Restore ---

// Download database backup
router.get('/backup/download', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { backupName, backupPath } = await backup.createLocalBackupSync();
    res.download(backupPath, backupName, (err) => {
      if (err) console.error('[Backup] Download error:', err.message);
      // Clean up the temp backup after download
      try { fs.unlinkSync(backupPath); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    console.error('[Backup] Download failed:', err.message);
    req.flash('error', 'Failed to create backup: ' + err.message);
    res.redirect('/admin/users');
  }
});

// Restore database from upload
router.post('/backup/restore', requireLogin, requireAdmin, restoreUpload.single('database'), (req, res) => {
  // Validate CSRF for multipart form
  if (req._csrfDeferred) {
    const token = req.body._csrf;
    const sessionToken = req.session?.csrfToken;
    if (!token || token !== sessionToken) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      req.flash('error', 'Invalid CSRF token');
      return res.redirect('/admin/users');
    }
  }

  if (!req.file) {
    req.flash('error', 'No file uploaded.');
    return res.redirect('/admin/users');
  }

  const uploadedPath = req.file.path;

  try {
    // Validate the uploaded file is a valid SQLite database
    const Database = require('better-sqlite3');
    const testDb = new Database(uploadedPath, { readonly: true });
    // Quick sanity check — try reading the users table
    try {
      testDb.prepare('SELECT COUNT(*) as count FROM users').get();
    } catch (e) {
      testDb.close();
      fs.unlinkSync(uploadedPath);
      req.flash('error', 'Invalid database file: missing users table.');
      return res.redirect('/admin/users');
    }
    testDb.close();

    // Create a safety backup of the current database before restoring
    const safetyBackupName = `pre-restore-${Date.now()}.db`;
    const safetyBackupPath = path.join(backup.backupDir, safetyBackupName);
    fs.copyFileSync(backup.dbPath, safetyBackupPath);
    console.log(`[Backup] Safety backup created: ${safetyBackupName}`);

    // Close the current database connection and replace the file
    // We need to restart the app after restore for changes to take effect
    fs.copyFileSync(uploadedPath, backup.dbPath);
    fs.unlinkSync(uploadedPath);

    console.log('[Backup] Database restored from uploaded file. Restart required.');
    req.flash('success', 'Database restored successfully! The server will restart to apply changes.');
    res.redirect('/admin/users');

    // Schedule a graceful restart after response is sent
    setTimeout(() => {
      console.log('[Backup] Restarting server after database restore...');
      process.exit(0); // Docker/PM2 will auto-restart
    }, 1500);
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch (e) { /* ignore */ }
    console.error('[Backup] Restore failed:', err.message);
    req.flash('error', 'Failed to restore database: ' + err.message);
    res.redirect('/admin/users');
  }
});

// List local backups
router.get('/backup/list', requireLogin, requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(backup.backupDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(backup.backupDir)
      .filter(f => f.startsWith('dndplanning-') && f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(backup.backupDir, f));
        return {
          name: f,
          size: (stat.size / (1024 * 1024)).toFixed(2) + ' MB',
          date: stat.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(files);
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Download a specific local backup
router.get('/backup/download/:name', requireLogin, requireAdmin, (req, res) => {
  const name = req.params.name;
  // Sanitize filename to prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(backup.backupDir, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  res.download(filePath, name);
});

// Trigger manual backup now
router.post('/backup/now', requireLogin, requireAdmin, async (req, res) => {
  try {
    await backup.runScheduledBackup();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// --- Google Drive Backup Config ---

router.get('/backup/gdrive/config', requireLogin, requireAdmin, (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    if (!config) return res.json({});

    res.json({
      gdrive_enabled: config.gdrive_enabled ? true : false,
      gdrive_folder_id: config.gdrive_folder_id || '',
      gdrive_schedule: config.gdrive_schedule || 'daily',
      gdrive_last_backup: config.gdrive_last_backup || null,
      gdrive_last_status: config.gdrive_last_status || null,
      gdrive_has_credentials: !!config.gdrive_service_account,
      local_keep_days: config.local_keep_days || 7
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/backup/gdrive', requireLogin, requireAdmin, (req, res) => {
  const { gdrive_enabled, gdrive_folder_id, gdrive_schedule, local_keep_days } = req.body;

  db.prepare(`
    UPDATE backup_config SET
      gdrive_enabled = ?,
      gdrive_folder_id = ?,
      gdrive_schedule = ?,
      local_keep_days = ?
    WHERE id = 1
  `).run(
    gdrive_enabled ? 1 : 0,
    gdrive_folder_id || null,
    gdrive_schedule || 'daily',
    parseInt(local_keep_days) || 7
  );

  req.flash('success', 'Backup settings saved.');
  res.redirect('/admin/users');
});

// Upload Google Drive service account JSON
router.post('/backup/gdrive/credentials', requireLogin, requireAdmin, jsonUpload.single('service_account'), (req, res) => {
  // Validate CSRF for multipart form
  if (req._csrfDeferred) {
    const token = req.body._csrf;
    const sessionToken = req.session?.csrfToken;
    if (!token || token !== sessionToken) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      req.flash('error', 'Invalid CSRF token');
      return res.redirect('/admin/users');
    }
  }

  if (!req.file) {
    req.flash('error', 'No file uploaded.');
    return res.redirect('/admin/users');
  }

  try {
    const content = fs.readFileSync(req.file.path, 'utf-8');
    const parsed = JSON.parse(content);

    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Invalid service account JSON: missing client_email or private_key');
    }

    db.prepare('UPDATE backup_config SET gdrive_service_account = ? WHERE id = 1').run(content);
    fs.unlinkSync(req.file.path);

    req.flash('success', `Google Drive credentials saved. Service account: ${parsed.client_email}`);
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    req.flash('error', 'Invalid service account file: ' + err.message);
  }

  res.redirect('/admin/users');
});

// Test Google Drive connection
router.post('/backup/gdrive/test', requireLogin, requireAdmin, async (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    if (!config || !config.gdrive_service_account) {
      return res.json({ success: false, error: 'No service account credentials configured.' });
    }

    const result = await backup.testGoogleDriveConnection(config.gdrive_service_account, config.gdrive_folder_id);
    res.json({ success: true, email: result.email });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Remove Google Drive credentials
router.post('/backup/gdrive/remove-credentials', requireLogin, requireAdmin, (req, res) => {
  db.prepare("UPDATE backup_config SET gdrive_service_account = NULL, gdrive_enabled = 0 WHERE id = 1").run();
  req.flash('success', 'Google Drive credentials removed.');
  res.redirect('/admin/users');
});

module.exports = router;
