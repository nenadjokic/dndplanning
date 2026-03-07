/**
 * Database Backup Helper
 * Handles local backup creation and Google Drive uploads.
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
 * Create a local backup of the database using SQLite backup API
 */
function createLocalBackup() {
  const Database = require('better-sqlite3');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const backupName = `dndplanning-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupName);

  const source = new Database(dbPath, { readonly: true });
  source.backup(backupPath).then(() => {
    source.close();
    console.log(`[Backup] Local backup created: ${backupName}`);
  }).catch(err => {
    source.close();
    console.error('[Backup] Local backup failed:', err.message);
    throw err;
  });

  return { backupName, backupPath };
}

/**
 * Create a synchronous local backup (for download)
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
 * Upload a backup file to Google Drive
 */
async function uploadToGoogleDrive(filePath, fileName, serviceAccountJson, folderId) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  const drive = google.drive({ version: 'v3', auth });

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
  await cleanOldDriveBackups(drive, folderId, 7);

  return response.data;
}

/**
 * Clean old backups from Google Drive folder (keep N most recent)
 */
async function cleanOldDriveBackups(drive, folderId, keepCount) {
  try {
    const query = folderId
      ? `'${folderId}' in parents and name contains 'dndplanning-' and trashed = false`
      : `name contains 'dndplanning-' and trashed = false`;

    const list = await drive.files.list({
      q: query,
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
    if (config.gdrive_enabled && config.gdrive_service_account) {
      try {
        await uploadToGoogleDrive(backupPath, backupName, config.gdrive_service_account, config.gdrive_folder_id);
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
 * Test Google Drive connection
 */
async function testGoogleDriveConnection(serviceAccountJson, folderId) {
  const credentials = JSON.parse(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  const drive = google.drive({ version: 'v3', auth });

  // Try to list files in the folder to verify access
  const query = folderId
    ? `'${folderId}' in parents and trashed = false`
    : `trashed = false`;

  await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    pageSize: 1
  });

  return { success: true, email: credentials.client_email };
}

module.exports = {
  createLocalBackupSync,
  cleanOldBackups,
  uploadToGoogleDrive,
  runScheduledBackup,
  testGoogleDriveConnection,
  backupDir,
  dbPath
};
