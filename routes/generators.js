const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

// Generator page (DM only)
router.get('/', requireLogin, requireDM, (req, res) => {
  const npcs = db.prepare('SELECT id, name FROM npc_tokens ORDER BY name').all();
  res.render('generators', { npcs });
});

// Save generated NPC to npc_tokens library
router.post('/save-npc', requireLogin, requireDM, (req, res) => {
  const { name, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const result = db.prepare('INSERT INTO npc_tokens (name, notes, source_type, created_by) VALUES (?, ?, ?, ?)')
    .run(name.trim(), (notes && notes.trim()) || null, 'generator', req.user.id);
  res.json({ success: true, id: result.lastInsertRowid });
});

// Add rolled loot to party loot
router.post('/add-loot', requireLogin, requireDM, (req, res) => {
  const { items, coins } = req.body;
  let added = 0;
  if (items && Array.isArray(items)) {
    for (const item of items) {
      if (item.name && item.name.trim()) {
        db.prepare('INSERT INTO loot_items (name, description, quantity, category, created_by) VALUES (?, ?, ?, ?, ?)')
          .run(item.name.trim(), item.description || null, item.quantity || 1, item.category || 'item', req.user.id);
        added++;
      }
    }
  }
  // Add coins to party treasury
  let coinsAdded = false;
  if (coins && (coins.cp || coins.sp || coins.gp || coins.pp)) {
    const cp = Math.max(0, parseInt(coins.cp) || 0);
    const sp = Math.max(0, parseInt(coins.sp) || 0);
    const gp = Math.max(0, parseInt(coins.gp) || 0);
    const pp = Math.max(0, parseInt(coins.pp) || 0);
    if (cp || sp || gp || pp) {
      db.prepare('UPDATE party_currency SET pp = pp + ?, gp = gp + ?, sp = sp + ?, cp = cp + ? WHERE id = 1')
        .run(pp, gp, sp, cp);
      db.prepare('INSERT INTO currency_log (target, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('party', pp, gp, sp, cp, 'Loot roll (generator)', req.user.id);
      coinsAdded = true;
    }
  }
  res.json({ success: true, added, coinsAdded });
});

// Add rolled loot assigned to an NPC (hidden until NPC defeated)
router.post('/add-npc-loot', requireLogin, requireDM, (req, res) => {
  const { items, coins, npcId } = req.body;
  if (!npcId) return res.status(400).json({ error: 'NPC ID required' });
  const npc = db.prepare('SELECT id FROM npc_tokens WHERE id = ?').get(npcId);
  if (!npc) return res.status(404).json({ error: 'NPC not found' });

  let added = 0;
  if (items && Array.isArray(items)) {
    for (const item of items) {
      if (item.name && item.name.trim()) {
        db.prepare('INSERT INTO loot_items (name, description, quantity, category, hidden, linked_npc_id, created_by) VALUES (?, ?, ?, ?, 1, ?, ?)')
          .run(item.name.trim(), item.description || null, item.quantity || 1, item.category || 'item', npcId, req.user.id);
        added++;
      }
    }
  }
  // Store coins as a special loot item (for easy tracking)
  let coinsAdded = false;
  if (coins && (coins.cp || coins.sp || coins.gp || coins.pp)) {
    const parts = [];
    if (coins.pp) parts.push(coins.pp + ' PP');
    if (coins.gp) parts.push(coins.gp + ' GP');
    if (coins.sp) parts.push(coins.sp + ' SP');
    if (coins.cp) parts.push(coins.cp + ' CP');
    if (parts.length) {
      db.prepare('INSERT INTO loot_items (name, description, quantity, category, hidden, linked_npc_id, created_by) VALUES (?, ?, 1, ?, 1, ?, ?)')
        .run('Coin Pouch', parts.join(', '), 'currency', npcId, req.user.id);
      coinsAdded = true;
      added++;
    }
  }
  res.json({ success: true, added, coinsAdded });
});

module.exports = router;
