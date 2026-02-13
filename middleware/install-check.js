const fs = require('fs');
const path = require('path');

const lockFile = path.join(__dirname, '..', 'data', 'installed.lock');
const dbPath = path.join(__dirname, '..', 'data', 'dndplanning.db');

function isInstalled() {
  // Check if lock file exists
  if (fs.existsSync(lockFile)) {
    return true;
  }

  // CRITICAL: If lock file is missing but database exists with users,
  // automatically recreate the lock file to prevent installer from showing
  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const result = db.prepare('SELECT COUNT(*) as count FROM users').get();
      db.close();

      // Database has users = app is installed!
      if (result && result.count > 0) {
        console.log('⚠️  Lock file missing but database exists with users. App is installed.');

        // Try to recreate lock file (but don't fail if we can't)
        try {
          const dataDir = path.join(__dirname, '..', 'data');
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          fs.writeFileSync(lockFile, new Date().toISOString());
          console.log('✅ Lock file recreated successfully');
        } catch (err) {
          // Permission denied - this is OK! App can still run without lock file
          console.warn('⚠️  Could not recreate lock file (permission denied). This is OK - continuing anyway.');
          console.warn('   If using Docker, run: sudo chmod -R 777 $(docker volume inspect <volume-name> -f \'{{.Mountpoint}}\')');
        }

        return true; // App is installed (even if we couldn't create lock file)
      }
    } catch (err) {
      console.error('Error checking database:', err.message);
      // If we can't check the database, fall back to lock file check
      return false;
    }
  }

  return false; // Not installed
}

function requireInstalled(req, res, next) {
  if (!isInstalled() && !req.path.startsWith('/install')) {
    return res.redirect('/install');
  }
  next();
}

module.exports = { isInstalled, requireInstalled };
