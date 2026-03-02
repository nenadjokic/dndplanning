const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const sse = require('../helpers/sse');
const router = express.Router();

// Quest board page
router.get('/', requireLogin, (req, res) => {
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  const quests = isDM
    ? db.prepare(`SELECT q.*, u.username as creator_name,
        nt.name as npc_name, m.name as map_name, ml.name as location_name,
        ca.name as arc_name, ca.color as arc_color
       FROM quests q
       JOIN users u ON q.created_by = u.id
       LEFT JOIN npc_tokens nt ON q.quest_giver_npc_id = nt.id
       LEFT JOIN maps m ON q.linked_map_id = m.id
       LEFT JOIN map_locations ml ON q.linked_location_id = ml.id
       LEFT JOIN campaign_arcs ca ON q.arc_id = ca.id
       ORDER BY q.sort_order, q.created_at DESC`).all()
    : db.prepare(`SELECT q.*, u.username as creator_name,
        nt.name as npc_name, m.name as map_name, ml.name as location_name,
        ca.name as arc_name, ca.color as arc_color
       FROM quests q
       JOIN users u ON q.created_by = u.id
       LEFT JOIN npc_tokens nt ON q.quest_giver_npc_id = nt.id
       LEFT JOIN maps m ON q.linked_map_id = m.id
       LEFT JOIN map_locations ml ON q.linked_location_id = ml.id
       LEFT JOIN campaign_arcs ca ON q.arc_id = ca.id
       WHERE q.revealed = 1
       ORDER BY q.sort_order, q.created_at DESC`).all();

  // Fetch objectives for each quest
  for (const q of quests) {
    q.objectives = db.prepare('SELECT * FROM quest_objectives WHERE quest_id = ? ORDER BY sort_order, id').all(q.id);
  }

  // Dropdown data for DM form
  const npcs = isDM ? db.prepare('SELECT id, name FROM npc_tokens ORDER BY name').all() : [];
  const maps = isDM ? db.prepare('SELECT id, name FROM maps ORDER BY name').all() : [];
  const locations = isDM ? db.prepare('SELECT id, name, map_id FROM map_locations ORDER BY name').all() : [];
  const arcs = isDM ? db.prepare('SELECT id, name, color FROM campaign_arcs ORDER BY sort_order, name').all() : [];

  res.render('quests', { quests, isDM, npcs, maps, locations, arcs });
});

