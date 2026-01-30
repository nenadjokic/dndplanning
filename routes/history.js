const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  const sessions = db.prepare(`
    SELECT s.*, u.username as dm_name, sl.date_time as confirmed_date
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    WHERE s.status = 'completed' AND s.category IN ('dnd', 'rpg')
    ORDER BY sl.date_time DESC
  `).all();

  res.render('history', { sessions });
});

module.exports = router;
