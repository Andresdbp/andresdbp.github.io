/* =========================================================
   SATELLITES — the human-made objects in Earth orbit.

   CelesTrak IS CORS-enabled (unlike every JPL SSD endpoint), so
   these elements are fetched live in the browser. A committed
   snapshot is the fallback, and it is labelled as stale when used:
   TLEs lose accuracy within days, so an old set is genuinely worse
   data rather than merely older data.

   Propagation is SGP4 via satellite.js. That matters — a TLE's mean
   elements are not Keplerian osculating elements. Feeding them to a
   two-body solver ignores J2 nodal precession, which for a low-Earth
   orbit is around 5° per day, so positions would be visibly wrong
   within hours and grossly wrong within a week.
   ========================================================= */

import * as satellite from 'satellite.js';
import { EARTH_R_KM, gmst } from './astro.js?v=14';

const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';
const CACHE_KEY = 'neo.sats.v1';
const CACHE_TTL_MS = 3 * 3600 * 1000;   // TLEs age fast; 3 h, not 6

/**
 * Rough class from the orbit's mean motion, in revolutions per day.
 * Used only for colour-coding and the data sheet.
 */
function regime(meanMotion) {
  if (meanMotion > 11.25) return { code: 'LEO', name: 'Low Earth orbit' };
  if (meanMotion > 2.0) return { code: 'MEO', name: 'Medium Earth orbit' };
  if (meanMotion > 0.9) return { code: 'GEO', name: 'Geosynchronous' };
  return { code: 'HEO', name: 'High / highly elliptical' };
}

function makeSat(gp) {
  let satrec;
  try {
    satrec = satellite.json2satrec
      ? satellite.json2satrec(gp)
      : satellite.twoline2satrec(gp.TLE_LINE1, gp.TLE_LINE2);
  } catch (e) {
    return null;
  }
  if (!satrec || satrec.error) return null;

  const reg = regime(gp.MEAN_MOTION);
  return {
    kind: 'sat',
    id: 'sat-' + gp.NORAD_CAT_ID,
    norad: gp.NORAD_CAT_ID,
    name: (gp.OBJECT_NAME || '').trim(),
    intlDes: gp.OBJECT_ID,
    satrec,
    epochIso: gp.EPOCH,
    meanMotion: gp.MEAN_MOTION,
    ecc: gp.ECCENTRICITY,
    inc: gp.INCLINATION,
    revs: gp.REV_AT_EPOCH,
    regime: reg,
    periodMin: gp.MEAN_MOTION > 0 ? 1440 / gp.MEAN_MOTION : null
  };
}

/* ---------- fetching ---------- */

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!raw || !Number.isFinite(raw.t)) return null;
    if (Date.now() - raw.t > CACHE_TTL_MS) return null;
    if (!Array.isArray(raw.gp) || !raw.gp.length) return null;
    return raw;
  } catch (e) { return null; }
}

function writeCache(gp) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), gp })); }
  catch (e) { /* quota — optional */ }
}

/**
 * Live element sets. `groups` are CelesTrak's own catalogue groupings;
 * "stations" is the ISS and friends, "visual" is the ~170 brightest
 * objects, which is the set worth showing on a display like this.
 */
export async function fetchSatellites(groups = ['stations', 'visual'], { useCache = true } = {}) {
  if (useCache) {
    const hit = readCache();
    if (hit) {
      return {
        objects: hit.gp.map(makeSat).filter(Boolean),
        meta: { live: false, cached: true, ageMs: Date.now() - hit.t }
      };
    }
  }

  const byId = new Map();
  for (const g of groups) {
    const url = `${CELESTRAK}?GROUP=${encodeURIComponent(g)}&FORMAT=json`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`CelesTrak HTTP ${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('CelesTrak returned no element sets');
    for (const s of rows) byId.set(s.NORAD_CAT_ID, s);
  }

  const gp = [...byId.values()];
  writeCache(gp);
  return {
    objects: gp.map(makeSat).filter(Boolean),
    meta: { live: true, cached: false, count: gp.length }
  };
}

export async function loadSatelliteFallback(url = './data/satellites-fallback.json') {
  const doc = await fetch(url).then(r => r.json());
  return {
    objects: (doc.objects || []).map(makeSat).filter(Boolean),
    meta: { live: false, cached: false, snapshot: true, retrieved: doc._retrieved }
  };
}

/* ---------- propagation ---------- */

/**
 * Earth-centred INERTIAL position in km at a given Date.
 *
 * Deliberately ECI, not ECEF: the scene's geocentric frame is inertial
 * (it is where asteroid approach geometry lives), and the globe itself is
 * spun by GMST to match. Converting satellites to an Earth-fixed frame
 * here would double-count that rotation and smear every orbit into a
 * spiral.
 *
 * Returns null when SGP4 reports a decayed or unpropagatable element set.
 */
export function satPositionEci(sat, date, out) {
  out = out || { x: 0, y: 0, z: 0 };
  let pv;
  try {
    pv = satellite.propagate(sat.satrec, date);
  } catch (e) {
    return null;
  }
  const p = pv && pv.position;
  if (!p || !Number.isFinite(p.x)) return null;
  out.x = p.x; out.y = p.y; out.z = p.z;   // km, TEME ≈ ECI for our purposes
  return out;
}

/** Altitude above mean sea level in km, and ground speed, for the data sheet. */
export function satState(sat, date) {
  let pv;
  try { pv = satellite.propagate(sat.satrec, date); } catch (e) { return null; }
  if (!pv || !pv.position || !Number.isFinite(pv.position.x)) return null;

  const { position: p, velocity: v } = pv;
  const r = Math.hypot(p.x, p.y, p.z);
  const speed = v ? Math.hypot(v.x, v.y, v.z) : null;

  let lat = null, lon = null, altKm = r - EARTH_R_KM;
  try {
    const g = satellite.eciToGeodetic(p, gmst(date.getTime() / 86400000 + 2440587.5));
    lat = satellite.degreesLat(g.latitude);
    lon = satellite.degreesLong(g.longitude);
    altKm = g.height;
  } catch (e) { /* fall back to the radial estimate above */ }

  return { rKm: r, altKm, speedKmS: speed, lat, lon };
}
