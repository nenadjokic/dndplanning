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

module.exports = router;
