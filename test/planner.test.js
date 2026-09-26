import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  averageDepthCm, beddingVolume, depthAt, evaluate, fillLimitCm, maxDepthCm, wheelTopCm,
} from '../src/calc.js';
import { ITEM_KEYS, computeLayout, decodeLayout, encodeLayout, overlaps, toUserLayout, tryMove, tryRotate } from '../src/layout.js';
import { renderStaticParts } from '../src/prerender.js';
import { ENCLOSURE_TYPES, LIMITS, defaultState, normalize, stateFromQuery, stateToQuery } from '../src/state.js';

const readJSON = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const speciesData = readJSON('../data/species.json');
const enclosureData = readJSON('../data/enclosures.json');
const species = Object.fromEntries(speciesData.species.map((s) => [s.id, s]));
const speciesIds = Object.keys(species);

const bedding = (overrides = {}) => ({
  depthCm: 20,
  look: 'paper-natural',
  deepZone: { enabled: false, share: 0.3, depthCm: 40 },
  allowance: 0,
  packSizeL: 20,
  ...overrides,
});

test('average depth includes the deep burrowing area', () => {
  const b = bedding({ deepZone: { enabled: true, share: 0.3, depthCm: 40 } });
  assert.equal(averageDepthCm(b), 26);
  assert.equal(maxDepthCm(b), 40);
  assert.equal(averageDepthCm(bedding()), 20);
});

test('the drawn depth profile integrates to the published average depth', () => {
  for (const [L, share, d1, d2] of [[100, 0.3, 20, 40], [60, 0.6, 10, 50], [240, 0.1, 15, 80], [40, 0.5, 5, 35]]) {
    const b = bedding({ depthCm: d1, deepZone: { enabled: true, share, depthCm: d2 } });
    const n = 20000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += depthAt((i + 0.5) / n, b, L);
    assert.ok(Math.abs(sum / n - averageDepthCm(b)) < 0.01, `L=${L} share=${share}`);
    assert.equal(depthAt(0, b, L), d1);
    assert.equal(depthAt(1, b, L), d2);
  }
});

test('bedding volume: length × width × depth ÷ 1000, packs rounded up', () => {
  const enclosure = { type: 'tank', lengthCm: 100, widthCm: 50, heightCm: 60, baseHeightCm: 15 };
  assert.deepEqual(beddingVolume(enclosure, bedding()), { settledL: 100, buyL: 100, packs: 5 });
  const withAllowance = beddingVolume(enclosure, bedding({ allowance: 0.25 }));
  assert.equal(withAllowance.buyL, 125);
  assert.equal(withAllowance.packs, 7);
});

test('wire cages only hold bedding up to the plastic base', () => {
  assert.equal(fillLimitCm({ type: 'wire', heightCm: 40, baseHeightCm: 12 }), 12);
  assert.equal(fillLimitCm({ type: 'tank', heightCm: 40, baseHeightCm: 12 }), 40);
  const s = defaultState();
  s.enclosure = { type: 'wire', lengthCm: 80, widthCm: 50, heightCm: 40, baseHeightCm: 12 };
  normalize(s);
  assert.equal(s.bedding.depthCm, 12);
  assert.ok(s.bedding.deepZone.depthCm <= 12);
});

test('the default setup is excellent for a Syrian hamster', () => {
  const r = evaluate(defaultState(), species.syrian);
  assert.equal(r.verdict.level, 'excellent');
  assert.deepEqual(r.verdict.failing, []);
});

test('a small wire cage with shallow bedding fails', () => {
  const s = defaultState();
  Object.assign(s.enclosure, { type: 'wire', lengthCm: 60, widthCm: 40, heightCm: 38, baseHeightCm: 10 });
  s.bedding.deepZone.enabled = false;
  normalize(s);
  const r = evaluate(s, species.syrian);
  assert.equal(r.verdict.level, 'below');
  assert.ok(r.verdict.failing.includes('floor'));
  assert.ok(r.verdict.failing.includes('depth'));
});

test('a wheel taller than the enclosure fails the fit check', () => {
  const s = defaultState();
  s.enclosure.heightCm = 45;
  normalize(s);
  const r = evaluate(s, species.syrian);
  assert.equal(wheelTopCm(s.bedding.depthCm, s.wheel), s.bedding.depthCm + 2 + s.wheel.diameterCm);
  assert.ok(Math.abs(r.wheel.baseCm - s.bedding.depthCm) < 1e-9, 'wheel stands on the standard-depth bedding');
  assert.equal(r.wheel.fits, false);
  assert.ok(r.verdict.failing.includes('wheel-fit'));
});

