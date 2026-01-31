const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
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
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

const charAvatarUpload = multer({
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
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

// Own profile — edit page
router.get('/', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar, birthday, about, character_info, character_avatar FROM users WHERE id = ?').get(req.user.id);
  res.render('profile', { profileUser });
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

// Character avatar upload
router.post('/character-avatar', requireLogin, (req, res) => {
  charAvatarUpload.single('character_avatar')(req, res, (err) => {
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

// Public profile — read-only
router.get('/:username', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar, birthday, about, character_info, character_avatar FROM users WHERE username = ?').get(req.params.username);
  if (!profileUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/');
  }
  res.render('profile-public', { profileUser });
});

module.exports = router;
