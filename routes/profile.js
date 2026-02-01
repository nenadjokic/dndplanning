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
    const charClass = req.body.class || null;
    const charRace = req.body.race || null;
    if (!name || !name.trim()) {
      req.flash('error', 'Character name is required.');
      return res.redirect('/profile');
    }
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM characters WHERE user_id = ?').get(req.user.id);
    const order = (maxOrder.m || 0) + 1;
    const result = db.prepare('INSERT INTO characters (user_id, name, description, class, race, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, name.trim(), description || null, charClass, charRace, order);

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
    const charClass = req.body.class || null;
    const charRace = req.body.race || null;
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

    db.prepare('UPDATE characters SET name = ?, description = ?, class = ?, race = ?, avatar = ? WHERE id = ?')
      .run(name.trim(), description || null, charClass, charRace, avatar, char.id);
    req.flash('success', 'Character updated.');
    res.redirect('/profile');
  } catch (err) {
    console.error('Error editing character:', err);
    req.flash('error', 'Failed to update character.');
    res.redirect('/profile');
  }
});

// Character sheet — edit (owner only)
router.get('/characters/:id/sheet', requireLogin, (req, res) => {
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!char) {
    req.flash('error', 'Character not found.');
    return res.redirect('/profile');
  }
  let sheetData = null;
  try { sheetData = char.sheet_data ? JSON.parse(char.sheet_data) : null; } catch (e) { /* invalid JSON */ }
  res.render('character-sheet', {
    character: char,
    sheetData,
    editable: true,
    backUrl: '/profile'
  });
});

// Character sheet — save (owner only)
router.post('/characters/:id/sheet', requireLogin, (req, res) => {
  const char = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!char) {
    req.flash('error', 'Character not found.');
    return res.redirect('/profile');
  }

  const b = req.body;
  const sheetData = {
    character_name: b.character_name || '',
    class_level: b.class_level || '',
    background: b.background || '',
    race: b.race || '',
    alignment: b.alignment || '',
    xp: b.xp || '',
    // Ability scores
    str_score: b.str_score || '', str_mod: b.str_mod || '',
    dex_score: b.dex_score || '', dex_mod: b.dex_mod || '',
    con_score: b.con_score || '', con_mod: b.con_mod || '',
    int_score: b.int_score || '', int_mod: b.int_mod || '',
    wis_score: b.wis_score || '', wis_mod: b.wis_mod || '',
    cha_score: b.cha_score || '', cha_mod: b.cha_mod || '',
    // Inspiration & proficiency
    inspiration: b.inspiration ? true : false,
    proficiency_bonus: b.proficiency_bonus || '',
    // Saving throws
    save_str_prof: b.save_str_prof ? true : false, save_str_val: b.save_str_val || '',
    save_dex_prof: b.save_dex_prof ? true : false, save_dex_val: b.save_dex_val || '',
    save_con_prof: b.save_con_prof ? true : false, save_con_val: b.save_con_val || '',
    save_int_prof: b.save_int_prof ? true : false, save_int_val: b.save_int_val || '',
    save_wis_prof: b.save_wis_prof ? true : false, save_wis_val: b.save_wis_val || '',
    save_cha_prof: b.save_cha_prof ? true : false, save_cha_val: b.save_cha_val || '',
    // Passive perception
    passive_perception: b.passive_perception || '',
    // Combat
    ac: b.ac || '', initiative: b.initiative || '', speed: b.speed || '',
    hp_max: b.hp_max || '', hp_current: b.hp_current || '', hp_temp: b.hp_temp || '',
    hit_dice: b.hit_dice || '', death_saves: b.death_saves || '',
    // Personality
    personality_traits: b.personality_traits || '',
    ideals: b.ideals || '',
    bonds: b.bonds || '',
    flaws: b.flaws || '',
    features_traits: b.features_traits || '',
    proficiencies_languages: b.proficiencies_languages || '',
    equipment: b.equipment || '',
    // Biography
    age: b.age || '', height: b.height || '', weight: b.weight || '',
    eyes: b.eyes || '', skin: b.skin || '', hair: b.hair || '',
    appearance: b.appearance || '', backstory: b.backstory || '',
    allies: b.allies || '', additional_features: b.additional_features || '',
    treasure: b.treasure || '',
    // Spellcasting header
    spell_class: b.spell_class || '', spell_ability: b.spell_ability || '',
    spell_save_dc: b.spell_save_dc || '', spell_attack_bonus: b.spell_attack_bonus || ''
  };

  // Skills
  const skillKeys = ['acrobatics','animal_handling','arcana','athletics','deception','history','insight','intimidation','investigation','medicine','nature','perception','performance','persuasion','religion','sleight_of_hand','stealth','survival'];
  for (const sk of skillKeys) {
    sheetData['skill_' + sk + '_prof'] = b['skill_' + sk + '_prof'] ? true : false;
    sheetData['skill_' + sk + '_val'] = b['skill_' + sk + '_val'] || '';
  }

  // Currency
  sheetData.currency = {
    cp: b.currency_cp || '', sp: b.currency_sp || '',
    ep: b.currency_ep || '', gp: b.currency_gp || '', pp: b.currency_pp || ''
  };

  // Attacks (up to 10)
  sheetData.attacks = [];
  for (let i = 0; i < 10; i++) {
    const name = b['attack_' + i + '_name'] || '';
    const bonus = b['attack_' + i + '_bonus'] || '';
    const damage = b['attack_' + i + '_damage'] || '';
    if (name || bonus || damage) {
      sheetData.attacks.push({ name, bonus, damage });
    }
  }

  // Cantrips (up to 10)
  sheetData.cantrips = [];
  for (let i = 0; i < 10; i++) {
    const c = b['cantrip_' + i] || '';
    if (c) sheetData.cantrips.push(c);
  }

  // Spells per level 1-9
  sheetData.spells = {};
  for (let lvl = 1; lvl <= 9; lvl++) {
    const lvlData = {
      slots_total: b['spell_' + lvl + '_slots_total'] || '',
      slots_used: b['spell_' + lvl + '_slots_used'] || '',
      spells: []
    };
    for (let i = 0; i < 15; i++) {
      const name = b['spell_' + lvl + '_' + i + '_name'] || '';
      const prepared = b['spell_' + lvl + '_' + i + '_prepared'] ? true : false;
      if (name || prepared) {
        lvlData.spells.push({ name, prepared });
      }
    }
    if (lvlData.slots_total || lvlData.slots_used || lvlData.spells.length > 0) {
      sheetData.spells[lvl] = lvlData;
    }
  }

  db.prepare('UPDATE characters SET sheet_data = ? WHERE id = ?').run(JSON.stringify(sheetData), char.id);
  req.flash('success', 'Character sheet saved.');
  res.redirect('/profile/characters/' + char.id + '/sheet');
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

// Public character sheet — read-only
router.get('/:username/character/:id/sheet', requireLogin, (req, res) => {
  const profileUser = db.prepare('SELECT id, username, role, avatar FROM users WHERE username = ?').get(req.params.username);
  if (!profileUser) {
    req.flash('error', 'User not found.');
    return res.redirect('/');
  }
  const character = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(req.params.id, profileUser.id);
  if (!character || !character.sheet_data) {
    req.flash('error', 'Character sheet not found.');
    return res.redirect('/profile/' + req.params.username);
  }
  let sheetData = null;
  try { sheetData = JSON.parse(character.sheet_data); } catch (e) { /* invalid JSON */ }
  res.render('character-sheet', {
    character,
    sheetData,
    editable: false,
    backUrl: '/profile/' + req.params.username + '/character/' + character.id
  });
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
