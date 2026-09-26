// Bedding geometry: depth profile, averages and fill limits. Pure functions, lengths in cm.

/** Gap between the bedding surface and the bottom of the wheel's running surface (stand/base). */
export const WHEEL_STAND_CM = 2;

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
