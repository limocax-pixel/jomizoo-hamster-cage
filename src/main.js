import './styles.css';
import speciesData from '../data/species.json';
import enclosureData from '../data/enclosures.json';
import { evaluate, fillLimitCm } from './calc.js';
import {
  ENCLOSURE_NAMES, describeScene, renderChecks, renderMetricChips, renderSpeciesFacts, renderVerdictPill, sceneText,
  verdictText,
} from './render.js';
import { LIMITS, defaultState, normalize, stateFromQuery, stateToQuery } from './state.js';
import { fmtDims, fmtLen, fmtNumber, isImperial, lenFromDisplay, lenToDisplay, lenUnit } from './units.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const speciesById = new Map(speciesData.species.map((s) => [s.id, s]));
const presets = new Map(enclosureData.presets.map((p) => [p.id, p]));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SHARE_HOST = 'limocax-pixel.github.io/hamster-habitat-planner';

let state = stateFromQuery(location.search, [...speciesById.keys()]) ?? defaultState();
const species = () => speciesById.get(state.species);

// ---------------------------------------------------------------------------
// Numeric fields: internal values are cm / fractions / liters; inputs show display units.
// ---------------------------------------------------------------------------

const FIELDS = {
  length: { kind: 'len', get: (s) => s.enclosure.lengthCm, set: (s, v) => (s.enclosure.lengthCm = v), range: () => LIMITS.lengthCm },
  width: { kind: 'len', get: (s) => s.enclosure.widthCm, set: (s, v) => (s.enclosure.widthCm = v), range: () => LIMITS.widthCm },
  height: { kind: 'len', get: (s) => s.enclosure.heightCm, set: (s, v) => (s.enclosure.heightCm = v), range: () => LIMITS.heightCm },
  base: {
    kind: 'len',
    get: (s) => s.enclosure.baseHeightCm,
    set: (s, v) => (s.enclosure.baseHeightCm = v),
    range: (s) => [LIMITS.baseHeightCm[0], Math.min(LIMITS.baseHeightCm[1], s.enclosure.heightCm)],
  },
  depth: {
    kind: 'len',
    get: (s) => s.bedding.depthCm,
    set: (s, v) => (s.bedding.depthCm = v),
    range: (s) => [LIMITS.depthCm[0], Math.max(LIMITS.depthCm[0], Math.min(LIMITS.depthCm[1], fillLimitCm(s.enclosure)))],
  },
  deepDepth: {
    kind: 'len',
    get: (s) => s.bedding.deepZone.depthCm,
    set: (s, v) => (s.bedding.deepZone.depthCm = v),
    range: (s) => {
      const max = Math.min(LIMITS.deepDepthCm[1], fillLimitCm(s.enclosure));
      return [Math.min(max, Math.max(LIMITS.deepDepthCm[0], s.bedding.depthCm)), max];
    },
  },
  deepShare: {
    kind: 'pct',
    get: (s) => s.bedding.deepZone.share,
    set: (s, v) => (s.bedding.deepZone.share = v),
    range: () => LIMITS.deepShare,
  },
  wheel: { kind: 'len', get: (s) => s.wheel.diameterCm, set: (s, v) => (s.wheel.diameterCm = v), range: () => LIMITS.wheelCm },
  allowance: {
    kind: 'pct',
    get: (s) => s.bedding.allowance,
    set: (s, v) => (s.bedding.allowance = v),
    range: () => LIMITS.allowance,
  },
  pack: { kind: 'liters', get: (s) => s.bedding.packSizeL, set: (s, v) => (s.bedding.packSizeL = v), range: () => LIMITS.packSizeL },
};

const toDisplay = (kind, v) => (kind === 'len' ? lenToDisplay(v, state.units) : kind === 'pct' ? v * 100 : v);
const fromDisplay = (kind, v) => (kind === 'len' ? lenFromDisplay(v, state.units) : kind === 'pct' ? v / 100 : v);
const stepFor = (kind) => (kind === 'len' ? (isImperial(state.units) ? 0.5 : 1) : 1);
const digitsFor = (kind) => (kind === 'pct' ? 0 : kind === 'len' ? (isImperial(state.units) ? 1 : 0) : 1);
const round = (v, kind) => Number(fmtNumber(v, digitsFor(kind)).replace(/,/g, ''));

function syncField(key) {
  const def = FIELDS[key];
  const root = $(`.field[data-key="${key}"]`);
  const [min, max] = def.range(state).map((v) => toDisplay(def.kind, v));
  const value = toDisplay(def.kind, def.get(state));
  for (const input of $$('input', root)) {
    input.min = String(round(min, def.kind));
    input.max = String(round(max, def.kind));
    input.step = String(stepFor(def.kind));
    if (input.type === 'range' || document.activeElement !== input) input.value = String(round(value, def.kind));
  }
  for (const unit of $$('[data-unit="len"]', root)) unit.textContent = lenUnit(state.units);
}

