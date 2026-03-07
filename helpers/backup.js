/**
 * Database Backup Helper
 * Handles local backup creation and Google Drive uploads via OAuth2.
 */
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const dataDir = path.join(__dirname, '..', 'data');
const backupDir = path.join(dataDir, 'backups');
const dbPath = path.join(dataDir, 'dndplanning.db');

// Ensure backup directory exists
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

/**
 * Create a local backup using SQLite backup API
 */
async function createLocalBackupSync() {
  const Database = require('better-sqlite3');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const backupName = `dndplanning-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupName);

  const source = new Database(dbPath, { readonly: true });
  await source.backup(backupPath);
  source.close();
  console.log(`[Backup] Local backup created: ${backupName}`);
  return { backupName, backupPath };
}

/**
 * Clean up old local backups beyond retention period
 */
function cleanOldBackups(keepDays = 7) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(backupDir).filter(f => f.startsWith('dndplanning-') && f.endsWith('.db'));

  let deleted = 0;
  for (const file of files) {
    const filePath = path.join(backupDir, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }
  if (deleted > 0) {
    console.log(`[Backup] Cleaned ${deleted} old backup(s)`);
  }
}

/**
 * Build OAuth2 client from stored credentials
 */
function getOAuth2Client(config) {
  if (!config.gdrive_client_id || !config.gdrive_client_secret) {
    throw new Error('Google Drive OAuth credentials not configured.');
  }
  if (!config.gdrive_refresh_token) {
    throw new Error('Google Drive not authorized. Click "Authorize Google Drive" in Guild Settings.');
  }

  const oauth2Client = new google.auth.OAuth2(
    config.gdrive_client_id,
    config.gdrive_client_secret,
    config.gdrive_redirect_uri || 'http://localhost:3000/admin/backup/gdrive/callback'
  );

  oauth2Client.setCredentials({
    refresh_token: config.gdrive_refresh_token
  });

  return oauth2Client;
}

/**
 * Generate Google OAuth2 authorization URL
 */
function getAuthUrl(clientId, clientSecret, redirectUri) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file']
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(clientId, clientSecret, redirectUri, code) {
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Upload a backup file to Google Drive via OAuth2
 */
async function uploadToGoogleDrive(filePath, fileName, config) {
  const auth = getOAuth2Client(config);
  const drive = google.drive({ version: 'v3', auth });

  const folderId = config.gdrive_folder_id ? config.gdrive_folder_id.trim() : null;

  const fileMetadata = {
    name: fileName,
    parents: folderId ? [folderId] : undefined
  };

  const media = {
    mimeType: 'application/x-sqlite3',
    body: fs.createReadStream(filePath)
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, webViewLink'
  });

  console.log(`[Backup] Uploaded to Google Drive: ${response.data.name} (${response.data.id})`);

  // Clean old Drive backups (keep last 7)
  if (folderId) {
    await cleanOldDriveBackups(drive, folderId, 7);
  }

  return response.data;
}

/**
 * Clean old backups from Google Drive folder (keep N most recent)
 */
async function cleanOldDriveBackups(drive, folderId, keepCount) {
  try {
    const list = await drive.files.list({
      q: `'${folderId}' in parents and name contains 'dndplanning-' and trashed = false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 100
    });

    const files = list.data.files || [];
    if (files.length > keepCount) {
      const toDelete = files.slice(keepCount);
      for (const file of toDelete) {
        await drive.files.delete({ fileId: file.id });
        console.log(`[Backup] Deleted old Drive backup: ${file.name}`);
      }
    }
  } catch (err) {
    console.error('[Backup] Failed to clean old Drive backups:', err.message);
  }
}

/**
 * Run the full backup pipeline (local + optional Google Drive)
 */
async function runScheduledBackup() {
  const db = require('../db/connection');

  try {
    const config = db.prepare('SELECT * FROM backup_config WHERE id = 1').get();
    if (!config) return;

    // Create local backup
    const { backupName, backupPath } = await createLocalBackupSync();

    // Clean old local backups
    cleanOldBackups(config.local_keep_days || 7);

    // Upload to Google Drive if enabled
    if (config.gdrive_enabled && config.gdrive_refresh_token) {
      try {
        // Get OAuth credentials from google_oauth_config
        const oauth = db.prepare('SELECT * FROM google_oauth_config WHERE id = 1').get();
        if (!oauth || !oauth.client_id || !oauth.client_secret) {
          throw new Error('Google Login not configured. Set up Google Login in Guild Settings first.');
        }
        const fullConfig = { ...config, gdrive_client_id: oauth.client_id, gdrive_client_secret: oauth.client_secret };
        await uploadToGoogleDrive(backupPath, backupName, fullConfig);
        db.prepare("UPDATE backup_config SET gdrive_last_backup = datetime('now'), gdrive_last_status = 'success' WHERE id = 1").run();
        console.log('[Backup] Google Drive backup completed successfully');
      } catch (err) {
        const errorMsg = err.message.substring(0, 200);
        db.prepare("UPDATE backup_config SET gdrive_last_backup = datetime('now'), gdrive_last_status = ? WHERE id = 1").run('error: ' + errorMsg);
        console.error('[Backup] Google Drive upload failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[Backup] Scheduled backup failed:', err.message);
  }
}

/**
 * Test Google Drive connection via OAuth2
 */
async function testGoogleDriveConnection(config) {
  const auth = getOAuth2Client(config);
  const drive = google.drive({ version: 'v3', auth });

  // Get user info
  const about = await drive.about.get({ fields: 'user' });
  const email = about.data.user.emailAddress;

  // If folder ID set, verify access
  if (config.gdrive_folder_id) {
    await drive.files.get({
      fileId: config.gdrive_folder_id.trim(),
      fields: 'id, name'
    });
  }

  return { success: true, email };
}

module.exports = {
  createLocalBackupSync,
  cleanOldBackups,
  uploadToGoogleDrive,
  runScheduledBackup,
  testGoogleDriveConnection,
  getAuthUrl,
  exchangeCode,
  backupDir,
  dbPath
};
