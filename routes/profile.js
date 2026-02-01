const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const db = require('../db/connection');
const { requireLogin } = require('../middleware/auth');
const router = express.Router();

const avatarDir = path.join(__dirname, '..', 'data', 'avatars');
if (!fs.existsSync(avatarDir)) {
  fs.mkdirSync(avatarDir, { recursive: true });
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, req.user.id + ext);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

const charAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

async function cropCharAvatar(buffer, charId) {
  const filename = 'char-' + charId + '.png';
  const outPath = path.join(avatarDir, filename);
  await sharp(buffer)
    .resize(256, 256, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(outPath);
  return filename;
}

function deleteCharAvatar(filename) {
  if (!filename) return;
  const p = path.join(avatarDir, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// Own profile — edit page
router.get('/', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar, birthday, about, character_info, character_avatar FROM users WHERE id = ?').get(req.user.id);
  const characters = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
  res.render('profile', { profileUser, characters });
});

// Save profile info
router.post('/', requireLogin, (req, res) => {
  const { birthday, about, character_info } = req.body;
  db.prepare('UPDATE users SET birthday = ?, about = ?, character_info = ? WHERE id = ?').run(
    birthday || null,
    about || null,
    character_info || null,
    req.user.id
  );
  req.flash('success', 'Profile updated.');
  res.redirect('/profile');
});

// Avatar upload
router.post('/avatar', requireLogin, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Avatar upload failed.');
      return res.redirect('/profile');
    }
    if (!req.file) {
      req.flash('error', 'No file selected.');
      return res.redirect('/profile');
    }

    const currentAvatar = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id).avatar;
    if (currentAvatar) {
      const oldPath = path.join(avatarDir, currentAvatar);
      if (oldPath !== req.file.path && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const filename = req.file.filename;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(filename, req.user.id);
    req.flash('success', 'Avatar updated.');
    res.redirect('/profile');
  });
});

// Legacy character avatar upload (kept for backwards compat)
router.post('/character-avatar', requireLogin, (req, res) => {
  const legacyUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, avatarDir),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'char-' + req.user.id + ext);
      }
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  });
  legacyUpload.single('character_avatar')(req, res, (err) => {
    if (err) {
      req.flash('error', err.message || 'Character avatar upload failed.');
      return res.redirect('/profile');
    }
    if (!req.file) {
      req.flash('error', 'No file selected.');
      return res.redirect('/profile');
    }

    const currentCharAvatar = db.prepare('SELECT character_avatar FROM users WHERE id = ?').get(req.user.id).character_avatar;
    if (currentCharAvatar) {
      const oldPath = path.join(avatarDir, currentCharAvatar);
      if (oldPath !== req.file.path && fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const filename = req.file.filename;
    db.prepare('UPDATE users SET character_avatar = ? WHERE id = ?').run(filename, req.user.id);
    req.flash('success', 'Character avatar updated.');
    res.redirect('/profile');
  });
});

// Add new character
router.post('/characters', requireLogin, charAvatarUpload.single('avatar'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Character name is required.');
      return res.redirect('/profile');
    }
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM characters WHERE user_id = ?').get(req.user.id);
    const order = (maxOrder.m || 0) + 1;
    const result = db.prepare('INSERT INTO characters (user_id, name, description, sort_order) VALUES (?, ?, ?, ?)')
      .run(req.user.id, name.trim(), description || null, order);

    if (req.file) {
      const filename = await cropCharAvatar(req.file.buffer, result.lastInsertRowid);
      db.prepare('UPDATE characters SET avatar = ? WHERE id = ?').run(filename, result.lastInsertRowid);
    }

    req.flash('success', 'Character added!');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error adding character:', err);
    req.flash('error', 'Failed to add character.');
    res.redirect('/profile');
  }
});

// Edit character
router.post('/characters/:id/edit', requireLogin, charAvatarUpload.single('avatar'), async (req, res) => {
  try {
    const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!char) {
      req.flash('error', 'Character not found.');
      return res.redirect('/profile');
    }

    const { name, description, remove_avatar } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Character name is required.');
      return res.redirect('/profile');
    }

    let avatar = char.avatar;
    if (req.file) {
      deleteCharAvatar(char.avatar);
      avatar = await cropCharAvatar(req.file.buffer, char.id);
    } else if (remove_avatar === '1') {
      deleteCharAvatar(char.avatar);
      avatar = null;
    }

    db.prepare('UPDATE characters SET name = ?, description = ?, avatar = ? WHERE id = ?')
      .run(name.trim(), description || null, avatar, char.id);
    req.flash('success', 'Character updated.');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error editing character:', err);
    req.flash('error', 'Failed to update character.');
    res.redirect('/profile');
  }
});

// Delete character
router.post('/characters/:id/delete', requireLogin, (req, res) => {
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!char) {
    req.flash('error', 'Character not found.');
    return res.redirect('/profile');
  }
  deleteCharAvatar(char.avatar);
  db.prepare('DELETE FROM characters WHERE id = ?').run(char.id);
  req.flash('success', 'Character removed.');
  res.redirect('/profile');
});

// Public profile — read-only
router.get('/:username', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar, birthday, about, character_info, character_avatar FROM users WHERE username = ?').get(req.params.username);
  if (!profileUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/');
  }
  const characters = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY sort_order, created_at').all(profileUser.id);
  res.render('profile-public', { profileUser, characters });
});

// Public character detail — read-only
router.get('/:username/character/:id', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar FROM users WHERE username = ?').get(req.params.username);
  if (!profileUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/');
  }
  const character = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, profileUser.id);
  if (!character) {
    req.flash('error', 'Character not found.');
    return res.redirect('/profile/' + req.params.username);
  }
  res.render('character-detail', { profileUser, character });
});

module.exports = router;