function syncInputs() {
  for (const key of Object.keys(FIELDS)) syncField(key);
  for (const input of $$('input[name="species"]')) input.checked = input.value === state.species;
  for (const input of $$('input[name="type"]')) input.checked = input.value === state.enclosure.type;
  for (const input of $$('input[name="units"]')) input.checked = input.value === state.units;
  for (const input of $$('input[name="look"]')) input.checked = input.value === state.bedding.look;
  $('#deep-enabled').checked = state.bedding.deepZone.enabled;
  $('#deep-fields').hidden = !state.bedding.deepZone.enabled;
  $('.field[data-key="base"]').hidden = state.enclosure.type !== 'wire';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let scene = null;
let sceneFrame = 0;
let latest = null;

function refresh({ inputs = true, share = true, rebuild = true } = {}) {
  normalize(state);
  const sp = species();
  const results = evaluate(state, sp);
  latest = { results, sp };
  if (inputs) syncInputs();
  const pill = $('#verdict');
  pill.className = `verdict-pill verdict-pill--${results.verdict.level}`;
  pill.innerHTML = renderVerdictPill(results);
  $('#metrics').innerHTML = renderMetricChips(results, state.units);
  $('#checks').innerHTML = renderChecks(results, sp, state.units, state);
  $('#species-facts').innerHTML = renderSpeciesFacts(sp, state.units);
  $('#viewport').setAttribute('aria-label', describeScene(state, results, sp, state.units));
  if (rebuild) scheduleScene();
  if (share) scheduleUrl();
}

function scheduleScene() {
  if (!scene || sceneFrame) return;
  sceneFrame = requestAnimationFrame(() => {
    sceneFrame = 0;
    const { results, sp } = latest;
    scene.update(state, results, sp, sceneText(state, results, sp, state.units));
  });
}

let urlTimer = 0;
function scheduleUrl() {
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => history.replaceState(null, '', `?${stateToQuery(state)}`), 250);
}

// A short hint that fades after a few seconds or on first interaction.
const hint = $('#hint');
const hideHint = () => hint.classList.add('is-hidden');
setTimeout(hideHint, 6000);
$('#viewport').addEventListener('pointerdown', hideHint, { once: true });

// ---------------------------------------------------------------------------
// Panels: one at a time, opened from the dock
// ---------------------------------------------------------------------------

function openPanel(name) {
  for (const button of $$('[data-open]')) {
    const open = button.dataset.open === name;
    button.setAttribute('aria-expanded', String(open));
  }
  for (const panel of $$('.panel')) panel.hidden = panel.dataset.panel !== name;
  if (name) {
    toggleSheet(false);
    hideHint();
  }
  updateInsets();
}

for (const button of $$('[data-open]')) {
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    openPanel(open ? null : button.dataset.open);
  });
}

function toggleSheet(force) {
  const pill = $('#verdict');
  const open = force ?? pill.getAttribute('aria-expanded') !== 'true';
  pill.setAttribute('aria-expanded', String(open));
  $('#checks-sheet').hidden = !open;
  if (open) openPanel(null);
}
$('#verdict').addEventListener('click', () => toggleSheet());

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    openPanel(null);
    toggleSheet(false);
  }
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

for (const [key, def] of Object.entries(FIELDS)) {
  const root = $(`.field[data-key="${key}"]`);
  const range = $('input[type="range"]', root);
  const number = $('input[type="number"]', root);
  const apply = (raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    def.set(state, fromDisplay(def.kind, value));
    if (['length', 'width', 'height'].includes(key)) $('#preset').value = '';
    refresh();
    // Show the clamped value even while the number box still has focus.
    number.value = String(round(toDisplay(def.kind, def.get(state)), def.kind));
  };
  range?.addEventListener('input', () => apply(range.value));
  number.addEventListener('change', () => apply(number.value));
  number.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      apply(number.value);
    }
  });
}

$('#controls').addEventListener('submit', (event) => event.preventDefault());

$('#species').addEventListener('change', (event) => {
  state.species = event.target.value;
  state.wheel.diameterCm = species().wheel.recommendedDiameterCm;
  refresh();
});

$('#enclosure-type').addEventListener('change', (event) => {
  state.enclosure.type = event.target.value;
  refresh();
});

$('#preset').addEventListener('change', (event) => {
  const preset = presets.get(event.target.value);
  if (!preset) return;
  Object.assign(state.enclosure, {
    type: preset.type,
    lengthCm: preset.lengthCm,
    widthCm: preset.widthCm,
    heightCm: preset.heightCm,
    ...(preset.baseHeightCm ? { baseHeightCm: preset.baseHeightCm } : {}),
  });
  refresh();
});

$('#deep-enabled').addEventListener('change', (event) => {
  state.bedding.deepZone.enabled = event.target.checked;
  refresh();
});

$('#look').addEventListener('change', (event) => {
  state.bedding.look = event.target.value;
  refresh();
});

for (const input of $$('input[name="units"]')) {
  input.addEventListener('change', () => {
    state.units = input.value;
    refresh();
  });
}

for (const button of $$('[data-view]')) {
  button.addEventListener('click', () => {
    scene?.setView(button.dataset.view);
    for (const b of $$('[data-view]')) b.setAttribute('aria-pressed', String(b === button));
  });
}

