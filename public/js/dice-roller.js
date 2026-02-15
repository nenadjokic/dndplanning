/* === 3D Dice Roller — Three.js + cannon-es === */
import * as CANNON from 'https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js';

var selectedDice = {};
var menuOpen = false;
var rolling = false;
var hiddenMode = false;

var fabBtn, bubbleMenu, splitBtns, rollBtn, clearBtn, hiddenBtn, themeBtn, themePicker;
var resultsBanner, resultTotal, resultDetail, resultHidden;
var historyEl, historyPollTimer, historyFadeTimer;
var isMobile = window.innerWidth <= 768;
var touchTimers = {};
var lastRollTimestamp = 0;  // epoch ms of most recent roll
var FADE_DURATION = 60 * 1000; // 60 seconds
var cachedRolls = [];

var activeOverlay = null;
var activeRenderer = null;
var activeRenderLoop = null;
var cleanupTimeout = null;

var DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

/* ── Procedural dice rolling sound (Web Audio API, theme-aware) ── */
var audioCtx = null;
function playDiceSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = audioCtx;
    var now = ctx.currentTime;
    var duration = 1.2;

    // Get theme sound config
    var cfg = getThemeConfig();
    var snd = cfg.sound || { filterFreq: 800, filterQ: 1.5, oscFreq: 120, character: 'wood' };

    // Master gain
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.35, now);
    master.connect(ctx.destination);

    // Adjust click count based on material character
    var baseClicks = snd.character === 'crystal' ? 16 : snd.character === 'metal' ? 14 : 12;
    var numClicks = baseClicks + Math.floor(Math.random() * 6);

    for (var i = 0; i < numClicks; i++) {
      var t = now + (i / numClicks) * duration * (0.3 + 0.7 * (i / numClicks));
      var clickGain = ctx.createGain();
      var vol = (1.0 - (i / numClicks) * 0.7) * (0.8 + Math.random() * 0.4);
      clickGain.gain.setValueAtTime(vol, t);

      // Crystal theme has longer ring, metal has shorter sharp attack
      var decayTime = snd.character === 'crystal' ? 0.06 : snd.character === 'metal' ? 0.03 : 0.04;
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + decayTime + Math.random() * 0.02);
      clickGain.connect(master);

      // Noise burst for impact
      var bufLen = Math.floor(ctx.sampleRate * 0.04);
      var noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      var data = noiseBuf.getChannelData(0);
      for (var j = 0; j < bufLen; j++) {
        data[j] = (Math.random() * 2 - 1);
      }
      var noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;

      // Theme-specific bandpass filter
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(snd.filterFreq + Math.random() * (snd.filterFreq * 0.5), t);
      filter.Q.setValueAtTime(snd.filterQ + Math.random() * 2, t);
      noise.connect(filter);
      filter.connect(clickGain);

      noise.start(t);
      noise.stop(t + 0.06);

      // Theme-specific low resonance body tone
      if (i % 3 === 0) {
        var osc = ctx.createOscillator();
        osc.type = snd.character === 'crystal' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(snd.oscFreq + Math.random() * (snd.oscFreq * 0.5), t);
        var oscGain = ctx.createGain();
        var oscVol = snd.character === 'metal' ? vol * 0.35 : vol * 0.25;
        oscGain.gain.setValueAtTime(oscVol, t);
        oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(oscGain);
        oscGain.connect(master);
        osc.start(t);
        osc.stop(t + 0.06);
      }
    }
  } catch (e) {
    // Audio not supported — silently ignore
  }
}

function totalSelected() {
  var n = 0;
  for (var k in selectedDice) n += selectedDice[k];
  return n;
}

function init() { buildDOM(); bindEvents(); }

function buildDOM() {
  var fab = document.createElement('div');
  fab.className = 'dice-fab';
  fab.id = 'dice-fab';

  fabBtn = document.createElement('button');
  fabBtn.className = 'dice-fab-btn';
  fabBtn.setAttribute('aria-label', 'Dice Roller');
  fabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>' +
    '<text x="12" y="15" text-anchor="middle" font-size="8" font-family="MedievalSharp,cursive" fill="currentColor" stroke="none">20</text></svg>';

  splitBtns = document.createElement('div');
  splitBtns.className = 'dice-split-btns';

  rollBtn = document.createElement('button');
  rollBtn.className = 'dice-roll-btn';
  rollBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/></svg> ROLL';

  clearBtn = document.createElement('button');
  clearBtn.className = 'dice-clear-btn';
  clearBtn.setAttribute('aria-label', 'Clear dice');
  clearBtn.innerHTML = '&times;';

  hiddenBtn = document.createElement('button');
  hiddenBtn.className = 'dice-hidden-toggle';
  hiddenBtn.setAttribute('aria-label', 'Toggle hidden roll');
  hiddenBtn.title = 'Hidden Roll';
  hiddenBtn.textContent = '\uD83D\uDD12';

  splitBtns.appendChild(rollBtn);
  splitBtns.appendChild(hiddenBtn);
  splitBtns.appendChild(clearBtn);
  fab.appendChild(splitBtns);
  fab.appendChild(fabBtn);

  bubbleMenu = document.createElement('div');
  bubbleMenu.className = 'dice-bubble-menu';
  bubbleMenu.id = 'dice-bubble-menu';

  DIE_TYPES.forEach(function(die) {
    var b = document.createElement('button');
    b.className = 'dice-bubble';
    b.setAttribute('data-die', die);
    b.setAttribute('aria-label', die.toUpperCase());
    b.textContent = die.toUpperCase();
    var badge = document.createElement('span');
    badge.className = 'dice-bubble-count';
    badge.setAttribute('data-die-count', die);
    badge.textContent = '0';
    b.appendChild(badge);
    bubbleMenu.appendChild(b);
  });

  // Theme picker button (palette icon) at end of bubble menu
  themeBtn = document.createElement('button');
  themeBtn.className = 'dice-theme-btn';
  themeBtn.setAttribute('aria-label', 'Dice Theme');
  themeBtn.title = 'Dice Theme';
  themeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="13.5" cy="6.5" r="2.5"/>' +
    '<circle cx="17.5" cy="10.5" r="2.5"/>' +
    '<circle cx="8.5" cy="7.5" r="2.5"/>' +
    '<circle cx="6.5" cy="12" r="2.5"/>' +
    '<path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.14-.74-.38-1.01A1.49 1.49 0 0 1 13.5 18c.83 0 1.5-.67 1.5-1.5 0-5.52 4.48-3 4.48-8.5C19.48 4.13 16.18 2 12 2z"/>' +
    '</svg>';
  bubbleMenu.appendChild(themeBtn);

  // Theme picker panel
  buildThemePicker();

  resultsBanner = document.createElement('div');
  resultsBanner.className = 'dice-results-banner';
  resultsBanner.id = 'dice-results-banner';
  resultTotal = document.createElement('div');
  resultTotal.className = 'dice-result-total';
  resultDetail = document.createElement('div');
  resultDetail.className = 'dice-result-detail';
  resultHidden = document.createElement('div');
  resultHidden.className = 'dice-result-hidden';
  resultsBanner.appendChild(resultTotal);
  resultsBanner.appendChild(resultDetail);
  resultsBanner.appendChild(resultHidden);

  // Dice roll history sidebar
  historyEl = document.createElement('div');
  historyEl.className = 'dice-history';
  historyEl.id = 'dice-history';

  document.body.appendChild(bubbleMenu);
  document.body.appendChild(fab);
  document.body.appendChild(resultsBanner);
  document.body.appendChild(historyEl);
  if (themePicker) document.body.appendChild(themePicker);

  // Start polling history + inactivity fade
  fetchHistory();
  historyPollTimer = setInterval(fetchHistory, 10000);
  historyFadeTimer = setInterval(applyInactivityFade, 3000);

  // Listen for real-time dice history updates from heartbeat
  document.addEventListener('dice-history-update', function() {
    fetchHistory();
  });
}

