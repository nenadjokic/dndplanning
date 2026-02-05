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

  function extractLevel(classLevel) {
    // Extract level from strings like "Fighter 5", "Wizard 12 / Cleric 3"
    if (!classLevel) return 1;
    var matches = classLevel.match(/\d+/g);
    if (!matches) return 1;
    // Sum all levels for multiclass
    var total = 0;
    for (var i = 0; i < matches.length; i++) {
      total += parseInt(matches[i], 10);
    }
    return total || 1;
  }

  function extractClass(classLevel) {
    // Extract class name from "Fighter 5" or "Wizard 12"
    if (!classLevel) return '';
    var match = classLevel.match(/^[a-zA-Z]+/);
    return match ? match[0].toLowerCase() : '';
  }

  // Spellcasting ability by class
  var spellcastingAbility = {
    wizard: 'int',
    artificer: 'int',
    cleric: 'wis',
    druid: 'wis',
    ranger: 'wis',
    bard: 'cha',
    paladin: 'cha',
    sorcerer: 'cha',
    warlock: 'cha'
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
    var classLevel = getInputValue('class_level');
    var level = extractLevel(classLevel);
    var mainClass = extractClass(classLevel);
    var profBonus = getProficiencyBonus(level);

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

    // Calculate spell stats if spellcasting class
    var spellAbility = getInputValue('spell_ability');
    if (!spellAbility && spellcastingAbility[mainClass]) {
      spellAbility = spellcastingAbility[mainClass].toUpperCase();
      setInputValue('spell_ability', spellAbility);
    }

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

    // Listen for class/level changes
    var classLevelInput = document.querySelector('[name="class_level"]');
    if (classLevelInput) {
      classLevelInput.addEventListener('input', calculateAll);
      classLevelInput.addEventListener('change', calculateAll);
    }

    // Listen for spell ability changes
    var spellAbilityInput = document.querySelector('[name="spell_ability"]');
    if (spellAbilityInput) {
      spellAbilityInput.addEventListener('input', calculateAll);
      spellAbilityInput.addEventListener('change', calculateAll);
    }

    // Initial calculation
    calculateAll();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
