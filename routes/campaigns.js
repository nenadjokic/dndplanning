const express = require('express');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const router = express.Router();

// Ensure upload directory
const coverDir = path.join(__dirname, '..', 'data', 'uploads', 'campaigns');
if (!fs.existsSync(coverDir)) fs.mkdirSync(coverDir, { recursive: true });

const coverUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, coverDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, 'campaign-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// List all campaigns
router.get('/', requireLogin, (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*, u.username as creator_name,
      (SELECT COUNT(*) FROM sessions s WHERE s.campaign_id = c.id) as session_count,
      (SELECT COUNT(*) FROM maps m WHERE m.campaign_id = c.id) as map_count,
      (SELECT COUNT(*) FROM quests q WHERE q.campaign_id = c.id) as quest_count
    FROM campaigns c
    JOIN users u ON c.created_by = u.id
    ORDER BY c.created_at DESC
  `).all();

  const isDM = req.user.role === 'dm' || req.user.role === 'admin';
  res.render('campaigns/list', { campaigns, isDM });
});

// New campaign form (DM only)
router.get('/new', requireLogin, requireDM, (req, res) => {
  res.render('campaigns/form', { campaign: null });
});

// Create campaign
router.post('/', requireLogin, requireDM, (req, res) => {
  coverUpload.single('cover_image')(req, res, async function(err) {
    if (err) {
      req.flash('error', err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 5MB).' : 'Upload failed.');
      return res.redirect('/campaigns/new');
    }

    if (req.app.locals.validateCSRF && !req.app.locals.validateCSRF(req, res)) return;

    const { name, description, color } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Campaign name is required.');
      return res.redirect('/campaigns/new');
    }

    let coverImage = null;
    if (req.file) {
      try {
        const resized = 'campaign-thumb-' + Date.now() + '.webp';
        await sharp(req.file.path)
          .resize(800, 400, { fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(path.join(coverDir, resized));
        fs.unlinkSync(req.file.path);
        coverImage = resized;
      } catch (e) {
        coverImage = req.file.filename;
      }
    }

    const result = db.prepare('INSERT INTO campaigns (name, description, cover_image, color, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(name.trim(), description ? description.trim() : null, coverImage, color || '#d4a843', req.user.id);

    req.flash('success', 'Campaign created!');
    res.redirect('/campaigns/' + result.lastInsertRowid);
  });
});

// Campaign detail/home page
router.get('/:id', requireLogin, (req, res) => {
  const campaign = db.prepare(`
    SELECT c.*, u.username as creator_name
    FROM campaigns c
    JOIN users u ON c.created_by = u.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!campaign) {
    req.flash('error', 'Campaign not found.');
    return res.redirect('/campaigns');
  }

  const isDM = req.user.role === 'dm' || req.user.role === 'admin';

  // Sessions for this campaign
  const sessions = db.prepare(`
    SELECT s.*, u.username as dm_name,
      sl.date_time as confirmed_date, sl.label as confirmed_label
    FROM sessions s
    JOIN users u ON s.created_by = u.id
    LEFT JOIN slots sl ON s.confirmed_slot_id = sl.id
    WHERE s.campaign_id = ?
    ORDER BY
      CASE s.status WHEN 'open' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2 WHEN 'cancelled' THEN 3 END,
      CASE WHEN s.status IN ('confirmed', 'completed') THEN sl.date_time END DESC,
      s.created_at DESC
  `).all(campaign.id);

  // Active quests
  const quests = db.prepare(`
    SELECT id, title, status, difficulty FROM quests
    WHERE campaign_id = ? ${isDM ? '' : 'AND revealed = 1'}
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'available' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 10
  `).all(campaign.id);

  // Maps count
  const mapCount = db.prepare('SELECT COUNT(*) as cnt FROM maps WHERE campaign_id = ?').get(campaign.id).cnt;

  // Story arcs
  const arcs = db.prepare('SELECT * FROM campaign_arcs WHERE campaign_id = ? ORDER BY sort_order, name').all(campaign.id);

  // Loot count
  const lootCount = db.prepare('SELECT COUNT(*) as cnt FROM loot_items WHERE campaign_id = ?').get(campaign.id).cnt;

  // Handout count
  const handoutCount = db.prepare('SELECT COUNT(*) as cnt FROM handouts WHERE campaign_id = ?').get(campaign.id).cnt;

  res.render('campaigns/detail', { campaign, sessions, quests, mapCount, arcs, lootCount, handoutCount, isDM });
});

// Edit campaign form
router.get('/:id/edit', requireLogin, requireDM, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) {
    req.flash('error', 'Campaign not found.');
    return res.redirect('/campaigns');
  }
  res.render('campaigns/form', { campaign });
});

// Update campaign
router.post('/:id', requireLogin, requireDM, (req, res) => {
  coverUpload.single('cover_image')(req, res, async function(err) {
    if (err) {
      req.flash('error', err.code === 'LIMIT_FILE_SIZE' ? 'Image too large (max 5MB).' : 'Upload failed.');
      return res.redirect('/campaigns/' + req.params.id + '/edit');
    }

    if (req.app.locals.validateCSRF && !req.app.locals.validateCSRF(req, res)) return;

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
    if (!campaign) {
      req.flash('error', 'Campaign not found.');
      return res.redirect('/campaigns');
    }

    const { name, description, color } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Campaign name is required.');
      return res.redirect('/campaigns/' + campaign.id + '/edit');
    }

    let coverImage = campaign.cover_image;
    if (req.file) {
      try {
        const resized = 'campaign-thumb-' + Date.now() + '.webp';
        await sharp(req.file.path)
          .resize(800, 400, { fit: 'cover' })
          .webp({ quality: 80 })
          .toFile(path.join(coverDir, resized));
        fs.unlinkSync(req.file.path);
        // Delete old cover
        if (campaign.cover_image) {
          try { fs.unlinkSync(path.join(coverDir, campaign.cover_image)); } catch (e) {}
        }
        coverImage = resized;
      } catch (e) {
        coverImage = req.file.filename;
      }
    }

    db.prepare('UPDATE campaigns SET name = ?, description = ?, cover_image = ?, color = ? WHERE id = ?')
      .run(name.trim(), description ? description.trim() : null, coverImage, color || '#d4a843', campaign.id);

    req.flash('success', 'Campaign updated.');
    res.redirect('/campaigns/' + campaign.id);
  });
});

// Delete campaign (DM only)
router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) {
    req.flash('error', 'Campaign not found.');
    return res.redirect('/campaigns');
  }

  // Unlink related data (don't delete, just set campaign_id to NULL)
  db.prepare('UPDATE sessions SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE maps SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE quests SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE loot_items SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE handouts SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE encounters SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);
  db.prepare('UPDATE campaign_arcs SET campaign_id = NULL WHERE campaign_id = ?').run(campaign.id);

  // Delete cover image
  if (campaign.cover_image) {
    try { fs.unlinkSync(path.join(coverDir, campaign.cover_image)); } catch (e) {}
  }

  db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaign.id);
  req.flash('success', 'Campaign deleted.');
  res.redirect('/campaigns');
});

module.exports = router;
