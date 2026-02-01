/* === 3D Dice Roller — Three.js + cannon-es === */
import * as CANNON from 'https://unpkg.com/cannon-es@0.20.0/dist/cannon-es.js';

// ── State ──
var selectedDice = {}; // e.g. { d20: 2, d6: 1 }
var menuOpen = false;
var rolling = false;

// ── DOM refs (set in init) ──
var fabBtn, bubbleMenu, splitBtns, rollBtn, clearBtn;
var resultsBanner, resultTotal, resultDetail;

// Active overlay/renderer for delayed cleanup
var activeOverlay = null;
var activeRenderer = null;
var activeRenderLoop = null;
var cleanupTimeout = null;

// ── Die types ──
var DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

// ── Face value maps (face-index → value) ──
var D4_VALUES = [4, 1, 2, 3];
var D6_VALUES = [3, 4, 5, 2, 1, 6];
var D8_VALUES = [1, 2, 3, 4, 5, 6, 7, 8];
var D12_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
var D20_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

// ── Helpers ──
function totalSelected() {
  var n = 0;
  for (var k in selectedDice) n += selectedDice[k];
  return n;
}

// ── Init ──
function init() {
  buildDOM();
  bindEvents();
}

// ── Build DOM ──
function buildDOM() {
  var fab = document.createElement('div');
  fab.className = 'dice-fab';
  fab.id = 'dice-fab';

  fabBtn = document.createElement('button');
  fabBtn.className = 'dice-fab-btn';
  fabBtn.setAttribute('aria-label', 'Dice Roller');
  fabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>' +
    '<text x="12" y="15" text-anchor="middle" font-size="8" font-family="MedievalSharp,cursive" fill="currentColor" stroke="none">20</text>' +
    '</svg>';

  splitBtns = document.createElement('div');
  splitBtns.className = 'dice-split-btns';

  rollBtn = document.createElement('button');
  rollBtn.className = 'dice-roll-btn';
  rollBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/></svg> ROLL';

  clearBtn = document.createElement('button');
  clearBtn.className = 'dice-clear-btn';
  clearBtn.setAttribute('aria-label', 'Clear dice');
  clearBtn.innerHTML = '&times;';

  splitBtns.appendChild(rollBtn);
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
  resultsBanner.appendChild(resultTotal);
  resultsBanner.appendChild(resultDetail);

  document.body.appendChild(bubbleMenu);
  document.body.appendChild(fab);
  document.body.appendChild(resultsBanner);
}

// ── Bind Events ──
function bindEvents() {
  fabBtn.addEventListener('click', function() {
    if (rolling) return;
    menuOpen = !menuOpen;
    bubbleMenu.classList.toggle('open', menuOpen);
  });

  bubbleMenu.addEventListener('click', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn || rolling) return;
    var die = btn.getAttribute('data-die');
    if (!selectedDice[die]) selectedDice[die] = 0;
    selectedDice[die]++;
    updateBubbleUI();
  });

  bubbleMenu.addEventListener('contextmenu', function(e) {
    var btn = e.target.closest('.dice-bubble');
    if (!btn || rolling) return;
    e.preventDefault();
    var die = btn.getAttribute('data-die');
    if (selectedDice[die] && selectedDice[die] > 0) {
      selectedDice[die]--;
      if (selectedDice[die] === 0) delete selectedDice[die];
    }
    updateBubbleUI();
  });

  rollBtn.addEventListener('click', function() {
    if (rolling || totalSelected() === 0) return;
    performRoll();
  });

  clearBtn.addEventListener('click', function() {
    if (rolling) return;
    selectedDice = {};
    updateBubbleUI();
  });
}

// ── Update bubble UI ──
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

// ── Perform Roll ──
function performRoll() {
  rolling = true;
  hideResults();
  cleanupActiveRoll();

  // Check WebGL
  var testCanvas = document.createElement('canvas');
  var gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
  if (!gl || typeof THREE === 'undefined') {
    fallbackTextRoll();
    return;
  }

  run3DRoll();
}

