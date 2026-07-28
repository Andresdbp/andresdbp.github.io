/* =========================================================
   DATA — where the numbers come from.

   Two sources, and they are not interchangeable:

   NASA NeoWs (api.nasa.gov) is CORS-enabled, so the browser
   fetches it live. It carries close-approach circumstances
   AND full osculating elements, which is what lets the 3D
   view show real orbits rather than decorative ones.

   JPL SSD (ssd-api.jpl.nasa.gov) sends no Access-Control-Allow-Origin
   header on any endpoint — cad.api, sbdb.api, sbdb_query.api and
   horizons.api were all tested from a browser and all fail. A page
   on a static host cannot read it. Those records are therefore
   fetched server-side and committed under data/ with a retrieval
   date. The app still probes the live endpoint once per session and
   reports honestly which path it is on.
   ========================================================= */

import { normalizeElements, diameterFromH } from './astro.js?v=15';

const CACHE_KEY = 'neo.cache.v1';
const KEY_KEY = 'neo.apikey';
const CACHE_TTL_MS = 6 * 3600 * 1000;

export const DEMO_KEY = 'DEMO_KEY';

/* ---------- API key ---------- */

export function getApiKey() {
  try { return localStorage.getItem(KEY_KEY) || DEMO_KEY; } catch (e) { return DEMO_KEY; }
}

export function setApiKey(k) {
  try {
    if (k && k.trim()) localStorage.setItem(KEY_KEY, k.trim());
    else localStorage.removeItem(KEY_KEY);
  } catch (e) { /* private browsing */ }
}

/* ---------- cache ---------- */

function readCache(id) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    const hit = all[id];
    if (!hit) return null;
    if (!Number.isFinite(hit.t) || Date.now() - hit.t > CACHE_TTL_MS) return null;
    // localStorage is editable by anything running on this origin, and a
    // half-written or hand-edited entry should not be presentable as a NASA
    // response. Require a non-empty array of objects that at least carry a
    // designation; anything else is discarded as if the cache were cold.
    const p = hit.payload;
    if (!Array.isArray(p) || !p.length) return null;
    if (!p.every(o => o && typeof o === 'object' && (o.id != null || o.name))) return null;
    return hit;
  } catch (e) { return null; }
}

function writeCache(id, payload) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    all[id] = { t: Date.now(), payload };
    // keep only the four most recent windows; NeoWs responses are ~250 kB each
    const keys = Object.keys(all).sort((a, b) => all[b].t - all[a].t).slice(0, 4);
    const trimmed = {};
    for (const k of keys) trimmed[k] = all[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch (e) { /* quota or private browsing — cache is optional */ }
}

export function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { }
}

/* ---------- dates ---------- */

export function isoDate(d) { return d.toISOString().slice(0, 10); }

