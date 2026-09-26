// Pure calculation logic shared by the browser app, the build-time prerender and the tests.
// No DOM, no Three.js. Lengths are in cm, areas in cm², volumes in liters.
import { computeLayout } from './layout.js';
import { WHEEL_STAND_CM, averageDepthCm, fillLimitCm, hasDeepZone, maxDepthCm } from './profile.js';

export {
  WHEEL_STAND_CM, averageDepthCm, clamp, deepZoneRamp, depthAt, fillLimitCm, hasDeepZone, maxDepthCm, smoothstep,
} from './profile.js';

export const CM_PER_IN = 2.54;
export const CM2_PER_IN2 = CM_PER_IN * CM_PER_IN;
export const L_PER_CUFT = 28.316846592;

const EPS = 1e-9;

/**
 * Liters of bedding: settled volume = length × width × average depth ÷ 1000.
 * `allowance` adds extra for bedding that compacts when pressed down to hold tunnels.
 */
export function beddingVolume(enclosure, bedding) {
  const settledL = (enclosure.lengthCm * enclosure.widthCm * averageDepthCm(bedding)) / 1000;
  const buyL = settledL * (1 + bedding.allowance);
  const packs = bedding.packSizeL > 0 ? Math.ceil(buyL / bedding.packSizeL - EPS) : null;
  return { settledL, buyL, packs };
}

/** Height from the enclosure floor to the top of the wheel, standing on bedding `baseCm` deep. */
export function wheelTopCm(baseCm, wheel) {
  return baseCm + WHEEL_STAND_CM + wheel.diameterCm;
}

/** Evaluate a habitat against the species' parameters. Returns numbers and statuses (no text). */
export function evaluate(state, species) {
  const { enclosure, bedding, wheel } = state;

  const areaCm2 = enclosure.lengthCm * enclosure.widthCm;
  const floor = {
    areaCm2,
    minAreaCm2: species.floor.minAreaCm2,
    minLengthCm: species.floor.minLengthCm,
    minWidthCm: species.floor.minWidthCm,
    recommendedAreaCm2: species.floor.recommendedAreaCm2 ?? null,
    shortSideCm: Math.min(enclosure.lengthCm, enclosure.widthCm),
    ratio: areaCm2 / species.floor.minAreaCm2,
  };
  // Enough area but narrower than the minimum footprint (e.g. a long, thin tank) is a warning.
  floor.status =
    floor.ratio < 1 - EPS ? 'fail' : floor.shortSideCm < floor.minWidthCm - EPS ? 'warn' : 'pass';

  const height = { cm: enclosure.heightCm, minCm: species.height.minCm };
  height.status = height.cm >= height.minCm - EPS ? 'pass' : 'fail';

  const maxCm = maxDepthCm(bedding);
  const depth = {
    standardCm: bedding.depthCm,
    deepCm: hasDeepZone(bedding) ? bedding.deepZone.depthCm : null,
    maxCm,
    averageCm: averageDepthCm(bedding),
    minCm: species.bedding.minDepthCm,
    burrowCm: species.bedding.burrowDepthCm,
    fillLimitCm: fillLimitCm(enclosure),
  };
  depth.status = bedding.depthCm >= depth.minCm - EPS ? 'pass' : 'fail';
  depth.burrow = maxCm >= depth.burrowCm - EPS ? 'full' : maxCm >= depth.minCm - EPS ? 'partial' : 'none';
  depth.spills = maxCm > depth.fillLimitCm + EPS;

  const volume = { ...beddingVolume(enclosure, bedding), allowance: bedding.allowance, packSizeL: bedding.packSizeL };

  // The wheel stands on the bedding wherever it is placed (it may have been dragged onto the deep area).
  const layout = computeLayout(state, species);
  const baseCm = layout.wheel ? layout.wheel.y : bedding.depthCm;
  const top = wheelTopCm(baseCm, wheel);
  const wheelResult = {
    diameterCm: wheel.diameterCm,
    baseCm,
    minCm: species.wheel.minDiameterCm,
    recommendedCm: species.wheel.recommendedDiameterCm,
    topCm: top,
    heightCm: enclosure.heightCm,
    fits: top <= enclosure.heightCm + EPS,
  };
  wheelResult.status = wheel.diameterCm >= wheelResult.minCm - EPS ? 'pass' : 'fail';

  const checks = [
    { id: 'floor', status: floor.status },
    { id: 'height', status: height.status },
    { id: 'depth', status: depth.spills ? 'fail' : depth.status },
    // Too-shallow bedding is already a failure of the depth check, so a missing burrow area is only a warning.
    { id: 'burrow', status: depth.burrow === 'full' ? 'great' : 'warn' },
    { id: 'wheel-size', status: wheelResult.status },
    { id: 'wheel-fit', status: wheelResult.fits ? 'pass' : 'fail' },
  ];
  if (enclosure.type === 'wire') checks.push({ id: 'bars', status: 'info' });
  checks.push({ id: 'sand', status: 'info' });

  const failing = checks.filter((c) => c.status === 'fail').map((c) => c.id);
  const level = failing.length ? 'below' : depth.burrow === 'full' ? 'excellent' : 'meets';

  return { floor, height, depth, volume, wheel: wheelResult, layout, checks, verdict: { level, failing } };
}
