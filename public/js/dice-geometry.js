/* === Dice Geometry Module — Chamfered polyhedra for realistic 3D dice ===
 * Ported from dice-box-threejs (MIT License, Copyright 2022 3D Dice)
 * Adapted for Quest Planner's Three.js + cannon-es stack
 */

/* ── Dice Configuration Constants ── */
var DICE_GEOM = {
  d4: {
    vertices: [[1,1,1], [-1,-1,1], [-1,1,-1], [1,-1,-1]],
    faces: [[1,0,2,1], [0,1,3,2], [0,3,2,3], [1,2,3,4]],
    scaleFactor: 1.0,
    chamfer: 0.96,
    tab: -0.1,
    af: Math.PI * 7 / 6,
    labels: [1, 2, 3, 4],
    invertUpside: true,
    inertia: 5,
    radius: 0.9
  },
  d6: {
    vertices: [[-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
               [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]],
    faces: [[0,3,2,1,1], [1,2,6,5,2], [0,1,5,4,3],
            [3,7,6,2,4], [0,4,7,3,5], [4,5,6,7,6]],
    scaleFactor: 1.0,
    chamfer: 0.96,
    tab: 0.1,
    af: Math.PI / 4,
    labels: [1, 6, 2, 5, 3, 4],
    inertia: 13,
    radius: 0.85
  },
  d8: {
    vertices: [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]],
    faces: [[0,2,4,1], [0,4,3,2], [0,3,5,3], [0,5,2,4],
            [1,4,2,5], [1,3,4,6], [1,5,3,7], [1,2,5,8]],
    scaleFactor: 1.0,
    chamfer: 0.965,
    tab: 0,
    af: -Math.PI / 4 / 2,
    labels: [1, 2, 3, 4, 5, 6, 7, 8],
    inertia: 10,
    radius: 0.85
  },
  d10: {
    // Pentagonal trapezohedron: 10 equatorial vertices in zigzag + 2 polar apices
    // Each face is a kite (quad) connecting 3 equatorial vertices + 1 pole
    vertices: (function() {
      var verts = [];
      for (var i = 0, b = 0; i < 10; i++, b += Math.PI * 2 / 10) {
        verts.push([Math.cos(b), Math.sin(b), 0.105 * (i % 2 ? 1 : -1)]);
      }
      verts.push([0, 0, -1]); // index 10 = bottom apex
      verts.push([0, 0, 1]);  // index 11 = top apex
      return verts;
    })(),
    // Kite quad faces: 4 vertices + materialIndex
    // Top-pole kites (CCW from outside): [eq_i, eq_next, pole_top, eq_prev]
    // Bottom-pole kites (CCW from outside): [eq_i, eq_prev, pole_bot, eq_next]
    faces: [
      [0, 1, 11, 9, 1],   // face 0 — top pole kite
      [1, 0, 10, 2, 2],   // face 1 — bottom pole kite (reversed for outward normal)
      [2, 3, 11, 1, 3],   // face 2 — top pole kite
      [3, 2, 10, 4, 4],   // face 3 — bottom pole kite
      [4, 5, 11, 3, 5],   // face 4 — top pole kite
      [5, 4, 10, 6, 6],   // face 5 — bottom pole kite
      [6, 7, 11, 5, 7],   // face 6 — top pole kite
      [7, 6, 10, 8, 8],   // face 7 — bottom pole kite
      [8, 9, 11, 7, 9],   // face 8 — top pole kite
      [9, 8, 10, 0, 10]   // face 9 — bottom pole kite
    ],
    scaleFactor: 1.0,
    chamfer: 0.945,
    tab: 0,
    af: Math.PI * 6 / 5,
    labels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    isD10: true,
    inertia: 9,
    radius: 0.85
  },
  d100: {
    // Same geometry as d10, different labels (tens digit)
    vertices: (function() {
      var verts = [];
      for (var i = 0, b = 0; i < 10; i++, b += Math.PI * 2 / 10) {
        verts.push([Math.cos(b), Math.sin(b), 0.105 * (i % 2 ? 1 : -1)]);
      }
      verts.push([0, 0, -1]);
      verts.push([0, 0, 1]);
      return verts;
    })(),
    faces: [
      [0, 1, 11, 9, 1],
      [1, 0, 10, 2, 2],
      [2, 3, 11, 1, 3],
      [3, 2, 10, 4, 4],
      [4, 5, 11, 3, 5],
      [5, 4, 10, 6, 6],
      [6, 7, 11, 5, 7],
      [7, 6, 10, 8, 8],
      [8, 9, 11, 7, 9],
      [9, 8, 10, 0, 10]
    ],
    scaleFactor: 1.0,
    chamfer: 0.945,
    tab: 0,
    af: Math.PI * 6 / 5,
    labels: ['00', '10', '20', '30', '40', '50', '60', '70', '80', '90'],
    isD10: true,
    inertia: 9,
    radius: 0.85
  },
  d12: {
    vertices: (function() {
      var p = (1 + Math.sqrt(5)) / 2, q = 1 / p;
      return [
        [0, q, p], [0, q, -p], [0, -q, p], [0, -q, -p],
        [p, 0, q], [p, 0, -q], [-p, 0, q], [-p, 0, -q],
        [q, p, 0], [q, -p, 0], [-q, p, 0], [-q, -p, 0],
        [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
        [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]
      ];
    })(),
    faces: [[2,14,4,12,0,1], [15,9,11,19,3,2], [16,10,17,7,6,3],
            [6,7,19,11,18,4], [6,18,2,0,16,5], [18,11,9,14,2,6],
            [1,17,10,8,13,7], [1,13,5,15,3,8], [13,8,12,4,5,9],
            [5,4,14,9,15,10], [0,12,8,10,16,11], [3,19,7,17,1,12]],
    scaleFactor: 1.0,
    chamfer: 0.968,
    tab: 0.2,
    af: -Math.PI / 4 / 2,
    labels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    inertia: 18,
    radius: 0.85
  },
  d20: {
    vertices: (function() {
      var t = (1 + Math.sqrt(5)) / 2;
      return [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
      ];
    })(),
    faces: [[0,11,5,1], [0,5,1,2], [0,1,7,3], [0,7,10,4], [0,10,11,5],
            [1,5,9,6], [5,11,4,7], [11,10,2,8], [10,7,6,9], [7,1,8,10],
            [3,9,4,11], [3,4,2,12], [3,2,6,13], [3,6,8,14], [3,8,9,15],
            [4,9,5,16], [2,4,11,17], [6,2,10,18], [8,6,7,19], [9,8,1,20]],
    scaleFactor: 1.0,
    chamfer: 0.955,
    tab: -0.2,
    af: -Math.PI / 4 / 2,
    labels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    inertia: 6,
    radius: 0.85
  }
};

/* ── Chamfer Geometry Generator ── */
function chamferGeom(vectors, faces, chamfer) {
  var chamferVectors = [];
  var chamferFaces = [];
  var cornerFaces = new Array(vectors.length);
  for (var i = 0; i < vectors.length; i++) cornerFaces[i] = [];

  // For each face, pull vertices inward toward face center
  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    var fl = face.length - 1; // last element is material index
    var centerPoint = [0, 0, 0];
    for (var j = 0; j < fl; j++) {
      centerPoint[0] += vectors[face[j]][0];
      centerPoint[1] += vectors[face[j]][1];
      centerPoint[2] += vectors[face[j]][2];
    }
    centerPoint[0] /= fl;
    centerPoint[1] /= fl;
    centerPoint[2] /= fl;

    var face2 = [];
    for (var j = 0; j < fl; j++) {
      // Interpolate vertex toward center by (1 - chamfer)
      var v = [
        vectors[face[j]][0] * chamfer + centerPoint[0] * (1 - chamfer),
        vectors[face[j]][1] * chamfer + centerPoint[1] * (1 - chamfer),
        vectors[face[j]][2] * chamfer + centerPoint[2] * (1 - chamfer)
      ];
      chamferVectors.push(v);
      face2.push(chamferVectors.length - 1);
      cornerFaces[face[j]].push(face2.length - 1 + chamferFaces.length * 100 + 100);
    }
    face2.push(face[fl]); // material index
    chamferFaces.push(face2);
  }

  // Create edge faces (beveled edges between adjacent original faces)
  for (var i = 0; i < faces.length - 1; i++) {
    for (var j = i + 1; j < faces.length; j++) {
      var pairs = [];
      var lastM = faces[i].length - 1;
      var lastN = faces[j].length - 1;
      for (var m = 0; m < lastM; m++) {
        for (var n = 0; n < lastN; n++) {
          if (faces[i][m] === faces[j][n] &&
              faces[i][(m + 1) % lastM] === faces[j][(n + lastN - 1) % lastN]) {
            pairs.push([m, n]);
          }
        }
      }
      if (pairs.length === 1) {
        var m = pairs[0][0];
        var n = pairs[0][1];
        var lastM2 = chamferFaces[i].length - 1;
        var lastN2 = chamferFaces[j].length - 1;
        chamferFaces.push([
          chamferFaces[i][m],
          chamferFaces[j][(n + lastN2 - 1) % lastN2],
          chamferFaces[j][n],
          chamferFaces[i][(m + 1) % lastM2],
          -1 // edge/bevel face
        ]);
      }
    }
  }

  // Create corner faces (beveled vertices)
  for (var i = 0; i < cornerFaces.length; i++) {
    var cf = cornerFaces[i];
    var faceIndices = [];
    var vertIndices = [];
    for (var m = 0; m < cf.length; m++) {
      var encoded = cf[m] - 100;
      var fIdx = Math.floor(encoded / 100);
      var vIdx = encoded % 100;
      faceIndices.push(fIdx);
      vertIndices.push(vIdx);
    }

    if (faceIndices.length > 2) {
      // Build adjacency graph: two faces are adjacent at this corner
      // if they share an EDGE (2+ vertices in common), not just vertex i
      var adj = {};
      for (var m = 0; m < faceIndices.length; m++) adj[m] = [];
      for (var m = 0; m < faceIndices.length; m++) {
        for (var n = m + 1; n < faceIndices.length; n++) {
          var fm = faces[faceIndices[m]];
          var fn = faces[faceIndices[n]];
          var fmLen = fm.length - 1;
          var fnLen = fn.length - 1;
          var sharedVerts = 0;
          for (var a = 0; a < fmLen; a++) {
            for (var b = 0; b < fnLen; b++) {
              if (fm[a] === fn[b]) sharedVerts++;
            }
          }
          if (sharedVerts >= 2) {
            adj[m].push(n);
            adj[n].push(m);
          }
        }
      }

      // Walk adjacency chain to get correct polygon vertex order
      var ordered = [0];
      var visited = {};
      visited[0] = true;
      while (ordered.length < faceIndices.length) {
        var last = ordered[ordered.length - 1];
        var found = false;
        for (var k = 0; k < adj[last].length; k++) {
          var next = adj[last][k];
          if (!visited[next]) {
            ordered.push(next);
            visited[next] = true;
            found = true;
            break;
          }
        }
        if (!found) {
          for (var k = 0; k < faceIndices.length; k++) {
            if (!visited[k]) { ordered.push(k); visited[k] = true; }
          }
          break;
        }
      }

      var cornerFace = [];
      for (var m = 0; m < ordered.length; m++) {
        cornerFace.push(chamferFaces[faceIndices[ordered[m]]][vertIndices[ordered[m]]]);
      }
      cornerFace.push(-1); // bevel material
      chamferFaces.push(cornerFace);
    }
  }

  return { vectors: chamferVectors, faces: chamferFaces };
}