export function addDays(d, n) {
  const c = new Date(d.getTime());
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

/* ---------- record shape ---------- */

/**
 * One NEO, normalized. `missAu` and friends are NASA's *published*
 * close-approach values and are the numbers shown to the user. The
 * `el` element set drives the 3D position only. Keeping those two
 * separate matters: two-body propagation reproduces published miss
 * distances to ~0.03% near the element epoch but drifts badly over
 * years, so it must never be the source of a quoted distance.
 */
function makeRecord(o, source) {
  const el = normalizeElements(o);
  const inferred = diameterFromH(o.H);

  // SBDB returns several of these as JSON strings ("6599") while NeoWs
  // returns numbers. Number.isFinite('6599') is false, so without this the
  // affected rows silently rendered as em-dashes for every JPL object.
  const num = (v) => {
    const x = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(x) ? x : null;
  };

  // Trim BEFORE stripping the wrapping parens: SBDB pads fullname with
  // leading spaces, which would make the anchored regex miss.
  const rawName = String(o.name || o.fullname || o.des || '').trim();

  return {
    id: o.id || o.des,
    name: rawName.replace(/^\(([^()]*)\)$/, '$1').trim(),
    source,
    el,
    H: o.H,
    // A measured diameter beats one inferred from H. Most objects have none.
    dMeasured: o.diameter_km ?? null,
    dMin: o.d_min ?? (inferred ? inferred.min : null),
    dMax: o.d_max ?? (inferred ? inferred.max : null),
    albedo: o.albedo ?? null,
    rotPer: o.rot_per_h ?? null,
    spec: o.spec ?? null,
    pha: !!o.pha,
    sentry: !!o.sentry,
    // Real numbers from the JPL Sentry list, where the object is on it.
    // Palermo scale, cumulative impact probability, and how many tabulated
    // encounters that probability is summed over.
    sentryPs: num(o.sentry_ps_cum),
    sentryIp: num(o.sentry_ip),
    sentryN: num(o.sentry_n_imp),
    caDate: o.ca_date || null,
    caEpoch: o.ca_epoch || null,
    vKps: o.v_kps ?? null,
    missAu: o.miss_au ?? null,
    missLd: o.miss_ld ?? null,
    missKm: o.miss_km ?? null,
    q: num(o.q),
    ad: num(o.ad),
    per: num(o.per),
    moid: num(o.moid),
    unc: o.unc ?? o.condition_code ?? null,
    arc: num(o.arc ?? o.data_arc),
    nobs: num(o.nobs ?? o.n_obs_used),
    cls: o.cls ?? o.orbit_class_code ?? null,
    clsDesc: o.cls_desc ?? o.orbit_class ?? null,
    jplUrl: o.jpl_url || (o.des ? `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(o.des)}` : null),
    nickname: o.nickname || null,
    note: o.note || null,
    firstObs: o.first_obs || null,
    lastObs: o.last_obs || null
  };
}

/* ---------- spacecraft ---------- */

/**
 * Deep-space probes, from the committed Horizons snapshot.
 *
 * Several of these are on hyperbolic escape trajectories (Voyager 1 has
 * e ≈ 3.7), which the propagator handles — and unlike an asteroid, a
 * cruising spacecraft far from any planet is very well described by
 * two-body motion, so these positions hold up over months rather than days.
 */
export async function loadSpacecraft(url = './data/spacecraft-snapshot.json') {
  const doc = await fetch(url).then(r => r.json());
  const objects = (doc.objects || []).map(o => {
    const el = normalizeElements(o);
    return {
      kind: 'craft',
      id: 'craft' + o.hid,
      name: o.name,
      note: o.note,
      el,
      q: o.q ?? null,
      ad: o.ad ?? null,
      per: o.per ?? null,
      hid: o.hid,
      jplUrl: `https://ssd.jpl.nasa.gov/horizons/app.html#/`
    };
  }).filter(o => o.el);
  return { meta: { retrieved: doc._retrieved, source: doc._source }, objects };
}

/* ---------- baked snapshots ---------- */

export async function loadSnapshots(base = './data/') {
  const [jpl, neows] = await Promise.all([
    fetch(base + 'jpl-sbdb-snapshot.json').then(r => r.json()),
    fetch(base + 'neows-fallback.json').then(r => r.json())
  ]);
  return {
    jpl: {
      meta: { retrieved: jpl._retrieved, source: jpl._source, window: jpl._cad_window },
      objects: jpl.objects.map(o => makeRecord(o, 'jpl-snapshot')),
      approaches: jpl.approaches
    },
    neows: {
      meta: { retrieved: neows._retrieved, source: neows._source, window: neows._window },
      objects: neows.objects.map(o => makeRecord(o, 'neows-cached'))
    }
  };
}

/* ---------- live NeoWs ---------- */

export class RateLimitError extends Error {
  constructor(msg, remaining) { super(msg); this.name = 'RateLimitError'; this.remaining = remaining; }
}

/**
 * NeoWs /feed, detailed. The window is capped at 7 days by the API.
 * Returns { objects, meta } or throws.
 */
export async function fetchNeoWs(start, end, apiKey = getApiKey(), { useCache = true } = {}) {
  const s = isoDate(start), e = isoDate(end);
  const id = `feed:${s}:${e}`;

  if (useCache) {
    const hit = readCache(id);
    if (hit) {
      return {
        objects: hit.payload.map(o => makeRecord(o, 'neows-cached')),
        meta: { live: false, cached: true, ageMs: Date.now() - hit.t, start: s, end: e }
      };
    }
  }

  const url = `https://api.nasa.gov/neo/rest/v1/feed?start_date=${s}&end_date=${e}` +
              `&detailed=true&api_key=${encodeURIComponent(apiKey)}`;

  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    throw new Error('network unreachable');
  }

  if (res.status === 429) {
    throw new RateLimitError('hourly request quota exhausted', res.headers.get('x-ratelimit-remaining'));
  }
  if (res.status === 403) throw new Error('API key rejected');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const flat = flattenFeed(json);
  writeCache(id, flat);

  return {
    objects: flat.map(o => makeRecord(o, 'neows-live')),
    meta: {
      live: true, cached: false, start: s, end: e,
      remaining: res.headers.get('x-ratelimit-remaining'),
      limit: res.headers.get('x-ratelimit-limit')
    }
  };
}

