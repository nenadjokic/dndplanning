const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const items = db.prepare(`
    SELECT l.*, u.username as holder_name, s.title as session_title, c.username as creator_name
    FROM loot_items l
    LEFT JOIN users u ON l.held_by = u.id
    LEFT JOIN sessions s ON l.session_id = s.id
    LEFT JOIN users c ON l.created_by = c.id
    ORDER BY
      CASE l.category WHEN 'quest' THEN 0 ELSE 1 END,
      l.category, l.name
  `).all();

  const players = db.prepare("SELECT id, username FROM users ORDER BY username").all();
  const sessions = db.prepare("SELECT id, title FROM sessions ORDER BY created_at DESC LIMIT 20").all();
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  res.render('loot', { items, players, sessions, isDM });
});

router.post('/', requireLogin, requireDM, (req, res) => {
  const { name, description, quantity, category, held_by, session_id } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Item name is required.');
    return res.redirect('/loot');
  }
  const validCategories = ['item', 'weapon', 'armor', 'potion', 'quest', 'gold'];
  const cat = validCategories.includes(category) ? category : 'item';
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const holder = held_by ? parseInt(held_by, 10) : null;
  const sessId = session_id ? parseInt(session_id, 10) : null;

  db.prepare('INSERT INTO loot_items (name, description, quantity, category, held_by, session_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), (description && description.trim()) || null, qty, cat, holder, sessId, req.user.id);

  req.flash('success', 'Loot added to the party inventory!');
  res.redirect('/loot');
});

router.post('/:id/assign', requireLogin, requireDM, (req, res) => {
  const { held_by } = req.body;
  const item = db.prepare('SELECT id FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  const holder = held_by ? parseInt(held_by, 10) : null;
  db.prepare('UPDATE loot_items SET held_by = ? WHERE id = ?').run(holder, item.id);
  req.flash('success', 'Item reassigned.');
  res.redirect('/loot');
});

router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const { name, description, quantity, category } = req.body;
  const item = db.prepare('SELECT id FROM loot_items WHERE id = ?').get(req.params.id);
  if (!item) {
    req.flash('error', 'Item not found.');
    return res.redirect('/loot');
  }
  if (!name || !name.trim()) {
    req.flash('error', 'Item name is required.');
    return res.redirect('/loot');
  }
  const validCategories = ['item', 'weapon', 'armor', 'potion', 'quest', 'gold'];
  const cat = validCategories.includes(category) ? category : 'item';
  const qty = Math.max(1, parseInt(quantity, 10) || 1);

  db.prepare('UPDATE loot_items SET name = ?, description = ?, quantity = ?, category = ? WHERE id = ?')
    .run(name.trim(), (description && description.trim()) || null, qty, cat, item.id);

  req.flash('success', 'Item updated.');
  res.redirect('/loot');
});

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

module.exports = router;
