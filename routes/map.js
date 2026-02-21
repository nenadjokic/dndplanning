const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM, requireAdmin } = require('../middleware/auth');
const sse = require('../helpers/sse');
const router = express.Router();

const mapsDir = path.join(__dirname, '..', 'data', 'maps');
try {
  if (!fs.existsSync(mapsDir)) {
    fs.mkdirSync(mapsDir, { recursive: true });
  }
} catch (err) {
  console.warn('⚠️  Could not create maps directory. Map uploads may not work.');
  console.warn('   Fix: sudo chmod -R 777 $(docker volume inspect <volume-name> -f \'{{.Mountpoint}}\')');
}

const MARKER_TYPES = {
  pin:       { label: 'Pin',       icon: '📌' },
  overworld: { label: 'Overworld', icon: '🌍' },
  city:      { label: 'City',      icon: '🏰' },
  location:  { label: 'Location',  icon: '📍' },
  tavern:    { label: 'Tavern',    icon: '🍺' },
  dungeon:   { label: 'Dungeon',   icon: '💀' },
  secret:    { label: 'Secret',    icon: '🔮' }
};

function getMapDepth(mapId) {
  let depth = 0;
  let current = db.prepare('SELECT parent_id FROM maps WHERE id = ?').get(mapId);
  while (current && current.parent_id) {
    depth++;
    current = db.prepare('SELECT parent_id FROM maps WHERE id = ?').get(current.parent_id);
  }
  return depth;
}

function getMapChain(mapId) {
  const chain = [];
  let current = db.prepare('SELECT id, name, map_type, parent_id FROM maps WHERE id = ?').get(mapId);
  while (current) {
    chain.unshift(current);
    current = current.parent_id
      ? db.prepare('SELECT id, name, map_type, parent_id FROM maps WHERE id = ?').get(current.parent_id)
      : null;
  }
  return chain;
}

function buildMapTree(maps) {
  const byId = {};
  const roots = [];
  for (const m of maps) {
    m.children = [];
    byId[m.id] = m;
  }
  for (const m of maps) {
    if (m.parent_id && byId[m.parent_id]) {
      byId[m.parent_id].children.push(m);
    } else {
      roots.push(m);
    }
  }
  return roots;
}

function mapUpload(req, res, next) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, mapsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'map-' + req.params.id + ext);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  }).single('map_image');
  upload(req, res, next);
}

// Maps index — tree view
router.get('/', requireLogin, (req, res) => {
  const maps = db.prepare('SELECT * FROM maps ORDER BY created_at').all();
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const tree = buildMapTree(maps);
  res.render('maps', { maps, tree, isDM, MARKER_TYPES });
});

// Create new top-level map
router.post('/', requireLogin, requireDM, (req, res) => {
  const { name, map_type } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Map name is required.');
    return res.redirect('/map');
  }
  const type = MARKER_TYPES[map_type] ? map_type : 'overworld';
  const result = db.prepare('INSERT INTO maps (name, map_type, created_by) VALUES (?, ?, ?)').run(name.trim(), type, req.user.id);
  const mapId = result.lastInsertRowid;

  sse.broadcast('new-map', {
    username: req.user.username,
    name: name.trim(),
    mapId: mapId
  });

  req.flash('success', 'Map created.');
  res.redirect('/map/' + mapId);
});