// ── Fallback text roll ──
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

// ── 3D Roll ──
function run3DRoll() {
  var overlay = document.createElement('div');
  overlay.className = 'dice-overlay';
  document.body.appendChild(overlay);

  // Build dice list
  var diceList = [];
  for (var die in selectedDice) {
    for (var i = 0; i < selectedDice[die]; i++) {
      diceList.push(die);
    }
  }

  // ── Three.js Scene ──
  var scene = new THREE.Scene();

  var aspect = window.innerWidth / window.innerHeight;
  var camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.set(0, 14, 0);
  camera.lookAt(0, 0, 0);

  var renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  overlay.appendChild(renderer.domElement);

  // Lights
  var ambient = new THREE.AmbientLight(0xfff5e6, 0.8);
  scene.add(ambient);

  var dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 12, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 30;
  dirLight.shadow.camera.left = -8;
  dirLight.shadow.camera.right = 8;
  dirLight.shadow.camera.top = 8;
  dirLight.shadow.camera.bottom = -8;
  scene.add(dirLight);

  var pointLight = new THREE.PointLight(0xd4a843, 0.6, 20);
  pointLight.position.set(0, 8, 0);
  scene.add(pointLight);

  // Visible ground plane (dark surface)
  var groundGeo = new THREE.PlaneGeometry(20, 20);
  var groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    opacity: 0.85
  });
  var ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── cannon-es Physics ──
  var world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 10;

  var groundPhysMat = new CANNON.Material('ground');
  var groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: groundPhysMat
  });
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.position.set(0, -0.5, 0);
  world.addBody(groundBody);

  // Walls
  var wallDefs = [
    { pos: [6, 2, 0], rot: [0, -Math.PI / 2, 0] },
    { pos: [-6, 2, 0], rot: [0, Math.PI / 2, 0] },
    { pos: [0, 2, 4], rot: [Math.PI / 2, 0, 0] },
    { pos: [0, 2, -4], rot: [-Math.PI / 2, 0, 0] }
  ];
  wallDefs.forEach(function(w) {
    var wallBody = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane() });
    wallBody.position.set(w.pos[0], w.pos[1], w.pos[2]);
    wallBody.quaternion.setFromEuler(w.rot[0], w.rot[1], w.rot[2]);
    world.addBody(wallBody);
  });

  // ── Create dice ──
  var diceMeshes = [];
  var diceBodies = [];
  var dieTypes = [];
  var settledFrames = [];

  var diceMat = new CANNON.Material('dice');
  var contactMat = new CANNON.ContactMaterial(groundPhysMat, diceMat, {
    friction: 0.4,
    restitution: 0.3
  });
  world.addContactMaterial(contactMat);
  // dice-dice contact
  var diceContact = new CANNON.ContactMaterial(diceMat, diceMat, {
    friction: 0.3,
    restitution: 0.2
  });
  world.addContactMaterial(diceContact);

  diceList.forEach(function(die, idx) {
    var result = createDie(die, idx, diceList.length, scene, world, diceMat);
    diceMeshes.push(result.mesh);
    diceBodies.push(result.body);
    dieTypes.push(die);
    settledFrames.push(0);
  });

  // ── Animation loop ──
  var allSettled = false;
  var frameCount = 0;
  var maxFrames = 360; // 6s safety timeout
  var SETTLE_THRESHOLD = 0.08;
  var SETTLE_FRAMES = 30;
  var animId = null;

  function animate() {
    if (allSettled) return;

    frameCount++;
    world.step(1 / 60);

    for (var i = 0; i < diceMeshes.length; i++) {
      diceMeshes[i].position.copy(diceBodies[i].position);
      diceMeshes[i].quaternion.copy(diceBodies[i].quaternion);

      var vel = diceBodies[i].velocity.length();
      var angVel = diceBodies[i].angularVelocity.length();
      if (vel < SETTLE_THRESHOLD && angVel < SETTLE_THRESHOLD) {
        settledFrames[i]++;
      } else {
        settledFrames[i] = 0;
      }
    }

    renderer.render(scene, camera);

    var allDone = true;
    for (var j = 0; j < settledFrames.length; j++) {
      if (settledFrames[j] < SETTLE_FRAMES) { allDone = false; break; }
    }

    if (allDone || frameCount >= maxFrames) {
      for (var k = 0; k < diceBodies.length; k++) {
        diceBodies[k].velocity.setZero();
        diceBodies[k].angularVelocity.setZero();
      }
      renderer.render(scene, camera);
      allSettled = true;
      onSettled();
      return;
    }

    animId = requestAnimationFrame(animate);
  }

  animId = requestAnimationFrame(animate);

  // ── After dice settle ──
  function onSettled() {
    var results = [];
    var total = 0;
    for (var i = 0; i < diceMeshes.length; i++) {
      var val = readDieFace(diceMeshes[i], dieTypes[i]);
      results.push({ die: dieTypes[i].toUpperCase(), value: val });
      total += val;
    }

    rolling = false;

    // Keep dice visible — store refs for delayed cleanup
    activeOverlay = overlay;
    activeRenderer = renderer;

    // Keep rendering the static scene so dice stay visible
    function renderLoop() {
      renderer.render(scene, camera);
      activeRenderLoop = requestAnimationFrame(renderLoop);
    }
    renderLoop();

    showResults(results, total);

    // Schedule cleanup when banner hides (10s)
    cleanupTimeout = setTimeout(function() {
      doCleanup(overlay, renderer, diceMeshes, groundGeo, groundMat);
    }, 10500);
  }

  function doCleanup(ov, ren, meshes, gGeo, gMat) {
    if (activeRenderLoop) {
      cancelAnimationFrame(activeRenderLoop);
      activeRenderLoop = null;
    }
    try { ren.dispose(); } catch(e) {}
    meshes.forEach(function(m) {
      if (m.geometry) m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach(function(mat) { mat.dispose(); });
      } else if (m.material) {
        m.material.dispose();
      }
    });
    try { gGeo.dispose(); } catch(e) {}
    try { gMat.dispose(); } catch(e) {}
    if (ov && ov.parentNode) ov.remove();
    if (activeOverlay === ov) activeOverlay = null;
    if (activeRenderer === ren) activeRenderer = null;
  }
}

