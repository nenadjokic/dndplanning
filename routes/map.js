const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM, requireAdmin } = require('../middleware/auth');
const router = express.Router();

const mapsDir = path.join(__dirname, '..', 'data', 'maps');
if (!fs.existsSync(mapsDir)) {
  fs.mkdirSync(mapsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, mapsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'world-map' + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

router.get('/', requireLogin, (req, res) => {
  const locations = db.prepare('SELECT * FROM map_locations ORDER BY created_at').all();
  const config = db.prepare('SELECT * FROM map_config WHERE id = 1').get();
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  res.render('map', { locations, config, isDM });
});

router.post('/locations', requireLogin, requireDM, (req, res) => {
  const { name, description, x, y, icon } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map');
  }
  const validIcons = ['pin', 'city', 'dungeon', 'tavern', 'party'];
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  const locX = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const locY = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('INSERT INTO map_locations (name, description, x, y, icon, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), (description && description.trim()) || null, locX, locY, locIcon, req.user.id);
  req.flash('success', 'Location added to the map.');
  res.redirect('/map');
});

router.post('/locations/:id/edit', requireLogin, requireDM, (req, res) => {
  const { name, description, icon } = req.body;
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ?').get(req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map');
  }
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map');
  }
  const validIcons = ['pin', 'city', 'dungeon', 'tavern', 'party'];
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  db.prepare('UPDATE map_locations SET name = ?, description = ?, icon = ? WHERE id = ?')
    .run(name.trim(), (description && description.trim()) || null, locIcon, loc.id);
  req.flash('success', 'Location updated.');
  res.redirect('/map');
});

router.post('/locations/:id/delete', requireLogin, requireDM, (req, res) => {
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ?').get(req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map');
  }
  db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
  db.prepare('DELETE FROM map_locations WHERE id = ?').run(loc.id);
  req.flash('success', 'Location removed from the map.');
  res.redirect('/map');
});

router.post('/party', requireLogin, requireDM, express.json(), (req, res) => {
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE map_config SET party_x = ?, party_y = ? WHERE id = 1').run(px, py);
  res.json({ success: true });
});

router.post('/upload', requireLogin, requireAdmin, upload.single('map_image'), (req, res) => {
  if (!req.file) {
    req.flash('error', 'Please upload a valid image (JPG, PNG, GIF, WebP, max 5MB).');
    return res.redirect('/map');
  }
  db.prepare('UPDATE map_config SET image_path = ? WHERE id = 1').run(req.file.filename);
  req.flash('success', 'Map image uploaded.');
  res.redirect('/map');
});

module.exports = router;