function subtractDie(die) {
  if (selectedDice[die] && selectedDice[die] > 0) {
    selectedDice[die]--;
    if (selectedDice[die] === 0) delete selectedDice[die];
  }
  updateBubbleUI();
}

function bindEvents() {
  fabBtn.addEventListener('click', function() {
    if (rolling) return;
    menuOpen = !menuOpen;
    bubbleMenu.classList.toggle('open', menuOpen);
  });

  bubbleMenu.addEventListener('click', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn || rolling) return;
    // If touch long-press already handled subtract, skip
    if (btn._longPressHandled) { btn._longPressHandled = false; return; }
    var die = btn.getAttribute('data-die');
    if (!selectedDice[die]) selectedDice[die] = 0;
    selectedDice[die]++;
    updateBubbleUI();
  });

  bubbleMenu.addEventListener('contextmenu', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn || rolling) return;
    e.preventDefault();
    subtractDie(btn.getAttribute('data-die'));
  });

  // Long-press touch to subtract
  bubbleMenu.addEventListener('touchstart', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn || rolling) return;
    var die = btn.getAttribute('data-die');
    btn._longPressHandled = false;
    touchTimers[die] = setTimeout(function() {
      btn._longPressHandled = true;
      if (navigator.vibrate) navigator.vibrate(50);
      subtractDie(die);
    }, 500);
  }, { passive: true });

  bubbleMenu.addEventListener('touchend', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn) return;
    var die = btn.getAttribute('data-die');
    if (touchTimers[die]) { clearTimeout(touchTimers[die]); delete touchTimers[die]; }
  }, { passive: true });

  bubbleMenu.addEventListener('touchmove', function(e) {
    // Cancel long-press if finger moves
    var btn = e.target.closest('.dice-bubble');
    if (!btn) return;
    var die = btn.getAttribute('data-die');
    if (touchTimers[die]) { clearTimeout(touchTimers[die]); delete touchTimers[die]; }
  }, { passive: true });

  rollBtn.addEventListener('click', function() {
    if (rolling || totalSelected() === 0) return;
    performRoll();
  });

  hiddenBtn.addEventListener('click', function() {
    if (rolling) return;
    hiddenMode = !hiddenMode;
    hiddenBtn.classList.toggle('active', hiddenMode);
  });

  clearBtn.addEventListener('click', function() {
    if (rolling) return;
    selectedDice = {};
    updateBubbleUI();
  });

  // Theme picker toggle
  themeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (themePicker) {
      var isOpen = themePicker.classList.contains('open');
      themePicker.classList.toggle('open', !isOpen);
    }
  });

  // Close theme picker when clicking outside
  document.addEventListener('click', function(e) {
    if (themePicker && themePicker.classList.contains('open')) {
      if (!themePicker.contains(e.target) && e.target !== themeBtn && !themeBtn.contains(e.target)) {
        themePicker.classList.remove('open');
      }
    }
  });
}

function updateBubbleUI() {
  DIE_TYPES.forEach(function(die) {
    var badge = document.querySelector('[data-die-count="' + die + '"]');
    var btn = document.querySelector('[data-die="' + die + '"]');
    var count = selectedDice[die] || 0;
    badge.textContent = count;
    badge.classList.toggle('visible', count > 0);
    btn.classList.toggle('selected', count > 0);
  });
  var hasSelection = totalSelected() > 0;
  splitBtns.classList.toggle('visible', hasSelection);
  fabBtn.style.display = hasSelection ? 'none' : 'flex';
}