// ── Cleanup any previous active roll ──
function cleanupActiveRoll() {
  if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  if (activeRenderLoop) { cancelAnimationFrame(activeRenderLoop); activeRenderLoop = null; }
  if (activeRenderer) { try { activeRenderer.dispose(); } catch(e) {} activeRenderer = null; }
  if (activeOverlay) { try { activeOverlay.remove(); } catch(e) {} activeOverlay = null; }
}

// ── Create a single die ──
function createDie(type, index, total, scene, world, material) {
  var mesh, body;
  var spread = Math.min(total * 0.8, 4);
  var px = (Math.random() - 0.5) * spread;
  var pz = (Math.random() - 0.5) * spread;
  var py = 4 + Math.random() * 3;

  switch (type) {
    case 'd4':  mesh = createD4Mesh();  body = createD4Body(material);  break;
    case 'd6':  mesh = createD6Mesh();  body = createD6Body(material);  break;
    case 'd8':  mesh = createD8Mesh();  body = createD8Body(material);  break;
    case 'd10': mesh = createD10Mesh(); body = createD10Body(material); break;
    case 'd100':mesh = createD100Mesh();body = createD100Body(material);break;
    case 'd12': mesh = createD12Mesh(); body = createD12Body(material); break;
    case 'd20': mesh = createD20Mesh(); body = createD20Body(material); break;
    default:    mesh = createD6Mesh();  body = createD6Body(material);
  }

  body.position.set(px, py, pz);
  body.angularVelocity.set(
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20,
    (Math.random() - 0.5) * 20
  );
  body.velocity.set(
    (Math.random() - 0.5) * 4,
    -2,
    (Math.random() - 0.5) * 4
  );

  mesh.position.copy(body.position);
  mesh.castShadow = true;
  scene.add(mesh);
  world.addBody(body);

  return { mesh: mesh, body: body };
}

