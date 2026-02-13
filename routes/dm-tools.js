const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const router = express.Router();

const thumbDir = path.join(__dirname, '..', 'data', 'thumbnails');
try {
  if (!fs.existsSync(thumbDir)) {
    fs.mkdirSync(thumbDir, { recursive: true });
  }
} catch (err) {
  console.warn('⚠️  Could not create thumbnails directory. Thumbnail generation may not work.');
  console.warn('   Fix: sudo chmod -R 777 $(docker volume inspect <volume-name> -f \'{{.Mountpoint}}\')');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

async function cropAndSave(buffer) {
  const filename = 'tool-' + Date.now() + '.png';
  const outPath = path.join(thumbDir, filename);
  await sharp(buffer)
    .resize(128, 128, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(outPath);
  return filename;
}

function deleteThumb(filename) {
  if (!filename) return;
  const p = path.join(thumbDir, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

router.get('/', requireLogin, requireDM, (req, res) => {
  const tools = db.prepare('SELECT * FROM dm_tools ORDER BY sort_order, created_at').all();
  res.render('dm/tools', { tools });
});

router.post('/', requireLogin, requireDM, upload.single('thumbnail'), async (req, res) => {
  try {
    const { name, url, icon, favicon_file } = req.body;
    if (!name || !name.trim() || !url || !url.trim()) {
      req.flash('error', 'Name and URL are required.');
      return res.redirect('/dm-tools');
    }
    const validIcons = ['link', 'dice', 'scroll', 'book', 'music', 'map', 'sword', 'shield', 'potion', 'skull', 'dragon', 'wand', 'gem', 'crown', 'hammer', 'eye'];
    const toolIcon = validIcons.includes(icon) ? icon : 'link';
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM dm_tools').get();
    const order = (maxOrder.m || 0) + 1;
    let thumbnail = req.file ? await cropAndSave(req.file.buffer) : null;
    if (!thumbnail && favicon_file) thumbnail = favicon_file;
    db.prepare('INSERT INTO dm_tools (name, url, icon, sort_order, created_by, thumbnail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name.trim(), url.trim(), toolIcon, order, req.user.id, thumbnail);
    req.flash('success', 'Tool added to the board!');
    res.redirect('/dm-tools');
  } catch (err) {
    console.error('Error adding tool:', err);
    req.flash('error', 'Failed to add tool.');
    res.redirect('/dm-tools');
  }
});

router.post('/:id/edit', requireLogin, requireDM, upload.single('thumbnail'), async (req, res) => {
  try {
    const { name, url, icon, remove_thumbnail, favicon_file } = req.body;
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
      deleteThumb(tool.thumbnail);
      thumbnail = await cropAndSave(req.file.buffer);
    } else if (favicon_file) {
      deleteThumb(tool.thumbnail);
      thumbnail = favicon_file;
    } else if (remove_thumbnail === '1') {
      deleteThumb(tool.thumbnail);
      thumbnail = null;
    }

    db.prepare('UPDATE dm_tools SET name = ?, url = ?, icon = ?, thumbnail = ? WHERE id = ?')
      .run(name.trim(), url.trim(), toolIcon, thumbnail, tool.id);
    req.flash('success', 'Tool updated.');
    res.redirect('/dm-tools');
  } catch (err) {
    console.error('Error editing tool:', err);
    req.flash('error', 'Failed to update tool.');
    res.redirect('/dm-tools');
  }
});

router.post('/fetch-favicon', requireLogin, requireDM, async (req, res) => {
  try {
    const axios = require('axios');
    const { url } = req.body;
    if (!url || !url.trim()) {
      return res.json({ success: false, error: 'URL is required' });
    }

    // Fetch the page HTML to find favicon
    let pageUrl = url.trim();
    if (!/^https?:\/\//i.test(pageUrl)) pageUrl = 'https://' + pageUrl;
    const origin = new URL(pageUrl).origin;

    let faviconUrl = null;
    try {
      const resp = await axios.get(pageUrl, { timeout: 8000, maxRedirects: 5, responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = resp.data;
      // Look for <link rel="icon" href="..."> or rel="shortcut icon"
      const iconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
      if (iconMatch) {
        faviconUrl = iconMatch[1];
      }
      // Also check for apple-touch-icon (higher quality)
      const appleMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)
        || html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']apple-touch-icon["']/i);
      if (appleMatch) {
        faviconUrl = appleMatch[1]; // prefer apple-touch-icon (usually larger)
      }
    } catch (e) {
      // If page fetch fails, fall through to /favicon.ico
    }

    // Default fallback
    if (!faviconUrl) faviconUrl = '/favicon.ico';

    // Resolve relative URL
    if (faviconUrl.startsWith('//')) {
      faviconUrl = 'https:' + faviconUrl;
    } else if (faviconUrl.startsWith('/')) {
      faviconUrl = origin + faviconUrl;
    } else if (!/^https?:\/\//i.test(faviconUrl)) {
      faviconUrl = origin + '/' + faviconUrl;
    }

    // Download the favicon image
    const imgResp = await axios.get(faviconUrl, { timeout: 8000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const buffer = Buffer.from(imgResp.data);

    // Crop and save using sharp
    const filename = await cropAndSave(buffer);
    res.json({ success: true, filename });
  } catch (err) {
    console.error('Favicon fetch error:', err.message);
    res.json({ success: false, error: 'Could not fetch favicon from this URL' });
  }
});

router.post('/:id/delete', requireLogin, requireDM, (req, res) => {
  const tool = db.prepare('SELECT * FROM dm_tools WHERE id = ?').get(req.params.id);
  if (!tool) {
    req.flash('error', 'Tool not found.');
    return res.redirect('/dm-tools');
  }
  deleteThumb(tool.thumbnail);
  db.prepare('DELETE FROM dm_tools WHERE id = ?').run(tool.id);
  req.flash('success', 'Tool removed.');
  res.redirect('/dm-tools');
});

module.exports = router;
