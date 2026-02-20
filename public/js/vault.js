/**
 * The Vault of Ancient Lore
 * D&D 5e Reference Browser
 */

(function() {
  'use strict';

  var searchTimeout = null;
  var modal = document.getElementById('vault-modal');
  var modalTitle = modal.querySelector('.vault-modal-title');
  var modalBody = modal.querySelector('.vault-modal-body');

  // === Tab Navigation ===
  var tabs = document.querySelectorAll('.vault-tab');
  var panels = document.querySelectorAll('.vault-panel');

  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      var target = tab.getAttribute('data-tab');

      tabs.forEach(function(t) { t.classList.remove('active'); });
      panels.forEach(function(p) { p.classList.remove('active'); });

      tab.classList.add('active');
      document.getElementById('vault-' + target).classList.add('active');

      // Load data if not already loaded
      loadTabData(target);
    });
  });

  // === Modal ===
  modal.addEventListener('click', function(e) {
    if (e.target === modal || e.target.classList.contains('vault-modal-close')) {
      modal.style.display = 'none';
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      modal.style.display = 'none';
    }
  });

  function showModal(title, content) {
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    modal.style.display = 'flex';
  }

  function showModalLoading(title) {
    modalTitle.textContent = title;
    modalBody.innerHTML = '<div class="vault-loading">Loading details...</div>';
    modal.style.display = 'flex';
  }

  // === Data Loading ===
  function loadTabData(tab) {
    switch (tab) {
      case 'species': loadSpecies(); break;
      case 'classes': loadClasses(); break;
      case 'spells': loadSpells(); break;
      case 'items': loadItems(); break;
      case 'feats': loadFeats(); break;
      case 'optfeatures': loadOptFeatures(); break;
      case 'backgrounds': loadBackgrounds(); break;
      case 'monsters': loadMonsters(); break;
      case 'conditions': loadConditions(); break;
      case 'rules': loadRules(); break;
    }
  }

  // === Species ===
  function loadSpecies() {
    var search = document.getElementById('species-search').value.trim();
    var container = document.getElementById('species-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';

    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));

    var url = '/vault/species' + (params.length ? '?' + params.join('&') : '');

    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.results || data.results.length === 0) {
          container.innerHTML = '<div class="vault-empty">No species found</div>';
          return;
        }
        container.innerHTML = data.results.map(function(s) {
          return '<div class="vault-card" data-type="species" data-key="' + s.key + '">' +
            '<div class="vault-card-title">' + s.name + '</div>' +
            '<div class="vault-card-meta">' + s.source + '</div>' +
            '<div class="vault-card-desc">' + (s.desc || '') + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function() {
        container.innerHTML = '<div class="vault-error">Failed to load species</div>';
      });
  }

  function showSpeciesDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/species/' + encodeURIComponent(key))
      .then(function(res) { return res.json(); })
      .then(function(s) {
        if (s.error) {
          showModal('Error', '<p>Could not load race details.</p>');
          return;
        }

        // Build D&D Beyond style race card
        var html = '<div class="dnd-card">';

        // Title
        html += '<h2 class="dnd-title">👤 ' + s.name + '</h2>';
        html += '<p class="dnd-subtitle"><em>D&D 5e Race</em></p>';
        html += '<hr class="dnd-divider">';

        // Basic Info (Size, Speed)
        if (s.info && s.info.length > 0) {
          html += '<div class="dnd-stats">';
          s.info.forEach(function(info) {
            html += '<p>' + info + '</p>';
          });
          html += '</div>';
          html += '<hr class="dnd-divider">';
        }

        // Description
        if (s.desc) {
          html += '<h3 class="dnd-section">Description</h3>';
          html += '<div class="dnd-description">' + s.desc + '</div>';
        }

        // Racial Traits
        if (s.traits && s.traits.length > 0) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Racial Traits</h3>';
          html += '<div class="dnd-description">';
          s.traits.forEach(function(t) {
            html += '<p><strong>' + t.name + '</strong><br>' + t.desc + '</p>';
          });
          html += '</div>';
        }

        // Source
        html += '<hr class="dnd-divider">';
        html += '<p class="dnd-source"><strong>Source:</strong> ' + s.source + '</p>';

        html += '</div>';
        showModal(s.name, html);
      });
  }

  // === Classes ===
  function loadClasses() {
    var search = document.getElementById('classes-search').value.trim();
    var container = document.getElementById('classes-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';

    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));

    var url = '/vault/classes' + (params.length ? '?' + params.join('&') : '');

    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.results || data.results.length === 0) {
          container.innerHTML = '<div class="vault-empty">No classes found</div>';
          return;
        }
        container.innerHTML = data.results.map(function(c) {
          return '<div class="vault-card" data-type="classes" data-key="' + c.key + '">' +
            '<div class="vault-card-title">' + c.name + '</div>' +
            '<div class="vault-card-meta">Hit Die: d' + c.hitDice + ' &bull; ' + c.source + '</div>' +
            '<div class="vault-card-desc">' + (c.desc || '') + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function() {
        container.innerHTML = '<div class="vault-error">Failed to load classes</div>';
      });
  }

  function showClassDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/classes/' + encodeURIComponent(key))
      .then(function(res) { return res.json(); })
      .then(function(c) {
        if (c.error) {
          showModal('Error', '<p>Could not load class details.</p>');
          return;
        }

        var emoji = getClassEmoji(c.name);

        // Build D&D Beyond style class card
        var html = '<div class="dnd-card">';

        // Title
        html += '<h2 class="dnd-title">' + emoji + ' ' + c.name + '</h2>';
        html += '<p class="dnd-subtitle"><em>D&D 5e Class</em></p>';
        html += '<hr class="dnd-divider">';

        // Description
        html += '<div class="dnd-description">' + c.desc + '</div>';
        html += '<hr class="dnd-divider">';

        // Summary Stats
        html += '<h3 class="dnd-section">Summary</h3>';
        html += '<div class="dnd-stats">';
        html += '<p><strong>Hit Die</strong><br>d' + c.hitDice + '</p>';
        if (c.primaryAbilities && c.primaryAbilities.length > 0) {
          html += '<p><strong>Primary Ability</strong><br>' + c.primaryAbilities.join(', ').toUpperCase() + '</p>';
        }
        if (c.savingThrows && c.savingThrows.length > 0) {
          html += '<p><strong>Saving Throws</strong><br>' + c.savingThrows.join(', ').toUpperCase() + '</p>';
        }
        html += '</div>';

        // Proficiencies
        if (c.proficiencies && c.proficiencies.length > 0) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Proficiencies</h3>';
          html += '<div class="dnd-description">';
          c.proficiencies.forEach(function(prof) {
            html += '<p>' + prof + '</p>';
          });
          html += '</div>';
        }

        // Starting Equipment
        if (c.equipment && c.equipment.length > 0) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Starting Equipment</h3>';
          html += '<div class="dnd-description"><ul>';
          c.equipment.forEach(function(eq) {
            html += '<li>' + eq + '</li>';
          });
          html += '</ul></div>';
        }

        // Features - Group by level
        if (c.features && c.features.length > 0) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Class Features by Level</h3>';

          // Group features by level
          var featuresByLevel = {};
          c.features.forEach(function(f) {
            var lvl = f.level || 1;
            if (!featuresByLevel[lvl]) {
              featuresByLevel[lvl] = [];
            }
            featuresByLevel[lvl].push(f);
          });

          // Display as table
          html += '<table class="dnd-table">';
          html += '<tr><th>Level</th><th>Features</th></tr>';

          Object.keys(featuresByLevel).sort(function(a, b) { return parseInt(a) - parseInt(b); }).forEach(function(lvl) {
            var featureNames = featuresByLevel[lvl].map(function(f) { return f.name; }).join(', ');
            html += '<tr><td>' + lvl + '</td><td>' + featureNames + '</td></tr>';
          });
          html += '</table>';
        }

        // Source
        html += '<hr class="dnd-divider">';
        html += '<p class="dnd-source"><strong>Source:</strong> ' + c.source + '</p>';

        html += '</div>';
        showModal(c.name, html);
      });
  }

  function getClassEmoji(className) {
    var emojiMap = {
      'Barbarian': '⚔️',
      'Bard': '🎵',
      'Cleric': '✨',
      'Druid': '🌿',
      'Fighter': '⚔️',
      'Monk': '🥋',
      'Paladin': '🛡️',
      'Ranger': '🏹',
      'Rogue': '🗡️',
      'Sorcerer': '🔥',
      'Warlock': '🌙',
      'Wizard': '🧙'
    };
    return emojiMap[className] || '📖';
  }

  // === Spells ===
  function loadSpells() {
    var search = document.getElementById('spells-search').value.trim();
    var level = document.getElementById('spells-level').value;
    var school = document.getElementById('spells-school').value;
    var source = document.getElementById('spells-source').value;
    var castType = document.getElementById('spells-casttype').value;
    var container = document.getElementById('spells-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';

    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (level) params.push('level=' + level);
    if (school) params.push('school=' + encodeURIComponent(school));
    if (source) params.push('source=' + encodeURIComponent(source));
    if (castType) params.push('castType=' + encodeURIComponent(castType));

    var url = '/vault/spells' + (params.length ? '?' + params.join('&') : '');

    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.results || data.results.length === 0) {
          container.innerHTML = '<div class="vault-empty">No spells found</div>';
          return;
        }
        container.innerHTML = data.results.map(function(sp) {
          var levelText = sp.level === 0 ? 'Cantrip' : 'Level ' + sp.level;
          var tags = [];
          if (sp.concentration) tags.push('C');
          if (sp.ritual) tags.push('R');
          var tagHtml = tags.length ? ' <span class="vault-spell-tags">' + tags.join(' ') + '</span>' : '';

          return '<div class="vault-card vault-card-spell" data-type="spell" data-name="' + sp.name + '">' +
            '<div class="vault-card-title">' + sp.name + tagHtml + '</div>' +
            '<div class="vault-card-meta">' + levelText + ' ' + sp.school + '</div>' +
            '<div class="vault-card-desc">' + sp.castingTime + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function() {
        container.innerHTML = '<div class="vault-error">Failed to load spells</div>';
      });
  }

  function showSpellDetail(name) {
    showModalLoading(name);
    fetch('/vault/spells/details?name=' + encodeURIComponent(name))
      .then(function(res) { return res.json(); })
      .then(function(spell) {
        if (spell.error) {
          showModal(name, '<p>Could not load spell details.</p>');
          return;
        }

        var rawData = spell.full_data || {};
        var levelText = spell.level === 0 ? 'Cantrip' : 'Level ' + spell.level + ' Spell';
        var emoji = getSpellEmoji(spell.school);

        // Build D&D Beyond style spell card
        var html = '<div class="dnd-card">';

        // Title
        html += '<h2 class="dnd-title">' + emoji + ' ' + spell.name + '</h2>';
        html += '<p class="dnd-subtitle"><em>' + spell.school + ' ' + levelText + '</em></p>';
        html += '<hr class="dnd-divider">';

        // Stats section
        html += '<div class="dnd-stats">';
        html += '<p><strong>Casting Time</strong><br>' + spell.castingTime + '</p>';
        html += '<p><strong>Range</strong><br>' + spell.range + '</p>';
        html += '<p><strong>Components</strong><br>' + spell.components;
        if (spell.material) html += '<br><span class="dnd-small">(' + spell.material + ')</span>';
        html += '</p>';
        html += '<p><strong>Duration</strong><br>';
        if (spell.concentration) html += '<span class="dnd-tag">Concentration</span> ';
        html += spell.duration + '</p>';
        html += '</div>';
        html += '<hr class="dnd-divider">';

        // Description
        html += '<h3 class="dnd-section">Description</h3>';
        html += '<div class="dnd-description">' + spell.description + '</div>';

        // At Higher Levels (with scaling table for cantrips)
        if (rawData.scalingLevelDice && rawData.scalingLevelDice.length > 0) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">At Higher Levels</h3>';
          html += '<table class="dnd-table">';
          html += '<tr><th>Level</th>';

          rawData.scalingLevelDice.forEach(function(scale) {
            html += '<th>' + (scale.label || 'Damage') + '</th>';
          });
          html += '</tr>';

          var levels = ['1–4', '5–10', '11–16', '17+'];
          var levelRanges = [[1, 4], [5, 10], [11, 16], [17, 20]];

          levels.forEach(function(levelText, idx) {
            html += '<tr><td>' + levelText + '</td>';
            var range = levelRanges[idx];

            rawData.scalingLevelDice.forEach(function(scale) {
              var dice = '—';
              for (var lvl = range[1]; lvl >= range[0]; lvl--) {
                if (scale.scaling && scale.scaling[lvl]) {
                  dice = scale.scaling[lvl];
                  break;
                }
              }
              html += '<td>' + dice + '</td>';
            });
            html += '</tr>';
          });
          html += '</table>';
        } else if (spell.higherLevels) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">At Higher Levels</h3>';
          html += '<div class="dnd-description">' + spell.higherLevels + '</div>';
        }

        // Available For
        if (spell.classes || rawData.classes) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Available For</h3>';
          html += '<p><strong>Classes:</strong> ' + (spell.classes || extractClasses(rawData)) + '</p>';
        }

        // Source
        html += '<hr class="dnd-divider">';
        html += '<p class="dnd-source"><strong>Source:</strong> ' + spell.source + '</p>';

        html += '</div>';
        showModal(spell.name, html);
      });
  }

  function getSpellEmoji(school) {
    var emojiMap = {
      'Abjuration': '🛡️',
      'Conjuration': '🌀',
      'Divination': '🔮',
      'Enchantment': '✨',
      'Evocation': '⚡',
      'Illusion': '🎭',
      'Necromancy': '💀',
      'Transmutation': '🔄'
    };
    return emojiMap[school] || '📜';
  }

  function extractClasses(rawData) {
    if (!rawData.classes || !rawData.classes.fromClassList) return '';
    return rawData.classes.fromClassList.map(function(c) { return c.name; }).join(', ');
  }

  // === Items ===
  function loadItems() {
    var search = document.getElementById('items-search').value.trim();
    var category = document.getElementById('items-category').value;
    var rarity = document.getElementById('items-rarity').value;
    var magic = document.getElementById('items-magic').value;
    var container = document.getElementById('items-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';

    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (category) params.push('category=' + encodeURIComponent(category));
    if (rarity) params.push('rarity=' + encodeURIComponent(rarity));
    if (magic) params.push('magic=' + magic);

    var url = '/vault/items' + (params.length ? '?' + params.join('&') : '');

    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data.results || data.results.length === 0) {
          container.innerHTML = '<div class="vault-empty">No items found</div>';
          return;
        }
        container.innerHTML = data.results.map(function(i) {
          var meta = [i.category];
          if (i.rarity) meta.push(i.rarity);
          if (i.isMagic) meta.push('Magic');

          return '<div class="vault-card' + (i.isMagic ? ' vault-card-magic' : '') + '" data-type="items" data-key="' + i.key + '">' +
            '<div class="vault-card-title">' + i.name + '</div>' +
            '<div class="vault-card-meta">' + meta.join(' &bull; ') + '</div>' +
            (i.cost ? '<div class="vault-card-desc">' + i.cost + ' gp' + (i.weight ? ' &bull; ' + i.weight + ' lb' : '') + '</div>' : '') +
          '</div>';
        }).join('');
      })
      .catch(function() {
        container.innerHTML = '<div class="vault-error">Failed to load items</div>';
      });
  }

  function showItemDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/items/' + encodeURIComponent(key))
      .then(function(res) { return res.json(); })
      .then(function(i) {
        if (i.error) {
          showModal('Error', '<p>Could not load item details.</p>');
          return;
        }

        var emoji = getItemEmoji(i.category, i.isMagic);

        // Build D&D Beyond style item card
        var html = '<div class="dnd-card">';

        // Title
        html += '<h2 class="dnd-title">' + emoji + ' ' + i.name + '</h2>';
        var subtitle = i.category;
        if (i.rarity && i.rarity !== 'none') {
          subtitle += ' (' + i.rarity + ')';
        }
        html += '<p class="dnd-subtitle"><em>' + subtitle + '</em></p>';
        html += '<hr class="dnd-divider">';

        // Stats section
        html += '<div class="dnd-stats">';
        if (i.category) {
          html += '<p><strong>Category</strong><br>' + i.category + '</p>';
        }
        if (i.rarity && i.rarity !== 'none') {
          html += '<p><strong>Rarity</strong><br>';
          if (i.isMagic) html += '<span class="dnd-tag">Magic</span> ';
          html += i.rarity + '</p>';
        }
        if (i.cost) {
          html += '<p><strong>Cost</strong><br>' + i.cost + ' gp</p>';
        }
        if (i.weight) {
          html += '<p><strong>Weight</strong><br>' + i.weight + ' ' + (i.weightUnit || 'lb') + '</p>';
        }
        html += '</div>';

        // Attunement
        if (i.requiresAttunement) {
          html += '<p class="dnd-tag">Requires Attunement';
          if (i.attunementDetail) html += ' (' + i.attunementDetail + ')';
          html += '</p>';
        }

        html += '<hr class="dnd-divider">';

        // Description
        html += '<h3 class="dnd-section">Description</h3>';
        html += '<div class="dnd-description">' + i.desc + '</div>';

        // Weapon stats
        if (i.weapon) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Weapon Properties</h3>';
          html += '<div class="dnd-description">';
          if (i.weapon.damage) html += '<p><strong>Damage:</strong> ' + i.weapon.damage + '</p>';
          if (i.weapon.damageType) html += '<p><strong>Damage Type:</strong> ' + i.weapon.damageType + '</p>';
          if (i.weapon.properties) html += '<p><strong>Properties:</strong> ' + i.weapon.properties.join(', ') + '</p>';
          html += '</div>';
        }

        // Armor stats
        if (i.armor) {
          html += '<hr class="dnd-divider">';
          html += '<h3 class="dnd-section">Armor Properties</h3>';
          html += '<div class="dnd-description">';
          if (i.armor.ac) html += '<p><strong>AC:</strong> ' + i.armor.ac + '</p>';
          if (i.armor.type) html += '<p><strong>Armor Type:</strong> ' + i.armor.type + '</p>';
          if (i.armor.stealthDisadvantage) html += '<p><span class="dnd-tag">Stealth Disadvantage</span></p>';
          html += '</div>';
        }

        // Source
        html += '<hr class="dnd-divider">';
        html += '<p class="dnd-source"><strong>Source:</strong> ' + i.source + '</p>';

        html += '</div>';
        showModal(i.name, html);
      });
  }

  function getItemEmoji(category, isMagic) {
    if (isMagic) return '✨';

    var emojiMap = {
      'Weapon': '⚔️',
      'Armor': '🛡️',
      'Potion': '🧪',
      'Ring': '💍',
      'Rod': '🪄',
      'Scroll': '📜',
      'Staff': '🪄',
      'Wand': '🪄',
      'Wondrous Item': '✨',
      'Adventuring Gear': '🎒',
      'Tools': '🔧',
      'Ammunition': '🏹'
    };
    return emojiMap[category] || '📦';
  }

  // === Feats ===
  function loadFeats() {
    var search = document.getElementById('feats-search').value.trim();
    var container = document.getElementById('feats-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var url = '/vault/feats' + (search ? '?search=' + encodeURIComponent(search) : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No feats found</div>'; return; }
      container.innerHTML = data.results.map(function(f) {
        return '<div class="vault-card" data-type="feats" data-key="' + f.key + '">' +
          '<div class="vault-card-title">' + f.name + '</div>' +
          '<div class="vault-card-meta">' + f.source + '</div>' +
          '<div class="vault-card-desc">Prerequisite: ' + f.prerequisite + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load feats</div>';});
  }

  function showFeatDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/feats/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(f) {
      if (f.error) { showModal('Error', '<p>Could not load feat details.</p>'); return; }
      var html = '<div class="dnd-card"><h2 class="dnd-title">🎯 ' + f.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>Feat</em></p><hr class="dnd-divider">';
      html += '<p><strong>Prerequisite:</strong> ' + f.prerequisite + '</p><hr class="dnd-divider">';
      html += '<h3 class="dnd-section">Description</h3><div class="dnd-description">' + f.desc + '</div>';
      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + f.source + '</p></div>';
      showModal(f.name, html);
    });
  }

  // === Optional Features ===
  var optFeatureTypesLoaded = false;
  function loadOptFeatureTypes() {
    if (optFeatureTypesLoaded) return;
    fetch('/vault/optfeatures/types').then(function(r){return r.json();}).then(function(data) {
      var sel = document.getElementById('optfeatures-type');
      (data.types || []).forEach(function(t) {
        var opt = document.createElement('option'); opt.value = t; opt.textContent = t; sel.appendChild(opt);
      });
      optFeatureTypesLoaded = true;
    });
  }

  function loadOptFeatures() {
    loadOptFeatureTypes();
    var search = document.getElementById('optfeatures-search').value.trim();
    var type = document.getElementById('optfeatures-type').value;
    var container = document.getElementById('optfeatures-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (type) params.push('type=' + encodeURIComponent(type));
    var url = '/vault/optfeatures' + (params.length ? '?' + params.join('&') : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No optional features found</div>'; return; }
      container.innerHTML = data.results.map(function(f) {
        return '<div class="vault-card" data-type="optfeatures" data-key="' + f.key + '">' +
          '<div class="vault-card-title">' + f.name + '</div>' +
          '<div class="vault-card-meta">' + f.featureType + ' &bull; ' + f.source + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load</div>';});
  }

  function showOptFeatureDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/optfeatures/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(f) {
      if (f.error) { showModal('Error', '<p>Not found.</p>'); return; }
      var html = '<div class="dnd-card"><h2 class="dnd-title">⚡ ' + f.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>' + f.featureType + '</em></p><hr class="dnd-divider">';
      html += '<h3 class="dnd-section">Description</h3><div class="dnd-description">' + f.desc + '</div>';
      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + f.source + '</p></div>';
      showModal(f.name, html);
    });
  }

  // === Backgrounds ===
  function loadBackgrounds() {
    var search = document.getElementById('backgrounds-search').value.trim();
    var container = document.getElementById('backgrounds-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var url = '/vault/backgrounds' + (search ? '?search=' + encodeURIComponent(search) : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No backgrounds found</div>'; return; }
      container.innerHTML = data.results.map(function(b) {
        return '<div class="vault-card" data-type="backgrounds" data-key="' + b.key + '">' +
          '<div class="vault-card-title">' + b.name + '</div>' +
          '<div class="vault-card-meta">' + b.source + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load</div>';});
  }

  function showBackgroundDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/backgrounds/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(b) {
      if (b.error) { showModal('Error', '<p>Not found.</p>'); return; }
      var html = '<div class="dnd-card"><h2 class="dnd-title">📜 ' + b.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>Background</em></p><hr class="dnd-divider">';
      if (b.skills) { html += '<p><strong>Skills:</strong> ' + b.skills + '</p><hr class="dnd-divider">'; }
      html += '<h3 class="dnd-section">Description</h3><div class="dnd-description">' + b.desc + '</div>';
      if (b.traits && b.traits.length) {
        html += '<hr class="dnd-divider"><h3 class="dnd-section">Features</h3><div class="dnd-description">';
        b.traits.forEach(function(t) { html += '<p><strong>' + t.name + '</strong><br>' + t.desc + '</p>'; });
        html += '</div>';
      }
      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + b.source + '</p></div>';
      showModal(b.name, html);
    });
  }

  // === Bestiary/Monsters ===
  var monsterTypesLoaded = false;
  function loadMonsterTypes() {
    if (monsterTypesLoaded) return;
    fetch('/vault/monsters/types').then(function(r){return r.json();}).then(function(data) {
      var sel = document.getElementById('monsters-type');
      (data.types || []).forEach(function(t) {
        var opt = document.createElement('option'); opt.value = t; opt.textContent = t.charAt(0).toUpperCase() + t.slice(1); sel.appendChild(opt);
      });
      monsterTypesLoaded = true;
    });
  }

  function loadMonsters() {
    loadMonsterTypes();
    var search = document.getElementById('monsters-search').value.trim();
    var cr = document.getElementById('monsters-cr').value;
    var type = document.getElementById('monsters-type').value;
    var size = document.getElementById('monsters-size').value;
    var container = document.getElementById('monsters-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (cr) params.push('cr=' + encodeURIComponent(cr));
    if (type) params.push('type=' + encodeURIComponent(type));
    if (size) params.push('size=' + encodeURIComponent(size));
    var url = '/vault/monsters' + (params.length ? '?' + params.join('&') : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No monsters found. Try a search term.</div>'; return; }
      container.innerHTML = data.results.map(function(m) {
        return '<div class="vault-card" data-type="monsters" data-key="' + m.key + '">' +
          '<div class="vault-card-title">' + m.name + '</div>' +
          '<div class="vault-card-meta">CR ' + m.cr + ' &bull; ' + m.type + ' &bull; ' + m.size + '</div>' +
          '<div class="vault-card-desc">' + m.source + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load</div>';});
  }

  function showMonsterDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/monsters/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(m) {
      if (m.error) { showModal('Error', '<p>Not found.</p>'); return; }
      var html = '<div class="dnd-card">';
      html += '<h2 class="dnd-title">🐉 ' + m.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>' + m.sizeStr + ' ' + m.typeStr + (m.alignment ? ', ' + m.alignment : '') + '</em></p>';
      html += '<hr class="dnd-divider">';

      // Core stats
      html += '<div class="dnd-stats">';
      html += '<p><strong>AC</strong><br>' + m.ac + '</p>';
      html += '<p><strong>HP</strong><br>' + m.hp + '</p>';
      html += '<p><strong>Speed</strong><br>' + m.speed + '</p>';
      html += '</div><hr class="dnd-divider">';

      // Ability scores (some monsters lack these due to _copy references)
      if (m.abilities) {
        html += '<table class="dnd-table"><tr><th>STR</th><th>DEX</th><th>CON</th><th>INT</th><th>WIS</th><th>CHA</th></tr>';
        html += '<tr>';
        ['str','dex','con','int','wis','cha'].forEach(function(ab) {
          var a = m.abilities[ab];
          html += '<td>' + a.score + ' (' + a.mod + ')</td>';
        });
        html += '</tr></table><hr class="dnd-divider">';
      }

      // Secondary stats
      if (m.savingThrows) html += '<p><strong>Saving Throws:</strong> ' + m.savingThrows + '</p>';
      if (m.skills) html += '<p><strong>Skills:</strong> ' + m.skills + '</p>';
      if (m.damageResistances) html += '<p><strong>Damage Resistances:</strong> ' + m.damageResistances + '</p>';
      if (m.damageImmunities) html += '<p><strong>Damage Immunities:</strong> ' + m.damageImmunities + '</p>';
      if (m.conditionImmunities) html += '<p><strong>Condition Immunities:</strong> ' + m.conditionImmunities + '</p>';
      if (m.senses) html += '<p><strong>Senses:</strong> ' + m.senses + '</p>';
      html += '<p><strong>Languages:</strong> ' + m.languages + '</p>';
      html += '<p><strong>CR:</strong> ' + m.cr + (m.xp ? ' (' + m.xp + ' XP)' : '') + '</p>';
      html += '<hr class="dnd-divider">';

      if (m.traits) { html += '<h3 class="dnd-section">Traits</h3><div class="dnd-description">' + m.traits + '</div><hr class="dnd-divider">'; }
      if (m.actions) { html += '<h3 class="dnd-section">Actions</h3><div class="dnd-description">' + m.actions + '</div>'; }
      if (m.bonusActions) { html += '<hr class="dnd-divider"><h3 class="dnd-section">Bonus Actions</h3><div class="dnd-description">' + m.bonusActions + '</div>'; }
      if (m.reactions) { html += '<hr class="dnd-divider"><h3 class="dnd-section">Reactions</h3><div class="dnd-description">' + m.reactions + '</div>'; }
      if (m.legendaryActions) { html += '<hr class="dnd-divider"><h3 class="dnd-section">Legendary Actions</h3><div class="dnd-description">' + m.legendaryActions + '</div>'; }

      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + m.source + '</p></div>';
      showModal(m.name, html);
    });
  }

  // === Conditions ===
  function loadConditions() {
    var search = document.getElementById('conditions-search').value.trim();
    var type = document.getElementById('conditions-type').value;
    var container = document.getElementById('conditions-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var params = [];
    if (search) params.push('search=' + encodeURIComponent(search));
    if (type) params.push('type=' + encodeURIComponent(type));
    var url = '/vault/conditions' + (params.length ? '?' + params.join('&') : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No conditions found</div>'; return; }
      container.innerHTML = data.results.map(function(c) {
        var badge = c.conditionType === 'disease' ? '<span class="vault-spell-tags">Disease</span>' : '';
        return '<div class="vault-card" data-type="conditions" data-key="' + c.key + '">' +
          '<div class="vault-card-title">' + c.name + ' ' + badge + '</div>' +
          '<div class="vault-card-meta">' + c.source + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load</div>';});
  }

  function showConditionDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/conditions/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(c) {
      if (c.error) { showModal('Error', '<p>Not found.</p>'); return; }
      var emoji = c.conditionType === 'disease' ? '🦠' : '⚠️';
      var html = '<div class="dnd-card"><h2 class="dnd-title">' + emoji + ' ' + c.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>' + (c.conditionType === 'disease' ? 'Disease' : 'Condition') + '</em></p><hr class="dnd-divider">';
      html += '<h3 class="dnd-section">Description</h3><div class="dnd-description">' + c.desc + '</div>';
      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + c.source + '</p></div>';
      showModal(c.name, html);
    });
  }

  // === Rules ===
  function loadRules() {
    var search = document.getElementById('rules-search').value.trim();
    var container = document.getElementById('rules-results');
    container.innerHTML = '<div class="vault-loading">Loading...</div>';
    var url = '/vault/rules' + (search ? '?search=' + encodeURIComponent(search) : '');
    fetch(url).then(function(r){return r.json();}).then(function(data) {
      if (!data.results || !data.results.length) { container.innerHTML = '<div class="vault-empty">No rules found</div>'; return; }
      container.innerHTML = data.results.map(function(r) {
        return '<div class="vault-card" data-type="rules" data-key="' + r.key + '">' +
          '<div class="vault-card-title">' + r.name + '</div>' +
          '<div class="vault-card-meta">' + r.source + '</div></div>';
      }).join('');
    }).catch(function(){container.innerHTML='<div class="vault-error">Failed to load</div>';});
  }

  function showRuleDetail(key) {
    showModalLoading('Loading...');
    fetch('/vault/rules/' + encodeURIComponent(key)).then(function(r){return r.json();}).then(function(r) {
      if (r.error) { showModal('Error', '<p>Not found.</p>'); return; }
      var html = '<div class="dnd-card"><h2 class="dnd-title">📖 ' + r.name + '</h2>';
      html += '<p class="dnd-subtitle"><em>Rule / Action</em></p><hr class="dnd-divider">';
      html += '<h3 class="dnd-section">Description</h3><div class="dnd-description">' + r.desc + '</div>';
      html += '<hr class="dnd-divider"><p class="dnd-source"><strong>Source:</strong> ' + r.source + '</p></div>';
      showModal(r.name, html);
    });
  }

  // === Event Handlers ===
  document.getElementById('species-search').addEventListener('input', debounceSearch(loadSpecies));
  document.getElementById('classes-search').addEventListener('input', debounceSearch(loadClasses));
  document.getElementById('spells-search').addEventListener('input', debounceSearch(loadSpells));
  document.getElementById('spells-level').addEventListener('change', loadSpells);
  document.getElementById('spells-school').addEventListener('change', loadSpells);
  document.getElementById('spells-source').addEventListener('change', loadSpells);
  document.getElementById('spells-casttype').addEventListener('change', loadSpells);
  document.getElementById('items-search').addEventListener('input', debounceSearch(loadItems));
  document.getElementById('items-category').addEventListener('change', loadItems);
  document.getElementById('items-rarity').addEventListener('change', loadItems);
  document.getElementById('items-magic').addEventListener('change', loadItems);
  document.getElementById('feats-search').addEventListener('input', debounceSearch(loadFeats));
  document.getElementById('optfeatures-search').addEventListener('input', debounceSearch(loadOptFeatures));
  document.getElementById('optfeatures-type').addEventListener('change', loadOptFeatures);
  document.getElementById('backgrounds-search').addEventListener('input', debounceSearch(loadBackgrounds));
  document.getElementById('monsters-search').addEventListener('input', debounceSearch(loadMonsters));
  document.getElementById('monsters-cr').addEventListener('change', loadMonsters);
  document.getElementById('monsters-type').addEventListener('change', loadMonsters);
  document.getElementById('monsters-size').addEventListener('change', loadMonsters);
  document.getElementById('conditions-search').addEventListener('input', debounceSearch(loadConditions));
  document.getElementById('conditions-type').addEventListener('change', loadConditions);
  document.getElementById('rules-search').addEventListener('input', debounceSearch(loadRules));

  function debounceSearch(fn) {
    return function() {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(fn, 400);
    };
  }

  // Card click handlers
  document.addEventListener('click', function(e) {
    var card = e.target.closest('.vault-card');
    if (!card) return;

    var type = card.getAttribute('data-type');
    var key = card.getAttribute('data-key');
    var name = card.getAttribute('data-name');

    switch (type) {
      case 'species': showSpeciesDetail(key); break;
      case 'classes': showClassDetail(key); break;
      case 'spell': showSpellDetail(name); break;
      case 'items': showItemDetail(key); break;
      case 'feats': showFeatDetail(key); break;
      case 'optfeatures': showOptFeatureDetail(key); break;
      case 'backgrounds': showBackgroundDetail(key); break;
      case 'monsters': showMonsterDetail(key); break;
      case 'conditions': showConditionDetail(key); break;
      case 'rules': showRuleDetail(key); break;
    }
  });

  // Initial load
  loadSpecies();
})();
