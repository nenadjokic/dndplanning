/**
 * Vault helpers for local 5e.tools database
 * Replaces all Open5e API and GitHub fetch logic
 */

const db = require('../db/connection');
const { marked } = require('marked');

// Helper: Convert markdown to HTML
function formatVaultMarkdown(text) {
  if (!text) return '';
  return marked.parse(text, { breaks: true, gfm: true });
}

// Helper: Clean 5e.tools tags like {@item dagger|phb|daggers} -> daggers
function clean5eToolsTags(text) {
  if (!text) return '';

  // Convert to string if object
  if (typeof text === 'object' && !Array.isArray(text)) {
    text = JSON.stringify(text);
  }

  // {@item name|source|display} -> display (or name if no display)
  text = text.replace(/\{@(?:item|spell|creature|condition|skill|sense|action)\s+([^}|]+)(?:\|[^}|]+)?(?:\|([^}]+))?\}/g, function(match, name, display) {
    return display || name;
  });

  // {@dice 1d6} -> 1d6
  text = text.replace(/\{@dice\s+([^}]+)\}/g, '$1');

  // {@damage 1d6} -> 1d6
  text = text.replace(/\{@damage\s+([^}]+)\}/g, '$1');

  // Other tags
  text = text.replace(/\{@\w+\s+([^}]+)\}/g, '$1');

  return text;
}

// Helper: Format weight to 1 decimal place
function formatWeight(weight) {
  if (!weight) return null;
  return parseFloat(weight).toFixed(1);
}

// School mapping
const schoolMap = {
  'A': 'Abjuration', 'C': 'Conjuration', 'D': 'Divination', 'E': 'Enchantment',
  'V': 'Evocation', 'I': 'Illusion', 'N': 'Necromancy', 'T': 'Transmutation'
};

// Source mapping
const sourceMap = {
  'PHB': "Player's Handbook",
  'XPHB': "Player's Handbook (2024)",
  'XGE': "Xanathar's Guide to Everything",
  'TCE': "Tasha's Cauldron of Everything",
  'SCAG': "Sword Coast Adventurer's Guide",
  'VRGR': "Van Richten's Guide to Ravenloft",
  'MPMM': "Mordenkainen Presents: Monsters of the Multiverse",
  'EE': "Elemental Evil Player's Companion",
  'DMG': "Dungeon Master's Guide",
  'XDMG': "Dungeon Master's Guide (2024)",
  'AAG': "Astral Adventurer's Guide",
  'AI': "Acquisitions Incorporated",
  'FTD': "Fizban's Treasury of Dragons",
  'SCC': "Strixhaven: A Curriculum of Chaos",
  'EGW': "Explorer's Guide to Wildemount",
  'IDRotF': "Icewind Dale: Rime of the Frostmaiden",
  'BMT': "The Book of Many Things",
  'GGR': "Guildmasters' Guide to Ravnica",
  'SatO': "Spelljammer: Adventures in Space",
  'LLK': "Lost Laboratory of Kwalish",
  'FRHoF': "From the Radiant Archive (Heroes of Fortune)",
  'AitFR-AVT': "Adventures in the Radiant City"
};

// Item type mapping
const itemTypeMap = {
  'M': 'Melee Weapon',
  'R': 'Ranged Weapon',
  'LA': 'Light Armor',
  'MA': 'Medium Armor',
  'HA': 'Heavy Armor',
  'S': 'Shield',
  'A': 'Armor',
  'P': 'Potion',
  'RG': 'Ring',
  'RD': 'Rod',
  'SC': 'Scroll',
  'ST': 'Staff',
  'WD': 'Wand',
  'SCF': 'Spellcasting Focus',
  'AT': "Artisan's Tools",
  'GS': 'Gaming Set',
  'INS': 'Musical Instrument',
  'T': 'Tools',
  'G': 'Adventuring Gear',
  '$A': 'Ammunition',
  '$C': 'Trade Goods',
  '$G': 'General Goods',
  'MNT': 'Mount',
  'VEH': 'Vehicle',
  'TAH': 'Tack and Harness',
  'AIR': 'Vehicle (Air)',
  'SHP': 'Vehicle (Water)',
  'SPC': 'Spelljamming Component',
  'FD': 'Food and Drink',
  'EXP': 'Explosive',
  'OTH': 'Other'
};

