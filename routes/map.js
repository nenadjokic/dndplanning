const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM, requireAdmin } = require('../middleware/auth');
const sse = require('../helpers/sse');
const router = express.Router();

const mapsDir = path.join(__dirname, '..', 'data', 'maps');
const npcAvatarDir = path.join(__dirname, '..', 'data', 'avatars');
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

// Maps index — tree view (with published map filtering + campaign filter)
router.get('/', requireLogin, (req, res) => {
  const effectiveRole = res.locals.effectiveRole || req.user.role;
  const isDM = effectiveRole === 'dm' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';
  const campaignFilter = req.query.campaign_id;
  let maps;

  let baseWhere = '';
  const params = [];
  if (!isDM) {
    // Players only see published maps
    baseWhere = 'WHERE published = 1';
  }

  // Apply campaign filter
  if (campaignFilter === 'unsorted') {
    baseWhere += (baseWhere ? ' AND' : 'WHERE') + ' campaign_id IS NULL';
  } else if (campaignFilter && campaignFilter !== '') {
    baseWhere += (baseWhere ? ' AND' : 'WHERE') + ' campaign_id = ?';
    params.push(parseInt(campaignFilter, 10));
  }

  maps = db.prepare('SELECT * FROM maps ' + baseWhere + ' ORDER BY created_at').all(...params);

  const tree = buildMapTree(maps);
  let campaigns = [];
  try { campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all(); } catch (e) {}

  const activeCampaignId = campaignFilter || null;
  res.render('maps', { maps, tree, isDM, isAdmin, MARKER_TYPES, currentUserId: req.user.id, campaigns, activeCampaignId });
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

// Bulk publish/unpublish maps (must be before /:id routes)
router.post('/bulk-publish', requireLogin, requireDM, express.json(), (req, res) => {
  const { map_ids, action } = req.body;
  if (!Array.isArray(map_ids) || map_ids.length === 0) {
    return res.status(400).json({ error: 'No maps selected' });
  }
  const val = action === 'unpublish' ? 0 : 1;
  const placeholders = map_ids.map(() => '?').join(',');
  db.prepare(`UPDATE maps SET published = ? WHERE id IN (${placeholders})`).run(val, ...map_ids);
  res.json({ success: true, count: map_ids.length });
});

// Bulk delete maps (must be before /:id routes)
router.post('/bulk-delete', requireLogin, requireDM, express.json(), (req, res) => {
  const { map_ids } = req.body;
  if (!Array.isArray(map_ids) || map_ids.length === 0) {
    return res.status(400).json({ error: 'No maps selected' });
  }

  // Reuse the cascade delete logic
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
    try {
      db.prepare('DELETE FROM combat_participants WHERE encounter_id IN (SELECT id FROM combat_encounters WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM combat_encounters WHERE map_id = ?').run(mapId);
    } catch (e) {}
    const npcMapTokenIds = db.prepare('SELECT id FROM map_npc_tokens WHERE map_id = ?').all(mapId);
    for (const nt of npcMapTokenIds) {
      try { db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(nt.id); } catch (e) {}
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(nt.id);
    }
    db.prepare('DELETE FROM map_npc_tokens WHERE map_id = ?').run(mapId);
    const playerTokenIds = db.prepare('SELECT id FROM map_tokens WHERE map_id = ?').all(mapId);
    for (const pt of playerTokenIds) {
      db.prepare('DELETE FROM token_conditions WHERE token_id = ?').run(pt.id);
    }
    db.prepare('DELETE FROM map_tokens WHERE map_id = ?').run(mapId);
    try { db.prepare('DELETE FROM map_links WHERE source_map_id = ? OR target_map_id = ?').run(mapId, mapId); } catch (e) {}
    const m = db.prepare('SELECT image_path FROM maps WHERE id = ?').get(mapId);
    db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
    if (m && m.image_path) {
      const imgPath = path.join(mapsDir, m.image_path);
      if (fs.existsSync(imgPath)) try { fs.unlinkSync(imgPath); } catch (e) {}
    }
  }

  let deleted = 0;
  for (const id of map_ids) {
    const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(id);
    if (map) {
      deleteMapCascade(map.id);
      deleted++;
    }
  }
  res.json({ success: true, count: deleted });
});

// NPC Management page (must be before /:id routes)
router.get('/npc-manager', requireLogin, requireDM, (req, res) => {
  const categories = db.prepare('SELECT * FROM npc_categories ORDER BY name').all();
  // Ensure parent_id is available
  for (const c of categories) { if (c.parent_id === undefined) c.parent_id = null; }
  const npcs = db.prepare('SELECT * FROM npc_tokens ORDER BY name').all();
  for (const n of npcs) {
    if (n.avatar && !n.avatar.startsWith('/')) n.avatar = '/avatars/' + n.avatar;
    try {
      n.category_ids = db.prepare('SELECT category_id FROM npc_token_categories WHERE npc_token_id = ?').all(n.id).map(r => r.category_id);
    } catch (e) {
      n.category_ids = n.category_id ? [n.category_id] : [];
    }
    // Count map placements
    n.placement_count = db.prepare('SELECT COUNT(*) as c FROM map_npc_tokens WHERE npc_token_id = ?').get(n.id).c;
  }
  // Count NPCs per category
  for (const cat of categories) {
    cat.npc_count = npcs.filter(n => n.category_id === cat.id || (n.category_ids && n.category_ids.includes(cat.id))).length;
  }
  const campaigns = [];
  try {
    const rows = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all();
    campaigns.push(...rows);
  } catch (e) {}
  res.render('npc-manager', {
    title: 'NPC Manager',
    categories,
    npcs,
    campaigns,
    isDM: true
  });
});

// Bulk delete NPCs (must be before /:id routes)
router.post('/npcs/bulk-delete', requireLogin, requireDM, express.json(), (req, res) => {
  const { npc_ids } = req.body;
  if (!Array.isArray(npc_ids) || npc_ids.length === 0) {
    return res.status(400).json({ error: 'No NPCs selected' });
  }
  let deleted = 0;
  for (const npcId of npc_ids) {
    const npc = db.prepare('SELECT * FROM npc_tokens WHERE id = ?').get(npcId);
    if (!npc) continue;
    const mapPlacements = db.prepare('SELECT id FROM map_npc_tokens WHERE npc_token_id = ?').all(npc.id);
    for (const p of mapPlacements) {
      try { db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(p.id); } catch (e) {}
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(p.id);
      try { db.prepare('DELETE FROM npc_vision_lines WHERE npc_map_token_id = ?').run(p.id); } catch (e) {}
      try { db.prepare('DELETE FROM combat_participants WHERE npc_map_token_id = ?').run(p.id); } catch (e) {}
    }
    db.prepare('DELETE FROM map_npc_tokens WHERE npc_token_id = ?').run(npc.id);
    try { db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(npc.id); } catch (e) {}
    try { db.prepare('UPDATE quests SET quest_giver_npc_id = NULL WHERE quest_giver_npc_id = ?').run(npc.id); } catch (e) {}
    try { db.prepare('UPDATE loot_items SET linked_npc_id = NULL WHERE linked_npc_id = ?').run(npc.id); } catch (e) {}
    db.prepare('DELETE FROM npc_tokens WHERE id = ?').run(npc.id);
    if (npc.avatar) {
      const avatarPath = path.join(npcAvatarDir, npc.avatar);
      if (fs.existsSync(avatarPath)) try { fs.unlinkSync(avatarPath); } catch (e) {}
    }
    deleted++;
  }
  res.json({ success: true, count: deleted });
});

// Delete all NPCs in a category (must be before /:id routes)
router.post('/npcs/categories/:catId/delete-npcs', requireLogin, requireDM, express.json(), (req, res) => {
  const cat = db.prepare('SELECT id, name FROM npc_categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const npcs = db.prepare('SELECT * FROM npc_tokens WHERE category_id = ?').all(cat.id);
  // Also get NPCs from junction table
  try {
    const junctionNpcs = db.prepare(`
      SELECT nt.* FROM npc_tokens nt
      JOIN npc_token_categories ntc ON nt.id = ntc.npc_token_id
      WHERE ntc.category_id = ? AND nt.id NOT IN (SELECT id FROM npc_tokens WHERE category_id = ?)
    `).all(cat.id, cat.id);
    npcs.push(...junctionNpcs);
  } catch (e) {}
  let deleted = 0;
  for (const npc of npcs) {
    const mapPlacements = db.prepare('SELECT id FROM map_npc_tokens WHERE npc_token_id = ?').all(npc.id);
    for (const p of mapPlacements) {
      try { db.prepare('DELETE FROM npc_token_assignments WHERE npc_token_id = ?').run(p.id); } catch (e) {}
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id = ?').run(p.id);
      try { db.prepare('DELETE FROM npc_vision_lines WHERE npc_map_token_id = ?').run(p.id); } catch (e) {}
      try { db.prepare('DELETE FROM combat_participants WHERE npc_map_token_id = ?').run(p.id); } catch (e) {}
    }
    db.prepare('DELETE FROM map_npc_tokens WHERE npc_token_id = ?').run(npc.id);
    try { db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(npc.id); } catch (e) {}
    try { db.prepare('UPDATE quests SET quest_giver_npc_id = NULL WHERE quest_giver_npc_id = ?').run(npc.id); } catch (e) {}
    try { db.prepare('UPDATE loot_items SET linked_npc_id = NULL WHERE linked_npc_id = ?').run(npc.id); } catch (e) {}
    db.prepare('DELETE FROM npc_tokens WHERE id = ?').run(npc.id);
    if (npc.avatar) {
      const avatarPath = path.join(npcAvatarDir, npc.avatar);
      if (fs.existsSync(avatarPath)) try { fs.unlinkSync(avatarPath); } catch (e) {}
    }
    deleted++;
  }
  const deleteCategory = req.body.delete_category === true;
  if (deleteCategory) {
    try { db.prepare('DELETE FROM npc_token_categories WHERE category_id = ?').run(cat.id); } catch (e) {}
    db.prepare('DELETE FROM npc_categories WHERE id = ?').run(cat.id);
  }
  res.json({ success: true, count: deleted, categoryDeleted: deleteCategory });
});

// Edit map metadata (name, type, description, campaign)
router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });

  const { name, map_type, description, campaign_id, parent_id } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Map name is required' });
  }

  const type = MARKER_TYPES[map_type] ? map_type : map.map_type;
  const campId = campaign_id ? parseInt(campaign_id, 10) : null;

  // Handle parent_id change
  if (parent_id !== undefined) {
    const newParentId = parent_id ? parseInt(parent_id, 10) : null;
    // Prevent setting self as parent or creating circular reference
    if (newParentId && newParentId !== map.id) {
      // Check for circular reference
      let checkId = newParentId;
      let circular = false;
      while (checkId) {
        if (checkId === map.id) { circular = true; break; }
        const p = db.prepare('SELECT parent_id FROM maps WHERE id = ?').get(checkId);
        checkId = p ? p.parent_id : null;
      }
      if (!circular) {
        db.prepare('UPDATE maps SET parent_id = ? WHERE id = ?').run(newParentId, map.id);
      }
    } else if (!newParentId) {
      db.prepare('UPDATE maps SET parent_id = NULL WHERE id = ?').run(map.id);
    }
  }

  db.prepare('UPDATE maps SET name = ?, map_type = ?, description = ?, campaign_id = ? WHERE id = ?')
    .run(name.trim(), type, description ? description.trim() : null, campId, map.id);

  // Cascade campaign_id to all children recursively
  function cascadeCampaign(parentId, cId) {
    const children = db.prepare('SELECT id FROM maps WHERE parent_id = ?').all(parentId);
    for (const child of children) {
      db.prepare('UPDATE maps SET campaign_id = ? WHERE id = ?').run(cId, child.id);
      cascadeCampaign(child.id, cId);
    }
  }
  cascadeCampaign(map.id, campId);

  if (req.headers['accept'] && req.headers['accept'].includes('application/json')) {
    return res.json({ success: true });
  }

  req.flash('success', 'Map updated.');
  res.redirect('/map/' + map.id);
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
  // Ensure parent_id is included (may be undefined on old DBs)
  for (const c of categories) {
    if (c.parent_id === undefined) c.parent_id = null;
  }
  res.json({ categories, npcs });
});

