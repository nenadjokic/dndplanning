const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const sse = require('../helpers/sse');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const router = express.Router();

const npcAvatarDir = path.join(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(npcAvatarDir)) fs.mkdirSync(npcAvatarDir, { recursive: true });

function downloadAvatarUrl(url) {
  return new Promise((resolve) => {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return resolve(null);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 8000 }, (resp) => {
      if (resp.statusCode !== 200) return resolve(null);
      const ct = resp.headers['content-type'] || '';
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' };
      const ext = extMap[ct.split(';')[0].trim()] || '.png';
      const fname = 'npc-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
      const fpath = path.join(npcAvatarDir, fname);
      const ws = fs.createWriteStream(fpath);
      resp.pipe(ws);
      ws.on('finish', () => resolve(fname));
      ws.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Render encounter builder page
router.get('/', requireLogin, requireDM, (req, res) => {
  const encounters = db.prepare('SELECT * FROM encounters WHERE created_by = ? ORDER BY updated_at DESC').all(req.user.id);
  const maps = db.prepare('SELECT id, name FROM maps ORDER BY name').all();
  res.render('encounters', { encounters, maps });
});

// Save new encounter
router.post('/', requireLogin, requireDM, (req, res) => {
  const { name, description, party_size, party_levels, monsters, template } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Encounter name is required' });
  }

  const result = db.prepare(`
    INSERT INTO encounters (name, description, party_size, party_levels, monsters, template, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name.trim(),
    description || null,
    parseInt(party_size, 10) || 4,
    party_levels || '[]',
    monsters || '[]',
    template || null,
    req.user.id
  );

  res.json({ success: true, id: result.lastInsertRowid });
});

// Update encounter
router.post('/:id', requireLogin, requireDM, (req, res) => {
  const encounter = db.prepare('SELECT * FROM encounters WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

  const { name, description, party_size, party_levels, monsters, template } = req.body;

  db.prepare(`
    UPDATE encounters SET name = ?, description = ?, party_size = ?, party_levels = ?, monsters = ?, template = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    (name && name.trim()) || encounter.name,
    description !== undefined ? description : encounter.description,
    parseInt(party_size, 10) || encounter.party_size,
    party_levels || encounter.party_levels,
    monsters || encounter.monsters,
    template !== undefined ? template : encounter.template,
    encounter.id
  );

  res.json({ success: true });
});

// Delete encounter
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const encounter = db.prepare('SELECT * FROM encounters WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

  db.prepare('DELETE FROM encounters WHERE id = ?').run(encounter.id);
  res.json({ success: true });
});

// Add encounter monsters to a map as NPC tokens
router.post('/:id/add-to-map', requireLogin, requireDM, async (req, res) => {
  const encounter = db.prepare('SELECT * FROM encounters WHERE id = ? AND created_by = ?').get(req.params.id, req.user.id);
  if (!encounter) return res.status(404).json({ error: 'Encounter not found' });

  const { map_id } = req.body;
  if (!map_id) return res.status(400).json({ error: 'Map ID required' });

  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(map_id);
  if (!map) return res.status(404).json({ error: 'Map not found' });

  const monsters = JSON.parse(encounter.monsters || '[]');
  if (monsters.length === 0) return res.status(400).json({ error: 'No monsters in encounter' });

  let placed = 0;
  const gridCols = Math.ceil(Math.sqrt(monsters.reduce((sum, m) => sum + (m.count || 1), 0)));
  let gridIndex = 0;

  for (const monster of monsters) {
    const count = monster.count || 1;

    // Check if NPC token with this source_key already exists
    let npcToken = null;
    if (monster.source_key) {
      npcToken = db.prepare('SELECT * FROM npc_tokens WHERE source_key = ? AND created_by = ?').get(monster.source_key, req.user.id);
    }

    if (!npcToken) {
      // Try to get HP from monster details
      let maxHp = 0;
      try {
        const monsterData = db.prepare('SELECT * FROM dnd_monsters WHERE LOWER(name) = ?').get(monster.name.toLowerCase());
        if (monsterData) {
          const raw = JSON.parse(monsterData.raw_data);
          maxHp = raw.hp ? (raw.hp.average || 0) : 0;
        }
      } catch (e) { /* ignore */ }

      // Download avatar
      let avatarFile = null;
      if (monster.image_url) {
        avatarFile = await downloadAvatarUrl(monster.image_url);
      }

      const result = db.prepare(`
        INSERT INTO npc_tokens (name, avatar, source_type, source_key, max_hp, current_hp, created_by)
        VALUES (?, ?, 'bestiary', ?, ?, ?, ?)
      `).run(monster.name, avatarFile, monster.source_key || null, maxHp, maxHp, req.user.id);
      npcToken = { id: result.lastInsertRowid, max_hp: maxHp };
    }

    // Place copies on the map in a grid pattern
    for (let i = 0; i < count; i++) {
      const col = gridIndex % gridCols;
      const row = Math.floor(gridIndex / gridCols);
      const x = 30 + col * 5;
      const y = 30 + row * 5;

      db.prepare(`
        INSERT INTO map_npc_tokens (map_id, npc_token_id, x, y, current_hp, hp_visible, placed_by, alignment)
        VALUES (?, ?, ?, ?, ?, 1, ?, 'hostile')
      `).run(map.id, npcToken.id, x, y, npcToken.max_hp || 0, req.user.id);

      placed++;
      gridIndex++;
    }
  }

  // Broadcast map update
  sse.broadcast('map-update', { mapId: map.id });

  res.json({ success: true, placed });
});

module.exports = router;