// Get clean item type from pipe-delimited code (e.g., "RD|DMG" -> "RD")
function getItemType(typeString) {
  if (!typeString) return null;
  // Split by pipe and take first part
  const code = typeString.split('|')[0];
  return itemTypeMap[code] || code;
}

// Get races list
function getRacesList(search = '') {
  let sql = 'SELECT id, name, source, size, speed FROM dnd_races WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND search_text LIKE ?';
    params.push(`%${search.toLowerCase()}%`);
  }

  sql += ' ORDER BY name COLLATE NOCASE';

  const races = db.prepare(sql).all(...params);

  return races.map(r => ({
    key: r.name.toLowerCase().replace(/\s+/g, '-'),
    name: r.name,
    desc: '',
    source: sourceMap[r.source] || r.source
  }));
}

// Get race details
function getRaceDetails(name) {
  const normalized = name.toLowerCase().replace(/-/g, ' ');
  const race = db.prepare('SELECT * FROM dnd_races WHERE LOWER(name) = ?').get(normalized);

  if (!race) return null;

  const fullData = JSON.parse(race.raw_data);

  // Helper to recursively extract text from entries
  function extractText(entry) {
    if (typeof entry === 'string') {
      return clean5eToolsTags(entry);
    }
    if (Array.isArray(entry)) {
      return entry.map(e => extractText(e)).filter(Boolean).join('\n\n');
    }
    if (typeof entry === 'object') {
      if (entry.type === 'list' && entry.items) {
        return entry.items.map(item => '• ' + extractText(item)).join('\n');
      }
      if (entry.type === 'entries' && entry.entries) {
        return extractText(entry.entries);
      }
      if (entry.entries) {
        return extractText(entry.entries);
      }
      if (entry.items) {
        return extractText(entry.items);
      }
      // If it's an object with a name property, format it nicely
      if (entry.name) {
        return '**' + entry.name + ':** ' + (entry.entry || '');
      }
    }
    return '';
  }

  // Extract description (only top-level strings, not traits)
  let desc = '';
  if (fullData.entries && Array.isArray(fullData.entries)) {
    const descParts = [];
    fullData.entries.forEach(e => {
      if (typeof e === 'string') {
        descParts.push(clean5eToolsTags(e));
      }
    });
    desc = descParts.join('\n\n');
  }

  // Extract traits (entries with names)
  const traits = [];
  if (fullData.entries && Array.isArray(fullData.entries)) {
    fullData.entries.forEach(e => {
      if (e.type === 'entries' && e.name && e.name !== fullData.name) {
        const traitDesc = extractText(e.entries);
        traits.push({ name: e.name, desc: formatVaultMarkdown(traitDesc) });
      }
    });
  }

  // Extract basic info
  let info = [];
  if (fullData.size) {
    const sizeMap = { 'M': 'Medium', 'S': 'Small', 'L': 'Large', 'T': 'Tiny', 'H': 'Huge', 'G': 'Gargantuan' };
    const sizes = Array.isArray(fullData.size) ? fullData.size : [fullData.size];
    info.push('**Size:** ' + sizes.map(s => sizeMap[s] || s).join(' or '));
  }
  if (fullData.speed) {
    if (typeof fullData.speed === 'number') {
      info.push('**Speed:** ' + fullData.speed + ' ft.');
    } else if (fullData.speed.walk) {
      info.push('**Speed:** ' + fullData.speed.walk + ' ft.');
    }
  }

  return {
    name: fullData.name,
    desc: formatVaultMarkdown(desc || 'A playable race from D&D 5e.'),
    info: info,
    traits: traits,
    source: sourceMap[fullData.source] || fullData.source || 'Unknown',
    apiUsed: '5e.tools (local)',
    full_data: fullData
  };
}

// Get classes list
function getClassesList(search = '') {
  let sql = 'SELECT id, name, source, hit_die FROM dnd_classes WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND search_text LIKE ?';
    params.push(`%${search.toLowerCase()}%`);
  }

  sql += ' ORDER BY name COLLATE NOCASE';

  const classes = db.prepare(sql).all(...params);

  return classes.map(c => ({
    key: c.name.toLowerCase().replace(/\s+/g, '-'),
    name: c.name,
    hitDice: c.hit_die || 8,
    desc: '',
    source: sourceMap[c.source] || c.source
  }));
}

