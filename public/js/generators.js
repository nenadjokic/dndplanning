/* DM Generators — Client-side random generation */
(function() {
  'use strict';

  var csrfToken = document.getElementById('csrf-token').value;

  // ========== TAB SWITCHING ==========
  document.querySelectorAll('.generator-tabs .vault-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.generator-tabs .vault-tab').forEach(function(t) { t.classList.remove('active'); });
      document.querySelectorAll('.vault-tab-content').forEach(function(c) { c.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // ========== DICE ==========
  function rollDice(notation) {
    if (typeof notation === 'number') return notation;
    var m = String(notation).match(/^(\d+)d(\d+)(?:\s*\*\s*(\d+))?(?:\s*\+\s*(\d+))?$/);
    if (!m) return parseInt(notation, 10) || 0;
    var count = parseInt(m[1]), sides = parseInt(m[2]), mult = parseInt(m[3]) || 1, add = parseInt(m[4]) || 0;
    var total = 0;
    for (var i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
    return total * mult + add;
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // ========== NPC DATA ==========
  var NPC_NAMES = {
    human: { male: ['Aldric','Bran','Cedric','Dorian','Edmund','Fenris','Gareth','Hadrian','Ivan','Jasper','Kael','Leander','Marcus','Nolan','Oswin','Percival','Quinn','Roland','Stefan','Theron','Ulric','Vance','Wesley','Xander','Yorick','Zephyr'], female: ['Ada','Brielle','Celeste','Dahlia','Elena','Fiona','Giselle','Helena','Iris','Juliet','Kira','Lyra','Mira','Nadia','Ophelia','Petra','Rosalind','Selene','Thea','Una','Vivian','Willa','Yelena','Zara','Maren','Isolde'] },
    elf: { male: ['Aelar','Berrian','Caelum','Drannor','Erdan','Finan','Galinndan','Hadarai','Ivellios','Laucian','Mindartis','Paelias','Quarion','Riardon','Soveliss','Thamior','Varis','Adran','Aramil','Enialis'], female: ['Adrie','Birel','Caelynn','Drusilia','Enna','Felosial','Galiel','Ielenia','Keyleth','Lia','Meriele','Naivara','Quelenna','Shanairra','Thia','Vadania','Xanaphia','Adrie','Sariel','Valanthe'] },
    dwarf: { male: ['Adrik','Baern','Brottor','Dain','Eberk','Fargrim','Gardain','Harbek','Kildrak','Morgran','Orsik','Rurik','Taklinn','Thoradin','Tordek','Traubon','Ulfgar','Veit','Vondal','Barendd'], female: ['Amber','Artin','Bardryn','Dagnal','Diesa','Eldeth','Falkrunn','Gunnloda','Helja','Kathra','Kristryd','Mardred','Riswynn','Sannl','Torbera','Vistra','Ilde','Liftrasa','Hlin','Torgga'] },
    halfling: { male: ['Alton','Beau','Cade','Corrin','Eldon','Finnan','Garret','Lyle','Merric','Osborn','Roscoe','Wellby','Wendel','Paxton','Milo','Tobin','Reed','Heath','Jasper','Quinn'], female: ['Andry','Bree','Cora','Euphemia','Jillian','Kithri','Lavinia','Lidda','Marigold','Merla','Nedda','Paela','Portia','Seraphina','Shaena','Trym','Vani','Verna','Wella','Elsa'] },
    gnome: { male: ['Alston','Alvyn','Boddynock','Brocc','Burgell','Dimble','Eldon','Erky','Fonkin','Frug','Gerbo','Gimble','Glim','Jebeddo','Namfoodle','Orryn','Roondar','Seebo','Sindri','Warryn','Wrenn','Zook'], female: ['Bimpnottin','Breena','Caramip','Carlin','Donella','Duvamil','Ella','Ellyjobell','Loopmottin','Lorilla','Mardnab','Nissa','Nyx','Oda','Orla','Roywyn','Shamil','Tana','Waywocket','Zanna'] },
    'half-elf': { male: ['Aelar','Aramil','Berrian','Galinndan','Hadarai','Paelias','Quarion','Riardon','Caelum','Marcus','Aldric','Varis','Dain','Fenris','Roland','Theron','Jasper','Leander','Kael','Drannor'], female: ['Adrie','Caelynn','Keyleth','Lia','Meriele','Naivara','Shanairra','Elena','Selene','Lyra','Iris','Mira','Thia','Vivian','Dahlia','Giselle','Rosalind','Celeste','Brielle','Sariel'] },
    'half-orc': { male: ['Dench','Feng','Gell','Henk','Holg','Imsh','Keth','Krusk','Mhurren','Ront','Shump','Thokk','Brug','Gnarsh','Karg','Lurtz','Mogak','Ogruk','Ragash','Tarak'], female: ['Baggi','Emen','Engong','Kansif','Myev','Neega','Ovak','Ownka','Shautha','Sutha','Vola','Volen','Yevelda','Grukka','Hulda','Murook','Breena','Ekrah','Grisha','Takka'] },
    tiefling: { male: ['Akmenos','Amnon','Barakas','Damakos','Ekemon','Iados','Kairon','Leucis','Melech','Mordai','Morthos','Pelaios','Skamos','Therai','Arannis','Carrion','Despair','Creed','Torment','Nowhere'], female: ['Akta','Anakis','Bryseis','Criella','Damaia','Ea','Kallista','Lerissa','Makaria','Nemeia','Orianna','Phelaia','Rieta','Bryseis','Art','Despair','Fear','Hope','Music','Poetry'] },
    dragonborn: { male: ['Arjhan','Balasar','Bharash','Donaar','Ghesh','Heskan','Kriv','Medrash','Mehen','Nadarr','Pandjed','Patrin','Rhogar','Shamash','Shedinn','Tarhun','Torinn','Balgar','Korthul','Vrakir'], female: ['Akra','Biri','Daar','Farideh','Harann','Havilar','Jheri','Kava','Korinn','Mishann','Nala','Perra','Raiann','Sora','Surina','Thava','Uadjit','Kalisra','Raivee','Yeldra'] }
  };

  var OCCUPATIONS = ['Blacksmith','Herbalist','Tavern Owner','Merchant','Scholar','Guard','Farmer','Sailor','Thief','Priest','Bard','Hunter','Alchemist','Librarian','Tanner','Woodcutter','Fisherman','Baker','Jeweler','Stable Master','Cartographer','Fortune Teller','Apothecary','Innkeeper','Brewer','Gravedigger','Lamplighter','Bounty Hunter','Shepherd','Messenger','Scribe','Weaver','Potter','Chandler','Cobbler','Locksmith','Rat Catcher','Street Performer','Tax Collector','Undertaker'];
  var TRAITS = ['Always whistles when nervous','Collects unusual coins','Speaks in the third person occasionally','Constantly polishing a treasured keepsake','Has a booming laugh','Never makes eye contact','Taps the table when thinking','Smells faintly of cinnamon','Limps slightly on the left side','Has an impressive scar','Wears mismatched gloves','Always chewing on something','Speaks very slowly and deliberately','Has a pet mouse in their pocket','Draws symbols on the table absentmindedly','Is overly polite to a fault','Never sits with their back to the door','Quotes old proverbs constantly','Has ink-stained fingers','Blinks rapidly when lying','Tells the same joke repeatedly','Cracks their knuckles often','Has a very soft voice','Is always cold','Loves telling stories about \'the old days\'','Has a noticeable twitch','Stands unnecessarily close to people','Always hungry','Deeply suspicious of magic','Fascinated by fire'];
  var MOTIVATIONS = ['Wants to find a lost family member','Is secretly in massive debt','Seeks revenge for an old wrong','Dreams of opening their own shop','Is hiding from a powerful enemy','Wants to prove themselves to a disapproving parent','Is gathering information for someone','Desperately needs money for medicine','Wants to leave town and start fresh','Is protecting a dangerous secret','Longs for adventure but is afraid','Seeks a rare ingredient or component','Wants to restore family honor','Is being blackmailed','Dreams of wealth and power','Wants to break a curse on their family','Is trying to earn enough to retire','Seeks knowledge of ancient lore','Wants to find true love','Is running from the law'];
  var SECRETS = ['Is actually a minor noble in disguise','Once accidentally killed someone','Has a map to a hidden treasure','Is a reformed cultist','Knows the location of a fugitive','Has fey blood','Was raised by a different race','Can speak Thieves\' Cant','Saw something terrible in the old ruins','Has a twin nobody knows about','Is dying of a rare disease','Stole something valuable long ago','Made a deal with a devil','Witnessed a crime by someone powerful','Has prophetic dreams','Used to be a soldier for the wrong side','Knows the true name of a demon','Has a second family in another town','Is being watched by an unseen patron','Was once turned to stone and back'];

  // ========== NPC GENERATOR ==========
  var currentNpc = null;
  document.getElementById('gen-npc-btn').addEventListener('click', function() {
    var race = document.getElementById('npc-race').value;
    if (race === 'random') race = pick(Object.keys(NPC_NAMES));
    var gender = pick(['male', 'female']);
    var names = NPC_NAMES[race] || NPC_NAMES.human;
    var firstName = pick(names[gender] || names.male);
    var occupation = pick(OCCUPATIONS);
    var trait1 = pick(TRAITS);
    var trait2 = pick(TRAITS.filter(function(t) { return t !== trait1; }));
    var motivation = pick(MOTIVATIONS);
    var secret = pick(SECRETS);

    currentNpc = {
      name: firstName,
      race: race,
      text: firstName + ' — ' + race.charAt(0).toUpperCase() + race.slice(1) + ' ' + occupation + '\nTraits: ' + trait1 + '. ' + trait2 + '.\nMotivation: ' + motivation + '\nSecret: ' + secret
    };

    document.getElementById('npc-name').textContent = firstName;
    document.getElementById('npc-details').innerHTML = '<strong>Race:</strong> ' + race.charAt(0).toUpperCase() + race.slice(1) + ' | <strong>Gender:</strong> ' + gender.charAt(0).toUpperCase() + gender.slice(1) + ' | <strong>Occupation:</strong> ' + occupation;
    document.getElementById('npc-traits').innerHTML = '<strong>Traits:</strong> ' + trait1 + '. ' + trait2 + '.';
    document.getElementById('npc-motivation').innerHTML = '<strong>Motivation:</strong> ' + motivation;
    document.getElementById('npc-secret').innerHTML = '<strong>Secret:</strong> ' + secret;
    document.getElementById('npc-result').style.display = 'block';
    document.getElementById('npc-save-status').textContent = '';
  });

  document.getElementById('npc-copy-btn').addEventListener('click', function() {
    if (currentNpc) {
      navigator.clipboard.writeText(currentNpc.text).then(function() {
        document.getElementById('npc-save-status').textContent = 'Copied!';
      });
    }
  });

  document.getElementById('npc-save-btn').addEventListener('click', function() {
    if (!currentNpc) return;
    fetch('/generators/save-npc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ name: currentNpc.name, notes: currentNpc.text })
    }).then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById('npc-save-status').textContent = d.success ? 'Saved to NPC Library!' : (d.error || 'Error');
    }).catch(function() {
      document.getElementById('npc-save-status').textContent = 'Error saving.';
    });
  });

  // ========== LOOT TABLES (DMG-style) ==========
  var LOOT_TABLES = {
    individual: {
      '0-4':  { coins: [{ die: '5d6', type: 'cp' }, { die: '3d6', type: 'sp' }, { die: '2d6', type: 'gp' }], items: ['Potion of Healing','Spell Scroll (Cantrip)','Bag of Holding','Driftglobe','Goggles of Night','Cloak of Many Fashions','Hat of Wizardry','Potion of Climbing','Charm of Darkvision'], itemChance: 0.25 },
      '5-10': { coins: [{ die: '4d6*100', type: 'cp' }, { die: '6d6*10', type: 'sp' }, { die: '3d6*10', type: 'gp' }], items: ['Potion of Greater Healing','Spell Scroll (2nd level)','Cloak of Protection','+1 Weapon','+1 Shield','Boots of Elvenkind','Gauntlets of Ogre Power','Pearl of Power','Ring of Jumping','Immovable Rod'], itemChance: 0.35 },
      '11-16': { coins: [{ die: '4d6*100', type: 'sp' }, { die: '1d6*100', type: 'gp' }], items: ['Potion of Superior Healing','Spell Scroll (5th level)','+2 Weapon','+2 Shield','Cloak of Displacement','Flame Tongue','Ring of Protection','Staff of the Woodlands','Wand of Fireballs','Bracers of Defense'], itemChance: 0.4 },
      '17+':  { coins: [{ die: '2d6*1000', type: 'gp' }, { die: '8d6*100', type: 'gp' }], items: ['Potion of Supreme Healing','Spell Scroll (8th level)','+3 Weapon','+3 Shield','Holy Avenger','Ring of Three Wishes','Staff of Power','Vorpal Sword','Robe of the Archmagi','Luck Blade'], itemChance: 0.5 }
    },
    hoard: {
      '0-4':  { coins: [{ die: '6d6*100', type: 'cp' }, { die: '3d6*100', type: 'sp' }, { die: '2d6*10', type: 'gp' }], items: ['Potion of Healing','Spell Scroll (Cantrip)','Bag of Holding','Driftglobe','Goggles of Night','Cloak of Many Fashions','Hat of Wizardry','Potion of Climbing'], minItems: 1, maxItems: 3 },
      '5-10': { coins: [{ die: '2d6*100', type: 'sp' }, { die: '2d6*1000', type: 'gp' }, { die: '3d6*100', type: 'gp' }], items: ['Potion of Greater Healing','Spell Scroll (2nd level)','Cloak of Protection','+1 Weapon','+1 Shield','Boots of Elvenkind','Gauntlets of Ogre Power','Pearl of Power','Ring of Jumping','Immovable Rod'], minItems: 2, maxItems: 4 },
      '11-16': { coins: [{ die: '4d6*1000', type: 'gp' }, { die: '5d6*100', type: 'gp' }], items: ['Potion of Superior Healing','Spell Scroll (5th level)','+2 Weapon','+2 Shield','Cloak of Displacement','Flame Tongue','Ring of Protection','Staff of the Woodlands','Wand of Fireballs','Bracers of Defense','Amulet of Health','Belt of Giant Strength'], minItems: 2, maxItems: 5 },
      '17+':  { coins: [{ die: '12d6*1000', type: 'gp' }, { die: '8d6*1000', type: 'gp' }], items: ['Potion of Supreme Healing','Spell Scroll (8th level)','+3 Weapon','+3 Shield','Holy Avenger','Ring of Three Wishes','Staff of Power','Vorpal Sword','Robe of the Archmagi','Luck Blade','Defender','Efreeti Bottle'], minItems: 3, maxItems: 6 }
    }
  };

  var currentLoot = [];
  var currentLootCoins = {};

  document.getElementById('gen-loot-btn').addEventListener('click', function() {
    var tier = document.getElementById('loot-tier').value;
    var type = document.getElementById('loot-type').value;
    var table = LOOT_TABLES[type][tier];
    if (!table) return;

    // Roll coins
    var coinHtml = '<p><strong>Coins:</strong> ';
    var coinParts = [];
    currentLootCoins = { cp: 0, sp: 0, gp: 0, pp: 0 };
    table.coins.forEach(function(c) {
      var amount = rollDice(c.die);
      if (amount > 0) {
        coinParts.push(amount + ' ' + c.type.toUpperCase());
        currentLootCoins[c.type] = (currentLootCoins[c.type] || 0) + amount;
      }
    });
    coinHtml += (coinParts.length ? coinParts.join(', ') : 'None') + '</p>';
    document.getElementById('loot-coins').innerHTML = coinHtml;

    // Roll items
    currentLoot = [];
    var numItems = 0;
    if (table.items && table.items.length > 0) {
      if (type === 'hoard') {
        numItems = table.minItems + Math.floor(Math.random() * (table.maxItems - table.minItems + 1));
      } else {
        // Individual: chance-based
        numItems = Math.random() < (table.itemChance || 0.3) ? 1 : 0;
      }
    }

    var itemsHtml = '';
    if (numItems > 0) {
      itemsHtml = '<p><strong>Magic Items:</strong></p><ul>';
      for (var i = 0; i < numItems; i++) {
        var item = pick(table.items);
        currentLoot.push({ name: item, category: 'wondrous', quantity: 1 });
        itemsHtml += '<li>' + item + '</li>';
      }
      itemsHtml += '</ul>';
    } else {
      itemsHtml = '<p class="text-muted">No magic items this time.</p>';
    }
    document.getElementById('loot-items-list').innerHTML = itemsHtml;
    document.getElementById('loot-result').style.display = 'block';
    document.getElementById('loot-add-status').textContent = '';
  });

  // NPC dropdown: show/hide "Add to NPC Loot" button
  var npcSelect = document.getElementById('loot-npc-select');
  var npcBtn = document.getElementById('loot-add-npc-btn');
  if (npcSelect) {
    npcSelect.addEventListener('change', function() {
      npcBtn.style.display = npcSelect.value ? 'inline-block' : 'none';
    });
  }

  // Add to Party Loot
  document.getElementById('loot-add-btn').addEventListener('click', function() {
    if (!currentLoot.length && !currentLootCoins.gp && !currentLootCoins.sp && !currentLootCoins.cp && !currentLootCoins.pp) {
      document.getElementById('loot-add-status').textContent = 'Nothing to add.';
      return;
    }
    fetch('/generators/add-loot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ items: currentLoot, coins: currentLootCoins })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.success) {
        var msg = '';
        if (d.added > 0) msg += d.added + ' item(s)';
        if (d.coinsAdded) msg += (msg ? ' + ' : '') + 'coins';
        document.getElementById('loot-add-status').textContent = 'Added ' + msg + ' to party loot!';
      } else {
        document.getElementById('loot-add-status').textContent = d.error || 'Error';
      }
    }).catch(function() {
      document.getElementById('loot-add-status').textContent = 'Error adding.';
    });
  });

  // Add to NPC Loot
  if (npcBtn) {
    npcBtn.addEventListener('click', function() {
      var npcId = npcSelect.value;
      if (!npcId) return;
      if (!currentLoot.length && !currentLootCoins.gp && !currentLootCoins.sp && !currentLootCoins.cp && !currentLootCoins.pp) {
        document.getElementById('loot-add-status').textContent = 'Nothing to add.';
        return;
      }
      fetch('/generators/add-npc-loot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ items: currentLoot, coins: currentLootCoins, npcId: parseInt(npcId) })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          var msg = '';
          if (d.added > 0) msg += d.added + ' item(s)';
          if (d.coinsAdded) msg += (msg ? ' + ' : '') + 'coins';
          document.getElementById('loot-add-status').textContent = 'Added ' + msg + ' to NPC loot (hidden until defeated)!';
        } else {
          document.getElementById('loot-add-status').textContent = d.error || 'Error';
        }
      }).catch(function() {
        document.getElementById('loot-add-status').textContent = 'Error adding.';
      });
    });
  }

  // ========== NAME GENERATOR ==========
  document.getElementById('gen-names-btn').addEventListener('click', function() {
    var race = document.getElementById('name-race').value;
    var gender = document.getElementById('name-gender').value;
    var names = NPC_NAMES[race] || NPC_NAMES.human;
    var pool = gender === 'any' ? (names.male || []).concat(names.female || []) : (names[gender] || names.male);

    var html = '';
    var used = {};
    for (var i = 0; i < 10; i++) {
      var n;
      var attempts = 0;
      do { n = pick(pool); attempts++; } while (used[n] && attempts < 50);
      used[n] = true;
      html += '<div class="name-chip-wrap">'
        + '<button type="button" class="name-chip" data-name="' + n + '" title="Click to copy">' + n + '</button>'
        + '<button type="button" class="name-chip-npc" data-name="' + n + '" data-race="' + race + '" title="Create NPC Token">+NPC</button>'
        + '</div>';
    }
    document.getElementById('name-list').innerHTML = html;
    document.getElementById('names-result').style.display = 'block';
  });

  // Name chip click → copy
  document.getElementById('name-list').addEventListener('click', function(e) {
    var chip = e.target.closest('.name-chip:not(.name-chip-npc)');
    if (chip) {
      var name = chip.getAttribute('data-name');
      navigator.clipboard.writeText(name).then(function() {
        chip.style.borderColor = 'var(--gold)';
        chip.textContent = 'Copied!';
        setTimeout(function() {
          chip.style.borderColor = '';
          chip.textContent = name;
        }, 800);
      });
      return;
    }

    // +NPC button → create NPC token
    var npcBtn = e.target.closest('.name-chip-npc');
    if (npcBtn) {
      var npcName = npcBtn.getAttribute('data-name');
      var npcRace = npcBtn.getAttribute('data-race');
      npcBtn.disabled = true;
      npcBtn.textContent = '...';
      fetch('/generators/save-npc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ name: npcName, notes: npcName + ' — ' + npcRace.charAt(0).toUpperCase() + npcRace.slice(1) })
      }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.success) {
          npcBtn.textContent = 'Saved!';
          npcBtn.style.background = 'var(--gold)';
          npcBtn.style.color = '#000';
        } else {
          npcBtn.textContent = 'Error';
          npcBtn.disabled = false;
        }
      }).catch(function() {
        npcBtn.textContent = 'Error';
        npcBtn.disabled = false;
      });
    }
  });

})();
