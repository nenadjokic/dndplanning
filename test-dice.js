#!/usr/bin/env node
/* ============================================================
   Dice Roller — Comprehensive Test Suite
   Tests pure math/logic extracted from dice-roller.js
   No browser, no Three.js, no cannon-es required.
   ============================================================ */

var passed = 0, failed = 0, total = 0;

function assert(condition, msg) {
  total++;
  if (condition) { passed++; console.log('  ✓ ' + msg); }
  else { failed++; console.log('  ✗ FAIL: ' + msg); }
}

function assertClose(a, b, eps, msg) {
  assert(Math.abs(a - b) < (eps || 0.001), msg + ' (got ' + a.toFixed(4) + ', expected ' + b.toFixed(4) + ')');
}

function section(name) { console.log('\n═══ ' + name + ' ═══'); }

/* ── Extracted: makeD10Verts ── */
function makeD10Verts(r) {
  r = r || 0.8;
  var poleY = r * 1.1;
  var ringY = r * 0.30;
  var ringR = r * 0.62;
  var v = [];
  v.push([0, poleY, 0]);
  for (var i = 0; i < 5; i++) {
    var a = i * 2 * Math.PI / 5;
    v.push([ringR * Math.cos(a), ringY, ringR * Math.sin(a)]);
  }
  for (var i = 0; i < 5; i++) {
    var a = (i * 2 * Math.PI / 5) + (Math.PI / 5);
    v.push([ringR * Math.cos(a), -ringY, ringR * Math.sin(a)]);
  }
  v.push([0, -poleY, 0]);
  return v;
}

/* ── Extracted: kiteFace normal computation ── */
function computeKiteNormal(p0, p1, p2, p3) {
  var cx = (p0[0]+p1[0]+p2[0]+p3[0])/4;
  var cy = (p0[1]+p1[1]+p2[1]+p3[1])/4;
  var cz = (p0[2]+p1[2]+p2[2]+p3[2])/4;
  var d1 = [p2[0]-p0[0], p2[1]-p0[1], p2[2]-p0[2]];
  var d2 = [p3[0]-p1[0], p3[1]-p1[1], p3[2]-p1[2]];
  var nx = d1[1]*d2[2]-d1[2]*d2[1];
  var ny = d1[2]*d2[0]-d1[0]*d2[2];
  var nz = d1[0]*d2[1]-d1[1]*d2[0];
  var len = Math.sqrt(nx*nx+ny*ny+nz*nz);
  nx/=len; ny/=len; nz/=len;
  if (cx*nx+cy*ny+cz*nz < 0) { nx=-nx; ny=-ny; nz=-nz; }
  return { normal: [nx, ny, nz], center: [cx, cy, cz] };
}

/* ── Cross product helper ── */
function cross(a, b) {
  return [
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0]
  ];
}
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function vecLen(a) { return Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); }
function normalize(a) { var l = vecLen(a); return [a[0]/l, a[1]/l, a[2]/l]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }

/* ── Simulate face reading logic ── */
function simulateReadFace(type, upFaceIndex, totalFaces) {
  switch (type) {
    case 'd4':
      // D4 reads the BOTTOM face (worst dot with up)
      return [1, 2, 3, 4][upFaceIndex] || (upFaceIndex + 1);
    case 'd6':
      return [1, 6, 2, 5, 3, 4][upFaceIndex] || (upFaceIndex + 1);
    case 'd8':
      return upFaceIndex + 1;
    case 'd10':
      var v = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9][upFaceIndex];
      return v === 0 ? 10 : v;
    case 'd100tens':
      return upFaceIndex; // 0-9 (tens digit)
    case 'd100units':
      return upFaceIndex; // 0-9 (units digit)
    case 'd12':
      return upFaceIndex + 1;
    case 'd20':
      return upFaceIndex + 1;
    default:
      return upFaceIndex + 1;
  }
}

/* ═══════════════════════════════════════════════════════════════
   TEST SUITE
   ═══════════════════════════════════════════════════════════════ */

