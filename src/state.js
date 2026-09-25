// Planner state: defaults, validation and (de)serialisation to the URL so setups can be shared.
// Pure module (no window access) so the build-time prerender can use it too.
import { clamp, fillLimitCm } from './calc.js';

export const ENCLOSURE_TYPES = ['tank', 'bin', 'wood', 'wire'];
export const BEDDING_LOOKS = ['paper-natural', 'paper-white', 'aspen'];

/** Input ranges, in cm unless noted. */
export const LIMITS = {
  lengthCm: [30, 240],
  widthCm: [20, 120],
  heightCm: [20, 120],
  baseHeightCm: [3, 60],
  depthCm: [2, 80],
  deepDepthCm: [5, 80],
  deepShare: [0.1, 0.6],
  wheelCm: [10, 40],
  allowance: [0, 1],
  packSizeL: [1, 200],
};

export function defaultState() {
  return {
    species: 'syrian',
    units: 'metric',
    enclosure: { type: 'tank', lengthCm: 100, widthCm: 50, heightCm: 60, baseHeightCm: 15 },
    bedding: {
      depthCm: 25,
      look: 'paper-natural',
      deepZone: { enabled: true, share: 0.3, depthCm: 40 },
      // Keepers report needing 1.5–2× the calculated volume once bedding is pressed down.
      allowance: 0.5,
      packSizeL: 20,
    },
    wheel: { diameterCm: 30 },
  };
}

const num = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** Clamp every value into range and keep bedding inside the enclosure. Mutates and returns `state`. */
export function normalize(state) {
  const { enclosure: e, bedding: b, wheel: w } = state;
  const d = defaultState();
  if (!ENCLOSURE_TYPES.includes(e.type)) e.type = d.enclosure.type;
  if (!BEDDING_LOOKS.includes(b.look)) b.look = d.bedding.look;
  if (state.units !== 'imperial') state.units = 'metric';

  e.lengthCm = clamp(num(e.lengthCm, d.enclosure.lengthCm), ...LIMITS.lengthCm);
  e.widthCm = clamp(num(e.widthCm, d.enclosure.widthCm), ...LIMITS.widthCm);
  e.heightCm = clamp(num(e.heightCm, d.enclosure.heightCm), ...LIMITS.heightCm);
  e.baseHeightCm = clamp(num(e.baseHeightCm, d.enclosure.baseHeightCm), ...LIMITS.baseHeightCm);

  const fill = fillLimitCm(e);
  b.depthCm = clamp(num(b.depthCm, d.bedding.depthCm), LIMITS.depthCm[0], Math.max(LIMITS.depthCm[0], fill));
  b.deepZone.enabled = Boolean(b.deepZone.enabled);
  b.deepZone.share = clamp(num(b.deepZone.share, d.bedding.deepZone.share), ...LIMITS.deepShare);
  b.deepZone.depthCm = clamp(
    num(b.deepZone.depthCm, d.bedding.deepZone.depthCm),
    Math.max(LIMITS.deepDepthCm[0], b.depthCm),
    Math.max(b.depthCm, fill),
  );
  b.allowance = clamp(num(b.allowance, d.bedding.allowance), ...LIMITS.allowance);
  b.packSizeL = clamp(num(b.packSizeL, d.bedding.packSizeL), ...LIMITS.packSizeL);
  w.diameterCm = clamp(num(w.diameterCm, d.wheel.diameterCm), ...LIMITS.wheelCm);
  return state;
}

const round1 = (v) => Math.round(v * 10) / 10;

export function stateToQuery(state) {
  const { enclosure: e, bedding: b, wheel: w } = state;
  const p = new URLSearchParams({
    sp: state.species,
    u: state.units === 'imperial' ? 'in' : 'cm',
    t: e.type,
    l: round1(e.lengthCm),
    w: round1(e.widthCm),
    h: round1(e.heightCm),
    d: round1(b.depthCm),
    dz: b.deepZone.enabled ? 1 : 0,
    ds: Math.round(b.deepZone.share * 100),
    dd: round1(b.deepZone.depthCm),
    wh: round1(w.diameterCm),
    a: Math.round(b.allowance * 100),
    p: round1(b.packSizeL),
    lk: b.look,
  });
  if (e.type === 'wire') p.set('b', round1(e.baseHeightCm));
  return p.toString();
}

/** Build a state from a query string. Unknown or invalid values fall back to the defaults. */
export function stateFromQuery(search, speciesIds) {
  const p = new URLSearchParams(search);
  const s = defaultState();
  if (![...p.keys()].length) return null;
  const n = (key) => (p.has(key) ? Number(p.get(key)) : NaN);
  const orDefault = (value, fallback) => (Number.isFinite(value) ? value : fallback);

  if (speciesIds.includes(p.get('sp'))) s.species = p.get('sp');
  s.units = p.get('u') === 'in' ? 'imperial' : 'metric';
  if (p.has('t')) s.enclosure.type = p.get('t');
  s.enclosure.lengthCm = orDefault(n('l'), s.enclosure.lengthCm);
  s.enclosure.widthCm = orDefault(n('w'), s.enclosure.widthCm);
  s.enclosure.heightCm = orDefault(n('h'), s.enclosure.heightCm);
  s.enclosure.baseHeightCm = orDefault(n('b'), s.enclosure.baseHeightCm);
  s.bedding.depthCm = orDefault(n('d'), s.bedding.depthCm);
  if (p.has('dz')) s.bedding.deepZone.enabled = p.get('dz') === '1';
  s.bedding.deepZone.share = orDefault(n('ds') / 100, s.bedding.deepZone.share);
  s.bedding.deepZone.depthCm = orDefault(n('dd'), s.bedding.deepZone.depthCm);
  s.wheel.diameterCm = orDefault(n('wh'), s.wheel.diameterCm);
  s.bedding.allowance = orDefault(n('a') / 100, s.bedding.allowance);
  s.bedding.packSizeL = orDefault(n('p'), s.bedding.packSizeL);
  if (p.has('lk')) s.bedding.look = p.get('lk');
  return normalize(s);
}