/* ── Theme Picker Panel ── */
function buildThemePicker() {
  if (!window.DiceThemeManager) return;

  themePicker = document.createElement('div');
  themePicker.className = 'dice-theme-picker';
  themePicker.id = 'dice-theme-picker';

  var title = document.createElement('div');
  title.className = 'dice-theme-picker-title';
  title.textContent = 'DICE THEME';
  themePicker.appendChild(title);

  var grid = document.createElement('div');
  grid.className = 'dice-theme-grid';

  var themes = window.DiceThemeManager.getThemeList();
  var currentId = window.DiceThemeManager.currentTheme;

  themes.forEach(function(t) {
    var themeData = window.DICE_THEMES[t.id];
    var darkCfg = themeData.dark;

    var card = document.createElement('div');
    card.className = 'dice-theme-card' + (t.id === currentId ? ' active' : '');
    card.setAttribute('data-theme-id', t.id);

    var swatch = document.createElement('div');
    swatch.className = 'dice-theme-swatch';
    swatch.style.setProperty('--swatch-body', darkCfg.bodyColor);
    swatch.style.setProperty('--swatch-number', darkCfg.numberColor);

    var name = document.createElement('div');
    name.className = 'dice-theme-card-name';
    name.textContent = t.name;

    var desc = document.createElement('div');
    desc.className = 'dice-theme-card-desc';
    desc.textContent = t.description;

    card.appendChild(swatch);
    card.appendChild(name);
    card.appendChild(desc);
    grid.appendChild(card);

    card.addEventListener('click', function() {
      window.DiceThemeManager.setTheme(t.id);
      // Update active state
      var allCards = grid.querySelectorAll('.dice-theme-card');
      for (var i = 0; i < allCards.length; i++) {
        allCards[i].classList.toggle('active', allCards[i].getAttribute('data-theme-id') === t.id);
      }
      // Close picker after short delay
      setTimeout(function() {
        themePicker.classList.remove('open');
      }, 300);
    });
  });

  themePicker.appendChild(grid);
}

function performRoll() {
  rolling = true;
  // Hide results banner directly — do NOT call hideResults() which schedules
  // a deferred cleanupActiveRoll() that would kill the new animation at 500ms
  resultsBanner.classList.remove('visible');
  if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
  if (hideCleanupTimeout) { clearTimeout(hideCleanupTimeout); hideCleanupTimeout = null; }
  cleanupActiveRoll();
  playDiceSound();
  var tc = document.createElement('canvas');
  var gl = tc.getContext('webgl') || tc.getContext('experimental-webgl');
  if (!gl || typeof THREE === 'undefined') { fallbackTextRoll(); return; }
  run3DRoll();
}

function fallbackTextRoll() {
  var results = [];
  var total = 0;
  for (var die in selectedDice) {
    var max = parseInt(die.replace('d', ''));
    if (die === 'd100') max = 100;
    for (var i = 0; i < selectedDice[die]; i++) {
      var val = Math.floor(Math.random() * max) + 1;
      results.push({ die: die.toUpperCase(), value: val });
      total += val;
    }
  }
  showResults(results, total);
  rolling = false;
}

/* ── Face Texture (theme-aware) ── */
function getThemeConfig() {
  if (window.DiceThemeManager) return window.DiceThemeManager.getConfig();
  // Fallback if themes not loaded
  return {
    bodyColor: '#6b4423', numberColor: '#f0d9a0', edgeColor: '#5a3818',
    roughness: 0.5, metalness: 0.15, materialType: 'standard', flatShading: true,
    font: 'MedievalSharp, cursive',
    lighting: {
      ambient: { color: 0xffffff, intensity: 1.2 },
      directional: { color: 0xffffff, intensity: 0.8 },
      point: { color: 0xd4a843, intensity: 0.5, distance: 20 }
    },
    sound: { filterFreq: 800, filterQ: 1.5, oscFreq: 120, character: 'wood' }
  };
}

function createFaceTexture(text, size, themeConfig) {
  size = size || 128;
  var cfg = themeConfig || getThemeConfig();
  var c = document.createElement('canvas');
  c.width = size; c.height = size;
  var ctx = c.getContext('2d');
  ctx.fillStyle = cfg.bodyColor;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = cfg.numberColor;
  var fontFamily = cfg.font || 'MedievalSharp, cursive';
  var fontSize = String(text).length > 2 ? size * 0.22 : String(text).length > 1 ? size * 0.28 : size * 0.35;
  ctx.font = 'bold ' + Math.floor(fontSize) + 'px ' + fontFamily;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text), size / 2, size / 2);
  var tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeMat(text, themeConfig) {
  var cfg = themeConfig || getThemeConfig();
  var tex = createFaceTexture(text, 128, cfg);

  if (cfg.materialType === 'physical' && THREE.MeshPhysicalMaterial) {
    var opts = {
      map: tex,
      roughness: cfg.roughness || 0.1,
      metalness: cfg.metalness || 0.0,
      flatShading: !!cfg.flatShading,
      side: THREE.DoubleSide
    };
    if (cfg.transmission !== undefined) opts.transmission = cfg.transmission;
    if (cfg.thickness !== undefined) opts.thickness = cfg.thickness;
    if (cfg.clearcoat !== undefined) opts.clearcoat = cfg.clearcoat;
    if (cfg.clearcoatRoughness !== undefined) opts.clearcoatRoughness = cfg.clearcoatRoughness;
    if (cfg.ior !== undefined) opts.ior = cfg.ior;
    if (cfg.emissive) { opts.emissive = new THREE.Color(cfg.emissive); opts.emissiveIntensity = cfg.emissiveIntensity || 0.1; }
    return new THREE.MeshPhysicalMaterial(opts);
  }

  var stdOpts = {
    map: tex,
    roughness: cfg.roughness || 0.5,
    metalness: cfg.metalness || 0.15,
    flatShading: cfg.flatShading !== false,
    side: THREE.DoubleSide
  };
  if (cfg.emissive) { stdOpts.emissive = new THREE.Color(cfg.emissive); stdOpts.emissiveIntensity = cfg.emissiveIntensity || 0.1; }
  return new THREE.MeshStandardMaterial(stdOpts);
}

/* ── Edge material for chamfer bevel faces (theme-aware) ── */
function makeEdgeMat(themeConfig) {
  var cfg = themeConfig || getThemeConfig();
  // Derive edge color from bodyColor, darken by only 5% to eliminate visible gaps
  var hex = cfg.bodyColor || '#6b4423';
  var r = Math.round(parseInt(hex.slice(1, 3), 16) * 0.95);
  var g = Math.round(parseInt(hex.slice(3, 5), 16) * 0.95);
  var b = Math.round(parseInt(hex.slice(5, 7), 16) * 0.95);
  var edgeHex = '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  return new THREE.MeshStandardMaterial({
    color: edgeHex,
    roughness: (cfg.roughness || 0.5) * 0.8,
    metalness: (cfg.metalness || 0.15) * 1.3,
    flatShading: cfg.flatShading !== false,
    side: THREE.DoubleSide
  });
}