// Create NPC category
router.post('/npcs/categories', requireLogin, requireDM, express.json(), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const parentId = parseInt(req.body.parent_id) || null;
  if (parentId) {
    const parent = db.prepare('SELECT id FROM npc_categories WHERE id = ?').get(parentId);
    if (!parent) return res.status(400).json({ error: 'Parent category not found' });
  }
  const result = db.prepare('INSERT INTO npc_categories (name, parent_id, created_by) VALUES (?, ?, ?)').run(name, parentId, req.user.id);
  res.json({ success: true, id: result.lastInsertRowid, name, parent_id: parentId });
});

// Rename NPC category
router.post('/npcs/categories/:catId/rename', requireLogin, requireDM, express.json(), (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const cat = db.prepare('SELECT id FROM npc_categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  db.prepare('UPDATE npc_categories SET name = ? WHERE id = ?').run(name, cat.id);
  res.json({ success: true });
});

// Update NPC category parent
router.post('/npcs/categories/:catId/move', requireLogin, requireDM, express.json(), (req, res) => {
  const cat = db.prepare('SELECT id FROM npc_categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  const parentId = req.body.parent_id === null || req.body.parent_id === '' ? null : parseInt(req.body.parent_id) || null;
  // Prevent circular reference (can't be own parent or child of self)
  if (parentId === cat.id) return res.status(400).json({ error: 'Cannot be its own parent' });
  if (parentId) {
    const parent = db.prepare('SELECT id, parent_id FROM npc_categories WHERE id = ?').get(parentId);
    if (!parent) return res.status(400).json({ error: 'Parent not found' });
    if (parent.parent_id === cat.id) return res.status(400).json({ error: 'Circular reference' });
  }
  db.prepare('UPDATE npc_categories SET parent_id = ? WHERE id = ?').run(parentId, cat.id);
  res.json({ success: true });
});

// Delete NPC category (and all subcategories via CASCADE)
router.post('/npcs/categories/:catId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const cat = db.prepare('SELECT id FROM npc_categories WHERE id = ?').get(req.params.catId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  // Get all descendant category IDs (children, grandchildren, etc.)
  const allIds = [cat.id];
  const findChildren = (pid) => {
    const children = db.prepare('SELECT id FROM npc_categories WHERE parent_id = ?').all(pid);
    for (const c of children) { allIds.push(c.id); findChildren(c.id); }
  };
  findChildren(cat.id);
  // Clean up NPC assignments for all affected categories
  for (const id of allIds) {
    db.prepare('UPDATE npc_tokens SET category_id = NULL WHERE category_id = ?').run(id);
    try { db.prepare('DELETE FROM npc_token_categories WHERE category_id = ?').run(id); } catch (e) {}
  }
  // CASCADE will delete children
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
  const effectiveRole = res.locals.effectiveRole || req.user.role;
  const isDM = effectiveRole === 'dm' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';

  // Block player access to unpublished maps
  if (!map.published && !isDM) {
    return res.render('map-secret', { pageTitle: "It's a Secret!" });
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
           n.name AS npc_name, n.avatar AS npc_avatar, n.max_hp, n.source_type, n.source_key
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

  // Loot chests on this map
  let lootChests = db.prepare('SELECT * FROM map_loot_chests WHERE map_id = ?').all(map.id);
  if (!isDM) lootChests = lootChests.filter(c => !c.hidden);
  for (const chest of lootChests) {
    chest.items = db.prepare('SELECT id, name, description, quantity FROM chest_items WHERE chest_id = ?').all(chest.id);
  }

  // Saved encounters for DM
  const encounters = isDM ? db.prepare('SELECT id, name, monsters, updated_at FROM encounters WHERE created_by = ? ORDER BY updated_at DESC').all(req.user.id) : [];

  // Quests linked to this map
  let mapQuests = [];
  try {
    mapQuests = isDM
      ? db.prepare('SELECT id, title, status, description, difficulty, reward, pin_x, pin_y FROM quests WHERE linked_map_id = ?').all(map.id)
      : db.prepare('SELECT id, title, status, description, difficulty, reward, pin_x, pin_y FROM quests WHERE linked_map_id = ? AND revealed = 1').all(map.id);
  } catch (e) { /* table may not exist yet */ }

  let campaigns = [];
  try { campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all(); } catch (e) {}

  res.render('map', { map, locations, isDM, isAdmin, chain, children, tokens, npcTokens, lootChests, encounters, showPartyMarker, canAddChild, MARKER_TYPES, currentUserId: req.user.id, mapLinks, allPlayers, mapQuests, campaigns });
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

// Move quest pin on map
router.post('/:id/quests/:questId/pin', requireLogin, requireDM, express.json(), (req, res) => {
  const quest = db.prepare('SELECT id FROM quests WHERE id = ? AND linked_map_id = ?').get(req.params.questId, req.params.id);
  if (!quest) return res.status(404).json({ error: 'Quest not found on this map' });
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE quests SET pin_x = ?, pin_y = ? WHERE id = ?').run(px, py, quest.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'quest-move', questId: quest.id, x: px, y: py });
  res.json({ success: true });
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
  const eRole = res.locals.effectiveRole || req.user.role;
  const isDMUser = eRole === 'dm' || eRole === 'admin';
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
    t.conditions = db.prepare('SELECT id, condition_name, duration_rounds, duration_type FROM token_conditions WHERE token_id = ?').all(t.id);
  }
  // NPC tokens
  let npcTokens = db.prepare(`
    SELECT mnt.id, mnt.npc_token_id, mnt.x, mnt.y, mnt.scale, mnt.current_hp, mnt.hp_visible, mnt.hidden, mnt.alignment,
           n.name AS npc_name, n.avatar AS npc_avatar, n.max_hp, n.source_type, n.source_key
    FROM map_npc_tokens mnt
    JOIN npc_tokens n ON n.id = mnt.npc_token_id
    WHERE mnt.map_id = ?
  `).all(map.id);
  for (const nt of npcTokens) {
    if (nt.npc_avatar && !nt.npc_avatar.startsWith('/')) nt.npc_avatar = '/avatars/' + nt.npc_avatar;
    nt.conditions = db.prepare('SELECT id, condition_name, duration_rounds, duration_type FROM npc_token_conditions WHERE npc_map_token_id = ?').all(nt.id);
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
  // Loot chests on this map
  let lootChests = db.prepare('SELECT * FROM map_loot_chests WHERE map_id = ?').all(map.id);
  if (!isDMUser) {
    lootChests = lootChests.filter(c => !c.hidden);
  }
  for (const chest of lootChests) {
    chest.items = db.prepare('SELECT id, name, description, quantity FROM chest_items WHERE chest_id = ?').all(chest.id);
  }
  // Grid settings
  const gridMap = db.prepare('SELECT grid_enabled, grid_size, grid_offset_x, grid_offset_y, grid_color, grid_opacity, grid_type FROM maps WHERE id = ?').get(map.id);
  res.json({ tokens, npcTokens, lootChests, grid: gridMap || {} });
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
  const durRounds = req.body.duration_rounds != null ? parseInt(req.body.duration_rounds) : null;
  const durType = ['start_of_turn', 'end_of_turn'].includes(req.body.duration_type) ? req.body.duration_type : 'indefinite';
  try {
    const result = db.prepare('INSERT INTO token_conditions (token_id, condition_name, applied_by, duration_rounds, duration_type) VALUES (?, ?, ?, ?, ?)').run(token.id, name, req.user.id, durRounds, durType);
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

// ---- Grid Overlay ----

// Save grid settings (DM only)
router.post('/:id/grid', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const { grid_enabled, grid_size, grid_offset_x, grid_offset_y, grid_color, grid_opacity, grid_type } = req.body;
  db.prepare(`UPDATE maps SET grid_enabled=?, grid_size=?, grid_offset_x=?, grid_offset_y=?,
    grid_color=?, grid_opacity=?, grid_type=? WHERE id=?`)
    .run(grid_enabled ? 1 : 0, grid_size || 50, grid_offset_x || 0, grid_offset_y || 0,
      grid_color || '#ffffff', grid_opacity || 0.3, grid_type || 'square', map.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id) });
  res.json({ success: true });
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
  const eRole = res.locals.effectiveRole || req.user.role;
  const isDM = eRole === 'dm' || eRole === 'admin';
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

// Publish/Unpublish map
router.post('/:id/toggle-publish', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const newVal = map.published ? 0 : 1;
  db.prepare('UPDATE maps SET published = ? WHERE id = ?').run(newVal, map.id);
  res.json({ success: true, published: !!newVal });
});

// ---- NPC Token System (map-specific routes below /:id) ----

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

  // When NPC drops to 0 HP, create loot chest from linked loot items
  let chestData = null;
  if (newHp === 0 && nt.max_hp > 0) {
    const npcPos = db.prepare('SELECT x, y FROM map_npc_tokens WHERE id = ?').get(nt.id);
    const npcName = db.prepare('SELECT name FROM npc_tokens WHERE id = ?').get(nt.npc_token_id);
    const hiddenLoot = db.prepare('SELECT id, name, description, quantity, category FROM loot_items WHERE linked_npc_id = ? AND hidden = 1').all(nt.npc_token_id);
    if (hiddenLoot.length) {
      // Parse coins from "Coin Pouch" items, collect real items
      let pp = 0, gp = 0, sp = 0, cp = 0;
      const realItems = [];
      for (const item of hiddenLoot) {
        if (item.category === 'currency' && item.description) {
          const m = item.description.match(/(\d+)\s*PP/i); if (m) pp += parseInt(m[1]);
          const m2 = item.description.match(/(\d+)\s*GP/i); if (m2) gp += parseInt(m2[1]);
          const m3 = item.description.match(/(\d+)\s*SP/i); if (m3) sp += parseInt(m3[1]);
          const m4 = item.description.match(/(\d+)\s*CP/i); if (m4) cp += parseInt(m4[1]);
        } else {
          realItems.push(item);
        }
      }
      // Create chest at NPC position
      const chestResult = db.prepare(
        'INSERT INTO map_loot_chests (map_id, x, y, label, pp, gp, sp, cp, hidden, linked_npc_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
      ).run(parseInt(req.params.id), npcPos.x, npcPos.y, (npcName ? npcName.name + "'s Loot" : 'Loot'), pp, gp, sp, cp, npcName ? npcName.name : null, req.user.id);
      const chestId = chestResult.lastInsertRowid;
      for (const item of realItems) {
        db.prepare('INSERT INTO chest_items (chest_id, name, description, quantity) VALUES (?, ?, ?, ?)').run(chestId, item.name, item.description, item.quantity || 1);
      }
      // Reveal original loot items
      db.prepare('UPDATE loot_items SET hidden = 0 WHERE linked_npc_id = ? AND hidden = 1').run(nt.npc_token_id);
      chestData = { id: chestId, x: npcPos.x, y: npcPos.y, label: (npcName ? npcName.name + "'s Loot" : 'Loot'), pp, gp, sp, cp, items: realItems.map(i => ({ name: i.name, quantity: i.quantity })) };
    }
  }

  const mapId = parseInt(req.params.id);
  sse.broadcast('map-update', { mapId, action: 'npc-update', ntId: nt.id, chest: chestData || undefined });
  res.json({ success: true, current_hp: newHp, max_hp: nt.max_hp, chest: chestData });
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

// ---- Loot Chests on Map ----

// Create loot chest (DM only)
router.post('/:id/loot-chests', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const x = Math.max(0, Math.min(100, parseFloat(req.body.x) || 50));
  const y = Math.max(0, Math.min(100, parseFloat(req.body.y) || 50));
  const label = (req.body.label || 'Loot Chest').trim();
  const notes = (req.body.notes || '').trim() || null;
  const pp = Math.max(0, parseInt(req.body.pp) || 0);
  const gp = Math.max(0, parseInt(req.body.gp) || 0);
  const sp = Math.max(0, parseInt(req.body.sp) || 0);
  const cp = Math.max(0, parseInt(req.body.cp) || 0);
  const hidden = req.body.hidden ? 1 : 0;
  const result = db.prepare(
    'INSERT INTO map_loot_chests (map_id, x, y, label, notes, pp, gp, sp, cp, hidden, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(map.id, x, y, label, notes, pp, gp, sp, cp, hidden, req.user.id);
  const chestId = result.lastInsertRowid;
  // Add items
  const items = req.body.items || [];
  for (const item of items) {
    if (item.name && item.name.trim()) {
      db.prepare('INSERT INTO chest_items (chest_id, name, description, quantity) VALUES (?, ?, ?, ?)').run(chestId, item.name.trim(), item.description || null, item.quantity || 1);
    }
  }
  sse.broadcast('map-update', { mapId: map.id, action: 'chest-create', chestId });
  res.json({ success: true, id: chestId });
});

// Update loot chest (DM only)
router.post('/:id/loot-chests/:chestId/edit', requireLogin, requireDM, express.json(), (req, res) => {
  const chest = db.prepare('SELECT id FROM map_loot_chests WHERE id = ? AND map_id = ?').get(req.params.chestId, req.params.id);
  if (!chest) return res.status(404).json({ error: 'Chest not found' });
  const label = (req.body.label || 'Loot Chest').trim();
  const notes = (req.body.notes || '').trim() || null;
  const pp = Math.max(0, parseInt(req.body.pp) || 0);
  const gp = Math.max(0, parseInt(req.body.gp) || 0);
  const sp = Math.max(0, parseInt(req.body.sp) || 0);
  const cp = Math.max(0, parseInt(req.body.cp) || 0);
  db.prepare('UPDATE map_loot_chests SET label = ?, notes = ?, pp = ?, gp = ?, sp = ?, cp = ? WHERE id = ?')
    .run(label, notes, pp, gp, sp, cp, chest.id);
  // Replace items
  db.prepare('DELETE FROM chest_items WHERE chest_id = ?').run(chest.id);
  const items = req.body.items || [];
  for (const item of items) {
    if (item.name && item.name.trim()) {
      db.prepare('INSERT INTO chest_items (chest_id, name, description, quantity) VALUES (?, ?, ?, ?)').run(chest.id, item.name.trim(), item.description || null, item.quantity || 1);
    }
  }
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'chest-update', chestId: chest.id });
  res.json({ success: true });
});

// Toggle chest hidden (DM only)
router.post('/:id/loot-chests/:chestId/toggle-hidden', requireLogin, requireDM, express.json(), (req, res) => {
  const chest = db.prepare('SELECT id, hidden FROM map_loot_chests WHERE id = ? AND map_id = ?').get(req.params.chestId, req.params.id);
  if (!chest) return res.status(404).json({ error: 'Chest not found' });
  const newVal = chest.hidden ? 0 : 1;
  db.prepare('UPDATE map_loot_chests SET hidden = ? WHERE id = ?').run(newVal, chest.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'chest-update', chestId: chest.id });
  res.json({ success: true, hidden: newVal });
});

// Move chest (DM only)
router.post('/:id/loot-chests/:chestId/move', requireLogin, requireDM, express.json(), (req, res) => {
  const chest = db.prepare('SELECT id FROM map_loot_chests WHERE id = ? AND map_id = ?').get(req.params.chestId, req.params.id);
  if (!chest) return res.status(404).json({ error: 'Chest not found' });
  const x = Math.max(0, Math.min(100, parseFloat(req.body.x) || 50));
  const y = Math.max(0, Math.min(100, parseFloat(req.body.y) || 50));
  db.prepare('UPDATE map_loot_chests SET x = ?, y = ? WHERE id = ?').run(x, y, chest.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'chest-move', chestId: chest.id });
  res.json({ success: true });
});

// Collect chest loot → add to party treasury + party loot, remove chest
router.post('/:id/loot-chests/:chestId/collect', requireLogin, requireDM, express.json(), (req, res) => {
  const chest = db.prepare('SELECT * FROM map_loot_chests WHERE id = ? AND map_id = ?').get(req.params.chestId, req.params.id);
  if (!chest) return res.status(404).json({ error: 'Chest not found' });
  // Add coins to party treasury
  if (chest.pp || chest.gp || chest.sp || chest.cp) {
    db.prepare('UPDATE party_currency SET pp = pp + ?, gp = gp + ?, sp = sp + ?, cp = cp + ? WHERE id = 1')
      .run(chest.pp, chest.gp, chest.sp, chest.cp);
    db.prepare('INSERT INTO currency_log (target, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('party', chest.pp, chest.gp, chest.sp, chest.cp, 'Collected from chest: ' + chest.label, req.user.id);
  }
  // Add items to party loot
  const items = db.prepare('SELECT name, description, quantity FROM chest_items WHERE chest_id = ?').all(chest.id);
  for (const item of items) {
    db.prepare('INSERT INTO loot_items (name, description, quantity, category, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(item.name, item.description, item.quantity, 'item', req.user.id);
  }
  // Remove chest
  db.prepare('DELETE FROM map_loot_chests WHERE id = ?').run(chest.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'chest-delete', chestId: chest.id });
  res.json({ success: true, coinsCollected: !!(chest.pp || chest.gp || chest.sp || chest.cp), itemsCollected: items.length });
});

// Delete chest without collecting
router.post('/:id/loot-chests/:chestId/delete', requireLogin, requireDM, express.json(), (req, res) => {
  const chest = db.prepare('SELECT id FROM map_loot_chests WHERE id = ? AND map_id = ?').get(req.params.chestId, req.params.id);
  if (!chest) return res.status(404).json({ error: 'Chest not found' });
  db.prepare('DELETE FROM map_loot_chests WHERE id = ?').run(chest.id);
  sse.broadcast('map-update', { mapId: parseInt(req.params.id), action: 'chest-delete', chestId: chest.id });
  res.json({ success: true });
});

// Add condition to NPC map token
router.post('/:id/npc-tokens/:ntId/conditions', requireLogin, requireDM, express.json(), (req, res) => {
  const nt = db.prepare('SELECT id FROM map_npc_tokens WHERE id = ? AND map_id = ?').get(req.params.ntId, req.params.id);
  if (!nt) return res.status(404).json({ error: 'NPC token not found' });
  const name = (req.body.condition_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Condition name required' });
  const durRounds = req.body.duration_rounds != null ? parseInt(req.body.duration_rounds) : null;
  const durType = ['start_of_turn', 'end_of_turn'].includes(req.body.duration_type) ? req.body.duration_type : 'indefinite';
  try {
    const result = db.prepare('INSERT INTO npc_token_conditions (npc_map_token_id, condition_name, applied_by, duration_rounds, duration_type) VALUES (?, ?, ?, ?, ?)').run(nt.id, name, req.user.id, durRounds, durType);
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
// Get basic map info (for edit modal)
router.get('/:id/info', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT id, name, parent_id, campaign_id, map_type FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  res.json(map);
});

router.get('/:id/standalone-maps', requireLogin, requireDM, (req, res) => {
  const currentId = parseInt(req.params.id);
  const maps = db.prepare(`
    SELECT m.id, m.name, m.map_type FROM maps m
    WHERE m.id != ?
    ORDER BY m.name
  `).all(currentId);
  res.json({ maps });
});

// Link existing map as child (set parent_id) — creates pin on parent map
router.post('/:id/link-existing', requireLogin, requireDM, express.json(), (req, res) => {
  const parentId = parseInt(req.params.id);
  const source = db.prepare('SELECT id FROM maps WHERE id = ?').get(parentId);
  if (!source) return res.status(404).json({ error: 'Parent map not found' });

  const childId = parseInt(req.body.map_id);
  if (!childId) return res.status(400).json({ error: 'Map ID required' });
  if (childId === parentId) return res.status(400).json({ error: 'Cannot link to self' });
  const child = db.prepare('SELECT * FROM maps WHERE id = ?').get(childId);
  if (!child) return res.status(404).json({ error: 'Child map not found' });

  const px = Math.max(0, Math.min(100, parseFloat(req.body.pin_x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(req.body.pin_y) || 50));

  // Set the child's parent_id and pin position
  db.prepare('UPDATE maps SET parent_id = ?, pin_x = ?, pin_y = ? WHERE id = ?')
    .run(parentId, px, py, childId);

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

  // Inherit parent's campaign_id
  const parentMap = db.prepare('SELECT campaign_id FROM maps WHERE id = ?').get(parentId);
  const parentCampId = parentMap ? parentMap.campaign_id : null;
  db.prepare('UPDATE maps SET parent_id = ?, pin_x = 50, pin_y = 50, campaign_id = ? WHERE id = ?').run(parentId, parentCampId, map.id);
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
    // Combat cleanup
    try {
      db.prepare('DELETE FROM combat_participants WHERE encounter_id IN (SELECT id FROM combat_encounters WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM combat_encounters WHERE map_id = ?').run(mapId);
    } catch (e) { /* tables may not exist */ }
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

// ========================
// COMBAT TRACKER ROUTES
// ========================

// Helper: recalculate sort_order for all participants in an encounter
function recalcCombatOrder(encounterId) {
  const participants = db.prepare(
    'SELECT id, initiative, initiative_modifier FROM combat_participants WHERE encounter_id = ? ORDER BY initiative DESC, initiative_modifier DESC, id ASC'
  ).all(encounterId);
  const stmt = db.prepare('UPDATE combat_participants SET sort_order = ? WHERE id = ?');
  participants.forEach((p, i) => stmt.run(i, p.id));
}

// Helper: get participant display info
function getCombatParticipants(encounterId, isDMUser) {
  const rows = db.prepare(`
    SELECT cp.*,
      mt.character_id, mt.x AS token_x, mt.y AS token_y,
      c.name AS pc_name, c.avatar AS pc_avatar, c.user_id AS pc_user_id,
      mnt.npc_token_id, mnt.x AS npc_x, mnt.y AS npc_y, mnt.current_hp AS npc_current_hp, mnt.hp_visible AS npc_hp_visible, mnt.hidden AS npc_hidden, mnt.alignment AS npc_alignment,
      n.name AS npc_name, n.avatar AS npc_avatar, n.max_hp AS npc_max_hp
    FROM combat_participants cp
    LEFT JOIN map_tokens mt ON mt.id = cp.token_id
    LEFT JOIN characters c ON c.id = mt.character_id
    LEFT JOIN map_npc_tokens mnt ON mnt.id = cp.npc_map_token_id
    LEFT JOIN npc_tokens n ON n.id = mnt.npc_token_id
    WHERE cp.encounter_id = ?
    ORDER BY cp.sort_order ASC
  `).all(encounterId);

  return rows.map(r => {
    const isPC = r.token_id != null;
    const p = {
      id: r.id,
      type: isPC ? 'pc' : 'npc',
      initiative: r.initiative,
      initiative_modifier: r.initiative_modifier,
      sort_order: r.sort_order,
      legendary_actions_max: r.legendary_actions_max,
      legendary_actions_used: r.legendary_actions_used
    };
    if (isPC) {
      p.token_id = r.token_id;
      p.name = r.pc_name;
      p.avatar = r.pc_avatar && !r.pc_avatar.startsWith('/') ? '/avatars/' + r.pc_avatar : r.pc_avatar;
      p.user_id = r.pc_user_id;
      p.x = r.token_x;
      p.y = r.token_y;
      p.conditions = db.prepare('SELECT id, condition_name, duration_rounds, duration_type FROM token_conditions WHERE token_id = ?').all(r.token_id);
    } else {
      p.npc_map_token_id = r.npc_map_token_id;
      p.name = r.npc_name;
      p.avatar = r.npc_avatar && !r.npc_avatar.startsWith('/') ? '/avatars/' + r.npc_avatar : r.npc_avatar;
      p.current_hp = r.npc_current_hp;
      p.max_hp = r.npc_max_hp;
      p.hp_visible = r.npc_hp_visible;
      p.hidden = r.npc_hidden;
      p.alignment = r.npc_alignment;
      p.conditions = db.prepare('SELECT id, condition_name, duration_rounds, duration_type FROM npc_token_conditions WHERE npc_map_token_id = ?').all(r.npc_map_token_id);
    }
    return p;
  });
}

// Start combat encounter
router.post('/:id/combat/start', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(mapId);
  if (!map) return res.status(404).json({ error: 'Map not found' });

  // Check no existing combat
  const existing = db.prepare('SELECT id FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (existing) return res.status(409).json({ error: 'Combat already active on this map' });

  const participants = req.body.participants || [];
  if (participants.length === 0) return res.status(400).json({ error: 'No participants selected' });

  const visibility = ['full', 'order_only', 'hidden'].includes(req.body.visibility) ? req.body.visibility : 'full';

  const enc = db.prepare('INSERT INTO combat_encounters (map_id, visibility, started_by) VALUES (?, ?, ?)').run(mapId, visibility, req.user.id);
  const encounterId = enc.lastInsertRowid;

  const insertPart = db.prepare('INSERT INTO combat_participants (encounter_id, token_id, npc_map_token_id, initiative_modifier, legendary_actions_max) VALUES (?, ?, ?, ?, ?)');
  for (const p of participants) {
    let initMod = 0;
    let legMax = 0;
    if (p.type === 'npc') {
      // Lookup DEX modifier from monster data
      try {
        const npcToken = db.prepare(`
          SELECT n.source_type, n.source_key FROM npc_tokens n
          JOIN map_npc_tokens mnt ON mnt.npc_token_id = n.id
          WHERE mnt.id = ?
        `).get(p.tokenId);
        if (npcToken && npcToken.source_key) {
          const monster = db.prepare('SELECT raw_data FROM dnd_monsters WHERE LOWER(name) = ?').get(npcToken.source_key.toLowerCase());
          if (monster) {
            const d = JSON.parse(monster.raw_data);
            if (d.dex != null) initMod = Math.floor((d.dex - 10) / 2);
            // Check for legendary actions
            if (d.legendary_actions && Array.isArray(d.legendary_actions) && d.legendary_actions.length > 0) {
              legMax = d.legendary_desc ? parseInt((d.legendary_desc.match(/(\d+)\s*legendary/i) || [])[1]) || 3 : 3;
            }
          }
        }
      } catch (e) { /* ignore lookup errors */ }
      insertPart.run(encounterId, null, p.tokenId, initMod, legMax);
    } else {
      insertPart.run(encounterId, p.tokenId, null, 0, 0);
    }
  }

  recalcCombatOrder(encounterId);
  sse.broadcast('combat-update', { mapId, action: 'combat-start' });

  const encounter = db.prepare('SELECT * FROM combat_encounters WHERE id = ?').get(encounterId);
  const parts = getCombatParticipants(encounterId, true);
  res.json({ success: true, encounter, participants: parts });
});

// Set initiative values
router.post('/:id/combat/initiative', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT id FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const initiatives = req.body.initiatives || [];
  const stmt = db.prepare('UPDATE combat_participants SET initiative = ? WHERE id = ? AND encounter_id = ?');
  for (const i of initiatives) {
    stmt.run(parseInt(i.initiative) || 0, i.participantId, enc.id);
  }

  recalcCombatOrder(enc.id);
  db.prepare("UPDATE combat_encounters SET updated_at = datetime('now') WHERE id = ?").run(enc.id);
  sse.broadcast('combat-update', { mapId, action: 'initiative-update' });
  res.json({ success: true });
});

// Advance to next turn
router.post('/:id/combat/next-turn', requireLogin, requireDM, (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT * FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const parts = db.prepare('SELECT * FROM combat_participants WHERE encounter_id = ? ORDER BY sort_order ASC').all(enc.id);
  if (parts.length === 0) return res.status(400).json({ error: 'No participants' });

  const prevIndex = enc.current_turn_index;
  const prevPart = parts[prevIndex] || parts[0];

  // Decrement end-of-turn conditions for previous participant
  if (prevPart) {
    if (prevPart.token_id) {
      db.prepare("UPDATE token_conditions SET duration_rounds = duration_rounds - 1 WHERE token_id = ? AND duration_type = 'end_of_turn' AND duration_rounds IS NOT NULL").run(prevPart.token_id);
      db.prepare("DELETE FROM token_conditions WHERE token_id = ? AND duration_type = 'end_of_turn' AND duration_rounds IS NOT NULL AND duration_rounds <= 0").run(prevPart.token_id);
    } else if (prevPart.npc_map_token_id) {
      db.prepare("UPDATE npc_token_conditions SET duration_rounds = duration_rounds - 1 WHERE npc_map_token_id = ? AND duration_type = 'end_of_turn' AND duration_rounds IS NOT NULL").run(prevPart.npc_map_token_id);
      db.prepare("DELETE FROM npc_token_conditions WHERE npc_map_token_id = ? AND duration_type = 'end_of_turn' AND duration_rounds IS NOT NULL AND duration_rounds <= 0").run(prevPart.npc_map_token_id);
    }
  }

  let newIndex = prevIndex + 1;
  let newRound = enc.round_number;
  if (newIndex >= parts.length) {
    newIndex = 0;
    newRound++;
    // Reset legendary actions for all participants
    db.prepare('UPDATE combat_participants SET legendary_actions_used = 0 WHERE encounter_id = ?').run(enc.id);
  }

  // Decrement start-of-turn conditions for new current participant
  const newPart = parts[newIndex];
  if (newPart) {
    if (newPart.token_id) {
      db.prepare("UPDATE token_conditions SET duration_rounds = duration_rounds - 1 WHERE token_id = ? AND duration_type = 'start_of_turn' AND duration_rounds IS NOT NULL").run(newPart.token_id);
      db.prepare("DELETE FROM token_conditions WHERE token_id = ? AND duration_type = 'start_of_turn' AND duration_rounds IS NOT NULL AND duration_rounds <= 0").run(newPart.token_id);
    } else if (newPart.npc_map_token_id) {
      db.prepare("UPDATE npc_token_conditions SET duration_rounds = duration_rounds - 1 WHERE npc_map_token_id = ? AND duration_type = 'start_of_turn' AND duration_rounds IS NOT NULL").run(newPart.npc_map_token_id);
      db.prepare("DELETE FROM npc_token_conditions WHERE npc_map_token_id = ? AND duration_type = 'start_of_turn' AND duration_rounds IS NOT NULL AND duration_rounds <= 0").run(newPart.npc_map_token_id);
    }
  }

  db.prepare("UPDATE combat_encounters SET current_turn_index = ?, round_number = ?, updated_at = datetime('now') WHERE id = ?").run(newIndex, newRound, enc.id);
  sse.broadcast('combat-update', { mapId, action: 'turn-change' });
  sse.broadcast('map-update', { mapId, action: 'token-update' }); // refresh conditions on map
  res.json({ success: true, round: newRound, turnIndex: newIndex });
});

// Go back one turn
router.post('/:id/combat/prev-turn', requireLogin, requireDM, (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT * FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const parts = db.prepare('SELECT * FROM combat_participants WHERE encounter_id = ? ORDER BY sort_order ASC').all(enc.id);
  if (parts.length === 0) return res.status(400).json({ error: 'No participants' });

  let newIndex = enc.current_turn_index - 1;
  let newRound = enc.round_number;
  if (newIndex < 0) {
    newIndex = parts.length - 1;
    newRound = Math.max(1, newRound - 1);
  }

  db.prepare("UPDATE combat_encounters SET current_turn_index = ?, round_number = ?, updated_at = datetime('now') WHERE id = ?").run(newIndex, newRound, enc.id);
  sse.broadcast('combat-update', { mapId, action: 'turn-change' });
  res.json({ success: true, round: newRound, turnIndex: newIndex });
});

// Get current combat state
router.get('/:id/combat/state', requireLogin, (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT * FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.json({ active: false });

  const eRole = res.locals.effectiveRole || req.user.role;
  const isDMUser = eRole === 'dm' || eRole === 'admin';

  // If hidden from players, return minimal
  if (!isDMUser && enc.visibility === 'hidden') {
    return res.json({ active: false });
  }

  const parts = getCombatParticipants(enc.id, isDMUser);

  // Filter for player visibility
  let filteredParts = parts;
  if (!isDMUser && enc.visibility === 'order_only') {
    filteredParts = parts.map(p => ({
      id: p.id,
      type: p.type,
      name: p.type === 'npc' && p.hidden ? '???' : p.name,
      avatar: p.type === 'npc' && p.hidden ? null : p.avatar,
      initiative: p.initiative,
      sort_order: p.sort_order
    }));
  } else if (!isDMUser) {
    // full visibility — but hide hidden NPCs' details
    filteredParts = parts.map(p => {
      if (p.type === 'npc' && p.hidden) {
        return { ...p, name: '???', avatar: null, current_hp: undefined, max_hp: undefined, conditions: [] };
      }
      // Hide HP for NPCs where hp_visible is 0
      if (p.type === 'npc' && !p.hp_visible) {
        return { ...p, current_hp: undefined, max_hp: undefined };
      }
      return p;
    });
  }

  res.json({
    active: true,
    encounter: {
      id: enc.id,
      round_number: enc.round_number,
      current_turn_index: enc.current_turn_index,
      visibility: isDMUser ? enc.visibility : undefined
    },
    participants: filteredParts
  });
});

// Add participant mid-combat
router.post('/:id/combat/add-participant', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT id, current_turn_index FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const { type, tokenId, initiative } = req.body;
  const init = parseInt(initiative) || 0;
  let initMod = 0;
  let legMax = 0;

  if (type === 'npc') {
    try {
      const npcToken = db.prepare('SELECT n.source_key FROM npc_tokens n JOIN map_npc_tokens mnt ON mnt.npc_token_id = n.id WHERE mnt.id = ?').get(tokenId);
      if (npcToken && npcToken.source_key) {
        const monster = db.prepare('SELECT raw_data FROM dnd_monsters WHERE LOWER(name) = ?').get(npcToken.source_key.toLowerCase());
        if (monster) {
          const d = JSON.parse(monster.raw_data);
          if (d.dex != null) initMod = Math.floor((d.dex - 10) / 2);
          if (d.legendary_actions && Array.isArray(d.legendary_actions) && d.legendary_actions.length > 0) {
            legMax = d.legendary_desc ? parseInt((d.legendary_desc.match(/(\d+)\s*legendary/i) || [])[1]) || 3 : 3;
          }
        }
      }
    } catch (e) { /* ignore */ }
    db.prepare('INSERT INTO combat_participants (encounter_id, npc_map_token_id, initiative, initiative_modifier, legendary_actions_max) VALUES (?, ?, ?, ?, ?)').run(enc.id, tokenId, init, initMod, legMax);
  } else {
    db.prepare('INSERT INTO combat_participants (encounter_id, token_id, initiative) VALUES (?, ?, ?)').run(enc.id, tokenId, init);
  }

  recalcCombatOrder(enc.id);
  db.prepare("UPDATE combat_encounters SET updated_at = datetime('now') WHERE id = ?").run(enc.id);
  sse.broadcast('combat-update', { mapId, action: 'participant-change' });
  res.json({ success: true });
});

// Remove participant mid-combat
router.post('/:id/combat/remove-participant', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT * FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const { participantId } = req.body;
  const part = db.prepare('SELECT * FROM combat_participants WHERE id = ? AND encounter_id = ?').get(participantId, enc.id);
  if (!part) return res.status(404).json({ error: 'Participant not found' });

  db.prepare('DELETE FROM combat_participants WHERE id = ?').run(participantId);
  recalcCombatOrder(enc.id);

  // Adjust current_turn_index if needed
  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM combat_participants WHERE encounter_id = ?').get(enc.id);
  let newIndex = enc.current_turn_index;
  if (remaining.cnt === 0) {
    newIndex = 0;
  } else if (part.sort_order < enc.current_turn_index) {
    newIndex = Math.max(0, enc.current_turn_index - 1);
  } else if (newIndex >= remaining.cnt) {
    newIndex = remaining.cnt - 1;
  }
  db.prepare("UPDATE combat_encounters SET current_turn_index = ?, updated_at = datetime('now') WHERE id = ?").run(newIndex, enc.id);

  sse.broadcast('combat-update', { mapId, action: 'participant-change' });
  res.json({ success: true });
});

// End combat encounter
router.post('/:id/combat/end', requireLogin, requireDM, (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT id FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  // HP/conditions are already persisted in real-time, just clean up combat data
  db.prepare('DELETE FROM combat_participants WHERE encounter_id = ?').run(enc.id);
  db.prepare('DELETE FROM combat_encounters WHERE id = ?').run(enc.id);

  sse.broadcast('combat-update', { mapId, action: 'combat-end' });
  res.json({ success: true });
});

// Update legendary action counter
router.post('/:id/combat/legendary', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT id FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const { participantId, action: legAction, used } = req.body;
  const part = db.prepare('SELECT * FROM combat_participants WHERE id = ? AND encounter_id = ?').get(participantId, enc.id);
  if (!part) return res.status(404).json({ error: 'Participant not found' });

  let newUsed = part.legendary_actions_used;
  if (legAction === 'use') {
    newUsed = Math.min(part.legendary_actions_max, newUsed + 1);
  } else if (legAction === 'reset') {
    newUsed = 0;
  } else if (used != null) {
    newUsed = Math.max(0, Math.min(part.legendary_actions_max, parseInt(used) || 0));
  }

  db.prepare('UPDATE combat_participants SET legendary_actions_used = ? WHERE id = ?').run(newUsed, part.id);
  sse.broadcast('combat-update', { mapId, action: 'turn-change' });
  res.json({ success: true, legendary_actions_used: newUsed });
});

// Change visibility setting
router.post('/:id/combat/visibility', requireLogin, requireDM, express.json(), (req, res) => {
  const mapId = parseInt(req.params.id);
  const enc = db.prepare('SELECT id FROM combat_encounters WHERE map_id = ?').get(mapId);
  if (!enc) return res.status(404).json({ error: 'No active combat' });

  const visibility = ['full', 'order_only', 'hidden'].includes(req.body.visibility) ? req.body.visibility : 'full';
  db.prepare("UPDATE combat_encounters SET visibility = ?, updated_at = datetime('now') WHERE id = ?").run(visibility, enc.id);

  sse.broadcast('combat-update', { mapId, action: 'turn-change' });
  res.json({ success: true, visibility });
});

module.exports = router;