/* ── Normalize vectors to unit sphere ── */
function normalizeVectors(vectors) {
  for (var i = 0; i < vectors.length; i++) {
    var len = Math.sqrt(vectors[i][0] * vectors[i][0] +
                         vectors[i][1] * vectors[i][1] +
                         vectors[i][2] * vectors[i][2]);
    if (len > 0) {
      vectors[i][0] /= len;
      vectors[i][1] /= len;
      vectors[i][2] /= len;
    }
  }
}

/* ── Build Three.js BufferGeometry from chamfered data ── */
function buildGeometry(chamferedData, radius, tab, af, materialCount, isD10) {
  var vectors = chamferedData.vectors;
  var faces = chamferedData.faces;

  var positions = [];
  var normals = [];
  var uvs = [];
  var groups = [];
  var vertIndex = 0;

  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    var fl = face.length - 1; // exclude material index
    var matIdx = face[fl];    // material index

    if (fl < 3) continue;

    // Calculate face normal
    var a = vectors[face[0]];
    var b = vectors[face[1]];
    var c = vectors[face[2]];
    var ab = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    var ac = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    var nx = ab[1]*ac[2] - ab[2]*ac[1];
    var ny = ab[2]*ac[0] - ab[0]*ac[2];
    var nz = ab[0]*ac[1] - ab[1]*ac[0];
    var nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (nLen > 0) { nx /= nLen; ny /= nLen; nz /= nLen; }

    // Fan triangulation
    var startVert = vertIndex;
    for (var j = 0; j < fl - 2; j++) {
      var v0 = vectors[face[0]];
      var v1 = vectors[face[j + 1]];
      var v2 = vectors[face[j + 2]];

      positions.push(v0[0]*radius, v0[1]*radius, v0[2]*radius);
      positions.push(v1[0]*radius, v1[1]*radius, v1[2]*radius);
      positions.push(v2[0]*radius, v2[1]*radius, v2[2]*radius);

      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);

      // UV mapping
      if (matIdx >= 0 && !isD10) {
        // Standard polar UV mapping for regular polyhedra
        var aa = Math.PI * 2 / fl;
        for (var k = 0; k < 3; k++) {
          var vIdx = (k === 0) ? 0 : j + k;
          var u = (Math.cos(aa * vIdx + af) + 1 + tab) / 2 / (1 + tab);
          var v = (Math.sin(aa * vIdx + af) + 1 + tab) / 2 / (1 + tab);
          uvs.push(u, v);
        }
      } else if (matIdx >= 0 && isD10) {
        // D10 kite UV mapping for quad faces
        // Kite shape: v0=bottom tip, v1=right wing, v2=top tip, v3=left wing
        // Fan tri 0: v0, v1, v2 | Fan tri 1: v0, v2, v3
        if (j === 0) {
          uvs.push(0.5, 0.9);    // v0 — bottom tip
          uvs.push(0.85, 0.5);   // v1 — right wing
          uvs.push(0.5, 0.1);    // v2 — top tip (pole)
        } else {
          uvs.push(0.5, 0.9);    // v0 — bottom tip
          uvs.push(0.5, 0.1);    // v2 — top tip (pole)
          uvs.push(0.15, 0.5);   // v3 — left wing
        }
      } else {
        // Bevel face — minimal UV
        uvs.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
      }

      vertIndex += 3;
    }

    // Add group for this face (material index)
    var triCount = fl - 2;
    if (matIdx >= 0) {
      groups.push({ start: startVert, count: triCount * 3, materialIndex: matIdx - 1 });
    } else {
      groups.push({ start: startVert, count: triCount * 3, materialIndex: materialCount });
    }
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  geo.clearGroups();
  for (var i = 0; i < groups.length; i++) {
    geo.addGroup(groups[i].start, groups[i].count, groups[i].materialIndex);
  }

  return geo;
}

