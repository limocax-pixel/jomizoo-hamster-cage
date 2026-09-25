// Bedding as a closed "terrain block": a noisy top surface (standard depth + optional deep
// burrowing area joined by a slope) and four side skirts. The front skirt carries the burrow
// texture, which is what you see through the glass.
import * as THREE from 'three';
import { deepZoneRamp, depthAt, hasDeepZone, maxDepthCm } from '../calc.js';
import { fbm } from './noise.js';

const TOP_TILE_CM = 16;
const SIDE_TILE_CM = 18;

/** Flat sections of the bedding in cm from the left wall: [{ x0, x1, depthCm, kind }]. */
export function beddingZones(lengthCm, bedding) {
  if (!hasDeepZone(bedding)) return [{ x0: 0, x1: lengthCm, depthCm: bedding.depthCm, kind: 'standard' }];
  const { start, slopeHalf } = deepZoneRamp(bedding, lengthCm);
  return [
    { x0: 0, x1: (start - slopeHalf) * lengthCm, depthCm: bedding.depthCm, kind: 'standard' },
    { x0: (start + slopeHalf) * lengthCm, x1: lengthCm, depthCm: bedding.deepZone.depthCm, kind: 'deep' },
  ];
}

/** Sections for burrows: the standard area, and the deep area including the slope up to it. */
export function beddingRegions(lengthCm, bedding) {
  if (!hasDeepZone(bedding)) return [{ x0: 0, x1: lengthCm, kind: 'standard' }];
  const { start, slopeHalf } = deepZoneRamp(bedding, lengthCm);
  const split = (start - slopeHalf) * lengthCm;
  return [
    { x0: 0, x1: split, kind: 'standard' },
    { x0: split, x1: lengthCm, kind: 'deep' },
  ];
}

/** Surface height function (cm above the enclosure floor) in scene coordinates (x, z centred). */
export function beddingSurface(lengthCm, widthCm, bedding) {
  const amp = Math.min(0.9, bedding.depthCm * 0.06);
  return (x, z) => {
    const base = depthAt((x + lengthCm / 2) / lengthCm, bedding, lengthCm);
    const n = (fbm(x * 0.09 + 3.1, z * 0.09 + 7.7) - 0.5) * 2 * amp;
    return Math.max(0.3, base + n);
  };
}

export function beddingTextureHeightCm(bedding) {
  return maxDepthCm(bedding) + 2;
}

function buildGeometry(L, W, heightAt, texHeightCm) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const geometry = new THREE.BufferGeometry();
  let vertex = 0;

  // Top surface (material 0)
  const segX = Math.min(160, Math.max(24, Math.round(L / 1.4)));
  const segZ = Math.min(90, Math.max(12, Math.round(W / 1.4)));
  for (let j = 0; j <= segZ; j++) {
    const z = -W / 2 + (W * j) / segZ;
    for (let i = 0; i <= segX; i++) {
      const x = -L / 2 + (L * i) / segX;
      positions.push(x, heightAt(x, z), z);
      uvs.push((x + L / 2) / TOP_TILE_CM, (z + W / 2) / TOP_TILE_CM);
    }
  }
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * (segX + 1) + i;
      const b = a + 1;
      const c = a + segX + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  vertex = positions.length / 3;
  geometry.addGroup(0, indices.length, 0);

  // Side skirts. Points run so that (direction × up) points outwards.
  const skirt = (points, material, uvFor) => {
    const start = indices.length;
    const base = vertex;
    points.forEach(([x, z], i) => {
      const h = heightAt(x, z);
      positions.push(x, 0, z, x, h, z);
      const [u, vTop, vBottom] = uvFor(x, z, h, i);
      uvs.push(u, vBottom, u, vTop);
    });
    for (let i = 0; i < points.length - 1; i++) {
      const b0 = base + i * 2;
      const t0 = b0 + 1;
      const b1 = b0 + 2;
      const t1 = b0 + 3;
      indices.push(b0, b1, t0, b1, t1, t0);
    }
    vertex += points.length * 2;
    geometry.addGroup(start, indices.length - start, material);
  };

  const along = (n, from, to) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  const front = along(segX, -L / 2, L / 2).map((x) => [x, W / 2]);
  const back = along(segX, L / 2, -L / 2).map((x) => [x, -W / 2]);
  const right = along(segZ, W / 2, -W / 2).map((z) => [L / 2, z]);
  const left = along(segZ, -W / 2, W / 2).map((z) => [-L / 2, z]);

  skirt(front, 1, (x, z, h) => [(x + L / 2) / L, h / texHeightCm, 0]);
  const sideUV = (dist) => (x, z, h, i) => [dist(x, z, i) / SIDE_TILE_CM, h / SIDE_TILE_CM, 0];
  skirt(back, 2, sideUV((x) => L / 2 - x));
  skirt(right, 2, sideUV((x, z) => W / 2 - z));
  skirt(left, 2, sideUV((x, z) => z + W / 2));

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @returns {THREE.Mesh} bedding mesh using materials [top, front (burrows), sides]
 */
export function buildBedding({ lengthCm: L, widthCm: W, bedding, materials }) {
  const heightAt = beddingSurface(L, W, bedding);
  const geometry = buildGeometry(L, W, heightAt, beddingTextureHeightCm(bedding));
  const mesh = new THREE.Mesh(geometry, [materials.beddingTop, materials.beddingFront, materials.beddingSide]);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'bedding';
  return mesh;
}
