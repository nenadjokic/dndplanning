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
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB max for full backups
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.db') || name.endsWith('.sqlite') || name.endsWith('.sqlite3') || name.endsWith('.qpb')) {
      cb(null, true);
    } else {
      cb(new Error('Only .db, .sqlite, .sqlite3, and .qpb files are allowed'));
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
    // Let addon hooks clean up their own data
    const addonManager = req.app.locals.addonManager;
    if (addonManager) addonManager.handleUserDelete(targetId);
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

// Download database-only backup
router.get('/backup/download', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { backupName, backupPath } = await backup.createLocalBackupSync();
    res.download(backupPath, backupName, (err) => {
      if (err) console.error('[Backup] Download error:', err.message);
      try { fs.unlinkSync(backupPath); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    console.error('[Backup] Download failed:', err.message);
    req.flash('error', 'Failed to create backup: ' + err.message);
    res.redirect('/admin/users');
  }
});

// Download full backup (DB + all data files)
router.get('/backup/download-full', requireLogin, requireAdmin, async (req, res) => {
  try {
    const { backupName, backupPath } = await backup.createFullBackup();
    res.download(backupPath, backupName, (err) => {
      if (err) console.error('[Backup] Full download error:', err.message);
      try { fs.unlinkSync(backupPath); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    console.error('[Backup] Full backup failed:', err.message);
    req.flash('error', 'Failed to create full backup: ' + err.message);
    res.redirect('/admin/users');
  }
});

// Restore from upload (.db for database only, .qpb for full archive)
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
  const originalName = (req.file.originalname || '').toLowerCase();
  const isFullBackup = originalName.endsWith('.qpb');

  try {
    // Ensure backup directory exists
    if (!fs.existsSync(backup.backupDir)) {
      fs.mkdirSync(backup.backupDir, { recursive: true });
    }

    // Create a safety backup before restoring (full archive)
    const safetyBackupName = `pre-restore-${Date.now()}.qpb`;
    const safetyBackupPath = path.join(backup.backupDir, safetyBackupName);

    if (isFullBackup) {
      // --- Full archive restore (.qpb) ---
      console.log('[Backup] Restoring from full backup archive...');

      // Extract and validate
      const extractedDir = backup.extractFullBackup(uploadedPath);
      fs.unlinkSync(uploadedPath);

      // Create safety backup (full) before replacing
      try {
        const { execSync } = require('child_process');
        const tarItems = ['dndplanning.db'];
        for (const dir of ['avatars', 'maps', 'uploads', 'thumbnails']) {
          if (fs.existsSync(path.join(backup.dataDir, dir))) tarItems.push(dir);
        }
        execSync(`tar -czf "${safetyBackupPath}" ${tarItems.map(i => `"${i}"`).join(' ')}`, {
          cwd: backup.dataDir, timeout: 120000
        });
        console.log(`[Backup] Safety backup created: ${safetyBackupName}`);
      } catch (safetyErr) {
        console.warn('[Backup] Could not create safety backup:', safetyErr.message);
      }

      // Close DB and restore everything
      try { db.close(); } catch (e) { /* may already be closed */ }
      backup.restoreFromExtracted(extractedDir);
    } else {
      // --- Database-only restore (.db) ---
      console.log('[Backup] Restoring from database file...');

      // Validate the uploaded file
      const Database = require('better-sqlite3');
      const testDb = new Database(uploadedPath, { readonly: true });
      try {
        testDb.prepare('SELECT COUNT(*) as count FROM users').get();
      } catch (e) {
        testDb.close();
        fs.unlinkSync(uploadedPath);
        req.flash('error', 'Invalid database file: missing users table.');
        return res.redirect('/admin/users');
      }
      testDb.close();

      // Safety backup (DB only)
      const dbSafetyPath = path.join(backup.backupDir, `pre-restore-${Date.now()}.db`);
      fs.copyFileSync(backup.dbPath, dbSafetyPath);
      console.log(`[Backup] Safety backup created: ${path.basename(dbSafetyPath)}`);

      // Close DB and replace
      try { db.close(); } catch (e) { /* may already be closed */ }
      fs.copyFileSync(uploadedPath, backup.dbPath);
      fs.unlinkSync(uploadedPath);
      try { fs.unlinkSync(backup.dbPath + '-wal'); } catch (e) { /* ignore */ }
      try { fs.unlinkSync(backup.dbPath + '-shm'); } catch (e) { /* ignore */ }
    }

    const restoreType = isFullBackup ? 'Full backup' : 'Database';
    console.log(`[Backup] ${restoreType} restored. Restarting...`);
    req.flash('success', `${restoreType} restored successfully! The server will restart to apply changes.`);
    res.redirect('/admin/users');

    // Graceful restart: exit with code 0 so Docker/PM2/systemd restarts us.
    // In Docker: PID 1 exits → container restarts via restart policy.
    // Standalone: PM2 or systemd will restart the process.
    // Delay to let the redirect response flush to the browser.
    setTimeout(() => {
      console.log('[Backup] Exiting for restart after restore...');
      process.exit(0);
    }, 1500);
  } catch (err) {
    try { fs.unlinkSync(uploadedPath); } catch (e) { /* ignore */ }
    console.error('[Backup] Restore failed:', err.message);
    req.flash('error', 'Failed to restore: ' + err.message);
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
      .filter(f => (f.startsWith('dndplanning-') || f.startsWith('pre-restore-')) && (f.endsWith('.db') || f.endsWith('.qpb')))
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

// Delete a specific local backup
router.delete('/backup/:name', requireLogin, requireAdmin, (req, res) => {
  const name = req.params.name;
  if (name.includes('..') || name.includes('/') || name.includes('\\') || !(name.startsWith('dndplanning-') || name.startsWith('pre-restore-')) || !(name.endsWith('.db') || name.endsWith('.qpb'))) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(backup.backupDir, name);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Backup not found' });
  }
  try {
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger manual backup now (DB only or full)
router.post('/backup/now', requireLogin, requireAdmin, async (req, res) => {
  try {
    const type = req.body.type || 'db';
    if (type === 'full') {
      const { backupName } = await backup.createFullBackup();
      res.json({ success: true, name: backupName, type: 'full' });
    } else {
      await backup.runScheduledBackup();
      res.json({ success: true, type: 'db' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// --- Google Drive Backup (reuses Google Login OAuth credentials) ---

// Helper: get Google OAuth credentials from google_oauth_config
function getGoogleCredentials() {
  const oauth = db.prepare('SELECT * FROM google_oauth_config WHERE id = 1').get();
  if (!oauth || !oauth.client_id || !oauth.client_secret) return null;
  return { client_id: oauth.client_id, client_secret: oauth.client_secret };
}

router.get('/backup/gdrive/config', requireLogin, requireAdmin, (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    if (!config) return res.json({});

    const googleCreds = getGoogleCredentials();

    res.json({
      gdrive_enabled: config.gdrive_enabled ? true : false,
      gdrive_folder_id: config.gdrive_folder_id || '',
      gdrive_last_backup: config.gdrive_last_backup || null,
      gdrive_last_status: config.gdrive_last_status || null,
      gdrive_authorized: !!config.gdrive_refresh_token,
      google_login_configured: !!googleCreds,
      local_keep_days: config.local_keep_days || 7
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

router.post('/backup/gdrive', requireLogin, requireAdmin, (req, res) => {
  const { gdrive_enabled, gdrive_folder_id, local_keep_days } = req.body;

  db.prepare(`
    UPDATE backup_config SET
      gdrive_enabled = ?,
      gdrive_folder_id = ?,
      local_keep_days = ?
    WHERE id = 1
  `).run(
    gdrive_enabled ? 1 : 0,
    gdrive_folder_id || null,
    parseInt(local_keep_days) || 7
  );

  req.flash('success', 'Backup settings saved.');
  res.redirect('/admin/users');
});

// Start OAuth2 authorization flow (reuses Google Login credentials)
router.get('/backup/gdrive/authorize', requireLogin, requireAdmin, (req, res) => {
  const googleCreds = getGoogleCredentials();
  if (!googleCreds) {
    req.flash('error', 'Configure Google Login first (above on this page), then authorize Google Drive.');
    return res.redirect('/admin/users');
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/admin/backup/gdrive/callback`;
  db.prepare('UPDATE backup_config SET gdrive_redirect_uri = ? WHERE id = 1').run(redirectUri);

  const authUrl = backup.getAuthUrl(googleCreds.client_id, googleCreds.client_secret, redirectUri);
  res.redirect(authUrl);
});

// OAuth2 callback
router.get('/backup/gdrive/callback', requireLogin, requireAdmin, async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    req.flash('error', 'Google authorization denied: ' + error);
    return res.redirect('/admin/users');
  }

  if (!code) {
    req.flash('error', 'No authorization code received.');
    return res.redirect('/admin/users');
  }

  try {
    const googleCreds = getGoogleCredentials();
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    const tokens = await backup.exchangeCode(
      googleCreds.client_id,
      googleCreds.client_secret,
      config.gdrive_redirect_uri,
      code
    );

    db.prepare('UPDATE backup_config SET gdrive_refresh_token = ? WHERE id = 1').run(tokens.refresh_token);
    req.flash('success', 'Google Drive authorized successfully!');
  } catch (err) {
    console.error('[Backup] OAuth callback error:', err.message);
    req.flash('error', 'Authorization failed: ' + err.message);
  }

  res.redirect('/admin/users');
});

// Test Google Drive connection
router.post('/backup/gdrive/test', requireLogin, requireAdmin, async (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    if (!config || !config.gdrive_refresh_token) {
      return res.json({ success: false, error: 'Google Drive not authorized. Click "Authorize Google Drive" first.' });
    }

    const googleCreds = getGoogleCredentials();
    if (!googleCreds) {
      return res.json({ success: false, error: 'Google Login not configured.' });
    }

    const fullConfig = { ...config, gdrive_client_id: googleCreds.client_id, gdrive_client_secret: googleCreds.client_secret };
    const result = await backup.testGoogleDriveConnection(fullConfig);
    res.json({ success: true, email: result.email });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Disconnect Google Drive
router.post('/backup/gdrive/disconnect', requireLogin, requireAdmin, (req, res) => {
  db.prepare("UPDATE backup_config SET gdrive_refresh_token = NULL, gdrive_enabled = 0 WHERE id = 1").run();
  req.flash('success', 'Google Drive disconnected.');
  res.redirect('/admin/users');
});

// --- Addon Management ---

router.get('/addons', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  const addons = addonManager ? addonManager.getAll() : [];
  res.render('admin/addons', { addons });
});

router.post('/addons/save', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  if (!addonManager) {
    req.flash('error', 'Addon manager not available.');
    return res.redirect('/admin/addons');
  }

  let enabledIds = req.body.enabled || req.body['enabled[]'] || [];
  if (typeof enabledIds === 'string') enabledIds = [enabledIds];

  const allAddons = addonManager.getAll();
  let changed = false;
  const errors = [];

  // First pass: handle disables (check dependents)
  for (const addon of allAddons) {
    const shouldBeEnabled = enabledIds.includes(addon.id);
    if (!shouldBeEnabled && addon.enabled) {
      const result = addonManager.disableWithDependencyCheck(addon.id);
      if (result.success) {
        changed = true;
      } else {
        const depNames = result.dependents.map(d => d.name).join(', ');
        errors.push(`Cannot disable ${addon.name}: required by ${depNames}`);
      }
    }
  }

  // Second pass: handle enables (check dependencies)
  for (const addon of allAddons) {
    const shouldBeEnabled = enabledIds.includes(addon.id);
    if (shouldBeEnabled && !addon.enabled) {
      const result = addonManager.enableWithDependencyCheck(addon.id);
      if (result.success) {
        changed = true;
      } else if (result.circular) {
        errors.push(`Cannot enable ${addon.name}: circular dependency detected (${result.circular.join(' -> ')})`);
      } else {
        const missingNames = result.missing.map(d => d.name).join(', ');
        errors.push(`Cannot enable ${addon.name}: requires ${missingNames}`);
      }
    }
  }

  if (changed) {
    addonManager.reload();
  }

  if (errors.length > 0) {
    req.flash('error', errors.join(' | '));
  } else if (changed) {
    req.flash('success', 'Addon settings saved and applied.');
  } else {
    req.flash('success', 'No changes to apply.');
  }
  res.redirect('/admin/addons');
});

// Dependency check API for Browse Store install flow
router.post('/addons/check-dependencies', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  const { addonId, dependencies } = req.body;
  if (!addonId) return res.status(400).json({ error: 'addonId required' });

  // If addon is already discovered, use its manifest
  const addon = addonManager.addons.get(addonId);
  if (addon) {
    const chain = addonManager.resolveDependencyChain(addonId);
    const cycle = addonManager.detectCircularDependencies(addonId);
    return res.json({
      chain,
      circular: cycle.length > 0 ? cycle : null,
      satisfied: chain.length === 0 && cycle.length === 0
    });
  }

  // For not-yet-installed addons, check provided dependencies object
  if (!dependencies || typeof dependencies !== 'object') {
    return res.json({ chain: [], circular: null, satisfied: true });
  }

  const chain = [];
  for (const [depId, constraint] of Object.entries(dependencies)) {
    const depAddon = addonManager.addons.get(depId);
    if (!depAddon) {
      chain.push({ id: depId, constraint, action: 'install', name: depId });
    } else if (!depAddon.enabled) {
      chain.push({
        id: depId, constraint, action: 'enable',
        name: depAddon.name, version: depAddon.version,
        type: depAddon.type
      });
    } else {
      // Check version
      const { satisfiesSemver } = require('../lib/addon-manager');
      // Version already satisfied — skip
    }
  }

  res.json({ chain, circular: null, satisfied: chain.length === 0 });
});

router.post('/addons/:id/uninstall', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  if (!addonManager) {
    req.flash('error', 'Addon manager not available.');
    return res.redirect('/admin/addons');
  }

  try {
    const result = addonManager.uninstallWithDependencyCheck(req.params.id);
    if (!result.success) {
      const depNames = result.dependents.map(d => d.name).join(', ');
      req.flash('error', `Cannot uninstall: required by ${depNames}. Disable or uninstall those addons first.`);
      return res.redirect('/admin/addons');
    }
    addonManager.reload();
    req.flash('success', 'Addon uninstalled.');
  } catch (err) {
    req.flash('error', 'Failed to uninstall: ' + err.message);
  }
  res.redirect('/admin/addons');
});

router.post('/addons/:id/delete-data', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  if (!addonManager) {
    req.flash('error', 'Addon manager not available.');
    return res.redirect('/admin/addons');
  }

  try {
    addonManager.deleteData(req.params.id);
    req.flash('success', 'Addon data deleted.');
  } catch (err) {
    req.flash('error', 'Failed to delete data: ' + err.message);
  }
  res.redirect('/admin/addons');
});

// Upload addon package
const addonUpload = multer({
  dest: uploadTemp,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.qpa') || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .qpa and .zip files are allowed'));
    }
  }
});

router.post('/addons/upload', requireLogin, requireAdmin, addonUpload.single('addon_package'), async (req, res) => {
  // Validate CSRF for multipart form
  if (req._csrfDeferred) {
    const token = req.body._csrf;
    const sessionToken = req.session?.csrfToken;
    if (!token || token !== sessionToken) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
      req.flash('error', 'Invalid CSRF token');
      return res.redirect('/admin/addons');
    }
  }

  if (!req.file) {
    req.flash('error', 'No file uploaded.');
    return res.redirect('/admin/addons');
  }

  const addonManager = req.app.locals.addonManager;
  try {
    const addonId = await addonManager.installFromZip(req.file.path);
    fs.unlinkSync(req.file.path);
    // Re-discover and reload to pick up the new addon
    addonManager.discover();
    addonManager.loadAll();
    addonManager.reload();
    req.flash('success', `Addon "${addonId}" installed and enabled.`);
    res.redirect('/admin/addons');
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    req.flash('error', 'Failed to install addon: ' + err.message);
    res.redirect('/admin/addons');
  }
});

// Install addon from remote URL (Browse Store "Install" button)
// Supports auto-installing dependencies via enableDeps body parameter
router.post('/addons/install-remote', requireLogin, requireAdmin, async (req, res) => {
  const { downloadUrl, addonId: expectedId, enableDeps } = req.body;
  if (!downloadUrl) {
    return res.status(400).json({ error: 'Download URL is required' });
  }

  const addonManager = req.app.locals.addonManager;
  const tempPath = path.join(uploadTemp, `remote-${Date.now()}.qpa`);

  try {
    // Download the .qpa file
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempPath, buffer);

    // Install
    const addonId = await addonManager.installFromZip(tempPath);
    try { fs.unlinkSync(tempPath); } catch (e) {}

    // Re-discover and reload to pick up the new addon
    addonManager.discover();
    addonManager.loadAll();

    // Auto-enable dependency addons if requested
    const autoEnabled = [];
    if (enableDeps && Array.isArray(enableDeps)) {
      for (const depId of enableDeps) {
        const depAddon = addonManager.addons.get(depId);
        if (depAddon && !depAddon.enabled) {
          addonManager.enable(depId);
          autoEnabled.push(depAddon.name);
        }
      }
    }

    addonManager.reload();

    res.json({ success: true, addonId, autoEnabled });
  } catch (err) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

// Uninstall addon via JSON API (for Browse Store)
router.post('/addons/:id/uninstall-json', requireLogin, requireAdmin, (req, res) => {
  const addonManager = req.app.locals.addonManager;
  try {
    const result = addonManager.uninstallWithDependencyCheck(req.params.id);
    if (!result.success) {
      const depNames = result.dependents.map(d => d.name).join(', ');
      return res.status(400).json({ error: `Cannot uninstall: required by ${depNames}. Disable or uninstall those addons first.` });
    }
    addonManager.reload();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch addon registry from GitHub
// Fetch addon registries from official + custom repositories
router.get('/addons/registry', requireLogin, requireAdmin, async (req, res) => {
  const officialUrl = 'https://raw.githubusercontent.com/nenadjokic/questplanner-addons/main/registry.json';
  const addonManager = req.app.locals.addonManager;
  const installed = new Set(addonManager.getAll().map(a => a.id));
  const allAddons = [];
  const errors = [];

  // Helper: resolve GitHub repo URL to raw registry.json
  function resolveRegistryUrl(repoUrl) {
    const cleaned = repoUrl.replace(/\/+$/, '');
    // If already a raw URL, use as-is
    if (cleaned.includes('raw.githubusercontent.com') || cleaned.endsWith('.json')) {
      return cleaned;
    }
    // Convert github.com URL to raw content URL
    const ghMatch = cleaned.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (ghMatch) {
      return `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/main/registry.json`;
    }
    // Fallback: append registry.json
    return cleaned + '/registry.json';
  }

  // Fetch from a single registry URL
  async function fetchRegistry(url, sourceName) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const registry = await response.json();
      const addons = registry.addons || [];
      for (const addon of addons) {
        addon._source = sourceName;
        addon.installed = installed.has(addon.id);
        if (addon.installed) {
          const local = addonManager.getAll().find(a => a.id === addon.id);
          addon.installedVersion = local ? local.version : null;
        }
        // Include dependency resolution info for the client
        if (addon.dependencies && typeof addon.dependencies === 'object' && !Array.isArray(addon.dependencies)) {
          addon._depStatus = {};
          for (const [depId, constraint] of Object.entries(addon.dependencies)) {
            const depAddon = addonManager.addons.get(depId);
            if (!depAddon) {
              addon._depStatus[depId] = { status: 'not_found', constraint, name: depId };
            } else if (!depAddon.enabled) {
              addon._depStatus[depId] = { status: 'disabled', constraint, name: depAddon.name, version: depAddon.version, type: depAddon.type };
            } else {
              addon._depStatus[depId] = { status: 'ok', constraint, name: depAddon.name, version: depAddon.version };
            }
          }
        }
      }
      return addons;
    } catch (err) {
      errors.push({ source: sourceName, error: err.message });
      return [];
    }
  }

  // Fetch official registry
  const officialAddons = await fetchRegistry(officialUrl, 'Official');
  allAddons.push(...officialAddons);

  // Fetch custom repositories
  try {
    const repos = db.prepare('SELECT * FROM addon_repositories ORDER BY name').all();
    const fetches = repos.map(repo =>
      fetchRegistry(resolveRegistryUrl(repo.url), repo.name)
    );
    const results = await Promise.all(fetches);
    for (const addons of results) {
      allAddons.push(...addons);
    }
  } catch (e) { /* addon_repositories table may not exist yet */ }

  // Deduplicate by addon id (first one wins — official takes priority)
  const seen = new Set();
  const unique = [];
  for (const addon of allAddons) {
    if (!seen.has(addon.id)) {
      seen.add(addon.id);
      unique.push(addon);
    }
  }

  res.json({ addons: unique, errors: errors.length > 0 ? errors : undefined });
});

// List custom addon repositories
router.get('/addons/repos', requireLogin, requireAdmin, (req, res) => {
  try {
    const repos = db.prepare('SELECT * FROM addon_repositories ORDER BY name').all();
    res.json(repos);
  } catch (e) {
    res.json([]);
  }
});

// Add a custom addon repository
router.post('/addons/repos', requireLogin, requireAdmin, (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }
  // Basic URL validation
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    return res.status(400).json({ error: 'URL must start with https:// or http://' });
  }
  try {
    db.prepare('INSERT INTO addon_repositories (name, url) VALUES (?, ?)').run(name.trim(), url.trim());
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'This repository URL is already added' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Remove a custom addon repository
router.delete('/addons/repos/:id', requireLogin, requireAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM addon_repositories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