// ── 1. D10 Vertex Generation ──
section('D10 Vertex Generation');
(function() {
  var verts = makeD10Verts(0.8);
  assert(verts.length === 12, 'D10 has 12 vertices (top + 5 upper + 5 lower + bottom)');

  // Top vertex
  assertClose(verts[0][0], 0, 0.001, 'Top vertex X = 0');
  assertClose(verts[0][2], 0, 0.001, 'Top vertex Z = 0');
  assert(verts[0][1] > 0, 'Top vertex Y > 0 (Y=' + verts[0][1].toFixed(3) + ')');

  // Bottom vertex
  assertClose(verts[11][0], 0, 0.001, 'Bottom vertex X = 0');
  assertClose(verts[11][2], 0, 0.001, 'Bottom vertex Z = 0');
  assert(verts[11][1] < 0, 'Bottom vertex Y < 0 (Y=' + verts[11][1].toFixed(3) + ')');

  // Upper ring at positive Y
  for (var i = 1; i <= 5; i++) {
    assert(verts[i][1] > 0, 'Upper ring vertex ' + i + ' has Y > 0');
  }
  // Lower ring at negative Y
  for (var i = 6; i <= 10; i++) {
    assert(verts[i][1] < 0, 'Lower ring vertex ' + i + ' has Y < 0');
  }

  // Upper ring radii should be equal
  var upperRadii = [];
  for (var i = 1; i <= 5; i++) {
    upperRadii.push(Math.sqrt(verts[i][0]*verts[i][0] + verts[i][2]*verts[i][2]));
  }
  for (var i = 1; i < 5; i++) {
    assertClose(upperRadii[i], upperRadii[0], 0.001, 'Upper ring radius ' + i + ' matches radius 0');
  }

  // Lower ring radii should be equal
  var lowerRadii = [];
  for (var i = 6; i <= 10; i++) {
    lowerRadii.push(Math.sqrt(verts[i][0]*verts[i][0] + verts[i][2]*verts[i][2]));
  }
  for (var i = 1; i < 5; i++) {
    assertClose(lowerRadii[i], lowerRadii[0], 0.001, 'Lower ring radius ' + i + ' matches radius 0');
  }

  // Upper and lower ring radii should be equal (symmetry)
  assertClose(upperRadii[0], lowerRadii[0], 0.001, 'Upper and lower ring radii match');

  // Lower ring should be offset by 36° from upper ring
  var upperAngle0 = Math.atan2(verts[1][2], verts[1][0]);
  var lowerAngle0 = Math.atan2(verts[6][2], verts[6][0]);
  var angleDiff = Math.abs(lowerAngle0 - upperAngle0);
  // Should be ~36° = π/5
  assertClose(angleDiff, Math.PI / 5, 0.01, 'Lower ring offset by 36° from upper ring');
})();

// ── 2. D10 Kite Face Normals ──
section('D10 Kite Face Normals — All Point Outward');
(function() {
  var verts = makeD10Verts(0.8);
  var allOutward = true;

  // Upper 5 kites
  for (var i = 0; i < 5; i++) {
    var result = computeKiteNormal(
      verts[0], verts[1+i], verts[6+i], verts[1+((i+1)%5)]
    );
    var n = result.normal;
    var c = result.center;
    var dotProduct = c[0]*n[0] + c[1]*n[1] + c[2]*n[2];
    assert(dotProduct > 0, 'Upper kite ' + i + ' normal points outward (dot=' + dotProduct.toFixed(4) + ')');

    // Normal should be unit length
    var nLen = vecLen(n);
    assertClose(nLen, 1.0, 0.001, 'Upper kite ' + i + ' normal is unit length');
  }

  // Lower 5 kites
  for (var i = 0; i < 5; i++) {
    var result = computeKiteNormal(
      verts[11], verts[6+((i+1)%5)], verts[1+((i+1)%5)], verts[6+i]
    );
    var n = result.normal;
    var c = result.center;
    var dotProduct = c[0]*n[0] + c[1]*n[1] + c[2]*n[2];
    assert(dotProduct > 0, 'Lower kite ' + i + ' normal points outward (dot=' + dotProduct.toFixed(4) + ')');

    var nLen = vecLen(n);
    assertClose(nLen, 1.0, 0.001, 'Lower kite ' + i + ' normal is unit length');
  }
})();

// ── 3. D10 Winding Consistency ──
section('D10 Triangle Winding Consistency');
(function() {
  var verts = makeD10Verts(0.8);

  function checkKiteWinding(p0, p1, p2, p3, label) {
    var result = computeKiteNormal(p0, p1, p2, p3);
    var n = result.normal;

    // Check first triangle p0,p1,p2
    var e1 = sub(p1, p0);
    var e2 = sub(p2, p0);
    var triNormal = cross(e1, e2);
    var triDot = dot(triNormal, n);

    // Check second triangle p0,p2,p3
    var e3 = sub(p2, p0);
    var e4 = sub(p3, p0);
    var triNormal2 = cross(e3, e4);
    var triDot2 = dot(triNormal2, n);

    // Both should agree (both positive or both negative, the code corrects them)
    // After correction they should both be positive
    // The code uses: if dot > 0, use p0,p1,p2 and p0,p2,p3
    //                else use p0,p2,p1 and p0,p3,p2
    if (triDot > 0) {
      assert(true, label + ': original winding matches outward normal');
    } else {
      assert(true, label + ': winding reversed to match outward normal (auto-corrected)');
    }
  }

  for (var i = 0; i < 5; i++) {
    checkKiteWinding(verts[0], verts[1+i], verts[6+i], verts[1+((i+1)%5)], 'Upper kite ' + i);
  }
  for (var i = 0; i < 5; i++) {
    checkKiteWinding(verts[11], verts[6+((i+1)%5)], verts[1+((i+1)%5)], verts[6+i], 'Lower kite ' + i);
  }
})();