/* ── Unified dice mesh creation using chamfered geometry (theme-aware) ── */
function createDiceMesh(diceType, themeConfig) {
  var DG = window.DiceGeometry;
  var result = DG.createDiceGeometry(diceType);
  var geo = result.geometry;
  var config = result.config;
  var labels = config.labels;
  var cfg = themeConfig || getThemeConfig();

  // Create materials array: one per labeled face
  var mats = [];
  for (var i = 0; i < labels.length; i++) {
    mats.push(makeMat(labels[i], cfg));
  }

  return new THREE.Mesh(geo, mats);
}

/* ── Physics body — Sphere for smooth rolling (visual mesh shows face changes) ── */
function createDiceBody(diceType, cannonMaterial) {
  var DG = window.DiceGeometry;
  var config = DG.DICE_GEOM[diceType];
  var radius = (config.radius || 0.85) * (config.scaleFactor || 1.0);
  return new CANNON.Body({ mass: 1, shape: new CANNON.Sphere(radius), material: cannonMaterial });
}

/* ── Read physics result: top face index → dice value ── */
function faceIndexToValue(diceType, faceIdx) {
  var geomType = diceType;
  if (diceType === 'd100tens') geomType = 'd100';
  if (diceType === 'd100units') geomType = 'd10';
  var labels = window.DiceGeometry.DICE_GEOM[geomType].labels;
  if (faceIdx >= 0 && faceIdx < labels.length) {
    var v = labels[faceIdx];
    return (typeof v === 'string') ? (parseInt(v) || 0) : v;
  }
  return 1;
}

/* ── Pre-determined results ── */
function randomResult(type) {
  switch (type) {
    case 'd4':        return Math.floor(Math.random() * 4) + 1;
    case 'd6':        return Math.floor(Math.random() * 6) + 1;
    case 'd8':        return Math.floor(Math.random() * 8) + 1;
    case 'd10':       return Math.floor(Math.random() * 10) + 1;
    case 'd100tens':  return Math.floor(Math.random() * 10); // 0-9 (tens digit)
    case 'd100units': return Math.floor(Math.random() * 10); // 0-9 (units digit)
    case 'd12':       return Math.floor(Math.random() * 12) + 1;
    case 'd20':       return Math.floor(Math.random() * 20) + 1;
    default:          return Math.floor(Math.random() * 6) + 1;
  }
}

function valueToFaceIndex(type, value) {
  switch (type) {
    case 'd4':        return value - 1;
    case 'd6':        return [1, 6, 2, 5, 3, 4].indexOf(value);
    case 'd8':        return value - 1;
    case 'd10':       return value === 10 ? 0 : value;
    case 'd100tens':  return value; // 0-9 maps to face 0-9
    case 'd100units': return value; // 0-9 maps to face 0-9
    case 'd12':       return value - 1;
    case 'd20':       return value - 1;
    default:          return 0;
  }
}

/* ── Physics helpers: face normals, top-face detection, shift quaternion ── */
function computeFaceNormals(diceType) {
  var DG = window.DiceGeometry;
  var config = DG.DICE_GEOM[diceType];
  var verts = config.vertices.map(function(v) { return [v[0], v[1], v[2]]; });
  DG.normalizeVectors(verts);
  var normals = [];
  for (var i = 0; i < config.faces.length; i++) {
    var face = config.faces[i];
    var a = verts[face[0]], b = verts[face[1]], c = verts[face[2]];
    var ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    var ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    var nx = ab[1]*ac[2] - ab[2]*ac[1];
    var ny = ab[2]*ac[0] - ab[0]*ac[2];
    var nz = ab[0]*ac[1] - ab[1]*ac[0];
    var len = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }
    normals.push(new THREE.Vector3(nx, ny, nz));
  }
  return normals;
}

function getTopFaceIndex(diceType, bodyQuaternion) {
  var geomType = diceType;
  if (diceType === 'd100tens') geomType = 'd100';
  if (diceType === 'd100units') geomType = 'd10';
  var config = window.DiceGeometry.DICE_GEOM[geomType];
  var normals = computeFaceNormals(geomType);
  var up = config.invertUpside ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 1, 0);
  var q = new THREE.Quaternion(bodyQuaternion.x, bodyQuaternion.y, bodyQuaternion.z, bodyQuaternion.w);
  var bestDot = -Infinity, bestIdx = 0;
  for (var i = 0; i < normals.length; i++) {
    var wn = normals[i].clone().applyQuaternion(q);
    var dot = wn.dot(up);
    if (dot > bestDot) { bestDot = dot; bestIdx = i; }
  }
  return bestIdx;
}

function computeShiftQuat(diceType, actualFaceIdx, desiredFaceIdx) {
  if (actualFaceIdx === desiredFaceIdx) return new THREE.Quaternion();
  var geomType = diceType;
  if (diceType === 'd100tens') geomType = 'd100';
  if (diceType === 'd100units') geomType = 'd10';
  var normals = computeFaceNormals(geomType);
  return new THREE.Quaternion().setFromUnitVectors(normals[desiredFaceIdx], normals[actualFaceIdx]);
}

function preSimulate(world, bodies, maxSteps, dt) {
  var frames = [];
  var settledCount = 0;
  for (var step = 0; step < maxSteps; step++) {
    world.step(dt);
    var frame = [];
    var allSlow = true;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      frame.push({
        position: { x: b.position.x, y: b.position.y, z: b.position.z },
        quaternion: { x: b.quaternion.x, y: b.quaternion.y, z: b.quaternion.z, w: b.quaternion.w }
      });
      var v = b.velocity, av = b.angularVelocity;
      var spd = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z);
      var aspd = Math.sqrt(av.x*av.x + av.y*av.y + av.z*av.z);
      if (spd > 0.15 || aspd > 0.3) allSlow = false;
    }
    frames.push(frame);
    if (allSlow) { settledCount++; if (settledCount >= 20) break; }
    else settledCount = 0;
  }
  // If not settled, force stop and add tail frames
  if (settledCount < 20) {
    for (var i = 0; i < bodies.length; i++) {
      bodies[i].velocity.set(0, 0, 0);
      bodies[i].angularVelocity.set(0, 0, 0);
    }
    for (var t = 0; t < 10; t++) {
      var frame = [];
      for (var i = 0; i < bodies.length; i++) {
        frame.push({
          position: { x: bodies[i].position.x, y: bodies[i].position.y, z: bodies[i].position.z },
          quaternion: { x: bodies[i].quaternion.x, y: bodies[i].quaternion.y, z: bodies[i].quaternion.z, w: bodies[i].quaternion.w }
        });
      }
      frames.push(frame);
    }
  }
  return frames;
}

