/* === 3D Dice Roller — Three.js + cannon-es === */
import * as CANNON from 'https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js';

var selectedDice = {};
var menuOpen = false;
var rolling = false;
var hiddenMode = false;

var fabBtn, bubbleMenu, splitBtns, rollBtn, clearBtn, hiddenBtn;
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

/* ── Procedural dice rolling sound (Web Audio API) ── */
var audioCtx = null;
function playDiceSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var ctx = audioCtx;
    var now = ctx.currentTime;
    var duration = 1.2;

    // Master gain
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.35, now);
    master.connect(ctx.destination);

    // Number of individual "click" impacts
    var numClicks = 12 + Math.floor(Math.random() * 6);
    for (var i = 0; i < numClicks; i++) {
      // Each click happens at an increasing interval (dice settling)
      var t = now + (i / numClicks) * duration * (0.3 + 0.7 * (i / numClicks));
      var clickGain = ctx.createGain();
      var vol = (1.0 - (i / numClicks) * 0.7) * (0.8 + Math.random() * 0.4);
      clickGain.gain.setValueAtTime(vol, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04 + Math.random() * 0.02);
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

      // Bandpass filter for wooden thud character
      var filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800 + Math.random() * 1200, t);
      filter.Q.setValueAtTime(1.5 + Math.random() * 2, t);
      noise.connect(filter);
      filter.connect(clickGain);

      noise.start(t);
      noise.stop(t + 0.06);

      // Low resonance for wood surface body (every few clicks)
      if (i % 3 === 0) {
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(120 + Math.random() * 80, t);
        var oscGain = ctx.createGain();
        oscGain.gain.setValueAtTime(vol * 0.25, t);
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

function performRoll() {
  rolling = true;
  hideResults();
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

/* ── Face Texture ── */
function createFaceTexture(text, size) {
  size = size || 128;
  var c = document.createElement('canvas');
  c.width = size; c.height = size;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#f0d9a0';
  var fontSize = String(text).length > 2 ? size * 0.22 : String(text).length > 1 ? size * 0.28 : size * 0.35;
  ctx.font = 'bold ' + Math.floor(fontSize) + 'px MedievalSharp, cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text), size / 2, size / 2);
  var tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function makeMat(text) {
  return new THREE.MeshStandardMaterial({
    map: createFaceTexture(text),
    roughness: 0.5,
    metalness: 0.15
  });
}

/* ── UV Assignment via face-plane projection ── */
function assignFaceUVs(geo) {
  var pos = geo.getAttribute('position');
  var uvArr = new Float32Array(pos.count * 2);
  var groups = geo.groups;

  for (var g = 0; g < groups.length; g++) {
    var start = groups[g].start;
    var count = groups[g].count;
    var verts = [];
    for (var i = 0; i < count; i++)
      verts.push(new THREE.Vector3().fromBufferAttribute(pos, start + i));

    var seen = {};
    var unique = [];
    for (var i = 0; i < verts.length; i++) {
      var key = verts[i].x.toFixed(5) + ',' + verts[i].y.toFixed(5) + ',' + verts[i].z.toFixed(5);
      if (!seen[key]) { seen[key] = true; unique.push(verts[i]); }
    }
    var center = new THREE.Vector3();
    for (var i = 0; i < unique.length; i++) center.add(unique[i]);
    center.divideScalar(unique.length);

    var ab = new THREE.Vector3().subVectors(verts[1], verts[0]);
    var ac = new THREE.Vector3().subVectors(verts[2], verts[0]);
    var normal = new THREE.Vector3().crossVectors(ab, ac).normalize();
    var tangent = ab.clone().normalize();
    var bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

    var coords = [];
    var maxExt = 0;
    for (var i = 0; i < verts.length; i++) {
      var rel = new THREE.Vector3().subVectors(verts[i], center);
      var u = rel.dot(tangent);
      var v = rel.dot(bitangent);
      coords.push([u, v]);
      maxExt = Math.max(maxExt, Math.abs(u), Math.abs(v));
    }

    var scale = maxExt > 0 ? 0.42 / maxExt : 1;
    for (var i = 0; i < coords.length; i++) {
      uvArr[(start + i) * 2] = coords[i][0] * scale + 0.5;
      uvArr[(start + i) * 2 + 1] = coords[i][1] * scale + 0.5;
    }
  }

  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
}

/* ── Edge outline — thin brown lines on die edges ── */
var edgeLineMat = null;
function addEdgeLines(mesh) {
  if (!edgeLineMat) {
    edgeLineMat = new THREE.LineBasicMaterial({ color: 0x3b2112, linewidth: 1 });
  }
  var edges = new THREE.EdgesGeometry(mesh.geometry, 15);
  var lines = new THREE.LineSegments(edges, edgeLineMat);
  mesh.add(lines);
}

/* ── D4 ── */
function createD4Mesh() {
  var vals = [1, 2, 3, 4];
  var geo = new THREE.TetrahedronGeometry(0.9, 0);
  geo = geo.toNonIndexed();
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 4; f++) { geo.addGroup(f * 3, 3, f); mats.push(makeMat(vals[f])); }
  assignFaceUVs(geo);
  return new THREE.Mesh(geo, mats);
}

function createD4Body(material) {
  var r = 0.9, s = r / Math.sqrt(3);
  var verts = [
    new CANNON.Vec3(s, s, s), new CANNON.Vec3(s, -s, -s),
    new CANNON.Vec3(-s, s, -s), new CANNON.Vec3(-s, -s, s)
  ];
  var faces = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

/* ── D6 ── */
function createD6Mesh() {
  var vals = [1, 6, 2, 5, 3, 4];
  var geo = new THREE.BoxGeometry(1, 1, 1);
  geo = geo.toNonIndexed();
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 6; f++) { geo.addGroup(f * 6, 6, f); mats.push(makeMat(vals[f])); }
  return new THREE.Mesh(geo, mats);
}

function createD6Body(material) {
  return new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), material: material });
}

