const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, requireDM, (req, res) => {
  const tools = db.prepare('SELECT * FROM dm_tools ORDER BY sort_order, created_at').all();
  res.render('dm/tools', { tools });
});

router.post('/', requireLogin, requireDM, (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !name.trim() || !url || !url.trim()) {
    req.flash('error', 'Name and URL are required.');
    return res.redirect('/dm-tools');
  }
  const validIcons = ['link', 'dice', 'scroll', 'book', 'music', 'map', 'sword', 'shield', 'potion', 'skull', 'dragon', 'wand', 'gem', 'crown', 'hammer', 'eye'];
  const toolIcon = validIcons.includes(icon) ? icon : 'link';
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM dm_tools').get();
  const order = (maxOrder.m || 0) + 1;
  db.prepare('INSERT INTO dm_tools (name, url, icon, sort_order, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), url.trim(), toolIcon, order, req.user.id);
  req.flash('success', 'Tool added to the board!');
  res.redirect('/dm-tools');
});

router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const { name, url, icon } = req.body;
  const tool = db.prepare('SELECT id FROM dm_tools WHERE id = ?').get(req.params.id);
  if (!tool) {
    req.flash('error', 'Tool not found.');
    return res.redirect('/dm-tools');
  }
  if (!name || !name.trim() || !url || !url.trim()) {
    req.flash('error', 'Name and URL are required.');
    return res.redirect('/dm-tools');
  }
  const validIcons = ['link', 'dice', 'scroll', 'book', 'music', 'map', 'sword', 'shield', 'potion', 'skull', 'dragon', 'wand', 'gem', 'crown', 'hammer', 'eye'];
  const toolIcon = validIcons.includes(icon) ? icon : 'link';
  db.prepare('UPDATE dm_tools SET name = ?, url = ?, icon = ? WHERE id = ?')
    .run(name.trim(), url.trim(), toolIcon, tool.id);
  req.flash('success', 'Tool updated.');
  res.redirect('/dm-tools');
});

router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const tool = db.prepare('SELECT id FROM dm_tools WHERE id = ?').get(req.params.id);
  if (!tool) {
    req.flash('error', 'Tool not found.');
    return res.redirect('/dm-tools');
  }
  db.prepare('DELETE FROM dm_tools WHERE id = ?').run(tool.id);
  req.flash('success', 'Tool removed.');
  res.redirect('/dm-tools');
});

module.exports = router;
