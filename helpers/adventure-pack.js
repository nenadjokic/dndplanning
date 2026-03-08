/**
 * Adventure Pack Helper
 * Handles export and import of .qpa adventure pack archives.
 * Format: tar.gz containing manifest.json, data.json, maps/, avatars/
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const dataDir = path.join(__dirname, '..', 'data');

/**
 * Export an adventure pack from a campaign
 * @param {object} opts - { campaignId, userId, options: { maps, npcs, loot, quests, locations, links }, meta: { name, description, author, levelMin, levelMax } }
 * @param {function} onProgress - callback(step, message)
 * @returns {string} path to created .qpa file
 */
function exportPack(db, opts, onProgress) {
  const { campaignId, userId, options, meta } = opts;
  const progress = onProgress || (() => {});

  const timestamp = Date.now();
  const tempDir = path.join(dataDir, 'temp', `pack-export-${timestamp}`);
  fs.mkdirSync(path.join(tempDir, 'maps'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, 'avatars'), { recursive: true });

  const idMap = {
    maps: {},
    npcs: {},
    categories: {},
    chests: {},
    quests: {},
    arcs: {},
    locations: {}
  };
  let nextId = 1;
  function assignId(type, dbId) {
    const eid = nextId++;
    idMap[type][dbId] = eid;
    return eid;
  }

  const data = {};

  // Campaign info
  progress('campaign', 'Exporting campaign...');
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
  if (!campaign) throw new Error('Campaign not found');
  data.campaign = {
    name: meta.name || campaign.name,
    description: meta.description || campaign.description || '',
    color: campaign.color || '#d4a843'
  };

  // Campaign cover image
  if (campaign.cover_image) {
    const coverSrc = path.join(dataDir, 'uploads', 'campaigns', campaign.cover_image);
    if (fs.existsSync(coverSrc)) {
      fs.mkdirSync(path.join(tempDir, 'uploads', 'campaigns'), { recursive: true });
      fs.copyFileSync(coverSrc, path.join(tempDir, 'uploads', 'campaigns', campaign.cover_image));
      data.campaign.cover_image = campaign.cover_image;
    }
  }

  // Campaign arcs
  const arcs = db.prepare('SELECT * FROM campaign_arcs WHERE campaign_id = ? ORDER BY sort_order').all(campaignId);
  data.arcs = arcs.map(a => {
    const eid = assignId('arcs', a.id);
    return { _exportId: eid, name: a.name, description: a.description, sort_order: a.sort_order, color: a.color };
  });

  // Maps
  if (options.maps) {
    progress('maps', 'Exporting maps...');
    const maps = db.prepare('SELECT * FROM maps WHERE campaign_id = ? ORDER BY parent_id NULLS FIRST, name').all(campaignId);
    data.maps = [];
    for (const m of maps) {
      const eid = assignId('maps', m.id);
      const mapData = {
        _exportId: eid,
        name: m.name,
        map_type: m.map_type || 'overworld',
        parent_export_id: m.parent_id ? (idMap.maps[m.parent_id] || null) : null,
        description: m.description || '',
        pin_x: m.pin_x || 50,
        pin_y: m.pin_y || 50,
        party_x: m.party_x || 50,
        party_y: m.party_y || 50,
        fog_enabled: m.fog_enabled || 0,
        fog_data: m.fog_data || null,
        fog_draft: m.fog_draft || null,
        fog_explored: m.fog_explored || null,
        grid_enabled: m.grid_enabled || 0,
        grid_size: m.grid_size || 50,
        grid_offset_x: m.grid_offset_x || 0,
        grid_offset_y: m.grid_offset_y || 0,
        grid_color: m.grid_color || '#ffffff',
        grid_opacity: m.grid_opacity || 0.3,
        grid_type: m.grid_type || 'square',
        published: m.published || 0
      };

      // Copy map image
      if (m.image_path) {
        const imgSrc = path.join(dataDir, 'maps', m.image_path);
        if (fs.existsSync(imgSrc)) {
          fs.copyFileSync(imgSrc, path.join(tempDir, 'maps', m.image_path));
          mapData.image_file = m.image_path;
        }
      }

      data.maps.push(mapData);
    }
  }

  // NPCs (those placed on campaign maps)
  if (options.npcs) {
    progress('npcs', 'Exporting NPCs...');
    const mapIds = Object.keys(idMap.maps).map(Number);

    // Get unique NPC IDs placed on campaign maps
    let npcIds = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      npcIds = db.prepare(`SELECT DISTINCT npc_token_id FROM map_npc_tokens WHERE map_id IN (${placeholders})`).all(...mapIds).map(r => r.npc_token_id);
    }

    // Also get NPCs from any category linked to this campaign's maps
    const allNpcs = npcIds.length > 0
      ? db.prepare(`SELECT * FROM npc_tokens WHERE id IN (${npcIds.map(() => '?').join(',')})`).all(...npcIds)
      : [];

    // Categories
    const catIds = new Set();
    data.npc_categories = [];
    for (const npc of allNpcs) {
      const cats = db.prepare('SELECT category_id FROM npc_token_categories WHERE npc_token_id = ?').all(npc.id);
      for (const c of cats) catIds.add(c.category_id);
    }
    for (const cid of catIds) {
      const cat = db.prepare('SELECT * FROM npc_categories WHERE id = ?').get(cid);
      if (cat) {
        const eid = assignId('categories', cat.id);
        data.npc_categories.push({ _exportId: eid, name: cat.name });
      }
    }

    // NPC data
    data.npcs = [];
    for (const npc of allNpcs) {
      const eid = assignId('npcs', npc.id);
      const cats = db.prepare('SELECT category_id FROM npc_token_categories WHERE npc_token_id = ?').all(npc.id);
      const npcData = {
        _exportId: eid,
        name: npc.name,
        max_hp: npc.max_hp || 0,
        notes: npc.notes || '',
        source_type: npc.source_type || 'custom',
        source_key: npc.source_key || '',
        category_export_ids: cats.map(c => idMap.categories[c.category_id]).filter(Boolean)
      };

      // Copy avatar
      if (npc.avatar) {
        const avatarSrc = path.join(dataDir, 'avatars', npc.avatar);
        if (fs.existsSync(avatarSrc)) {
          fs.copyFileSync(avatarSrc, path.join(tempDir, 'avatars', npc.avatar));
          npcData.avatar_file = npc.avatar;
        }
      }

      data.npcs.push(npcData);
    }

    // NPC placements on maps
    data.map_npc_placements = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      const placements = db.prepare(`SELECT * FROM map_npc_tokens WHERE map_id IN (${placeholders})`).all(...mapIds);
      for (const p of placements) {
        data.map_npc_placements.push({
          map_export_id: idMap.maps[p.map_id],
          npc_export_id: idMap.npcs[p.npc_token_id],
          x: p.x,
          y: p.y,
          scale: p.scale || 1.0,
          current_hp: p.current_hp,
          hp_visible: p.hp_visible,
          hidden: p.hidden || 0,
          vision_radius: p.vision_radius || 0,
          alignment: p.alignment || 'hostile'
        });
      }
    }

    // NPC conditions on map tokens
    data.npc_conditions = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      const mapNpcTokens = db.prepare(`SELECT id, npc_token_id, map_id FROM map_npc_tokens WHERE map_id IN (${placeholders})`).all(...mapIds);
      for (const mnt of mapNpcTokens) {
        const conditions = db.prepare('SELECT condition_name, duration_rounds, duration_type FROM npc_token_conditions WHERE npc_map_token_id = ?').all(mnt.id);
        for (const c of conditions) {
          data.npc_conditions.push({
            map_export_id: idMap.maps[mnt.map_id],
            npc_export_id: idMap.npcs[mnt.npc_token_id],
            condition_name: c.condition_name,
            duration_rounds: c.duration_rounds,
            duration_type: c.duration_type || 'indefinite'
          });
        }
      }
    }
  }

  // Map locations
  if (options.locations) {
    progress('locations', 'Exporting map locations...');
    const mapIds = Object.keys(idMap.maps).map(Number);
    data.map_locations = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      const locs = db.prepare(`SELECT * FROM map_locations WHERE map_id IN (${placeholders})`).all(...mapIds);
      for (const loc of locs) {
        const eid = assignId('locations', loc.id);
        data.map_locations.push({
          _exportId: eid,
          map_export_id: idMap.maps[loc.map_id],
          name: loc.name,
          description: loc.description || '',
          x: loc.x,
          y: loc.y,
          icon: loc.icon || 'pin'
        });
      }
    }
  }

  // Map links
  if (options.links) {
    progress('links', 'Exporting map links...');
    const mapIds = Object.keys(idMap.maps).map(Number);
    data.map_links = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      const links = db.prepare(`SELECT * FROM map_links WHERE source_map_id IN (${placeholders}) AND target_map_id IN (${placeholders})`).all(...mapIds, ...mapIds);
      for (const link of links) {
        data.map_links.push({
          source_map_export_id: idMap.maps[link.source_map_id],
          target_map_export_id: idMap.maps[link.target_map_id],
          pin_x: link.pin_x || 50,
          pin_y: link.pin_y || 50
        });
      }
    }
  }

  // Loot chests
  if (options.loot) {
    progress('loot', 'Exporting loot...');
    const mapIds = Object.keys(idMap.maps).map(Number);
    data.loot_chests = [];
    if (mapIds.length > 0) {
      const placeholders = mapIds.map(() => '?').join(',');
      const chests = db.prepare(`SELECT * FROM map_loot_chests WHERE map_id IN (${placeholders})`).all(...mapIds);
      for (const chest of chests) {
        const items = db.prepare('SELECT name, description, quantity FROM chest_items WHERE chest_id = ?').all(chest.id);
        data.loot_chests.push({
          map_export_id: idMap.maps[chest.map_id],
          x: chest.x,
          y: chest.y,
          label: chest.label || 'Loot Chest',
          notes: chest.notes || '',
          pp: chest.pp || 0,
          gp: chest.gp || 0,
          sp: chest.sp || 0,
          cp: chest.cp || 0,
          hidden: chest.hidden || 0,
          linked_npc_name: chest.linked_npc_name || '',
          items: items
        });
      }
    }

    // Party loot items for this campaign
    data.loot_items = [];
    const lootItems = db.prepare('SELECT * FROM loot_items WHERE campaign_id = ?').all(campaignId);
    for (const item of lootItems) {
      data.loot_items.push({
        name: item.name,
        description: item.description || '',
        quantity: item.quantity || 1,
        category: item.category || 'item',
        rarity: item.rarity || '',
        hidden: item.hidden || 0,
        vault_item_name: item.vault_item_name || ''
      });
    }
  }

  // Quests
  if (options.quests) {
    progress('quests', 'Exporting quests...');
    const quests = db.prepare('SELECT * FROM quests WHERE campaign_id = ? ORDER BY sort_order').all(campaignId);
    data.quests = [];
    for (const q of quests) {
      const eid = assignId('quests', q.id);
      const objectives = db.prepare('SELECT text, completed, sort_order FROM quest_objectives WHERE quest_id = ? ORDER BY sort_order').all(q.id);
      data.quests.push({
        _exportId: eid,
        title: q.title,
        description: q.description || '',
        status: q.status || 'available',
        difficulty: q.difficulty || '',
        reward: q.reward || '',
        quest_giver_name: q.quest_giver_name || '',
        quest_giver_npc_export_id: q.quest_giver_npc_id ? (idMap.npcs[q.quest_giver_npc_id] || null) : null,
        linked_map_export_id: q.linked_map_id ? (idMap.maps[q.linked_map_id] || null) : null,
        linked_location_export_id: q.linked_location_id ? (idMap.locations[q.linked_location_id] || null) : null,
        arc_export_id: q.arc_id ? (idMap.arcs[q.arc_id] || null) : null,
        revealed: q.revealed,
        dm_notes: q.dm_notes || '',
        sort_order: q.sort_order || 0,
        pin_x: q.pin_x || 50,
        pin_y: q.pin_y || 50,
        objectives: objectives
      });
    }
  }

  // Handouts for this campaign
  if (options.handouts !== false) {
    progress('handouts', 'Exporting handouts...');
    const handouts = db.prepare('SELECT * FROM handouts WHERE campaign_id = ?').all(campaignId);
    data.handouts = [];
    for (const h of handouts) {
      const hData = {
        title: h.title,
        type: h.type || 'image',
        content: h.content || '',
        revealed: h.revealed || 0,
        linked_npc_export_id: h.linked_npc_id ? (idMap.npcs[h.linked_npc_id] || null) : null,
        linked_location_export_id: h.linked_location_id ? (idMap.locations[h.linked_location_id] || null) : null
      };
      if (h.image_path) {
        const imgSrc = path.join(dataDir, 'uploads', 'handouts', h.image_path);
        if (fs.existsSync(imgSrc)) {
          fs.mkdirSync(path.join(tempDir, 'uploads', 'handouts'), { recursive: true });
          fs.copyFileSync(imgSrc, path.join(tempDir, 'uploads', 'handouts', h.image_path));
          hData.image_file = h.image_path;
        }
      }
      data.handouts.push(hData);
    }
  }

  // Build manifest
  progress('manifest', 'Building manifest...');
  const manifest = {
    format: 'qpa',
    formatVersion: 1,
    id: slugify(meta.name || campaign.name),
    name: meta.name || campaign.name,
    description: meta.description || campaign.description || '',
    author: meta.author || 'Unknown',
    version: '1.0.0',
    levelMin: meta.levelMin || null,
    levelMax: meta.levelMax || null,
    appVersion: require('../package.json').version,
    createdAt: new Date().toISOString(),
    contents: {
      maps: (data.maps || []).length,
      npcs: (data.npcs || []).length,
      npcPlacements: (data.map_npc_placements || []).length,
      lootChests: (data.loot_chests || []).length,
      lootItems: (data.loot_items || []).length,
      locations: (data.map_locations || []).length,
      links: (data.map_links || []).length,
      quests: (data.quests || []).length,
      arcs: (data.arcs || []).length,
      handouts: (data.handouts || []).length
    }
  };

  // Write files
  fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(tempDir, 'data.json'), JSON.stringify(data, null, 2));

  // Create tar.gz archive
  progress('archive', 'Creating archive...');
  const outputDir = path.join(dataDir, 'adventure-packs');
  fs.mkdirSync(outputDir, { recursive: true });
  const fileName = `${manifest.id}-v${manifest.version}.qpa`;
  const outputPath = path.join(outputDir, fileName);

  const tarItems = ['manifest.json', 'data.json'];
  if (fs.readdirSync(path.join(tempDir, 'maps')).length > 0) tarItems.push('maps');
  if (fs.readdirSync(path.join(tempDir, 'avatars')).length > 0) tarItems.push('avatars');
  if (fs.existsSync(path.join(tempDir, 'uploads'))) tarItems.push('uploads');

  try {
    execFileSync('tar', ['-czf', outputPath, ...tarItems], {
      cwd: tempDir,
      timeout: 120000
    });
  } finally {
    rmDirRecursive(tempDir);
  }

  progress('done', 'Export complete!');
  return { fileName, filePath: outputPath, manifest };
}