/* ── 3D Roll ── */
function run3DRoll() {
  var overlay = document.createElement('div');
  overlay.className = 'dice-overlay';
  document.body.appendChild(overlay);

  // Build dice list — D100 becomes two D10s (tens + units)
  var diceList = [];
  for (var die in selectedDice) {
    for (var i = 0; i < selectedDice[die]; i++) {
      if (die === 'd100') {
        diceList.push('d100tens');
        diceList.push('d100units');
      } else {
        diceList.push(die);
      }
    }
  }

  var scene = new THREE.Scene();
  var aspect = window.innerWidth / window.innerHeight;
  var camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(0, 12, 0);
  camera.lookAt(0, 0, 0);

  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  overlay.appendChild(renderer.domElement);

  // Theme-aware lighting
  var themeConfig = getThemeConfig();
  var tl = themeConfig.lighting || {};
  var ambCfg = tl.ambient || { color: 0xffffff, intensity: 1.2 };
  var dirCfg = tl.directional || { color: 0xffffff, intensity: 0.8 };
  var ptCfg = tl.point || { color: 0xd4a843, intensity: 0.5, distance: 20 };

  scene.add(new THREE.AmbientLight(ambCfg.color, ambCfg.intensity));
  var dirLight = new THREE.DirectionalLight(dirCfg.color, dirCfg.intensity);
  dirLight.position.set(3, 10, 3);
  scene.add(dirLight);
  var pointLight = new THREE.PointLight(ptCfg.color, ptCfg.intensity, ptCfg.distance || 20);
  pointLight.position.set(0, 6, 0);
  scene.add(pointLight);

  // Calculate visible bounds at ground level
  var tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  var groundDist = camera.position.y - (-0.5);
  var halfZ = groundDist * tanHalfFov * 0.9;
  var halfX = halfZ * aspect * 0.9;

  // ── Scripted rolling animation — no physics engine, pure math ──
  // Dice roll like wheels: movement = rotation. When rotation stops, movement stops.

  // All dice come from the SAME direction — like thrown from one hand
  var throwAngle = Math.random() * Math.PI * 2;
  var throwDirX = Math.cos(throwAngle);
  var throwDirZ = Math.sin(throwAngle);
  var perpX = -throwDirZ;
  var perpZ = throwDirX;

  var groundY = -0.5;
  var diceMeshes = [], dieTypes = [];
  var numDice = diceList.length;
  var rollers = [];

  diceList.forEach(function(die, idx) {
    var geomType = die;
    if (die === 'd100tens') geomType = 'd100';
    if (die === 'd100units') geomType = 'd10';
    var mesh = createDiceMesh(geomType, themeConfig);
    scene.add(mesh);
    diceMeshes.push(mesh);
    dieTypes.push(die);

    var config = window.DiceGeometry.DICE_GEOM[geomType];
    var dieRadius = (config.radius || 0.85) * (config.scaleFactor || 1.0);

    // Spawn at edge
    var edgeDist = Math.min(halfX, halfZ) * 0.8;
    var lateralSpread = (idx - (numDice - 1) / 2) * 1.1;
    var spawnX = throwDirX * edgeDist + perpX * lateralSpread;
    var spawnZ = throwDirZ * edgeDist + perpZ * lateralSpread;

    // Target: near center with randomness
    var targetX = (Math.random() - 0.5) * 2.0;
    var targetZ = (Math.random() - 0.5) * 2.0;
    var dx = targetX - spawnX;
    var dz = targetZ - spawnZ;
    var travelDist = Math.sqrt(dx * dx + dz * dz);
    var dirX = dx / travelDist;
    var dirZ = dz / travelDist;

    // Speed calibrated so die reaches target and stops
    var rollDuration = 1.4 + Math.random() * 0.6; // 1.4-2.0 seconds of rolling
    var initialSpeed = (2 * travelDist) / rollDuration; // v0 for constant decel to cover travelDist
    var decelRate = initialSpeed / rollDuration;

    // Entry arc: 45-degree descent
    var entryHeight = edgeDist * 0.7;
    var entryDuration = 0.35 + Math.random() * 0.1;

    // Rolling: effective radius controls how many face changes per distance
    // Smaller = more rotations = more face changes = more suspense
    var effectiveRadius = dieRadius * 0.55;

    // Roll axis: perpendicular to direction of travel (die rolls forward)
    var rollAxisVec = new THREE.Vector3(-dirZ, 0, dirX).normalize();

    // Random initial orientation
    var initQuat = new THREE.Quaternion();
    initQuat.setFromEuler(new THREE.Euler(
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2,
      Math.random() * Math.PI * 2
    ));

    rollers.push({
      x: spawnX, z: spawnZ,
      dirX: dirX, dirZ: dirZ,
      speed: initialSpeed,
      decelRate: decelRate,
      dieRadius: dieRadius,
      effectiveRadius: effectiveRadius,
      rollAxis: rollAxisVec,
      initQuat: initQuat,
      totalAngle: 0,
      entryHeight: entryHeight,
      entryDuration: entryDuration,
      time: 0,
      stopped: false
    });
  });

  // Animation state
  var animDone = false;
  var animStart = performance.now();
  var lastTime = animStart;
  var maxAnimTime = 5000;

  // Click overlay to skip
  overlay.addEventListener('click', function() { finishAnim('overlay-click'); });

  var safetyTimer = setTimeout(function() {
    if (!animDone) finishAnim('safety-timeout');
  }, maxAnimTime + 1000);

  function finishAnim(reason) {
    if (animDone) return;
    animDone = true;
    clearTimeout(safetyTimer);
    if (activeRenderLoop) { clearTimeout(activeRenderLoop); activeRenderLoop = null; }

    // Ensure all rollers are at final position
    for (var i = 0; i < rollers.length; i++) {
      var r = rollers[i];
      if (!r.stopped) {
        r.stopped = true;
        r.speed = 0;
      }
      var py = groundY + r.dieRadius;
      diceMeshes[i].position.set(r.x, py, r.z);
      var rollQ = new THREE.Quaternion();
      rollQ.setFromAxisAngle(r.rollAxis, r.totalAngle);
      diceMeshes[i].quaternion.copy(r.initQuat);
      diceMeshes[i].quaternion.premultiply(rollQ);
    }
    try { renderer.render(scene, camera); } catch (e) {}
    onSettled();
  }

  var frameInterval = 1000 / 60;
  var _dbgFrames = 0;

  function animate() {
    if (animDone) return;
    _dbgFrames++;

    try {
      var now = performance.now();
      var dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      var allStopped = true;

      for (var i = 0; i < rollers.length; i++) {
        var r = rollers[i];
        if (r.stopped) {
          // Keep at final position
          diceMeshes[i].position.set(r.x, groundY + r.dieRadius, r.z);
          continue;
        }
        allStopped = false;
        r.time += dt;

        // Decelerate
        r.speed = Math.max(0, r.speed - r.decelRate * dt);
        if (r.speed < 0.05) {
          r.speed = 0;
          r.stopped = true;
        }

        // Move forward — movement driven by rotation
        var moveDist = r.speed * dt;
        r.x += r.dirX * moveDist;
        r.z += r.dirZ * moveDist;

        // Wall bounces
        if (r.x > halfX - r.dieRadius) { r.x = halfX - r.dieRadius; r.dirX = -Math.abs(r.dirX); r.rollAxis.set(-r.dirZ, 0, r.dirX).normalize(); }
        if (r.x < -halfX + r.dieRadius) { r.x = -halfX + r.dieRadius; r.dirX = Math.abs(r.dirX); r.rollAxis.set(-r.dirZ, 0, r.dirX).normalize(); }
        if (r.z > halfZ - r.dieRadius) { r.z = halfZ - r.dieRadius; r.dirZ = -Math.abs(r.dirZ); r.rollAxis.set(-r.dirZ, 0, r.dirX).normalize(); }
        if (r.z < -halfZ + r.dieRadius) { r.z = -halfZ + r.dieRadius; r.dirZ = Math.abs(r.dirZ); r.rollAxis.set(-r.dirZ, 0, r.dirX).normalize(); }

        // Rolling rotation — angle proportional to distance traveled
        r.totalAngle += moveDist / r.effectiveRadius;

        // Y position: entry arc (parabolic descent) then on ground with small bounces
        var py;
        if (r.time < r.entryDuration) {
          var t = r.time / r.entryDuration;
          py = groundY + r.dieRadius + r.entryHeight * (1 - t) * (1 - t);
        } else {
          var groundTime = r.time - r.entryDuration;
          var bounceAmp = r.entryHeight * 0.2 * Math.exp(-5.0 * groundTime);
          var bounce = bounceAmp * Math.abs(Math.sin(groundTime * 12));
          py = groundY + r.dieRadius + bounce;
        }

        // Apply position
        diceMeshes[i].position.set(r.x, py, r.z);

        // Apply rotation: initial random orientation + accumulated rolling
        var rollQ = new THREE.Quaternion();
        rollQ.setFromAxisAngle(r.rollAxis, r.totalAngle);
        diceMeshes[i].quaternion.copy(r.initQuat);
        diceMeshes[i].quaternion.premultiply(rollQ);
      }

      // Dice-to-dice collision detection & response
      for (var i = 0; i < rollers.length; i++) {
        for (var j = i + 1; j < rollers.length; j++) {
          var ri = rollers[i], rj = rollers[j];
          var dx = rj.x - ri.x;
          var dz = rj.z - ri.z;
          var dist = Math.sqrt(dx * dx + dz * dz);
          var minDist = ri.dieRadius + rj.dieRadius;
          if (dist < minDist && dist > 0.001) {
            // Collision normal (i → j)
            var nx = dx / dist;
            var nz = dz / dist;

            // Separate dice so they don't overlap
            var overlap = (minDist - dist) / 2;
            ri.x -= nx * overlap;
            ri.z -= nz * overlap;
            rj.x += nx * overlap;
            rj.z += nz * overlap;

            // Relative velocity along collision normal
            var vi_n = ri.dirX * ri.speed * nx + ri.dirZ * ri.speed * nz;
            var vj_n = rj.dirX * rj.speed * nx + rj.dirZ * rj.speed * nz;

            // Only collide if dice are approaching each other
            if (vi_n - vj_n > 0) {
              // Elastic collision (equal mass) — swap normal components
              var restitution = 0.7;

              // Velocity components along normal
              var vi_nx = vi_n * nx, vi_nz = vi_n * nz;
              var vj_nx = vj_n * nx, vj_nz = vj_n * nz;

              // Tangential components (preserved)
              var vi_tx = ri.dirX * ri.speed - vi_nx;
              var vi_tz = ri.dirZ * ri.speed - vi_nz;
              var vj_tx = rj.dirX * rj.speed - vj_nx;
              var vj_tz = rj.dirZ * rj.speed - vj_nz;

              // Swap normal components with restitution
              var new_vi_x = vi_tx + vj_n * restitution * nx;
              var new_vi_z = vi_tz + vj_n * restitution * nz;
              var new_vj_x = vj_tx + vi_n * restitution * nx;
              var new_vj_z = vj_tz + vi_n * restitution * nz;

              // Update speed & direction for die i
              var si = Math.sqrt(new_vi_x * new_vi_x + new_vi_z * new_vi_z);
              if (si > 0.05 && !ri.stopped) {
                ri.speed = si;
                ri.dirX = new_vi_x / si;
                ri.dirZ = new_vi_z / si;
                ri.rollAxis.set(-ri.dirZ, 0, ri.dirX).normalize();
              }

              // Update speed & direction for die j
              var sj = Math.sqrt(new_vj_x * new_vj_x + new_vj_z * new_vj_z);
              if (sj > 0.05 && !rj.stopped) {
                rj.speed = sj;
                rj.dirX = new_vj_x / sj;
                rj.dirZ = new_vj_z / sj;
                rj.rollAxis.set(-rj.dirZ, 0, rj.dirX).normalize();
              }

              // Wake up stopped dice if hit hard enough
              if (ri.stopped && vj_n * restitution > 0.3) {
                ri.stopped = false;
                ri.speed = Math.abs(vj_n) * restitution * 0.5;
                ri.dirX = -nx;
                ri.dirZ = -nz;
                ri.rollAxis.set(-ri.dirZ, 0, ri.dirX).normalize();
              }
              if (rj.stopped && vi_n * restitution > 0.3) {
                rj.stopped = false;
                rj.speed = Math.abs(vi_n) * restitution * 0.5;
                rj.dirX = nx;
                rj.dirZ = nz;
                rj.rollAxis.set(-rj.dirZ, 0, rj.dirX).normalize();
              }
            }
          }
        }
      }

      renderer.render(scene, camera);

      if (allStopped) { finishAnim('settled'); return; }
      if ((now - animStart) > maxAnimTime) { finishAnim('timeout'); return; }

      activeRenderLoop = setTimeout(animate, frameInterval);
    } catch (e) {
      console.warn('[Dice] Animation error:', e.message, e.stack);
      finishAnim('animation-error');
    }
  }

  activeRenderLoop = setTimeout(animate, frameInterval);

  function onSettled() {
    // Read results from final die orientation — top face = result
    var results = [];
    var total = 0;
    var i = 0;
    while (i < dieTypes.length) {
      if (dieTypes[i] === 'd100tens' && i + 1 < dieTypes.length && dieTypes[i + 1] === 'd100units') {
        var tensQ = diceMeshes[i].quaternion;
        var unitsQ = diceMeshes[i + 1].quaternion;
        var tensIdx = getTopFaceIndex('d100tens', tensQ);
        var unitsIdx = getTopFaceIndex('d100units', unitsQ);
        var tens = faceIndexToValue('d100tens', tensIdx);
        var units = faceIndexToValue('d100units', unitsIdx);
        var val = tens + units;
        if (val === 0) val = 100;
        results.push({ die: 'D100', value: val });
        total += val;
        i += 2;
      } else {
        var meshQ = diceMeshes[i].quaternion;
        var topIdx = getTopFaceIndex(dieTypes[i], meshQ);
        var value = faceIndexToValue(dieTypes[i], topIdx);
        if (dieTypes[i] === 'd10' && value === 0) value = 10;
        results.push({ die: dieTypes[i].toUpperCase(), value: value });
        total += value;
        i++;
      }
    }
    rolling = false;
    activeOverlay = overlay;
    activeRenderer = renderer;
    // Single final render - no continuous loop needed
    renderer.render(scene, camera);

    // Check for Natural 20 (critical hit celebration)
    var hasNat20 = results.some(function(r) { return r.die === 'D20' && r.value === 20; });
    if (hasNat20 && !prefersReducedMotion()) {
      spawnCritParticles(overlay);
    }

    showResults(results, total);
    cleanupTimeout = setTimeout(function() {
      doCleanup(overlay, renderer, diceMeshes);
    }, hasNat20 ? 2500 : 1000);
  }

  function doCleanup(ov, ren, meshes) {
    if (activeRenderLoop) { clearTimeout(activeRenderLoop); activeRenderLoop = null; }
    try { ren.dispose(); } catch (e) {}
    meshes.forEach(function(m) {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach(function(mt) { if (mt.map) mt.map.dispose(); mt.dispose(); });
      } else if (m.material) {
        if (m.material.map) m.material.map.dispose();
        m.material.dispose();
      }
    });
    if (ov && ov.parentNode) ov.remove();
    if (activeOverlay === ov) activeOverlay = null;
    if (activeRenderer === ren) activeRenderer = null;
  }
}