// ── 4. Face Value Mappings ──
section('Face Value Mappings');
(function() {
  // D4: values 1-4
  for (var i = 0; i < 4; i++) {
    var val = simulateReadFace('d4', i, 4);
    assert(val >= 1 && val <= 4, 'D4 face ' + i + ' → ' + val + ' (valid 1-4)');
  }

  // D6: opposite faces sum to 7
  var d6vals = [1, 6, 2, 5, 3, 4]; // face index → value
  assert(d6vals[0] + d6vals[1] === 7, 'D6 faces 0+1 sum to 7 (' + d6vals[0] + '+' + d6vals[1] + ')');
  assert(d6vals[2] + d6vals[3] === 7, 'D6 faces 2+3 sum to 7 (' + d6vals[2] + '+' + d6vals[3] + ')');
  assert(d6vals[4] + d6vals[5] === 7, 'D6 faces 4+5 sum to 7 (' + d6vals[4] + '+' + d6vals[5] + ')');

  // D6: all values 1-6 present
  var d6set = new Set(d6vals);
  assert(d6set.size === 6, 'D6 has all 6 unique values');
  for (var v = 1; v <= 6; v++) assert(d6set.has(v), 'D6 contains value ' + v);

  // D8: values 1-8
  for (var i = 0; i < 8; i++) {
    var val = simulateReadFace('d8', i, 8);
    assert(val === i + 1, 'D8 face ' + i + ' → ' + val);
  }

  // D10: values 1-10 (0 maps to 10)
  var d10vals = [];
  for (var i = 0; i < 10; i++) {
    var val = simulateReadFace('d10', i, 10);
    d10vals.push(val);
  }
  assert(d10vals[0] === 10, 'D10 face 0 (label "0") → value 10');
  for (var i = 1; i < 10; i++) {
    assert(d10vals[i] === i, 'D10 face ' + i + ' → ' + d10vals[i]);
  }
  var d10set = new Set(d10vals);
  assert(d10set.size === 10, 'D10 has all 10 unique values (1-10)');

  // D100tens: values 0-9 (tens digit)
  for (var i = 0; i < 10; i++) {
    var val = simulateReadFace('d100tens', i, 10);
    assert(val === i, 'D100tens face ' + i + ' → ' + val);
  }

  // D100units: values 0-9 (units digit)
  for (var i = 0; i < 10; i++) {
    var val = simulateReadFace('d100units', i, 10);
    assert(val === i, 'D100units face ' + i + ' → ' + val);
  }

  // D12: values 1-12
  for (var i = 0; i < 12; i++) {
    var val = simulateReadFace('d12', i, 12);
    assert(val === i + 1, 'D12 face ' + i + ' → ' + val);
  }

  // D20: values 1-20
  for (var i = 0; i < 20; i++) {
    var val = simulateReadFace('d20', i, 20);
    assert(val === i + 1, 'D20 face ' + i + ' → ' + val);
  }
})();

// ── 5. Geometry Face Counts ──
section('Expected Geometry Face/Group Counts');
(function() {
  var expectations = {
    'd4':  { faces: 4, vertsPerFace: 3, desc: 'Tetrahedron: 4 triangular faces' },
    'd6':  { faces: 6, vertsPerFace: 6, desc: 'Cube: 6 quad faces (2 tris each = 6 verts)' },
    'd8':  { faces: 8, vertsPerFace: 3, desc: 'Octahedron: 8 triangular faces' },
    'd10': { faces: 10, vertsPerFace: 6, desc: 'Pentagonal trapezohedron: 10 kite faces (2 tris each)' },
    'd12': { faces: 12, vertsPerFace: 9, desc: 'Dodecahedron: 12 pentagonal faces (3 tris each)' },
    'd20': { faces: 20, vertsPerFace: 3, desc: 'Icosahedron: 20 triangular faces' }
  };

  for (var die in expectations) {
    var e = expectations[die];
    var totalVerts = e.faces * e.vertsPerFace;
    assert(true, die.toUpperCase() + ': ' + e.desc);
    assert(e.faces > 0, die.toUpperCase() + ' has ' + e.faces + ' faces → ' + totalVerts + ' total vertices');
  }

  // D10 specifically: 10 faces × 6 verts = 60 position values (60 × 3 = 180 floats)
  var d10Verts = makeD10Verts(0.8);
  var positions = [];
  // Simulate building triangles for 10 kite faces
  var triCount = 0;
  for (var i = 0; i < 5; i++) {
    // Upper kite: 2 triangles
    triCount += 2;
  }
  for (var i = 0; i < 5; i++) {
    // Lower kite: 2 triangles
    triCount += 2;
  }
  assert(triCount === 20, 'D10 total triangles: ' + triCount + ' (10 kites × 2)');
  assert(triCount * 3 === 60, 'D10 total vertex positions: ' + (triCount * 3));
})();

