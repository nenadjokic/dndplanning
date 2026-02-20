#!/usr/bin/env node

/**
 * Import D&D data from 5e.tools into local SQLite database
 * Downloads all spells, classes, races, and items from GitHub
 */

const https = require('https');
const db = require('../db/connection');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/master/data';
const TEMP_DIR = path.join(__dirname, '../data/tmp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper to download JSON file
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Import spells from all source books
async function importSpells(progressCallback) {
  const log = progressCallback || console.log;
  log('📜 Importing spells...');

  // Get the index to know which files to download
  const index = await fetchJSON(`${BASE_URL}/spells/index.json`);
  const sources = Object.keys(index);

  let totalSpells = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_spells (name, source, level, school, casting_time, range, components, duration, description, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Clear existing spells
  db.prepare('DELETE FROM dnd_spells').run();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const filename = index[source];
    console.log(`  Downloading ${source} (${filename})...`);

    try {
      const data = await fetchJSON(`${BASE_URL}/spells/${filename}`);
      const spells = data.spell || [];

      for (const spell of spells) {
        const name = spell.name;
        const level = spell.level || 0;
        const school = spell.school || null;

        // Build casting time string
        let castingTime = '';
        if (spell.time && spell.time[0]) {
          const t = spell.time[0];
          castingTime = `${t.number || 1} ${t.unit || 'action'}`;
        }

        // Build range string
        let range = '';
        if (spell.range) {
          if (spell.range.type === 'point') {
            range = spell.range.distance?.type === 'self' ? 'Self' :
                    spell.range.distance?.amount ? `${spell.range.distance.amount} ${spell.range.distance.type}` : '';
          } else {
            range = spell.range.type || '';
          }
        }

        // Build components string
        let components = [];
        if (spell.components) {
          if (spell.components.v) components.push('V');
          if (spell.components.s) components.push('S');
          if (spell.components.m) {
            const mat = typeof spell.components.m === 'object' ? spell.components.m.text : spell.components.m;
            components.push(`M (${mat || 'material'})`);
          }
        }
        const componentsStr = components.join(', ');

        // Build duration string
        let duration = '';
        if (spell.duration && spell.duration[0]) {
          const d = spell.duration[0];
          if (d.type === 'instant') duration = 'Instantaneous';
          else if (d.type === 'timed') {
            duration = `${d.duration?.amount || 1} ${d.duration?.type || 'round'}`;
            if (d.concentration) duration = `Concentration, ${duration}`;
          } else {
            duration = d.type || '';
          }
        }

        // Build description
        let description = '';
        if (spell.entries) {
          description = spell.entries.map(e => {
            if (typeof e === 'string') return e;
            if (e.entries) return e.entries.join(' ');
            return '';
          }).join('\n\n');
        }

        // Create search text
        const searchText = `${name} ${description} ${school || ''} ${source}`.toLowerCase();

        // Insert into database
        insertStmt.run(
          name,
          spell.source || source,
          level,
          school,
          castingTime,
          range,
          componentsStr,
          duration,
          description,
          JSON.stringify(spell),
          searchText
        );

        totalSpells++;
      }

      console.log(`    ✓ Imported ${spells.length} spells from ${source}`);
    } catch (error) {
      console.error(`    ✗ Failed to import ${source}: ${error.message}`);
    }
  }

  console.log(`✅ Imported ${totalSpells} total spells\n`);
  return totalSpells;
}

// Import classes
async function importClasses() {
  console.log('⚔️  Importing classes...');

  const classFiles = [
    'class-artificer.json',
    'class-barbarian.json',
    'class-bard.json',
    'class-cleric.json',
    'class-druid.json',
    'class-fighter.json',
    'class-monk.json',
    'class-paladin.json',
    'class-ranger.json',
    'class-rogue.json',
    'class-sorcerer.json',
    'class-warlock.json',
    'class-wizard.json'
  ];

  let totalClasses = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_classes (name, source, hit_die, proficiencies, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Clear existing classes
  db.prepare('DELETE FROM dnd_classes').run();

  for (const filename of classFiles) {
    console.log(`  Downloading ${filename}...`);

    try {
      const data = await fetchJSON(`${BASE_URL}/class/${filename}`);
      const classes = data.class || [];

      for (const cls of classes) {
        const name = cls.name;
        const source = cls.source;
        const hitDie = cls.hd?.faces || null;
        const proficiencies = JSON.stringify(cls.proficiency || []);

        // Create search text
        const searchText = `${name} ${source}`.toLowerCase();

        insertStmt.run(
          name,
          source,
          hitDie,
          proficiencies,
          JSON.stringify(cls),
          searchText
        );

        totalClasses++;
      }

      console.log(`    ✓ Imported ${classes.length} classes from ${filename}`);
    } catch (error) {
      console.error(`    ✗ Failed to import ${filename}: ${error.message}`);
    }
  }

  console.log(`✅ Imported ${totalClasses} total classes\n`);
  return totalClasses;
}

// Import races
async function importRaces() {
  console.log('👥 Importing races...');

  let totalRaces = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_races (name, source, size, speed, abilities, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Clear existing races
  db.prepare('DELETE FROM dnd_races').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/races.json`);
    const races = data.race || [];

    for (const race of races) {
      const name = race.name;
      const source = race.source;
      const size = race.size ? race.size.join(', ') : null;
      const speed = race.speed?.walk || null;
      const abilities = JSON.stringify(race.ability || []);

      // Create search text
      const searchText = `${name} ${source}`.toLowerCase();

      insertStmt.run(
        name,
        source,
        size,
        speed,
        abilities,
        JSON.stringify(race),
        searchText
      );

      totalRaces++;
    }

    console.log(`✅ Imported ${totalRaces} total races\n`);
  } catch (error) {
    console.error(`✗ Failed to import races: ${error.message}\n`);
  }

  return totalRaces;
}

// Import items
async function importItems() {
  console.log('🗡️  Importing items...');

  let totalItems = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_items (name, source, type, rarity, value, weight, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Clear existing items
  db.prepare('DELETE FROM dnd_items').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/items.json`);
    const items = data.item || [];

    for (const item of items) {
      const name = item.name;
      const source = item.source;
      const type = item.type || null;
      const rarity = item.rarity || null;
      const value = item.value || null;
      const weight = item.weight || null;

      // Create search text
      const searchText = `${name} ${type || ''} ${rarity || ''} ${source}`.toLowerCase();

      insertStmt.run(
        name,
        source,
        type,
        rarity,
        value,
        weight,
        JSON.stringify(item),
        searchText
      );

      totalItems++;
    }

    console.log(`✅ Imported ${totalItems} total items\n`);
  } catch (error) {
    console.error(`✗ Failed to import items: ${error.message}\n`);
  }

  return totalItems;
}

// Import feats
async function importFeats() {
  console.log('🎯 Importing feats...');

  let totalFeats = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_feats (name, source, prerequisite, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Clear existing feats
  db.prepare('DELETE FROM dnd_feats').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/feats.json`);
    const feats = data.feat || [];

    for (const feat of feats) {
      const name = feat.name;
      const source = feat.source;

      // Parse prerequisite array into readable text
      let prerequisite = '';
      if (feat.prerequisite && Array.isArray(feat.prerequisite)) {
        const prereqParts = [];
        for (const prereq of feat.prerequisite) {
          if (prereq.level) {
            prereqParts.push(`Level ${prereq.level.level || prereq.level}`);
          }
          if (prereq.race) {
            const races = prereq.race.map(r => r.name + (r.subrace ? ` (${r.subrace})` : '')).join(' or ');
            prereqParts.push(races);
          }
          if (prereq.ability) {
            const abilities = prereq.ability.map(a => {
              return Object.entries(a).map(([k, v]) => `${k.toUpperCase()} ${v}+`).join(', ');
            }).join(' or ');
            prereqParts.push(abilities);
          }
          if (prereq.spellcasting) prereqParts.push('Spellcasting');
          if (prereq.proficiency) {
            const profs = prereq.proficiency.map(p => {
              return Object.entries(p).map(([k, v]) => `${v}`).join(', ');
            }).join(', ');
            prereqParts.push(profs);
          }
          if (prereq.other) prereqParts.push(prereq.other);
        }
        prerequisite = prereqParts.join('; ');
      }

      const searchText = `${name} ${prerequisite} ${source}`.toLowerCase();

      insertStmt.run(
        name,
        source,
        prerequisite || null,
        JSON.stringify(feat),
        searchText
      );

      totalFeats++;
    }

    console.log(`✅ Imported ${totalFeats} total feats\n`);
  } catch (error) {
    console.error(`✗ Failed to import feats: ${error.message}\n`);
  }

  return totalFeats;
}

// Import optional features (Eldritch Invocations, Fighting Styles, etc.)
async function importOptionalFeatures() {
  console.log('⚡ Importing optional features...');

  let totalOptFeatures = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_optfeatures (name, source, feature_type, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Clear existing optional features
  db.prepare('DELETE FROM dnd_optfeatures').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/optionalfeatures.json`);
    const optfeatures = data.optionalfeature || [];

    for (const optfeature of optfeatures) {
      const name = optfeature.name;
      const source = optfeature.source;
      const featureType = optfeature.featureType ? optfeature.featureType.join(', ') : null;

      const searchText = `${name} ${featureType || ''} ${source}`.toLowerCase();

      insertStmt.run(
        name,
        source,
        featureType,
        JSON.stringify(optfeature),
        searchText
      );

      totalOptFeatures++;
    }

    console.log(`✅ Imported ${totalOptFeatures} total optional features\n`);
  } catch (error) {
    console.error(`✗ Failed to import optional features: ${error.message}\n`);
  }

  return totalOptFeatures;
}