/* ── Build cannon-es ConvexPolyhedron from vertices/faces ── */
function buildPhysicsShape(diceConfig, CANNON) {
  var verts = diceConfig.vertices;
  var faces = diceConfig.faces;
  var radius = diceConfig.radius;

  // Normalize vertices
  var normVerts = [];
  for (var i = 0; i < verts.length; i++) {
    var v = verts[i];
    var len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    normVerts.push([v[0]/len, v[1]/len, v[2]/len]);
  }

  var cannonVerts = normVerts.map(function(v) {
    return new CANNON.Vec3(v[0] * radius, v[1] * radius, v[2] * radius);
  });

  // Strip material indices from faces
  var cannonFaces = faces.map(function(f) {
    return f.slice(0, f.length - 1);
  });

  return new CANNON.ConvexPolyhedron({ vertices: cannonVerts, faces: cannonFaces });
}

/* ── Public API: Create dice geometry (clean polyhedron, no chamfer gaps) ── */
function createDiceGeometry(diceType) {
  var config = DICE_GEOM[diceType];
  if (!config) throw new Error('Unknown dice type: ' + diceType);

  // Deep copy and normalize vertices to unit sphere
  var vertices = config.vertices.map(function(v) { return [v[0], v[1], v[2]]; });
  normalizeVectors(vertices);

  var radius = config.radius * config.scaleFactor;
  var faces = config.faces;
  var isD10 = config.isD10 || false;
  var tab = config.tab;
  var af = config.af;

  var positions = [];
  var normals = [];
  var uvs = [];
  var groups = [];
  var vertIndex = 0;

  for (var i = 0; i < faces.length; i++) {
    var face = faces[i];
    var fl = face.length - 1; // last element is material index
    var matIdx = face[fl];
    if (fl < 3 || matIdx <= 0) continue;

    // Get scaled face vertices
    var fv = [];
    for (var j = 0; j < fl; j++) {
      var v = vertices[face[j]];
      fv.push([v[0] * radius, v[1] * radius, v[2] * radius]);
    }

    // Compute face normal
    var ab = [fv[1][0]-fv[0][0], fv[1][1]-fv[0][1], fv[1][2]-fv[0][2]];
    var ac = [fv[2][0]-fv[0][0], fv[2][1]-fv[0][1], fv[2][2]-fv[0][2]];
    var nx = ab[1]*ac[2] - ab[2]*ac[1];
    var ny = ab[2]*ac[0] - ab[0]*ac[2];
    var nz = ab[0]*ac[1] - ab[1]*ac[0];
    var nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
    if (nLen > 0) { nx /= nLen; ny /= nLen; nz /= nLen; }

    // Fan triangulation
    var startVert = vertIndex;
    for (var j = 0; j < fl - 2; j++) {
      positions.push(fv[0][0], fv[0][1], fv[0][2]);
      positions.push(fv[j+1][0], fv[j+1][1], fv[j+1][2]);
      positions.push(fv[j+2][0], fv[j+2][1], fv[j+2][2]);
      normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);

      // UV mapping
      if (!isD10) {
        var aa = Math.PI * 2 / fl;
        for (var k = 0; k < 3; k++) {
          var vIdx = (k === 0) ? 0 : j + k;
          var u = (Math.cos(aa * vIdx + af) + 1 + tab) / 2 / (1 + tab);
          var vv = (Math.sin(aa * vIdx + af) + 1 + tab) / 2 / (1 + tab);
          uvs.push(u, vv);
        }
      } else {
        // D10 kite UV mapping
        if (j === 0) {
          uvs.push(0.5, 0.9, 0.85, 0.5, 0.5, 0.1);
        } else {
          uvs.push(0.5, 0.9, 0.5, 0.1, 0.15, 0.5);
        }
      }
      vertIndex += 3;
    }

    groups.push({ start: startVert, count: (fl - 2) * 3, materialIndex: matIdx - 1 });
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.clearGroups();
  for (var i = 0; i < groups.length; i++) {
    geo.addGroup(groups[i].start, groups[i].count, groups[i].materialIndex);
  }

  return { geometry: geo, config: config };
}

/* ── Texture rotation corrections per die type ── */
var TEXTURE_ROTATION = {
  d4: 0,
  d6: 0,
  d8: -7.5,
  d10: -6,
  d100: -6,
  d12: 5,
  d20: -7.5
};

// Export for use by dice-roller.js
window.DiceGeometry = {
  DICE_GEOM: DICE_GEOM,
  TEXTURE_ROTATION: TEXTURE_ROTATION,
  createDiceGeometry: createDiceGeometry,
  buildPhysicsShape: buildPhysicsShape,
  chamferGeom: chamferGeom,
  normalizeVectors: normalizeVectors
};
