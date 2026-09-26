// Three.js scene for the planner: builds the enclosure, bedding, furniture and hamster from the
// planner state, keeps the camera framed and lets the user drag furniture around.
// Loaded lazily so the page renders first.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { depthAt } from '../calc.js';
import { bodyCm, bowlSizeCm, surfaceUnder, toUserLayout, tryMove, tryRotate } from '../layout.js';
import { beddingRegions, beddingTextureHeightCm, beddingZones, buildBedding } from './bedding.js';
import { buildEnclosure } from './enclosure.js';
import { buildHamster } from './hamster.js';
import { buildBowl, buildHide, buildSandBath, buildWheel } from './props.js';
import { createBeddingTextures, createBurrowTexture, createSandTexture, createWoodTexture } from './textures.js';

const deg = THREE.MathUtils.degToRad;
const VIEWS = {
  iso: { phi: deg(58), theta: deg(32), portraitTheta: deg(62), zoom: 1, targetY: 0.3 },
  front: { phi: deg(87), theta: 0, zoom: 0.82, targetY: 0.42 },
  top: { phi: deg(3), theta: 0, zoom: 0.92, targetY: 0.2 },
};
const SINK_CM = 0.35; // items settle slightly into the bedding
const ROTATE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function createMaterials(anisotropy) {
  const wood = createWoodTexture(anisotropy);
  const sand = createSandTexture(anisotropy);
  return {
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xf4fbfa, roughness: 0.05, transparent: true, opacity: 0.07, depthWrite: false,
      side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.08,
    }),
    glassEdge: new THREE.LineBasicMaterial({ color: 0x8fb3ac, transparent: true, opacity: 0.85 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.5 }),
    binPlastic: new THREE.MeshPhysicalMaterial({
      color: 0xf4f7f8, roughness: 0.55, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
    }),
    binEdge: new THREE.LineBasicMaterial({ color: 0xbfcace, transparent: true, opacity: 0.95 }),
    binLip: new THREE.MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.8 }),
    wireBase: new THREE.MeshPhysicalMaterial({
      color: 0x9fd4c0, roughness: 0.45, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    }),
    wireBaseRim: new THREE.MeshStandardMaterial({ color: 0x7fbca6, roughness: 0.5 }),
    wire: new THREE.MeshStandardMaterial({ color: 0xf0f0ec, metalness: 0.55, roughness: 0.35 }),
    // Maps are assigned per bedding look / per rebuild (see applyLook and update).
    beddingTop: new THREE.MeshStandardMaterial({ roughness: 0.97 }),
    beddingSide: new THREE.MeshStandardMaterial({ roughness: 0.97 }),
    beddingFront: new THREE.MeshStandardMaterial({ roughness: 0.97 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0xf3d7b0, roughness: 0.5, side: THREE.DoubleSide }),
    wheelBad: new THREE.MeshStandardMaterial({
      color: 0xe8806c, roughness: 0.5, side: THREE.DoubleSide, emissive: 0x6a1d12, emissiveIntensity: 0.35,
    }),
    wheelBack: new THREE.MeshStandardMaterial({ color: 0xe9cda3, roughness: 0.6, side: THREE.DoubleSide }),
    wheelStand: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }),
    hide: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }),
    hideRoof: new THREE.MeshStandardMaterial({ map: wood, color: 0xead8ba, roughness: 0.75 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x2b2118 }),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 0.35 }),
    sand: new THREE.MeshStandardMaterial({ map: sand, roughness: 1 }),
    bowl: new THREE.MeshStandardMaterial({ color: 0x9cc9c0, roughness: 0.3, side: THREE.DoubleSide }),
    water: new THREE.MeshPhysicalMaterial({ color: 0xbfe6f2, roughness: 0.05, transparent: true, opacity: 0.75 }),
    fur: new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xfff4e6),
    }),
    pink: new THREE.MeshStandardMaterial({ color: 0xf2a7a0, roughness: 0.6 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.15 }),
    eyeShine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    white: new THREE.MeshStandardMaterial({ color: 0xfbf8f2, roughness: 0.9 }),
    whisker: new THREE.LineBasicMaterial({ color: 0xcfc6ba, transparent: true, opacity: 0.8 }),
    ghost: new THREE.LineDashedMaterial({ color: 0xd0543f, dashSize: 3, gapSize: 2 }),
    shadow: new THREE.ShadowMaterial({ opacity: 0.2 }),
    outline: new THREE.LineBasicMaterial({ color: 0xf1941c, depthTest: false, transparent: true }),
    outlineHover: new THREE.LineBasicMaterial({ color: 0xf1941c, depthTest: false, transparent: true, opacity: 0.45 }),
  };
}