/* ── D8 ── */
function createD8Mesh() {
  var vals = [1, 2, 3, 4, 5, 6, 7, 8];
  var geo = new THREE.OctahedronGeometry(0.8, 0);
  geo = geo.toNonIndexed();
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 8; f++) { geo.addGroup(f * 3, 3, f); mats.push(makeMat(vals[f])); }
  assignFaceUVs(geo);
  return new THREE.Mesh(geo, mats);
}

function createD8Body(material) {
  var r = 0.8;
  var verts = [
    new CANNON.Vec3(r, 0, 0), new CANNON.Vec3(-r, 0, 0),
    new CANNON.Vec3(0, r, 0), new CANNON.Vec3(0, -r, 0),
    new CANNON.Vec3(0, 0, r), new CANNON.Vec3(0, 0, -r)
  ];
  var faces = [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

/* ── D10 / D100 geometry ── */
function makeD10Verts(r) {
  r = r || 0.8;
  // Pentagonal trapezohedron — taller poles, wider ring for sharper profile
  var h = r * 1.5;
  var ringY = r * 0.25;
  var ringR = r * 0.9;
  var v = [];
  v.push([0, h, 0]);
  for (var i = 0; i < 5; i++) {
    var a = (i * 2 * Math.PI) / 5;
    v.push([ringR * Math.cos(a), ringY, ringR * Math.sin(a)]);
  }
  for (var i = 0; i < 5; i++) {
    var a = (i * 2 * Math.PI) / 5 + Math.PI / 5;
    v.push([ringR * Math.cos(a), -ringY, ringR * Math.sin(a)]);
  }
  v.push([0, -h, 0]);
  return v;
}

function buildD10Mesh(r, labels) {
  var verts = makeD10Verts(r);
  var positions = [], normals = [];

  function pushTri(a, b, c, n) {
    positions.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
    normals.push(n[0],n[1],n[2], n[0],n[1],n[2], n[0],n[1],n[2]);
  }

  function kiteFace(p0, p1, p2, p3) {
    var cx = (p0[0]+p1[0]+p2[0]+p3[0])/4;
    var cy = (p0[1]+p1[1]+p2[1]+p3[1])/4;
    var cz = (p0[2]+p1[2]+p2[2]+p3[2])/4;
    var d1 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
    var d2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
    var nx = d1[1]*d2[2]-d1[2]*d2[1], ny = d1[2]*d2[0]-d1[0]*d2[2], nz = d1[0]*d2[1]-d1[1]*d2[0];
    var len = Math.sqrt(nx*nx+ny*ny+nz*nz);
    nx/=len; ny/=len; nz/=len;
    if (cx*nx+cy*ny+cz*nz < 0) { nx=-nx; ny=-ny; nz=-nz; }
    var n = [nx, ny, nz];
    var e1 = [p1[0]-p0[0], p1[1]-p0[1], p1[2]-p0[2]];
    var e2 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
    var tnx = e1[1]*e2[2]-e1[2]*e2[1], tny = e1[2]*e2[0]-e1[0]*e2[2], tnz = e1[0]*e2[1]-e1[1]*e2[0];
    if (tnx*nx+tny*ny+tnz*nz > 0) {
      pushTri(p0, p1, p2, n);
      pushTri(p0, p2, p3, n);
    } else {
      pushTri(p0, p2, p1, n);
      pushTri(p0, p3, p2, n);
    }
  }

  for (var i = 0; i < 5; i++) {
    kiteFace(verts[0], verts[1+i], verts[6+i], verts[1+((i+1)%5)]);
  }
  for (var i = 0; i < 5; i++) {
    kiteFace(verts[11], verts[6+((i+1)%5)], verts[1+((i+1)%5)], verts[6+i]);
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 10; f++) {
    geo.addGroup(f * 6, 6, f);
    mats.push(makeMat(labels[f]));
  }
  assignFaceUVs(geo);
  return new THREE.Mesh(geo, mats);
}

function buildD10Body(r, material) {
  var v = makeD10Verts(r);
  var cv = v.map(function(p) { return new CANNON.Vec3(p[0], p[1], p[2]); });
  var faces = [];
  for (var i = 0; i < 5; i++) faces.push([0, 1 + i, 6 + i, 1 + ((i + 1) % 5)]);
  for (var i = 0; i < 5; i++) faces.push([11, 6 + ((i + 1) % 5), 1 + ((i + 1) % 5), 6 + i]);
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: cv, faces: faces }), material: material });
}

