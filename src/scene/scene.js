// Three.js scene for the planner: builds the enclosure, bedding, furniture and hamster from the
// planner state and keeps the camera framed. Loaded lazily so the page content renders first.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { depthAt } from '../calc.js';
import { beddingRegions, beddingTextureHeightCm, beddingZones, buildBedding } from './bedding.js';
import { buildEnclosure } from './enclosure.js';
import { buildHamster, modelBodyCm } from './hamster.js';
import { buildBowl, buildHide, buildSandBath, buildWheel } from './props.js';
import { createBeddingTextures, createBurrowTexture, createSandTexture, createWoodTexture } from './textures.js';

const deg = THREE.MathUtils.degToRad;
const VIEWS = {
  iso: { phi: deg(60), theta: deg(32), zoom: 1, targetY: 0.3 },
  front: { phi: deg(87), theta: 0, zoom: 0.8, targetY: 0.42 },
  top: { phi: deg(3), theta: 0, zoom: 0.9, targetY: 0.2 },
};

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
  };
}

/** Tunnel diameter drawn for a species: roughly the width of the hamster. */
const tunnelSize = (bodyCm) => Math.max(2.8, bodyCm * 0.38);



export function createScene(container, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.className = 'viewport__canvas';
  container.appendChild(renderer.domElement);

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
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.02;
  controls.maxPolarAngle = deg(88);
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.45;

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

  let hamster = null;
  let tween = null;
  let dims = null;
  let updates = 0;
  const tmpV = new THREE.Vector3();

  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    tween = null;
  });

  function clearWorld() {
    for (const child of [...world.children]) {
      world.remove(child); // fires 'removed', which also detaches CSS2D label elements
      child.traverse((o) => o.geometry?.dispose());
    }
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

  function addLabel(text, className, x, y, z) {
    const el = document.createElement('div');
    el.className = `lbl ${className}`;
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.set(x, y, z);
    world.add(obj);
    return obj;
  }

  function fitDistance(L, W, H) {
    const radius = 0.5 * Math.hypot(L, W, H);
    const vFov = deg(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 0.98;
  }

  function frame(keepAngles = true) {
    if (!dims) return;
    const { L, W, H } = dims;
    const dist = fitDistance(L, W, H);
    const offset = camera.position.clone().sub(controls.target);
    const sph = keepAngles && offset.lengthSq() > 0
      ? new THREE.Spherical().setFromVector3(offset)
      : new THREE.Spherical(dist, VIEWS.iso.phi, VIEWS.iso.theta);
    sph.radius = dist;
    controls.target.set(0, H * 0.3, 0);
    camera.position.copy(controls.target).add(tmpV.setFromSpherical(sph));
    controls.minDistance = dist * 0.25;
    controls.maxDistance = dist * 2.5;
    camera.lookAt(controls.target);
  }

  function setView(name) {
    const view = VIEWS[name];
    if (!view || !dims) return;
    controls.autoRotate = false;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const toRadius = fitDistance(dims.L, dims.W, dims.H) * view.zoom;
    const fromY = controls.target.y;
    const toY = dims.H * view.targetY;
    let dTheta = view.theta - from.theta;
    dTheta = ((((dTheta + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const start = performance.now();
    const duration = reducedMotion ? 1 : 750;
    tween = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      const s = new THREE.Spherical(
        from.radius + (toRadius - from.radius) * e,
        from.phi + (view.phi - from.phi) * e,
        from.theta + dTheta * e,
      );
      controls.target.y = fromY + (toY - fromY) * e;
      camera.position.copy(controls.target).add(tmpV.setFromSpherical(s));
      camera.lookAt(controls.target);
      if (k >= 1) tween = null;
    };
  }

  /**
   * Rebuild the scene.
   * @param {object} state    planner state
   * @param {object} results  evaluate() output
   * @param {object} species  species record from data/species.json
   * @param {object} text     preformatted label strings (units handled by the caller)
   */
  function update(state, results, species, text) {
    const { enclosure, bedding, wheel } = state;
    const L = enclosure.lengthCm;
    const W = enclosure.widthCm;
    const H = enclosure.heightCm;
    if (updates++ > 0) controls.autoRotate = false;
    clearWorld();

    const { group: enclosureGroup, floorOffset } = buildEnclosure(enclosure, materials, {
      barSpacingCm: species.bars?.maxGapCm ?? 1,
    });
    world.add(enclosureGroup);

    // Bedding with the burrow cross-section on the front face.
    applyLook(bedding.look);
    const bodyCm = modelBodyCm(species.id);
    const zones = beddingZones(L, bedding);
    const burrow = createBurrowTexture({
      lengthCm: L,
      heightCm: beddingTextureHeightCm(bedding),
      depthAtX: (x) => depthAt(x / L, bedding, L),
      regions: beddingRegions(L, bedding),
      tunnelCm: tunnelSize(bodyCm),
      minDepthCm: species.bedding.minDepthCm,
      burrowDepthCm: species.bedding.burrowDepthCm,
      look: bedding.look,
      anisotropy,
    });
    setBurrowTexture(burrow.texture);
    world.add(buildBedding({ lengthCm: L, widthCm: W, bedding, materials }));

    // Furniture, placed on the bedding surface without overlapping.
    const surface = (x) => depthAt((x + L / 2) / L, bedding, L);
    const margin = 2.5;
    const taken = [];
    const collides = (x, z, fx, fz) =>
      taken.some((r) => Math.abs(x - r.x) < (fx + r.fx) / 2 + 1 && Math.abs(z - r.z) < (fz + r.fz) / 2 + 1);
    const findSpot = (fx, fz, rows) => {
      for (const row of rows) {
        const z = row === 'back' ? -W / 2 + margin + fz / 2 : row === 'front' ? W / 2 - margin - fz / 2 : 0;
        if (Math.abs(z) + fz / 2 > W / 2) continue;
        for (let x = -L / 2 + margin + fx / 2; x <= L / 2 - margin - fx / 2; x += 1.5) {
          if (!collides(x, z, fx, fz)) return { x, z };
        }
      }
      return null;
    };
    const place = (item, rows, { rotationY = 0 } = {}) => {
      const { x: fx, z: fz } = item.footprint;
      const spot = findSpot(fx, fz, rows);
      if (!spot) return null;
      let y = 0;
      for (let i = 0; i <= 4; i++) y += surface(spot.x - fx / 2 + (fx * i) / 4);
      item.group.position.set(spot.x, y / 5 - 0.35, spot.z);
      item.group.rotation.y = rotationY;
      world.add(item.group);
      taken.push({ ...spot, fx, fz });
      return spot;
    };

    const wheelItem = buildWheel(wheel.diameterCm, materials, { fits: results.wheel.fits });
    const wheelSpot = place(wheelItem, ['back', 'front']);
    const sandSize = species.sandBath ?? { minLengthCm: bodyCm * 1.6, minWidthCm: bodyCm * 1.15 };
    place(buildSandBath(sandSize.minLengthCm, sandSize.minWidthCm, materials), ['front', 'back', 'mid']);
    place(buildHide(bodyCm, materials), ['back', 'front', 'mid']);
    place(buildBowl(Math.min(10, Math.max(6, bodyCm * 0.55)), materials), ['front', 'mid', 'back']);

    hamster = buildHamster(species.id, bodyCm, materials);
    const hamsterSpot = findSpot(bodyCm * 0.8, bodyCm * 1.15, ['front', 'mid', 'back']);
    if (hamsterSpot) {
      hamster.position.set(hamsterSpot.x, surface(hamsterSpot.x) - 0.2, hamsterSpot.z);
      hamster.rotation.y = 0.5;
      world.add(hamster);
    } else {
      hamster = null;
    }

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
      addLabel(text.minFootprint, 'lbl--warn', 0, y, Math.max(d, W / 2) + 14);
    }

    // Dimension and feature labels.
    addLabel(text.length, 'lbl--dim', 0, -floorOffset, W / 2 + 3);
    addLabel(text.width, 'lbl--dim', L / 2 + 3, -floorOffset, 0);
    addLabel(text.height, 'lbl--dim', L / 2 + 2, H / 2, W / 2 + 2);
    for (const zone of zones) {
      const x = -L / 2 + (zone.x0 + zone.x1) / 2;
      addLabel(zone.kind === 'deep' ? text.deep : text.depth, 'lbl--depth', x, zone.depthCm + 3, W / 2 + 1);
    }
    for (const c of burrow.chambers) {
      const name = c.kind === 'store' ? text.store : text.nest;
      addLabel(name, 'lbl--burrow', -L / 2 + c.x, c.y, W / 2 + 1);
    }
    if (wheelSpot) {
      addLabel(text.wheel, results.wheel.fits ? 'lbl--muted' : 'lbl--warn', wheelSpot.x, wheelItem.group.position.y + wheelItem.height + 3, wheelSpot.z);
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

    const nextDims = { L, W, H };
    const first = !dims;
    const changed = !dims || dims.L !== L || dims.W !== W || dims.H !== H;
    dims = nextDims;
    if (changed) frame(!first);
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  /** Render the current view (optionally at a given size) onto a canvas with the stage background. */
  function renderImage({ width, height } = {}) {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const resized = Boolean(width && height);
    if (resized) {
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
      renderer.setPixelRatio(prevRatio);
      renderer.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      frame(true);
    }
    return out;
  }

  function setLabelsVisible(on) {
    labelRenderer.domElement.hidden = !on;
  }

  function dispose() {
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    io.disconnect();
    clearWorld();
    controls.dispose();
    renderer.dispose();
    container.replaceChildren();
  }

  resize();
  return { update, setView, renderImage, setLabelsVisible, dispose };
}
