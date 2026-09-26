// Furniture layout: item sizes, automatic placement and user-arranged positions (dragged in the
// 3D view and stored in the share link). Pure, so the checks and the 3D scene agree on where
// everything is. Scene coordinates: x along the length, z front (+) to back (−), centred; cm.
import { clamp, depthAt } from './profile.js';

/** Items in placement order. */
export const ITEM_KEYS = ['wheel', 'sand', 'hide', 'bowl', 'hamster'];

/** Typical head-and-body length (cm) for the model, hide and tunnels. Presentation only. */
const BODY_CM = { syrian: 16, campbell: 9, 'winter-white': 8.5, 'hybrid-dwarf': 9, roborovski: 5, chinese: 10 };
export const bodyCm = (speciesId) => BODY_CM[speciesId] ?? 10;

const WALL_GAP = 1.5;
const ITEM_GAP = 1;
const SCAN_STEP = 1.5;

export const wheelWidthCm = (diameterCm) => Math.min(10, Math.max(5, diameterCm * 0.3));
export const bowlSizeCm = (body) => Math.min(10, Math.max(6, body * 0.55));
export const hideSizeCm = (body) => ({ x: body * 1.9, z: body * 1.15, y: body * 0.75 });

/** Footprints (unrotated, cm) of each item. */
export function itemSizes(state, species) {
  const body = bodyCm(species.id);
  const d = state.wheel.diameterCm;
  const sand = species.sandBath ?? { minLengthCm: body * 1.6, minWidthCm: body * 1.15 };
  const hide = hideSizeCm(body);
  const bowl = bowlSizeCm(body);
  return {
    wheel: { x: d, z: wheelWidthCm(d) + 3.4 },
    sand: { x: sand.minLengthCm, z: sand.minWidthCm },
    hide: { x: hide.x + 1.4, z: hide.z + 1.4 },
    bowl: { x: bowl, z: bowl },
    hamster: { x: body * 0.8, z: body * 1.15 },
  };
}

const rotated = (size, r) => (r % 2 ? { x: size.z, z: size.x } : size);

/** Keep an item's centre so its footprint stays inside the enclosure (centred if it can't fit). */
export function clampToEnclosure(x, z, fx, fz, L, W) {
  const maxX = L / 2 - fx / 2 - WALL_GAP;
  const maxZ = W / 2 - fz / 2 - WALL_GAP;
  return { x: maxX > 0 ? clamp(x, -maxX, maxX) : 0, z: maxZ > 0 ? clamp(z, -maxZ, maxZ) : 0 };
}

export function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.fx + b.fx) / 2 + ITEM_GAP && Math.abs(a.z - b.z) < (a.fz + b.fz) / 2 + ITEM_GAP;
}

const collides = (taken, item) => taken.some((other) => other.key !== item.key && overlaps(item, other));

/** First free spot scanning left to right along preferred rows (back wall, front wall, middle). */
function findSpot(taken, key, fx, fz, rows, L, W) {
  for (const row of rows) {
    const z = row === 'back' ? -W / 2 + WALL_GAP + fz / 2 : row === 'front' ? W / 2 - WALL_GAP - fz / 2 : 0;
    if (Math.abs(z) + fz / 2 > W / 2) continue;
    for (let x = -L / 2 + WALL_GAP + fx / 2; x <= L / 2 - WALL_GAP - fx / 2 + 1e-9; x += SCAN_STEP) {
      if (!collides(taken, { key, x, z, fx, fz })) return { x, z };
    }
  }
  return null;
}

/** Nearest free spot to (x, z), searching outwards in rings. */
function nearestFree(taken, key, x, z, fx, fz, L, W) {
  const maxR = Math.hypot(L, W);
  for (let r = SCAN_STEP; r <= maxR; r += SCAN_STEP) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / SCAN_STEP));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const p = clampToEnclosure(x + Math.cos(a) * r, z + Math.sin(a) * r, fx, fz, L, W);
      if (!collides(taken, { key, ...p, fx, fz })) return p;
    }
  }
  return null;
}

const ROWS = {
  wheel: ['back', 'front'],
  sand: ['front', 'back', 'mid'],
  hide: ['back', 'front', 'mid'],
  bowl: ['front', 'mid', 'back'],
  hamster: ['front', 'mid', 'back'],
};

/** Average bedding height under an item's footprint. */
export function surfaceUnder(x, fx, state) {
  const { lengthCm: L } = state.enclosure;
  let sum = 0;
  for (let i = 0; i <= 4; i++) sum += depthAt((x - fx / 2 + (fx * i) / 4 + L / 2) / L, state.bedding, L);
  return sum / 5;
}