// Import backgrounds
async function importBackgrounds() {
  console.log('📜 Importing backgrounds...');

  let totalBackgrounds = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_backgrounds (name, source, raw_data, search_text)
    VALUES (?, ?, ?, ?)
  `);

  // Clear existing backgrounds
  db.prepare('DELETE FROM dnd_backgrounds').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/backgrounds.json`);
    const backgrounds = data.background || [];

    for (const bg of backgrounds) {
      const name = bg.name;
      const source = bg.source;

      const searchText = `${name} ${source}`.toLowerCase();

      insertStmt.run(
        name,
        source,
        JSON.stringify(bg),
        searchText
      );

      totalBackgrounds++;
    }

    console.log(`✅ Imported ${totalBackgrounds} total backgrounds\n`);
  } catch (error) {
    console.error(`✗ Failed to import backgrounds: ${error.message}\n`);
  }

  return totalBackgrounds;
}

// Import monsters from all source books
async function importMonsters() {
  console.log('🐉 Importing monsters...');

  // Get the index to know which files to download
  const index = await fetchJSON(`${BASE_URL}/bestiary/index.json`);
  const sources = Object.keys(index);

  let totalMonsters = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_monsters (name, source, cr, type, size, environment, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Clear existing monsters
  db.prepare('DELETE FROM dnd_monsters').run();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const filename = index[source];
    console.log(`  Downloading ${source} (${filename})...`);

    try {
      const data = await fetchJSON(`${BASE_URL}/bestiary/${filename}`);
      const monsters = data.monster || [];

      for (const monster of monsters) {
        const name = monster.name;

        // CR can be object {cr: "1/4"} or string
        let cr = null;
        if (monster.cr) {
          cr = typeof monster.cr === 'object' ? monster.cr.cr : String(monster.cr);
        }

        // Type can be object {type: "beast"} or string
        let type = null;
        if (monster.type) {
          type = typeof monster.type === 'object' ? monster.type.type : monster.type;
        }

        // Size is an array
        const size = monster.size ? monster.size.join(', ') : null;

        // Environment is optional array
        const environment = monster.environment ? monster.environment.join(', ') : null;

        const searchText = `${name} ${type || ''} ${cr || ''} ${source} ${environment || ''}`.toLowerCase();

        insertStmt.run(
          name,
          monster.source || source,
          cr,
          type,
          size,
          environment,
          JSON.stringify(monster),
          searchText
        );

        totalMonsters++;
      }

      console.log(`    ✓ Imported ${monsters.length} monsters from ${source}`);
    } catch (error) {
      console.error(`    ✗ Failed to import ${source}: ${error.message}`);
    }
  }

  console.log(`✅ Imported ${totalMonsters} total monsters\n`);
  return totalMonsters;
}

