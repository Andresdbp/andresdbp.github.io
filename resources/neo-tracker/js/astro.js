/* =========================================================
   ASTRO — two-body orbital mechanics for the NEO terminal.

   Everything here works in heliocentric ecliptic J2000
   coordinates, distances in AU, angles in degrees on the way
   in and radians internally.

   The elements NASA hands us are *osculating* elements: the
   ellipse the body would follow if the Sun were the only
   thing pulling on it. Real NEOs get perturbed by the planets
   (and, for the small ones, by thermal recoil). Positions
   computed here are good for days-to-weeks near the element
   epoch and drift steadily after that. Nothing in this file
   is an impact prediction — see JPL Sentry for that.
   ========================================================= */

export const AU_KM = 149597870.7;      // IAU 2012 definition, exact
export const LD_KM = 384400;           // mean Earth-Moon distance
export const EARTH_R_KM = 6371.0084;   // volumetric mean radius
export const GEO_ALT_KM = 42164;       // geostationary orbit radius
export const K_GAUSS = 0.01720209895;  // Gaussian gravitational constant, rad/day

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const J2000 = 2451545.0;

/* ---------------------------------------------------------
   Time

   These are UTC-based Julian dates, while element epochs are
   TDB. The two differ by ~69 s. At NEO mean motions (~1 deg/day)
   that is under a milliarcsecond of mean anomaly, i.e. far
   below the uncertainty in the elements themselves, so no
   conversion is applied.
   --------------------------------------------------------- */
export function jdFromDate(d) { return d.getTime() / 86400000 + 2440587.5; }
export function dateFromJd(jd) { return new Date((jd - 2440587.5) * 86400000); }

/* --------------------------------------------------------- */

function wrapPi(x) {                    // → (-π, π]
  x = x % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
}

/**
 * Kepler's equation, elliptical case: M = E - e·sin E.
 *
 * Newton-Raphson diverges for e→1 when started at M, so the
 * starting guess is the standard e-aware one and the step is
 * capped. Falls back to bisection if Newton wanders, which it
 * can for e > 0.99 — real objects in the feed reach e ≈ 0.99.
 */
export function solveKeplerElliptic(M, e) {
  M = wrapPi(M);
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);

  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    if (Math.abs(fp) < 1e-12) break;
    let dE = f / fp;
    if (dE > 0.9) dE = 0.9;             // cap the step; prevents overshoot near e≈1
    if (dE < -0.9) dE = -0.9;
    E -= dE;
    if (Math.abs(dE) < 1e-12) return E;
  }

  // Newton did not settle — bisect, which cannot fail here because
  // E - e·sin E - M is monotonic in E.
  let lo = M - 1, hi = M + 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid - e * Math.sin(mid) - M > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Hyperbolic Kepler: M = e·sinh F - F. Rare but real — some feed objects have e > 1. */
export function solveKeplerHyperbolic(M, e) {
  let F = Math.sign(M || 1) * Math.log(2 * Math.abs(M) / e + 1.8);
  for (let i = 0; i < 100; i++) {
    const f = e * Math.sinh(F) - F - M;
    const fp = e * Math.cosh(F) - 1;
    if (Math.abs(fp) < 1e-12) break;
    let dF = f / fp;
    if (dF > 1) dF = 1;
    if (dF < -1) dF = -1;
    F -= dF;
    if (Math.abs(dF) < 1e-13) break;
  }
  return F;
}

/**
 * Perifocal basis vectors P (toward perihelion) and Q (90° ahead
 * in the orbit plane), rotated into ecliptic J2000 by the usual
 * Rz(Ω)·Rx(i)·Rz(ω). Computing these once per object and reusing
 * them for every sampled point is what makes redrawing 300 orbits
 * per frame affordable.
 */
export function perifocalBasis(iDeg, omDeg, wDeg) {
  const i = iDeg * DEG, O = omDeg * DEG, w = wDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(w), sw = Math.sin(w);
  return {
    Px: cO * cw - sO * sw * ci,
    Py: sO * cw + cO * sw * ci,
    Pz: sw * si,
    Qx: -cO * sw - sO * cw * ci,
    Qy: -sO * sw + cO * cw * ci,
    Qz: cw * si
  };
}

/**
 * Normalize whatever the two APIs hand us into one element set.
 * NeoWs uses long names and strings; JPL SBDB uses short names and
 * numbers. Missing mean motion is derived from Kepler's third law.
 */