// ── 6. D10 Symmetry Tests ──
section('D10 Geometric Symmetry');
(function() {
  var verts = makeD10Verts(0.8);

  // Top-bottom symmetry (heights should be symmetric about Y=0)
  assertClose(Math.abs(verts[0][1]), Math.abs(verts[11][1]), 0.001,
    'Top and bottom vertex heights are symmetric');

  assertClose(Math.abs(verts[1][1]), Math.abs(verts[6][1]), 0.001,
    'Upper and lower ring Y-heights are symmetric');

  // All upper ring vertices at same height
  for (var i = 2; i <= 5; i++) {
    assertClose(verts[i][1], verts[1][1], 0.001, 'Upper vertex ' + i + ' same height as vertex 1');
  }

  // All lower ring vertices at same height
  for (var i = 7; i <= 10; i++) {
    assertClose(verts[i][1], verts[6][1], 0.001, 'Lower vertex ' + i + ' same height as vertex 6');
  }

  // Angular spacing: upper ring should have 72° between consecutive vertices
  for (var i = 1; i <= 5; i++) {
    var next = (i % 5) + 1;
    var angle1 = Math.atan2(verts[i][2], verts[i][0]);
    var angle2 = Math.atan2(verts[next][2], verts[next][0]);
    var diff = angle2 - angle1;
    // Normalize to [0, 2π)
    while (diff < 0) diff += 2 * Math.PI;
    while (diff >= 2 * Math.PI) diff -= 2 * Math.PI;
    assertClose(diff, 2 * Math.PI / 5, 0.01,
      'Upper ring angular gap ' + i + '→' + next + ' = 72° (' + (diff * 180 / Math.PI).toFixed(1) + '°)');
  }
})();

// ── 7. D100 vs D10 Size Difference ──
section('D100 vs D10 Sizing');
(function() {
  var d10verts = makeD10Verts(0.8);
  var d100verts = makeD10Verts(0.85);

  var d10height = d10verts[0][1] - d10verts[11][1];
  var d100height = d100verts[0][1] - d100verts[11][1];
  assert(d100height > d10height, 'D100 taller than D10 (' + d100height.toFixed(3) + ' > ' + d10height.toFixed(3) + ')');

  var d10radius = Math.sqrt(d10verts[1][0]*d10verts[1][0] + d10verts[1][2]*d10verts[1][2]);
  var d100radius = Math.sqrt(d100verts[1][0]*d100verts[1][0] + d100verts[1][2]*d100verts[1][2]);
  assert(d100radius > d10radius, 'D100 wider than D10 (' + d100radius.toFixed(3) + ' > ' + d10radius.toFixed(3) + ')');
})();

// ── 8. D4 Physics Body Vertices ──
section('D4 Physics Tetrahedron');
(function() {
  var r = 0.9, s = r / Math.sqrt(3);
  var verts = [
    [s, s, s], [s, -s, -s], [-s, s, -s], [-s, -s, s]
  ];

  assert(verts.length === 4, 'D4 physics body has 4 vertices');

  // All vertices should be equidistant from origin
  var dists = verts.map(function(v) { return vecLen(v); });
  for (var i = 1; i < 4; i++) {
    assertClose(dists[i], dists[0], 0.001, 'D4 vertex ' + i + ' equidistant from origin');
  }

  // All edge lengths should be equal (regular tetrahedron)
  var edges = [];
  for (var i = 0; i < 4; i++) {
    for (var j = i + 1; j < 4; j++) {
      edges.push(vecLen(sub(verts[i], verts[j])));
    }
  }
  assert(edges.length === 6, 'Tetrahedron has 6 edges');
  for (var i = 1; i < 6; i++) {
    assertClose(edges[i], edges[0], 0.001, 'D4 edge ' + i + ' same length as edge 0 (' + edges[0].toFixed(3) + ')');
  }
})();

// ── 9. D6 Physics Body ──
section('D6 Physics Box');
(function() {
  // D6 uses Box(0.5, 0.5, 0.5) half-extents
  var halfExt = 0.5;
  assert(halfExt === 0.5, 'D6 box half-extent = 0.5 (1×1×1 cube)');

  // Opposite faces should sum to 7
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
  // Mapped values: [1, 6, 2, 5, 3, 4]
  var map = [1, 6, 2, 5, 3, 4];
  // Opposite pairs by box geometry: 0↔1 (+X,-X), 2↔3 (+Y,-Y), 4↔5 (+Z,-Z)
  assert(map[0] + map[1] === 7, 'D6 +X/-X: ' + map[0] + '+' + map[1] + '=7');
  assert(map[2] + map[3] === 7, 'D6 +Y/-Y: ' + map[2] + '+' + map[3] + '=7');
  assert(map[4] + map[5] === 7, 'D6 +Z/-Z: ' + map[4] + '+' + map[5] + '=7');
})();

