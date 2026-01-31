const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

const thumbDir = path.join(__dirname, '..', 'data', 'thumbnails');
if (!fs.existsSync(thumbDir)) {
  fs.mkdirSync(thumbDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, thumbDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'tool-' + Date.now() + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

router.get('/', requireLogin, requireDM, (req, res) => {
  const tools = db.prepare('SELECT * FROM dm_tools ORDER BY sort_order, created_at').all();
  res.render('dm/tools', { tools });
});

router.post('/', requireLogin, requireDM, upload.single('thumbnail'), (req, res) => {
  const { name, url, icon } = req.body;
  if (!name || !name.trim() || !url || !url.trim()) {
    req.flash('error', 'Name and URL are required.');
    return res.redirect('/dm-tools');
  }
  const validIcons = ['link', 'dice', 'scroll', 'book', 'music', 'map', 'sword', 'shield', 'potion', 'skull', 'dragon', 'wand', 'gem', 'crown', 'hammer', 'eye'];
  const toolIcon = validIcons.includes(icon) ? icon : 'link';
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM dm_tools').get();
  const order = (maxOrder.m || 0) + 1;
  const thumbnail = req.file ? req.file.filename : null;
  db.prepare('INSERT INTO dm_tools (name, url, icon, sort_order, created_by, thumbnail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name.trim(), url.trim(), toolIcon, order, req.user.id, thumbnail);
  req.flash('success', 'Tool added to the board!');
  res.redirect('/dm-tools');
});

router.post('/:id/edit', requireLogin, requireDM, upload.single('thumbnail'), (req, res) => {
  const { name, url, icon, remove_thumbnail } = req.body;
  const tool = db.prepare('SELECT * FROM dm_tools WHERE id = ?').get(req.params.id);
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

  let thumbnail = tool.thumbnail;
  if (req.file) {
    // Delete old thumbnail if replacing
    if (tool.thumbnail) {
      const oldPath = path.join(thumbDir, tool.thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    thumbnail = req.file.filename;
  } else if (remove_thumbnail === '1') {
    if (tool.thumbnail) {
      const oldPath = path.join(thumbDir, tool.thumbnail);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    thumbnail = null;
  }

  db.prepare('UPDATE dm_tools SET name = ?, url = ?, icon = ?, thumbnail = ? WHERE id = ?')
    .run(name.trim(), url.trim(), toolIcon, thumbnail, tool.id);
  req.flash('success', 'Tool updated.');
  res.redirect('/dm-tools');
});

router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const tool = db.prepare('SELECT * FROM dm_tools WHERE id = ?').get(req.params.id);
  if (!tool) {
    req.flash('error', 'Tool not found.');
    return res.redirect('/dm-tools');
  }
  if (tool.thumbnail) {
    const thumbPath = path.join(thumbDir, tool.thumbnail);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
  db.prepare('DELETE FROM dm_tools WHERE id = ?').run(tool.id);
  req.flash('success', 'Tool removed.');
  res.redirect('/dm-tools');
});

module.exports = router;