/**
 * Final positions: items the user arranged keep their spot (clamped, nudged if they now overlap),
 * the rest are placed automatically. Items that don't fit anywhere are left out.
 * @returns {Record<string, {key, x, z, r, fx, fz, y}>}
 */
export function computeLayout(state, species) {
  const { lengthCm: L, widthCm: W } = state.enclosure;
  const sizes = itemSizes(state, species);
  const user = state.layout ?? {};
  const placed = {};
  const taken = [];

  for (const key of ITEM_KEYS) {
    const saved = user[key];
    if (!saved) continue;
    const r = saved.r & 3;
    const { x: fx, z: fz } = rotated(sizes[key], r);
    let p = clampToEnclosure(-L / 2 + saved.u * L, -W / 2 + saved.v * W, fx, fz, L, W);
    if (collides(taken, { key, ...p, fx, fz })) p = nearestFree(taken, key, p.x, p.z, fx, fz, L, W) ?? p;
    placed[key] = { key, ...p, r, fx, fz };
    taken.push(placed[key]);
  }
  for (const key of ITEM_KEYS) {
    if (placed[key]) continue;
    const { x: fx, z: fz } = sizes[key];
    const spot = findSpot(taken, key, fx, fz, ROWS[key], L, W);
    if (!spot) continue;
    placed[key] = { key, ...spot, r: 0, fx, fz };
    taken.push(placed[key]);
  }
  for (const item of Object.values(placed)) item.y = surfaceUnder(item.x, item.fx, state);
  return placed;
}

/** Positions as fractions of the enclosure (what the state and share links store). */
export function toUserLayout(layout, state) {
  const { lengthCm: L, widthCm: W } = state.enclosure;
  const out = {};
  for (const item of Object.values(layout)) {
    out[item.key] = { u: (item.x + L / 2) / L, v: (item.z + W / 2) / W, r: item.r };
  }
  return out;
}

/** Try to move an item; slides along one axis when blocked. Returns the new position or null. */
export function tryMove(layout, key, x, z, state) {
  const { lengthCm: L, widthCm: W } = state.enclosure;
  const item = layout[key];
  const others = Object.values(layout).filter((o) => o.key !== key);
  const candidates = [
    clampToEnclosure(x, z, item.fx, item.fz, L, W),
    clampToEnclosure(x, item.z, item.fx, item.fz, L, W),
    clampToEnclosure(item.x, z, item.fx, item.fz, L, W),
  ];
  for (const p of candidates) {
    if (!collides(others, { key, ...p, fx: item.fx, fz: item.fz })) return p;
  }
  return null;
}

/** Try a quarter turn in place (nudged to the nearest free spot if needed). */
export function tryRotate(layout, key, state) {
  const { lengthCm: L, widthCm: W } = state.enclosure;
  const item = layout[key];
  const others = Object.values(layout).filter((o) => o.key !== key);
  const fx = item.fz;
  const fz = item.fx;
  let p = clampToEnclosure(item.x, item.z, fx, fz, L, W);
  if (collides(others, { key, ...p, fx, fz })) p = nearestFree(others, key, p.x, p.z, fx, fz, L, W);
  return p ? { ...p, r: (item.r + 1) % 4, fx, fz } : null;
}

// Share-link encoding: "u.v.r" per item in ITEM_KEYS order (u, v in thousandths), "-" = automatic.
export function encodeLayout(userLayout) {
  if (!userLayout) return null;
  return ITEM_KEYS.map((key) => {
    const p = userLayout[key];
    return p ? `${Math.round(p.u * 1000)}.${Math.round(p.v * 1000)}.${p.r & 3}` : '-';
  }).join('_');
}

export function decodeLayout(text) {
  if (!text) return null;
  const parts = text.split('_');
  if (parts.length !== ITEM_KEYS.length) return null;
  const out = {};
  parts.forEach((part, i) => {
    const m = /^(\d{1,4})\.(\d{1,4})\.([0-3])$/.exec(part);
    if (m) out[ITEM_KEYS[i]] = { u: clamp(Number(m[1]) / 1000, 0, 1), v: clamp(Number(m[2]) / 1000, 0, 1), r: Number(m[3]) };
  });
  return Object.keys(out).length ? out : null;
}

/** Drop invalid entries from a user layout. */
export function normalizeLayout(userLayout) {
  if (!userLayout || typeof userLayout !== 'object') return null;
  const out = {};
  for (const key of ITEM_KEYS) {
    const p = userLayout[key];
    if (p && Number.isFinite(p.u) && Number.isFinite(p.v)) {
      out[key] = { u: clamp(p.u, 0, 1), v: clamp(p.v, 0, 1), r: (Number(p.r) || 0) & 3 };
    }
  }
  return Object.keys(out).length ? out : null;
}
