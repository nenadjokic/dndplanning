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

function mapUpload(req, res, next) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, mapsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'map-' + req.params.id + ext);
    }
  });
  const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  }).single('map_image');
  upload(req, res, next);
}

// Maps index
router.get('/', requireLogin, (req, res) => {
  const maps = db.prepare('SELECT * FROM maps ORDER BY created_at').all();
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  res.render('maps', { maps, isDM });
});

// Create new map
router.post('/', requireLogin, requireDM, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Map name is required.');
    return res.redirect('/map');
  }
  const result = db.prepare('INSERT INTO maps (name, created_by) VALUES (?, ?)').run(name.trim(), req.user.id);
  req.flash('success', 'Map created.');
  res.redirect('/map/' + result.lastInsertRowid);
});

// Single map view
router.get('/:id', requireLogin, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const locations = db.prepare('SELECT * FROM map_locations WHERE map_id = ? ORDER BY created_at').all(map.id);
  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  res.render('map', { map, locations, isDM });
});

// Upload map image
router.post('/:id/upload', requireLogin, requireDM, mapUpload, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  if (!req.file) {
    req.flash('error', 'Please upload a valid image (JPG, PNG, GIF, WebP, max 5MB).');
    return res.redirect('/map/' + map.id);
  }
  if (map.image_path && map.image_path !== req.file.filename) {
    const oldPath = path.join(mapsDir, map.image_path);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  db.prepare('UPDATE maps SET image_path = ? WHERE id = ?').run(req.file.filename, map.id);
  req.flash('success', 'Map image uploaded.');
  res.redirect('/map/' + map.id);
});

// Add location
router.post('/:id/locations', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const { name, description, x, y, icon } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map/' + map.id);
  }
  const validIcons = ['pin', 'city', 'dungeon', 'tavern', 'party'];
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  const locX = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const locY = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('INSERT INTO map_locations (name, description, x, y, icon, created_by, map_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name.trim(), (description && description.trim()) || null, locX, locY, locIcon, req.user.id, map.id);
  req.flash('success', 'Location added.');
  res.redirect('/map/' + map.id);
});

// Edit location
router.post('/:id/locations/:locId/edit', requireLogin, requireDM, (req, res) => {
  const { name, description, icon } = req.body;
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ? AND map_id = ?').get(req.params.locId, req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map/' + req.params.id);
  }
  if (!name || !name.trim()) {
    req.flash('error', 'Location name is required.');
    return res.redirect('/map/' + req.params.id);
  }
  const validIcons = ['pin', 'city', 'dungeon', 'tavern', 'party'];
  const locIcon = validIcons.includes(icon) ? icon : 'pin';
  db.prepare('UPDATE map_locations SET name = ?, description = ?, icon = ? WHERE id = ?')
    .run(name.trim(), (description && description.trim()) || null, locIcon, loc.id);
  req.flash('success', 'Location updated.');
  res.redirect('/map/' + req.params.id);
});

// Delete location
router.post('/:id/locations/:locId/delete', requireLogin, requireDM, (req, res) => {
  const loc = db.prepare('SELECT id FROM map_locations WHERE id = ? AND map_id = ?').get(req.params.locId, req.params.id);
  if (!loc) {
    req.flash('error', 'Location not found.');
    return res.redirect('/map/' + req.params.id);
  }
  db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
  db.prepare('DELETE FROM map_locations WHERE id = ?').run(loc.id);
  req.flash('success', 'Location removed.');
  res.redirect('/map/' + req.params.id);
});

// Update party position (JSON)
router.post('/:id/party', requireLogin, requireDM, express.json(), (req, res) => {
  const map = db.prepare('SELECT id FROM maps WHERE id = ?').get(req.params.id);
  if (!map) return res.status(404).json({ error: 'Map not found' });
  const { x, y } = req.body;
  const px = Math.max(0, Math.min(100, parseFloat(x) || 50));
  const py = Math.max(0, Math.min(100, parseFloat(y) || 50));
  db.prepare('UPDATE maps SET party_x = ?, party_y = ? WHERE id = ?').run(px, py, map.id);
  res.json({ success: true });
});

// Delete map
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(req.params.id);
  if (!map) {
    req.flash('error', 'Map not found.');
    return res.redirect('/map');
  }
  const locIds = db.prepare('SELECT id FROM map_locations WHERE map_id = ?').all(map.id);
  for (const loc of locIds) {
    db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id = ?').run(loc.id);
  }
  db.prepare('DELETE FROM map_locations WHERE map_id = ?').run(map.id);
  db.prepare('DELETE FROM maps WHERE id = ?').run(map.id);
  if (map.image_path) {
    const imgPath = path.join(mapsDir, map.image_path);
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
  req.flash('success', 'Map deleted.');
  res.redirect('/map');
});

module.exports = router;
