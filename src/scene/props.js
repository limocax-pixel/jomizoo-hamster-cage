// Furniture: wheel, hide, sand bath and water bowl. Each builder returns a group whose origin
// is the centre of its footprint at the bottom, plus its footprint size for layout.
import * as THREE from 'three';
import { WHEEL_STAND_CM } from '../calc.js';

const shadowed = (mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

/** Solid-surface wheel facing the front (+z), standing on a small base. */
export function buildWheel(diameterCm, materials, { fits = true } = {}) {
  const r = diameterCm / 2;
  const width = Math.min(10, Math.max(5, diameterCm * 0.3));
  const cy = WHEEL_STAND_CM + r;
  const g = new THREE.Group();
  g.name = 'wheel';
  const body = fits ? materials.wheel : materials.wheelBad;

  const drum = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 72, 1, true), body));
  drum.rotation.x = Math.PI / 2;
  drum.position.set(0, cy, 0);
  g.add(drum);

  const back = shadowed(new THREE.Mesh(new THREE.CircleGeometry(r, 72), materials.wheelBack));
  back.position.set(0, cy, -width / 2);
  g.add(back);

  const lip = shadowed(new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 10, 72), body));
  lip.position.set(0, cy, width / 2);
  g.add(lip);

  const hub = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, 1.2, 24), materials.wheelBack));
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, cy, -width / 2 - 0.6);
  g.add(hub);

  const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(Math.max(2, r * 0.16), cy, 1.4), materials.wheelStand));
  post.position.set(0, cy / 2, -width / 2 - 1.4);
  g.add(post);

  const foot = shadowed(new THREE.Mesh(new THREE.BoxGeometry(r * 1.1, 0.9, width + 3.4), materials.wheelStand));
  foot.position.set(0, 0.45, -0.8);
  g.add(foot);

  return { group: g, footprint: { x: diameterCm, z: width + 3.4 }, height: cy + r };
}

/** Wooden multi-chamber hide sized to the hamster. */
export function buildHide(bodyCm, materials) {
  const L = bodyCm * 1.9;
  const W = bodyCm * 1.15;
  const H = bodyCm * 0.75;
  const g = new THREE.Group();
  g.name = 'hide';
  const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(L, H, W), materials.hide));
  body.position.y = H / 2;
  g.add(body);
  const roof = shadowed(new THREE.Mesh(new THREE.BoxGeometry(L + 1.4, Math.max(0.8, bodyCm * 0.07), W + 1.4), materials.hideRoof));
  roof.position.y = H + roof.geometry.parameters.height / 2;
  g.add(roof);
  const doorR = bodyCm * 0.24;
  for (const [x, z, ry] of [[-L * 0.22, W / 2 + 0.02, 0], [L / 2 + 0.02, -W * 0.1, Math.PI / 2]]) {
    const door = new THREE.Mesh(new THREE.CircleGeometry(doorR, 32), materials.hole);
    door.position.set(x, doorR + 0.3, z);
    door.rotation.y = ry;
    g.add(door);
  }
  return { group: g, footprint: { x: L + 1.4, z: W + 1.4 }, height: H };
}

/** Open ceramic dish filled with sand. */
export function buildSandBath(lengthCm, widthCm, materials) {
  const H = Math.max(3.5, Math.min(6, widthCm * 0.3));
  const t = 0.8;
  const g = new THREE.Group();
  g.name = 'sand-bath';
  const walls = [
    [lengthCm, H, t, 0, H / 2, widthCm / 2 - t / 2],
    [lengthCm, H, t, 0, H / 2, -widthCm / 2 + t / 2],
    [t, H, widthCm - 2 * t, lengthCm / 2 - t / 2, H / 2, 0],
    [t, H, widthCm - 2 * t, -lengthCm / 2 + t / 2, H / 2, 0],
    [lengthCm, t, widthCm, 0, t / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of walls) {
    const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.ceramic));
    mesh.position.set(x, y, z);
    g.add(mesh);
  }
  const sandH = H * 0.7;
  const sand = shadowed(new THREE.Mesh(new THREE.BoxGeometry(lengthCm - 2 * t, sandH, widthCm - 2 * t), materials.sand));
  sand.position.y = t + sandH / 2;
  g.add(sand);
  return { group: g, footprint: { x: lengthCm, z: widthCm }, height: H };
}

/** Heavy ceramic water bowl. */
export function buildBowl(diameterCm, materials) {
  const r = diameterCm / 2;
  const h = Math.max(2.5, diameterCm * 0.38);
  const profile = [
    [0, 0],
    [r * 0.82, 0],
    [r * 0.97, h * 0.35],
    [r, h],
    [r * 0.86, h],
    [r * 0.76, h * 0.3],
    [0, h * 0.3],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.Group();
  g.name = 'bowl';
  const bowl = shadowed(new THREE.Mesh(new THREE.LatheGeometry(profile, 48), materials.bowl));
  g.add(bowl);
  const water = new THREE.Mesh(new THREE.CircleGeometry(r * 0.84, 40), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = h * 0.78;
  g.add(water);
  return { group: g, footprint: { x: diameterCm, z: diameterCm }, height: h };
}
