/* =========================================================
   BODIES — planets, moons, and the low-poly globe builder.

   The globes are deliberately faceted. An icosphere is built by
   subdividing an icosahedron, kept non-indexed so every triangle
   owns its vertices, then each face is coloured whole — land or
   ocean for Earth, flat tint for everything else. Flat-shading a
   non-indexed mesh is what produces the low-poly look; a smooth
   normal would average the facets away.

   Continents come from a committed equirectangular bitmask
   (data/earth-land.json) rather than from geometry, so the
   subdivision level can change without touching the data.
   ========================================================= */

import * as THREE from 'three';
import { OBLIQUITY } from './astro.js?v=14';

const DEG = Math.PI / 180;

/* ---------------------------------------------------------
   Physical and display data

   Radii are equatorial, in km (IAU 2015). `tint` is the body's
   real approximate colour; these survive the phosphor collapse
   so the planets read as planets in every scheme.
   --------------------------------------------------------- */
export const BODY_INFO = {
  Mercury: {
    radiusKm: 2439.7, tint: 0x9c9188, day: '58.6 d', moons: 0,
    blurb: 'Smallest planet, and the one with the most extreme temperature swing — ' +
           'about 430 °C in sunlight and −180 °C at night, because there is almost no atmosphere to hold heat.'
  },
  Venus: {
    radiusKm: 6051.8, tint: 0xe8cf9a, day: '243 d retrograde', moons: 0,
    blurb: 'Hottest planet at about 465 °C, hot enough to melt lead. Not because it is closest to the Sun, ' +
           'but because a dense CO₂ atmosphere traps the heat.'
  },
  Earth: {
    radiusKm: 6371.0, tint: 0x2f7fd0, day: '23 h 56 m', moons: 1,
    blurb: 'The only place any of these objects has ever been observed from.'
  },
  Mars: {
    radiusKm: 3389.5, tint: 0xc1552c, day: '24 h 37 m', moons: 2,
    blurb: 'Home to Olympus Mons, roughly three times the height of Everest. Its rust colour is iron oxide dust.'
  },
  Jupiter: {
    radiusKm: 69911, tint: 0xd6bb92, day: '9 h 56 m', moons: 95,
    blurb: 'More massive than every other planet combined. Its gravity shapes the asteroid belt ' +
           'and deflects or captures many inbound comets.'
  },
  Saturn: {
    radiusKm: 58232, tint: 0xe3d3a8, day: '10 h 34 m', moons: 274,
    blurb: 'Less dense than water. The rings are mostly water ice, and are likely far younger than the planet.'
  },
  Moon: {
    radiusKm: 1737.4, tint: 0xa8a49c, day: '27.3 d (tidally locked)', moons: 0,
    blurb: 'The yardstick for close approaches: one lunar distance is about 384 400 km. ' +
           'Most "near" misses are many times farther away than this.'
  },
  Sun: {
    radiusKm: 695700, tint: 0xffc133, day: '~25 d at the equator', moons: 0,
    blurb: 'Holds 99.86% of the mass of the solar system. Every orbit on this display is a fall around it.'
  }
};

/* ---------------------------------------------------------
   Icosphere
   --------------------------------------------------------- */

const T = (1 + Math.sqrt(5)) / 2;

const ICO_VERTS = [
  [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
  [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
  [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1]
];

const ICO_FACES = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
];

function norm(v) {
  const L = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / L, v[1] / L, v[2] / L];
}

function mid(a, b) { return norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]); }

/**
 * Subdivided icosahedron as a flat list of triangles on the unit sphere.
 * Returns non-indexed positions plus each face's centroid direction, which
 * is what the land mask gets sampled with.
 */
export function icosphere(subdiv = 3) {
  let faces = ICO_FACES.map(f => f.map(i => norm(ICO_VERTS[i])));

  for (let s = 0; s < subdiv; s++) {
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    faces = next;
  }

  const pos = new Float32Array(faces.length * 9);
  const centroid = new Float32Array(faces.length * 3);
  for (let f = 0; f < faces.length; f++) {
    const [a, b, c] = faces[f];
    pos.set([...a, ...b, ...c], f * 9);
    const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const n = norm([cx, cy, cz]);
    centroid.set(n, f * 3);
  }
  return { positions: pos, centroid, faceCount: faces.length };
}

/* ---------------------------------------------------------
   Land mask
   --------------------------------------------------------- */

