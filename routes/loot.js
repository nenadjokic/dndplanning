const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const sse = require('../helpers/sse');
const router = express.Router();

// Main loot page
router.get('/', requireLogin, (req, res) => {
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const campaignFilter = req.query.campaign_id;

  // Build WHERE conditions
  const conditions = [];
  const params = [];
  if (!isDM) conditions.push('l.hidden = 0');
  if (campaignFilter === 'unsorted') {
    conditions.push('l.campaign_id IS NULL');
  } else if (campaignFilter && campaignFilter !== '') {
    conditions.push('l.campaign_id = ?');
    params.push(parseInt(campaignFilter, 10));
  }
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const itemsQuery = `SELECT l.*, u.username as holder_name, s.title as session_title, c.username as creator_name,
       ch.name as attuned_char_name, ch.user_id as attuned_owner_id,
       camp.name as campaign_name
     FROM loot_items l
     LEFT JOIN users u ON l.held_by = u.id
     LEFT JOIN sessions s ON l.session_id = s.id
     LEFT JOIN users c ON l.created_by = c.id
     LEFT JOIN characters ch ON l.attuned_to = ch.id
     LEFT JOIN campaigns camp ON l.campaign_id = camp.id
     ${whereClause}
     ORDER BY CASE l.category WHEN 'quest' THEN 0 ELSE 1 END, l.category, l.name`;

  const items = db.prepare(itemsQuery).all(...params);
  const players = db.prepare("SELECT id, username FROM users ORDER BY username").all();
  const sessions = db.prepare("SELECT id, title FROM sessions ORDER BY created_at DESC LIMIT 20").all();
  const characters = db.prepare("SELECT c.id, c.name, c.user_id, u.username FROM characters c JOIN users u ON c.user_id = u.id ORDER BY u.username, c.name").all();

  // Currency
  const partyCurrency = db.prepare('SELECT * FROM party_currency WHERE id = 1').get() || { pp: 0, gp: 0, sp: 0, cp: 0 };
  const myCurrency = db.prepare('SELECT * FROM character_currency WHERE user_id = ?').get(req.user.id) || { pp: 0, gp: 0, sp: 0, cp: 0 };
  const allWallets = isDM ? db.prepare('SELECT cc.*, u.username FROM character_currency cc JOIN users u ON cc.user_id = u.id ORDER BY u.username').all() : [];
  const currencyLog = db.prepare('SELECT cl.*, u.username as actor_name, u2.username as target_name FROM currency_log cl JOIN users u ON cl.created_by = u.id LEFT JOIN users u2 ON cl.user_id = u2.id ORDER BY cl.created_at DESC LIMIT 20').all();

  // Attunement counts per character
  const attunementCounts = {};
  for (const item of items) {
    if (item.attuned_to) {
      attunementCounts[item.attuned_to] = (attunementCounts[item.attuned_to] || 0) + 1;
    }
  }

  let campaigns = [];
  try { campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all(); } catch (e) {}
  const activeCampaignId = campaignFilter || null;

  res.render('loot', { items, players, sessions, characters, isDM, partyCurrency, myCurrency, allWallets, currencyLog, attunementCounts, campaigns, activeCampaignId });
});