// Single map view
router.get('/:id', requireLogin, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const locations = db.prepare('SELECT * FROM map_locations WHERE map_id = ? ORDER BY created_at').all(map.id);
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const chain = getMapChain(map.id);
  const children = db.prepare('SELECT id, name, description, map_type, pin_x, pin_y, image_path FROM maps WHERE parent_id = ?').all(map.id);
  const depth = getMapDepth(map.id);
  const showPartyMarker = !map.parent_id;
  const canAddChild = depth < 2; // max 3 levels (0, 1, 2)

  // Tokens with character + user data
  const tokens = db.prepare(`
    SELECT mt.id, mt.map_id, mt.character_id, mt.x, mt.y, mt.placed_by, mt.scale,
           c.name AS char_name, c.avatar AS char_avatar, c.user_id AS char_owner,
           u.username AS owner_name
    FROM map_tokens mt
    JOIN characters c ON c.id = mt.character_id
    JOIN users u ON u.id = c.user_id
    WHERE mt.map_id = ?
  `).all(map.id);

  // Fetch conditions for all tokens on this map
  const tokenIds = tokens.map(t => t.id);
  let conditions = [];
  if (tokenIds.length > 0) {
    conditions = db.prepare(`
      SELECT tc.id, tc.token_id, tc.condition_name, tc.created_at
      FROM token_conditions tc
      WHERE tc.token_id IN (${tokenIds.map(() => '?').join(',')})
      ORDER BY tc.created_at
    `).all(...tokenIds);
  }
  // Group conditions by token_id
  const conditionsByToken = {};
  for (const c of conditions) {
    if (!conditionsByToken[c.token_id]) conditionsByToken[c.token_id] = [];
    conditionsByToken[c.token_id].push(c);
  }
  // Attach to tokens
  for (const t of tokens) {
    t.conditions = conditionsByToken[t.id] || [];
  }

  res.render('map', { map, locations, isDM, chain, children, tokens, showPartyMarker, canAddChild, MARKER_TYPES, currentUserId: req.user.id });
});

// Upload map image
router.post('/:id/upload', requireLogin, requireDM, mapUpload, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  if (!req.file) {
    req.flash('error', 'Please upload a valid image (JPG, PNG, GIF, WebP, max 30MB).');
    return res.redirect('/map/' + map.id);
  }
  if (map.image_path && map.image_path !== req.file.filename) {
    const oldPath = path.join(mapsDir, map.image_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare('UPDATE maps SET image_path = ? WHERE id = ?').run(req.file.filename, map.id);
  req.flash('success', 'Map image uploaded.');
  res.redirect('/map/' + map.id);
});

// Create child map
router.post('/:id/children', requireLogin, requireDM, express.urlencoded({ extended: false }), (req, res) => {
  const parent = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!parent) {
    req.flash('error', 'Parent map not found.');
    return res.redirect('/map');
  }
  const parentDepth = getMapDepth(parent.id);
  if (parentDepth >= 2) {
    req.flash('error', 'Maximum map depth (3 levels) reached.');
    return res.redirect('/map/' + parent.id);
  }
  const { name, description, map_type, pin_x, pin_y } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Map name is required.');
    return res.redirect('/map/' + parent.id);
  }
  const type = MARKER_TYPES[map_type] ? map_type : 'location';
  const px = Math.max(0, Math.min(100, parseFloat(pin_x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(pin_y) || 50));
  const desc = (description && description.trim()) || null;
  const result = db.prepare('INSERT INTO maps (name, description, map_type, parent_id, pin_x, pin_y, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), desc, type, parent.id, px, py, req.user.id);
  req.flash('success', 'Sub-map created.');
  res.redirect('/map/' + parent.id);
});

// Move child map pin on parent
router.post('/:id/children/:childId/pin', requireLogin, requireDM, express.json(), (req, res) => {
  const child = db.prepare('SELECT id, parent_id FROM maps WHERE id = ? AND parent_id = ?').get(req.params.childId, req.params.id);
  if (!child) return res.status(404).json({ error: 'Child map not found' });
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE maps SET pin_x = ?, pin_y = ? WHERE id = ?').run(px, py, child.id);
  res.json({ success: true });
});

// Add location
router.post('/:id/locations', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const { name, description, x, y, icon } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map/' + map.id);
  }
  const validIcons = Object.keys(MARKER_TYPES);
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  const locX = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const locY = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('INSERT INTO map_locations (name, description, x, y, icon, created_by, map_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), (description && description.trim()) || null, locX, locY, locIcon, req.user.id, map.id);
  req.flash('success', 'Location added.');
  res.redirect('/map/' + map.id);
});

