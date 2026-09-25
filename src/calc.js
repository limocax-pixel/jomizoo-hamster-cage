// Pure calculation logic shared by the browser app, the build-time prerender and the tests.
// No DOM, no Three.js. Lengths are in cm, areas in cm², volumes in liters.

export const CM_PER_IN = 2.54;
export const CM2_PER_IN2 = CM_PER_IN * CM_PER_IN;
export const L_PER_CUFT = 28.316846592;

/** Gap between the bedding surface and the bottom of the wheel's running surface (stand/base). */
export const WHEEL_STAND_CM = 2;

const EPS = 1e-9;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hasDeepZone(bedding) {
  const zone = bedding.deepZone;
  return Boolean(zone && zone.enabled && zone.share > 0 && zone.depthCm > bedding.depthCm);
}

/**
 * The deep burrowing area sits at the right-hand end of the enclosure.
 * `start` is where it begins (0–1 along the length); `slopeHalf` is half the width
 * of the bedding slope that joins the two levels (roughly a 45° pile).
 * The slope is symmetric around `start`, so the average depth stays exact.
 */
export function deepZoneRamp(bedding, lengthCm) {
  const { share, depthCm } = bedding.deepZone;
  const start = 1 - share;
  const slopeHalf = Math.min(((depthCm - bedding.depthCm) * 0.5) / lengthCm, 0.9 * Math.min(share, start));
  return { start, slopeHalf };
}

/** Settled bedding depth (cm) at position u along the length (0 = left wall, 1 = right wall). */
export function depthAt(u, bedding, lengthCm) {
  if (!hasDeepZone(bedding)) return bedding.depthCm;
  const { start, slopeHalf } = deepZoneRamp(bedding, lengthCm);
  const t = slopeHalf > 0 ? smoothstep(start - slopeHalf, start + slopeHalf, u) : u >= start ? 1 : 0;
  return bedding.depthCm + (bedding.deepZone.depthCm - bedding.depthCm) * t;
}

/** Average depth = standard depth + (deep-area depth − standard depth) × deep-area share. */
export function averageDepthCm(bedding) {
  if (!hasDeepZone(bedding)) return bedding.depthCm;
  return bedding.depthCm + (bedding.deepZone.depthCm - bedding.depthCm) * bedding.deepZone.share;
}

export function maxDepthCm(bedding) {
  return hasDeepZone(bedding) ? bedding.deepZone.depthCm : bedding.depthCm;
}

/** How high bedding can go before it spills: the plastic base of a wire cage, otherwise the walls. */
export function fillLimitCm(enclosure) {
  return enclosure.type === 'wire'
    ? Math.min(enclosure.baseHeightCm, enclosure.heightCm)
    : enclosure.heightCm;
}

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

/** Height from the enclosure floor to the top of the wheel, standing on the standard-depth bedding. */
export function wheelTopCm(bedding, wheel) {
  return bedding.depthCm + WHEEL_STAND_CM + wheel.diameterCm;
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

  const top = wheelTopCm(bedding, wheel);
  const wheelResult = {
    diameterCm: wheel.diameterCm,
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

  return { floor, height, depth, volume, wheel: wheelResult, checks, verdict: { level, failing } };
}
