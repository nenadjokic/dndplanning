const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const sse = require('../helpers/sse');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', 'data', 'uploads', 'handouts');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, uploadDir); },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.random().toString(36).substr(2, 6) + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: function(req, file, cb) {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed.'));
  }
});

// Handout library
router.get('/', requireLogin, (req, res) => {
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  const handouts = isDM
    ? db.prepare(`SELECT h.*, u.username as creator_name,
        nt.name as npc_name, ml.name as location_name
       FROM handouts h
       JOIN users u ON h.created_by = u.id
       LEFT JOIN npc_tokens nt ON h.linked_npc_id = nt.id
       LEFT JOIN map_locations ml ON h.linked_location_id = ml.id
       ORDER BY h.created_at DESC`).all()
    : db.prepare(`SELECT h.*, u.username as creator_name,
        nt.name as npc_name, ml.name as location_name
       FROM handouts h
       JOIN users u ON h.created_by = u.id
       LEFT JOIN npc_tokens nt ON h.linked_npc_id = nt.id
       LEFT JOIN map_locations ml ON h.linked_location_id = ml.id
       WHERE h.revealed = 1
       ORDER BY h.created_at DESC`).all();

  const npcs = isDM ? db.prepare('SELECT id, name FROM npc_tokens ORDER BY name').all() : [];
  const locations = isDM ? db.prepare('SELECT id, name FROM map_locations ORDER BY name').all() : [];

  res.render('handouts', { handouts, isDM, npcs, locations });
});

// Upload handout (DM)
router.post('/', requireLogin, requireDM, upload.single('image'), (req, res) => {
  const validateCSRF = req.app.locals.validateCSRF;
  if (!validateCSRF(req, res)) return;

  const { title, type, content, linked_npc_id, linked_location_id } = req.body;
  if (!title || !title.trim()) {
    req.flash('error', 'Title is required.');
    return res.redirect('/handouts');
  }

  const handoutType = type === 'text' ? 'text' : 'image';
  const imagePath = req.file ? req.file.filename : null;
  const textContent = handoutType === 'text' ? (content || '') : null;
  const npcId = linked_npc_id ? parseInt(linked_npc_id, 10) : null;
  const locId = linked_location_id ? parseInt(linked_location_id, 10) : null;

  if (handoutType === 'image' && !imagePath) {
    req.flash('error', 'Image file is required for image handouts.');
    return res.redirect('/handouts');
  }

  db.prepare(`INSERT INTO handouts (title, type, content, image_path, linked_npc_id, linked_location_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(title.trim(), handoutType, textContent, imagePath, npcId, locId, req.user.id);

  req.flash('success', 'Handout created.');
  res.redirect('/handouts');
});

// Reveal handout
router.post('/:id/reveal', requireLogin, requireDM, (req, res) => {
  const handout = db.prepare('SELECT * FROM handouts WHERE id = ?').get(req.params.id);
  if (!handout) {
    req.flash('error', 'Handout not found.');
    return res.redirect('/handouts');
  }
  db.prepare('UPDATE handouts SET revealed = 1 WHERE id = ?').run(handout.id);

  sse.broadcast('handout-reveal', { title: handout.title, type: handout.type, id: handout.id });

  req.flash('success', 'Handout revealed to players!');
  res.redirect('/handouts');
});

// Hide handout
router.post('/:id/hide', requireLogin, requireDM, (req, res) => {
  const handout = db.prepare('SELECT id FROM handouts WHERE id = ?').get(req.params.id);
  if (!handout) {
    req.flash('error', 'Handout not found.');
    return res.redirect('/handouts');
  }
  db.prepare('UPDATE handouts SET revealed = 0 WHERE id = ?').run(handout.id);
  req.flash('success', 'Handout hidden.');
  res.redirect('/handouts');
});

// Edit handout
router.post('/:id/edit', requireLogin, requireDM, (req, res) => {
  const { title, linked_npc_id, linked_location_id } = req.body;
  const handout = db.prepare('SELECT id FROM handouts WHERE id = ?').get(req.params.id);
  if (!handout) {
    req.flash('error', 'Handout not found.');
    return res.redirect('/handouts');
  }
  db.prepare('UPDATE handouts SET title = ?, linked_npc_id = ?, linked_location_id = ? WHERE id = ?')
    .run((title && title.trim()) || 'Untitled', linked_npc_id ? parseInt(linked_npc_id, 10) : null, linked_location_id ? parseInt(linked_location_id, 10) : null, handout.id);
  req.flash('success', 'Handout updated.');
  res.redirect('/handouts');
});

// Delete handout
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const handout = db.prepare('SELECT * FROM handouts WHERE id = ?').get(req.params.id);
  if (!handout) {
    req.flash('error', 'Handout not found.');
    return res.redirect('/handouts');
  }

  // Remove file
  if (handout.image_path) {
    const filePath = path.join(uploadDir, handout.image_path);
    try { fs.unlinkSync(filePath); } catch (e) { /* file may not exist */ }
  }

  db.prepare('DELETE FROM handouts WHERE id = ?').run(handout.id);
  req.flash('success', 'Handout deleted.');
  res.redirect('/handouts');
});

module.exports = router;