// Add item (DM only)
router.post('/', requireLogin, requireDM, (req, res) => {
  const { name, description, quantity, category, held_by, session_id, hidden, vault_item_name, rarity, campaign_id } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Item name is required.');
    return res.redirect('/loot');
  }
  const validCategories = ['item', 'weapon', 'armor', 'potion', 'quest', 'gold', 'scroll', 'wondrous'];
  const cat = validCategories.includes(category) ? category : 'item';
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const holder = held_by ? parseInt(held_by, 10) : null;
  const sessId = session_id ? parseInt(session_id, 10) : null;
  const isHidden = hidden === 'on' || hidden === '1' ? 1 : 0;
  const validRarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
  const itemRarity = validRarities.includes(rarity) ? rarity : null;

  const campId = campaign_id ? parseInt(campaign_id, 10) : null;

  db.prepare(`INSERT INTO loot_items (name, description, quantity, category, held_by, session_id, created_by, hidden, vault_item_name, rarity, campaign_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name.trim(), (description && description.trim()) || null, qty, cat, holder, sessId, req.user.id, isHidden, (vault_item_name && vault_item_name.trim()) || null, itemRarity, campId);

  if (!isHidden) {
    sse.broadcast('new-loot', { username: req.user.username, itemName: name.trim(), quantity: qty });
  }

  req.flash('success', isHidden ? 'Item staged (hidden from players).' : 'Loot added to the party inventory!');
  res.redirect('/loot');
});

// Assign/transfer item
router.post('/:id/assign', requireLogin, (req, res) => {
  const { held_by } = req.body;
  const item = db.prepare('SELECT * FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  // Players can only transfer items they hold
  if (!isDM && item.held_by !== req.user.id) {
    req.flash('error', 'You can only transfer items you hold.');
    return res.redirect('/loot');
  }
  const holder = held_by ? parseInt(held_by, 10) : null;

  // Break attunement if changing owner
  if (item.attuned_to && holder !== item.held_by) {
    db.prepare('UPDATE loot_items SET held_by = ?, attuned_to = NULL WHERE id = ?').run(holder, item.id);
    req.flash('success', 'Item transferred. Attunement broken.');
  } else {
    db.prepare('UPDATE loot_items SET held_by = ? WHERE id = ?').run(holder, item.id);
    req.flash('success', 'Item reassigned.');
  }
  res.redirect('/loot');
});

// Toggle attunement
router.post('/:id/attune', requireLogin, (req, res) => {
  const { character_id } = req.body;
  const item = db.prepare('SELECT * FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  if (!isDM && item.held_by !== req.user.id) {
    req.flash('error', 'You can only attune items you hold.');
    return res.redirect('/loot');
  }

  if (item.attuned_to) {
    // Un-attune
    db.prepare('UPDATE loot_items SET attuned_to = NULL WHERE id = ?').run(item.id);
    req.flash('success', 'Attunement broken.');
  } else {
    // Attune — check max 3
    const charId = parseInt(character_id, 10);
    if (!charId) {
      req.flash('error', 'Select a character to attune.');
      return res.redirect('/loot');
    }
    const count = db.prepare('SELECT COUNT(*) as c FROM loot_items WHERE attuned_to IN (SELECT id FROM characters WHERE id = ?)').get(charId);
    if (count && count.c >= 3) {
      req.flash('error', 'Maximum 3 attuned items per character.');
      return res.redirect('/loot');
    }
    db.prepare('UPDATE loot_items SET attuned_to = ? WHERE id = ?').run(charId, item.id);
    req.flash('success', 'Item attuned!');
  }
  res.redirect('/loot');
});

// Reveal hidden item (DM)
router.post('/:id/reveal', requireLogin, requireDM, (req, res) => {
  const item = db.prepare('SELECT * FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  db.prepare('UPDATE loot_items SET hidden = 0 WHERE id = ?').run(item.id);
  sse.broadcast('new-loot', { username: 'DM', itemName: item.name, quantity: item.quantity });
  req.flash('success', 'Item revealed to players!');
  res.redirect('/loot');
});

// Edit item (DM)
router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const { name, description, quantity, category, vault_item_name, rarity, campaign_id } = req.body;
  const item = db.prepare('SELECT id FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  if (!name || !name.trim()) {
    req.flash('error', 'Item name is required.');
    return res.redirect('/loot');
  }
  const validCategories = ['item', 'weapon', 'armor', 'potion', 'quest', 'gold', 'scroll', 'wondrous'];
  const cat = validCategories.includes(category) ? category : 'item';
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const validRarities = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
  const itemRarity = validRarities.includes(rarity) ? rarity : null;
  const campId = campaign_id ? parseInt(campaign_id, 10) : null;

  db.prepare('UPDATE loot_items SET name = ?, description = ?, quantity = ?, category = ?, vault_item_name = ?, rarity = ?, campaign_id = ? WHERE id = ?')
    .run(name.trim(), (description && description.trim()) || null, qty, cat, (vault_item_name && vault_item_name.trim()) || null, itemRarity, campId, item.id);

  req.flash('success', 'Item updated.');
  res.redirect('/loot');
});

// Delete item (DM)
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const item = db.prepare('SELECT id FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  db.prepare('DELETE FROM loot_items WHERE id = ?').run(item.id);
  req.flash('success', 'Item removed from inventory.');
  res.redirect('/loot');
});

// Update currency
router.post('/currency', requireLogin, (req, res) => {
  const { target, pp, gp, sp, cp, reason } = req.body;
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  const ppVal = parseInt(pp, 10) || 0;
  const gpVal = parseInt(gp, 10) || 0;
  const spVal = parseInt(sp, 10) || 0;
  const cpVal = parseInt(cp, 10) || 0;

  if (target === 'party' && isDM) {
    const current = db.prepare('SELECT * FROM party_currency WHERE id = 1').get();
    const ppDiff = ppVal - (current ? current.pp : 0);
    const gpDiff = gpVal - (current ? current.gp : 0);
    const spDiff = spVal - (current ? current.sp : 0);
    const cpDiff = cpVal - (current ? current.cp : 0);

    db.prepare('UPDATE party_currency SET pp = ?, gp = ?, sp = ?, cp = ? WHERE id = 1').run(ppVal, gpVal, spVal, cpVal);

    if (ppDiff || gpDiff || spDiff || cpDiff) {
      db.prepare('INSERT INTO currency_log (target, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('party', ppDiff, gpDiff, spDiff, cpDiff, (reason && reason.trim()) || null, req.user.id);
    }
  } else {
    // Player updates own wallet
    const current = db.prepare('SELECT * FROM character_currency WHERE user_id = ?').get(req.user.id);
    if (current) {
      const ppDiff = ppVal - current.pp;
      const gpDiff = gpVal - current.gp;
      const spDiff = spVal - current.sp;
      const cpDiff = cpVal - current.cp;
      db.prepare('UPDATE character_currency SET pp = ?, gp = ?, sp = ?, cp = ? WHERE user_id = ?').run(ppVal, gpVal, spVal, cpVal, req.user.id);
      if (ppDiff || gpDiff || spDiff || cpDiff) {
        db.prepare('INSERT INTO currency_log (target, user_id, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('personal', req.user.id, ppDiff, gpDiff, spDiff, cpDiff, (reason && reason.trim()) || null, req.user.id);
      }
    } else {
      db.prepare('INSERT INTO character_currency (user_id, pp, gp, sp, cp) VALUES (?, ?, ?, ?, ?)').run(req.user.id, ppVal, gpVal, spVal, cpVal);
      if (ppVal || gpVal || spVal || cpVal) {
        db.prepare('INSERT INTO currency_log (target, user_id, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run('personal', req.user.id, ppVal, gpVal, spVal, cpVal, (reason && reason.trim()) || 'Initial wallet', req.user.id);
      }
    }
  }

  req.flash('success', 'Currency updated.');
  res.redirect('/loot');
});

// Split party gold (DM)
router.post('/currency/split', requireLogin, requireDM, (req, res) => {
  const party = db.prepare('SELECT * FROM party_currency WHERE id = 1').get();
  if (!party) {
    req.flash('error', 'No party treasury found.');
    return res.redirect('/loot');
  }

  const players = db.prepare("SELECT id FROM users WHERE role != 'dm' AND role != 'admin'").all();
  const playerCount = players.length;
  if (playerCount === 0) {
    req.flash('error', 'No players to split among.');
    return res.redirect('/loot');
  }

  // Convert all to CP
  const totalCp = (party.pp * 1000) + (party.gp * 100) + (party.sp * 10) + party.cp;
  if (totalCp === 0) {
    req.flash('error', 'Treasury is empty.');
    return res.redirect('/loot');
  }

  const perPlayerCp = Math.floor(totalCp / playerCount);
  const remainderCp = totalCp - (perPlayerCp * playerCount);

  // Convert per-player share back
  let rem = perPlayerCp;
  const sharePp = Math.floor(rem / 1000); rem -= sharePp * 1000;
  const shareGp = Math.floor(rem / 100); rem -= shareGp * 100;
  const shareSp = Math.floor(rem / 10); rem -= shareSp * 10;
  const shareCpFinal = rem;

  // Convert remainder back for treasury
  let remR = remainderCp;
  const remPp = Math.floor(remR / 1000); remR -= remPp * 1000;
  const remGp = Math.floor(remR / 100); remR -= remGp * 100;
  const remSp = Math.floor(remR / 10); remR -= remSp * 10;
  const remCpFinal = remR;

  // Give each player their share
  for (const p of players) {
    const wallet = db.prepare('SELECT * FROM character_currency WHERE user_id = ?').get(p.id);
    if (wallet) {
      db.prepare('UPDATE character_currency SET pp = pp + ?, gp = gp + ?, sp = sp + ?, cp = cp + ? WHERE user_id = ?')
        .run(sharePp, shareGp, shareSp, shareCpFinal, p.id);
    } else {
      db.prepare('INSERT INTO character_currency (user_id, pp, gp, sp, cp) VALUES (?, ?, ?, ?, ?)')
        .run(p.id, sharePp, shareGp, shareSp, shareCpFinal);
    }
    db.prepare('INSERT INTO currency_log (target, user_id, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('personal', p.id, sharePp, shareGp, shareSp, shareCpFinal, 'Party gold split', req.user.id);
  }

  // Update treasury to remainder
  db.prepare('UPDATE party_currency SET pp = ?, gp = ?, sp = ?, cp = ? WHERE id = 1')
    .run(remPp, remGp, remSp, remCpFinal);

  db.prepare('INSERT INTO currency_log (target, pp_change, gp_change, sp_change, cp_change, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('party', -(party.pp - remPp), -(party.gp - remGp), -(party.sp - remSp), -(party.cp - remCpFinal), `Split among ${playerCount} players`, req.user.id);

  req.flash('success', `Gold split among ${playerCount} players! Remainder stays in treasury.`);
  res.redirect('/loot');
});

// Vault autocomplete API
router.get('/api/vault-items', requireLogin, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json([]);
  try {
    const vault = require('../helpers/vault-local');
    const items = vault.getItemsList(q);
    res.json(items.slice(0, 15));
  } catch (e) {
    res.json([]);
  }
});

// Vault item details API
router.get('/api/vault-item-details', requireLogin, (req, res) => {
  const name = req.query.name || '';
  if (!name) return res.json({ error: 'No name' });
  try {
    const vault = require('../helpers/vault-local');
    const details = vault.getItemDetails(name);
    if (!details) return res.json({ error: 'Not found' });
    res.json(details);
  } catch (e) {
    res.json({ error: 'Vault not available' });
  }
});

module.exports = router;