test('a long but narrow tank passes on area with a warning', () => {
  const s = defaultState();
  Object.assign(s.enclosure, { lengthCm: 121.9, widthCm: 45.7, heightCm: 53.3 });
  normalize(s);
  const r = evaluate(s, species.syrian);
  assert.equal(r.floor.status, 'warn');
  assert.ok(!r.verdict.failing.includes('floor'));
});

test('an enclosure under the minimum height fails', () => {
  const s = defaultState();
  Object.assign(s.enclosure, { lengthCm: 91.4, widthCm: 45.7, heightCm: 40.6 });
  s.bedding.deepZone.depthCm = 35;
  s.wheel.diameterCm = 20;
  normalize(s);
  const r = evaluate(s, species.campbell);
  assert.equal(r.height.status, 'fail');
  assert.ok(r.verdict.failing.includes('height'));
});

test('automatic layout keeps every item inside the enclosure without overlaps', () => {
  const enclosures = [
    { type: 'tank', lengthCm: 100, widthCm: 50, heightCm: 60, baseHeightCm: 15 },
    { type: 'wire', lengthCm: 60, widthCm: 40, heightCm: 38, baseHeightCm: 10 },
    { type: 'wood', lengthCm: 240, widthCm: 120, heightCm: 80, baseHeightCm: 15 },
    { type: 'bin', lengthCm: 30, widthCm: 20, heightCm: 30, baseHeightCm: 15 },
  ];
  for (const sp of Object.values(species)) {
    for (const enclosure of enclosures) {
      const s = defaultState();
      s.enclosure = { ...enclosure };
      s.wheel.diameterCm = sp.wheel.recommendedDiameterCm;
      normalize(s);
      const items = Object.values(computeLayout(s, sp));
      for (const item of items) {
        assert.ok(Math.abs(item.x) + item.fx / 2 <= enclosure.lengthCm / 2 + 1e-6 || item.x === 0, `${sp.id} ${item.key} x`);
        assert.ok(Math.abs(item.z) + item.fz / 2 <= enclosure.widthCm / 2 + 1e-6 || item.z === 0, `${sp.id} ${item.key} z`);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          assert.ok(!overlaps(items[i], items[j]), `${sp.id} ${items[i].key}/${items[j].key} in ${enclosure.lengthCm} cm`);
        }
      }
    }
  }
  const roomy = computeLayout(defaultState(), species.syrian);
  assert.deepEqual(Object.keys(roomy).sort(), [...ITEM_KEYS].sort(), 'everything fits in the default enclosure');
});

test('a wheel dragged onto the deep burrowing area no longer fits under the lid', () => {
  const s = defaultState();
  const layout = computeLayout(s, species.syrian);
  const moved = tryMove(layout, 'wheel', s.enclosure.lengthCm / 2, layout.wheel.z, s);
  assert.ok(moved, 'the wheel can be moved to the right-hand end');
  s.layout = toUserLayout({ ...layout, wheel: { ...layout.wheel, ...moved } }, s);
  const r = evaluate(s, species.syrian);
  assert.ok(r.wheel.baseCm > s.bedding.depthCm + 10, 'wheel now stands on deep bedding');
  assert.equal(r.wheel.fits, false);
});

test('items cannot be moved or rotated into each other', () => {
  const s = defaultState();
  const layout = computeLayout(s, species.syrian);
  const blocked = tryMove(layout, 'bowl', layout.hide.x, layout.hide.z, s);
  if (blocked) assert.ok(!overlaps({ ...layout.bowl, ...blocked }, layout.hide));
  const turned = tryRotate(layout, 'wheel', s);
  assert.ok(turned);
  assert.equal(turned.r, 1);
  assert.equal(turned.fx, layout.wheel.fz);
});

test('layouts survive the share link', () => {
  const user = { wheel: { u: 0.125, v: 0.3, r: 1 }, bowl: { u: 0.5, v: 0.75, r: 0 } };
  assert.deepEqual(decodeLayout(encodeLayout(user)), user);
  assert.equal(decodeLayout('garbage'), null);
  const s = defaultState();
  s.layout = user;
  normalize(s);
  assert.deepEqual(stateFromQuery(`?${stateToQuery(s)}`, speciesIds).layout, user);
});