// Get class details
function getClassDetails(name) {
  const normalized = name.toLowerCase().replace(/-/g, ' ');
  const cls = db.prepare('SELECT * FROM dnd_classes WHERE LOWER(name) = ?').get(normalized);

  if (!cls) return null;

  const fullData = JSON.parse(cls.raw_data);

  // Extract description from fluff
  let desc = '';
  if (fullData.fluff && fullData.fluff[0] && fullData.fluff[0].entries) {
    desc = fullData.fluff[0].entries.map(e => {
      if (typeof e === 'string') return clean5eToolsTags(e);
      if (e.type === 'entries' && e.entries) {
        return e.entries.map(sub => {
          if (typeof sub === 'string') return clean5eToolsTags(sub);
          if (sub.type === 'entries' && sub.entries) {
            return sub.entries.map(s => typeof s === 'string' ? clean5eToolsTags(s) : '').join(' ');
          }
          return '';
        }).join(' ');
      }
      return '';
    }).filter(Boolean).join('\n\n');
  }

  // If no description from fluff, try to generate one from class features
  if (!desc && fullData.name) {
    const classDescriptions = {
      'Wizard': 'Masters of arcane magic with access to the most extensive spell list in the game.',
      'Fighter': 'Masters of martial combat, skilled with a variety of weapons and armor.',
      'Cleric': 'Divine spellcasters who serve the gods and channel holy power.',
      'Rogue': 'Skilled experts in stealth, deception, and precision strikes.',
      'Ranger': 'Warriors of the wilderness who blend martial prowess with nature magic.',
      'Paladin': 'Holy warriors who swear sacred oaths and wield divine magic.',
      'Barbarian': 'Fierce warriors who channel primal rage in battle.',
      'Bard': 'Versatile performers who weave magic through music and charm.',
      'Druid': 'Guardians of nature who can shapeshift and command natural magic.',
      'Monk': 'Masters of martial arts who channel mystical energy through their bodies.',
      'Sorcerer': 'Natural spellcasters whose magic comes from their bloodline.',
      'Warlock': 'Spellcasters who gain power through a pact with an otherworldly patron.',
      'Artificer': 'Masters of invention who use magic to create powerful items.'
    };
    desc = classDescriptions[fullData.name] || `A ${fullData.name} from D&D 5e.`;
  }

  // Extract features - parse the pipe-delimited strings
  const features = [];
  if (fullData.classFeatures && Array.isArray(fullData.classFeatures)) {
    fullData.classFeatures.slice(0, 20).forEach(f => {
      if (typeof f === 'string') {
        // Format: "Feature Name|ClassName|Source|Level"
        const parts = f.split('|');
        const featureName = parts[0] || '';
        const level = parts[3] ? parseInt(parts[3]) : null;
        const source = parts[2] || '';

        if (featureName) {
          features.push({
            name: featureName,
            level: level,
            source: source
          });
        }
      }
    });
  }

  // Sort features by level
  features.sort((a, b) => (a.level || 0) - (b.level || 0));

  // Extract proficiencies
  let proficiencies = [];
  if (fullData.startingProficiencies) {
    // Armor
    if (fullData.startingProficiencies.armor && fullData.startingProficiencies.armor.length > 0) {
      const armorList = fullData.startingProficiencies.armor.map(a => clean5eToolsTags(a)).join(', ');
      proficiencies.push('**Armor:** ' + armorList);
    } else {
      proficiencies.push('**Armor:** None');
    }

    // Weapons
    if (fullData.startingProficiencies.weapons && fullData.startingProficiencies.weapons.length > 0) {
      const weaponList = fullData.startingProficiencies.weapons.map(w => clean5eToolsTags(w)).join(', ');
      proficiencies.push('**Weapons:** ' + weaponList);
    }

    // Tools
    if (fullData.startingProficiencies.tools && fullData.startingProficiencies.tools.length > 0) {
      const toolList = fullData.startingProficiencies.tools.map(t => clean5eToolsTags(t)).join(', ');
      proficiencies.push('**Tools:** ' + toolList);
    }

    // Skills - can be array of objects with choose property
    if (fullData.startingProficiencies.skills) {
      let skillCount = 2;
      let skillList = [];

      // Handle array structure: [{choose: {from: [...], count: 2}}]
      if (Array.isArray(fullData.startingProficiencies.skills)) {
        fullData.startingProficiencies.skills.forEach(skillObj => {
          if (skillObj.choose) {
            skillCount = skillObj.choose.count || 2;
            if (skillObj.choose.from && Array.isArray(skillObj.choose.from)) {
              skillList = skillList.concat(skillObj.choose.from);
            }
          } else if (typeof skillObj === 'string') {
            skillList.push(skillObj);
          } else if (skillObj.skill) {
            skillList.push(skillObj.skill);
          }
        });
      }

      if (skillList.length > 0) {
        // Capitalize first letter of each skill
        const skills = skillList.map(s => {
          const skill = typeof s === 'string' ? s : (s.skill || '');
          return skill.charAt(0).toUpperCase() + skill.slice(1);
        }).join(', ');
        proficiencies.push('**Skills:** Choose ' + skillCount + ' from ' + skills);
      }
    }
  }

  // Extract starting equipment
  let equipment = [];
  if (fullData.startingEquipment && fullData.startingEquipment.default) {
    equipment = fullData.startingEquipment.default.map(e => {
      if (typeof e === 'string') return clean5eToolsTags(e);
      if (e._) return clean5eToolsTags(e._);
      return '';
    }).filter(Boolean);
  }

  return {
    name: fullData.name,
    desc: formatVaultMarkdown(desc || `A versatile spellcaster with access to a vast spell library.`),
    hitDice: fullData.hd?.faces || 8,
    primaryAbilities: fullData.spellcastingAbility ? [fullData.spellcastingAbility.toUpperCase()] : [],
    savingThrows: JSON.parse(cls.proficiencies || '[]'),
    proficiencies: proficiencies,
    equipment: equipment,
    features: features,
    source: sourceMap[fullData.source] || fullData.source || 'Unknown',
    apiUsed: '5e.tools (local)',
    full_data: fullData
  };
}