/** Tunnel diameter drawn for a species: roughly the width of the hamster. */
const tunnelSize = (body) => Math.max(2.8, body * 0.38);

/** Rounded-rectangle outline lying flat, used to show hovered / selected items. */
function footprintOutline(fx, fz, material) {
  const r = Math.min(3, fx / 4, fz / 4);
  const shape = new THREE.Shape();
  const x = -fx / 2 - 0.8;
  const z = -fz / 2 - 0.8;
  const w = fx + 1.6;
  const d = fz + 1.6;
  shape.moveTo(x + r, z);
  shape.lineTo(x + w - r, z);
  shape.quadraticCurveTo(x + w, z, x + w, z + r);
  shape.lineTo(x + w, z + d - r);
  shape.quadraticCurveTo(x + w, z + d, x + w - r, z + d);
  shape.lineTo(x + r, z + d);
  shape.quadraticCurveTo(x, z + d, x, z + d - r);
  shape.lineTo(x, z + r);
  shape.quadraticCurveTo(x, z, x + r, z);
  const points = shape.getPoints(6).map((p) => new THREE.Vector3(p.x, 0.6, p.y));
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), material);
  line.renderOrder = 10;
  line.name = 'outline';
  return line;
}

export function createScene(container, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'viewport__canvas';
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'viewport__labels';
  container.appendChild(labelRenderer.domElement);

  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const materials = createMaterials(anisotropy);
  const beddingTextures = new Map();

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = deg(88);

  const hemi = new THREE.HemisphereLight(0xfff8ee, 0xcdbd9f, 0.95);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.25;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xe6eeff, 0.55);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), materials.shadow);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const world = new THREE.Group();
  scene.add(world);

  const api = {};
  let hamster = null;
  let tween = null;
  let tweenView = null; // view the running camera animation is heading to
  let dims = null;
  let updates = 0;
  let insets = { top: 0, bottom: 0, left: 0, right: 0 };
  let lastState = null;
  let layout = {}; // current item positions (mutable while dragging)
  const items = new Map(); // key → group
  let selected = null;
  let hovered = null;
  let drag = null;
  let pendingEmit = false;
  const tmpV = new THREE.Vector3();

  controls.addEventListener('start', () => {
    tween = null;
  });

  const stopTween = () => {
    tween = null;
    tweenView = null;
  };

  function clearWorld() {
    for (const child of [...world.children]) {
      world.remove(child); // fires 'removed', which also detaches CSS2D label elements
      child.traverse((o) => {
        o.geometry?.dispose();
        if (o.isCSS2DObject) o.element.remove();
      });
    }
    items.clear();
    hamster = null;
  }

  function applyLook(look) {
    if (!beddingTextures.has(look)) beddingTextures.set(look, createBeddingTextures(look, anisotropy));
    const t = beddingTextures.get(look);
    const first = !materials.beddingTop.map;
    materials.beddingTop.map = t.top;
    materials.beddingSide.map = t.side;
    if (first) materials.beddingTop.needsUpdate = materials.beddingSide.needsUpdate = true;
  }

  let burrowTexture = null;
  function setBurrowTexture(texture) {
    burrowTexture?.dispose();
    burrowTexture = texture;
    const first = !materials.beddingFront.map;
    materials.beddingFront.map = texture;
    if (first) materials.beddingFront.needsUpdate = true;
  }

  function makeLabel(text, className, x, y, z, parent = world) {
    const el = document.createElement('div');
    el.className = `lbl ${className}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    parent.add(obj);
    return obj;
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  /**
   * Camera distance at which every corner of the enclosure fits on screen for the given viewing
   * angles, leaving room for the overlaid UI (insets).
   */
  function fitDistance(L, W, H, phi, theta, targetY) {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const tanV = Math.tan(deg(camera.fov) / 2) * Math.max(0.25, 1 - (insets.top + insets.bottom) / h);
    const tanH = Math.tan(deg(camera.fov) / 2) * camera.aspect * Math.max(0.25, 1 - (insets.left + insets.right) / w);
    const back = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1, phi, theta)); // target → camera
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize();
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(back, right).normalize();
    let dist = 0;
    for (const x of [-L / 2, L / 2]) {
      for (const y of [0, H]) {
        for (const z of [-W / 2, W / 2]) {
          const p = tmpV.set(x, y - targetY, z);
          const toward = p.dot(back); // how much closer to the camera than the target
          const need = Math.max(Math.abs(p.dot(right)) / tanH, Math.abs(p.dot(up)) / tanV) + toward;
          dist = Math.max(dist, need);
        }
      }
    }
    return dist * 1.06;
  }

  function applyViewOffset() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    // Centre the cage in the space left between the overlays.
    const dx = (insets.right - insets.left) / 2;
    const dy = (insets.bottom - insets.top) / 2;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) camera.setViewOffset(w, h, dx, dy, w, h);
    else camera.clearViewOffset();
  }

  function frame(keepAngles = true) {
    if (!dims) return;
    const { L, W, H } = dims;
    const offset = camera.position.clone().sub(controls.target);
    const sph =
      keepAngles && offset.lengthSq() > 0
        ? new THREE.Spherical().setFromVector3(offset)
        : new THREE.Spherical(1, VIEWS.iso.phi, isoTheta());
    const dist = fitDistance(L, W, H, sph.phi, sph.theta, H * 0.3);
    sph.radius = dist;
    controls.target.set(0, H * 0.3, 0);
    camera.position.copy(controls.target).add(tmpV.setFromSpherical(sph));
    controls.minDistance = dist * 0.25;
    controls.maxDistance = dist * 2.5;
    camera.lookAt(controls.target);
  }

  const isoTheta = () => (camera.aspect < 0.8 ? VIEWS.iso.portraitTheta : VIEWS.iso.theta);

  function setView(name, { duration = 750 } = {}) {
    const view = name === 'iso' ? { ...VIEWS.iso, theta: isoTheta() } : VIEWS[name];
    if (!view || !dims) return;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const toY = dims.H * view.targetY;
    const toRadius = fitDistance(dims.L, dims.W, dims.H, view.phi, view.theta, toY) * view.zoom;
    const fromY = controls.target.y;
    let dTheta = view.theta - from.theta;
    dTheta = ((((dTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const start = performance.now();
    const ms = reducedMotion ? 1 : duration;
    tweenView = name;
    tween = (now) => {
      const k = Math.min(1, (now - start) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const s = new THREE.Spherical(
        from.radius + (toRadius - from.radius) * e,
        from.phi + (view.phi - from.phi) * e,
        from.theta + dTheta * e,
      );
      controls.target.y = fromY + (toY - fromY) * e;
      camera.position.copy(controls.target).add(tmpV.setFromSpherical(s));
      camera.lookAt(controls.target);
      if (k >= 1) stopTween();
    };
  }

  /**
   * Space covered by overlaid UI (app bar, dock, side panel), so the cage is framed between them.
   * Only vertical changes refit the distance; a side panel just slides the view over.
   */
  function setInsets(next) {
    const refit = next.top !== insets.top || next.bottom !== insets.bottom;
    insets = { top: 0, bottom: 0, left: 0, right: 0, ...next };
    applyViewOffset();
    if (!refit) return;
    // Mid-animation, head for the refitted framing instead of the old one.
    if (tween && tweenView) setView(tweenView, { duration: 450 });
    else frame(true);
  }

  // ---------------------------------------------------------------------------
  // Selection, hover and dragging
  // ---------------------------------------------------------------------------

  function decorate(group) {
    const key = group.userData.key;
    group.getObjectByName('outline')?.removeFromParent();
    group.getObjectByName('rotate')?.removeFromParent();
    const item = layout[key];
    if (!item || (key !== selected && key !== hovered)) return;
    const unrotated = item.r % 2 ? { x: item.fz, z: item.fx } : { x: item.fx, z: item.fz };
    group.add(footprintOutline(unrotated.x, unrotated.z, key === selected ? materials.outline : materials.outlineHover));
    if (key === selected && !drag) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item-rotate';
      button.title = 'Rotate (R)';
      button.setAttribute('aria-label', 'Rotate');
      button.innerHTML = ROTATE_ICON;
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        rotateSelected();
      });
      const obj = new CSS2DObject(button);
      obj.name = 'rotate';
      obj.position.set(0, group.userData.height + 5, 0);
      group.add(obj);
    }
  }

  function refreshDecorations() {
    for (const group of items.values()) decorate(group);
  }

  function select(key) {
    if (selected === key) return;
    selected = key;
    refreshDecorations();
  }

  function setHovered(key) {
    if (hovered === key) return;
    hovered = key;
    canvas.style.cursor = key ? 'move' : '';
    refreshDecorations();
  }

  function emitLayout(final) {
    if (!lastState) return;
    api.onLayoutChange?.(toUserLayout(layout, lastState), { final });
  }

  function rotateSelected() {
    if (!selected || !layout[selected] || !lastState) return;
    const next = tryRotate(layout, selected, lastState);
    if (!next) return;
    layout[selected] = { ...layout[selected], ...next };
    emitLayout(true);
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function pickItem() {
    const hits = raycaster.intersectObjects([...items.values()], true);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData.key) o = o.parent;
      if (o) return o.userData.key;
    }
    return null;
  }

  // Capture phase: runs before OrbitControls, so grabbing an item doesn't also orbit the camera.
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      aim(event);
      const key = pickItem();
      if (!key) {
        select(null);
        return;
      }
      const group = items.get(key);
      controls.enabled = false;
      stopTween();
      dragPlane.constant = -group.position.y;
      const hit = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
      drag = {
        key,
        offset: hit ? hit.sub(group.position) : new THREE.Vector3(),
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      selected = key;
      hovered = key;
      refreshDecorations();
      canvas.style.cursor = 'grabbing';
    },
    { capture: true },
  );

  canvas.addEventListener('pointermove', (event) => {
    aim(event);
    if (!drag) {
      if (event.pointerType === 'mouse') setHovered(pickItem());
      return;
    }
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return;
    drag.moved = true;
    const hit = raycaster.ray.intersectPlane(dragPlane, tmpV);
    if (!hit || !lastState) return;
    const next = tryMove(layout, drag.key, hit.x - drag.offset.x, hit.z - drag.offset.z, lastState);
    if (!next) return;
    const item = { ...layout[drag.key], ...next };
    item.y = surfaceUnder(item.x, item.fx, lastState);
    layout[drag.key] = item;
    const group = items.get(drag.key);
    group.position.set(item.x, item.y - SINK_CM, item.z);
    dragPlane.constant = -group.position.y;
    pendingEmit = true;
  });

  const endDrag = (event) => {
    if (!drag) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    const { moved } = drag;
    drag = null;
    controls.enabled = true;
    canvas.style.cursor = hovered ? 'move' : '';
    pendingEmit = false;
    if (moved) emitLayout(true);
    else refreshDecorations();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!drag) setHovered(null);
  });

  const onKey = (event) => {
    if (!selected || event.target.closest?.('input, select, textarea')) return;
    if (event.key === 'r' || event.key === 'R') rotateSelected();
    if (event.key === 'Escape') select(null);
  };
  window.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  /**
   * Rebuild the scene.
   * @param {object} state    planner state
   * @param {object} results  evaluate() output (includes the layout)
   * @param {object} species  species record from data/species.json
   * @param {object} text     preformatted label strings (units handled by the caller)
   */
  function update(state, results, species, text) {
    const { enclosure, bedding, wheel } = state;
    const L = enclosure.lengthCm;
    const W = enclosure.widthCm;
    const H = enclosure.heightCm;
    updates++;
    if (drag) return; // never rebuild under the user's pointer
    clearWorld();
    lastState = structuredClone(state);
    layout = structuredClone(results.layout);

    const { group: enclosureGroup, floorOffset } = buildEnclosure(enclosure, materials, {
      barSpacingCm: species.bars?.maxGapCm ?? 1,
    });
    world.add(enclosureGroup);

    // Bedding with the burrow cross-section on the front face.
    applyLook(bedding.look);
    const body = bodyCm(species.id);
    const zones = beddingZones(L, bedding);
    const burrow = createBurrowTexture({
      lengthCm: L,
      heightCm: beddingTextureHeightCm(bedding),
      depthAtX: (x) => depthAt(x / L, bedding, L),
      regions: beddingRegions(L, bedding),
      tunnelCm: tunnelSize(body),
      minDepthCm: species.bedding.minDepthCm,
      burrowDepthCm: species.bedding.burrowDepthCm,
      look: bedding.look,
      anisotropy,
    });
    setBurrowTexture(burrow.texture);
    world.add(buildBedding({ lengthCm: L, widthCm: W, bedding, materials }));

    // Furniture and hamster at their layout positions (automatic or dragged by the user).
    const sand = species.sandBath;
    const built = {
      wheel: buildWheel(wheel.diameterCm, materials, { fits: results.wheel.fits }),
      sand: buildSandBath(sand.minLengthCm, sand.minWidthCm, materials),
      hide: buildHide(body, materials),
      bowl: buildBowl(bowlSizeCm(body), materials),
    };
    hamster = buildHamster(species.id, body, materials);
    built.hamster = { group: hamster, height: body * 0.55 };
    for (const [key, item] of Object.entries(built)) {
      const pos = layout[key];
      if (!pos) {
        if (key === 'hamster') hamster = null;
        continue;
      }
      const group = item.group;
      group.userData.key = key;
      group.userData.height = item.height;
      group.position.set(pos.x, pos.y - SINK_CM, pos.z);
      // The hamster turns a little towards the default camera so its face is visible.
      group.rotation.y = (pos.r * Math.PI) / 2 + (key === 'hamster' ? 0.45 : 0);
      world.add(group);
      items.set(key, group);
    }
    if (!results.wheel.fits && items.has('wheel')) {
      makeLabel(text.wheel, 'lbl--warn', 0, built.wheel.height + 3, 0, items.get('wheel'));
    }
    if (selected && !items.has(selected)) selected = null;
    if (hovered && !items.has(hovered)) hovered = null;
    refreshDecorations();

    // Minimum footprint outline on the ground when the floor is too small or too narrow.
    if (results.floor.status !== 'pass') {
      const w = species.floor.minLengthCm / 2;
      const d = species.floor.minWidthCm / 2;
      const y = -floorOffset + 0.1;
      const outline = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(
          [[-w, -d], [w, -d], [w, d], [-w, d], [-w, -d]].map(([x, z]) => new THREE.Vector3(x, y, z)),
        ),
        materials.ghost,
      );
      outline.computeLineDistances();
      world.add(outline);
      makeLabel(text.minFootprint, 'lbl--warn', 0, y, Math.max(d, W / 2) + 14);
    }

    // Dimension and burrow labels.
    makeLabel(text.length, 'lbl--dim', 0, -floorOffset, W / 2 + 3);
    makeLabel(text.width, 'lbl--dim', L / 2 + 3, -floorOffset, 0);
    makeLabel(text.height, 'lbl--dim', L / 2 + 2, H / 2, W / 2 + 2);
    for (const zone of zones) {
      const x = -L / 2 + (zone.x0 + zone.x1) / 2;
      makeLabel(zone.kind === 'deep' ? text.deep : text.depth, 'lbl--depth', x, zone.depthCm + 3, W / 2 + 1);
    }
    for (const c of burrow.chambers) {
      makeLabel(c.kind === 'store' ? text.store : text.nest, 'lbl--burrow', -L / 2 + c.x, c.y, W / 2 + 1);
    }

    // Ground, lights and shadow camera follow the enclosure size.
    const span = Math.max(L, W, H);
    ground.scale.set(span * 4, span * 4, 1);
    ground.position.y = -floorOffset - 0.02;
    sun.position.set(span * 0.55, span * 2.2, span * 0.85);
    fill.position.set(-span, span * 0.8, -span * 0.6);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -Math.max(L, W) * 0.9 - 10;
    sc.right = sc.top = Math.max(L, W) * 0.9 + 10;
    sc.near = 1;
    sc.far = span * 6;
    sc.updateProjectionMatrix();

    const first = !dims;
    const changed = !dims || dims.L !== L || dims.W !== W || dims.H !== H;
    dims = { L, W, H };
    if (changed) frame(!first);
    if (first && !reducedMotion) {
      // A short fly-in shows it's 3D without a camera that keeps moving under the pointer.
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      sph.theta -= deg(28);
      sph.phi = Math.max(deg(35), sph.phi - deg(10));
      sph.radius *= 1.35;
      camera.position.copy(controls.target).add(tmpV.setFromSpherical(sph));
      camera.lookAt(controls.target);
      setView('iso', { duration: 1400 });
    }
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyViewOffset();
    frame(true);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  io.observe(container);

  let raf = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (tween) tween(now);
    controls.update();
    if (hamster && !reducedMotion) hamster.userData.tick(now / 1000);
    if (pendingEmit) {
      pendingEmit = false;
      emitLayout(false);
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  /** Render the current view (optionally at a given size) onto a canvas with the stage background. */
  function renderImage({ width, height } = {}) {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const prevInsets = insets;
    const resized = Boolean(width && height);
    for (const group of items.values()) {
      group.getObjectByName('outline')?.removeFromParent();
    }
    if (resized) {
      insets = { top: 0, bottom: 0, left: 0, right: 0 };
      camera.clearViewOffset();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frame(true);
    }
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    const bg = ctx.createRadialGradient(out.width / 2, out.height * 0.35, 0, out.width / 2, out.height * 0.35, out.width * 0.75);
    bg.addColorStop(0, '#fffdf8');
    bg.addColorStop(0.6, '#f5efe4');
    bg.addColorStop(1, '#e9dfcf');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    if (resized) {
      insets = prevInsets;
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      applyViewOffset();
      frame(true);
    }
    refreshDecorations();
    return out;
  }

  function screenPositionOf(key) {
    const group = items.get(key);
    if (!group) return null;
    const p = group.position.clone().setY(group.position.y + (group.userData.height ?? 0) * 0.5).project(camera);
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  function setLabelsVisible(on) {
    labelRenderer.domElement.classList.toggle('hide-labels', !on);
  }

  function dispose() {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    io.disconnect();
    window.removeEventListener('keydown', onKey);
    clearWorld();
    controls.dispose();
    renderer.dispose();
    container.replaceChildren();
  }

  resize();
  Object.assign(api, {
    update, setView, setInsets, renderImage, setLabelsVisible, select, screenPositionOf, dispose, onLayoutChange: null,
  });
  return api;
}
