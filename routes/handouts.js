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
  const campaignFilter = req.query.campaign_id;

  // Build WHERE conditions
  const conditions = [];
  const params = [];
  if (!isDM) conditions.push('h.revealed = 1');
  if (campaignFilter === 'unsorted') {
    conditions.push('h.campaign_id IS NULL');
  } else if (campaignFilter && campaignFilter !== '') {
    conditions.push('h.campaign_id = ?');
    params.push(parseInt(campaignFilter, 10));
  }
  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const handouts = db.prepare(`SELECT h.*, u.username as creator_name,
        nt.name as npc_name, ml.name as location_name,
        camp.name as campaign_name,
        hc.name as category_name, hc.parent_id as category_parent_id,
        hcp.name as category_parent_name
       FROM handouts h
       JOIN users u ON h.created_by = u.id
       LEFT JOIN npc_tokens nt ON h.linked_npc_id = nt.id
       LEFT JOIN map_locations ml ON h.linked_location_id = ml.id
       LEFT JOIN campaigns camp ON h.campaign_id = camp.id
       LEFT JOIN handout_categories hc ON h.category_id = hc.id
       LEFT JOIN handout_categories hcp ON hc.parent_id = hcp.id
       ${whereClause}
       ORDER BY h.created_at DESC`).all(...params);

  const npcs = isDM ? db.prepare('SELECT id, name FROM npc_tokens ORDER BY name').all() : [];
  const locations = isDM ? db.prepare('SELECT id, name FROM map_locations ORDER BY name').all() : [];

  let campaigns = [];
  try { campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all(); } catch (e) {}

  let handoutCategories = [];
  try { handoutCategories = db.prepare('SELECT * FROM handout_categories ORDER BY parent_id NULLS FIRST, name').all(); } catch (e) {}

  const activeCampaignId = campaignFilter || null;

  res.render('handouts', { handouts, isDM, npcs, locations, campaigns, activeCampaignId, handoutCategories });
});

// Upload handout (DM)
router.post('/', requireLogin, requireDM, upload.single('image'), (req, res) => {
  const validateCSRF = req.app.locals.validateCSRF;
  if (!validateCSRF(req, res)) return;

  const { title, type, content, linked_npc_id, linked_location_id, campaign_id, category_id } = req.body;
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

  const campId = campaign_id ? parseInt(campaign_id, 10) : null;
  const catId = category_id ? parseInt(category_id, 10) : null;

  db.prepare(`INSERT INTO handouts (title, type, content, image_path, linked_npc_id, linked_location_id, category_id, created_by, campaign_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title.trim(), handoutType, textContent, imagePath, npcId, locId, catId, req.user.id, campId);

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

  sse.broadcast('handout-reveal', { title: handout.title, type: handout.type, id: handout.id, content: handout.content || null, image_path: handout.image_path || null });

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
  const { title, linked_npc_id, linked_location_id, campaign_id, category_id } = req.body;
  const handout = db.prepare('SELECT id FROM handouts WHERE id = ?').get(req.params.id);
  if (!handout) {
    req.flash('error', 'Handout not found.');
    return res.redirect('/handouts');
  }
  const campId = campaign_id ? parseInt(campaign_id, 10) : null;
  const catId = category_id ? parseInt(category_id, 10) : null;
  db.prepare('UPDATE handouts SET title = ?, linked_npc_id = ?, linked_location_id = ?, campaign_id = ?, category_id = ? WHERE id = ?')
    .run((title && title.trim()) || 'Untitled', linked_npc_id ? parseInt(linked_npc_id, 10) : null, linked_location_id ? parseInt(linked_location_id, 10) : null, campId, catId, handout.id);
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

// === Handout Category CRUD ===

// Create category
router.post('/categories', requireLogin, requireDM, (req, res) => {
  const validateCSRF = req.app.locals.validateCSRF;
  if (!validateCSRF(req, res)) return;

  const { name, parent_id } = req.body;
  if (!name || !name.trim()) {
    req.flash('error', 'Category name is required.');
    return res.redirect('/handouts');
  }
  const parentId = parent_id ? parseInt(parent_id, 10) : null;
  if (parentId) {
    const parent = db.prepare('SELECT id FROM handout_categories WHERE id = ?').get(parentId);
    if (!parent) {
      req.flash('error', 'Parent category not found.');
      return res.redirect('/handouts');
    }
  }
  db.prepare('INSERT INTO handout_categories (name, parent_id, created_by) VALUES (?, ?, ?)')
    .run(name.trim(), parentId, req.user.id);
  req.flash('success', 'Category created.');
  res.redirect('/handouts');
});

// Edit category
router.post('/categories/:catId/edit', requireLogin, requireDM, (req, res) => {
  const validateCSRF = req.app.locals.validateCSRF;
  if (!validateCSRF(req, res)) return;

  const { name, parent_id } = req.body;
  const catId = parseInt(req.params.catId, 10);
  const cat = db.prepare('SELECT id FROM handout_categories WHERE id = ?').get(catId);
  if (!cat) {
    req.flash('error', 'Category not found.');
    return res.redirect('/handouts');
  }
  const parentId = parent_id ? parseInt(parent_id, 10) : null;
  if (parentId === catId) {
    req.flash('error', 'Category cannot be its own parent.');
    return res.redirect('/handouts');
  }
  db.prepare('UPDATE handout_categories SET name = ?, parent_id = ? WHERE id = ?')
    .run((name && name.trim()) || 'Unnamed', parentId, catId);
  req.flash('success', 'Category updated.');
  res.redirect('/handouts');
});

// Delete category
router.post('/categories/:catId/delete', requireLogin, requireDM, (req, res) => {
  const validateCSRF = req.app.locals.validateCSRF;
  if (!validateCSRF(req, res)) return;

  const catId = parseInt(req.params.catId, 10);
  const cat = db.prepare('SELECT id FROM handout_categories WHERE id = ?').get(catId);
  if (!cat) {
    req.flash('error', 'Category not found.');
    return res.redirect('/handouts');
  }
  // Clear category_id from handouts in this category and descendants
  const descendants = [];
  function findDescendants(pid) {
    const children = db.prepare('SELECT id FROM handout_categories WHERE parent_id = ?').all(pid);
    for (const child of children) {
      descendants.push(child.id);
      findDescendants(child.id);
    }
  }
  findDescendants(catId);
  const allIds = [catId, ...descendants];
  for (const id of allIds) {
    db.prepare('UPDATE handouts SET category_id = NULL WHERE category_id = ?').run(id);
  }
  db.prepare('DELETE FROM handout_categories WHERE id = ?').run(catId);
  req.flash('success', 'Category deleted.');
  res.redirect('/handouts');
});

module.exports = router;
