const db = require('../db/connection');

function getGoogleConfig() {
  return db.prepare('SELECT * FROM google_oauth_config WHERE id = 1').get();
}

function isGoogleEnabled() {
  const cfg = getGoogleConfig();
  return !!(cfg && cfg.enabled && cfg.client_id && cfg.client_secret);
}

module.exports = { getGoogleConfig, isGoogleEnabled };
