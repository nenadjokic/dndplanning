const express = require('express');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

// Redirect to Quest Journal (backwards compat)
router.get('/', requireLogin, (req, res) => {
  res.redirect('/journal');
});

module.exports = router;
