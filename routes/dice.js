const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

// POST /api/dice/roll — save a dice roll
router.post('/roll', requireLogin, (req, res) => {
  const { rollDesc, result, detail } = req.body;
  if (!rollDesc || result == null) {
    return res.status(400).json({ error: 'Missing rollDesc or result' });
  }

  db.prepare(`
    INSERT INTO dice_rolls (user_id, username, roll_desc, result, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.user.id, req.user.username, String(rollDesc), Number(result), detail || null);

  // Prune old rolls — keep only last 50
  db.prepare(`
    DELETE FROM dice_rolls WHERE id NOT IN (
      SELECT id FROM dice_rolls ORDER BY created_at DESC LIMIT 50
    )
  `).run();

  res.json({ ok: true });
});

// GET /api/dice/history — last 10 rolls
router.get('/history', requireLogin, (req, res) => {
  const rolls = db.prepare(`
    SELECT username, roll_desc, result, detail, created_at
    FROM dice_rolls
    ORDER BY created_at DESC
    LIMIT 10
  `).all();

  res.json({ rolls });
});

// POST /api/dice/presence/heartbeat — update presence, return active players + last dice roll timestamp
router.post('/presence/heartbeat', requireLogin, (req, res) => {
  // Update current user's heartbeat
  db.prepare("UPDATE users SET last_heartbeat = datetime('now') WHERE id = ?").run(req.user.id);

  // Get players with heartbeat within 5 minutes (active + away)
  const players = db.prepare(`
    SELECT username, avatar, last_heartbeat
    FROM users
    WHERE last_heartbeat IS NOT NULL
      AND last_heartbeat > datetime('now', '-5 minutes')
    ORDER BY username COLLATE NOCASE
  `).all();

  // Get the most recent dice roll timestamp
  const lastRoll = db.prepare(`
    SELECT created_at FROM dice_rolls ORDER BY created_at DESC LIMIT 1
  `).get();

  res.json({
    players,
    lastDiceRollAt: lastRoll ? lastRoll.created_at : null
  });
});

module.exports = router;