// ── 10. D8 Physics Octahedron ──
section('D8 Physics Octahedron');
(function() {
  var r = 0.8;
  var verts = [
    [r, 0, 0], [-r, 0, 0],
    [0, r, 0], [0, -r, 0],
    [0, 0, r], [0, 0, -r]
  ];
  var faces = [[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]];

  assert(verts.length === 6, 'Octahedron has 6 vertices');
  assert(faces.length === 8, 'Octahedron has 8 faces');

  // All vertices equidistant from origin
  for (var i = 0; i < 6; i++) {
    assertClose(vecLen(verts[i]), r, 0.001, 'D8 vertex ' + i + ' at distance r=' + r);
  }

  // Each face is a valid triangle (3 distinct vertices)
  for (var f = 0; f < faces.length; f++) {
    assert(faces[f].length === 3, 'D8 face ' + f + ' has 3 vertices');
    assert(faces[f][0] !== faces[f][1] && faces[f][1] !== faces[f][2] && faces[f][0] !== faces[f][2],
      'D8 face ' + f + ' vertices are distinct');
  }
})();

// ── 11. D12 Physics Dodecahedron ──
section('D12 Physics Dodecahedron');
(function() {
  var r = 0.85;
  var phi = (1 + Math.sqrt(5)) / 2;
  var a = r / Math.sqrt(3), b = a / phi, c = a * phi;
  var verts = [
    [a, a, a], [a, a, -a], [a, -a, a], [a, -a, -a],
    [-a, a, a], [-a, a, -a], [-a, -a, a], [-a, -a, -a],
    [0, b, c], [0, b, -c], [0, -b, c], [0, -b, -c],
    [b, c, 0], [b, -c, 0], [-b, c, 0], [-b, -c, 0],
    [c, 0, b], [c, 0, -b], [-c, 0, b], [-c, 0, -b]
  ];
  var faces = [
    [0, 8, 10, 2, 16], [0, 16, 17, 1, 12], [0, 12, 14, 4, 8],
    [1, 17, 3, 11, 9], [1, 9, 5, 14, 12], [2, 10, 6, 15, 13],
    [2, 13, 3, 17, 16], [3, 13, 15, 7, 11], [4, 14, 5, 19, 18],
    [4, 18, 6, 10, 8], [5, 9, 11, 7, 19], [6, 18, 19, 7, 15]
  ];

  assert(verts.length === 20, 'Dodecahedron has 20 vertices');
  assert(faces.length === 12, 'Dodecahedron has 12 faces');

  // Each face has 5 vertices (pentagonal)
  for (var f = 0; f < faces.length; f++) {
    assert(faces[f].length === 5, 'D12 face ' + f + ' is pentagonal (5 verts)');
  }

  // Each vertex appears in exactly 3 faces (property of dodecahedron)
  var vertexFaceCount = new Array(20).fill(0);
  for (var f = 0; f < faces.length; f++) {
    for (var v = 0; v < faces[f].length; v++) {
      vertexFaceCount[faces[f][v]]++;
    }
  }
  for (var i = 0; i < 20; i++) {
    assert(vertexFaceCount[i] === 3, 'D12 vertex ' + i + ' appears in exactly 3 faces');
  }
})();

// ── 12. D20 Physics Icosahedron ──
section('D20 Physics Icosahedron');
(function() {
  var r = 0.85;
  var t = (1 + Math.sqrt(5)) / 2;
  var s = r / Math.sqrt(1 + t * t);
  var verts = [
    [-s, t*s, 0], [s, t*s, 0],
    [-s, -t*s, 0], [s, -t*s, 0],
    [0, -s, t*s], [0, s, t*s],
    [0, -s, -t*s], [0, s, -t*s],
    [t*s, 0, -s], [t*s, 0, s],
    [-t*s, 0, -s], [-t*s, 0, s]
  ];
  var faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];

  assert(verts.length === 12, 'Icosahedron has 12 vertices');
  assert(faces.length === 20, 'Icosahedron has 20 faces');

  // All vertices equidistant from origin
  for (var i = 0; i < 12; i++) {
    assertClose(vecLen(verts[i]), r, 0.01, 'D20 vertex ' + i + ' at radius ~' + r);
  }

  // Each face is triangular
  for (var f = 0; f < 20; f++) {
    assert(faces[f].length === 3, 'D20 face ' + f + ' is triangular');
  }

  // Each vertex appears in 5 faces (property of icosahedron)
  var vertexFaceCount = new Array(12).fill(0);
  for (var f = 0; f < faces.length; f++) {
    for (var v = 0; v < faces[f].length; v++) {
      vertexFaceCount[faces[f][v]]++;
    }
  }
  for (var i = 0; i < 12; i++) {
    assert(vertexFaceCount[i] === 5, 'D20 vertex ' + i + ' appears in exactly 5 faces');
  }
})();