/**
 * Extract and preview a .qpa pack (read manifest without importing)
 */
function previewPack(archivePath) {
  const tempDir = path.join(dataDir, 'temp', `pack-preview-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    execFileSync('tar', ['-xzf', archivePath, '-C', tempDir], { timeout: 120000 });
  } catch (err) {
    rmDirRecursive(tempDir);
    throw new Error('Failed to extract adventure pack: ' + err.message);
  }

  const manifestPath = path.join(tempDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    rmDirRecursive(tempDir);
    throw new Error('Invalid adventure pack: missing manifest.json');
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'qpa') {
    rmDirRecursive(tempDir);
    throw new Error('Invalid adventure pack format');
  }

  return { manifest, tempDir };
}

/**
 * Import an adventure pack from an extracted directory
 * @param {object} db - database connection
 * @param {string} extractedDir - path to extracted pack
 * @param {number} userId - importing user ID
 * @param {function} onProgress - callback(step, message)
 * @returns {object} import result
 */
function importPack(db, extractedDir, userId, onProgress) {
  const progress = onProgress || (() => {});

  const manifest = JSON.parse(fs.readFileSync(path.join(extractedDir, 'manifest.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(extractedDir, 'data.json'), 'utf8'));

  const idMap = {
    maps: {},
    npcs: {},
    categories: {},
    chests: {},
    quests: {},
    arcs: {},
    locations: {}
  };

  // Use a transaction for atomicity
  const importAll = db.transaction(() => {
    // Create campaign
    progress('campaign', 'Creating campaign...');
    const campResult = db.prepare(
      'INSERT INTO campaigns (name, description, color, created_by) VALUES (?, ?, ?, ?)'
    ).run(data.campaign.name, data.campaign.description, data.campaign.color || '#d4a843', userId);
    const campaignId = campResult.lastInsertRowid;

    // Campaign cover image
    if (data.campaign.cover_image) {
      const safeCoverName = path.basename(data.campaign.cover_image);
      const coverSrc = path.join(extractedDir, 'uploads', 'campaigns', safeCoverName);
      if (fs.existsSync(coverSrc)) {
        const destDir = path.join(dataDir, 'uploads', 'campaigns');
        fs.mkdirSync(destDir, { recursive: true });
        const uniqueCover = `${Date.now()}-${safeCoverName}`;
        fs.copyFileSync(coverSrc, path.join(destDir, uniqueCover));
        db.prepare('UPDATE campaigns SET cover_image = ? WHERE id = ?').run(uniqueCover, campaignId);
      }
    }

    // Campaign arcs
    if (data.arcs && data.arcs.length > 0) {
      progress('arcs', 'Creating story arcs...');
      for (const arc of data.arcs) {
        const result = db.prepare(
          'INSERT INTO campaign_arcs (name, description, sort_order, color, created_by, campaign_id) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(arc.name, arc.description, arc.sort_order || 0, arc.color || '#d4a843', userId, campaignId);
        idMap.arcs[arc._exportId] = result.lastInsertRowid;
      }
    }

    // NPC categories
    if (data.npc_categories && data.npc_categories.length > 0) {
      progress('categories', 'Creating NPC categories...');
      for (const cat of data.npc_categories) {
        // Check for existing category with same name
        const existing = db.prepare('SELECT id FROM npc_categories WHERE name = ?').get(cat.name);
        if (existing) {
          idMap.categories[cat._exportId] = existing.id;
        } else {
          const result = db.prepare('INSERT INTO npc_categories (name, created_by) VALUES (?, ?)').run(cat.name, userId);
          idMap.categories[cat._exportId] = result.lastInsertRowid;
        }
      }
    }

    // NPCs
    if (data.npcs && data.npcs.length > 0) {
      progress('npcs', `Creating ${data.npcs.length} NPCs...`);
      for (const npc of data.npcs) {
        // Copy avatar
        let avatarFile = null;
        if (npc.avatar_file) {
          const safeAvatarName = path.basename(npc.avatar_file);
          const avatarSrc = path.join(extractedDir, 'avatars', safeAvatarName);
          if (fs.existsSync(avatarSrc)) {
            const destDir = path.join(dataDir, 'avatars');
            fs.mkdirSync(destDir, { recursive: true });
            // Avoid filename collision: prefix with timestamp
            const uniqueName = `${Date.now()}-${safeAvatarName}`;
            fs.copyFileSync(avatarSrc, path.join(destDir, uniqueName));
            avatarFile = uniqueName;
          }
        }

        const result = db.prepare(
          'INSERT INTO npc_tokens (name, avatar, max_hp, current_hp, notes, source_type, source_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(npc.name, avatarFile, npc.max_hp || 0, npc.max_hp || 0, npc.notes || '', npc.source_type || 'custom', npc.source_key || '', userId);
        idMap.npcs[npc._exportId] = result.lastInsertRowid;

        // Category assignments
        if (npc.category_export_ids) {
          for (const catEid of npc.category_export_ids) {
            const catId = idMap.categories[catEid];
            if (catId) {
              try {
                db.prepare('INSERT INTO npc_token_categories (npc_token_id, category_id) VALUES (?, ?)').run(result.lastInsertRowid, catId);
              } catch (e) { /* duplicate, skip */ }
            }
          }
        }
      }
    }

    // Maps (must be created in order for parent_id references)
    const createdMapIds = [];
    if (data.maps && data.maps.length > 0) {
      progress('maps', `Creating ${data.maps.length} maps...`);
      for (const map of data.maps) {
        // Copy map image
        let imagePath = null;
        if (map.image_file) {
          const safeImageName = path.basename(map.image_file);
          const imgSrc = path.join(extractedDir, 'maps', safeImageName);
          if (fs.existsSync(imgSrc)) {
            const destDir = path.join(dataDir, 'maps');
            fs.mkdirSync(destDir, { recursive: true });
            const uniqueName = `${Date.now()}-${safeImageName}`;
            fs.copyFileSync(imgSrc, path.join(destDir, uniqueName));
            imagePath = uniqueName;
          }
        }

        const parentId = map.parent_export_id ? (idMap.maps[map.parent_export_id] || null) : null;

        const result = db.prepare(`
          INSERT INTO maps (name, image_path, map_type, parent_id, description, pin_x, pin_y, party_x, party_y,
            fog_enabled, fog_data, fog_draft, fog_explored,
            grid_enabled, grid_size, grid_offset_x, grid_offset_y, grid_color, grid_opacity, grid_type,
            published, campaign_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          map.name, imagePath, map.map_type || 'overworld', parentId, map.description || '',
          map.pin_x || 50, map.pin_y || 50, map.party_x || 50, map.party_y || 50,
          map.fog_enabled || 0, map.fog_data || null, map.fog_draft || null, map.fog_explored || null,
          map.grid_enabled || 0, map.grid_size || 50, map.grid_offset_x || 0, map.grid_offset_y || 0,
          map.grid_color || '#ffffff', map.grid_opacity || 0.3, map.grid_type || 'square',
          map.published || 0, campaignId, userId
        );
        idMap.maps[map._exportId] = result.lastInsertRowid;
        createdMapIds.push(result.lastInsertRowid);
      }
    }

    // NPC placements on maps
    if (data.map_npc_placements && data.map_npc_placements.length > 0) {
      progress('placements', `Placing ${data.map_npc_placements.length} NPCs on maps...`);
      for (const p of data.map_npc_placements) {
        const mapId = idMap.maps[p.map_export_id];
        const npcId = idMap.npcs[p.npc_export_id];
        if (mapId && npcId) {
          db.prepare(`
            INSERT INTO map_npc_tokens (map_id, npc_token_id, x, y, scale, current_hp, hp_visible, hidden, vision_radius, alignment, placed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(mapId, npcId, p.x, p.y, p.scale || 1.0, p.current_hp, p.hp_visible, p.hidden || 0, p.vision_radius || 0, p.alignment || 'hostile', userId);
        }
      }
    }

    // NPC conditions
    if (data.npc_conditions && data.npc_conditions.length > 0) {
      for (const c of data.npc_conditions) {
        const mapId = idMap.maps[c.map_export_id];
        const npcId = idMap.npcs[c.npc_export_id];
        if (mapId && npcId) {
          const mnt = db.prepare('SELECT id FROM map_npc_tokens WHERE map_id = ? AND npc_token_id = ?').get(mapId, npcId);
          if (mnt) {
            try {
              db.prepare('INSERT INTO npc_token_conditions (npc_map_token_id, condition_name, applied_by, duration_rounds, duration_type) VALUES (?, ?, ?, ?, ?)')
                .run(mnt.id, c.condition_name, userId, c.duration_rounds, c.duration_type || 'indefinite');
            } catch (e) { /* duplicate */ }
          }
        }
      }
    }

    // Map locations
    if (data.map_locations && data.map_locations.length > 0) {
      progress('locations', `Creating ${data.map_locations.length} map locations...`);
      for (const loc of data.map_locations) {
        const mapId = idMap.maps[loc.map_export_id];
        if (mapId) {
          const result = db.prepare(
            'INSERT INTO map_locations (map_id, name, description, x, y, icon, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
          ).run(mapId, loc.name, loc.description || '', loc.x, loc.y, loc.icon || 'pin', userId);
          idMap.locations[loc._exportId] = result.lastInsertRowid;
        }
      }
    }

    // Map links
    if (data.map_links && data.map_links.length > 0) {
      progress('links', `Creating ${data.map_links.length} map links...`);
      for (const link of data.map_links) {
        const srcId = idMap.maps[link.source_map_export_id];
        const tgtId = idMap.maps[link.target_map_export_id];
        if (srcId && tgtId) {
          try {
            db.prepare('INSERT INTO map_links (source_map_id, target_map_id, pin_x, pin_y) VALUES (?, ?, ?, ?)')
              .run(srcId, tgtId, link.pin_x || 50, link.pin_y || 50);
          } catch (e) { /* duplicate */ }
        }
      }
    }

    // Loot chests
    if (data.loot_chests && data.loot_chests.length > 0) {
      progress('loot', `Creating ${data.loot_chests.length} loot chests...`);
      for (const chest of data.loot_chests) {
        const mapId = idMap.maps[chest.map_export_id];
        if (mapId) {
          const result = db.prepare(
            'INSERT INTO map_loot_chests (map_id, x, y, label, notes, pp, gp, sp, cp, hidden, linked_npc_name, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(mapId, chest.x, chest.y, chest.label, chest.notes || '', chest.pp || 0, chest.gp || 0, chest.sp || 0, chest.cp || 0, chest.hidden || 0, chest.linked_npc_name || '', userId);
          const chestId = result.lastInsertRowid;

          if (chest.items && chest.items.length > 0) {
            for (const item of chest.items) {
              db.prepare('INSERT INTO chest_items (chest_id, name, description, quantity) VALUES (?, ?, ?, ?)')
                .run(chestId, item.name, item.description || '', item.quantity || 1);
            }
          }
        }
      }
    }

    // Party loot items
    if (data.loot_items && data.loot_items.length > 0) {
      for (const item of data.loot_items) {
        db.prepare(
          'INSERT INTO loot_items (name, description, quantity, category, rarity, hidden, vault_item_name, campaign_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(item.name, item.description || '', item.quantity || 1, item.category || 'item', item.rarity || '', item.hidden || 0, item.vault_item_name || '', campaignId, userId);
      }
    }

    // Quests
    if (data.quests && data.quests.length > 0) {
      progress('quests', `Creating ${data.quests.length} quests...`);
      for (const q of data.quests) {
        const result = db.prepare(`
          INSERT INTO quests (title, description, status, difficulty, reward, quest_giver_name, quest_giver_npc_id,
            linked_map_id, linked_location_id, arc_id, revealed, dm_notes, sort_order, pin_x, pin_y, campaign_id, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          q.title, q.description || '', q.status || 'available', q.difficulty || '', q.reward || '',
          q.quest_giver_name || '',
          q.quest_giver_npc_export_id ? (idMap.npcs[q.quest_giver_npc_export_id] || null) : null,
          q.linked_map_export_id ? (idMap.maps[q.linked_map_export_id] || null) : null,
          q.linked_location_export_id ? (idMap.locations[q.linked_location_export_id] || null) : null,
          q.arc_export_id ? (idMap.arcs[q.arc_export_id] || null) : null,
          q.revealed !== undefined ? q.revealed : 1,
          q.dm_notes || '', q.sort_order || 0, q.pin_x || 50, q.pin_y || 50, campaignId, userId
        );
        idMap.quests[q._exportId] = result.lastInsertRowid;

        // Objectives
        if (q.objectives && q.objectives.length > 0) {
          for (const obj of q.objectives) {
            db.prepare('INSERT INTO quest_objectives (quest_id, text, completed, sort_order) VALUES (?, ?, ?, ?)')
              .run(result.lastInsertRowid, obj.text, obj.completed || 0, obj.sort_order || 0);
          }
        }
      }
    }

    // Handouts
    if (data.handouts && data.handouts.length > 0) {
      progress('handouts', `Creating ${data.handouts.length} handouts...`);
      for (const h of data.handouts) {
        let imagePath = null;
        if (h.image_file) {
          const safeHandoutName = path.basename(h.image_file);
          const imgSrc = path.join(extractedDir, 'uploads', 'handouts', safeHandoutName);
          if (fs.existsSync(imgSrc)) {
            const destDir = path.join(dataDir, 'uploads', 'handouts');
            fs.mkdirSync(destDir, { recursive: true });
            const uniqueName = `${Date.now()}-${safeHandoutName}`;
            fs.copyFileSync(imgSrc, path.join(destDir, uniqueName));
            imagePath = uniqueName;
          }
        }
        db.prepare(
          'INSERT INTO handouts (title, type, content, image_path, revealed, linked_npc_id, linked_location_id, campaign_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          h.title, h.type || 'image', h.content || '', imagePath, h.revealed || 0,
          h.linked_npc_export_id ? (idMap.npcs[h.linked_npc_export_id] || null) : null,
          h.linked_location_export_id ? (idMap.locations[h.linked_location_export_id] || null) : null,
          campaignId, userId
        );
      }
    }

    // Record the import
    const npcIdsList = Object.values(idMap.npcs);
    db.prepare(
      'INSERT INTO adventure_packs (pack_id, name, description, author, version, level_min, level_max, campaign_id, map_ids, npc_ids, import_source, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      manifest.id, manifest.name, manifest.description, manifest.author, manifest.version,
      manifest.levelMin, manifest.levelMax, campaignId,
      JSON.stringify(createdMapIds), JSON.stringify(npcIdsList),
      'local', userId
    );

    return { campaignId, mapCount: createdMapIds.length, npcCount: npcIdsList.length, manifest };
  });

  const result = importAll();

  // Clean up extracted directory
  rmDirRecursive(extractedDir);

  progress('done', 'Import complete!');
  return result;
}