// ── Texture helpers ──
function createFaceTexture(text, bgColor, textColor, size) {
  size = size || 128;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor || '#5c3a1e';
  ctx.fillRect(0, 0, size, size);

  // Border
  ctx.strokeStyle = '#3a200e';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  ctx.fillStyle = textColor || '#f0d9a0';
  ctx.font = 'bold ' + Math.floor(size * 0.45) + 'px MedievalSharp, cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text), size / 2, size / 2);

  var texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function makeDieMaterial(text) {
  return new THREE.MeshStandardMaterial({
    map: createFaceTexture(text, '#6b4423', '#f0d9a0'),
    roughness: 0.5,
    metalness: 0.15
  });
}

// ── D4 ──
function createD4Mesh() {
  var geo = new THREE.TetrahedronGeometry(0.9, 0);
  var mats = [];
  for (var i = 0; i < 4; i++) mats.push(makeDieMaterial(D4_VALUES[i]));
  geo.clearGroups();
  for (var f = 0; f < 4; f++) geo.addGroup(f * 3, 3, f);
  return new THREE.Mesh(geo, mats);
}

function createD4Body(material) {
  var r = 0.9;
  var s = r / Math.sqrt(3);
  var verts = [
    new CANNON.Vec3(s, s, s),
    new CANNON.Vec3(s, -s, -s),
    new CANNON.Vec3(-s, s, -s),
    new CANNON.Vec3(-s, -s, s)
  ];
  var faces = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

// ── D6 ──
function createD6Mesh() {
  var geo = new THREE.BoxGeometry(1, 1, 1);
  var mats = [];
  for (var i = 0; i < 6; i++) mats.push(makeDieMaterial(D6_VALUES[i]));
  geo.clearGroups();
  for (var f = 0; f < 6; f++) geo.addGroup(f * 6, 6, f);
  return new THREE.Mesh(geo, mats);
}

function createD6Body(material) {
  return new CANNON.Body({ mass: 1, shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)), material: material });
}

// ── D8 ──
function createD8Mesh() {
  var geo = new THREE.OctahedronGeometry(0.8, 0);
  var mats = [];
  for (var i = 0; i < 8; i++) mats.push(makeDieMaterial(D8_VALUES[i]));
  geo.clearGroups();
  for (var f = 0; f < 8; f++) geo.addGroup(f * 3, 3, f);
  return new THREE.Mesh(geo, mats);
}

function createD8Body(material) {
  var r = 0.8;
  var verts = [
    new CANNON.Vec3(r, 0, 0), new CANNON.Vec3(-r, 0, 0),
    new CANNON.Vec3(0, r, 0), new CANNON.Vec3(0, -r, 0),
    new CANNON.Vec3(0, 0, r), new CANNON.Vec3(0, 0, -r)
  ];
  var faces = [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]
  ];
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

// ── D10 geometry helpers ──
function createD10Vertices(r) {
  r = r || 0.8;
  var verts = [];
  verts.push(new THREE.Vector3(0, r, 0));
  for (var i = 0; i < 5; i++) {
    var angle = (i * 2 * Math.PI / 5);
    verts.push(new THREE.Vector3(r * 0.95 * Math.cos(angle), r * 0.35, r * 0.95 * Math.sin(angle)));
  }
  for (var j = 0; j < 5; j++) {
    var angle2 = (j * 2 * Math.PI / 5) + (Math.PI / 5);
    verts.push(new THREE.Vector3(r * 0.95 * Math.cos(angle2), -r * 0.35, r * 0.95 * Math.sin(angle2)));
  }
  verts.push(new THREE.Vector3(0, -r, 0));
  return verts;
}