// Get spells list
function getSpellsList(search = '', level = null, school = null, source = null, castType = null) {
  let sql = 'SELECT id, name, level, school, casting_time, duration, source FROM dnd_spells WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND search_text LIKE ?';
    params.push(`%${search.toLowerCase()}%`);
  }

  if (level !== null && level !== undefined && level !== '') {
    sql += ' AND level = ?';
    params.push(parseInt(level));
  }

  if (school) {
    sql += ' AND school = ?';
    params.push(school);
  }

  if (source) {
    sql += ' AND source = ?';
    params.push(source);
  }

  sql += ' ORDER BY level, name COLLATE NOCASE LIMIT 100';

  const spells = db.prepare(sql).all(...params);

  return spells.map(sp => {
    const fullData = db.prepare('SELECT raw_data FROM dnd_spells WHERE id = ?').get(sp.id);
    const spell = JSON.parse(fullData.raw_data);

    const isConcentration = spell.duration?.[0]?.concentration || false;
    const isRitual = spell.meta?.ritual || false;

    // Filter by cast type (concentration/ritual)
    if (castType) {
      if (castType === 'concentration' && !isConcentration) return null;
      if (castType === 'ritual' && !isRitual) return null;
      if (castType === 'action') {
        const castTime = spell.time?.[0]?.unit;
        if (castTime !== 'action') return null;
      }
    }

    return {
      key: sp.name.toLowerCase().replace(/\s+/g, '-'),
      name: sp.name,
      level: sp.level,
      school: sp.school || '',
      castingTime: sp.casting_time || 'Unknown',
      concentration: isConcentration,
      ritual: isRitual,
      source: sp.source
    };
  }).filter(Boolean);
}