/* ── Accessibility: reduced motion ── */
function prefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── Natural 20 Critical Hit Celebration ── */
function spawnCritParticles(container) {
  var cfg = getThemeConfig();
  var colors = [cfg.numberColor || '#f0d9a0', '#ffd700', '#ffec80', cfg.bodyColor || '#6b4423'];
  var particleCount = 30;

  for (var i = 0; i < particleCount; i++) {
    var p = document.createElement('div');
    p.className = 'dice-crit-particle';
    var color = colors[Math.floor(Math.random() * colors.length)];
    var size = 4 + Math.random() * 6;
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    var angle = (Math.PI * 2 * i / particleCount) + (Math.random() - 0.5) * 0.5;
    var dist = 80 + Math.random() * 180;
    var tx = Math.cos(angle) * dist;
    var ty = Math.sin(angle) * dist - 40; // bias upward
    var delay = Math.random() * 0.15;

    p.style.cssText = 'position:fixed;z-index:1010;pointer-events:none;border-radius:50%;' +
      'width:' + size + 'px;height:' + size + 'px;' +
      'background:' + color + ';' +
      'left:' + cx + 'px;top:' + cy + 'px;' +
      'box-shadow:0 0 ' + (size * 2) + 'px ' + color + ';' +
      'opacity:1;' +
      'animation:dice-crit-burst 0.8s ' + delay + 's ease-out forwards;' +
      '--tx:' + tx + 'px;--ty:' + ty + 'px;';

    container.appendChild(p);
  }

  // Show "NATURAL 20!" text flash
  var flash = document.createElement('div');
  flash.className = 'dice-crit-text';
  flash.textContent = 'NATURAL 20!';
  flash.style.cssText = 'position:fixed;z-index:1011;pointer-events:none;' +
    'left:50%;top:45%;transform:translate(-50%,-50%) scale(0.5);' +
    'font-family:MedievalSharp,cursive;font-size:2.5rem;font-weight:700;' +
    'color:#ffd700;text-shadow:0 0 20px rgba(255,215,0,0.8),0 0 40px rgba(255,215,0,0.4);' +
    'opacity:0;animation:dice-crit-flash 1.2s ease-out forwards;';
  container.appendChild(flash);
}

