// Enclosure builders. The inside floor is always at y = 0; walls/bottoms extend below it by
// `floorOffset`. x = length, z = width (front is +z), y = height. Units: cm.
import * as THREE from 'three';

function box(w, h, d, material, x, y, z, { cast = false, receive = false } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

/** Four bars forming a rectangular ring just outside an L × W opening. */
function ring(group, L, W, y, height, thickness, material, opts) {
  const t = thickness;
  group.add(box(L + 2 * t, height, t, material, 0, y, W / 2 + t / 2, opts));
  group.add(box(L + 2 * t, height, t, material, 0, y, -W / 2 - t / 2, opts));
  group.add(box(t, height, W, material, L / 2 + t / 2, y, 0, opts));
  group.add(box(t, height, W, material, -L / 2 - t / 2, y, 0, opts));
}

/** Open-top box of panels around the interior L × W × H (bottom below y = 0). */
function panels(group, L, W, H, t, material, { front = material, opts } = {}) {
  group.add(box(L + 2 * t, t, W + 2 * t, material, 0, -t / 2, 0, opts));
  group.add(box(L + 2 * t, H, t, front, 0, H / 2, W / 2 + t / 2, opts));
  group.add(box(L + 2 * t, H, t, material, 0, H / 2, -W / 2 - t / 2, opts));
  group.add(box(t, H, W, material, L / 2 + t / 2, H / 2, 0, opts));
  group.add(box(t, H, W, material, -L / 2 - t / 2, H / 2, 0, opts));
}

function glassEdges(L, W, H, t, material) {
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L + 2 * t, H + t, W + 2 * t)), material);
  edges.position.y = (H - t) / 2;
  return edges;
}

function buildTank(g, { lengthCm: L, widthCm: W, heightCm: H }, m) {
  const t = 0.6;
  panels(g, L, W, H, t, m.glass);
  g.add(glassEdges(L, W, H, t, m.glassEdge));
  // Black aquarium trims at top and bottom.
  ring(g, L + 2 * t, W + 2 * t, 1.1, 2.2, 1.1, m.trim);
  ring(g, L + 2 * t, W + 2 * t, H - 1.1, 2.2, 1.1, m.trim);
  return t;
}

function buildBin(g, { lengthCm: L, widthCm: W, heightCm: H }, m) {
  const t = 0.5;
  panels(g, L, W, H, t, m.binPlastic);
  g.add(glassEdges(L, W, H, t, m.binEdge));
  // Moulded lip around the rim.
  ring(g, L + 2 * t, W + 2 * t, H - 0.9, 1.8, 1.6, m.binLip, { cast: true });
  return t;
}

function buildWood(g, { lengthCm: L, widthCm: W, heightCm: H }, m) {
  const t = 1.8;
  const opts = { cast: true, receive: true };
  g.add(box(L + 2 * t, t, W + 2 * t, m.wood, 0, -t / 2, 0, opts));
  g.add(box(L + 2 * t, H, t, m.wood, 0, H / 2, -W / 2 - t / 2, opts));
  g.add(box(t, H, W + t, m.wood, L / 2 + t / 2, H / 2, -t / 2, opts));
  g.add(box(t, H, W + t, m.wood, -L / 2 - t / 2, H / 2, -t / 2, opts));
  // Acrylic front panel.
  const front = box(L, H, 0.5, m.glass, 0, H / 2, W / 2 + 0.25);
  g.add(front);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, 0.5)), m.glassEdge);
  edges.position.set(0, H / 2, W / 2 + 0.25);
  g.add(edges);
  return t;
}

function buildWire(g, { lengthCm: L, widthCm: W, heightCm: H, baseHeightCm }, m, barSpacingCm) {
  const t = 0.8;
  const base = Math.min(baseHeightCm, H);
  panels(g, L, W, base, t, m.wireBase, { opts: { cast: true } });
  ring(g, L + 2 * t, W + 2 * t, base - 0.6, 1.2, 0.9, m.wireBaseRim, { cast: true });

  const barHeight = H - base;
  if (barHeight <= 0.5) return t;
  // Draw bars a little further apart than real spacing when there would be very many of them.
  const spacing = Math.max(barSpacingCm, 1.1, (L + W) / 180);
  const inset = 0.2;
  const xs = [];
  for (let x = -L / 2; x <= L / 2 + 1e-6; x += (L / Math.round(L / spacing))) xs.push(x);
  const zs = [];
  for (let z = -W / 2; z <= W / 2 + 1e-6; z += (W / Math.round(W / spacing))) zs.push(z);

  const positions = [];
  for (const x of xs) positions.push([x, W / 2 + inset], [x, -W / 2 - inset]);
  for (const z of zs.slice(1, -1)) positions.push([L / 2 + inset, z], [-L / 2 - inset, z]);

  const bar = new THREE.CylinderGeometry(0.13, 0.13, barHeight, 6);
  const bars = new THREE.InstancedMesh(bar, m.wire, positions.length + xs.length);
  const matrix = new THREE.Matrix4();
  positions.forEach(([x, z], i) => {
    matrix.makeTranslation(x, base + barHeight / 2, z);
    bars.setMatrixAt(i, matrix);
  });
  // Roof bars run along the width, one per column.
  const roofRot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const roofScale = new THREE.Matrix4().makeScale(1, (W + 2 * inset) / barHeight, 1);
  xs.forEach((x, i) => {
    matrix.makeTranslation(x, H, 0).multiply(roofRot).multiply(roofScale);
    bars.setMatrixAt(positions.length + i, matrix);
  });
  bars.castShadow = true;
  g.add(bars);

  // Frame rails around the top and just above the base.
  const rail = (length, x, y, z, alongX) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, length, 8), m.wire);
    mesh.position.set(x, y, z);
    mesh.rotation.z = alongX ? Math.PI / 2 : 0;
    if (!alongX) mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    g.add(mesh);
  };
  for (const y of [base + 0.4, H]) {
    rail(L + 0.8, 0, y, W / 2 + inset, true);
    rail(L + 0.8, 0, y, -W / 2 - inset, true);
    rail(W + 0.8, L / 2 + inset, y, 0, false);
    rail(W + 0.8, -L / 2 - inset, y, 0, false);
  }
  return t;
}

/**
 * @returns {{ group: THREE.Group, floorOffset: number }}
 */
export function buildEnclosure(enclosure, materials, { barSpacingCm = 1 } = {}) {
  const group = new THREE.Group();
  group.name = 'enclosure';
  let floorOffset;
  switch (enclosure.type) {
    case 'bin':
      floorOffset = buildBin(group, enclosure, materials);
      break;
    case 'wood':
      floorOffset = buildWood(group, enclosure, materials);
      break;
    case 'wire':
      floorOffset = buildWire(group, enclosure, materials, barSpacingCm);
      break;
    default:
      floorOffset = buildTank(group, enclosure, materials);
  }
  return { group, floorOffset };
}