export class LandMask {
  constructor(doc) {
    this.w = doc.width;
    this.h = doc.height;
    const bin = atob(doc.bits);
    this.bits = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) this.bits[i] = bin.charCodeAt(i);
  }

  /** lon in [-180,180], lat in [-90,90]. */
  isLand(lon, lat) {
    let x = Math.floor(((lon + 180) / 360) * this.w);
    let y = Math.floor(((90 - lat) / 180) * this.h);
    x = ((x % this.w) + this.w) % this.w;
    y = Math.min(this.h - 1, Math.max(0, y));
    const i = y * this.w + x;
    return (this.bits[i >> 3] >> (7 - (i & 7))) & 1;
  }

  /**
   * Sample from a direction in body-fixed coordinates, where +Y is the
   * north pole and longitude is measured from +X.
   */
  isLandDir(x, y, z) {
    const lat = Math.asin(Math.max(-1, Math.min(1, y))) / DEG;
    const lon = Math.atan2(z, x) / DEG;
    return this.isLand(lon, lat);
  }
}

export async function loadLandMask(url = './data/earth-land.json') {
  const doc = await fetch(url).then(r => r.json());
  return new LandMask(doc);
}

/* ---------------------------------------------------------
   Globe geometry + material
   --------------------------------------------------------- */

/**
 * Build a unit-radius globe. When a land mask is supplied each face is
 * coloured ocean or land; otherwise the whole body takes `tint` with a
 * small per-face brightness jitter so the facets stay visible rather than
 * flattening into a silhouette.
 */
export function globeGeometry(subdiv, tint, landMask, oceanHex, landHex) {
  const { positions, centroid, faceCount } = icosphere(subdiv);
  const colors = new Float32Array(faceCount * 9);

  const base = new THREE.Color(tint);
  const ocean = new THREE.Color(oceanHex ?? 0x1e6fc4);
  const land = new THREE.Color(landHex ?? 0x3f9b5c);

  // Deterministic jitter: a fixed sky and a fixed planet, every load.
  let s = 22222;
  const rand = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };

  for (let f = 0; f < faceCount; f++) {
    const cx = centroid[f * 3], cy = centroid[f * 3 + 1], cz = centroid[f * 3 + 2];
    let col;
    if (landMask) {
      col = landMask.isLandDir(cx, cy, cz) ? land : ocean;
    } else {
      col = base;
    }
    const j = 0.88 + rand() * 0.24;
    const r = col.r * j, g = col.g * j, b = col.b * j;
    for (let v = 0; v < 3; v++) {
      colors[f * 9 + v * 3] = r;
      colors[f * 9 + v * 3 + 1] = g;
      colors[f * 9 + v * 3 + 2] = b;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();   // non-indexed → true face normals
  return geo;
}

/**
 * Flat-shaded globe material.
 *
 * Writes alpha = 1, which is the chroma mask the CRT composite reads: a
 * pixel with alpha 1 keeps its own colour instead of being collapsed onto
 * the phosphor. That is what lets Earth stay blue on a green tube.
 */
export function globeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uAmbient: { value: 0.16 },
      uGain: { value: 1.0 }
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vColor;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir;
      uniform float uAmbient;
      uniform float uGain;
      varying vec3 vNormal;
      varying vec3 vColor;
      void main() {
        // uSunDir arrives in view space so the terminator tracks the real
        // Sun rather than the camera.
        float d = max(0.0, dot(normalize(vNormal), normalize(uSunDir)));
        float light = uAmbient + (1.0 - uAmbient) * d;
        // Alpha 1 marks this pixel as "keep my colour" for the CRT pass.
        gl_FragColor = vec4(vColor * light * uGain, 1.0);
      }
    `,
    vertexColors: true,
    transparent: false,
    depthWrite: true,
    depthTest: true
  });
}

/** Thin edge overlay so a globe still reads as a vector object. */
export function globeEdges(geo, color, opacity) {
  const edges = new THREE.EdgesGeometry(geo, 24);
  return new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
  }));
}

/**
 * Earth's rotation axis in scene coordinates.
 *
 * The scene maps ecliptic (x, y, z) to (x, z, -y). The north celestial pole
 * sits at ecliptic (0, -sin ε, cos ε), which lands here.
 */
export function earthAxis() {
  const e = OBLIQUITY * DEG;
  return new THREE.Vector3(0, Math.cos(e), Math.sin(e)).normalize();
}