// Edit location
router.post('/:id/locations/:locId/edit', requireLogin, requireDM, (req, res) => {
  const { name, description, icon } = req.body;
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ? AND map_id = ?').get(req.params.locId, req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map/' + req.params.id);
  }
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map/' + req.params.id);
  }
  const validIcons = Object.keys(MARKER_TYPES);
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  db.prepare('UPDATE map_locations SET name = ?, description = ?, icon = ? WHERE id = ?')
    .run(name.trim(), (description && description.trim()) || null, locIcon, loc.id);
  req.flash('success', 'Location updated.');
  res.redirect('/map/' + req.params.id);
});

// Convert location to sub-map
router.post('/:id/locations/:locId/convert', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const loc = db.prepare('SELECT * FROM map_locations WHERE id = ? AND map_id = ?').get(req.params.locId, req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map/' + map.id);
  }
  const depth = getMapDepth(map.id);
  if (depth >= 2) {
    req.flash('error', 'Maximum map depth (3 levels) reached. Cannot convert.');
    return res.redirect('/map/' + map.id);
  }
  const mapType = MARKER_TYPES[loc.icon] ? loc.icon : 'location';
  const result = db.prepare('INSERT INTO maps (name, description, map_type, parent_id, pin_x, pin_y, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(loc.name, loc.description || null, mapType, map.id, loc.x, loc.y, req.user.id);
  // Remove the old location
  db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
  db.prepare('DELETE FROM map_locations WHERE id = ?').run(loc.id);
  req.flash('success', 'Location converted to sub-map.');
  res.redirect('/map/' + map.id);
});

// Delete location
router.post('/:id/locations/:locId/delete', requireLogin, requireDM, (req, res) => {
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ? AND map_id = ?').get(req.params.locId, req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map/' + req.params.id);
  }
  db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
  db.prepare('DELETE FROM map_locations WHERE id = ?').run(loc.id);
  req.flash('success', 'Location removed.');
  res.redirect('/map/' + req.params.id);
});

// Update party position (JSON) — top-level maps only
router.post('/:id/party', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id, parent_id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  if (map.parent_id) return res.status(400).json({ error: 'Party marker only on top-level maps' });
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE maps SET party_x = ?, party_y = ? WHERE id = ?').run(px, py, map.id);
  res.json({ success: true });
});

// Get characters for token picker (JSON)
router.get('/:id/characters', requireLogin, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const characters = db.prepare(`
    SELECT c.id, c.name, c.avatar, c.user_id, u.username
    FROM characters c
    JOIN users u ON u.id = c.user_id
    ORDER BY u.username, c.sort_order, c.name
  `).all();
  res.json({ characters });
});

// Place token on map
router.post('/:id/tokens', requireLogin, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const { character_id, x, y } = req.body;
  const character = db.prepare('SELECT id, user_id FROM characters WHERE id = ?').get(character_id);
  if (!character) return res.status(404).json({ error: 'Character not found' });
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  if (character.user_id !== req.user.id && !isDM) {
    return res.status(403).json({ error: 'Can only place your own characters' });
  }
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  try {
    const result = db.prepare('INSERT INTO map_tokens (map_id, character_id, x, y, placed_by) VALUES (?, ?, ?, ?, ?)')
      .run(map.id, character.id, px, py, req.user.id);
    res.json({ success: true, tokenId: result.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Character already on this map' });
    }
    throw e;
  }
});

// Move token
router.post('/:id/tokens/:tokenId/move', requireLogin, express.json(), (req, res) => {
  const token = db.prepare(`
    SELECT mt.id, mt.character_id, c.user_id AS char_owner
    FROM map_tokens mt
    JOIN characters c ON c.id = mt.character_id
    WHERE mt.id = ? AND mt.map_id = ?
  `).get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  if (token.char_owner !== req.user.id && !isDM) {
    return res.status(403).json({ error: 'Not authorized to move this token' });
  }
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE map_tokens SET x = ?, y = ? WHERE id = ?').run(px, py, token.id);
  res.json({ success: true });
});

// Remove token
router.post('/:id/tokens/:tokenId/delete', requireLogin, express.json(), (req, res) => {
  const token = db.prepare(`
    SELECT mt.id, mt.character_id, c.user_id AS char_owner
    FROM map_tokens mt
    JOIN characters c ON c.id = mt.character_id
    WHERE mt.id = ? AND mt.map_id = ?
  `).get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  if (token.char_owner !== req.user.id && !isDM) {
    return res.status(403).json({ error: 'Not authorized to remove this token' });
  }
  db.prepare('DELETE FROM map_tokens WHERE id = ?').run(token.id);
  res.json({ success: true });
});

