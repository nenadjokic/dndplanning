const fs = require('fs');
const path = require('path');

const lockFile = path.join(__dirname, '..', 'data', 'installed.lock');

function isInstalled() {
  return fs.existsSync(lockFile);
}

function requireInstalled(req, res, next) {
  if (!isInstalled() && !req.path.startsWith('/install')) {
    return res.redirect('/install');
  }
  next();
}

module.exports = { isInstalled, requireInstalled };