function cleanupActiveRoll() {
  if (hideCleanupTimeout) { clearTimeout(hideCleanupTimeout); hideCleanupTimeout = null; }
  if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  if (activeRenderLoop) { clearTimeout(activeRenderLoop); activeRenderLoop = null; }
  if (activeRenderer) { try { activeRenderer.dispose(); } catch (e) {} activeRenderer = null; }
  if (activeOverlay) { try { activeOverlay.remove(); } catch (e) {} activeOverlay = null; }
}

/* ── Results Banner ── */
var resultTimeout = null;
var hideCleanupTimeout = null;

function showResults(results, total) {
  var parts = results.map(function(r) { return r.die + ': ' + r.value; });
  if (results.length === 1) {
    resultTotal.textContent = results[0].die + ': ' + results[0].value;
    resultDetail.textContent = '';
  } else {
    resultTotal.textContent = '= ' + total;
    resultDetail.textContent = parts.join(' + ');
  }
  resultHidden.textContent = hiddenMode ? '(Hidden Roll)' : '';

  // Post roll to server for history
  var rollDesc = buildRollDesc();
  var detailStr = parts.join(' + ');
  postRollToServer(rollDesc, total, detailStr, hiddenMode);

  resultsBanner.classList.add('visible');
  if (resultTimeout) clearTimeout(resultTimeout);
  resultTimeout = setTimeout(function() { hideResults(); }, 2000);

  resultsBanner.onmouseenter = function() {
    if (resultTimeout) clearTimeout(resultTimeout);
    if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  };
  resultsBanner.onmouseleave = function() {
    resultTimeout = setTimeout(function() { hideResults(); }, 1500);
    if (activeOverlay) {
      cleanupTimeout = setTimeout(function() { cleanupActiveRoll(); }, 1750);
    }
  };
}