// Import conditions and diseases
async function importConditions() {
  console.log('🩹 Importing conditions & diseases...');

  let totalConditions = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_conditions (name, source, condition_type, raw_data, search_text)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Clear existing conditions
  db.prepare('DELETE FROM dnd_conditions').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/conditionsdiseases.json`);

    // Process conditions
    const conditions = data.condition || [];
    for (const condition of conditions) {
      const searchText = `${condition.name} condition ${condition.source}`.toLowerCase();
      insertStmt.run(
        condition.name,
        condition.source,
        'condition',
        JSON.stringify(condition),
        searchText
      );
      totalConditions++;
    }

    // Process diseases
    const diseases = data.disease || [];
    for (const disease of diseases) {
      const searchText = `${disease.name} disease ${disease.source}`.toLowerCase();
      insertStmt.run(
        disease.name,
        disease.source,
        'disease',
        JSON.stringify(disease),
        searchText
      );
      totalConditions++;
    }

    console.log(`✅ Imported ${totalConditions} total conditions & diseases\n`);
  } catch (error) {
    console.error(`✗ Failed to import conditions: ${error.message}\n`);
  }

  return totalConditions;
}

// Import rules/actions
async function importRules() {
  console.log('📖 Importing rules/actions...');

  let totalRules = 0;
  const insertStmt = db.prepare(`
    INSERT INTO dnd_rules (name, source, raw_data, search_text)
    VALUES (?, ?, ?, ?)
  `);

  // Clear existing rules
  db.prepare('DELETE FROM dnd_rules').run();

  try {
    const data = await fetchJSON(`${BASE_URL}/actions.json`);
    const actions = data.action || [];

    for (const action of actions) {
      const searchText = `${action.name} ${action.source}`.toLowerCase();

      insertStmt.run(
        action.name,
        action.source,
        JSON.stringify(action),
        searchText
      );

      totalRules++;
    }

    console.log(`✅ Imported ${totalRules} total rules/actions\n`);
  } catch (error) {
    console.error(`✗ Failed to import rules: ${error.message}\n`);
  }

  return totalRules;
}

// Main import function
async function main() {
  console.log('🚀 Starting 5e.tools data import...\n');

  const startTime = Date.now();

  try {
    const spellCount = await importSpells();
    const classCount = await importClasses();
    const raceCount = await importRaces();
    const itemCount = await importItems();
    const featCount = await importFeats();
    const optfeatureCount = await importOptionalFeatures();
    const backgroundCount = await importBackgrounds();
    const monsterCount = await importMonsters();
    const conditionCount = await importConditions();
    const ruleCount = await importRules();

    // Update metadata
    db.prepare(`
      UPDATE dnd_data_meta SET
        last_import_date = datetime('now'),
        import_version = ?,
        spell_count = ?,
        class_count = ?,
        race_count = ?,
        item_count = ?,
        feat_count = ?,
        optfeature_count = ?,
        background_count = ?,
        monster_count = ?,
        condition_count = ?,
        rule_count = ?
      WHERE id = 1
    `).run('5etools-mirror-3/master', spellCount, classCount, raceCount, itemCount, featCount, optfeatureCount, backgroundCount, monsterCount, conditionCount, ruleCount);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Import completed in ${duration}s`);
    console.log(`📊 Total imported: ${spellCount} spells, ${classCount} classes, ${raceCount} races, ${itemCount} items, ${featCount} feats, ${optfeatureCount} optional features, ${backgroundCount} backgrounds, ${monsterCount} monsters, ${conditionCount} conditions, ${ruleCount} rules`);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run import
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { importSpells, importClasses, importRaces, importItems, importFeats, importOptionalFeatures, importBackgrounds, importMonsters, importConditions, importRules };