// Get spell details
function getSpellDetails(name) {
  const normalized = name.toLowerCase();
  const spell = db.prepare('SELECT * FROM dnd_spells WHERE LOWER(name) = ?').get(normalized);

  if (!spell) return null;

  const fullData = JSON.parse(spell.raw_data);

  // Components
  const components = [];
  if (fullData.components?.v) components.push('V');
  if (fullData.components?.s) components.push('S');
  if (fullData.components?.m) components.push('M');

  // Description
  let description = '';
  if (fullData.entries && Array.isArray(fullData.entries)) {
    description = fullData.entries.map(e => {
      if (typeof e === 'string') return e;
      if (e.type === 'entries' && e.items) return e.items.join(' ');
      return '';
    }).filter(Boolean).join('\n\n');
  }

  // Higher levels
  let higherLevels = '';
  if (fullData.entriesHigherLevel && Array.isArray(fullData.entriesHigherLevel)) {
    higherLevels = fullData.entriesHigherLevel.map(e => {
      if (e.entries && Array.isArray(e.entries)) {
        return e.entries.join(' ');
      }
      return '';
    }).filter(Boolean).join('\n\n');
  }

  // Classes
  let classes = '';
  if (fullData.classes?.fromClassList && Array.isArray(fullData.classes.fromClassList)) {
    classes = fullData.classes.fromClassList.map(c => c.name).join(', ');
  }

  return {
    name: fullData.name,
    level: fullData.level,
    school: schoolMap[fullData.school] || fullData.school,
    castingTime: spell.casting_time,
    range: spell.range,
    duration: spell.duration,
    components: components.join(', '),
    material: typeof fullData.components?.m === 'object' ? fullData.components.m.text : fullData.components?.m || '',
    concentration: fullData.duration?.[0]?.concentration || false,
    ritual: fullData.meta?.ritual || false,
    description: formatVaultMarkdown(description),
    higherLevels: higherLevels ? formatVaultMarkdown(higherLevels) : '',
    classes: classes,
    source: sourceMap[fullData.source] || fullData.source || 'Unknown',
    apiUsed: '5e.tools (local)',
    full_data: fullData  // Include raw data for advanced formatting
  };
}

// Get items list
function getItemsList(search = '', category = null, magic = null, rarity = null) {
  let sql = 'SELECT id, name, source, type, rarity, value, weight FROM dnd_items WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND search_text LIKE ?';
    params.push(`%${search.toLowerCase()}%`);
  }

  if (category) {
    // Match items where type starts with the category code (e.g., "M" or "M|XPHB")
    sql += ' AND type LIKE ?';
    params.push(`${category}%`);
  }

  // Note: 5e.tools doesn't have a direct "is_magic_item" field like Open5e
  // We can approximate by checking rarity
  // IMPORTANT: This must come BEFORE the rarity filter to work properly
  if (magic === 'true') {
    sql += " AND rarity IS NOT NULL AND rarity NOT IN ('none', '')";
  } else if (magic === 'false') {
    sql += " AND (rarity IS NULL OR rarity IN ('none', ''))";
  }

  if (rarity && rarity !== 'none') {
    sql += ' AND rarity = ?';
    params.push(rarity);
  }

  sql += ' ORDER BY name COLLATE NOCASE LIMIT 100';

  const items = db.prepare(sql).all(...params);

  return items.map(i => ({
    key: i.name.toLowerCase().replace(/\s+/g, '-'),
    name: i.name,
    category: getItemType(i.type) || i.type,
    rarity: i.rarity || '',
    isMagic: i.rarity && i.rarity !== 'none',
    cost: i.value,
    weight: formatWeight(i.weight)
  }));
}

// Get item details
function getItemDetails(name) {
  const normalized = name.toLowerCase().replace(/-/g, ' ');
  const item = db.prepare('SELECT * FROM dnd_items WHERE LOWER(name) = ?').get(normalized);

  if (!item) return null;

  const fullData = JSON.parse(item.raw_data);

  // Description
  let desc = '';
  if (fullData.entries && Array.isArray(fullData.entries)) {
    desc = fullData.entries.map(e => {
      if (typeof e === 'string') return e;
      if (e.type === 'entries' && e.entries) return e.entries.join('\n\n');
      return '';
    }).filter(Boolean).join('\n\n');
  }

  return {
    name: fullData.name,
    desc: formatVaultMarkdown(desc),
    category: getItemType(fullData.type) || fullData.type,
    rarity: fullData.rarity || '',
    isMagic: fullData.rarity && fullData.rarity !== 'none',
    cost: fullData.value,
    weight: formatWeight(fullData.weight),
    weightUnit: 'lb',
    requiresAttunement: fullData.reqAttune || false,
    attunementDetail: fullData.reqAttune || '',
    weapon: fullData.weapon || null,
    armor: fullData.armor || null,
    source: sourceMap[fullData.source] || fullData.source || '',
    apiUsed: '5e.tools (local)'
  };
}

module.exports = {
  getRacesList,
  getRaceDetails,
  getClassesList,
  getClassDetails,
  getSpellsList,
  getSpellDetails,
  getItemsList,
  getItemDetails
};