function hideResults() {
  resultsBanner.classList.remove('visible');
  if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
  if (hideCleanupTimeout) { clearTimeout(hideCleanupTimeout); hideCleanupTimeout = null; }
  hideCleanupTimeout = setTimeout(function() { cleanupActiveRoll(); hideCleanupTimeout = null; }, 500);
}

/* ── History ── */
function buildRollDesc() {
  var parts = [];
  for (var die in selectedDice) {
    if (selectedDice[die] > 0) {
      parts.push(selectedDice[die] + die);
    }
  }
  return parts.join(' + ');
}

function postRollToServer(rollDesc, total, detailStr, isHidden) {
  // Get CSRF token
  var csrfInput = document.querySelector('input[name="_csrf"]');
  var csrfToken = csrfInput ? csrfInput.value : '';

  fetch('/api/dice/roll', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rollDesc: rollDesc,
      result: total,
      detail: detailStr,
      hidden: isHidden ? true : false,
      _csrf: csrfToken
    })
  }).then(function() {
    if (!isHidden) fetchHistory();
  }).catch(function() {});
}

function fetchHistory() {
  fetch('/api/dice/history', { credentials: 'same-origin' }).then(function(r) { return r.json(); }).then(function(data) {
    var newRolls = data.rolls || [];
    // Check for new rolls to show as mobile toast
    if (isMobile && cachedRolls.length > 0 && newRolls.length > 0) {
      var prevNewest = cachedRolls[0].created_at;
      if (newRolls[0].created_at !== prevNewest) {
        showDiceToast(newRolls[0]);
      }
    }
    cachedRolls = newRolls;
    // Update last roll timestamp from newest roll
    if (cachedRolls.length > 0) {
      var newest = new Date(cachedRolls[0].created_at + 'Z').getTime();
      if (newest > lastRollTimestamp) lastRollTimestamp = newest;
    }
    renderHistory();
  }).catch(function() {});
}

function showDiceToast(roll) {
  var toast = document.createElement('div');
  toast.className = 'dice-toast';
  toast.innerHTML = '<span class="toast-user">' + escapeHtml(roll.username) + '</span> rolled ' +
    escapeHtml(roll.roll_desc) + ' &mdash; <span class="toast-result">' + roll.result + '</span>';
  document.body.appendChild(toast);
  setTimeout(function() { toast.classList.add('fading'); }, 3500);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 4000);
}

function escapeHtml(str) {
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function renderHistory() {
  if (!historyEl) return;
  var old = historyEl.querySelectorAll('.dice-history-item');
  for (var i = 0; i < old.length; i++) old[i].remove();

  if (cachedRolls.length === 0) return;

  // Inactivity fade: 0 (just rolled) to 1 (5 min idle)
  var elapsed = Date.now() - lastRollTimestamp;
  var fadeFactor = Math.min(elapsed / FADE_DURATION, 1.0);

  // If fully faded, don't render anything
  if (fadeFactor >= 1.0) return;

  var globalAlpha = 1.0 - fadeFactor;

  // Rolls come newest-first; append oldest first (top) to newest last (bottom)
  for (var i = cachedRolls.length - 1; i >= 0; i--) {
    var roll = cachedRolls[i];
    // Position opacity: oldest (top) fades more, newest (bottom) brightest
    var positionOpacity = 1.0 - (i * 0.09);
    // Combine position fade with inactivity fade
    var opacity = positionOpacity * globalAlpha;

    if (opacity <= 0.01) continue; // skip invisible items

    var item = document.createElement('div');
    item.className = 'dice-history-item';
    item.style.opacity = opacity;

    var userSpan = document.createElement('div');
    userSpan.className = 'roll-user';
    userSpan.textContent = roll.username;

    var descSpan = document.createElement('div');
    descSpan.className = 'roll-desc';
    descSpan.textContent = 'rolled ' + roll.roll_desc;

    var resultSpan = document.createElement('div');
    resultSpan.className = 'roll-result';
    resultSpan.textContent = 'Result: ' + roll.result;

    item.appendChild(userSpan);
    item.appendChild(descSpan);
    item.appendChild(resultSpan);

    if (roll.detail) {
      var detailSpan = document.createElement('div');
      detailSpan.className = 'roll-detail-text';
      detailSpan.textContent = roll.detail;
      item.appendChild(detailSpan);
    }

    historyEl.appendChild(item);
  }
}

function applyInactivityFade() {
  // Re-render with updated fade factor every 3 seconds
  if (cachedRolls.length > 0 && lastRollTimestamp > 0) {
    renderHistory();
  }
}

/* ── Start ── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
