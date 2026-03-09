const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/connection');
const { requireLogin, requireDM } = require('../middleware/auth');
const adventurePack = require('../helpers/adventure-pack');

const dataDir = path.join(__dirname, '..', 'data');
const uploadDir = path.join(dataDir, 'temp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.qpa')) {
      cb(null, true);
    } else {
      cb(new Error('Only .qpa files are allowed'));
    }
  }
});

// Main page — My Packs / Browse Store / Import / Submit
router.get('/', requireLogin, requireDM, (req, res) => {
  const packs = db.prepare(`
    SELECT ap.*, c.name as campaign_name
    FROM adventure_packs ap
    LEFT JOIN campaigns c ON ap.campaign_id = c.id
    ORDER BY ap.imported_at DESC
  `).all();

  const campaigns = db.prepare('SELECT id, name FROM campaigns ORDER BY name').all();
  const repos = db.prepare('SELECT * FROM adventure_pack_repositories ORDER BY added_at DESC').all();

  res.render('adventure-packs', {
    user: req.user,
    packs,
    campaigns,
    repos,
    tab: req.query.tab || 'my-packs',
    settings: req.app.get('siteSettings') || {}
  });
});

// --- EXPORT ---

// Export page: choose what to include
router.get('/export/:campaignId', requireLogin, requireDM, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
  if (!campaign) return res.redirect('/adventure-packs');

  // Count data for this campaign
  const counts = {
    maps: db.prepare('SELECT COUNT(*) as c FROM maps WHERE campaign_id = ?').get(campaign.id).c,
    npcs: 0,
    locations: 0,
    links: 0,
    lootChests: 0,
    lootItems: db.prepare('SELECT COUNT(*) as c FROM loot_items WHERE campaign_id = ?').get(campaign.id).c,
    quests: db.prepare('SELECT COUNT(*) as c FROM quests WHERE campaign_id = ?').get(campaign.id).c,
    arcs: db.prepare('SELECT COUNT(*) as c FROM campaign_arcs WHERE campaign_id = ?').get(campaign.id).c,
    handouts: db.prepare('SELECT COUNT(*) as c FROM handouts WHERE campaign_id = ?').get(campaign.id).c
  };

  // Count NPCs on campaign maps
  const mapIds = db.prepare('SELECT id FROM maps WHERE campaign_id = ?').all(campaign.id).map(r => r.id);
  if (mapIds.length > 0) {
    const ph = mapIds.map(() => '?').join(',');
    counts.npcs = db.prepare(`SELECT COUNT(DISTINCT npc_token_id) as c FROM map_npc_tokens WHERE map_id IN (${ph})`).get(...mapIds).c;
    counts.locations = db.prepare(`SELECT COUNT(*) as c FROM map_locations WHERE map_id IN (${ph})`).get(...mapIds).c;
    counts.links = db.prepare(`SELECT COUNT(*) as c FROM map_links WHERE source_map_id IN (${ph}) AND target_map_id IN (${ph})`).get(...mapIds, ...mapIds).c;
    counts.lootChests = db.prepare(`SELECT COUNT(*) as c FROM map_loot_chests WHERE map_id IN (${ph})`).get(...mapIds).c;
  }

  res.render('adventure-pack-export', {
    user: req.user,
    campaign,
    counts,
    settings: req.app.get('siteSettings') || {}
  });
});

// Perform export
router.post('/export/:campaignId', requireLogin, requireDM, express.urlencoded({ extended: false }), (req, res) => {
  try {
    const options = {
      maps: req.body.maps === 'on',
      npcs: req.body.npcs === 'on',
      loot: req.body.loot === 'on',
      quests: req.body.quests === 'on',
      locations: req.body.locations === 'on',
      links: req.body.links === 'on',
      handouts: req.body.handouts === 'on'
    };

    const meta = {
      name: (req.body.name || '').trim(),
      description: (req.body.description || '').trim(),
      author: (req.body.author || '').trim(),
      levelMin: parseInt(req.body.levelMin) || null,
      levelMax: parseInt(req.body.levelMax) || null
    };

    const result = adventurePack.exportPack(db, {
      campaignId: parseInt(req.params.campaignId),
      userId: req.user.id,
      options,
      meta
    });

    // Send file for download
    res.download(result.filePath, result.fileName, (err) => {
      // Clean up the file after download
      try { fs.unlinkSync(result.filePath); } catch (e) { /* ignore */ }
    });
  } catch (err) {
    console.error('[Adventure Pack] Export error:', err);
    req.session.flash = { type: 'error', message: 'Export failed: ' + err.message };
    res.redirect('/adventure-packs');
  }
});

// --- IMPORT ---

// Upload .qpa file
router.post('/import', requireLogin, requireDM, upload.single('pack'), (req, res) => {
  // Validate CSRF for multipart upload
  if (!req.app.locals.validateCSRF(req, res)) return;

  if (!req.file) {
    req.session.flash = { type: 'error', message: 'No file uploaded' };
    return res.redirect('/adventure-packs?tab=import');
  }

  try {
    const { manifest, tempDir } = adventurePack.previewPack(req.file.path);

    // Store preview info in session
    req.session.packImport = {
      tempDir,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      manifest
    };

    // Clean up uploaded file (already extracted)
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.redirect('/adventure-packs/import-confirm');
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
    console.error('[Adventure Pack] Import preview error:', err);
    req.session.flash = { type: 'error', message: 'Invalid adventure pack: ' + err.message };
    res.redirect('/adventure-packs?tab=import');
  }
});