// Create quest (DM only)
router.post('/', requireLogin, requireDM, (req, res) => {
  const { title, description, difficulty, reward, quest_giver_npc_id, quest_giver_name,
    linked_map_id, linked_location_id, arc_id, dm_notes, revealed, objectives } = req.body;

  if (!title || !title.trim()) {
    req.flash('error', 'Quest title is required.');
    return res.redirect('/quests');
  }

  const result = db.prepare(`INSERT INTO quests (title, description, status, difficulty, reward,
    quest_giver_npc_id, quest_giver_name, linked_map_id, linked_location_id, arc_id,
    revealed, dm_notes, created_by)
    VALUES (?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title.trim(), description || null, difficulty || null, reward || null,
      quest_giver_npc_id ? parseInt(quest_giver_npc_id) : null,
      quest_giver_name || null,
      linked_map_id ? parseInt(linked_map_id) : null,
      linked_location_id ? parseInt(linked_location_id) : null,
      arc_id ? parseInt(arc_id) : null,
      revealed === 'on' || revealed === '1' ? 1 : 0,
      dm_notes || null, req.user.id);

  // Add objectives
  if (objectives) {
    const objList = Array.isArray(objectives) ? objectives : [objectives];
    objList.forEach((text, i) => {
      if (text && text.trim()) {
        db.prepare('INSERT INTO quest_objectives (quest_id, text, sort_order) VALUES (?, ?, ?)')
          .run(result.lastInsertRowid, text.trim(), i);
      }
    });
  }

  if (revealed === 'on' || revealed === '1') {
    sse.broadcast('quest-reveal', { title: title.trim(), id: result.lastInsertRowid });
  }

  req.flash('success', 'Quest created!');
  res.redirect('/quests');
});

// Edit quest (DM only)
router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const quest = db.prepare('SELECT id FROM quests WHERE id = ?').get(req.params.id);
  if (!quest) {
    req.flash('error', 'Quest not found.');
    return res.redirect('/quests');
  }

  const { title, description, difficulty, reward, quest_giver_npc_id, quest_giver_name,
    linked_map_id, linked_location_id, arc_id, dm_notes, objectives } = req.body;

  db.prepare(`UPDATE quests SET title=?, description=?, difficulty=?, reward=?,
    quest_giver_npc_id=?, quest_giver_name=?, linked_map_id=?, linked_location_id=?,
    arc_id=?, dm_notes=? WHERE id=?`)
    .run(title ? title.trim() : 'Untitled', description || null, difficulty || null,
      reward || null,
      quest_giver_npc_id ? parseInt(quest_giver_npc_id) : null,
      quest_giver_name || null,
      linked_map_id ? parseInt(linked_map_id) : null,
      linked_location_id ? parseInt(linked_location_id) : null,
      arc_id ? parseInt(arc_id) : null,
      dm_notes || null, quest.id);

  // Rebuild objectives
  db.prepare('DELETE FROM quest_objectives WHERE quest_id = ?').run(quest.id);
  if (objectives) {
    const objList = Array.isArray(objectives) ? objectives : [objectives];
    objList.forEach((text, i) => {
      if (text && text.trim()) {
        db.prepare('INSERT INTO quest_objectives (quest_id, text, sort_order) VALUES (?, ?, ?)')
          .run(quest.id, text.trim(), i);
      }
    });
  }

  sse.broadcast('quest-update', { questId: quest.id });
  req.flash('success', 'Quest updated.');
  res.redirect('/quests');
});

// Delete quest (DM only)
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const quest = db.prepare('SELECT id FROM quests WHERE id = ?').get(req.params.id);
  if (!quest) {
    req.flash('error', 'Quest not found.');
    return res.redirect('/quests');
  }
  db.prepare('DELETE FROM quests WHERE id = ?').run(quest.id);
  req.flash('success', 'Quest deleted.');
  res.redirect('/quests');
});

// Reveal quest to players
router.post('/:id/reveal', requireLogin, requireDM, (req, res) => {
  const quest = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
  if (!quest) {
    req.flash('error', 'Quest not found.');
    return res.redirect('/quests');
  }
  db.prepare('UPDATE quests SET revealed = 1 WHERE id = ?').run(quest.id);
  sse.broadcast('quest-reveal', { title: quest.title, id: quest.id });
  req.flash('success', 'Quest revealed to players!');
  res.redirect('/quests');
});

// Hide quest from players
router.post('/:id/hide', requireLogin, requireDM, (req, res) => {
  const quest = db.prepare('SELECT id FROM quests WHERE id = ?').get(req.params.id);
  if (!quest) {
    req.flash('error', 'Quest not found.');
    return res.redirect('/quests');
  }
  db.prepare('UPDATE quests SET revealed = 0 WHERE id = ?').run(quest.id);
  req.flash('success', 'Quest hidden from players.');
  res.redirect('/quests');
});

// Change quest status (DM only)
router.post('/:id/status', requireLogin, requireDM, express.json(), (req, res) => {
  const quest = db.prepare('SELECT id FROM quests WHERE id = ?').get(req.params.id);
  if (!quest) return res.status(404).json({ error: 'Quest not found' });

  const { status } = req.body;
  const validStatuses = ['available', 'active', 'completed', 'failed'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const completedAt = (status === 'completed' || status === 'failed') ? new Date().toISOString() : null;
  db.prepare('UPDATE quests SET status = ?, completed_at = ? WHERE id = ?').run(status, completedAt, quest.id);
  sse.broadcast('quest-update', { questId: quest.id });
  res.json({ success: true, status });
});

// Toggle objective completion (DM only)
router.post('/:id/objectives', requireLogin, requireDM, express.json(), (req, res) => {
  const { objective_id, completed } = req.body;
  const obj = db.prepare('SELECT id, quest_id FROM quest_objectives WHERE id = ?').get(objective_id);
  if (!obj) return res.status(404).json({ error: 'Objective not found' });

  db.prepare('UPDATE quest_objectives SET completed = ? WHERE id = ?').run(completed ? 1 : 0, obj.id);
  sse.broadcast('quest-update', { questId: obj.quest_id });
  res.json({ success: true });
});

// API: active quests for dashboard widget
router.get('/api/active', requireLogin, (req, res) => {
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  const quests = isDM
    ? db.prepare(`SELECT id, title, status, difficulty FROM quests
       WHERE status IN ('available', 'active')
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 3`).all()
    : db.prepare(`SELECT id, title, status, difficulty FROM quests
       WHERE revealed = 1 AND status IN ('available', 'active')
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, created_at DESC
       LIMIT 3`).all();
  res.json({ quests });
});

module.exports = router;