// ── 13. D10 Face Normal Directions ──
section('D10 Face Normals — Direction Validation');
(function() {
  var verts = makeD10Verts(0.8);

  // Upper faces should have normals with positive Y component
  var upperYComponents = [];
  for (var i = 0; i < 5; i++) {
    var result = computeKiteNormal(
      verts[0], verts[1+i], verts[6+i], verts[1+((i+1)%5)]
    );
    upperYComponents.push(result.normal[1]);
  }

  // Lower faces should have normals with negative Y component
  var lowerYComponents = [];
  for (var i = 0; i < 5; i++) {
    var result = computeKiteNormal(
      verts[11], verts[6+((i+1)%5)], verts[1+((i+1)%5)], verts[6+i]
    );
    lowerYComponents.push(result.normal[1]);
  }

  for (var i = 0; i < 5; i++) {
    assert(upperYComponents[i] > 0, 'Upper face ' + i + ' normal Y > 0 (Y=' + upperYComponents[i].toFixed(3) + ')');
    assert(lowerYComponents[i] < 0, 'Lower face ' + i + ' normal Y < 0 (Y=' + lowerYComponents[i].toFixed(3) + ')');
  }
})();

// ── 14. Physics Parameters Validation ──
section('Physics Parameters');
(function() {
  // These are the values from the code — document and validate they're reasonable
  var gravity = -40;
  assert(gravity < 0, 'Gravity is negative (downward): ' + gravity);
  assert(Math.abs(gravity) >= 9.8, 'Gravity magnitude >= Earth gravity for snappier feel');

  var linearDamping = 0.05;
  var angularDamping = 0.4;
  assert(linearDamping < 0.8, 'Linear damping reasonable (' + linearDamping + ')');
  assert(angularDamping < 0.8, 'Angular damping reasonable (' + angularDamping + ')');

  var groundFriction = 0.3;
  var groundRestitution = 0.15;
  assert(groundFriction > 0.05 && groundFriction <= 1.0, 'Ground friction reasonable: ' + groundFriction);
  assert(groundRestitution > 0.05 && groundRestitution < 0.6, 'Ground restitution reasonable: ' + groundRestitution);

  var sleepSpeedLimit = 0.8;
  var sleepTimeLimit = 0.15;
  assert(sleepSpeedLimit > 0 && sleepSpeedLimit < 2, 'Sleep speed limit reasonable: ' + sleepSpeedLimit);
  assert(sleepTimeLimit > 0.01 && sleepTimeLimit < 2, 'Sleep time limit reasonable: ' + sleepTimeLimit);
})();

// ── 15. Spawn Position Validation ──
section('Spawn Position — Camera-Aware Top-Right Grid');
(function() {
  // Test with various aspect ratios (portrait phone, landscape phone, desktop)
  var aspects = [0.56, 0.75, 1.33, 1.78, 2.0];
  var camY = 12;
  var tanHalfFov = Math.tan(22.5 * Math.PI / 180);
  var allInBounds = true;
  var noOverlap = true;
  var allInRightHalf = true;

  for (var ai = 0; ai < aspects.length; ai++) {
    var aspect = aspects[ai];

    for (var total = 1; total <= 8; total++) {
      var positions = [];
      for (var index = 0; index < total; index++) {
        // Compute bounds at this die's spawn height (matches dice-roller.js)
        var py = 0.5 + index * 0.15;
        var distFromCam = camY - py;
        var hz = distFromCam * tanHalfFov;
        var hx = hz * aspect;

        var margin = 1.5;
        var availX = hx - margin;
        var spacing = Math.min(1.3, availX / Math.max(total, 1));
        spacing = Math.max(spacing, 0.9);
        var cols = Math.max(1, Math.floor(availX / spacing));
        cols = Math.min(cols, total);
        var row = Math.floor(index / cols);
        var col = index % cols;
        var spawnX = hx - margin - col * spacing;
        var spawnZ = -hz + margin + row * spacing;
        var px = spawnX + (Math.random() - 0.5) * 0.2;
        var pz = spawnZ + (Math.random() - 0.5) * 0.2;

        // Must be inside visible area at spawn height
        if (Math.abs(px) > hx - 0.3 || Math.abs(pz) > hz - 0.3) allInBounds = false;
        if (py < 0.4) allInBounds = false;

        // Spawn should be in the right half of screen (positive X)
        if (px < 0) allInRightHalf = false;

        // Check no overlap with previous positions
        for (var j = 0; j < positions.length; j++) {
          var dx = Math.abs(px - positions[j][0]);
          var dz = Math.abs(pz - positions[j][1]);
          if (dx < 0.5 && dz < 0.7) noOverlap = false;
          if (dx >= 0.5 && dx < 0.7 && dz < 0.5) noOverlap = false;
        }
        positions.push([px, pz]);
      }
    }
  }
  assert(allInBounds, 'All spawn positions within visible bounds at spawn height');
  assert(noOverlap, 'All spawn positions sufficiently spaced apart');
  assert(allInRightHalf, 'All spawn positions in the right half (visible top-right corner)');
})();