export function normalizeElements(raw) {
  const num = (v) => {
    const x = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(x) ? x : null;
  };
  const a = num(raw.a ?? raw.semi_major_axis);
  const e = num(raw.e ?? raw.eccentricity);
  const i = num(raw.i ?? raw.inclination);
  const om = num(raw.om ?? raw.ascending_node_longitude);
  const w = num(raw.w ?? raw.perihelion_argument);
  const ma = num(raw.ma ?? raw.mean_anomaly);
  const epoch = num(raw.epoch ?? raw.epoch_osculation);
  let n = num(raw.n ?? raw.mean_motion);

  if (a === null || e === null || i === null || om === null || w === null ||
      ma === null || epoch === null) return null;

  // n from Kepler III when absent. |a| because a < 0 on hyperbolic orbits.
  if (n === null || !(n > 0)) n = (K_GAUSS / Math.pow(Math.abs(a), 1.5)) / DEG;

  // JPL reports a < 0 for hyperbolic orbits and the perifocal formulae below
  // depend on that sign. A feed that ever hands us e > 1 with a positive a
  // would otherwise reflect the orbit through the Sun — a plausible-looking
  // but completely wrong trajectory. Normalise rather than trust it.
  const aSigned = e >= 1 ? -Math.abs(a) : Math.abs(a);

  const el = { a: aSigned, e, i, om, w, ma, epoch, n };
  Object.assign(el, perifocalBasis(i, om, w));
  return el;
}

/**
 * Heliocentric ecliptic position at Julian date `jd`, in AU.
 * Writes into `out` to keep this allocation-free inside the
 * animation loop.
 */
export function positionAt(el, jd, out) {
  out = out || { x: 0, y: 0, z: 0 };
  const dt = jd - el.epoch;
  const e = el.e;
  let xp, yp;

  if (e < 1) {
    const M = (el.ma + el.n * dt) * DEG;
    const E = solveKeplerElliptic(M, e);
    xp = el.a * (Math.cos(E) - e);
    yp = el.a * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    // JPL reports a < 0 for hyperbolic orbits; the signs below assume that.
    const M = (el.ma + el.n * dt) * DEG;
    const F = solveKeplerHyperbolic(M, e);
    xp = el.a * (Math.cosh(F) - e);
    yp = -el.a * Math.sqrt(e * e - 1) * Math.sinh(F);
  }

  out.x = xp * el.Px + yp * el.Qx;
  out.y = xp * el.Py + yp * el.Qy;
  out.z = xp * el.Pz + yp * el.Qz;
  return out;
}

/**
 * Sample the orbit into a closed path of `n` points, as a flat
 * Float32Array of xyz triples ready for a Three.js BufferGeometry.
 *
 * Sampling is uniform in eccentric anomaly rather than true anomaly:
 * that concentrates points near perihelion, which is exactly where a
 * high-eccentricity orbit turns sharply. Uniform-in-true-anomaly
 * sampling visibly cuts the corner on the e ≈ 0.9 objects.
 */
export function orbitPath(el, n = 192) {
  const pts = new Float32Array(n * 3);
  const e = el.e;

  if (e >= 1) {
    // Open orbit: sweep the hyperbola over the range that stays inside
    // a few AU, otherwise the line shoots off to infinity and the whole
    // scene auto-scales to nothing.
    //
    // The argument to acosh must be >= 1. For a hyperbola whose perihelion
    // already lies beyond the 6 AU cut, (1 + 6/|a|)/e falls below 1 and
    // acosh returns NaN, which poisons the entire vertex buffer and blanks
    // every orbit sharing it. Clamp instead.
    const Fmax = Math.acosh(Math.max(1.0001, Math.min(60, (1 + 6 / Math.abs(el.a)) / e)));
    for (let k = 0; k < n; k++) {
      const F = -Fmax + (2 * Fmax * k) / (n - 1);
      const xp = el.a * (Math.cosh(F) - e);
      const yp = -el.a * Math.sqrt(e * e - 1) * Math.sinh(F);
      pts[k * 3] = xp * el.Px + yp * el.Qx;
      pts[k * 3 + 1] = xp * el.Py + yp * el.Qy;
      pts[k * 3 + 2] = xp * el.Pz + yp * el.Qz;
    }
    return pts;
  }

  const b = el.a * Math.sqrt(1 - e * e);
  for (let k = 0; k < n; k++) {
    const E = (TAU * k) / n;
    const xp = el.a * (Math.cos(E) - e);
    const yp = b * Math.sin(E);
    pts[k * 3] = xp * el.Px + yp * el.Qx;
    pts[k * 3 + 1] = xp * el.Py + yp * el.Qy;
    pts[k * 3 + 2] = xp * el.Pz + yp * el.Qz;
  }
  return pts;
}