test('share links round-trip the whole setup', () => {
  const s = defaultState();
  Object.assign(s, { species: 'roborovski', units: 'imperial' });
  Object.assign(s.enclosure, { type: 'bin', lengthCm: 91.4, widthCm: 45.7, heightCm: 40.6 });
  s.bedding.deepZone = { enabled: true, share: 0.4, depthCm: 30 };
  s.bedding.look = 'aspen';
  normalize(s);
  assert.deepEqual(stateFromQuery(`?${stateToQuery(s)}`, speciesIds), s);
});

test('invalid query values fall back to safe defaults', () => {
  const s = stateFromQuery('?sp=cat&l=abc&t=castle&d=-5', speciesIds);
  assert.equal(s.species, 'syrian');
  assert.equal(s.enclosure.lengthCm, 100);
  assert.equal(s.enclosure.type, 'tank');
  assert.equal(s.bedding.depthCm, LIMITS.depthCm[0]);
  assert.equal(stateFromQuery('', speciesIds), null);
});

test('species data is complete, consistent and fully sourced', () => {
  const used = new Set();
  for (const sp of speciesData.species) {
    for (const key of ['id', 'name', 'namePlural', 'shortName', 'groupName', 'scientificName']) {
      assert.ok(sp[key], `${sp.id}.${key}`);
    }
    assert.equal(sp.floor.minAreaCm2, sp.floor.minLengthCm * sp.floor.minWidthCm, `${sp.id} floor area`);
    assert.ok(sp.height.minCm > 0, `${sp.id} height`);
    assert.ok(sp.bedding.burrowDepthCm > sp.bedding.minDepthCm, `${sp.id} burrow depth`);
    assert.ok(sp.wheel.recommendedDiameterCm >= sp.wheel.minDiameterCm, `${sp.id} wheel`);
    assert.ok(sp.bars.maxGapCm > 0 && sp.bars.maxGapCm <= 1.2, `${sp.id} bars`);
    assert.ok(sp.temperatureC.min < sp.temperatureC.max, `${sp.id} temperature`);
    for (const range of [sp.adult.weightG, sp.adult.lifespanYears]) assert.ok(range[0] <= range[1], sp.id);
    for (const block of [sp.floor, sp.height, sp.bedding, sp.wheel, sp.bars, sp.sandBath, sp.temperatureC, sp.adult]) {
      assert.ok(block.sources?.length, `${sp.id} values need sources`);
    }
    JSON.stringify(sp, (key, value) => {
      if (key === 'sources') value.forEach((id) => used.add(id));
      return value;
    });
  }
  for (const id of used) assert.ok(speciesData.sources[id], `unknown source "${id}"`);
  for (const [id, source] of Object.entries(speciesData.sources)) {
    assert.match(source.url, /^https:\/\//, `${id} url`);
    assert.ok(source.title, `${id} title`);
  }
});

test('enclosure presets are valid', () => {
  for (const p of enclosureData.presets) {
    assert.ok(ENCLOSURE_TYPES.includes(p.type), p.id);
    for (const [key, limit] of [['lengthCm', LIMITS.lengthCm], ['widthCm', LIMITS.widthCm], ['heightCm', LIMITS.heightCm]]) {
      assert.ok(p[key] >= limit[0] && p[key] <= limit[1], `${p.id}.${key}`);
    }
  }
});

test('the prerender fills every placeholder and emits valid structured data', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const out = renderStaticParts(html, { species: speciesData, enclosures: enclosureData });
  assert.ok(!out.includes('<!--@'), 'unfilled placeholder');
  const jsonLd = JSON.parse(out.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  const types = jsonLd['@graph'].map((node) => node['@type']);
  for (const type of ['Organization', 'WebApplication', 'Dataset', 'FAQPage']) assert.ok(types.includes(type), type);
});

test('README key numbers, table and sources match the data', async () => {
  const { readmeFactsBlock, readmeSourcesBlock, replaceBlock } = await import('../src/render.js');
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  let expected = replaceBlock(readme, 'facts', readmeFactsBlock(speciesData, defaultState().bedding.allowance));
  expected = replaceBlock(expected, 'sources', readmeSourcesBlock(speciesData.sources));
  assert.equal(readme, expected, 'README is out of date — run `npm run readme`');
});
