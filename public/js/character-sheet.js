/**
 * D&D 5e Character Sheet Automation
 * Automatically calculates modifiers, saving throws, skills, and spell stats
 */

(function() {
  'use strict';

  // === D&D 5e Calculation Helpers ===

  function getAbilityModifier(score) {
    var s = parseInt(score, 10);
    if (isNaN(s)) return 0;
    return Math.floor((s - 10) / 2);
  }

  function formatModifier(mod) {
    return mod >= 0 ? '+' + mod : '' + mod;
  }

  function getProficiencyBonus(level) {
    var lvl = parseInt(level, 10);
    if (isNaN(lvl) || lvl < 1) return 2;
    if (lvl <= 4) return 2;
    if (lvl <= 8) return 3;
    if (lvl <= 12) return 4;
    if (lvl <= 16) return 5;
    return 6;
  }

  // Spellcasting ability by class
  var spellcastingAbility = {
    wizard: 'INT',
    artificer: 'INT',
    cleric: 'WIS',
    druid: 'WIS',
    ranger: 'WIS',
    monk: 'WIS',
    bard: 'CHA',
    paladin: 'CHA',
    sorcerer: 'CHA',
    warlock: 'CHA'
  };

  // Skill to ability mapping
  var skillAbilities = {
    acrobatics: 'dex',
    animal_handling: 'wis',
    arcana: 'int',
    athletics: 'str',
    deception: 'cha',
    history: 'int',
    insight: 'wis',
    intimidation: 'cha',
    investigation: 'int',
    medicine: 'wis',
    nature: 'int',
    perception: 'wis',
    performance: 'cha',
    persuasion: 'cha',
    religion: 'int',
    sleight_of_hand: 'dex',
    stealth: 'dex',
    survival: 'wis'
  };

  // Saving throw abilities
  var saveAbilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  // === DOM Helpers ===

  function getInputValue(name) {
    var el = document.querySelector('[name="' + name + '"]');
    return el ? el.value : '';
  }

  function setInputValue(name, value) {
    var el = document.querySelector('[name="' + name + '"]');
    if (el && !el.disabled) {
      el.value = value;
    }
  }

  function isChecked(name) {
    var el = document.querySelector('[name="' + name + '"]');
    return el ? el.checked : false;
  }

  // === Main Calculation Functions ===

  function calculateAll() {
    // Get class from profile (readonly field)
    var classEl = document.getElementById('sheet-class');
    var levelEl = document.getElementById('sheet-level');

    var characterClass = classEl ? classEl.value.toLowerCase() : '';
    var level = levelEl ? (parseInt(levelEl.value, 10) || 1) : 1;
    var profBonus = getProficiencyBonus(level);

    // Update hidden class_level field for backward compatibility
    var hiddenClassLevel = document.getElementById('hidden-class-level');
    if (hiddenClassLevel && classEl && levelEl) {
      hiddenClassLevel.value = (classEl.value || '') + ' ' + (levelEl.value || '1');
    }

    // Set proficiency bonus
    setInputValue('proficiency_bonus', formatModifier(profBonus));

    // Get ability scores
    var abilities = {};
    var mods = {};
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(function(ab) {
      var score = parseInt(getInputValue(ab + '_score'), 10) || 10;
      abilities[ab] = score;
      mods[ab] = getAbilityModifier(score);
      setInputValue(ab + '_mod', formatModifier(mods[ab]));
    });

    // Calculate saving throws
    saveAbilities.forEach(function(ab) {
      var isProficient = isChecked('save_' + ab + '_prof');
      var mod = mods[ab] + (isProficient ? profBonus : 0);
      setInputValue('save_' + ab + '_val', formatModifier(mod));
    });

    // Calculate skills
    Object.keys(skillAbilities).forEach(function(skill) {
      var ab = skillAbilities[skill];
      var isProficient = isChecked('skill_' + skill + '_prof');
      var mod = mods[ab] + (isProficient ? profBonus : 0);
      setInputValue('skill_' + skill + '_val', formatModifier(mod));
    });

    // Calculate passive perception
    var perceptionProf = isChecked('skill_perception_prof');
    var passivePerception = 10 + mods['wis'] + (perceptionProf ? profBonus : 0);
    setInputValue('passive_perception', passivePerception);

    // Calculate initiative (DEX mod)
    setInputValue('initiative', formatModifier(mods['dex']));

    // Auto-set spell ability based on class from profile
    var spellAbilityInput = document.getElementById('spell-ability');
    if (spellAbilityInput && characterClass && spellcastingAbility[characterClass]) {
      // Only auto-set if empty or matches expected ability for class
      if (!spellAbilityInput.value || spellAbilityInput.value === spellcastingAbility[characterClass]) {
        spellAbilityInput.value = spellcastingAbility[characterClass];
      }
    }

    // Calculate spell stats
    var spellAbility = spellAbilityInput ? spellAbilityInput.value : '';
    if (spellAbility) {
      var abKey = spellAbility.toLowerCase().substring(0, 3);
      var spellMod = mods[abKey] || 0;
      var spellSaveDC = 8 + profBonus + spellMod;
      var spellAttack = profBonus + spellMod;
      setInputValue('spell_save_dc', spellSaveDC);
      setInputValue('spell_attack_bonus', formatModifier(spellAttack));
    }
  }

  // === Event Listeners ===

  function init() {
    // Only run on character sheet pages
    if (!document.querySelector('.sheet-tabs')) return;

    // Calculate on any input change
    var form = document.querySelector('form[action*="/sheet"]');
    if (!form) return;

    // Listen for changes on ability scores
    ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach(function(ab) {
      var scoreInput = document.querySelector('[name="' + ab + '_score"]');
      if (scoreInput) {
        scoreInput.addEventListener('input', calculateAll);
        scoreInput.addEventListener('change', calculateAll);
      }
    });

    // Listen for changes on proficiency checkboxes
    form.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
      cb.addEventListener('change', calculateAll);
    });

    // Listen for level changes (new separate field)
    var levelInput = document.getElementById('sheet-level');
    if (levelInput) {
      levelInput.addEventListener('input', calculateAll);
      levelInput.addEventListener('change', calculateAll);
    }

    // Listen for spell ability changes
    var spellAbilityInput = document.getElementById('spell-ability');
    if (spellAbilityInput) {
      spellAbilityInput.addEventListener('input', calculateAll);
      spellAbilityInput.addEventListener('change', calculateAll);
    }

    // Initial calculation
    calculateAll();
  }

  // === Spell Autocomplete ===

  var autocompleteTimeout = null;

  function getSpellLevelFromInput(input) {
    var name = input.getAttribute('name') || '';
    // cantrip_0, cantrip_1, etc. -> level 0
    if (name.startsWith('cantrip_')) {
      return 0;
    }
    // spell_1_0_name, spell_2_0_name, etc. -> extract level
    var match = name.match(/^spell_(\d+)_\d+_name$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return null; // No level filter
  }

  function searchSpells(query, level, callback) {
    if (query.length < 2) {
      callback([]);
      return;
    }

    var url = '/api/spells/search?q=' + encodeURIComponent(query);
    if (level !== null) {
      url += '&level=' + level;
    }

    fetch(url)
      .then(function(res) { return res.json(); })
      .then(function(data) { callback(data.results || []); })
      .catch(function() { callback([]); });
  }

  function showSpellModal(spellName) {
    // Remove existing modal
    var existing = document.querySelector('.spell-modal-overlay');
    if (existing) existing.remove();

    // Create modal overlay
    var overlay = document.createElement('div');
    overlay.className = 'spell-modal-overlay';
    overlay.innerHTML = '<div class="spell-modal"><div class="spell-modal-header"><h3 class="spell-modal-title">Loading...</h3><button class="spell-modal-close">&times;</button></div><div class="spell-modal-body"><p>Fetching spell details...</p></div></div>';

    document.body.appendChild(overlay);

    // Close on overlay click or close button
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay || e.target.classList.contains('spell-modal-close')) {
        overlay.remove();
      }
    });

    // Close on Escape
    var escHandler = function(e) {
      if (e.key === 'Escape') {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Fetch spell details
    fetch('/api/spells/details?name=' + encodeURIComponent(spellName))
      .then(function(res) { return res.json(); })
      .then(function(spell) {
        if (spell.error) {
          overlay.querySelector('.spell-modal-title').textContent = spellName;
          overlay.querySelector('.spell-modal-body').innerHTML = '<p>Could not load spell details.</p>';
          return;
        }

        var levelText = spell.level === 0 ? 'Cantrip' : 'Level ' + spell.level;
        var tags = [];
        if (spell.concentration) tags.push('Concentration');
        if (spell.ritual) tags.push('Ritual');

        overlay.querySelector('.spell-modal-title').textContent = spell.name;
        overlay.querySelector('.spell-modal-body').innerHTML =
          (spell.source ? '<div class="spell-source-header">📖 Source: ' + spell.source + (spell.apiUsed ? '<br><span class="api-indicator">🔌 API: ' + spell.apiUsed + '</span>' : '') + '</div>' : '') +
          '<div class="spell-modal-meta">' +
            '<span class="spell-modal-meta-item"><strong>' + levelText + '</strong> ' + spell.school + '</span>' +
            '<span class="spell-modal-meta-item"><strong>Casting Time:</strong> ' + spell.castingTime + '</span>' +
            '<span class="spell-modal-meta-item"><strong>Range:</strong> ' + spell.range + '</span>' +
            '<span class="spell-modal-meta-item"><strong>Duration:</strong> ' + spell.duration + '</span>' +
            '<span class="spell-modal-meta-item"><strong>Components:</strong> ' + spell.components + (spell.material ? ' (' + spell.material + ')' : '') + '</span>' +
            (tags.length ? '<span class="spell-modal-meta-item"><strong>' + tags.join(', ') + '</strong></span>' : '') +
          '</div>' +
          '<div class="spell-modal-desc">' + spell.description + '</div>' +
          (spell.higherLevels ? '<div class="spell-modal-higher"><strong>At Higher Levels:</strong> ' + spell.higherLevels + '</div>' : '') +
          (spell.classes ? '<div class="spell-modal-classes"><strong>Classes:</strong> ' + spell.classes + '</div>' : '');
      })
      .catch(function() {
        overlay.querySelector('.spell-modal-title').textContent = spellName;
        overlay.querySelector('.spell-modal-body').innerHTML = '<p>Could not load spell details.</p>';
      });
  }

  function convertToSpellLabel(input, wrapper, dropdown, spellName) {
    // Hide input and dropdown
    input.style.display = 'none';
    dropdown.style.display = 'none';

    // Set input value for form submission
    input.value = spellName;

    // Create label
    var label = document.createElement('div');
    label.className = 'spell-label';
    label.innerHTML = '<span class="spell-label-link">' + spellName + '</span><span class="spell-label-clear">&times;</span>';

    wrapper.appendChild(label);

    // Click on spell name opens modal
    label.querySelector('.spell-label-link').addEventListener('click', function() {
      showSpellModal(spellName);
    });

    // Click on X clears and shows input again
    label.querySelector('.spell-label-clear').addEventListener('click', function() {
      label.remove();
      input.value = '';
      input.style.display = '';
      input.focus();
    });
  }

  function checkExistingSpellValue(input, wrapper, dropdown) {
    var value = input.value.trim();
    if (value) {
      // Convert existing value to label
      convertToSpellLabel(input, wrapper, dropdown, value);
    }
  }

  function showAutocomplete(input, wrapper, dropdown, results) {
    dropdown.innerHTML = '';

    if (results.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    results.forEach(function(spell, index) {
      var item = document.createElement('div');
      item.className = 'spell-autocomplete-item';
      if (index === 0) item.classList.add('selected');

      var levelText = spell.level === 0 ? 'Cantrip' : 'Level ' + spell.level;
      item.innerHTML = '<div class="spell-autocomplete-name">' + spell.name + '</div>' +
        '<div class="spell-autocomplete-meta">' + levelText + ' ' + spell.school + '</div>';

      item.addEventListener('mousedown', function(e) {
        e.preventDefault(); // Prevent blur
        dropdown.style.display = 'none';
        convertToSpellLabel(input, wrapper, dropdown, spell.name);
      });

      dropdown.appendChild(item);
    });

    dropdown.style.display = 'block';
  }

  function initSpellAutocomplete() {
    // Find all cantrip and spell name inputs
    var spellInputs = document.querySelectorAll('input[name^="cantrip_"], input[name$="_name"][name^="spell_"]');

    spellInputs.forEach(function(input) {
      var spellLevel = getSpellLevelFromInput(input);

      // Create wrapper and dropdown once at init
      var wrapper = document.createElement('div');
      wrapper.className = 'spell-autocomplete-wrapper';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);

      var dropdown = document.createElement('div');
      dropdown.className = 'spell-autocomplete-dropdown';
      dropdown.style.display = 'none';
      wrapper.appendChild(dropdown);

      // Check if input already has a value (e.g., loaded from saved data)
      checkExistingSpellValue(input, wrapper, dropdown);

      input.addEventListener('input', function() {
        var query = input.value.trim();

        if (autocompleteTimeout) clearTimeout(autocompleteTimeout);

        if (query.length < 2) {
          dropdown.style.display = 'none';
          return;
        }

        autocompleteTimeout = setTimeout(function() {
          searchSpells(query, spellLevel, function(results) {
            showAutocomplete(input, wrapper, dropdown, results);
          });
        }, 300);
      });

      input.addEventListener('keydown', function(e) {
        if (dropdown.style.display === 'none') return;

        var items = dropdown.querySelectorAll('.spell-autocomplete-item');
        var selected = dropdown.querySelector('.spell-autocomplete-item.selected');
        var selectedIndex = Array.prototype.indexOf.call(items, selected);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (selectedIndex < items.length - 1) {
            if (selected) selected.classList.remove('selected');
            items[selectedIndex + 1].classList.add('selected');
          }
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (selectedIndex > 0) {
            if (selected) selected.classList.remove('selected');
            items[selectedIndex - 1].classList.add('selected');
          }
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selected) {
            dropdown.style.display = 'none';
            var spellName = selected.querySelector('.spell-autocomplete-name').textContent;
            convertToSpellLabel(input, wrapper, dropdown, spellName);
          }
        } else if (e.key === 'Escape') {
          dropdown.style.display = 'none';
        }
      });

      input.addEventListener('blur', function() {
        setTimeout(function() {
          dropdown.style.display = 'none';
        }, 150);
      });
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
      initSpellAutocomplete();
    });
  } else {
    init();
    initSpellAutocomplete();
  }
})();