/** NeoWs nests objects under one key per calendar day; flatten and trim. */
function flattenFeed(json) {
  const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const out = [];
  const days = json.near_earth_objects || {};

  for (const day of Object.keys(days)) {
    for (const o of days[day]) {
      const od = o.orbital_data || {};
      // Several objects list approaches to Venus/Mars in the same record.
      const ca = (o.close_approach_data || []).filter(c => c.orbiting_body === 'Earth');
      if (!ca.length) continue;

      // NeoWs files each object under the calendar day of the approach that
      // put it in the window, so that day IS the approach we want. Today's
      // feed returns exactly one entry per record and any choice would look
      // right; if NASA ever returns the full approach history, picking the
      // chronologically first would silently quote an encounter from decades
      // ago. Match the day, and fall back to the closest pass.
      const c = ca.find(x => x.close_approach_date === day) ||
                ca.reduce((best, x) => (
                  parseFloat(x.miss_distance.astronomical) < parseFloat(best.miss_distance.astronomical) ? x : best
                ), ca[0]);
      const km = o.estimated_diameter && o.estimated_diameter.kilometers;

      out.push({
        id: o.id,
        name: (o.name || '').trim(),
        jpl_url: o.nasa_jpl_url,
        H: num(o.absolute_magnitude_h),
        d_min: km ? num(km.estimated_diameter_min) : null,
        d_max: km ? num(km.estimated_diameter_max) : null,
        pha: !!o.is_potentially_hazardous_asteroid,
        sentry: !!o.is_sentry_object,
        ca_date: c.close_approach_date_full || c.close_approach_date,
        ca_epoch: c.epoch_date_close_approach,
        v_kps: num(c.relative_velocity.kilometers_per_second),
        miss_au: num(c.miss_distance.astronomical),
        miss_ld: num(c.miss_distance.lunar),
        miss_km: num(c.miss_distance.kilometers),
        epoch: num(od.epoch_osculation),
        e: num(od.eccentricity), a: num(od.semi_major_axis),
        i: num(od.inclination), om: num(od.ascending_node_longitude),
        w: num(od.perihelion_argument), ma: num(od.mean_anomaly),
        n: num(od.mean_motion), per: num(od.orbital_period),
        q: num(od.perihelion_distance), ad: num(od.aphelion_distance),
        moid: num(od.minimum_orbit_intersection),
        unc: od.orbit_uncertainty,
        arc: num(od.data_arc_in_days),
        nobs: num(od.observations_used),
        cls: (od.orbit_class || {}).orbit_class_type,
        cls_desc: (od.orbit_class || {}).orbit_class_description
      });
    }
  }

  // De-duplicate: a single object can appear on more than one day of the feed.
  const byId = new Map();
  for (const o of out) {
    const prev = byId.get(o.id);
    if (!prev || (o.miss_au ?? 9e9) < (prev.miss_au ?? 9e9)) byId.set(o.id, o);
  }
  return [...byId.values()].sort((a, b) => (a.miss_au ?? 9e9) - (b.miss_au ?? 9e9));
}

/* ---------- JPL live-link probe ---------- */

/**
 * Try the JPL SSD close-approach endpoint directly. This is expected to
 * fail from a browser and the failure is reported rather than hidden —
 * if JPL ever adds CORS headers, or the page is served behind a proxy
 * that does, this starts succeeding with no other change.
 *
 * Cached per session so the console shows at most one CORS warning.
 */
