/* === 3D Dice Roller — Three.js + cannon-es === */
(function() {
  'use strict';

  // ── State ──
  var selectedDice = {}; // e.g. { d20: 2, d6: 1 }
  var menuOpen = false;
  var rolling = false;

  // ── DOM refs (set in init) ──
  var fabBtn, bubbleMenu, splitBtns, rollBtn, clearBtn;
  var resultsBanner, resultTotal, resultDetail;

  // ── Die types ──
  var DIE_TYPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

  // ── Face value maps (face-index → value) ──
  // These map the face with the highest upward-pointing normal to the die result

  // D4: tetrahedron — 4 faces. Top face = opposite of bottom vertex
  var D4_VALUES = [4, 1, 2, 3];

  // D6: box geometry — face order: +x, -x, +y, -y, +z, -z
  var D6_VALUES = [3, 4, 5, 2, 1, 6];

  // D8: octahedron — 8 faces
  var D8_VALUES = [1, 2, 3, 4, 5, 6, 7, 8];

  // D12: dodecahedron — 12 faces (Three.js detail=0 makes 36 triangles, 3 per face)
  var D12_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  // D20: icosahedron — 20 faces
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
    // FAB container
    var fab = document.createElement('div');
    fab.className = 'dice-fab';
    fab.id = 'dice-fab';

    // FAB button
    fabBtn = document.createElement('button');
    fabBtn.className = 'dice-fab-btn';
    fabBtn.setAttribute('aria-label', 'Dice Roller');
    fabBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"/>' +
      '<text x="12" y="15" text-anchor="middle" font-size="8" font-family="MedievalSharp,cursive" fill="currentColor" stroke="none">20</text>' +
      '</svg>';

    // Split buttons
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

    // Bubble menu
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

    // Results banner
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

    // Right-click to decrease
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

    // Check WebGL availability
    var testCanvas = document.createElement('canvas');
    var gl = testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl');
    if (!gl) {
      fallbackTextRoll();
      return;
    }

    // Wait for CDN libs
    if (typeof THREE === 'undefined' || typeof CANNON === 'undefined') {
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
    var ambient = new THREE.AmbientLight(0xfff5e6, 0.6);
    scene.add(ambient);

    var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
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

    var pointLight = new THREE.PointLight(0xd4a843, 0.4, 20);
    pointLight.position.set(0, 8, 0);
    scene.add(pointLight);

    // Shadow-catching ground
    var groundGeo = new THREE.PlaneGeometry(20, 20);
    var groundMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    var ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── cannon-es Physics ──
    var world = new CANNON.World({ gravity: new CANNON.Vec3(0, -30, 0) });
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    // Ground body
    var groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane()
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    groundBody.position.set(0, -0.5, 0);
    groundBody.material = new CANNON.Material({ friction: 0.4, restitution: 0.3 });
    world.addBody(groundBody);

    // Walls
    var wallPositions = [
      { pos: [6, 2, 0], rot: [0, -Math.PI / 2, 0] },
      { pos: [-6, 2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [0, 2, 6], rot: [Math.PI / 2, 0, 0] },   // changed to use rotations that point inward
      { pos: [0, 2, -6], rot: [-Math.PI / 2, 0, 0] }
    ];
    wallPositions.forEach(function(w) {
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

    var diceMaterial = new CANNON.Material({ friction: 0.4, restitution: 0.3 });
    var contactMat = new CANNON.ContactMaterial(groundBody.material, diceMaterial, {
      friction: 0.4,
      restitution: 0.3
    });
    world.addContactMaterial(contactMat);

    diceList.forEach(function(die, idx) {
      var result = createDie(die, idx, diceList.length, scene, world, diceMaterial);
      diceMeshes.push(result.mesh);
      diceBodies.push(result.body);
      dieTypes.push(die);
      settledFrames.push(0);
    });

    // ── Animation loop ──
    var allSettled = false;
    var frameCount = 0;
    var maxFrames = 360; // 6 seconds at 60fps
    var SETTLE_THRESHOLD = 0.08;
    var SETTLE_FRAMES = 30;

    function animate() {
      if (allSettled) return;

      frameCount++;
      world.step(1 / 60);

      // Sync meshes
      for (var i = 0; i < diceMeshes.length; i++) {
        diceMeshes[i].position.copy(diceBodies[i].position);
        diceMeshes[i].quaternion.copy(diceBodies[i].quaternion);

        // Check settled
        var vel = diceBodies[i].velocity.length();
        var angVel = diceBodies[i].angularVelocity.length();
        if (vel < SETTLE_THRESHOLD && angVel < SETTLE_THRESHOLD) {
          settledFrames[i]++;
        } else {
          settledFrames[i] = 0;
        }
      }

      renderer.render(scene, camera);

      // Check if all settled
      var allDone = true;
      for (var j = 0; j < settledFrames.length; j++) {
        if (settledFrames[j] < SETTLE_FRAMES) { allDone = false; break; }
      }

      if (allDone || frameCount >= maxFrames) {
        // Force stop
        for (var k = 0; k < diceBodies.length; k++) {
          diceBodies[k].velocity.setZero();
          diceBodies[k].angularVelocity.setZero();
        }
        renderer.render(scene, camera);
        allSettled = true;
        readResults();
        return;
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    // ── Read Results ──
    function readResults() {
      var results = [];
      var total = 0;

      for (var i = 0; i < diceMeshes.length; i++) {
        var val = readDieFace(diceMeshes[i], dieTypes[i]);
        results.push({ die: dieTypes[i].toUpperCase(), value: val });
        total += val;
      }

      // Short delay so user can see the final position
      setTimeout(function() {
        showResults(results, total);
        cleanup();
      }, 600);
    }

    // ── Cleanup ──
    function cleanup() {
      // Dispose Three.js resources
      renderer.dispose();
      diceMeshes.forEach(function(m) {
        if (m.geometry) m.geometry.dispose();
        if (Array.isArray(m.material)) {
          m.material.forEach(function(mat) { mat.dispose(); });
        } else if (m.material) {
          m.material.dispose();
        }
      });
      groundGeo.dispose();
      groundMat.dispose();
      overlay.remove();
      rolling = false;
    }
  }

  // ── Create a single die ──
  function createDie(type, index, total, scene, world, material) {
    var mesh, body;
    var spread = Math.min(total * 0.8, 4);
    var px = (Math.random() - 0.5) * spread;
    var pz = (Math.random() - 0.5) * spread;
    var py = 4 + Math.random() * 3;

    switch (type) {
      case 'd4':
        mesh = createD4Mesh();
        body = createD4Body(material);
        break;
      case 'd6':
        mesh = createD6Mesh();
        body = createD6Body(material);
        break;
      case 'd8':
        mesh = createD8Mesh();
        body = createD8Body(material);
        break;
      case 'd10':
        mesh = createD10Mesh();
        body = createD10Body(material);
        break;
      case 'd100':
        mesh = createD100Mesh();
        body = createD100Body(material);
        break;
      case 'd12':
        mesh = createD12Mesh();
        body = createD12Body(material);
        break;
      case 'd20':
        mesh = createD20Mesh();
        body = createD20Body(material);
        break;
      default:
        mesh = createD6Mesh();
        body = createD6Body(material);
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

    ctx.fillStyle = textColor || '#1a0f05';
    ctx.font = 'bold ' + Math.floor(size * 0.45) + 'px MedievalSharp, cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2);

    var texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  function makeDieMaterial(text) {
    return new THREE.MeshStandardMaterial({
      map: createFaceTexture(String(text), '#6b4423', '#1a0f05'),
      roughness: 0.6,
      metalness: 0.1
    });
  }

  function makeDefaultMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x6b4423,
      roughness: 0.6,
      metalness: 0.1
    });
  }

  // ── D4 ──
  function createD4Mesh() {
    var geo = new THREE.TetrahedronGeometry(0.9, 0);
    var mats = [];
    for (var i = 0; i < 4; i++) {
      mats.push(makeDieMaterial(D4_VALUES[i]));
    }
    // Assign groups for multi-material
    geo.clearGroups();
    for (var f = 0; f < 4; f++) {
      geo.addGroup(f * 3, 3, f);
    }
    return new THREE.Mesh(geo, mats);
  }

  function createD4Body(material) {
    var r = 0.9;
    // Tetrahedron vertices
    var verts = [
      new CANNON.Vec3(1, 1, 1).scale(r / Math.sqrt(3)),
      new CANNON.Vec3(1, -1, -1).scale(r / Math.sqrt(3)),
      new CANNON.Vec3(-1, 1, -1).scale(r / Math.sqrt(3)),
      new CANNON.Vec3(-1, -1, 1).scale(r / Math.sqrt(3))
    ];
    var faces = [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]];
    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D6 ──
  function createD6Mesh() {
    var geo = new THREE.BoxGeometry(1, 1, 1);
    // BoxGeometry: 6 faces, each 2 triangles = 12 triangles
    // Face order: +x(0-5), -x(6-11), +y(12-17), -y(18-23), +z(24-29), -z(30-35)
    var mats = [];
    for (var i = 0; i < 6; i++) {
      mats.push(makeDieMaterial(D6_VALUES[i]));
    }
    geo.clearGroups();
    for (var f = 0; f < 6; f++) {
      geo.addGroup(f * 6, 6, f);
    }
    return new THREE.Mesh(geo, mats);
  }

  function createD6Body(material) {
    var shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5));
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D8 ──
  function createD8Mesh() {
    var geo = new THREE.OctahedronGeometry(0.8, 0);
    var mats = [];
    for (var i = 0; i < 8; i++) {
      mats.push(makeDieMaterial(D8_VALUES[i]));
    }
    geo.clearGroups();
    for (var f = 0; f < 8; f++) {
      geo.addGroup(f * 3, 3, f);
    }
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
    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D10 (pentagonal trapezohedron approximation) ──
  function createD10Vertices(r) {
    r = r || 0.8;
    var verts = [];
    // Top vertex
    verts.push(new THREE.Vector3(0, r, 0));
    // Upper ring (5 vertices)
    for (var i = 0; i < 5; i++) {
      var angle = (i * 2 * Math.PI / 5);
      verts.push(new THREE.Vector3(
        r * 0.95 * Math.cos(angle),
        r * 0.35,
        r * 0.95 * Math.sin(angle)
      ));
    }
    // Lower ring (5 vertices, offset)
    for (var j = 0; j < 5; j++) {
      var angle2 = (j * 2 * Math.PI / 5) + (Math.PI / 5);
      verts.push(new THREE.Vector3(
        r * 0.95 * Math.cos(angle2),
        -r * 0.35,
        r * 0.95 * Math.sin(angle2)
      ));
    }
    // Bottom vertex
    verts.push(new THREE.Vector3(0, -r, 0));
    return verts;
  }

  function createD10Faces() {
    // 10 kite-shaped faces, each split into 2 triangles
    var faces = [];
    // Upper 5 faces: top, upper[i], lower[i], upper[i+1]
    for (var i = 0; i < 5; i++) {
      var u1 = 1 + i;
      var u2 = 1 + ((i + 1) % 5);
      var l1 = 6 + i;
      // Triangle 1: top, u1, l1
      faces.push(0, u1, l1);
      // Triangle 2: top, l1, u2  — NO, this would be wrong
      // Kite: 0, u1, l1, u2 -> split as (0, u1, l1) and (0, l1, u2)
      faces.push(0, l1, u2);
    }
    // Lower 5 faces: bottom, lower[i], upper[i+1], lower[i+1]
    for (var j = 0; j < 5; j++) {
      var l = 6 + j;
      var lNext = 6 + ((j + 1) % 5);
      var u = 1 + ((j + 1) % 5);
      faces.push(11, lNext, u);
      faces.push(11, u, l);
    }
    return faces;
  }

  function createD10Mesh() {
    var verts = createD10Vertices(0.8);
    var indices = createD10Faces();
    var geo = new THREE.BufferGeometry();
    var positions = [];
    var normals = [];

    // Build non-indexed geometry for per-face materials
    for (var i = 0; i < indices.length; i += 3) {
      var a = verts[indices[i]];
      var b = verts[indices[i + 1]];
      var c = verts[indices[i + 2]];

      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

      // Compute normal
      var ab = new THREE.Vector3().subVectors(b, a);
      var ac = new THREE.Vector3().subVectors(c, a);
      var n = new THREE.Vector3().crossVectors(ab, ac).normalize();
      normals.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

    // 20 triangles, 10 faces (2 triangles each)
    var mats = [];
    geo.clearGroups();
    for (var f = 0; f < 10; f++) {
      mats.push(makeDieMaterial(f === 0 ? 10 : f));
      geo.addGroup(f * 6, 6, f); // 2 triangles = 6 vertices per face
    }

    return new THREE.Mesh(geo, mats);
  }

  function createD10Body(material) {
    var threeVerts = createD10Vertices(0.8);
    var verts = threeVerts.map(function(v) { return new CANNON.Vec3(v.x, v.y, v.z); });
    // Use ConvexPolyhedron
    var faces = [];
    for (var i = 0; i < 5; i++) {
      var u1 = 1 + i;
      var u2 = 1 + ((i + 1) % 5);
      var l1 = 6 + i;
      faces.push([0, u1, l1, u2]);
    }
    for (var j = 0; j < 5; j++) {
      var l = 6 + j;
      var lNext = 6 + ((j + 1) % 5);
      var u = 1 + ((j + 1) % 5);
      faces.push([11, lNext, u, l]);
    }
    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D100 (same geometry as D10 but values are 10, 20, ... 00) ──
  function createD100Mesh() {
    var verts = createD10Vertices(0.85);
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

    var d100Vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, '00'];
    var mats = [];
    geo.clearGroups();
    for (var f = 0; f < 10; f++) {
      mats.push(makeDieMaterial(d100Vals[f]));
      geo.addGroup(f * 6, 6, f);
    }

    return new THREE.Mesh(geo, mats);
  }

  function createD100Body(material) {
    var threeVerts = createD10Vertices(0.85);
    var verts = threeVerts.map(function(v) { return new CANNON.Vec3(v.x, v.y, v.z); });
    var faces = [];
    for (var i = 0; i < 5; i++) {
      var u1 = 1 + i;
      var u2 = 1 + ((i + 1) % 5);
      var l1 = 6 + i;
      faces.push([0, u1, l1, u2]);
    }
    for (var j = 0; j < 5; j++) {
      var l = 6 + j;
      var lNext = 6 + ((j + 1) % 5);
      var u = 1 + ((j + 1) % 5);
      faces.push([11, lNext, u, l]);
    }
    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D12 ──
  function createD12Mesh() {
    var geo = new THREE.DodecahedronGeometry(0.85, 0);
    // Dodecahedron detail=0: 12 faces, 3 triangles each = 36 triangles
    var mats = [];
    geo.clearGroups();
    for (var f = 0; f < 12; f++) {
      mats.push(makeDieMaterial(D12_VALUES[f]));
      geo.addGroup(f * 9, 9, f); // 3 triangles = 9 vertices per pentagonal face
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

    // Use the convex hull approach
    var faces = [
      [0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8],
      [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13],
      [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18],
      [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15]
    ];

    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── D20 ──
  function createD20Mesh() {
    var geo = new THREE.IcosahedronGeometry(0.85, 0);
    // 20 triangular faces
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

    var shape = new CANNON.ConvexPolyhedron({ vertices: verts, faces: faces });
    return new CANNON.Body({ mass: 1, shape: shape, material: material });
  }

  // ── Read die face ──
  function readDieFace(mesh, type) {
    var geo = mesh.geometry;
    var pos = geo.getAttribute('position');
    var groups = geo.groups;
    var up = new THREE.Vector3(0, 1, 0);
    var bestDot = -Infinity;
    var bestGroup = 0;

    // For each group (face), compute average normal in world space
    for (var g = 0; g < groups.length; g++) {
      var start = groups[g].start;
      var count = groups[g].count;
      var normal = new THREE.Vector3();

      // Compute face normal from first triangle
      var a = new THREE.Vector3().fromBufferAttribute(pos, start);
      var b = new THREE.Vector3().fromBufferAttribute(pos, start + 1);
      var c = new THREE.Vector3().fromBufferAttribute(pos, start + 2);

      var ab = new THREE.Vector3().subVectors(b, a);
      var ac = new THREE.Vector3().subVectors(c, a);
      normal.crossVectors(ab, ac).normalize();

      // Transform to world space
      normal.applyQuaternion(mesh.quaternion);

      var dot = normal.dot(up);
      if (dot > bestDot) {
        bestDot = dot;
        bestGroup = g;
      }
    }

    // Map group index to value
    switch (type) {
      case 'd4': return D4_VALUES[bestGroup] || (bestGroup + 1);
      case 'd6': return D6_VALUES[bestGroup] || (bestGroup + 1);
      case 'd8': return D8_VALUES[bestGroup] || (bestGroup + 1);
      case 'd10':
        // D10 values: faces map to 1-10
        var d10Vals = [10, 1, 2, 3, 4, 5, 6, 7, 8, 9];
        return d10Vals[bestGroup] || (bestGroup + 1);
      case 'd100':
        var d100Vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
        // bestGroup 0 = "00" which means 100
        return d100Vals[bestGroup] || ((bestGroup + 1) * 10);
      case 'd12': return D12_VALUES[bestGroup] || (bestGroup + 1);
      case 'd20': return D20_VALUES[bestGroup] || (bestGroup + 1);
      default: return bestGroup + 1;
    }
  }

  // ── Show/Hide Results ──
  var resultTimeout = null;

  function showResults(results, total) {
    // Build detail string: "D20: 15 + D6: 4"
    var parts = results.map(function(r) { return r.die + ': ' + r.value; });
    var detailStr = parts.join(' + ');

    resultTotal.textContent = '= ' + total;
    resultDetail.textContent = detailStr;

    // If only one die, simplify
    if (results.length === 1) {
      resultTotal.textContent = results[0].die + ': ' + results[0].value;
      resultDetail.textContent = '';
    }

    resultsBanner.classList.add('visible');

    // Clear previous timeout
    if (resultTimeout) clearTimeout(resultTimeout);

    // Auto-hide after 10s (unless hovering)
    resultTimeout = setTimeout(function() {
      hideResults();
    }, 10000);

    // Hover keeps it visible
    resultsBanner.onmouseenter = function() {
      if (resultTimeout) clearTimeout(resultTimeout);
    };
    resultsBanner.onmouseleave = function() {
      resultTimeout = setTimeout(function() {
        hideResults();
      }, 3000);
    };
  }

  function hideResults() {
    resultsBanner.classList.remove('visible');
    if (resultTimeout) { clearTimeout(resultTimeout); resultTimeout = null; }
  }

  // ── Start when DOM ready ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