function createD10Faces() {
  var faces = [];
  for (var i = 0; i < 5; i++) {
    var u1 = 1 + i;
    var u2 = 1 + ((i + 1) % 5);
    var l1 = 6 + i;
    faces.push(0, u1, l1);
    faces.push(0, l1, u2);
  }
  for (var j = 0; j < 5; j++) {
    var l = 6 + j;
    var lNext = 6 + ((j + 1) % 5);
    var u = 1 + ((j + 1) % 5);
    faces.push(11, lNext, u);
    faces.push(11, u, l);
  }
  return faces;
}

function buildD10Geometry(r, values) {
  var verts = createD10Vertices(r);
  var indices = createD10Faces();
  var geo = new THREE.BufferGeometry();
  var positions = [];
  var normals = [];

  for (var i = 0; i < indices.length; i += 3) {
    var a = verts[indices[i]];
    var b = verts[indices[i + 1]];
    var c = verts[indices[i + 2]];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    var ab = new THREE.Vector3().subVectors(b, a);
    var ac = new THREE.Vector3().subVectors(c, a);
    var n = new THREE.Vector3().crossVectors(ab, ac).normalize();
    normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  var mats = [];
  geo.clearGroups();
  for (var f = 0; f < 10; f++) {
    mats.push(makeDieMaterial(values[f]));
    geo.addGroup(f * 6, 6, f);
  }
  return new THREE.Mesh(geo, mats);
}

function buildD10PhysicsBody(r, material) {
  var threeVerts = createD10Vertices(r);
  var verts = threeVerts.map(function(v) { return new CANNON.Vec3(v.x, v.y, v.z); });
  var faces = [];
  for (var i = 0; i < 5; i++) {
    faces.push([0, 1 + i, 6 + i, 1 + ((i + 1) % 5)]);
  }
  for (var j = 0; j < 5; j++) {
    faces.push([11, 6 + ((j + 1) % 5), 1 + ((j + 1) % 5), 6 + j]);
  }
  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

// ── D10 ──
function createD10Mesh() {
  return buildD10Geometry(0.8, [10, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}

function createD10Body(material) {
  return buildD10PhysicsBody(0.8, material);
}

// ── D100 ──
function createD100Mesh() {
  return buildD10Geometry(0.85, [10, 20, 30, 40, 50, 60, 70, 80, 90, '00']);
}

function createD100Body(material) {
  return buildD10PhysicsBody(0.85, material);
}

// ── D12 ──
function createD12Mesh() {
  var geo = new THREE.DodecahedronGeometry(0.85, 0);
  var mats = [];
  geo.clearGroups();
  for (var f = 0; f < 12; f++) {
    mats.push(makeDieMaterial(D12_VALUES[f]));
    geo.addGroup(f * 9, 9, f);
  }
  return new THREE.Mesh(geo, mats);
}

function createD12Body(material) {
  var r = 0.85;
  var phi = (1 + Math.sqrt(5)) / 2;
  var a = r / Math.sqrt(3);
  var b = a / phi;
  var c = a * phi;

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

// ── D20 ──
function createD20Mesh() {
  var geo = new THREE.IcosahedronGeometry(0.85, 0);
  var mats = [];
  geo.clearGroups();
  for (var f = 0; f < 20; f++) {
    mats.push(makeDieMaterial(D20_VALUES[f]));
    geo.addGroup(f * 3, 3, f);
  }
  return new THREE.Mesh(geo, mats);
}

function createD20Body(material) {
  var r = 0.85;
  var t = (1 + Math.sqrt(5)) / 2;
  var s = r / Math.sqrt(1 + t * t);

  var verts = [
    new CANNON.Vec3(-s, t * s, 0), new CANNON.Vec3(s, t * s, 0),
    new CANNON.Vec3(-s, -t * s, 0), new CANNON.Vec3(s, -t * s, 0),
    new CANNON.Vec3(0, -s, t * s), new CANNON.Vec3(0, s, t * s),
    new CANNON.Vec3(0, -s, -t * s), new CANNON.Vec3(0, s, -t * s),
    new CANNON.Vec3(t * s, 0, -s), new CANNON.Vec3(t * s, 0, s),
    new CANNON.Vec3(-t * s, 0, -s), new CANNON.Vec3(-t * s, 0, s)
  ];

  var faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ];

  return new CANNON.Body({ mass: 1, shape: new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces }), material: material });
}

// ── Read die face ──
function readDieFace(mesh, type) {
  var geo = mesh.geometry;
  var pos = geo.getAttribute('position');
  var groups = geo.groups;
  var up = new THREE.Vector3(0, 1, 0);
  var bestDot = -Infinity;
  var bestGroup = 0;

  for (var g = 0; g < groups.length; g++) {
    var start = groups[g].start;
    var normal = new THREE.Vector3();

    var a = new THREE.Vector3().fromBufferAttribute(pos, start);
    var b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
    var c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);

    var ab = new THREE.Vector3().subVectors(b, a);
    var ac = new THREE.Vector3().subVectors(c, a);
    normal.crossVectors(ab, ac).normalize();
    normal.applyQuaternion(mesh.quaternion);

    var dot = normal.dot(up);
    if (dot > bestDot) {
      bestDot = dot;
      bestGroup = g;
    }
  }

  switch (type) {
    case 'd4':  return D4_VALUES[bestGroup] || (bestGroup + 1);
    case 'd6':  return D6_VALUES[bestGroup] || (bestGroup + 1);
    case 'd8':  return D8_VALUES[bestGroup] || (bestGroup + 1);
    case 'd10':
      var d10Vals = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      return d10Vals[bestGroup] || (bestGroup + 1);
    case 'd100':
      var d100Vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      return d100Vals[bestGroup] || ((bestGroup + 1) * 10);
    case 'd12': return D12_VALUES[bestGroup] || (bestGroup + 1);
    case 'd20': return D20_VALUES[bestGroup] || (bestGroup + 1);
    default: return bestGroup + 1;
  }
}

// ── Show/Hide Results ──
var resultTimeout = null;

function showResults(results, total) {
  var parts = results.map(function(r) { return r.die + ': ' + r.value; });
  var detailStr = parts.join(' + ');

  resultTotal.textContent = '= ' + total;
  resultDetail.textContent = detailStr;

  if (results.length === 1) {
    resultTotal.textContent = results[0].die + ': ' + results[0].value;
    resultDetail.textContent = '';
  }

  resultsBanner.classList.add('visible');

  if (resultTimeout) clearTimeout(resultTimeout);

  resultTimeout = setTimeout(function() {
    hideResults();
  }, 10000);

  resultsBanner.onmouseenter = function() {
    if (resultTimeout) clearTimeout(resultTimeout);
    // Also pause overlay cleanup
    if (cleanupTimeout) { clearTimeout(cleanupTimeout); cleanupTimeout = null; }
  };
  resultsBanner.onmouseleave = function() {
    resultTimeout = setTimeout(function() {
      hideResults();
    }, 3000);
    // Also schedule overlay cleanup
    if (activeOverlay) {
      cleanupTimeout = setTimeout(function() {
        cleanupActiveRoll();
      }, 3500);
    }
  };
}

function hideResults() {
  resultsBanner.classList.remove('visible');
  if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
  // Clean up 3D overlay
  setTimeout(function() { cleanupActiveRoll(); }, 500);
}

// ── Start when DOM ready ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
