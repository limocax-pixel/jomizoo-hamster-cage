// A stylised hamster built from ellipsoids, coloured per species with vertex colours.
// Local axes: +z = nose direction, +y = up, origin between the feet on the ground. Units: cm.
import * as THREE from 'three';
import { smoothstep } from '../calc.js';

// Colours and typical head-and-body length (cm) used for the model. Presentation only; the
// published data (data/species.json) doesn't include body length.
const LOOKS = {
  syrian: { bodyCm: 16, back: '#d99a57', belly: '#f7ead7', stripe: null },
  campbell: { bodyCm: 9, back: '#a8927a', belly: '#f0e8dc', stripe: '#5b4c3d' },
  'winter-white': { bodyCm: 8.5, back: '#aaa69f', belly: '#f8f6f1', stripe: '#4e4944' },
  'hybrid-dwarf': { bodyCm: 9, back: '#a39a8e', belly: '#f4efe7', stripe: '#554d45' },
  roborovski: { bodyCm: 5, back: '#ddb47f', belly: '#fcf8f1', stripe: null, brows: true },
  chinese: { bodyCm: 10, back: '#8f7d6a', belly: '#ede4d7', stripe: '#4a3e34', slim: true, longTail: true },
};

export const modelBodyCm = (speciesId) => (LOOKS[speciesId] ?? LOOKS.syrian).bodyCm;

const tmp = new THREE.Color();

function colorize(geometry, look, { bellyBias = 0, stripe = true } = {}) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const back = new THREE.Color(look.back);
  const belly = new THREE.Color(look.belly);
  const dark = look.stripe ? new THREE.Color(look.stripe) : null;
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const bellyT = smoothstep(0.15 + bellyBias, -0.35 + bellyBias, ny);
    tmp.copy(back).lerp(belly, bellyT);
    if (dark && stripe) {
      const s = (1 - smoothstep(0.05, 0.13, Math.abs(nx))) * smoothstep(0.25, 0.6, ny) * (1 - smoothstep(0.55, 0.85, nz));
      tmp.lerp(dark, s * 0.85);
    }
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function buildHamster(speciesId, bodyCm, materials) {
  const look = LOOKS[speciesId] ?? LOOKS.syrian;
  const s = bodyCm;
  const slim = look.slim ? 0.86 : 1;
  const root = new THREE.Group();
  root.name = 'hamster';

  const furBlob = (rx, ry, rz, x, y, z, opts) => {
    const geometry = new THREE.SphereGeometry(1, 40, 28);
    colorize(geometry, look, opts); // colour from unit-sphere directions, then stretch
    geometry.scale(rx * s, ry * s, rz * s);
    const mesh = new THREE.Mesh(geometry, materials.fur);
    mesh.position.set(x * s, y * s, z * s);
    mesh.castShadow = true;
    return mesh;
  };
  const blob = (r, material, x, y, z, scale = [1, 1, 1]) => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r * s, 20, 14), material);
    mesh.scale.set(...scale);
    mesh.position.set(x * s, y * s, z * s);
    mesh.castShadow = true;
    return mesh;
  };

  const body = new THREE.Group();
  body.add(furBlob(0.34 * slim, 0.3 * slim, 0.33, 0, 0.29 * slim, -0.1));
  body.add(furBlob(0.27 * slim, 0.25 * slim, 0.27, 0, 0.27 * slim, 0.12));
  root.add(body);

  // Head pivots at the neck so it can look around.
  const head = new THREE.Group();
  head.position.set(0, 0.3 * s, 0.18 * s);
  const H = (x, y, z) => [x, y - 0.3, z - 0.18];
  head.add(furBlob(0.23, 0.21, 0.22, ...H(0, 0.34, 0.31)));
  head.add(furBlob(0.12, 0.1, 0.11, ...H(0.14, 0.26, 0.34), { bellyBias: 0.35, stripe: false }));
  head.add(furBlob(0.12, 0.1, 0.11, ...H(-0.14, 0.26, 0.34), { bellyBias: 0.35, stripe: false }));
  const snout = furBlob(0.1, 0.085, 0.1, ...H(0, 0.29, 0.47), { bellyBias: 0.25, stripe: false });
  head.add(snout);
  const nose = blob(0.028, materials.pink, ...H(0, 0.31, 0.565));
  head.add(nose);
  for (const side of [1, -1]) {
    head.add(blob(0.04, materials.eye, ...H(0.105 * side, 0.37, 0.47)));
    head.add(blob(0.012, materials.eyeShine, ...H(0.115 * side, 0.385, 0.505)));
    const ear = furBlob(0.075, 0.08, 0.03, ...H(0.15 * side, 0.5, 0.26), { stripe: false });
    ear.rotation.z = -0.35 * side;
    head.add(ear);
    const inner = blob(0.05, materials.pink, ...H(0.15 * side, 0.495, 0.285), [1, 1.1, 0.25]);
    inner.rotation.z = -0.35 * side;
    head.add(inner);
    if (look.brows) head.add(blob(0.045, materials.white, ...H(0.1 * side, 0.43, 0.445), [1.1, 0.5, 0.6]));
  }
  // Whiskers
  const whiskerPoints = [];
  for (const side of [1, -1]) {
    for (const [dy, len] of [[0.02, 0.26], [0, 0.3], [-0.02, 0.24]]) {
      whiskerPoints.push(new THREE.Vector3(0.05 * side * s, (0.29 - 0.3 + dy) * s, (0.5 - 0.18) * s));
      whiskerPoints.push(new THREE.Vector3((0.05 + len) * side * s, (0.29 - 0.3 + dy * 3) * s, (0.44 - 0.18) * s));
    }
  }
  head.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(whiskerPoints), materials.whisker));
  root.add(head);

  for (const side of [1, -1]) {
    root.add(blob(0.05, materials.pink, 0.09 * side, 0.03, 0.36, [0.9, 0.6, 1.2]));
    root.add(blob(0.065, materials.pink, 0.18 * side * slim, 0.03, -0.14, [0.9, 0.45, 1.4]));
  }
  if (look.longTail) {
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * s, 0.028 * s, 0.26 * s, 10), materials.pink);
    tail.position.set(0, 0.1 * s, -0.53 * s);
    tail.rotation.x = -1.2;
    tail.castShadow = true;
    root.add(tail);
  } else {
    root.add(blob(0.035, materials.pink, 0, 0.14, -0.43, [1, 1, 1.4]));
  }

  // Idle animation: breathing, sniffing and looking around.
  root.userData.tick = (t) => {
    const breath = 1 + Math.sin(t * 7) * 0.015;
    body.scale.set(1, breath, 1);
    const sniffing = t % 4 < 1.1;
    const sniff = sniffing ? 1 + Math.sin(t * 38) * 0.07 : 1;
    nose.scale.setScalar(sniff);
    snout.scale.set(1, 1, sniff);
    head.rotation.y = Math.sin(t * 0.55) * 0.35 + Math.sin(t * 1.7) * 0.05;
    head.rotation.x = Math.sin(t * 0.9) * 0.06;
  };
  return root;
}