// Import confirmation page
router.get('/import-confirm', requireLogin, requireDM, (req, res) => {
  if (!req.session.packImport) return res.redirect('/adventure-packs?tab=import');

  res.render('adventure-pack-confirm', {
    user: req.user,
    pack: req.session.packImport,
    settings: req.app.get('siteSettings') || {}
  });
});

// Cancel import
router.post('/import-cancel', requireLogin, requireDM, (req, res) => {
  if (req.session.packImport && req.session.packImport.tempDir) {
    try { fs.rmSync(req.session.packImport.tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  delete req.session.packImport;
  res.redirect('/adventure-packs?tab=import');
});

// Perform import
router.post('/import-confirm', requireLogin, requireDM, (req, res) => {
  if (!req.session.packImport) return res.redirect('/adventure-packs?tab=import');

  const { tempDir, manifest } = req.session.packImport;
  delete req.session.packImport;

  try {
    const result = adventurePack.importPack(db, tempDir, req.user.id);
    req.session.flash = {
      type: 'success',
      message: `Adventure pack "${result.manifest.name}" imported! ${result.mapCount} maps, ${result.npcCount} NPCs created.`
    };
    res.redirect('/adventure-packs');
  } catch (err) {
    console.error('[Adventure Pack] Import error:', err);
    req.session.flash = { type: 'error', message: 'Import failed: ' + err.message };
    res.redirect('/adventure-packs?tab=import');
  }
});

// --- DELETE ---

router.post('/delete/:id', requireLogin, requireDM, (req, res) => {
  try {
    adventurePack.deletePack(db, parseInt(req.params.id), req.user.id);
    req.session.flash = { type: 'success', message: 'Adventure pack deleted successfully.' };
  } catch (err) {
    console.error('[Adventure Pack] Delete error:', err);
    req.session.flash = { type: 'error', message: 'Delete failed: ' + err.message };
  }
  res.redirect('/adventure-packs');
});

// --- BROWSE STORE ---

router.get('/registry', requireLogin, requireDM, async (req, res) => {
  try {
    const repos = db.prepare('SELECT * FROM adventure_pack_repositories').all();
    // Default repo
    const defaultRepo = 'https://raw.githubusercontent.com/nenadjokic/questplanner-adventure-packs/main/registry.json';
    const repoUrls = repos.length > 0 ? repos.map(r => r.url) : [defaultRepo];

    const allPacks = [];
    for (const url of repoUrls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const data = await response.json();
          if (data.packs && Array.isArray(data.packs)) {
            allPacks.push(...data.packs);
          }
        }
      } catch (e) {
        console.warn('[Adventure Pack] Failed to fetch registry:', url, e.message);
      }
    }

    // Mark already-installed packs
    const installed = db.prepare('SELECT pack_id FROM adventure_packs').all().map(r => r.pack_id);
    for (const pack of allPacks) {
      pack.installed = installed.includes(pack.id);
    }

    res.json({ packs: allPacks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Install from store
router.post('/install-remote', requireLogin, requireDM, express.json(), async (req, res) => {
  const { downloadUrl, packId } = req.body;
  if (!downloadUrl) return res.status(400).json({ error: 'Download URL required' });

  // SSRF protection: only allow HTTPS URLs from github.com domains
  try {
    const parsed = new URL(downloadUrl);
    const allowedHosts = ['github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com'];
    if (parsed.protocol !== 'https:' || !allowedHosts.some(h => parsed.hostname === h || parsed.hostname.endsWith('.' + h))) {
      return res.status(400).json({ error: 'Downloads are only allowed from GitHub' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid download URL' });
  }

  try {
    // Download the .qpa file
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Download failed: ' + response.statusText);

    const buffer = Buffer.from(await response.arrayBuffer());
    const tempFile = path.join(uploadDir, `store-${Date.now()}.qpa`);
    fs.writeFileSync(tempFile, buffer);

    // Extract and import
    const { manifest, tempDir } = adventurePack.previewPack(tempFile);
    try { fs.unlinkSync(tempFile); } catch (e) { /* ignore */ }

    const result = adventurePack.importPack(db, tempDir, req.user.id);

    // Update import source to 'store'
    db.prepare("UPDATE adventure_packs SET import_source = 'store' WHERE pack_id = ? AND imported_by = ? ORDER BY id DESC LIMIT 1")
      .run(manifest.id, req.user.id);

    res.json({
      success: true,
      message: `Imported "${result.manifest.name}" — ${result.mapCount} maps, ${result.npcCount} NPCs`
    });
  } catch (err) {
    console.error('[Adventure Pack] Remote install error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- REPOSITORIES ---

router.post('/repos', requireLogin, requireDM, express.json(), (req, res) => {
  const url = (req.body.url || '').trim();
  const name = (req.body.name || 'Custom Repository').trim();
  if (!url) return res.status(400).json({ error: 'URL required' });

  // Validate URL format — only allow HTTPS
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  try {
    db.prepare('INSERT INTO adventure_pack_repositories (name, url) VALUES (?, ?)').run(name, url);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Repository already exists or invalid' });
  }
});

router.delete('/repos/:id', requireLogin, requireDM, (req, res) => {
  db.prepare('DELETE FROM adventure_pack_repositories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// --- SUBMIT TO STORE ---

// Campaign info for submit tab
router.get('/submit-info/:campaignId', requireLogin, requireDM, (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const mapIds = db.prepare('SELECT id FROM maps WHERE campaign_id = ?').all(campaign.id).map(r => r.id);
  const counts = { maps: mapIds.length, npcs: 0, locations: 0, lootChests: 0, quests: 0, handouts: 0 };
  if (mapIds.length > 0) {
    const ph = mapIds.map(() => '?').join(',');
    counts.npcs = db.prepare(`SELECT COUNT(DISTINCT npc_token_id) as c FROM map_npc_tokens WHERE map_id IN (${ph})`).get(...mapIds).c;
    counts.locations = db.prepare(`SELECT COUNT(*) as c FROM map_locations WHERE map_id IN (${ph})`).get(...mapIds).c;
    counts.lootChests = db.prepare(`SELECT COUNT(*) as c FROM map_loot_chests WHERE map_id IN (${ph})`).get(...mapIds).c;
  }
  counts.quests = db.prepare('SELECT COUNT(*) as c FROM quests WHERE campaign_id = ?').get(campaign.id).c;
  counts.handouts = db.prepare('SELECT COUNT(*) as c FROM handouts WHERE campaign_id = ?').get(campaign.id).c;

  res.json({
    name: campaign.name,
    description: campaign.description || '',
    counts
  });
});

// Generate pre-filled GitHub issue URL
router.post('/submit', requireLogin, requireDM, express.json(), (req, res) => {
  const { campaignId, name, description, author, levelMin, levelMax, notes } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'Campaign required' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const mapIds = db.prepare('SELECT id FROM maps WHERE campaign_id = ?').all(campaign.id).map(r => r.id);
  let npcCount = 0, locationCount = 0, lootCount = 0;
  if (mapIds.length > 0) {
    const ph = mapIds.map(() => '?').join(',');
    npcCount = db.prepare(`SELECT COUNT(DISTINCT npc_token_id) as c FROM map_npc_tokens WHERE map_id IN (${ph})`).get(...mapIds).c;
    locationCount = db.prepare(`SELECT COUNT(*) as c FROM map_locations WHERE map_id IN (${ph})`).get(...mapIds).c;
    lootCount = db.prepare(`SELECT COUNT(*) as c FROM map_loot_chests WHERE map_id IN (${ph})`).get(...mapIds).c;
  }
  const questCount = db.prepare('SELECT COUNT(*) as c FROM quests WHERE campaign_id = ?').get(campaign.id).c;
  const handoutCount = db.prepare('SELECT COUNT(*) as c FROM handouts WHERE campaign_id = ?').get(campaign.id).c;

  const packName = name || campaign.name;
  const issueTitle = `[Adventure Pack Submission] ${packName}`;
  const issueBody = [
    `## Adventure Pack Submission`,
    ``,
    `**Pack Name:** ${packName}`,
    `**Author:** ${author || 'Unknown'}`,
    `**Description:** ${description || 'No description'}`,
    `**Level Range:** ${levelMin || '?'} – ${levelMax || '?'}`,
    ``,
    `### Contents`,
    `| Content | Count |`,
    `|---------|-------|`,
    `| Maps | ${mapIds.length} |`,
    `| NPCs | ${npcCount} |`,
    `| Locations | ${locationCount} |`,
    `| Loot Chests | ${lootCount} |`,
    `| Quests | ${questCount} |`,
    `| Handouts | ${handoutCount} |`,
    ``,
    `### Notes`,
    notes || 'No additional notes.',
    ``,
    `### Attachment`,
    `Please attach the .qpa file below.`,
    ``,
    `---`,
    `*Submitted from Quest Planner v${require('../package.json').version}*`
  ].join('\n');

  const githubUrl = `https://github.com/nenadjokic/questplanner-adventure-packs/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}&labels=submission`;

  res.json({ success: true, githubUrl });
});

// Export for submission (re-export an imported pack)
router.get('/export-pack/:id', requireLogin, requireDM, (req, res) => {
  const pack = db.prepare('SELECT * FROM adventure_packs WHERE id = ?').get(req.params.id);
  if (!pack) {
    req.session.flash = { type: 'error', message: 'Pack not found' };
    return res.redirect('/adventure-packs');
  }

  if (!pack.campaign_id) {
    req.session.flash = { type: 'error', message: 'Pack has no associated campaign' };
    return res.redirect('/adventure-packs');
  }

  res.redirect(`/adventure-packs/export/${pack.campaign_id}`);
});

module.exports = router;
