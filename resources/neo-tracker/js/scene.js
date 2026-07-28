/* =========================================================
   SCENE — the WebGL viewport.

   Mostly vector: lines, point clouds, wireframes, so it reads
   like a Battlezone-era display. The exception is the planets,
   which are low-poly shaded globes — see the chroma mask below
   for how they keep their real colours on a monochrome tube.

   Rendering path:
     scene ──▶ rtScene ──▶ threshold+blur ──▶ blur ──▶ CRT composite ──▶ canvas

   THE CHROMA MASK
   The scene render target's ALPHA channel is not opacity — it is a
   per-pixel flag meaning "this pixel keeps its own colour". Globes
   write alpha 1; every vector element blends with alpha untouched,
   leaving it 0. The CRT pass collapses alpha-0 pixels onto the
   phosphor and passes alpha-1 pixels through. That is what lets
   Earth be blue on a green tube without breaking the illusion, and
   it is why the vector materials use CustomBlending rather than
   plain AdditiveBlending — additive would also add into alpha and
   slowly turn the whole display chromatic.
   ========================================================= */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  positionAt, orbitPath, planetPosition, planetElements, PLANET_NAMES,
  moonPosition, gmst, AU_KM, LD_KM, EARTH_R_KM, GEO_ALT_KM
} from './astro.js?v=14';
import {
  BODY_INFO, globeGeometry, globeMaterial, globeEdges, earthAxis
} from './bodies.js?v=14';
import { satPositionEci } from './satellites.js?v=14';

export const HELIO_SCALE = 8;      // scene units per AU
export const GEO_SCALE = 6;        // scene units per lunar distance

const ORBIT_SAMPLES = 128;
const tmpV = new THREE.Vector3();
const tmpP = { x: 0, y: 0, z: 0 };
const tmpQ = { x: 0, y: 0, z: 0 };

/** Marker sizes: CSS pixels × scene units (the shader divides by depth). */
const PT = {
  starMin: 5000, starMax: 27000,
  neo: 85, neoPha: 120,
  geoNeo: 900, geoNeoPha: 1250,
  craft: 95,
  sat: 260
};

/**
 * Globe radii in the heliocentric frame, in scene units. Compressed
 * logarithmically: at true scale Earth would be 1/23 500 of an AU and
 * invisible, but a single fixed size would erase the fact that Jupiter
 * dwarfs Mercury. The ordering is honest; the ratios are not, and the
 * readout says so.
 */
function helioGlobeRadius(radiusKm) {
  return 0.085 + 0.062 * Math.log10(radiusKm / 1000);
}

/* ---------------------------------------------------------
   Shaders
   --------------------------------------------------------- */

const CRT_FRAG = /* glsl */`
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uFlicker;
  uniform float uCurve;
  uniform float uScanline;
  uniform float uBloom;
  uniform float uForceChroma;   // 1.0 = full-colour scheme, skip the collapse
  uniform vec3  uPhosphor;
  varying vec2 vUv;

  vec2 curve(vec2 uv, float k) {
    uv = uv * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    uv *= 1.0 + k * r2 * (0.35 + 0.65 * r2);
    return uv * 0.5 + 0.5;
  }

  void main() {
    vec2 uv = curve(vUv, uCurve);

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    // Chromatic fringing grows toward the edges, as on a real tube where
    // the three beams converge perfectly only at the centre.
    vec2 d = uv - 0.5;
    float ca = 0.0016 * dot(d, d) * 4.0;
    vec4 s = texture2D(tScene, uv);
    vec3 raw;
    raw.r = texture2D(tScene, uv + d * ca).r;
    raw.g = s.g;
    raw.b = texture2D(tScene, uv - d * ca).b;

    vec3 bl = texture2D(tBloom, uv).rgb;

    // Chroma mask: alpha 1 keeps the pixel's own colour, alpha 0 collapses
    // it onto the single phosphor. A full-colour scheme forces the former.
    float keep = max(s.a, uForceChroma);
    float lum  = dot(raw, vec3(0.299, 0.587, 0.114));
    float blum = dot(bl,  vec3(0.299, 0.587, 0.114));
    vec3 col = mix(uPhosphor * lum,  raw, keep)
             + mix(uPhosphor * blum, bl,  keep) * uBloom;

    // Scanlines in screen space, positioned by the curved uv so they bend
    // with the glass.
    float sl = sin(uv.y * uRes.y * 1.5708);
    col *= 1.0 - uScanline * 0.5 * (0.5 + 0.5 * sl);

    // Aperture grille.
    col *= 0.94 + 0.06 * sin(gl_FragCoord.x * 2.094);

    // A faint band drifting down the tube, the way an unsynced CRT rolls.
    float roll = smoothstep(0.0, 0.06, abs(fract(uv.y - uTime * 0.06) - 0.5) - 0.44);
    col += uPhosphor * roll * 0.012;

    col *= uFlicker;
    col *= clamp(1.0 - dot(d, d) * 0.85, 0.0, 1.0);
    col += uPhosphor * 0.012;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/* Bloom: separable gaussian, 9 taps at half resolution — a reach of 8
   full-res pixels. Quarter-res with 13 taps reaches 24 pixels instead and
   turns every marker into a blob. The threshold pass samples the full-res
   scene with half-res texel steps, which downsamples and blurs at once. */
const THRESH_FRAG = /* glsl */`
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float w = exp(-float(i * i) / 8.0);
      vec3 c = texture2D(tScene, vUv + vec2(float(i) * uTexel.x, 0.0)).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      sum += c * max(0.0, l - uThreshold) / max(l, 1e-4) * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`;

const BLURV_FRAG = /* glsl */`
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    for (int i = -4; i <= 4; i++) {
      float w = exp(-float(i * i) / 8.0);
      sum += texture2D(tScene, vUv + vec2(0.0, float(i) * uTexel.y)).rgb * w;
      wsum += w;
    }
    gl_FragColor = vec4(sum / wsum, 1.0);
  }
