// Procedural canvas textures: bedding, the burrow cross-section seen through the glass, wood and sand.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const LOOK_PALETTES = {
  'paper-natural': {
    base: '#e2d3b8',
    light: ['#f7efe0', '#efe3cc', '#eadcc1'],
    dark: ['#cdb993', '#c0aa82'],
    shape: 'flake',
  },
  'paper-white': {
    base: '#ebe8e1',
    light: ['#ffffff', '#f8f6f1', '#f2efe8'],
    dark: ['#d5d0c5', '#c9c3b7'],
    shape: 'flake',
  },
  aspen: {
    base: '#dcc393',
    light: ['#f0dfb6', '#e9d4a2', '#f5e7c4'],
    dark: ['#c4a56a', '#b8975b'],
    shape: 'chip',
  },
};

const palette = (look) => LOOK_PALETTES[look] ?? LOOK_PALETTES['paper-natural'];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toTexture(canvas, { repeat = false, anisotropy = 1 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function flake(ctx, rand, x, y, size, squash) {
  const n = 5 + Math.floor(rand() * 4);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand() * 0.6;
    const r = size * (0.5 + rand() * 0.65);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r * squash * (0.6 + rand() * 0.5);
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function chip(ctx, rand, x, y, size, squash) {
  const len = size * (2.2 + rand() * 1.8);
  const wid = size * (0.45 + rand() * 0.35);
  const rot = squash < 1 ? (rand() - 0.5) * 0.7 : rand() * Math.PI;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  ctx.ellipse(0, 0, len / 2, wid / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha *= 0.35;
  ctx.strokeStyle = '#8a6a3c';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-len * 0.38, 0);
  ctx.lineTo(len * 0.38, 0);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paint speckled bedding. With `tile`, every shape near an edge is repeated on the
 * opposite side so the texture wraps seamlessly.
 */
function paintBedding(ctx, w, h, look, { density = 1, size = 1, squash = 1, tile = true, seed = 7 } = {}) {
  const pal = palette(look);
  const rand = mulberry32(seed);
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, w, h);

  // Large, faint blotches break up visible repetition.
  for (let i = 0; i < 26; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 30 + rand() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = rand() < 0.5 ? '120, 95, 60' : '255, 252, 245';
    g.addColorStop(0, `rgba(${tone}, 0.07)`);
    g.addColorStop(1, `rgba(${tone}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const draw = pal.shape === 'chip' ? chip : flake;
  const count = Math.round(((w * h) / 150) * density);
  const offsets = tile ? [-1, 0, 1] : [0];
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const dark = rand() < 0.38;
    const colors = dark ? pal.dark : pal.light;
    const s = (4 + rand() * 9) * size;
    const alpha = 0.55 + rand() * 0.45;
    const shapeSeed = Math.floor(rand() * 2 ** 31);
    const color = colors[Math.floor(rand() * colors.length)];
    for (const ox of offsets) {
      for (const oy of offsets) {
        const cx = x + ox * w;
        const cy = y + oy * h;
        if (cx < -s * 3 || cx > w + s * 3 || cy < -s * 3 || cy > h + s * 3) continue;
        const shapeRand = mulberry32(shapeSeed);
        if (!dark) {
          // soft contact shadow under light flakes gives the surface some depth
          ctx.globalAlpha = alpha * 0.35;
          ctx.fillStyle = 'rgb(110, 88, 60)';
          draw(ctx, mulberry32(shapeSeed), cx + s * 0.18, cy + s * 0.22, s, squash);
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        draw(ctx, shapeRand, cx, cy, s, squash);
      }
    }
  }
  ctx.globalAlpha = 1;
}

export function createBeddingTextures(look, anisotropy) {
  const top = makeCanvas(512, 512);
  paintBedding(top.getContext('2d'), 512, 512, look, { seed: 11 });
  const side = makeCanvas(512, 512);
  paintBedding(side.getContext('2d'), 512, 512, look, { seed: 23, size: 0.8, squash: 0.45, density: 1.4 });
  return {
    top: toTexture(top, { repeat: true, anisotropy }),
    side: toTexture(side, { repeat: true, anisotropy }),
  };
}

// ---------------------------------------------------------------------------
// Burrow cross-section (front face of the bedding, visible through the glass)
// ---------------------------------------------------------------------------

const TUNNEL = '#5b4835';
const TUNNEL_INNER = '#735d46';
const NEST = ['#fbf6ec', '#f3e9d6', '#efe2c9'];
const SEEDS = ['#c9a26b', '#8f6b3f', '#e3cf9c', '#7f9956', '#b5874f'];

// The compacted-bedding background is expensive to paint, so it is painted once per look
// and cropped for every rebuild (sliders rebuild the burrow texture continuously).
const faceBackgrounds = new Map();
function faceBackground(look) {
  if (!faceBackgrounds.has(look)) {
    const canvas = makeCanvas(1024, 1024);
    paintBedding(canvas.getContext('2d'), 1024, 1024, look, { seed: 31, size: 0.75, squash: 0.45, density: 1.5, tile: false });
    faceBackgrounds.set(look, canvas);
  }
  return faceBackgrounds.get(look);
}

/**
 * Paint the front face of the bedding as seen through the glass: compacted bedding with burrows
 * wherever it is deep enough. A shallow U-shaped tunnel with a nest pocket appears once the bedding
 * reaches the species minimum; a full burrow (entrance, nest chamber, food store, bolt hole)
 * appears where it reaches the burrowing depth.
 *
 * @param {object} o
 * @param {number} o.lengthCm       enclosure length
 * @param {number} o.heightCm       texture height in cm (max bedding depth + margin)
 * @param {(xCm:number)=>number} o.depthAtX  settled depth at x (cm from the left wall)
 * @param {Array<{x0:number,x1:number,kind:string}>} o.regions  standard / deep sections
 * @param {number} o.tunnelCm       tunnel diameter for this species
 * @param {number} o.minDepthCm     below this, no tunnels are drawn
 * @param {number} o.burrowDepthCm  at or above this, a full burrow is drawn
 * @returns {{ texture: THREE.CanvasTexture, chambers: Array<{kind:string, x:number, y:number}> }}
 */
export function createBurrowTexture({ lengthCm, heightCm, depthAtX, regions, tunnelCm, minDepthCm, burrowDepthCm, look, anisotropy }) {
  const cw = 1024;
  const ch = Math.round(Math.min(1024, Math.max(96, (cw * heightCm) / lengthCm)));
  const canvas = makeCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  const sx = cw / lengthCm;
  const sy = ch / heightCm;
  const X = (xCm) => xCm * sx;
  const Y = (yCm) => ch - yCm * sy; // yCm = height above the enclosure floor

  ctx.drawImage(faceBackground(look), 0, 0, cw, ch, 0, 0, cw, ch);
  // Bedding is more compacted (and a little darker) towards the bottom.
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, 'rgba(90, 70, 45, 0)');
  grad.addColorStop(1, 'rgba(90, 70, 45, 0.18)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const chambers = [];
  const rand = mulberry32(97);
  const td = tunnelCm;
  const lw = td * Math.min(sx, sy); // tunnel width in px

  // points: [start, control1, control2, end, control1, control2, end, ...] (cubic Bézier chain)
  const tunnel = (points, scale = 1) => {
    for (const [width, color] of [[lw * scale, TUNNEL], [lw * scale * 0.6, TUNNEL_INNER]]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(X(points[0][0]), Y(points[0][1]));
      for (let i = 1; i + 2 < points.length; i += 3) {
        const [c1, c2, p] = [points[i], points[i + 1], points[i + 2]];
        ctx.bezierCurveTo(X(c1[0]), Y(c1[1]), X(c2[0]), Y(c2[1]), X(p[0]), Y(p[1]));
      }
      ctx.stroke();
    }
  };

  const chamber = ({ x, y, rx, ry }) => {
    ctx.fillStyle = TUNNEL;
    ctx.beginPath();
    ctx.ellipse(X(x), Y(y), rx * sx, ry * sy, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TUNNEL_INNER;
    ctx.beginPath();
    ctx.ellipse(X(x), Y(y + ry * 0.1), rx * 0.8 * sx, ry * 0.7 * sy, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const nestMaterial = ({ x, y, rx, ry }) => {
    ctx.lineCap = 'round';
    for (let i = 0; i < 80; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.8;
      const px = X(x + Math.cos(a) * rx * r);
      const py = Y(y - ry * 0.15 + Math.sin(a) * ry * r * 0.75);
      const len = (0.5 + rand() * 1.1) * sx;
      const ang = rand() * Math.PI;
      ctx.strokeStyle = NEST[i % NEST.length];
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = Math.max(1.2, 0.16 * sx);
      ctx.beginPath();
      ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
      ctx.quadraticCurveTo(px, py + len * 0.4, px + Math.cos(ang) * len, py + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  const seeds = ({ x, y, rx, ry }) => {
    for (let i = 0; i < 42; i++) {
      const a = rand() * Math.PI;
      const r = Math.sqrt(rand()) * 0.78;
      ctx.fillStyle = SEEDS[i % SEEDS.length];
      ctx.beginPath();
      ctx.ellipse(
        X(x + Math.cos(a) * rx * r),
        Y(y - ry * 0.55 + Math.sin(a) * ry * r * 0.55),
        (0.3 + rand() * 0.2) * sx,
        (0.2 + rand() * 0.1) * sy,
        rand() * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  };

  // Shallow U-shaped tunnel with a nest pocket at the bottom.
  const shallow = (x0, x1) => {
    const D = Math.min(depthAtX(x0 + 1), depthAtX(x1 - 1));
    const bottom = Math.max(td * 0.8, D * 0.38);
    const zl = x1 - x0;
    const a = x0 + zl * 0.2;
    const b = x0 + zl * 0.8;
    const mid = (a + b) / 2;
    tunnel([
      [a, depthAtX(a) + 2],
      [a + zl * 0.03, bottom],
      [mid - zl * 0.14, bottom],
      [mid, bottom],
      [mid + zl * 0.14, bottom],
      [b - zl * 0.03, bottom],
      [b, depthAtX(b) + 2],
    ], 0.9);
    const pocket = { x: mid, y: bottom, rx: td * 1.3, ry: td * 0.78 };
    chamber(pocket);
    nestMaterial(pocket);
    chambers.push({ kind: 'nest', x: pocket.x, y: pocket.y });
  };

  // Full burrow: entrance on the slope/top, deep nest chamber, food store and a bolt hole.
  const full = (x0, x1) => {
    const zl = x1 - x0;
    const deepest = depthAtX(x1 - 1);
    const nest = { rx: Math.min(td * 1.9, zl * 0.24), ry: Math.min(td * 1.1, deepest * 0.2) };
    nest.x = x1 - Math.max(nest.rx + 2.5, zl * 0.3);
    nest.y = nest.ry + 1.8;
    const entry = x0 + zl * 0.16;
    const entryTop = depthAtX(entry);
    tunnel([
      [entry, entryTop + 2],
      [entry + zl * 0.03, entryTop * 0.45],
      [nest.x - nest.rx * 2.2, nest.y + nest.ry * 0.9],
      [nest.x - nest.rx * 0.7, nest.y + nest.ry * 0.1],
    ]);
    // Bolt hole straight up from the nest to the surface.
    const boltX = Math.min(x1 - td * 0.8, nest.x + nest.rx * 1.15);
    tunnel([
      [nest.x + nest.rx * 0.6, nest.y + nest.ry * 0.3],
      [boltX, nest.y + nest.ry],
      [boltX, depthAtX(boltX) * 0.7],
      [boltX + td * 0.2, depthAtX(boltX) + 2],
    ], 0.8);
    // Food store off the main tunnel, halfway down.
    const store = { rx: Math.min(td * 1.25, zl * 0.14), ry: td * 0.8 };
    store.x = (entry + nest.x) / 2 + td * 0.4;
    store.y = Math.min(depthAtX(store.x) - store.ry - td * 1.2, nest.y + nest.ry + store.ry + td * 1.4);
    const hasStore = store.y - store.ry > nest.y + nest.ry * 0.6 && store.x + store.rx < boltX - td;
    if (hasStore) {
      tunnel([
        [store.x - store.rx * 1.9, store.y + store.ry * 1.6],
        [store.x - store.rx * 1.6, store.y + store.ry * 0.6],
        [store.x - store.rx * 1.2, store.y],
        [store.x - store.rx * 0.5, store.y],
      ], 0.8);
      chamber(store);
      seeds(store);
      chambers.push({ kind: 'store', x: store.x, y: store.y });
    }
    chamber(nest);
    nestMaterial(nest);
    chambers.push({ kind: 'nest', x: nest.x, y: nest.y });
  };

  for (const region of regions) {
    const zl = region.x1 - region.x0;
    const deepest = Math.max(depthAtX(region.x0 + 1), depthAtX(region.x1 - 1));
    if (deepest >= burrowDepthCm && zl >= 3.4 * td) {
      full(region.x0, region.x1);
    } else if (deepest >= Math.max(minDepthCm, td * 2.2) && zl >= 4 * td) {
      shallow(region.x0, region.x1);
    }
  }

  return { texture: toTexture(canvas, { anisotropy }), chambers };
}

// ---------------------------------------------------------------------------
// Wood and sand
// ---------------------------------------------------------------------------

export function createWoodTexture(anisotropy) {
  const w = 512;
  const h = 512;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(5);
  ctx.fillStyle = '#dcc39a';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y0 = rand() * h;
    const amp = 2 + rand() * 6;
    const freq = 0.004 + rand() * 0.01;
    const phase = rand() * 10;
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(160, 118, 70, 0.22)' : 'rgba(245, 225, 190, 0.3)';
    ctx.lineWidth = 0.6 + rand() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin(x * freq * Math.PI * 2 + phase) * amp;
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(canvas, { repeat: true, anisotropy });
}

export function createSandTexture(anisotropy) {
  const canvas = makeCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(3);
  ctx.fillStyle = '#e4cf9f';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const tone = rand();
    ctx.fillStyle = tone < 0.4 ? 'rgba(176, 140, 88, 0.55)' : tone < 0.8 ? 'rgba(250, 238, 210, 0.7)' : 'rgba(140, 110, 70, 0.5)';
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
  return toTexture(canvas, { repeat: true, anisotropy });
}