export async function probeJpl(days = 30) {
  const SKEY = 'neo.jplprobe';
  try {
    const prev = sessionStorage.getItem(SKEY);
    if (prev) return JSON.parse(prev);
  } catch (e) { /* ignore */ }

  const now = new Date();
  const url = 'https://ssd-api.jpl.nasa.gov/cad.api' +
              `?date-min=${isoDate(now)}&date-max=${isoDate(addDays(now, days))}` +
              '&dist-max=0.05&sort=dist&limit=200&fullname=true';

  let result;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    // A TypeError from fetch is the CORS/network case; a response that
    // arrives but is not ok is a different failure entirely, and reporting
    // an outage or a 400 as "CORS refused" would be a lie on screen.
    if (!r.ok) {
      result = { reachable: false, reason: `HTTP ${r.status} from JPL SSD` };
    } else {
      const j = await r.json();
      result = { reachable: true, count: j.count, fields: j.fields, data: j.data };
    }
  } catch (err) {
    const cors = err instanceof TypeError;
    result = {
      reachable: false,
      reason: cors ? 'no Access-Control-Allow-Origin header (CORS)'
                   : `unreachable — ${err.message}`
    };
  }

  try { sessionStorage.setItem(SKEY, JSON.stringify(result)); } catch (e) { }
  return result;
}

/* ---------- merge ---------- */

/**
 * Live/cached NeoWs objects first, then any curated JPL snapshot object
 * not already present. The JPL entries are what put recognizable names
 * (Apophis, Bennu, Didymos) on screen — the current week's feed is almost
 * entirely objects discovered in the last few years with no names at all.
 */
/**
 * Reduce a small-body name to a stable identity key.
 *
 * The same object reaches us under different spellings: SBDB says
 * "99942 Apophis", NeoWs says "99942 Apophis (2004 MN4)", and an
 * unnumbered object is "(2015 BF)" in one place and "2015 BF" in the
 * other. Matching on the display string lets a duplicate through and
 * it then gets drawn, counted and fed to the terminal twice.
 *
 * The IAU number is the strongest identifier when present; otherwise
 * fall back to the provisional designation with its space removed.
 */
/**
 * Every identity key a name yields. Returning a set rather than one key is
 * what makes cross-form matching work.
 *
 * NASA's own feed ships the same object twice under two names — the current
 * week contains both "(2017 MW7)" and "620101 (2017 MW7)". Keying on the
 * IAU number alone matches only the second; keying on the provisional
 * designation alone matches only the first. Emitting both and treating any
 * overlap as a match collapses them, and also catches "99942 Apophis" vs
 * "99942 Apophis (2004 MN4)" across the two sources.
 */
export function designationKeys(name) {
  const s = String(name || '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const keys = [];

  // A bare provisional designation starts with a year, and that year is NOT
  // an IAU number. Emitting one for "2017 MW7" would produce key #2017,
  // which is asteroid 2017 Wesson — a different object entirely. So test
  // for the whole-string provisional form first and stop there.
  const bareProvisional = /^(\d{4})\s?([a-z]{2}\d*)$/.exec(s);
  if (bareProvisional) return ['p' + bareProvisional[1] + bareProvisional[2]];

  const numbered = s.match(/^(\d+)\b/);
  if (numbered) keys.push('#' + numbered[1]);
  const embedded = s.match(/\b(\d{4})\s?([a-z]{2}\d*)\b/);
  if (embedded) keys.push('p' + embedded[1] + embedded[2]);
  if (!keys.length) keys.push('n' + s);
  return keys;
}

/** A numbered designation identifies an object better than a provisional one. */
function isNumbered(name) { return /^\d+\b/.test(String(name || '').trim()); }

export function mergeSources(neoList, jplList, { includeJpl = true } = {}) {
  const out = [];
  const index = new Map();   // key → position in `out`

  const add = (o) => {
    if (!o.el) return;
    const keys = designationKeys(o.name);
    if (o.nickname) keys.push(...designationKeys(o.nickname));

    const hitAt = keys.map(k => index.get(k)).find(i => i !== undefined);
    if (hitAt !== undefined) {
      // Same object under a second name. Keep whichever name identifies it
      // better, so the display shows "620101 (2017 MW7)" over "(2017 MW7)".
      if (isNumbered(o.name) && !isNumbered(out[hitAt].name)) out[hitAt] = o;
      for (const k of keys) if (!index.has(k)) index.set(k, hitAt);
      return;
    }

    const at = out.length;
    out.push(o);
    for (const k of keys) if (!index.has(k)) index.set(k, at);
  };

  for (const o of neoList) add(o);
  if (includeJpl) for (const o of jplList) add(o);
  return out;
}