// Resize individual token
router.post('/:id/tokens/:tokenId/resize', requireLogin, requireDM, express.json(), (req, res) => {
  const token = db.prepare('SELECT id FROM map_tokens WHERE id = ? AND map_id = ?').get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const scale = Math.max(0.5, Math.min(3.0, parseFloat(req.body.scale) || 1.0));
  db.prepare('UPDATE map_tokens SET scale = ? WHERE id = ?').run(scale, token.id);
  res.json({ success: true, scale });
});

// Resize all tokens on map
router.post('/:id/tokens/resize-all', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const scale = Math.max(0.5, Math.min(3.0, parseFloat(req.body.scale) || 1.0));
  db.prepare('UPDATE map_tokens SET scale = ? WHERE map_id = ?').run(scale, map.id);
  res.json({ success: true, scale });
});

// Add condition to token
router.post('/:id/tokens/:tokenId/conditions', requireLogin, requireDM, express.json(), (req, res) => {
  const token = db.prepare('SELECT id FROM map_tokens WHERE id = ? AND map_id = ?').get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const name = (req.body.condition_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Condition name required' });
  try {
    const result = db.prepare('INSERT INTO token_conditions (token_id, condition_name, applied_by) VALUES (?, ?, ?)').run(token.id, name, req.user.id);
    res.json({ success: true, conditionId: result.lastInsertRowid, condition_name: name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Condition already applied' });
    throw e;
  }
});

// Remove condition from token
router.post('/:id/tokens/:tokenId/conditions/:condId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const cond = db.prepare(`
    SELECT tc.id FROM token_conditions tc
    JOIN map_tokens mt ON mt.id = tc.token_id
    WHERE tc.id = ? AND tc.token_id = ? AND mt.map_id = ?
  `).get(req.params.condId, req.params.tokenId, req.params.id);
  if (!cond) return res.status(404).json({ error: 'Condition not found' });
  db.prepare('DELETE FROM token_conditions WHERE id = ?').run(cond.id);
  res.json({ success: true });
});

// Get available conditions list from Vault
router.get('/:id/conditions-list', requireLogin, (req, res) => {
  try {
    const conditions = db.prepare("SELECT DISTINCT name FROM dnd_conditions WHERE condition_type = 'condition' ORDER BY name").all();
    // If no vault data, return standard D&D 5e conditions
    if (conditions.length === 0) {
      const standard = ['Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious'];
      return res.json({ conditions: standard.map(n => ({ name: n })) });
    }
    res.json({ conditions });
  } catch (e) {
    // Table might not exist if vault not imported
    const standard = ['Blinded','Charmed','Deafened','Exhaustion','Frightened','Grappled','Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone','Restrained','Stunned','Unconscious'];
    res.json({ conditions: standard.map(n => ({ name: n })) });
  }
});

// Delete map (cascades to children, tokens, locations)
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }

  // Recursively delete all children
  function deleteMapCascade(mapId) {
    const childMaps = db.prepare('SELECT id, image_path FROM maps WHERE parent_id = ?').all(mapId);
    for (const child of childMaps) {
      deleteMapCascade(child.id);
    }
    const locIds = db.prepare('SELECT id FROM map_locations WHERE map_id = ?').all(mapId);
    for (const loc of locIds) {
      db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
    }
    db.prepare('DELETE FROM map_locations WHERE map_id = ?').run(mapId);
    db.prepare('DELETE FROM map_tokens WHERE map_id = ?').run(mapId);
    const m = db.prepare('SELECT image_path FROM maps WHERE id = ?').get(mapId);
    db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
    if (m && m.image_path) {
      const imgPath = path.join(mapsDir, m.image_path);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  }

  deleteMapCascade(map.id);
  const redirectTo = map.parent_id ? '/map/' + map.parent_id : '/map';
  req.flash('success', 'Map deleted.');
  res.redirect(redirectTo);
});

module.exports = router;