/**
 * Delete an imported adventure pack and all its data
 */
function deletePack(db, packId, userId) {
  const pack = db.prepare('SELECT * FROM adventure_packs WHERE id = ?').get(packId);
  if (!pack) throw new Error('Adventure pack not found');

  const mapIds = JSON.parse(pack.map_ids || '[]');
  const npcIds = JSON.parse(pack.npc_ids || '[]');

  const deleteAll = db.transaction(() => {
    // 1. Delete deepest children first: combat participants, conditions, chest items
    for (const mapId of mapIds) {
      db.prepare('DELETE FROM combat_participants WHERE encounter_id IN (SELECT id FROM combat_encounters WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM combat_encounters WHERE map_id = ?').run(mapId);
      db.prepare('DELETE FROM npc_token_conditions WHERE npc_map_token_id IN (SELECT id FROM map_npc_tokens WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM token_conditions WHERE token_id IN (SELECT id FROM map_tokens WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM chest_items WHERE chest_id IN (SELECT id FROM map_loot_chests WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM map_loot_chests WHERE map_id = ?').run(mapId);
      db.prepare('DELETE FROM map_npc_tokens WHERE map_id = ?').run(mapId);
      db.prepare('DELETE FROM map_tokens WHERE map_id = ?').run(mapId);
      db.prepare('DELETE FROM map_fog_data WHERE map_id = ?').run(mapId);
      db.prepare('DELETE FROM map_links WHERE source_map_id = ? OR target_map_id = ?').run(mapId, mapId);
    }

    // 2. Nullify session references to our locations before deleting them
    for (const mapId of mapIds) {
      db.prepare('UPDATE sessions SET location_id = NULL WHERE location_id IN (SELECT id FROM map_locations WHERE map_id = ?)').run(mapId);
      db.prepare('DELETE FROM map_locations WHERE map_id = ?').run(mapId);
    }

    // 3. Clear FK references pointing to our maps
    for (const mapId of mapIds) {
      db.prepare('UPDATE maps SET parent_id = NULL WHERE parent_id = ?').run(mapId);
      db.prepare('UPDATE quests SET linked_map_id = NULL WHERE linked_map_id = ?').run(mapId);
      db.prepare('UPDATE quests SET linked_location_id = NULL WHERE linked_location_id IN (SELECT id FROM map_locations WHERE map_id = ?)').run(mapId);
    }

    // 4. Delete maps (remove image files)
    for (const mapId of mapIds) {
      const map = db.prepare('SELECT image_path FROM maps WHERE id = ?').get(mapId);
      if (map && map.image_path) {
        const imgPath = path.join(dataDir, 'maps', map.image_path);
        try { fs.unlinkSync(imgPath); } catch (e) { /* ignore */ }
      }
      db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
    }

    // 5. Clear FK references pointing to our NPCs
    for (const npcId of npcIds) {
      db.prepare('UPDATE handouts SET linked_npc_id = NULL WHERE linked_npc_id = ?').run(npcId);
      db.prepare('UPDATE loot_items SET linked_npc_id = NULL WHERE linked_npc_id = ?').run(npcId);
      db.prepare('UPDATE quests SET quest_giver_npc_id = NULL WHERE quest_giver_npc_id = ?').run(npcId);
    }

    // 6. Delete NPCs (remove avatar files)
    for (const npcId of npcIds) {
      const npc = db.prepare('SELECT avatar FROM npc_tokens WHERE id = ?').get(npcId);
      if (npc && npc.avatar) {
        const avatarPath = path.join(dataDir, 'avatars', npc.avatar);
        try { fs.unlinkSync(avatarPath); } catch (e) { /* ignore */ }
      }
      db.prepare('DELETE FROM npc_token_categories WHERE npc_token_id = ?').run(npcId);
      db.prepare('DELETE FROM npc_tokens WHERE id = ?').run(npcId);
    }

    // 7. Delete campaign-scoped data
    if (pack.campaign_id) {
      db.prepare('DELETE FROM quest_objectives WHERE quest_id IN (SELECT id FROM quests WHERE campaign_id = ?)').run(pack.campaign_id);
      db.prepare('DELETE FROM quests WHERE campaign_id = ?').run(pack.campaign_id);
      db.prepare('DELETE FROM loot_items WHERE campaign_id = ?').run(pack.campaign_id);
      db.prepare('DELETE FROM handouts WHERE campaign_id = ?').run(pack.campaign_id);
      db.prepare('DELETE FROM campaign_arcs WHERE campaign_id = ?').run(pack.campaign_id);
      // Nullify session FK to campaign before deleting
      db.prepare('UPDATE sessions SET campaign_id = NULL WHERE campaign_id = ?').run(pack.campaign_id);
      // Nullify encounters FK to campaign
      db.prepare('UPDATE encounters SET campaign_id = NULL WHERE campaign_id = ?').run(pack.campaign_id);
      db.prepare('DELETE FROM campaigns WHERE id = ?').run(pack.campaign_id);
    }

    // 8. Delete pack record
    db.prepare('DELETE FROM adventure_packs WHERE id = ?').run(packId);
  });

  deleteAll();
}

function slugify(str) {
  return (str || 'adventure')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);
}

function rmDirRecursive(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

module.exports = {
  exportPack,
  previewPack,
  importPack,
  deletePack
};
