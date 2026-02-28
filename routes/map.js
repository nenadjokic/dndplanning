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

// Maps index — tree view (with hidden map filtering)
router.get('/', requireLogin, (req, res) => {
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const isAdmin = req.user.role === 'admin';
  let maps;

  if (isAdmin) {
    // Admin sees all maps
    maps = db.prepare('SELECT * FROM maps ORDER BY created_at').all();
  } else if (isDM) {
    // DM sees non-hidden + own hidden maps
    maps = db.prepare('SELECT * FROM maps WHERE hidden_by IS NULL OR created_by = ? ORDER BY created_at').all(req.user.id);
  } else {
    // Players see only non-hidden
    maps = db.prepare('SELECT * FROM maps WHERE hidden_by IS NULL ORDER BY created_at').all();
  }

  const tree = buildMapTree(maps);
  res.render('maps', { maps, tree, isDM, isAdmin, MARKER_TYPES, currentUserId: req.user.id });
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

// NPC Library — list all NPCs + categories (MUST be before /:id)
router.get('/npcs', requireLogin, requireDM, (req, res) => {
  const categories = db.prepare('SELECT * FROM npc_categories ORDER BY name').all();
  const npcs = db.prepare('SELECT * FROM npc_tokens ORDER BY name').all();
  for (const n of npcs) {
    if (n.avatar && !n.avatar.startsWith('/')) n.avatar = '/avatars/' + n.avatar;
    // Fetch multi-category assignments
    try {
      n.category_ids = db.prepare('SELECT category_id FROM npc_token_categories WHERE npc_token_id = ?').all(n.id).map(r => r.category_id);
    } catch (e) {
      n.category_ids = n.category_id ? [n.category_id] : [];
    }
  }
  res.json({ categories, npcs });
});

// Create NPC category
router.post('/npcs/categories', requireLogin, requireDM, express.json(), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const result = db.prepare('INSERT INTO npc_categories (name, created_by) VALUES (?, ?)').run(name, req.user.id);
  res.json({ success: true, id: result.lastInsertRowid, name });
});

// Delete NPC category
router.post('/npcs/categories/:catId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const cat = db.prepare('SELECT id FROM npc_categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  db.prepare('UPDATE npc_tokens SET category_id = NULL WHERE category_id = ?').run(cat.id);
  try { db.prepare('DELETE FROM npc_token_categories WHERE category_id = ?').run(cat.id); } catch (e) {}
  db.prepare('DELETE FROM npc_categories WHERE id = ?').run(cat.id);
  res.json({ success: true });
});

