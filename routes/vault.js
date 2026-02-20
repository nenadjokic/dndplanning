const express = require('express');
const router = express.Router();
const vaultLocal = require('../helpers/vault-local');

// Vault page
router.get('/', (req, res) => {
  if (!req.user) return res.redirect('/login');
  res.render('vault');
});

// Species/Races list
router.get('/species', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const search = req.query.search || '';

  try {
    const results = vaultLocal.getRacesList(search);
    res.json({ results });
  } catch (err) {
    console.error('[Vault Species] Error:', err.message);
    res.json({ results: [] });
  }
});

// Species/Race details
router.get('/species/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const race = vaultLocal.getRaceDetails(req.params.key);
    if (race) {
      return res.json(race);
    }
    res.json({ error: 'Species not found' });
  } catch (err) {
    console.error('[Vault Species Detail] Error:', err.message);
    res.json({ error: 'Failed to fetch' });
  }
});

// Classes list
router.get('/classes', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const search = req.query.search || '';

  try {
    const results = vaultLocal.getClassesList(search);
    res.json({ results });
  } catch (err) {
    console.error('[Vault Classes] Error:', err.message);
    res.json({ results: [] });
  }
});

// Class details
router.get('/classes/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const cls = vaultLocal.getClassDetails(req.params.key);
    if (cls) {
      return res.json(cls);
    }
    res.json({ error: 'Class not found' });
  } catch (err) {
    console.error('[Vault Class Detail] Error:', err.message);
    res.json({ error: 'Failed to fetch' });
  }
});

// Spells list
router.get('/spells', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const search = req.query.search || '';
  const level = req.query.level;
  const school = req.query.school;
  const source = req.query.source;
  const castType = req.query.castType;

  try {
    const results = vaultLocal.getSpellsList(search, level, school, source, castType);
    res.json({ results });
  } catch (err) {
    console.error('[Vault Spells] Error:', err.message);
    res.json({ results: [] });
  }
});

// Spell details (for character sheet)
router.get('/spells/details', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const name = req.query.name || '';

  if (!name) return res.json({ error: 'No spell name provided' });

  try {
    const spell = vaultLocal.getSpellDetails(name);
    if (spell) {
      return res.json(spell);
    }
    res.json({ error: 'Spell not found' });
  } catch (err) {
    console.error('[Spell Details] Error:', err.message);
    res.json({ error: 'Failed to fetch spell details' });
  }
});

// Items list
router.get('/items', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  const search = req.query.search || '';
  const category = req.query.category;
  const magic = req.query.magic;
  const rarity = req.query.rarity;

  try {
    const results = vaultLocal.getItemsList(search, category, magic, rarity);
    res.json({ results });
  } catch (err) {
    console.error('[Vault Items] Error:', err.message);
    res.json({ results: [] });
  }
});

// Item details
router.get('/items/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });

  try {
    const item = vaultLocal.getItemDetails(req.params.key);
    if (item) {
      return res.json(item);
    }
    res.json({ error: 'Item not found' });
  } catch (err) {
    console.error('[Vault Item Detail] Error:', err.message);
    res.json({ error: 'Failed to fetch' });
  }
});

// Feats list
router.get('/feats', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getFeatsList(req.query.search || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Feat details
router.get('/feats/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const feat = vaultLocal.getFeatDetails(req.params.key);
    if (feat) return res.json(feat);
    res.json({ error: 'Feat not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

// Optional Features list
router.get('/optfeatures', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getOptFeaturesList(req.query.search || '', req.query.type || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Optional Feature types (for filter dropdown)
router.get('/optfeatures/types', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ types: vaultLocal.getOptFeatureTypes() });
  } catch (err) { res.json({ types: [] }); }
});

// Optional Feature details
router.get('/optfeatures/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const feat = vaultLocal.getOptFeatureDetails(req.params.key);
    if (feat) return res.json(feat);
    res.json({ error: 'Optional feature not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

// Backgrounds list
router.get('/backgrounds', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getBackgroundsList(req.query.search || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Background details
router.get('/backgrounds/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const bg = vaultLocal.getBackgroundDetails(req.params.key);
    if (bg) return res.json(bg);
    res.json({ error: 'Background not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

// Monsters list
router.get('/monsters', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getMonstersList(req.query.search || '', req.query.cr || '', req.query.type || '', req.query.size || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Monster types (for filter dropdown)
router.get('/monsters/types', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ types: vaultLocal.getMonsterTypes() });
  } catch (err) { res.json({ types: [] }); }
});

// Monster details
router.get('/monsters/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const m = vaultLocal.getMonsterDetails(req.params.key);
    if (m) return res.json(m);
    res.json({ error: 'Monster not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

// Conditions list
router.get('/conditions', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getConditionsList(req.query.search || '', req.query.type || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Condition details
router.get('/conditions/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const c = vaultLocal.getConditionDetails(req.params.key);
    if (c) return res.json(c);
    res.json({ error: 'Condition not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

// Rules list
router.get('/rules', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    res.json({ results: vaultLocal.getRulesList(req.query.search || '') });
  } catch (err) { res.json({ results: [] }); }
});

// Rule details
router.get('/rules/:key', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  try {
    const r = vaultLocal.getRuleDetails(req.params.key);
    if (r) return res.json(r);
    res.json({ error: 'Rule not found' });
  } catch (err) { res.json({ error: 'Failed to fetch' }); }
});

module.exports = router;
