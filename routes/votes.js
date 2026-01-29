const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

router.post('/:sessionId', requireLogin, (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.sessionId);

  if (!session || session.status !== 'open') {
    req.flash('error', 'This quest is not open for voting.');
    return res.redirect('/');
  }

  const slots = db.prepare('SELECT * FROM slots WHERE session_id = ?').all(session.id);

  const upsertVote = db.prepare(`
    INSERT INTO votes (slot_id, user_id, status)
    VALUES (?, ?, ?)
    ON CONFLICT(slot_id, user_id) DO UPDATE SET status = excluded.status
  `);

  const saveVotes = db.transaction(() => {
    for (const slot of slots) {
      const status = req.body['vote_' + slot.id];
      if (status && ['available', 'maybe', 'unavailable'].includes(status)) {
        upsertVote.run(slot.id, req.user.id, status);
      }
    }
  });

  saveVotes();
  req.flash('success', 'Your availability has been recorded!');
  res.redirect('/sessions/' + session.id);
});

module.exports = router;