`;

const POINT_VERT = /* glsl */`
  attribute float aSize;
  attribute float aBright;
  uniform float uDpr;
  uniform float uMinSize;
  varying float vBright;
  void main() {
    vBright = aBright;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uDpr / max(-mv.z, 0.001), uMinSize * uDpr, 26.0 * uDpr);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */`
  uniform vec3 uColor;
  varying float vBright;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(1.0, 0.35, r);
    float halo = pow(1.0 - r, 3.0) * 0.30;
    // Alpha 0: this is a phosphor element, let the CRT collapse it.
    gl_FragColor = vec4(uColor * (core + halo) * vBright, 0.0);
  }
`;

/* ---------------------------------------------------------
   Blending

   Additive colour, untouched alpha. THREE.AdditiveBlending would also
   add into the alpha channel, which is the chroma mask — a few hundred
   overlapping orbit lines would drive it to 1 and the whole display
   would stop collapsing onto the phosphor.
   --------------------------------------------------------- */
function additiveKeepAlpha(mat) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

/* ---------------------------------------------------------
   Geometry helpers
   --------------------------------------------------------- */

function ringGeometry(radius, seg = 180) {
  const pos = [];
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    pos.push(radius * Math.cos(a0), 0, radius * Math.sin(a0),
             radius * Math.cos(a1), 0, radius * Math.sin(a1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function spokeGeometry(rInner, rOuter, count = 12) {
  const pos = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    pos.push(rInner * Math.cos(a), 0, rInner * Math.sin(a),
             rOuter * Math.cos(a), 0, rOuter * Math.sin(a));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function segmentGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  return g;
}

function setSegment(mesh, x, y, z, x0 = 0, y0 = 0, z0 = 0) {
  const p = mesh.geometry.getAttribute('position');
  p.setXYZ(0, x0, y0, z0);
  p.setXYZ(1, x, y, z);
  p.needsUpdate = true;
}

function emptyPoints(material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(3), 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(1), 1));
  g.setAttribute('aBright', new THREE.Float32BufferAttribute(new Float32Array(1), 1));
  const p = new THREE.Points(g, material);
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

/* ---------------------------------------------------------
   Viewport
   --------------------------------------------------------- */

export class Viewport {
  constructor(canvas, labelLayer) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.mode = 'helio';

    this.records = [];      // NEOs
    this.craft = [];        // deep-space spacecraft
    this.sats = [];         // Earth-orbit satellites
    this.selected = null;
    this.hovered = null;

    this.jd = 0;
    this.date = new Date();
    this.earthPos = { x: 0, y: 0, z: 0 };
    this.showOrbits = true;
    this.showPlanets = true;
    this.showCraft = true;
    this.showSats = true;
    this.earthExaggeration = 1;

    this.targets = [];      // pooled pick list, rebuilt per frame
    this.targetCount = 0;
    this._sunVec = new THREE.Vector3();
    this._labels = new Map();

    this.scheme = {
      phosphor: 0x00ff00, forceChroma: 0,
      neo: 0x00ff00, pha: 0x00ff00, planetOrbit: 0x00ff00,
      grid: 0x00ff00, sun: 0x00ff00, craft: 0x00ff00, sat: 0x00ff00,
      selected: 0x00ff00
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
    });
    // Alpha 0 in the clear colour: the chroma mask starts off everywhere.
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.005, 200000);
    this.camera.position.set(0, 9, 16);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 60000;

    this._buildPost();
    this._buildStars();
    this._buildHelio();
    this._buildGeo();

    this.resize();
  }

  /* ---------- post-processing ---------- */

  _buildPost() {
    const opt = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, opt);
    this.rtA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    this.rtB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false });
    for (const rt of [this.rtScene, this.rtA, this.rtB]) {
      rt.texture.minFilter = THREE.LinearFilter;
      rt.texture.magFilter = THREE.LinearFilter;
      rt.texture.generateMipmaps = false;
    }

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.PlaneGeometry(2, 2);

    this.matThresh = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: THRESH_FRAG,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: 0.42 }
      },
      depthTest: false, depthWrite: false
    });

    this.matBlurV = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: BLURV_FRAG,
      uniforms: { tScene: { value: this.rtA.texture }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false
    });

    this.matCrt = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: CRT_FRAG,
      uniforms: {
        tScene: { value: this.rtScene.texture },
        tBloom: { value: this.rtB.texture },
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uFlicker: { value: 1 },
        uCurve: { value: 0.11 },
        uScanline: { value: 0.42 },
        uBloom: { value: 0.62 },
        uForceChroma: { value: 0 },
        uPhosphor: { value: new THREE.Vector3(0.1, 1, 0.25) }
      },
      depthTest: false, depthWrite: false
    });

    this.quadMesh = new THREE.Mesh(quad, this.matCrt);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
  }

  /* ---------- materials ---------- */

  _pointMat(minSize, color) {
    const m = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color ?? 0x00ff00) },
        uDpr: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uMinSize: { value: minSize }
      },
      depthWrite: false, transparent: true
    });
    return additiveKeepAlpha(m);
  }

  _lineMat(opacity, color) {
    const m = new THREE.LineBasicMaterial({
      color: color ?? 0x00ff00, transparent: true, opacity, depthWrite: false
    });
    return additiveKeepAlpha(m);
  }

  /* ---------- starfield ---------- */

  _buildStars() {
    let s = 987654321;
    const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

    const N = 2600, pos = new Float32Array(N * 3), size = new Float32Array(N), bright = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, r = 60000;
      const sr = Math.sqrt(1 - u * u);
      pos[k * 3] = r * sr * Math.cos(th);
      pos[k * 3 + 1] = r * u;
      pos[k * 3 + 2] = r * sr * Math.sin(th);
      const mag = Math.pow(rand(), 2.4);
      size[k] = (PT.starMin + mag * (PT.starMax - PT.starMin)) * 10;
      bright[k] = 0.08 + mag * 0.42;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(bright, 1));

    this.starMat = this._pointMat(1.0);
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  /* ---------- globes ---------- */

  /**
   * A globe plus its edge overlay, as one group. `landMask` is only passed
   * for Earth; everything else gets a flat tint.
   */
  _makeGlobe(name, subdiv, landMask) {
    const info = BODY_INFO[name];
    const geo = globeGeometry(subdiv, info.tint, landMask);
    const mat = globeMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1;      // behind the vector overlay

    const group = new THREE.Group();
    group.add(mesh);

    const edges = globeEdges(geo, 0xffffff, name === 'Earth' ? 0.10 : 0.07);
    group.add(edges);

    group.userData = { name, mesh, mat, edges, info };
    return group;
  }

  setLandMask(mask) {
    this.landMask = mask;
    // Rebuild Earth now that the continents are available.
    for (const g of [this.helioEarth, this.geoEarth]) {
      if (!g) continue;
      const old = g.userData.mesh.geometry;
      const geo = globeGeometry(g === this.geoEarth ? 5 : 4, BODY_INFO.Earth.tint, mask);
      g.userData.mesh.geometry = geo;
      old.dispose();
      g.remove(g.userData.edges);
      g.userData.edges.geometry.dispose();
      const e = globeEdges(geo, 0xffffff, 0.10);
      g.add(e);
      g.userData.edges = e;
    }
  }

  /* ---------- heliocentric ---------- */

  _buildHelio() {
    const G = this.helio = new THREE.Group();
    this.scene.add(G);

    const grid = new THREE.Group();
    this.gridMats = [];
    for (const au of [0.5, 1, 1.5, 2, 3, 4, 5]) {
      const m = this._lineMat(au === 1 ? 0.20 : 0.075);
      this.gridMats.push(m);
      grid.add(new THREE.LineSegments(ringGeometry(au * HELIO_SCALE), m));
    }
    const spokeMat = this._lineMat(0.05);
    this.gridMats.push(spokeMat);
    grid.add(new THREE.LineSegments(spokeGeometry(0.2 * HELIO_SCALE, 5 * HELIO_SCALE, 12), spokeMat));
    G.add(grid);
    this.helioGrid = grid;

    // Sun: a shaded globe plus vector rays.
    this.sunGlobe = this._makeGlobe('Sun', 3, null);
    this.sunGlobe.scale.setScalar(0.30);
    G.add(this.sunGlobe);

    this.sunRayMat = this._lineMat(0.45);
    const rays = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      rays.push(0.42 * Math.cos(a), 0, 0.42 * Math.sin(a), 0.72 * Math.cos(a), 0, 0.72 * Math.sin(a));
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rays, 3));
    G.add(new THREE.LineSegments(rg, this.sunRayMat));

    // Planet orbits + globes.
    this.planetOrbits = new THREE.Group();
    G.add(this.planetOrbits);
    this.planetLines = {};
    this.planetGlobes = {};
    this.planetOrbitMats = [];

    for (const name of PLANET_NAMES) {
      const m = this._lineMat(name === 'Earth' ? 0.42 : 0.16);
      this.planetOrbitMats.push(m);
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), m);
      line.frustumCulled = false;
      this.planetOrbits.add(line);
      this.planetLines[name] = line;

      const globe = this._makeGlobe(name, name === 'Earth' ? 4 : 3, null);
      globe.scale.setScalar(helioGlobeRadius(BODY_INFO[name].radiusKm));
      G.add(globe);
      this.planetGlobes[name] = globe;
      if (name === 'Earth') this.helioEarth = globe;
    }

    // NEOs.
    this.neoOrbits = new THREE.LineSegments(new THREE.BufferGeometry(), additiveKeepAlpha(
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })
    ));
    this.neoOrbits.frustumCulled = false;
    G.add(this.neoOrbits);

    this.neoMat = this._pointMat(2.0);
    this.neoPoints = emptyPoints(this.neoMat);
    G.add(this.neoPoints);

    this.selOrbitMat = this._lineMat(1.0);
    this.selOrbit = new THREE.LineSegments(new THREE.BufferGeometry(), this.selOrbitMat);
    this.selOrbit.frustumCulled = false;
    this.selOrbit.visible = false;
    G.add(this.selOrbit);

    this.selRadiusMat = this._lineMat(0.4);
    this.selRadius = new THREE.LineSegments(segmentGeometry(), this.selRadiusMat);
    this.selRadius.frustumCulled = false;
    this.selRadius.visible = false;
    G.add(this.selRadius);

    // Deep-space spacecraft.
    this.craftMat = this._pointMat(2.5);
    this.craftPoints = emptyPoints(this.craftMat);
    G.add(this.craftPoints);

    this.craftTrailMat = this._lineMat(0.30);
    this.craftTrails = new THREE.LineSegments(new THREE.BufferGeometry(), this.craftTrailMat);
    this.craftTrails.frustumCulled = false;
    G.add(this.craftTrails);

    this._planetOrbitJd = null;
  }

  /* ---------- geocentric ---------- */

  _buildGeo() {
    const G = this.geo = new THREE.Group();
    G.visible = false;
    this.scene.add(G);

    // Earth, true scale against the lunar-orbit ring.
    this.geoEarth = this._makeGlobe('Earth', 5, null);
    this.earthRadiusUnits = (EARTH_R_KM / LD_KM) * GEO_SCALE;
    this.geoEarth.scale.setScalar(this.earthRadiusUnits);
    G.add(this.geoEarth);

    this.geoRingMats = [];
    this.geoRings = new THREE.Group();
    this.rangeRings = [];
    const rings = [
      { ld: GEO_ALT_KM / LD_KM, op: 0.34, label: 'GEO ALT' },
      { ld: 1, op: 0.42, label: '1 LD' },
      { ld: 5, op: 0.12, label: '5 LD' },
      { ld: 10, op: 0.12, label: '10 LD' },
      { ld: 25, op: 0.10, label: '25 LD' },
      { ld: 50, op: 0.09, label: '50 LD' },
      { ld: 100, op: 0.08, label: '100 LD' },
      { ld: 200, op: 0.07, label: '200 LD' }
    ];
    for (const r of rings) {
      const m = this._lineMat(r.op);
      this.geoRingMats.push(m);
      const mesh = new THREE.LineSegments(ringGeometry(r.ld * GEO_SCALE), m);
      this.geoRings.add(mesh);
      this.rangeRings.push({ ...r, mesh });
    }
    const gm = this._lineMat(0.045);
    this.geoRingMats.push(gm);
    this.geoRings.add(new THREE.LineSegments(spokeGeometry(0.06 * GEO_SCALE, 200 * GEO_SCALE, 12), gm));
    G.add(this.geoRings);

    // The Moon, true scale, on its real orbit.
    this.moonGlobe = this._makeGlobe('Moon', 3, null);
    this.moonRadiusUnits = (BODY_INFO.Moon.radiusKm / LD_KM) * GEO_SCALE;
    this.moonGlobe.scale.setScalar(this.moonRadiusUnits);
    G.add(this.moonGlobe);

    this.moonTrailMat = this._lineMat(0.22);
    this.moonTrail = new THREE.LineSegments(new THREE.BufferGeometry(), this.moonTrailMat);
    this.moonTrail.frustumCulled = false;
    G.add(this.moonTrail);

    this.geoMat = this._pointMat(2.0);
    this.geoPoints = emptyPoints(this.geoMat);
    G.add(this.geoPoints);

    // Satellites.
    this.satMat = this._pointMat(1.6);
    this.satPoints = emptyPoints(this.satMat);
    G.add(this.satPoints);

    this.geoVectorMat = this._lineMat(0.55);
    this.geoVector = new THREE.LineSegments(segmentGeometry(), this.geoVectorMat);
    this.geoVector.frustumCulled = false;
    this.geoVector.visible = false;
    G.add(this.geoVector);

    this.geoTrailMat = this._lineMat(0.9);
    this.geoTrail = new THREE.LineSegments(new THREE.BufferGeometry(), this.geoTrailMat);
    this.geoTrail.frustumCulled = false;
    this.geoTrail.visible = false;
    G.add(this.geoTrail);
  }

  /* ---------- colour schemes ---------- */

  setScheme(s) {
    this.scheme = s;
    this.matCrt.uniforms.uPhosphor.value.set(
      ((s.phosphor >> 16) & 255) / 255, ((s.phosphor >> 8) & 255) / 255, (s.phosphor & 255) / 255);
    this.matCrt.uniforms.uForceChroma.value = s.forceChroma ? 1 : 0;

    this.starMat.uniforms.uColor.value.setHex(s.star ?? s.grid);
    this.neoMat.uniforms.uColor.value.setHex(s.neo);
    this.geoMat.uniforms.uColor.value.setHex(s.neo);
    this.craftMat.uniforms.uColor.value.setHex(s.craft);
    this.satMat.uniforms.uColor.value.setHex(s.sat);

    for (const m of this.gridMats) m.color.setHex(s.grid);
    for (const m of this.geoRingMats) m.color.setHex(s.grid);
    for (const m of this.planetOrbitMats) m.color.setHex(s.planetOrbit);
    this.sunRayMat.color.setHex(s.sun);
    this.craftTrailMat.color.setHex(s.craft);
    this.moonTrailMat.color.setHex(s.grid);
    this.selOrbitMat.color.setHex(s.selected);
    this.selRadiusMat.color.setHex(s.selected);
    this.geoVectorMat.color.setHex(s.selected);
    this.geoTrailMat.color.setHex(s.selected);

    // Orbit colours live in a vertex attribute; rebuild them.
    if (this.records.length) this._paintOrbits();
  }

  /* ---------- data ---------- */

  setRecords(records) {
    this.records = records.filter(r => r.el);
    this._buildNeoGeometry();
    if (this.selected && this.selected.kind === 'neo') this.setSelected(null);
  }

  setCraft(list) {
    this.craft = (list || []).filter(c => c.el);
    const n = this.craft.length;
    if (!n) { this.craftPoints.visible = false; return; }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.craft.map(() => PT.craft), 1));
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(this.craft.map(() => 1.15), 1));
    this.craftPoints.geometry.dispose();
    this.craftPoints.geometry = g;
    this.craftPoints.visible = true;
    this._craftPos = g.getAttribute('position');
  }

  setSats(list) {
    this.sats = list || [];
    const n = this.sats.length;
    if (!n) { this.satPoints.visible = false; return; }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.sats.map(() => PT.sat), 1));
    g.setAttribute('aBright', new THREE.Float32BufferAttribute(this.sats.map(() => 0.9), 1));
    this.satPoints.geometry.dispose();
    this.satPoints.geometry = g;
    this.satPoints.visible = true;
    this._satPos = g.getAttribute('position');
    this._satAlive = new Uint8Array(n);
  }

  _paintOrbits() {
    if (!this._orbitColors) return;
    const arr = this._orbitColors.array;
    const pha = new THREE.Color(this.scheme.pha);
    const neo = new THREE.Color(this.scheme.neo);
    const segs = ORBIT_SAMPLES;

    for (let k = 0; k < this.records.length; k++) {
      const c = this.records[k].pha ? pha : neo;
      const g = this.records[k].pha ? 0.62 : 0.26;
      const base = k * segs * 6 * 3;
      for (let v = 0; v < segs * 2; v++) {
        const o = base + v * 3;
        arr[o] = c.r * g; arr[o + 1] = c.g * g; arr[o + 2] = c.b * g;
      }
    }
    this._orbitColors.needsUpdate = true;
  }

  _buildNeoGeometry() {
    const n = this.records.length;
    const segs = ORBIT_SAMPLES;
    const pos = new Float32Array(n * segs * 2 * 3);
    const col = new Float32Array(n * segs * 2 * 3);

    for (let k = 0; k < n; k++) {
      const rec = this.records[k];
      const path = orbitPath(rec.el, segs);
      const base = k * segs * 2 * 3;
      // An open (e >= 1) path must not wrap, or the last sample joins the
      // first with a chord straight across the solar system.
      const closed = rec.el.e < 1;

      for (let s = 0; s < segs; s++) {
        const a = s * 3, b = (closed ? (s + 1) % segs : Math.min(s + 1, segs - 1)) * 3;
        const o = base + s * 6;
        pos[o] = path[a] * HELIO_SCALE;
        pos[o + 1] = path[a + 2] * HELIO_SCALE;
        pos[o + 2] = -path[a + 1] * HELIO_SCALE;
        pos[o + 3] = path[b] * HELIO_SCALE;
        pos[o + 4] = path[b + 2] * HELIO_SCALE;
        pos[o + 5] = -path[b + 1] * HELIO_SCALE;
      }
    }

    this.neoOrbits.geometry.dispose();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ng.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.neoOrbits.geometry = ng;
    this._orbitColors = ng.getAttribute('color');
    this._paintOrbits();

    const frames = [
      [this.neoPoints, PT.neo, PT.neoPha],
      [this.geoPoints, PT.geoNeo, PT.geoNeoPha]
    ];
    for (const [points, sz, szPha] of frames) {
      points.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
      g.setAttribute('aSize', new THREE.Float32BufferAttribute(
        n ? this.records.map(r => (r.pha ? szPha : sz)) : [0], 1));
      g.setAttribute('aBright', new THREE.Float32BufferAttribute(
        n ? this.records.map(r => (r.pha ? 1.1 : 0.72)) : [0], 1));
      points.geometry = g;
      points.visible = n > 0;
    }
    this._neoPos = this.neoPoints.geometry.getAttribute('position');
    this._geoPos = this.geoPoints.geometry.getAttribute('position');
  }

  /* ---------- selection ---------- */

  setSelected(target) {
    // Only NEOs and spacecraft have a drawable heliocentric orbit; the
    // rest are still selectable, they just get no highlighted ellipse.
    this.selected = target || null;
    const el = target && target.el;

    this.selOrbit.visible = false;
    this.selRadius.visible = false;
    this.geoVector.visible = false;
    this.geoTrail.visible = false;
    if (!target) return;

    if (el && this.mode === 'helio') {
      const segs = 256;
      const path = orbitPath(el, segs);
      const closed = el.e < 1;
      const pos = new Float32Array(segs * 2 * 3);
      for (let s = 0; s < segs; s++) {
        const a = s * 3, b = (closed ? (s + 1) % segs : Math.min(s + 1, segs - 1)) * 3, o = s * 6;
        pos[o] = path[a] * HELIO_SCALE;
        pos[o + 1] = path[a + 2] * HELIO_SCALE;
        pos[o + 2] = -path[a + 1] * HELIO_SCALE;
        pos[o + 3] = path[b] * HELIO_SCALE;
        pos[o + 4] = path[b + 2] * HELIO_SCALE;
        pos[o + 5] = -path[b + 1] * HELIO_SCALE;
      }
      this.selOrbit.geometry.dispose();
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.selOrbit.geometry = g;
      this.selOrbit.visible = true;
      this.selRadius.visible = true;
    }

    if (this.mode === 'geo') {
      this.geoVector.visible = true;
      if (target.kind === 'neo' && el) {
        this.geoTrail.visible = true;
        this._buildGeoTrail(target);
      }
    }
  }

  _buildGeoTrail(rec) {
    this._trailJd = this.jd;
    const N = 240, span = 10;
    const pts = [];
    for (let k = 0; k < N; k++) {
      const t = this.jd - span + (2 * span * k) / (N - 1);
      const p = positionAt(rec.el, t);
      const e = planetPosition('Earth', t);
      pts.push(((p.x - e.x) * AU_KM / LD_KM) * GEO_SCALE,
               ((p.z - e.z) * AU_KM / LD_KM) * GEO_SCALE,
               (-(p.y - e.y) * AU_KM / LD_KM) * GEO_SCALE);
    }
    const pos = new Float32Array((N - 1) * 6);
    for (let k = 0; k < N - 1; k++) {
      const o = k * 6;
      pos[o] = pts[k * 3]; pos[o + 1] = pts[k * 3 + 1]; pos[o + 2] = pts[k * 3 + 2];
      pos[o + 3] = pts[(k + 1) * 3]; pos[o + 4] = pts[(k + 1) * 3 + 1]; pos[o + 5] = pts[(k + 1) * 3 + 2];
    }
    this.geoTrail.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.geoTrail.geometry = g;
  }

  setMode(mode) {
    this.mode = mode;
    this.helio.visible = mode === 'helio';
    this.geo.visible = mode === 'geo';
    this.setSelected(this.selected);
  }

  setRange(value) {
    const units = this.mode === 'helio' ? value * HELIO_SCALE : value * GEO_SCALE;
    const d = units * 2.1;
    const dir = tmpV.copy(this.camera.position).sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0.6, 1);
    dir.normalize().multiplyScalar(d);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir);
    this.controls.update();
  }

  setEarthExaggeration(x) {
    this.earthExaggeration = x;
    this.geoEarth.scale.setScalar(this.earthRadiusUnits * x);
    this.moonGlobe.scale.setScalar(this.moonRadiusUnits * x);
  }

  /* ---------- per-frame ---------- */

  update(jd, date) {
    this.jd = jd;
    this.date = date;
    planetPosition('Earth', jd, this.earthPos);

    if (this.mode === 'helio') this._updateHelio(jd);
    else this._updateGeo(jd);

    if (this.selected && this.selected.kind === 'neo' && this.mode === 'geo' &&
        Math.abs(jd - this._trailJd) > 0.5) {
      this._buildGeoTrail(this.selected);
    }

    this._project();
    this.controls.update();
  }

  /** Point a globe's terminator at the Sun, given the Sun's scene position. */
  _lightGlobe(group, sunScenePos) {
    const mat = group.userData.mat;
    tmpV.copy(sunScenePos).sub(group.position).normalize();
    // The shader compares against a view-space normal, so the light
    // direction has to be rotated into view space too.
    tmpV.transformDirection(this.camera.matrixWorldInverse);
    mat.uniforms.uSunDir.value.copy(tmpV);
  }

  /**
   * Orient Earth: tilt its pole to the true rotation axis, then spin the
   * surface about that pole by Greenwich sidereal time.
   *
   * Order matters and is easy to get backwards. Rotating about the tilted
   * axis alone never moves the mesh's own +Y pole onto that axis, so the
   * globe would spin about a line through its equator — a visibly wrong
   * planet. Align first (as the outer rotation), spin in local space.
   */
  _spinEarth(group, jd) {
    if (!this._qAlign) {
      this._qAlign = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), earthAxis());
      this._qSpin = new THREE.Quaternion();
      this._yAxis = new THREE.Vector3(0, 1, 0);
    }
    this._qSpin.setFromAxisAngle(this._yAxis, gmst(jd));
    group.quaternion.copy(this._qAlign).multiply(this._qSpin);
  }

  _rebuildPlanetOrbits(jd) {
    if (this._planetOrbitJd !== null && Math.abs(jd - this._planetOrbitJd) < 3650) return;
    this._planetOrbitJd = jd;

    const SEG = 180;
    for (const name of PLANET_NAMES) {
      const path = orbitPath(planetElements(name, jd), SEG);
      const line = this.planetLines[name];
      let attr = line.geometry.getAttribute('position');
      if (!attr) {
        attr = new THREE.Float32BufferAttribute(new Float32Array(SEG * 2 * 3), 3);
        line.geometry.setAttribute('position', attr);
      }
      const pos = attr.array;
      for (let s = 0; s < SEG; s++) {
        const a = s * 3, b = ((s + 1) % SEG) * 3, o = s * 6;
        pos[o] = path[a] * HELIO_SCALE;
        pos[o + 1] = path[a + 2] * HELIO_SCALE;
        pos[o + 2] = -path[a + 1] * HELIO_SCALE;
        pos[o + 3] = path[b] * HELIO_SCALE;
        pos[o + 4] = path[b + 2] * HELIO_SCALE;
        pos[o + 5] = -path[b + 1] * HELIO_SCALE;
      }
      attr.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
  }

  _updateHelio(jd) {
    this._rebuildPlanetOrbits(jd);
    const sunVec = this._sunVec.set(0, 0, 0);   // the Sun is the origin here

    for (const name of PLANET_NAMES) {
      planetPosition(name, jd, tmpP);
      const globe = this.planetGlobes[name];
      globe.position.set(tmpP.x * HELIO_SCALE, tmpP.z * HELIO_SCALE, -tmpP.y * HELIO_SCALE);
      globe.visible = this.showPlanets;
      this.planetLines[name].visible = this.showPlanets;
      if (this.showPlanets) this._lightGlobe(globe, sunVec);
      if (name === 'Earth') this._spinEarth(globe, jd);
    }

    this.planetOrbits.visible = this.showPlanets;
    this.neoOrbits.visible = this.showOrbits;
    this.sunGlobe.userData.mat.uniforms.uAmbient.value = 1.0;   // the Sun is its own light

    const np = this._neoPos;
    if (np) {
      for (let k = 0; k < this.records.length; k++) {
        positionAt(this.records[k].el, jd, tmpP);
        np.setXYZ(k, tmpP.x * HELIO_SCALE, tmpP.z * HELIO_SCALE, -tmpP.y * HELIO_SCALE);
      }
      np.needsUpdate = true;
    }

    const cp = this._craftPos;
    if (cp && this.showCraft) {
      for (let k = 0; k < this.craft.length; k++) {
        positionAt(this.craft[k].el, jd, tmpP);
        cp.setXYZ(k, tmpP.x * HELIO_SCALE, tmpP.z * HELIO_SCALE, -tmpP.y * HELIO_SCALE);
      }
      cp.needsUpdate = true;
    }
    this.craftPoints.visible = this.showCraft && this.craft.length > 0;
    this.craftTrails.visible = false;

    if (this.selected && this.selected.el && this.selOrbit.visible) {
      positionAt(this.selected.el, jd, tmpP);
      setSegment(this.selRadius, tmpP.x * HELIO_SCALE, tmpP.z * HELIO_SCALE, -tmpP.y * HELIO_SCALE);
    }
  }

  _updateGeo(jd) {
    const e = this.earthPos;
    const k2 = (AU_KM / LD_KM) * GEO_SCALE;

    // Earth sits at the origin; the Sun is opposite the Earth's heliocentric
    // position, which is what puts the terminator in the right place.
    const sunVec = this._sunVec.set(-e.x * k2, -e.z * k2, e.y * k2);
    this._lightGlobe(this.geoEarth, sunVec);
    this._spinEarth(this.geoEarth, jd);

    moonPosition(jd, tmpP);
    this.moonGlobe.position.set(tmpP.x * k2, tmpP.z * k2, -tmpP.y * k2);
    this._lightGlobe(this.moonGlobe, sunVec);

    const gp = this._geoPos;
    if (gp) {
      for (let k = 0; k < this.records.length; k++) {
        positionAt(this.records[k].el, jd, tmpP);
        gp.setXYZ(k, (tmpP.x - e.x) * k2, (tmpP.z - e.z) * k2, -(tmpP.y - e.y) * k2);
      }
      gp.needsUpdate = true;
    }

    // Satellites: SGP4, in km, converted to lunar-distance units.
    const sp = this._satPos;
    if (sp && this.showSats) {
      const kmToUnit = GEO_SCALE / LD_KM;
      for (let k = 0; k < this.sats.length; k++) {
        const p = satPositionEci(this.sats[k], this.date, tmpP);
        if (!p) { this._satAlive[k] = 0; sp.setXYZ(k, 0, 0, 0); continue; }
        this._satAlive[k] = 1;
        // ECI is equatorial; the scene frame is ecliptic, so tilt by the
        // obliquity or every orbit would be inclined 23° wrong.
        sp.setXYZ(k, p.x * kmToUnit, p.z * kmToUnit, -p.y * kmToUnit);
      }
      sp.needsUpdate = true;
    }
    this.satPoints.visible = this.showSats && this.sats.length > 0;

    if (this.selected && this.geoVector.visible) {
      const p = this._targetGeoPos(this.selected);
      if (p) setSegment(this.geoVector, p.x, p.y, p.z);
    }
  }

  /** Scene-space geocentric position of any target kind. */
  _targetGeoPos(t) {
    const e = this.earthPos;
    const k2 = (AU_KM / LD_KM) * GEO_SCALE;
    if (t.kind === 'sat') {
      const p = satPositionEci(t, this.date, tmpP);
      if (!p) return null;
      const s = GEO_SCALE / LD_KM;
      return { x: p.x * s, y: p.z * s, z: -p.y * s };
    }
    if (t.kind === 'moon') {
      return { x: this.moonGlobe.position.x, y: this.moonGlobe.position.y, z: this.moonGlobe.position.z };
    }
    if (t.el) {
      positionAt(t.el, this.jd, tmpP);
      return { x: (tmpP.x - e.x) * k2, y: (tmpP.z - e.z) * k2, z: -(tmpP.y - e.y) * k2 };
    }
    return null;
  }

  /* ---------- picking ---------- */

  /**
   * Project every selectable thing to screen space. One flat list keeps
   * picking and labelling uniform across asteroids, planets, moons,
   * satellites and spacecraft rather than special-casing each.
   */
  _project() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;

    // Pooled: this runs every frame over every selectable object, and
    // allocating a fresh record per target per frame is a few hundred
    // short-lived objects a frame for no benefit. `targetCount` is the
    // live length; entries beyond it are stale and must be ignored.
    const pool = this.targets;
    let n = 0;

    const push = (target, x, y, z) => {
      tmpV.set(x, y, z);
      const dist = tmpV.distanceTo(this.camera.position);
      tmpV.project(this.camera);
      if (tmpV.z >= 1) return;
      let e = pool[n];
      if (!e) { e = pool[n] = { target: null, x: 0, y: 0, d: 0, vis: false }; }
      e.target = target;
      e.x = (tmpV.x * 0.5 + 0.5) * w;
      e.y = (-tmpV.y * 0.5 + 0.5) * h;
      e.d = dist;
      e.vis = Math.abs(tmpV.x) < 1.3 && Math.abs(tmpV.y) < 1.3;
      n++;
    };

    if (this.mode === 'helio') {
      const np = this._neoPos;
      if (np && this.records.length) {
        for (let k = 0; k < this.records.length; k++) {
          push(this.records[k], np.getX(k), np.getY(k), np.getZ(k));
        }
      }
      if (this.showPlanets) {
        for (const name of PLANET_NAMES) {
          const g = this.planetGlobes[name];
          push(this._bodyTarget(name), g.position.x, g.position.y, g.position.z);
        }
        push(this._bodyTarget('Sun'), 0, 0, 0);
      }
      const cp = this._craftPos;
      if (cp && this.showCraft) {
        for (let k = 0; k < this.craft.length; k++) {
          push(this.craft[k], cp.getX(k), cp.getY(k), cp.getZ(k));
        }
      }
    } else {
      const gp = this._geoPos;
      if (gp && this.records.length) {
        for (let k = 0; k < this.records.length; k++) {
          push(this.records[k], gp.getX(k), gp.getY(k), gp.getZ(k));
        }
      }
      push(this._bodyTarget('Earth'), 0, 0, 0);
      push(this._bodyTarget('Moon'),
        this.moonGlobe.position.x, this.moonGlobe.position.y, this.moonGlobe.position.z);

      const sp = this._satPos;
      if (sp && this.showSats) {
        for (let k = 0; k < this.sats.length; k++) {
          if (!this._satAlive[k]) continue;
          push(this.sats[k], sp.getX(k), sp.getY(k), sp.getZ(k));
        }
      }
    }

    this.targetCount = n;
  }

  /** Cached pseudo-record for a planet/moon/sun so it can be a target. */
  _bodyTarget(name) {
    this._bodyTargets = this._bodyTargets || {};
    if (!this._bodyTargets[name]) {
      this._bodyTargets[name] = {
        kind: name === 'Moon' ? 'moon' : (name === 'Sun' ? 'sun' : 'planet'),
        id: 'body-' + name,
        name,
        info: BODY_INFO[name]
      };
    }
    return this._bodyTargets[name];
  }

  pick(px, py, radius = 16) {
    let best = null, bestD = radius * radius;
    for (let i = 0; i < this.targetCount; i++) {
      const t = this.targets[i];
      if (!t.vis) continue;
      const dx = t.x - px, dy = t.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = t; }
    }
    return best ? best.target : null;
  }

  setHovered(t) {
    if (this.hovered === t) return;
    this.hovered = t;
    this.canvas.style.cursor = t ? 'crosshair' : 'grab';
  }

  /* ---------- labels ---------- */

  updateLabels(maxLabels = 10) {
    if (!this.labelLayer) return;

    // Reused scratch array; same reasoning as the pick pool.
    const vis = this._visScratch || (this._visScratch = []);
    vis.length = 0;
    for (let i = 0; i < this.targetCount; i++) {
      if (this.targets[i].vis) vis.push(this.targets[i]);
    }
    vis.sort((a, b) => {
      const pri = (o) => {
        if (o.target === this.selected) return -1e9;
        if (o.target === this.hovered) return -9e8;
        // Named bodies earn a label ahead of anonymous asteroid designations.
        if (o.target.kind === 'planet' || o.target.kind === 'moon' || o.target.kind === 'sun') return -8e8 + o.d;
        if (o.target.kind === 'craft') return -7e8 + o.d;
        return o.d;
      };
      return pri(a) - pri(b);
    });

    // De-collide. Sorted by priority, so the first label to claim a patch of
    // screen keeps it. Without this, objects that genuinely sit on top of one
    // another — JWST is at L2, a hundredth of an AU from Earth — overprint
    // into an unreadable smear.
    const placed = [];
    const ROW_H = 14;
    // The font is monospace at 10.5px, so character count gives the box width
    // exactly. A fixed width would let "ATLAS CENTAUR R/B" overlap its
    // neighbour while needlessly suppressing short designations.
    const CHAR_W = 6.4, PAD = 14;
    const keep = new Set();

    for (const o of vis) {
      if (keep.size >= maxLabels) break;
      const rec = o.target;
      const text = rec.nickname || rec.name || '';
      const w = text.length * CHAR_W + PAD;

      const clash = placed.some(p =>
        Math.abs(p.y - o.y) < ROW_H &&
        o.x < p.x + p.w && p.x < o.x + w);

      // The locked target always gets its label, collision or not.
      if (clash && rec !== this.selected) continue;
      placed.push({ x: o.x, y: o.y, w });
      keep.add(rec);
      let el = this._labels.get(rec);
      if (!el) {
        el = document.createElement('div');
        el.className = 'vp-label';
        this.labelLayer.appendChild(el);
        this._labels.set(rec, el);
      }
      el.textContent = rec.nickname || rec.name;
      el.classList.toggle('is-sel', rec === this.selected);
      el.classList.toggle('is-pha', !!rec.pha);
      el.classList.toggle('is-body', rec.kind === 'planet' || rec.kind === 'moon' || rec.kind === 'sun');
      el.classList.toggle('is-craft', rec.kind === 'craft' || rec.kind === 'sat');
      el.style.transform = `translate(${Math.round(o.x)}px, ${Math.round(o.y)}px)`;
    }

    for (const [rec, el] of this._labels) {
      if (!keep.has(rec)) { el.remove(); this._labels.delete(rec); }
    }
  }

  /* ---------- render ---------- */

  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    this.rtScene.setSize(pw, ph);
    const bw = Math.max(1, pw >> 1), bh = Math.max(1, ph >> 1);
    this.rtA.setSize(bw, bh);
    this.rtB.setSize(bw, bh);

    this.matThresh.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    this.matBlurV.uniforms.uTexel.value.set(1 / bw, 1 / bh);
    this.matCrt.uniforms.uRes.value.set(w, h);

    for (const m of [this.starMat, this.neoMat, this.geoMat, this.craftMat, this.satMat]) {
      if (m) m.uniforms.uDpr.value = dpr;
    }
  }

  render(time, flicker) {
    const r = this.renderer;
    this.matCrt.uniforms.uTime.value = time;
    this.matCrt.uniforms.uFlicker.value = flicker;

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

    this.quadMesh.material = this.matThresh;
    r.setRenderTarget(this.rtA);
    r.render(this.quadScene, this.quadCam);

    this.quadMesh.material = this.matBlurV;
    r.setRenderTarget(this.rtB);
    r.render(this.quadScene, this.quadCam);

    this.quadMesh.material = this.matCrt;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}