function createD10Mesh() { return buildD10Mesh(0.8, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); }
function createD10Body(m) { return buildD10Body(0.8, m); }
function createD100TensMesh() { return buildD10Mesh(0.85, ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90']); }
function createD100TensBody(m) { return buildD10Body(0.85, m); }

/* ── D12 ── */
function createD12Mesh() {
  var vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var geo = new THREE.DodecahedronGeometry(0.85, 0);
  geo = geo.toNonIndexed();
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 12; f++) { geo.addGroup(f * 9, 9, f); mats.push(makeMat(vals[f])); }
  assignFaceUVs(geo);
  return new THREE.Mesh(geo, mats);
}

function createD12Body(material) {
  var r = 0.85;
  var phi = (1 + Math.sqrt(5)) / 2;
  var a = r / Math.sqrt(3), b = a / phi, c = a * phi;
  var verts = [
    new CANNON.Vec3(a, a, a), new CANNON.Vec3(a, a, -a),
    new CANNON.Vec3(a, -a, a), new CANNON.Vec3(a, -a, -a),
    new CANNON.Vec3(-a, a, a), new CANNON.Vec3(-a, a, -a),
    new CANNON.Vec3(-a, -a, a), new CANNON.Vec3(-a, -a, -a),
    new CANNON.Vec3(0, b, c), new CANNON.Vec3(0, b, -c),
    new CANNON.Vec3(0, -b, c), new CANNON.Vec3(0, -b, -c),
    new CANNON.Vec3(b, c, 0), new CANNON.Vec3(b, -c, 0),
    new CANNON.Vec3(-b, c, 0), new CANNON.Vec3(-b, -c, 0),
    new CANNON.Vec3(c, 0, b), new CANNON.Vec3(c, 0, -b),
    new CANNON.Vec3(-c, 0, b), new CANNON.Vec3(-c, 0, -b)
  ];
  var faces = [
    [0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8],
    [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13],
    [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18],
    [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15]
  ];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

/* ── D20 ── */
function createD20Mesh() {
  var vals = [];
  for (var i = 1; i <= 20; i++) vals.push(i);
  var geo = new THREE.IcosahedronGeometry(0.85, 0);
  geo = geo.toNonIndexed();
  geo.clearGroups();
  var mats = [];
  for (var f = 0; f < 20; f++) { geo.addGroup(f * 3, 3, f); mats.push(makeMat(vals[f])); }
  assignFaceUVs(geo);
  return new THREE.Mesh(geo, mats);
}

function createD20Body(material) {
  var r = 0.85;
  var t = (1 + Math.sqrt(5)) / 2;
  var s = r / Math.sqrt(1 + t * t);
  var verts = [
    new CANNON.Vec3(-s, t*s, 0), new CANNON.Vec3(s, t*s, 0),
    new CANNON.Vec3(-s, -t*s, 0), new CANNON.Vec3(s, -t*s, 0),
    new CANNON.Vec3(0, -s, t*s), new CANNON.Vec3(0, s, t*s),
    new CANNON.Vec3(0, -s, -t*s), new CANNON.Vec3(0, s, -t*s),
    new CANNON.Vec3(t*s, 0, -s), new CANNON.Vec3(t*s, 0, s),
    new CANNON.Vec3(-t*s, 0, -s), new CANNON.Vec3(-t*s, 0, s)
  ];
  var faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

/* ── Create a single die ── */
function createDie(type, index, total, scene, world, material, bounds) {
  var mesh, body;
  switch (type) {
    case 'd4':        mesh = createD4Mesh();        body = createD4Body(material);        break;
    case 'd6':        mesh = createD6Mesh();        body = createD6Body(material);        break;
    case 'd8':        mesh = createD8Mesh();        body = createD8Body(material);        break;
    case 'd10':       mesh = createD10Mesh();       body = createD10Body(material);       break;
    case 'd100tens':  mesh = createD100TensMesh();  body = createD100TensBody(material);  break;
    case 'd100units': mesh = createD10Mesh();       body = createD10Body(material);       break;
    case 'd12':       mesh = createD12Mesh();       body = createD12Body(material);       break;
    case 'd20':       mesh = createD20Mesh();       body = createD20Body(material);       break;
    default:          mesh = createD6Mesh();        body = createD6Body(material);
  }

  addEdgeLines(mesh);

  // Spawn from a cloud above the scene — random spread within visible bounds
  var bx = bounds ? bounds.halfX : 3;
  var bz = bounds ? bounds.halfZ : 3;
  var px = (Math.random() - 0.5) * bx * 0.6;
  var pz = (Math.random() - 0.5) * bz * 0.6;
  var py = 6 + Math.random() * 2;
  body.position.set(px, py, pz);

  body.linearDamping = 0.05;
  body.angularDamping = 0.15;

  body.allowSleep = true;
  body.sleepSpeedLimit = 0.8;
  body.sleepTimeLimit = 0.15;

  // Gentle tumble — just enough spin to look natural as dice fall
  body.angularVelocity.set(
    (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 3,
    (Math.random() - 0.5) * 4
  );

  // Mostly downward velocity with slight lateral drift for spread
  body.velocity.set(
    (Math.random() - 0.5) * 1.5,
    -3 - Math.random() * 2,
    (Math.random() - 0.5) * 1.5
  );

  scene.add(mesh);
  world.addBody(body);
  return { mesh: mesh, body: body };
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

function getLocalFaceNormal(mesh, groupIndex) {
  var geo = mesh.geometry;
  var pos = geo.getAttribute('position');
  var s = geo.groups[groupIndex].start;
  var a = new THREE.Vector3().fromBufferAttribute(pos, s);
  var b = new THREE.Vector3().fromBufferAttribute(pos, s + 1);
  var c = new THREE.Vector3().fromBufferAttribute(pos, s + 2);
  return new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(b, a),
    new THREE.Vector3().subVectors(c, a)
  ).normalize();
}

function computeFaceQuaternion(mesh, faceIndex, targetDir) {
  var localN = getLocalFaceNormal(mesh, faceIndex);
  var q = new THREE.Quaternion().setFromUnitVectors(localN, targetDir);
  var yawQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2
  );
  return new THREE.Quaternion().multiplyQuaternions(yawQ, q);
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

  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3, 10, 3);
  scene.add(dirLight);
  var pointLight = new THREE.PointLight(0xd4a843, 0.5, 20);
  pointLight.position.set(0, 6, 0);
  scene.add(pointLight);

  // Calculate visible bounds at ground level (wider for natural scatter)
  var tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  var groundDist = camera.position.y - (-0.5);
  var halfZ = groundDist * tanHalfFov * 1.3;
  var halfX = halfZ * aspect * 1.3;

  // Physics world — controls position & collisions (NOT rotation)
  var world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;
  world.solver.tolerance = 0.001;
  world.allowSleep = true;

  var groundMat = new CANNON.Material('ground');
  var groundBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: groundMat });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, -0.5, 0);
  world.addBody(groundBody);

  // Walls at visible screen edges
  var wallDefs = [
    { pos: [halfX, 2, 0], rot: [0, -Math.PI / 2, 0] },
    { pos: [-halfX, 2, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [0, 2, halfZ], rot: [Math.PI / 2, 0, 0] },
    { pos: [0, 2, -halfZ], rot: [-Math.PI / 2, 0, 0] }
  ];
  wallDefs.forEach(function(w) {
    var wb = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: groundMat });
    wb.position.set(w.pos[0], w.pos[1], w.pos[2]);
    wb.quaternion.setFromEuler(w.rot[0], w.rot[1], w.rot[2]);
    world.addBody(wb);
  });

  var diceMat = new CANNON.Material('dice');
  world.addContactMaterial(new CANNON.ContactMaterial(groundMat, diceMat, {
    friction: 0.6, restitution: 0.2
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
    friction: 0.4, restitution: 0.3
  }));

  // Create dice — physics bodies for position/collision, staged quats for face rotation
  var diceMeshes = [], diceBodies = [], dieTypes = [];
  var preResults = [], targetQuats = [];
  var stageQuats = []; // stageQuats[i] = [q0, q1, q2, q3] — 3 random + 1 final

  var dieBounds = { halfX: halfX, halfZ: halfZ };
  diceList.forEach(function(die, idx) {
    var r = createDie(die, idx, diceList.length, scene, world, diceMat, dieBounds);
    diceMeshes.push(r.mesh);
    diceBodies.push(r.body);
    dieTypes.push(die);

    // Pre-determine the actual result
    var result = randomResult(die);
    preResults.push(result);

    // Compute 4 quaternions: 3 random faces + 1 final result
    var targetDir = (die === 'd4')
      ? new THREE.Vector3(0, -1, 0)
      : new THREE.Vector3(0, 1, 0);
    var quats = [];
    for (var s = 0; s < 3; s++) {
      var randVal = randomResult(die);
      var randFace = valueToFaceIndex(die, randVal);
      quats.push(computeFaceQuaternion(r.mesh, randFace, targetDir));
    }
    var faceIdx = valueToFaceIndex(die, result);
    quats.push(computeFaceQuaternion(r.mesh, faceIdx, targetDir));
    stageQuats.push(quats);
    targetQuats.push(quats[3]);

    // Set initial mesh orientation to first random face
    r.mesh.quaternion.copy(quats[0]);
    r.mesh.position.copy(r.body.position);
  });

  // Hybrid animation: physics for position, staged slerp for face rotation
  var stageDuration = 0.28;  // seconds per face-to-face transition
  var stages = 3;            // 3 transitions: face0→face1, face1→face2, face2→result
  var stageTotal = stageDuration * stages;
  var fixedStep = 1 / 120;
  var maxSubSteps = 10;
  var maxTime = 1500;        // 1.5s hard limit for physics
  var startTime = performance.now();
  var lastTime = startTime;
  var elapsed = 0;
  var allSettled = false;
  var physicsDone = false;

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function animate(now) {
    if (allSettled) return;
    var dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    elapsed += dt;

    // --- Physics: controls position & collisions ---
    if (!physicsDone) {
      world.step(fixedStep, dt, maxSubSteps);

      // Check if all dice have stopped
      var allSleeping = elapsed > 0.2;
      for (var j = 0; j < diceBodies.length; j++) {
        if (diceBodies[j].sleepState !== CANNON.Body.SLEEPING) {
          allSleeping = false;
          break;
        }
      }

      if (allSleeping || elapsed * 1000 >= maxTime) {
        for (var k = 0; k < diceBodies.length; k++) {
          diceBodies[k].velocity.setZero();
          diceBodies[k].angularVelocity.setZero();
        }
        physicsDone = true;
      }
    }

    // Copy position from physics bodies (but NOT rotation)
    for (var i = 0; i < diceMeshes.length; i++) {
      diceMeshes[i].position.copy(diceBodies[i].position);
    }

    // --- Staged face rotation: controls which number is shown ---
    var stageTime = elapsed;
    for (var i = 0; i < diceMeshes.length; i++) {
      var stageIdx = Math.floor(stageTime / stageDuration);
      if (stageIdx >= stages) {
        diceMeshes[i].quaternion.copy(stageQuats[i][stages]);
      } else {
        var st = easeInOut(Math.min((stageTime - stageIdx * stageDuration) / stageDuration, 1));
        diceMeshes[i].quaternion.copy(
          stageQuats[i][stageIdx].clone().slerp(stageQuats[i][stageIdx + 1], st)
        );
      }
    }

    renderer.render(scene, camera);

    // Done when physics settled AND all face stages complete
    if (physicsDone && elapsed >= stageTotal) {
      for (var i = 0; i < diceMeshes.length; i++) {
        diceMeshes[i].quaternion.copy(targetQuats[i]);
      }
      renderer.render(scene, camera);
      allSettled = true;
      onSettled();
      return;
    }

    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);

  function onSettled() {
    // Combine D100 pairs (tens + units) into single results
    var results = [];
    var total = 0;
    var i = 0;
    while (i < dieTypes.length) {
      if (dieTypes[i] === 'd100tens' && i + 1 < dieTypes.length && dieTypes[i + 1] === 'd100units') {
        var tens = preResults[i];
        var units = preResults[i + 1];
        var val = tens * 10 + units;
        if (val === 0) val = 100;
        results.push({ die: 'D100', value: val });
        total += val;
        i += 2;
      } else {
        results.push({ die: dieTypes[i].toUpperCase(), value: preResults[i] });
        total += preResults[i];
        i++;
      }
    }
    rolling = false;
    activeOverlay = overlay;
    activeRenderer = renderer;
    (function renderLoop() {
      renderer.render(scene, camera);
      activeRenderLoop = requestAnimationFrame(renderLoop);
    })();
    showResults(results, total);
    cleanupTimeout = setTimeout(function() {
      doCleanup(overlay, renderer, diceMeshes);
    }, 2000);
  }

  function doCleanup(ov, ren, meshes) {
    if (activeRenderLoop) { cancelAnimationFrame(activeRenderLoop); activeRenderLoop = null; }
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

function cleanupActiveRoll() {
  if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  if (activeRenderLoop) { cancelAnimationFrame(activeRenderLoop); activeRenderLoop = null; }
  if (activeRenderer) { try { activeRenderer.dispose(); } catch (e) {} activeRenderer = null; }
  if (activeOverlay) { try { activeOverlay.remove(); } catch (e) {} activeOverlay = null; }
}

/* ── Results Banner ── */
var resultTimeout = null;

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
  resultTimeout = setTimeout(function() { hideResults(); }, 4000);

  resultsBanner.onmouseenter = function() {
    if (resultTimeout) clearTimeout(resultTimeout);
    if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  };
  resultsBanner.onmouseleave = function() {
    resultTimeout = setTimeout(function() { hideResults(); }, 3000);
    if (activeOverlay) {
      cleanupTimeout = setTimeout(function() { cleanupActiveRoll(); }, 3500);
    }
  };
}

function hideResults() {
  resultsBanner.classList.remove('visible');
  if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
  setTimeout(function() { cleanupActiveRoll(); }, 500);
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
  fetch('/api/dice/roll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rollDesc: rollDesc, result: total, detail: detailStr, hidden: isHidden ? true : false })
  }).then(function() {
    if (!isHidden) fetchHistory();
  }).catch(function() {});
}

function fetchHistory() {
  fetch('/api/dice/history').then(function(r) { return r.json(); }).then(function(data) {
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