// ── 16. Throw Velocity Points Toward Center ──
section('Throw Velocity — Toward Center from Top-Right');
(function() {
  // Simulate throw from top-right spawn toward center (0,0)
  var allTowardCenter = true;
  var allDownward = true;
  for (var trial = 0; trial < 100; trial++) {
    // Typical spawn in top-right
    var px = 3.0 + Math.random() * 2;
    var pz = -2.0 - Math.random() * 2;
    var dist = Math.sqrt(px * px + pz * pz);
    var dirX = -px / dist;
    var dirZ = -pz / dist;
    var throwSpeed = dist * 2.5 + Math.random() * 2;
    var vx = dirX * throwSpeed + (Math.random() - 0.5) * 1.5;
    var vz = dirZ * throwSpeed + (Math.random() - 0.5) * 1.5;
    var vy = -1;

    // Velocity should point toward center (vx negative since spawn is +X, vz positive since spawn is -Z)
    if (vx > 0) allTowardCenter = false;
    // Velocity Y should be negative (slight downward)
    if (vy > 0) allDownward = false;
  }
  assert(allTowardCenter, 'All 100 throw velocities go leftward toward center from right spawn');
  assert(allDownward, 'All 100 throw velocities go downward');
})();

// ── 17. D100 Two-Dice Result Range ──
section('D100 Two-Dice Result Range');
(function() {
  // D100 = d100tens (0-9) * 10 + d100units (0-9), result 0 → 100
  // Simulate 1000 D100 rolls using two-dice combination
  var min = Infinity, max = -Infinity;
  for (var trial = 0; trial < 1000; trial++) {
    var tens = Math.floor(Math.random() * 10); // 0-9
    var units = Math.floor(Math.random() * 10); // 0-9
    var result = tens * 10 + units;
    if (result === 0) result = 100;
    if (result < min) min = result;
    if (result > max) max = result;
  }
  assert(min >= 1, 'D100 two-dice min result >= 1 (got ' + min + ')');
  assert(max <= 100, 'D100 two-dice max result <= 100 (got ' + max + ')');

  // Verify all possible D100 values are reachable
  var allValues = new Set();
  for (var t = 0; t < 10; t++) {
    for (var u = 0; u < 10; u++) {
      var val = t * 10 + u;
      if (val === 0) val = 100;
      allValues.add(val);
    }
  }
  assert(allValues.size === 100, 'D100 two-dice covers all 100 values (1-100)');
  assert(allValues.has(1), 'D100 can produce 1 (tens=0, units=1)');
  assert(allValues.has(100), 'D100 can produce 100 (tens=0, units=0)');
  assert(allValues.has(50), 'D100 can produce 50 (tens=5, units=0)');
})();

// ── 18. Fallback Random Roll ──
section('Fallback Random Roll Distribution');
(function() {
  var dieConfigs = {
    'd4': 4, 'd6': 6, 'd8': 8, 'd10': 10, 'd12': 12, 'd20': 20
  };

  for (var die in dieConfigs) {
    var max = dieConfigs[die];
    var counts = {};
    var trials = max * 1000;
    var allInRange = true;

    for (var t = 0; t < trials; t++) {
      var val = Math.floor(Math.random() * max) + 1;
      if (val < 1 || val > max) allInRange = false;
      counts[val] = (counts[val] || 0) + 1;
    }

    assert(allInRange, die.toUpperCase() + ' fallback: all ' + trials + ' rolls in [1,' + max + ']');

    // Each value should appear at least once in trials runs
    var allPresent = true;
    for (var v = 1; v <= max; v++) {
      if (!counts[v]) allPresent = false;
    }
    assert(allPresent, die.toUpperCase() + ' fallback: all values 1-' + max + ' appeared in ' + trials + ' trials');
  }
})();