// Create NPC token
router.post('/npcs', requireLogin, requireDM, async (req, res) => {
  npcAvatarUpload(req, res, async function(err) {
    try {
      if (err) return res.status(400).json({ error: 'Upload failed' });
      const name = (req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name required' });
      const maxHp = Math.max(0, parseInt(req.body.max_hp) || 0);
      const categoryId = parseInt(req.body.category_id) || null;
      const sourceType = req.body.source_type || 'custom';
      const sourceKey = req.body.source_key || null;
      const notes = (req.body.notes || '').trim() || null;
      let avatarFile = req.file ? req.file.filename : null;
      // If no file uploaded but avatar_url provided, download it
      if (!avatarFile && req.body.avatar_url) {
        avatarFile = await downloadAvatarUrl(req.body.avatar_url);
      }
      const result = db.prepare(`
        INSERT INTO npc_tokens (name, avatar, source_type, source_key, category_id, max_hp, current_hp, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, avatarFile, sourceType, sourceKey, categoryId, maxHp, maxHp, notes, req.user.id);
      const npcId = result.lastInsertRowid;
      // Multi-category support
      const categoryIds = req.body.category_ids ? (Array.isArray(req.body.category_ids) ? req.body.category_ids : [req.body.category_ids]) : (categoryId ? [categoryId] : []);
      for (const cid of categoryIds) {
        const cidNum = parseInt(cid);
        if (cidNum) {
          try { db.prepare('INSERT OR IGNORE INTO npc_token_categories (npc_token_id, category_id) VALUES (?, ?)').run(npcId, cidNum); } catch (e) {}
        }
      }
      const npc = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(npcId);
      if (npc.avatar && !npc.avatar.startsWith('/')) npc.avatar = '/avatars/' + npc.avatar;
      res.json({ success: true, npc });
    } catch (e) {
      console.error('NPC create error:', e);
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Edit NPC token
router.post('/npcs/:npcId/edit', requireLogin, requireDM, (req, res) => {
  npcAvatarUpload(req, res, function(err) {
    const npc = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(req.params.npcId);
    if (!npc) return res.status(404).json({ error: 'NPC not found' });
    const name = (req.body.name || '').trim() || npc.name;
    const maxHp = Math.max(0, parseInt(req.body.max_hp) || 0);
    const categoryId = req.body.category_id ? parseInt(req.body.category_id) : npc.category_id;
    const notes = req.body.notes !== undefined ? (req.body.notes || '').trim() || null : npc.notes;
    const avatarFile = req.file ? req.file.filename : npc.avatar;
    db.prepare('UPDATE npc_tokens SET name = ?, avatar = ?, max_hp = ?, category_id = ?, notes = ? WHERE id = ?')
      .run(name, avatarFile, maxHp, categoryId, notes, npc.id);
    if (maxHp > 0) {
      db.prepare('UPDATE npc_tokens SET current_hp = MIN(current_hp, ?) WHERE id = ?').run(maxHp, npc.id);
    }
    // Multi-category support
    const categoryIds = req.body.category_ids ? (Array.isArray(req.body.category_ids) ? req.body.category_ids : [req.body.category_ids]) : (categoryId ? [categoryId] : []);
    try {
      db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(npc.id);
      for (const cid of categoryIds) {
        const cidNum = parseInt(cid);
        if (cidNum) {
          db.prepare('INSERT OR IGNORE INTO npc_token_categories (npc_token_id, category_id) VALUES (?, ?)').run(npc.id, cidNum);
        }
      }
    } catch (e) {}
    const updated = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(npc.id);
    if (updated.avatar && !updated.avatar.startsWith('/')) updated.avatar = '/avatars/' + updated.avatar;
    res.json({ success: true, npc: updated });
  });
});

// Delete NPC token from library
router.post('/npcs/:npcId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const npc = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(req.params.npcId);
  if (!npc) return res.status(404).json({ error: 'NPC not found' });
  const mapPlacements = db.prepare('SELECT id FROM map_npc_tokens WHERE npc_token_id = ?').all(npc.id);
  for (const p of mapPlacements) {
    db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(p.id);
  }
  db.prepare('DELETE FROM map_npc_tokens WHERE npc_token_id = ?').run(npc.id);
  try { db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(npc.id); } catch (e) {}
  db.prepare('DELETE FROM npc_tokens WHERE id = ?').run(npc.id);
  if (npc.avatar) {
    const avatarPath = path.join(npcAvatarDir, npc.avatar);
    if (fs.existsSync(avatarPath)) try { fs.unlinkSync(avatarPath); } catch(e) {}
  }
  res.json({ success: true });
});

// Single map view
router.get('/:id', requireLogin, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const isAdmin = req.user.role === 'admin';

  // Block access to hidden maps (unless creator or admin)
  if (map.hidden_by && map.created_by !== req.user.id && !isAdmin) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }

  const locations = db.prepare('SELECT * FROM map_locations WHERE map_id = ? ORDER BY created_at').all(map.id);
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

  // Fix avatar paths — prepend /avatars/ if bare filename
  for (const t of tokens) {
    if (t.char_avatar && !t.char_avatar.startsWith('/')) {
      t.char_avatar = '/avatars/' + t.char_avatar;
    }
  }

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

  // NPC tokens on this map
  const npcTokens = db.prepare(`
    SELECT mnt.id, mnt.map_id, mnt.npc_token_id, mnt.x, mnt.y, mnt.scale, mnt.current_hp,
           mnt.hp_visible, mnt.hidden, mnt.vision_radius, mnt.alignment,
           n.name AS npc_name, n.avatar AS npc_avatar, n.max_hp, n.source_type
    FROM map_npc_tokens mnt
    JOIN npc_tokens n ON n.id = mnt.npc_token_id
    WHERE mnt.map_id = ?
  `).all(map.id);

  // Fix NPC avatar paths
  for (const nt of npcTokens) {
    if (nt.npc_avatar && !nt.npc_avatar.startsWith('/')) nt.npc_avatar = '/avatars/' + nt.npc_avatar;
  }

  // Fetch conditions for NPC tokens
  const npcTokenIds = npcTokens.map(t => t.id);
  let npcConditions = [];
  if (npcTokenIds.length > 0) {
    npcConditions = db.prepare(`
      SELECT ntc.id, ntc.npc_map_token_id, ntc.condition_name, ntc.created_at
      FROM npc_token_conditions ntc
      WHERE ntc.npc_map_token_id IN (${npcTokenIds.map(() => '?').join(',')})
      ORDER BY ntc.created_at
    `).all(...npcTokenIds);
  }
  const npcCondByToken = {};
  for (const c of npcConditions) {
    if (!npcCondByToken[c.npc_map_token_id]) npcCondByToken[c.npc_map_token_id] = [];
    npcCondByToken[c.npc_map_token_id].push(c);
  }
  for (const nt of npcTokens) {
    nt.conditions = npcCondByToken[nt.id] || [];
  }

  // Map links (non-hierarchical hyperlinks)
  let mapLinks = [];
  try {
    mapLinks = db.prepare(`
      SELECT ml.id, ml.target_map_id, ml.pin_x, ml.pin_y,
             m.name, m.description, m.map_type, m.image_path
      FROM map_links ml
      JOIN maps m ON m.id = ml.target_map_id
      WHERE ml.source_map_id = ?
      ORDER BY m.name
    `).all(map.id);
  } catch (e) { /* table may not exist yet */ }

  // Fetch all players for NPC assignment UI
  const allPlayers = db.prepare("SELECT id, username FROM users WHERE role IN ('player', 'dm', 'admin') ORDER BY username").all();

  // Fetch NPC token assignments for this map
  const npcMapTokenIds = npcTokens.map(nt => nt.id);
  if (npcMapTokenIds.length > 0) {
    const assignments = db.prepare(`
      SELECT nta.npc_token_id, nta.user_id, u.username
      FROM npc_token_assignments nta
      JOIN users u ON u.id = nta.user_id
      WHERE nta.npc_token_id IN (${npcMapTokenIds.map(() => '?').join(',')})
    `).all(...npcMapTokenIds);
    const assignByToken = {};
    for (const a of assignments) {
      if (!assignByToken[a.npc_token_id]) assignByToken[a.npc_token_id] = [];
      assignByToken[a.npc_token_id].push({ user_id: a.user_id, username: a.username });
    }
    for (const nt of npcTokens) {
      nt.assigned_users = assignByToken[nt.id] || [];
    }
  } else {
    for (const nt of npcTokens) {
      nt.assigned_users = [];
    }
  }

  res.render('map', { map, locations, isDM, isAdmin, chain, children, tokens, npcTokens, showPartyMarker, canAddChild, MARKER_TYPES, currentUserId: req.user.id, mapLinks, allPlayers });
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
  // Fix avatar paths
  for (const c of characters) {
    if (c.avatar && !c.avatar.startsWith('/')) {
      c.avatar = '/avatars/' + c.avatar;
    }
  }
  res.json({ characters });
});

// Get live token state (for SSE-triggered refresh)
router.get('/:id/token-state', requireLogin, (req, res) => {
  const map = db.prepare('SELECT id, fog_enabled, fog_data FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const isDMUser = req.user.role === 'dm' || req.user.role === 'admin';
  // Player tokens
  const tokens = db.prepare(`
    SELECT mt.id, mt.character_id, mt.x, mt.y, mt.scale,
           c.name AS char_name, c.avatar AS char_avatar, c.user_id AS char_user_id
    FROM map_tokens mt
    JOIN characters c ON c.id = mt.character_id
    WHERE mt.map_id = ?
  `).all(map.id);
  for (const t of tokens) {
    if (t.char_avatar && !t.char_avatar.startsWith('/')) t.char_avatar = '/avatars/' + t.char_avatar;
    t.conditions = db.prepare('SELECT id, condition_name FROM token_conditions WHERE token_id = ?').all(t.id);
  }
  // NPC tokens
  let npcTokens = db.prepare(`
    SELECT mnt.id, mnt.npc_token_id, mnt.x, mnt.y, mnt.scale, mnt.current_hp, mnt.hp_visible, mnt.hidden, mnt.alignment,
           n.name AS npc_name, n.avatar AS npc_avatar, n.max_hp, n.source_type
    FROM map_npc_tokens mnt
    JOIN npc_tokens n ON n.id = mnt.npc_token_id
    WHERE mnt.map_id = ?
  `).all(map.id);
  for (const nt of npcTokens) {
    if (nt.npc_avatar && !nt.npc_avatar.startsWith('/')) nt.npc_avatar = '/avatars/' + nt.npc_avatar;
    nt.conditions = db.prepare('SELECT id, condition_name FROM npc_token_conditions WHERE npc_map_token_id = ?').all(nt.id);
  }
  // Fetch NPC token assignments
  const npcMapTokenIds = npcTokens.map(nt => nt.id);
  if (npcMapTokenIds.length > 0) {
    try {
      const assignments = db.prepare(`
        SELECT nta.npc_token_id, nta.user_id, u.username
        FROM npc_token_assignments nta
        JOIN users u ON u.id = nta.user_id
        WHERE nta.npc_token_id IN (${npcMapTokenIds.map(() => '?').join(',')})
      `).all(...npcMapTokenIds);
      const assignByToken = {};
      for (const a of assignments) {
        if (!assignByToken[a.npc_token_id]) assignByToken[a.npc_token_id] = [];
        assignByToken[a.npc_token_id].push({ user_id: a.user_id, username: a.username });
      }
      for (const nt of npcTokens) {
        nt.assigned_users = assignByToken[nt.id] || [];
      }
    } catch (e) {
      for (const nt of npcTokens) { nt.assigned_users = []; }
    }
  } else {
    for (const nt of npcTokens) { nt.assigned_users = []; }
  }
  // Filter hidden NPCs for players
  if (!isDMUser) {
    npcTokens = npcTokens.filter(nt => !nt.hidden);
  }
  res.json({ tokens, npcTokens });
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
    sse.broadcast('map-update', { mapId: map.id, action: 'token-place', tokenId: result.lastInsertRowid });
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
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'token-move', tokenId: token.id, x: px, y: py });
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
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'token-delete', tokenId: token.id });
  res.json({ success: true });
});

// Resize individual token
router.post('/:id/tokens/:tokenId/resize', requireLogin, requireDM, express.json(), (req, res) => {
  const token = db.prepare('SELECT id FROM map_tokens WHERE id = ? AND map_id = ?').get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const scale = Math.max(0.5, Math.min(20.0, parseFloat(req.body.scale) || 1.0));
  db.prepare('UPDATE map_tokens SET scale = ? WHERE id = ?').run(scale, token.id);
  res.json({ success: true, scale });
});

// Resize all tokens on map (delta-based offset)
router.post('/:id/tokens/resize-all', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const delta = parseFloat(req.body.delta);
  if (isNaN(delta)) return res.status(400).json({ error: 'Delta required' });
  // Apply delta to all player tokens, clamped to 0.1 minimum (no upper cap)
  db.prepare('UPDATE map_tokens SET scale = MAX(0.1, scale + ?) WHERE map_id = ?').run(delta, map.id);
  // Apply delta to all NPC tokens too
  db.prepare('UPDATE map_npc_tokens SET scale = MAX(0.1, scale + ?) WHERE map_id = ?').run(delta, map.id);
  sse.broadcast('map-update', { mapId: map.id, action: 'resize-all' });
  res.json({ success: true });
});

// Add condition to token
router.post('/:id/tokens/:tokenId/conditions', requireLogin, requireDM, express.json(), (req, res) => {
  const token = db.prepare('SELECT id FROM map_tokens WHERE id = ? AND map_id = ?').get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const name = (req.body.condition_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Condition name required' });
  try {
    const result = db.prepare('INSERT INTO token_conditions (token_id, condition_name, applied_by) VALUES (?, ?, ?)').run(token.id, name, req.user.id);
    sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'token-update' });
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
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'token-update' });
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

// ---- Fog of War ----

// Toggle FoW on/off
router.post('/:id/fog/toggle', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id, fog_enabled FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const newVal = map.fog_enabled ? 0 : 1;
  db.prepare('UPDATE maps SET fog_enabled = ? WHERE id = ?').run(newVal, map.id);
  res.json({ success: true, fog_enabled: newVal });
});

// Get fog data
router.get('/:id/fog', requireLogin, (req, res) => {
  const map = db.prepare('SELECT id, fog_enabled, fog_data, fog_draft, fog_explored FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  res.json({
    fog_enabled: map.fog_enabled,
    fog_data: map.fog_data || null,
    fog_draft: isDM ? (map.fog_draft || null) : null,
    fog_explored: map.fog_explored || null
  });
});

// Save fog draft (DM only)
router.post('/:id/fog/draft', requireLogin, requireDM, express.json({ limit: '5mb' }), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  db.prepare('UPDATE maps SET fog_draft = ? WHERE id = ?').run(req.body.fog_draft || null, map.id);
  res.json({ success: true });
});

// Publish fog (draft → data)
router.post('/:id/fog/publish', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id, fog_draft FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  db.prepare('UPDATE maps SET fog_data = fog_draft WHERE id = ?').run(map.id);
  sse.broadcast('fog-update', { mapId: map.id });
  res.json({ success: true });
});

// Reset fog draft
router.post('/:id/fog/reset-draft', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id, fog_data FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  db.prepare('UPDATE maps SET fog_draft = fog_data WHERE id = ?').run(map.id);
  res.json({ success: true });
});

// Save explored mask
router.post('/:id/fog/explored', requireLogin, express.json({ limit: '5mb' }), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  db.prepare('UPDATE maps SET fog_explored = ? WHERE id = ?').run(req.body.fog_explored || null, map.id);
  res.json({ success: true });
});

// Toggle map hidden
router.post('/:id/toggle-hidden', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  // Only creator can hide/unhide
  if (map.created_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the map creator can hide/unhide' });
  }
  const newVal = map.hidden_by ? null : req.user.id;
  db.prepare('UPDATE maps SET hidden_by = ? WHERE id = ?').run(newVal, map.id);
  res.json({ success: true, hidden: !!newVal });
});

// ---- NPC Token System (map-specific routes below /:id) ----

const npcAvatarDir = path.join(__dirname, '..', 'data', 'avatars');
const https = require('https');
const http = require('http');
function downloadAvatarUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return resolve(null);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 8000 }, (resp) => {
      if (resp.statusCode !== 200) return resolve(null);
      const ct = resp.headers['content-type'] || '';
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
      const ext = extMap[ct.split(';')[0].trim()] || '.png';
      const fname = 'npc-' + Date.now() + ext;
      const fpath = path.join(npcAvatarDir, fname);
      const ws = fs.createWriteStream(fpath);
      resp.pipe(ws);
      ws.on('finish', () => resolve(fname));
      ws.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

const npcAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, npcAvatarDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'npc-' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  }
}).single('avatar');

// Place NPC token on map
router.post('/:id/npc-tokens', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const npcId = parseInt(req.body.npc_token_id);
  const npc = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(npcId);
  if (!npc) return res.status(404).json({ error: 'NPC not found' });
  const px = Math.max(0, Math.min(100, parseFloat(req.body.x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(req.body.y) || 50));
  const result = db.prepare('INSERT INTO map_npc_tokens (map_id, npc_token_id, x, y, current_hp, hp_visible, alignment, placed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(map.id, npc.id, px, py, npc.current_hp, npc.hp_visible, 'hostile', req.user.id);
  sse.broadcast('map-update', { mapId: map.id, action: 'npc-place', ntId: result.lastInsertRowid });
  res.json({ success: true, id: result.lastInsertRowid });
});

// Assign/unassign NPC token to player (DM only)
router.post('/:id/npc-tokens/:ntId/assign', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const userId = parseInt(req.body.user_id);
  const assign = req.body.assign; // true or false
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  if (assign) {
    try {
      db.prepare('INSERT OR IGNORE INTO npc_token_assignments (npc_token_id, user_id) VALUES (?, ?)').run(nt.id, userId);
    } catch (e) { /* already assigned */ }
  } else {
    db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ? AND user_id = ?').run(nt.id, userId);
  }
  // Fetch updated assignments
  const assignments = db.prepare(`
    SELECT nta.user_id, u.username FROM npc_token_assignments nta
    JOIN users u ON u.id = nta.user_id WHERE nta.npc_token_id = ?
  `).all(nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-assignment', ntId: nt.id });
  res.json({ success: true, assigned_users: assignments });
});

// Move NPC token on map (DM or assigned player)
router.post('/:id/npc-tokens/:ntId/move', requireLogin, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const isDMUser = req.user.role === 'dm' || req.user.role === 'admin';
  if (!isDMUser) {
    const assignment = db.prepare('SELECT id FROM npc_token_assignments WHERE npc_token_id = ? AND user_id = ?').get(nt.id, req.user.id);
    if (!assignment) return res.status(403).json({ error: 'Not authorized to move this NPC' });
  }
  const px = Math.max(0, Math.min(100, parseFloat(req.body.x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(req.body.y) || 50));
  db.prepare('UPDATE map_npc_tokens SET x = ?, y = ? WHERE id = ?').run(px, py, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-move', ntId: nt.id, x: px, y: py });
  res.json({ success: true });
});

// Resize NPC token
router.post('/:id/npc-tokens/:ntId/resize', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const scale = Math.max(0.5, Math.min(20.0, parseFloat(req.body.scale) || 1.0));
  db.prepare('UPDATE map_npc_tokens SET scale = ? WHERE id = ?').run(scale, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
  res.json({ success: true, scale });
});

// Delete NPC token from map
router.post('/:id/npc-tokens/:ntId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  try { db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(nt.id); } catch (e) { /* table may not exist */ }
  db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(nt.id);
  db.prepare('DELETE FROM map_npc_tokens WHERE id = ?').run(nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-delete', ntId: nt.id });
  res.json({ success: true });
});

// NPC HP adjustment (delta-based)
router.post('/:id/npc-tokens/:ntId/hp', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare(`
    SELECT mnt.id, mnt.current_hp, mnt.npc_token_id, n.max_hp
    FROM map_npc_tokens mnt
    JOIN npc_tokens n ON n.id = mnt.npc_token_id
    WHERE mnt.id = ? AND mnt.map_id = ?
  `).get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const delta = parseInt(req.body.delta) || 0;
  let newHp = (nt.current_hp || 0) + delta;
  if (nt.max_hp > 0) newHp = Math.max(0, Math.min(nt.max_hp, newHp));
  else newHp = Math.max(0, newHp);
  db.prepare('UPDATE map_npc_tokens SET current_hp = ? WHERE id = ?').run(newHp, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
  res.json({ success: true, current_hp: newHp, max_hp: nt.max_hp });
});

// Toggle NPC HP visibility on map
router.post('/:id/npc-tokens/:ntId/toggle-hp-visible', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id, hp_visible FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const newVal = nt.hp_visible ? 0 : 1;
  db.prepare('UPDATE map_npc_tokens SET hp_visible = ? WHERE id = ?').run(newVal, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
  res.json({ success: true, hp_visible: newVal });
});

// Toggle NPC hidden on map
router.post('/:id/npc-tokens/:ntId/toggle-hidden', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id, hidden FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const newVal = nt.hidden ? 0 : 1;
  db.prepare('UPDATE map_npc_tokens SET hidden = ? WHERE id = ?').run(newVal, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
  res.json({ success: true, hidden: newVal });
});

// Set NPC alignment (hostile/friendly/neutral)
router.post('/:id/npc-tokens/:ntId/alignment', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const valid = ['hostile', 'friendly', 'neutral'];
  const alignment = valid.includes(req.body.alignment) ? req.body.alignment : 'hostile';
  db.prepare('UPDATE map_npc_tokens SET alignment = ? WHERE id = ?').run(alignment, nt.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
  res.json({ success: true, alignment });
});

// Add condition to NPC map token
router.post('/:id/npc-tokens/:ntId/conditions', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const name = (req.body.condition_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Condition name required' });
  try {
    const result = db.prepare('INSERT INTO npc_token_conditions (npc_map_token_id, condition_name, applied_by) VALUES (?, ?, ?)').run(nt.id, name, req.user.id);
    sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: nt.id });
    res.json({ success: true, conditionId: result.lastInsertRowid, condition_name: name });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Condition already applied' });
    throw e;
  }
});

// Remove condition from NPC map token
router.post('/:id/npc-tokens/:ntId/conditions/:condId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const cond = db.prepare(`
    SELECT ntc.id FROM npc_token_conditions ntc
    JOIN map_npc_tokens mnt ON mnt.id = ntc.npc_map_token_id
    WHERE ntc.id = ? AND ntc.npc_map_token_id = ? AND mnt.map_id = ?
  `).get(req.params.condId, req.params.ntId, req.params.id);
  if (!cond) return res.status(404).json({ error: 'Condition not found' });
  db.prepare('DELETE FROM npc_token_conditions WHERE id = ?').run(cond.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'npc-update', ntId: parseInt(req.params.ntId) });
  res.json({ success: true });
});

// Set vision radius for player token
router.post('/:id/tokens/:tokenId/vision', requireLogin, requireDM, express.json(), (req, res) => {
  const token = db.prepare('SELECT id FROM map_tokens WHERE id = ? AND map_id = ?').get(req.params.tokenId, req.params.id);
  if (!token) return res.status(404).json({ error: 'Token not found' });
  const radius = Math.max(0, Math.min(30, parseFloat(req.body.vision_radius) || 0));
  db.prepare('UPDATE map_tokens SET vision_radius = ? WHERE id = ?').run(radius, token.id);
  res.json({ success: true, vision_radius: radius });
});

// Set vision radius for NPC token
router.post('/:id/npc-tokens/:ntId/vision', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const radius = Math.max(0, Math.min(30, parseFloat(req.body.vision_radius) || 0));
  db.prepare('UPDATE map_npc_tokens SET vision_radius = ? WHERE id = ?').run(radius, nt.id);
  res.json({ success: true, vision_radius: radius });
});

// Get linkable maps (all maps except current) for linking
router.get('/:id/standalone-maps', requireLogin, requireDM, (req, res) => {
  const currentId = parseInt(req.params.id);
  const maps = db.prepare(`
    SELECT m.id, m.name, m.map_type FROM maps m
    WHERE m.id != ?
    ORDER BY m.name
  `).all(currentId);
  res.json({ maps });
});

// Link existing map as sub-map
router.post('/:id/link-existing', requireLogin, requireDM, express.json(), (req, res) => {
  const source = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source map not found' });

  const targetId = parseInt(req.body.map_id);
  if (!targetId) return res.status(400).json({ error: 'Map ID required' });
  if (targetId === source.id) return res.status(400).json({ error: 'Cannot link to self' });
  const target = db.prepare('SELECT * FROM maps WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Target map not found' });

  const px = Math.max(0, Math.min(100, parseFloat(req.body.pin_x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(req.body.pin_y) || 50));
  try {
    db.prepare('INSERT OR REPLACE INTO map_links (source_map_id, target_map_id, pin_x, pin_y) VALUES (?, ?, ?, ?)').run(source.id, targetId, px, py);
  } catch (e) {
    return res.status(400).json({ error: 'Link already exists' });
  }
  res.json({ success: true });
});

// Move a map link pin
router.post('/:id/links/:linkId/pin', requireLogin, requireDM, express.json(), (req, res) => {
  const link = db.prepare('SELECT * FROM map_links WHERE id = ? AND source_map_id = ?').get(req.params.linkId, req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const px = Math.max(0, Math.min(100, parseFloat(req.body.x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(req.body.y) || 50));
  db.prepare('UPDATE map_links SET pin_x = ?, pin_y = ? WHERE id = ?').run(px, py, link.id);
  res.json({ success: true });
});

// Delete a map link
router.post('/:id/links/:linkId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const link = db.prepare('SELECT * FROM map_links WHERE id = ? AND source_map_id = ?').get(req.params.linkId, req.params.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  db.prepare('DELETE FROM map_links WHERE id = ?').run(link.id);
  res.json({ success: true });
});

// Reparent a standalone map under another map
router.post('/:id/reparent', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  // Must be standalone (no parent, no children)
  if (map.parent_id) return res.status(400).json({ error: 'Map already has a parent' });
  const hasChildren = db.prepare('SELECT id FROM maps WHERE parent_id = ?').get(map.id);
  if (hasChildren) return res.status(400).json({ error: 'Map has children, cannot reparent' });

  const parentId = parseInt(req.body.parent_id);
  if (!parentId || parentId === map.id) return res.status(400).json({ error: 'Invalid parent' });
  const parent = db.prepare('SELECT id FROM maps WHERE id = ?').get(parentId);
  if (!parent) return res.status(404).json({ error: 'Parent map not found' });
  const parentDepth = getMapDepth(parentId);
  if (parentDepth >= 2) return res.status(400).json({ error: 'Maximum depth reached' });

  db.prepare('UPDATE maps SET parent_id = ?, pin_x = 50, pin_y = 50 WHERE id = ?').run(parentId, map.id);
  res.json({ success: true });
});

// Unparent (detach child map back to standalone)
router.post('/:id/unparent', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  if (!map.parent_id) return res.status(400).json({ error: 'Map has no parent' });
  db.prepare('UPDATE maps SET parent_id = NULL, pin_x = 50, pin_y = 50 WHERE id = ?').run(map.id);
  res.json({ success: true });
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
    // NPC tokens cleanup
    const npcMapTokenIds = db.prepare('SELECT id FROM map_npc_tokens WHERE map_id = ?').all(mapId);
    for (const nt of npcMapTokenIds) {
      try { db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(nt.id); } catch (e) { /* ignore */ }
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(nt.id);
    }
    db.prepare('DELETE FROM map_npc_tokens WHERE map_id = ?').run(mapId);
    // Clean up token conditions
    const playerTokenIds = db.prepare('SELECT id FROM map_tokens WHERE map_id = ?').all(mapId);
    for (const pt of playerTokenIds) {
      db.prepare('DELETE FROM token_conditions WHERE token_id = ?').run(pt.id);
    }
    db.prepare('DELETE FROM map_tokens WHERE map_id = ?').run(mapId);
    // Clean up map links
    try {
      db.prepare('DELETE FROM map_links WHERE source_map_id = ? OR target_map_id = ?').run(mapId, mapId);
    } catch (e) { /* table may not exist */ }
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
