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
    }
  });

  // Initial load
  loadSpecies();
})();