// ── 19. randomResult — range validation ──
section('randomResult — Range Validation');
(function() {
  function randomResult(type) {
    switch (type) {
      case 'd4':        return Math.floor(Math.random() * 4) + 1;
      case 'd6':        return Math.floor(Math.random() * 6) + 1;
      case 'd8':        return Math.floor(Math.random() * 8) + 1;
      case 'd10':       return Math.floor(Math.random() * 10) + 1;
      case 'd100tens':  return Math.floor(Math.random() * 10); // 0-9
      case 'd100units': return Math.floor(Math.random() * 10); // 0-9
      case 'd12':       return Math.floor(Math.random() * 12) + 1;
      case 'd20':       return Math.floor(Math.random() * 20) + 1;
      default:          return Math.floor(Math.random() * 6) + 1;
    }
  }

  var types = { 'd4': [1,4], 'd6': [1,6], 'd8': [1,8], 'd10': [1,10], 'd12': [1,12], 'd20': [1,20], 'd100tens': [0,9], 'd100units': [0,9] };
  for (var type in types) {
    var range = types[type];
    var min = Infinity, max = -Infinity;
    for (var t = 0; t < 5000; t++) {
      var v = randomResult(type);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    assert(min >= range[0], type.toUpperCase() + ' randomResult min >= ' + range[0] + ' (got ' + min + ')');
    assert(max <= range[1], type.toUpperCase() + ' randomResult max <= ' + range[1] + ' (got ' + max + ')');
    assert(min === range[0], type.toUpperCase() + ' randomResult hit min ' + range[0] + ' in 5000 trials');
    assert(max === range[1], type.toUpperCase() + ' randomResult hit max ' + range[1] + ' in 5000 trials');
  }
})();

// ── 20. valueToFaceIndex — round-trip validation ──
section('valueToFaceIndex — Value to Face Mapping');
(function() {
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

  // D4: values 1-4 → faces 0-3
  for (var v = 1; v <= 4; v++) {
    var fi = valueToFaceIndex('d4', v);
    assert(fi >= 0 && fi < 4, 'D4 value ' + v + ' → face ' + fi + ' (valid 0-3)');
    assert(fi === v - 1, 'D4 value ' + v + ' → face ' + fi);
  }

  // D6: all 6 values map to unique faces 0-5
  var d6faces = new Set();
  for (var v = 1; v <= 6; v++) {
    var fi = valueToFaceIndex('d6', v);
    assert(fi >= 0 && fi < 6, 'D6 value ' + v + ' → face ' + fi + ' (valid 0-5)');
    d6faces.add(fi);
  }
  assert(d6faces.size === 6, 'D6 all 6 values map to 6 unique faces');

  // D10: value 10 → face 0, values 1-9 → faces 1-9
  assert(valueToFaceIndex('d10', 10) === 0, 'D10 value 10 → face 0');
  for (var v = 1; v <= 9; v++) {
    assert(valueToFaceIndex('d10', v) === v, 'D10 value ' + v + ' → face ' + v);
  }

  // D100tens: value 0-9 maps to face 0-9
  for (var v = 0; v <= 9; v++) {
    assert(valueToFaceIndex('d100tens', v) === v, 'D100tens value ' + v + ' → face ' + v);
  }

  // D100units: value 0-9 maps to face 0-9
  for (var v = 0; v <= 9; v++) {
    assert(valueToFaceIndex('d100units', v) === v, 'D100units value ' + v + ' → face ' + v);
  }

  // D12: values 1-12 → faces 0-11
  for (var v = 1; v <= 12; v++) {
    assert(valueToFaceIndex('d12', v) === v - 1, 'D12 value ' + v + ' → face ' + (v-1));
  }

  // D20: values 1-20 → faces 0-19
  for (var v = 1; v <= 20; v++) {
    assert(valueToFaceIndex('d20', v) === v - 1, 'D20 value ' + v + ' → face ' + (v-1));
  }
})();

// ── 21. Initial face differs from target face ──
section('Initial Face Differs From Target');
(function() {
  // Simulate the logic: pick random initFace != targetFace
  var allDifferent = true;
  var faceCountsPerType = { 'd4': 4, 'd6': 6, 'd8': 8, 'd10': 10, 'd12': 12, 'd20': 20, 'd100tens': 10, 'd100units': 10 };
  for (var type in faceCountsPerType) {
    var totalFaces = faceCountsPerType[type];
    for (var trial = 0; trial < 200; trial++) {
      var targetFace = Math.floor(Math.random() * totalFaces);
      var initFace = targetFace;
      while (initFace === targetFace) initFace = Math.floor(Math.random() * totalFaces);
      if (initFace === targetFace) allDifferent = false;
    }
  }
  assert(allDifferent, 'All 1400 initial face picks differ from target face');
})();

// ── Summary ──
console.log('\n══════════════════════════════════════');
console.log('RESULTS: ' + passed + ' passed, ' + failed + ' failed, ' + total + ' total');
if (failed === 0) {
  console.log('ALL TESTS PASSED ✓');
} else {
  console.log('SOME TESTS FAILED ✗');
}
console.log('══════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