/* ---------------------------------------------------------
   Planets

   JPL's "Keplerian Elements for Approximate Positions of the
   Major Planets" (Standish), the 1800-2050 element set. Each
   row is [a, e, I, L, longPeri, longNode] followed by the same
   six as rates per Julian century.

   Accuracy is arcminutes — far better than needed to place a
   planet ring on a phosphor display, and it means the planets
   move correctly as you scrub time instead of being frozen at
   J2000. "Earth" here is really the Earth-Moon barycentre,
   which sits within 4700 km of Earth's centre.
   --------------------------------------------------------- */
const PLANET_TABLE = {
  Mercury: [[0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
            [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]],
  Venus:   [[0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
            [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418]],
  Earth:   [[1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
            [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0]],
  Mars:    [[1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
            [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]],
  Jupiter: [[5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
            [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]],
  Saturn:  [[9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
            [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]]
};

export const PLANET_NAMES = Object.keys(PLANET_TABLE);

/** Element set for a planet at `jd`, in the same shape as normalizeElements(). */
export function planetElements(name, jd) {
  const [c, r] = PLANET_TABLE[name];
  const T = (jd - J2000) / 36525;

  const a = c[0] + r[0] * T;
  const e = c[1] + r[1] * T;
  const i = c[2] + r[2] * T;
  const L = c[3] + r[3] * T;
  const lp = c[4] + r[4] * T;
  const om = c[5] + r[5] * T;

  const w = lp - om;                       // argument of perihelion
  let ma = (L - lp) % 360;                 // mean anomaly at this epoch
  if (ma > 180) ma -= 360;
  if (ma < -180) ma += 360;

  const el = { a, e, i, om, w, ma, epoch: jd, n: (K_GAUSS / Math.pow(a, 1.5)) / DEG };
  Object.assign(el, perifocalBasis(i, om, w));
  return el;
}

/** Heliocentric position of a planet at `jd`, AU. */
export function planetPosition(name, jd, out) {
  return positionAt(planetElements(name, jd), jd, out);
}

/* ---------------------------------------------------------
   The Moon

   Truncated lunar theory from the Astronomical Almanac's
   low-precision section: good to roughly 0.3° in longitude and
   0.2° in latitude, which is a few hundred km at lunar distance.
   That is far below the width of the ring it draws, and it means
   the Moon is in the right place relative to the Sun, so its
   phase and its position along Earth's orbit both read correctly.
   Nothing here is quoted as a number; it is a reference marker.
   --------------------------------------------------------- */

/** Geocentric ecliptic position of the Moon at `jd`, in AU. */
export function moonPosition(jd, out) {
  out = out || { x: 0, y: 0, z: 0 };
  const T = (jd - J2000) / 36525;
  const sin = (deg) => Math.sin(deg * DEG);
  const cos = (deg) => Math.cos(deg * DEG);

  const lon = 218.32 + 481267.881 * T
    + 6.29 * sin(477198.87 * T + 135.0)
    - 1.27 * sin(-413335.38 * T + 259.3)
    + 0.66 * sin(890534.22 * T + 235.7)
    + 0.21 * sin(954397.74 * T + 269.9)
    - 0.19 * sin(35999.05 * T + 357.5)
    - 0.11 * sin(966404.03 * T + 186.6);

  const lat = 5.13 * sin(483202.02 * T + 93.3)
    + 0.28 * sin(960400.89 * T + 228.2)
    - 0.28 * sin(6003.15 * T + 318.3)
    - 0.17 * sin(-407332.21 * T + 217.6);

  const par = 0.9508
    + 0.0518 * cos(477198.85 * T + 135.0)
    + 0.0095 * cos(-413335.38 * T + 259.3)
    + 0.0078 * cos(890534.23 * T + 235.7)
    + 0.0028 * cos(954397.70 * T + 269.9);

  const rKm = EARTH_R_KM / Math.sin(par * DEG);
  const r = rKm / AU_KM;

  const cb = Math.cos(lat * DEG);
  out.x = r * cb * Math.cos(lon * DEG);
  out.y = r * cb * Math.sin(lon * DEG);
  out.z = r * Math.sin(lat * DEG);
  return out;
}

/** Illuminated fraction of the Moon's disc, 0 (new) to 1 (full). */
export function moonPhase(jd) {
  const m = moonPosition(jd);
  const e = planetPosition('Earth', jd);
  // Sun relative to Earth.
  const sx = -e.x, sy = -e.y, sz = -e.z;
  const ms = Math.hypot(m.x, m.y, m.z), ss = Math.hypot(sx, sy, sz);
  const cosElong = (m.x * sx + m.y * sy + m.z * sz) / (ms * ss);
  return (1 - cosElong) / 2;
}

/* ---------------------------------------------------------
   Earth orientation
   --------------------------------------------------------- */

/** Obliquity of the ecliptic at J2000, degrees. */
export const OBLIQUITY = 23.43928;

/**
 * Greenwich Mean Sidereal Time in radians (IAU 1982 series).
 *
 * This is what puts the right face of Earth toward the viewer: without it
 * the continents would sit in a fixed orientation while the planet moved,
 * and the geocentric view could not honestly show which hemisphere an
 * approaching object is over.
 */
export function gmst(jd) {
  const T = (jd - J2000) / 36525;
  let s = 67310.54841 +
          (876600 * 3600 + 8640184.812866) * T +
          0.093104 * T * T -
          6.2e-6 * T * T * T;          // seconds of time
  s = ((s % 86400) + 86400) % 86400;
  return (s / 86400) * TAU;
}

/**
 * Sub-solar longitude/latitude on Earth: the point where the Sun is
 * directly overhead. Drives the day/night terminator.
 */
export function subsolarPoint(jd) {
  const e = planetPosition('Earth', jd);
  // Direction from Earth to Sun, in ecliptic coordinates.
  const sx = -e.x, sy = -e.y, sz = -e.z;
  const eps = OBLIQUITY * DEG;
  // Ecliptic → equatorial.
  const ex = sx;
  const ey = sy * Math.cos(eps) - sz * Math.sin(eps);
  const ez = sy * Math.sin(eps) + sz * Math.cos(eps);
  const ra = Math.atan2(ey, ex);
  const dec = Math.atan2(ez, Math.hypot(ex, ey));
  let lon = (ra - gmst(jd)) / DEG;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lon, lat: dec / DEG };
}

/* --------------------------------------------------------- */

/** Distance between two AU-space points, in AU. */
export function distance(p, q) {
  const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Geocentric distance of an object at `jd`, in AU.
 * Pass a cached Earth position to avoid recomputing it per object.
 */
export function geoDistance(el, jd, earthPos) {
  const p = positionAt(el, jd);
  return distance(p, earthPos || planetPosition('Earth', jd));
}

/**
 * Refine a close-approach time by golden-section search on geocentric
 * distance. NeoWs gives the approach time to the minute, which is
 * plenty, but for the JPL snapshot objects (and for any time the user
 * scrubs to) we need to find the minimum ourselves.
 */
export function findCloseApproach(el, jdGuess, windowDays = 4) {
  const f = (t) => geoDistance(el, t);
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = jdGuess - windowDays, hi = jdGuess + windowDays;
  let c = hi - phi * (hi - lo), d = lo + phi * (hi - lo);
  let fc = f(c), fd = f(d);

  for (let k = 0; k < 90 && hi - lo > 1e-7; k++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = f(c); }
    else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = f(d); }
  }
  const t = (lo + hi) / 2;
  return { jd: t, dist: f(t) };
}

/**
 * Diameter range implied by absolute magnitude H and an albedo range.
 * D(km) = 1329 / sqrt(albedo) * 10^(-H/5).
 *
 * This is the formula NeoWs itself uses, with albedo bracketed at
 * 0.25 / 0.05. The width of that bracket is the honest point: a
 * dark object and a bright object of the same H differ in diameter
 * by more than a factor of two, and almost no NEO has a measured
 * albedo. Never quote a single number from H alone.
 */
export function diameterFromH(H, albedoMin = 0.05, albedoMax = 0.25) {
  if (!Number.isFinite(H)) return null;
  const d = (p) => (1329 / Math.sqrt(p)) * Math.pow(10, -H / 5);
  return { min: d(albedoMax), max: d(albedoMin) };
}

/**
 * Kinetic energy of an impact, in megatons TNT, assuming a stony
 * body at 2600 kg/m³. Order-of-magnitude only — it is the energy the
 * object *carries*, not what would reach the ground, and most of this
 * class of object breaks up in the atmosphere.
 */
export function impactEnergyMt(diameterKm, vKmPerSec) {
  if (!(diameterKm > 0) || !(vKmPerSec > 0)) return null;
  const r = (diameterKm * 1000) / 2;
  const mass = 2600 * (4 / 3) * Math.PI * r * r * r;   // kg
  const v = vKmPerSec * 1000;                          // m/s
  return (0.5 * mass * v * v) / 4.184e15;              // J → megatons
}