$('#labels-toggle').addEventListener('click', (event) => {
  const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(on));
  scene?.setLabelsVisible(on);
});

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2400);
}

$('#share').addEventListener('click', async () => {
  history.replaceState(null, '', `?${stateToQuery(state)}`);
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied');
  } catch {
    toast('Copy the address bar to share');
  }
});

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Share image: the 3D view with a caption strip and the JOMIZOO logo. */
async function composeShareImage() {
  const { results, sp } = latest;
  const e = state.enclosure;
  const depth = results.depth.deepCm
    ? `${fmtLen(results.depth.standardCm, state.units)}–${fmtLen(results.depth.deepCm, state.units)}`
    : fmtLen(results.depth.standardCm, state.units);
  const title = `${sp.name} · ${ENCLOSURE_NAMES[e.type]} ${fmtDims(e.lengthCm, e.widthCm, state.units)}`;
  const subtitle = `Bedding ${depth} · wheel Ø ${fmtLen(state.wheel.diameterCm, state.units)} · ${verdictText(results, sp, state.units).title}`;

  const shot = scene.renderImage();
  const strip = Math.round(shot.width * 0.13);
  const pad = Math.round(shot.width * 0.04);
  const canvas = document.createElement('canvas');
  canvas.width = shot.width;
  canvas.height = shot.height + strip;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shot, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, shot.height, canvas.width, strip);
  await document.fonts?.ready;
  const font = (weight, size) => `${weight} ${Math.round(size)}px Assistant, system-ui, sans-serif`;
  ctx.fillStyle = '#121212';
  ctx.font = font(800, strip * 0.25);
  ctx.fillText(title, pad, shot.height + strip * 0.44);
  ctx.fillStyle = '#6f6a63';
  ctx.font = font(600, strip * 0.17);
  ctx.fillText(subtitle, pad, shot.height + strip * 0.74);
  try {
    const logo = await loadImage('./brand/jomizoo-logo.png');
    const h = strip * 0.22;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, canvas.width - pad - w, shot.height + strip * 0.24, w, h);
  } catch {
    // The caption still works without the logo.
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#6f6a63';
  ctx.font = font(600, strip * 0.13);
  ctx.fillText(SHARE_HOST, canvas.width - pad, shot.height + strip * 0.74);
  return canvas;
}

$('#snapshot').addEventListener('click', async () => {
  if (!scene) return toast('3D preview not available');
  const canvas = await composeShareImage();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `hamster-habitat-${latest.sp.id}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, 'image/png');
});

$('#reset').addEventListener('click', () => {
  state = defaultState();
  $('#preset').value = '';
  scene?.select(null);
  refresh({ share: false });
  history.replaceState(null, '', location.pathname);
});

// Citations link into the collapsed sources list: open it when one is followed.
function revealHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  const box = id ? document.getElementById(id)?.closest('details') : null;
  if (box && !box.open) box.open = true;
}
window.addEventListener('hashchange', revealHashTarget);
revealHashTarget();

// ---------------------------------------------------------------------------
// 3D stage (lazy-loaded so the page and the checks work without it)
// ---------------------------------------------------------------------------

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Keep the cage framed between the top bar, the dock and (on wide screens) an open side panel. */
function updateInsets() {
  if (!scene) return;
  const app = $('#planner').getBoundingClientRect();
  const bar = $('#appbar').getBoundingClientRect();
  const status = $('.status').getBoundingClientRect();
  const dock = $('#dock').getBoundingClientRect();
  const panel = $$('.panel').find((p) => !p.hidden)?.getBoundingClientRect();
  const wide = matchMedia('(min-width: 900px)').matches;
  const tools = $('.viewtools').getBoundingClientRect();
  const toolsOnTop = tools.bottom < app.top + app.height / 3; // phones: a row under the top bar
  scene.setInsets({
    top: Math.max(bar.bottom, status.bottom, toolsOnTop ? tools.bottom : 0) - app.top + 8,
    // On phones the open panel is a bottom sheet: frame the cage above it.
    bottom: app.bottom - (panel && !wide ? panel.top : dock.top) + 8,
    left: panel && wide ? panel.right - app.left : 0,
  });
}

async function initScene() {
  const status = $('#viewport-status');
  if (!supportsWebGL()) {
    status.textContent = 'The 3D view needs WebGL. The checks still work — tap the status above.';
    return;
  }
  try {
    const { createScene } = await import('./scene/scene.js');
    scene = createScene($('#viewport'), { reducedMotion });
    status.remove();
    scene.onLayoutChange = (layout, { final }) => {
      state.layout = layout;
      refresh({ inputs: false, rebuild: final });
    };
    updateInsets();
    new ResizeObserver(updateInsets).observe($('#planner'));
    scheduleScene();
    window.__planner = { scene, composeShareImage, getState: () => structuredClone(state) };
  } catch (error) {
    console.error(error);
    status.textContent = 'The 3D view could not load. The checks still work — tap the status above.';
  }
}

refresh({ share: false });
initScene();
