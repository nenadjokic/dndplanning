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

// Main import function
async function main() {
  console.log('🚀 Starting 5e.tools data import...\n');

  const startTime = Date.now();

  try {
    const spellCount = await importSpells();
    const classCount = await importClasses();
    const raceCount = await importRaces();
    const itemCount = await importItems();

    // Update metadata
    db.prepare(`
      UPDATE dnd_data_meta SET
        last_import_date = datetime('now'),
        import_version = ?,
        spell_count = ?,
        class_count = ?,
        race_count = ?,
        item_count = ?
      WHERE id = 1
    `).run('5etools-mirror-3/master', spellCount, classCount, raceCount, itemCount);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✨ Import completed in ${duration}s`);
    console.log(`📊 Total imported: ${spellCount} spells, ${classCount} classes, ${raceCount} races, ${itemCount} items`);
  } catch (error) {
    console.error('❌ Import failed:', error);
    process.exit(1);
  }
}

// Run import
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { importSpells, importClasses, importRaces, importItems };
