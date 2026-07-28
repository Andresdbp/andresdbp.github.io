/* =========================================================
   APP — boot, data flow, controls, animation loop.
   ========================================================= */

import { Viewport, HELIO_SCALE, GEO_SCALE } from './scene.js?v=14';
import { Terminal, writeDataSheet, feedLine, liveDistText, sleep, fmtInt, fmtNum } from './terminal.js?v=14';
import {
  loadSnapshots, fetchNeoWs, probeJpl, mergeSources, getApiKey, setApiKey,
  clearCache, isoDate, addDays, DEMO_KEY, RateLimitError, loadSpacecraft
} from './data.js?v=14';
import {
  jdFromDate, dateFromJd, positionAt, planetPosition, planetElements,
  moonPosition, moonPhase, distance, AU_KM, LD_KM
} from './astro.js?v=14';
import { loadLandMask, BODY_INFO } from './bodies.js?v=14';
import { fetchSatellites, loadSatelliteFallback, satState } from './satellites.js?v=14';

const $ = (s) => document.querySelector(s);
const reduceMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- time rates ---------- */

// Days of simulated time per real second. Index 0 is wall-clock.
const RATES = [1 / 86400, 1 / 1440, 1 / 24, 0.25, 1, 7, 30];
const RATE_LABELS = ['REAL TIME', '1 MIN/S', '1 HR/S', '6 HR/S', '1 DAY/S', '1 WEEK/S', '1 MONTH/S'];

/**
 * Range presets, chosen so each one frames a population rather than a round
 * number. The geocentric steps span five orders of magnitude — low Earth
 * orbit is 0.002 LD and Voyager is 44 000 — so evenly-spaced ranges would
 * leave the satellite shell buried inside the globe at every setting.
 */
const RANGES = {
  helio: [
    { v: 0.35, l: '0.3 AU' },   // inner planets
    { v: 1.1, l: '1 AU' },      // Earth's orbit
    { v: 2.2, l: '2 AU' },      // out past Mars
    { v: 5.5, l: '5 AU' },      // Jupiter
    { v: 190, l: 'DEEP' }       // the Voyagers
  ],
  geo: [
    { v: 0.035, l: 'LEO' },     // Earth plus the low-orbit shell
    { v: 0.16, l: 'GEO' },      // out to geostationary altitude
    { v: 1.3, l: '1 LD' },      // the Moon
    { v: 15, l: '15 LD' },
    { v: 60, l: '60 LD' },
    { v: 200, l: '200 LD' }
  ]
};

/* ---------- colour schemes ----------

   Two of these are real monochrome phosphors: one hue, varying only in
   intensity, exactly as a P1 or P3 tube behaves. SPECTRUM is the
   deliberate exception — it drops the collapse entirely and assigns a
   hue per class of object, so the display is read by colour instead of
   by position alone.

   Globes keep their own colours in every scheme via the chroma mask, so
   Earth is blue on all three.                                          */

const SCHEMES = {
  green: {
    id: 'green', label: 'P1 GRN', phosphor: 0x00ff00, forceChroma: 0,
    neo: 0x00ff00, pha: 0x00ff00, planetOrbit: 0x00ff00, grid: 0x00ff00,
    star: 0x00ff00, sun: 0x00ff00, craft: 0x00ff00, sat: 0x00ff00, selected: 0x00ff00
  },
  amber: {
    id: 'amber', label: 'P3 AMB', phosphor: 0xffb000, forceChroma: 0,
    neo: 0xffb000, pha: 0xffb000, planetOrbit: 0xffb000, grid: 0xffb000,
    star: 0xffb000, sun: 0xffb000, craft: 0xffb000, sat: 0xffb000, selected: 0xffb000
  },
  spectrum: {
    id: 'spectrum', label: 'SPECTRUM', forceChroma: 1,

    // `phosphor` is NOT the text colour here — with forceChroma every pixel
    // keeps its own hue. It survives only as the tube's ambient glow and the
    // roll band. Setting it white made both neutral, which painted a flat
    // grey wash over the entire viewport and drained the scheme. A saturated
    // violet reads as deep space instead of as fog.
    phosphor: 0x7c3aed,

    neo: 0x3dff88,        // ordinary asteroids   — spring green
    pha: 0xff2d55,        // potentially hazardous — hot red
    planetOrbit: 0xff9500, // planetary orbits     — orange
    grid: 0x00b4d8,       // range rings, graticule — cyan-blue
    star: 0xa9c8ff,       // starfield             — cool blue-white
    sun: 0xffd60a,        // the Sun               — gold
    craft: 0xe879f9,      // deep-space probes     — fuchsia
    sat: 0x38e8ff,        // Earth-orbit satellites — cyan
    selected: 0xffffff    // the locked target      — white
  }
};

/* ---------- state ---------- */

const state = {
  all: [],
  visible: [],
  selected: null,
  tab: 'feed',
  rateIdx: 0,
  simJd: jdFromDate(new Date()),
  anchorReal: performance.now(),
  anchorJd: jdFromDate(new Date()),
  phaOnly: false,
  earthExaggerated: false,
  query: '',
  feedIdx: 0,
  feedTimer: 0,
  sources: { neows: null, jpl: null },
  scheme: 'green',
  craft: [],
  sats: [],
  bootDone: false
};

const term = new Terminal($('#termLog'), $('#sysStatus'));
let vp = null;

/* ---------- boot ---------- */

main().catch(fatal);

async function main() {
  // WebGL first: everything else is pointless without it, and failing
  // early gives a readable message instead of a black rectangle.
  try {
    vp = new Viewport($('#gl'), $('#vpOverlay'));
  } catch (err) {
    fatal(err, 'WEBGL UNAVAILABLE — this terminal needs hardware 3D. ' +
               'Try a different browser, or enable hardware acceleration.');
    return;
  }

  buildRangeButtons();
  wireControls();
  wireViewportKeys();

  let savedScheme = 'green';
  try { savedScheme = localStorage.getItem('neo.scheme') || 'green'; } catch (e) { }
  setScheme(SCHEMES[savedScheme] ? savedScheme : 'green');
  const schemeBtn = document.querySelector(`#segPhosphor button[data-p="${state.scheme}"]`);
  if (schemeBtn) {
    [...schemeBtn.parentNode.children].forEach(c => c.setAttribute('aria-pressed', String(c === schemeBtn)));
  }

  // Debounced: a window drag fires resize continuously, and each call
  // reallocates the scene and bloom render targets — tens of megabytes of
  // GPU churn per drag.
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => vp.resize(), 120);
  });

  // Start rendering before anything else. The starfield, grid and Sun
  // need no data, so the tube lights up immediately and the boot text
  // streams over a live display rather than over a black rectangle.
  startLoop();

  const veil = $('#veil');
  veil.classList.add('gone');
  setTimeout(() => veil.remove(), 600);

  term.status('BOOT', 'warn');

  // Network work starts NOW, not after the typewriter. The boot text is
  // cosmetic and rAF-driven, so a backgrounded tab throttles it to a
  // crawl; awaiting it before fetching meant a tab opened in the
  // background never loaded any data at all.
  const today = new Date();
  const snapsP = loadSnapshots();
  const feedP = fetchNeoWs(today, addDays(today, 6), getApiKey())
    .then(res => ({ res }), err => ({ err }));
  const probeP = probeJpl();
  const landP = loadLandMask().then(m => m, () => null);
  const craftP = loadSpacecraft().then(r => r, () => null);
  // CelesTrak IS CORS-enabled, so this one is a genuine live fetch.
  const satP = fetchSatellites().then(r => r, () => loadSatelliteFallback().catch(() => null));

  await term.boot([
    ['NEO TERMINAL v2.0', 'ok', 60],
    [`DISPLAY — ${SCHEMES[state.scheme].label}`, 'dim', 30],
    ['> mounting data sources', 'sys', 30]
  ]);

  // Committed snapshots first so the screen is never empty, then live.
  let snaps;
  try {
    snaps = await snapsP;
  } catch (err) {
    fatal(err, 'DATA SNAPSHOT UNREADABLE — check that data/*.json shipped with the page.');
    return;
  }
  state.sources.jpl = snaps.jpl;

  term.push(`  JPL SBDB snapshot ......... ${snaps.jpl.objects.length} objects  [${snaps.jpl.meta.retrieved}]`, 'ok');
  term.push(`  NeoWs fallback ............ ${snaps.neows.objects.length} objects  [${snaps.neows.meta.retrieved}]`, 'ok');

  applyRecords(mergeSources(snaps.neows.objects, snaps.jpl.objects));

  // Live NeoWs.
  term.push('> contacting api.nasa.gov/neo/rest/v1/feed', 'sys');
  term.status('LINK', 'warn');
  const key = getApiKey();
  term.push(`  auth: ${key === DEMO_KEY ? 'DEMO_KEY (shared, ~10 req/hr per IP)' : 'personal key'}`, 'dim');

  const { res, err } = await feedP;
  if (res) {
    state.sources.neows = res;
    if (res.meta.cached) {
      const mins = Math.round(res.meta.ageMs / 60000);
      term.push(`  CACHED RESPONSE — ${res.objects.length} objects, ${mins} min old`, 'ok');
    } else {
      term.push(`  LIVE — ${res.objects.length} objects for ${res.meta.start} … ${res.meta.end}`, 'ok');
      if (res.meta.remaining != null) {
        term.push(`  quota remaining this hour: ${res.meta.remaining}/${res.meta.limit}`,
          Number(res.meta.remaining) <= 2 ? 'warn' : 'dim');
      }
    }
    applyRecords(mergeSources(res.objects, snaps.jpl.objects));
    term.status(res.meta.cached ? 'CACHED' : 'LIVE', 'ok');
  } else {
    const why = err instanceof RateLimitError
      ? 'HTTP 429 — hourly quota exhausted for this IP'
      : err.message;
    term.push(`  NASA FEED UNAVAILABLE: ${why}`, 'err');
    term.push('  holding on the committed snapshot; press API KEY to use your own key.', 'dim wrap');
    term.status('SNAPSHOT', 'warn');
  }

  // JPL direct link. Expected to fail from a browser; reported either way.
  term.push('> probing ssd-api.jpl.nasa.gov (close-approach API)', 'sys');
  const jplProbe = await probeP;
  if (jplProbe.reachable) {
    term.push(`  JPL DIRECT LINK OK — ${jplProbe.count} approaches`, 'ok');
  } else {
    term.push(`  JPL DIRECT LINK REFUSED: ${jplProbe.reason}`, 'warn');
    term.push('  JPL SSD sends no CORS header, so no browser can read it from a static host. ' +
              'Using the server-side snapshot committed with this page instead.', 'dim wrap');
  }

  // ---- continents ----
  const land = await landP;
  if (land) {
    vp.setLandMask(land);
    term.push('  earth surface ............. Natural Earth 110m coastlines', 'ok');
  }

  // ---- human-made objects ----
  const craft = await craftP;
  if (craft && craft.objects.length) {
    state.craft = craft.objects;
    vp.setCraft(craft.objects);
    term.push(`> spacecraft (JPL Horizons) . ${craft.objects.length} tracked  [${craft.meta.retrieved}]`, 'ok');
  }

  const sats = await satP;
  if (sats && sats.objects.length) {
    state.sats = sats.objects;
    vp.setSats(sats.objects);
    const how = sats.meta.live ? 'LIVE'
      : sats.meta.cached ? `cached ${Math.round(sats.meta.ageMs / 60000)} min`
      : `snapshot ${sats.meta.retrieved}`;
    term.push(`> satellites (CelesTrak) .... ${sats.objects.length} in Earth orbit  [${how}]`, 'ok');
    if (!sats.meta.live) {
      term.push('  TLEs age out within days — these positions may have drifted.', 'warn wrap');
    }
  } else {
    term.push('> satellites ................ unavailable', 'warn');
  }

  // The committed JPL close-approach table. These are JPL's own CAD records
  // rather than NeoWs's, they run a full year ahead instead of seven days,
  // and they carry the uncertainty on the approach time — which is the one
  // number that tells you how firm a predicted pass actually is.
  reportJplApproaches(jplProbe, snaps.jpl);

  term.push('', '');
  term.push('> telemetry feed online. click any object to lock.', 'ok');
  state.bootDone = true;
  startFeed();
}

/**
 * Print the nearest entries from JPL's close-approach table.
 *
 * If the live probe got through (behind a proxy, say) its rows are used;
 * otherwise the committed snapshot is, and the log says which. These are
 * listed rather than plotted because cad.api returns approach circumstances
 * without orbital elements — there is nothing to draw an orbit from.
 */
function reportJplApproaches(probe, jplSnap, limit = 6) {
  let rows, live;

  if (probe.reachable && Array.isArray(probe.data)) {
    const f = probe.fields || [];
    const ix = (k) => f.indexOf(k);
    rows = probe.data.map(r => ({
      des: r[ix('des')], cd: r[ix('cd')],
      dist: parseFloat(r[ix('dist')]), v: parseFloat(r[ix('v_rel')]),
      sigma: ix('t_sigma_f') >= 0 ? r[ix('t_sigma_f')] : null
    }));
    live = true;
  } else {
    rows = (jplSnap.approaches || []).map(a => ({
      des: a.des, cd: a.cd, dist: a.dist, v: a.v_rel, sigma: a.t_sigma_f
    }));
    live = false;
  }

  rows = rows.filter(r => Number.isFinite(r.dist)).sort((a, b) => a.dist - b.dist);
  if (!rows.length) return;

  term.rule('JPL CLOSE-APPROACH TABLE');
  term.push(`  ${rows.length} passes inside 0.05 AU in the next year ` +
            `[${live ? 'live' : 'snapshot ' + jplSnap.meta.retrieved}]`, 'dim');

  for (const r of rows.slice(0, limit)) {
    const ld = (r.dist * AU_KM) / LD_KM;
    term.push(
      `  ${String(r.des).padEnd(12)} ${String(r.cd).padEnd(18)} ` +
      `${ld.toFixed(2).padStart(6)} LD  ${fmtNum(r.v, 1).padStart(5)} KM/S` +
      (r.sigma ? `  ±${r.sigma}` : ''),
      ld < 1 ? 'warn' : ''
    );
  }
  term.push('  (approach circumstances only — cad.api carries no orbital elements, ' +
            'so these are not plotted)', 'dim wrap');
}

function fatal(err, msg) {
  console.error(err);
  term.status('FAULT', 'err');
  term.push('', '');
  term.push('*** SYSTEM FAULT ***', 'err');
  term.push(msg || String(err && err.message || err), 'err wrap');
  const veil = $('#veil');
  if (veil) { veil.classList.add('gone'); setTimeout(() => veil.remove(), 600); }
}

/* ---------- records ---------- */

function applyRecords(records) {
  for (const r of records) if (!r.kind) r.kind = 'neo';
  state.all = records;
  refilter();
}

function refilter() {
  const q = state.query.trim().toLowerCase();
  state.visible = state.all.filter(r => {
    if (state.phaOnly && !r.pha) return false;
    if (q && !(r.name.toLowerCase().includes(q) ||
               (r.nickname || '').toLowerCase().includes(q) ||
               String(r.id).includes(q))) return false;
    return true;
  });

  // Re-find the selection by identifier, not by object identity. Every
  // refetch reparses the feed into brand-new record objects, so an
  // identity test silently dropped the operator's target lock the moment
  // the live data landed a second after boot.
  let keep = null;
  if (state.selected) {
    keep = state.visible.find(r => r === state.selected) ||
           state.visible.find(r => String(r.id) === String(state.selected.id)) ||
           state.visible.find(r => r.name === state.selected.name) || null;
  }

  vp.setRecords(state.visible);

  if (keep) {
    state.selected = keep;
    vp.setSelected(keep);
    if (state.tab === 'target') writeDataSheet(term, keep, targetContext(keep));
  } else if (state.selected) {
    select(null);
  }

  state.feedIdx = 0;
  updateStats();
}

function updateStats() {
  $('#statObjects').textContent = fmtInt(state.visible.length);
  $('#statPha').textContent = fmtInt(state.visible.filter(r => r.pha).length);

  let best = null;
  for (const r of state.visible) {
    if (!Number.isFinite(r.missLd)) continue;
    if (!best || r.missLd < best.missLd) best = r;
  }
  $('#statNearest').textContent = best ? `${best.missLd.toFixed(1)} LD` : '—';
}

/* ---------- selection ---------- */

function select(rec) {
  state.selected = rec;
  vp.setSelected(rec);
  announce(rec
    ? `Target locked: ${rec.nickname || rec.name}. ` +
      (Number.isFinite(rec.missLd) ? `Miss distance ${rec.missLd.toFixed(1)} lunar distances.` : '')
    : 'Target lock released.');

  if (rec) {
    setTab('target');
  } else if (state.tab === 'target') {
    setTab('feed');
  }
}

function announce(msg) {
  const el = $('#srAnnounce');
  if (el) el.textContent = msg;
}

/**
 * Keyboard route to the app's central interaction. Cycling from the focused
 * plot beats making all 320 feed lines tab stops: the target list is
 * ordered, so stepping through it is what an operator actually wants, and
 * it leaves the tab order navigable.
 */
function wireViewportKeys() {
  const stage = $('#vpStage');

  stage.addEventListener('keydown', (e) => {
    const list = state.visible;
    if (!list.length) return;

    const step = (d) => {
      e.preventDefault();
      const i = state.selected ? list.indexOf(state.selected) : -1;
      const next = i < 0
        ? (d > 0 ? 0 : list.length - 1)
        : (i + d + list.length) % list.length;
      select(list[next]);
    };

    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': step(1); break;
      case 'ArrowLeft': case 'ArrowUp': step(-1); break;
      case 'Home': {
        e.preventDefault();
        // The closest approach is the one worth jumping to.
        let best = null;
        for (const r of list) {
          if (!Number.isFinite(r.missLd)) continue;
          if (!best || r.missLd < best.missLd) best = r;
        }
        if (best) select(best);
        break;
      }
      default: break;
    }
  });
}

function setTab(tab) {
  state.tab = tab;
  $('#tabFeed').setAttribute('aria-selected', String(tab === 'feed'));
  $('#tabTarget').setAttribute('aria-selected', String(tab === 'target'));

  if (tab === 'target') {
    if (!state.selected) {
      term.clear();
      term.rule('NO TARGET');
      term.push('  Click an object in the plot, or a line in the feed.', 'dim');
      return;
    }
    writeDataSheet(term, state.selected, targetContext(state.selected));
  } else {
    term.clear();
    term.rule('TELEMETRY');
    term.push(`  streaming ${state.visible.length} tracked objects`, 'dim');
    state.feedIdx = 0;
  }
}

/**
 * Per-kind context for the data sheet. Each writer asks for different
 * things — a satellite wants altitude and sub-point, a planet wants
 * distance from the Sun, an asteroid wants epoch age.
 */
function targetContext(rec) {
  const jd = state.simJd;
  const earth = planetPosition('Earth', jd);

  if (rec.kind === 'sat') {
    return { state: satState(rec, dateFromJd(jd)) };
  }

  if (rec.kind === 'planet' || rec.kind === 'sun') {
    if (rec.name === 'Sun') {
      return { sunAu: 0, earthAu: Math.hypot(earth.x, earth.y, earth.z) };
    }
    const p = planetPosition(rec.name, jd);
    return {
      sunAu: Math.hypot(p.x, p.y, p.z),
      earthAu: distance(p, earth),
      el: planetElements(rec.name, jd)
    };
  }

  if (rec.kind === 'moon') {
    const m = moonPosition(jd);
    return {
      earthAu: Math.hypot(m.x, m.y, m.z),
      sunAu: Math.hypot(m.x + earth.x, m.y + earth.y, m.z + earth.z),
      phase: moonPhase(jd)
    };
  }

  if (!rec.el) return {};
  const p = positionAt(rec.el, jd);
  const sunAu = Math.hypot(p.x, p.y, p.z);
  const earthAu = distance(p, earth);

  if (rec.kind === 'craft') return { sunAu, earthAu };
  return { currentKm: earthAu * AU_KM, epochAgeDays: jd - rec.el.epoch };
}

/* ---------- rolling feed ---------- */

function startFeed() {
  clearInterval(state.feedTimer);
  state.feedTimer = setInterval(() => {
    if (state.tab !== 'feed' || !state.visible.length || document.hidden) return;
    const rec = state.visible[state.feedIdx % state.visible.length];
    state.feedIdx++;
    const el = term.push(feedLine(rec), 'feed' + (rec.pha ? ' warn' : ''));
    el.addEventListener('click', () => select(rec));
  }, 420);
}

/* ---------- controls ---------- */

function buildRangeButtons() {
  const seg = $('#segRange');
  seg.textContent = '';
  const list = RANGES[vp.mode];
  list.forEach((r, k) => {
    const b = document.createElement('button');
    b.textContent = r.l;
    b.setAttribute('aria-pressed', String(k === (vp.mode === 'helio' ? 1 : 3)));
    b.addEventListener('click', () => {
      [...seg.children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
      vp.setRange(r.v);
    });
    seg.appendChild(b);
  });
}

function wireControls() {
  // frame
  $('#segMode').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    [...b.parentNode.children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    vp.setMode(b.dataset.mode);
    buildRangeButtons();
    vp.setRange(b.dataset.mode === 'helio' ? 1.1 : 15);
    $('#vpMode').textContent = b.dataset.mode === 'helio'
      ? 'HELIOCENTRIC / ECLIPTIC J2000'
      : 'GEOCENTRIC / RANGE IN LUNAR DISTANCES';
  });

  // colour scheme
  $('#segPhosphor').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]');
    if (!b) return;
    [...b.parentNode.children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    setScheme(b.dataset.p);
  });

  // time
  const slider = $('#rateSlider');
  slider.addEventListener('input', () => {
    setRate(parseInt(slider.value, 10));
  });
  $('#btnNow').addEventListener('click', () => {
    slider.value = '0';
    setRate(0);
    state.anchorJd = jdFromDate(new Date());
    state.anchorReal = performance.now();
    state.simJd = state.anchorJd;
  });

  // layers
  toggleBtn($('#btnOrbits'), true, (on) => { vp.showOrbits = on; });
  toggleBtn($('#btnPlanets'), true, (on) => { vp.showPlanets = on; });
  toggleBtn($('#btnPhaOnly'), false, (on) => { state.phaOnly = on; refilter(); });
  toggleBtn($('#btnSats'), true, (on) => { vp.showSats = on; });
  toggleBtn($('#btnCraft'), true, (on) => { vp.showCraft = on; });
  toggleBtn($('#btnEarthScale'), false, (on) => {
    vp.setEarthExaggeration(on ? 20 : 1);
    state.earthExaggerated = on;
  });

  // search
  let searchTimer = 0;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => { state.query = v; refilter(); }, 180);
  });

  // tabs
  $('#tabFeed').addEventListener('click', () => setTab('feed'));
  $('#tabTarget').addEventListener('click', () => setTab('target'));

  // viewport picking
  const stage = $('#vpStage');
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    vp.setHovered(vp.pick(e.clientX - r.left, e.clientY - r.top));
  });
  stage.addEventListener('pointerleave', () => vp.setHovered(null));

  // Distinguish a click from the end of an orbit drag.
  let downAt = null;
  stage.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  stage.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    if (moved > 6 || held > 600) return;
    const r = stage.getBoundingClientRect();
    const hit = vp.pick(e.clientX - r.left, e.clientY - r.top, 18);
    if (hit) select(hit);
  });

  // modals
  modal($('#btnBrief'), $('#briefBg'), $('#btnBriefClose'));
  modal($('#btnKey'), $('#keyBg'), $('#btnKeyClose'));

  // Show the stored key when the dialog opens. Without this a saved key is
  // unverifiable — the field is always blank, so there is no way to tell
  // whether one is set, or to correct a typo in it.
  $('#btnKey').addEventListener('click', () => {
    const k = getApiKey();
    $('#keyInput').value = k === DEMO_KEY ? '' : k;
  });

  $('#btnKeySave').addEventListener('click', async () => {
    setApiKey($('#keyInput').value);
    closeModal($('#keyBg'));
    clearCache();
    await reload();
  });
  $('#btnKeyClear').addEventListener('click', async () => {
    setApiKey('');
    $('#keyInput').value = '';
    closeModal($('#keyBg'));
    clearCache();
    await reload();
  });
  $('#btnRefresh').addEventListener('click', () => reload(true));

  // Escape peels one layer at a time. Closing a modal and dropping the
  // target lock on the same keystroke meant opening the briefing to look
  // something up cost you the target you opened it to read about.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [$('#briefBg'), $('#keyBg')].find(m => !m.hidden);
    if (open) { closeModal(open); return; }
    if (state.selected) select(null);
  });
}

/**
 * Apply a colour scheme to both halves of the display. The CSS side drives
 * the terminal text and chrome through `data-phosphor`; the scene side gets
 * the per-object hues and the chroma-collapse switch.
 */
function setScheme(id) {
  const s = SCHEMES[id] || SCHEMES.green;
  state.scheme = s.id;
  document.documentElement.setAttribute('data-phosphor', s.id);
  vp.setScheme(s);
  try { localStorage.setItem('neo.scheme', s.id); } catch (e) { }
  announce(`Colour scheme: ${s.label}`);
}

function toggleBtn(btn, initial, fn) {
  let on = initial;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  btn.addEventListener('click', () => {
    on = !on;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    fn(on);
  });
}

/* ---------- modals ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

function openModal(bg, trigger) {
  // Prefer the control that opened the dialog over document.activeElement:
  // a click does not necessarily focus its target, so activeElement is often
  // <body> and the caret would be restored to the top of the document.
  lastFocused = trigger || document.activeElement;
  bg.hidden = false;
  const first = bg.querySelector(FOCUSABLE);
  if (first) first.focus();
}

export function closeModal(bg) {
  bg.hidden = true;
  // Return the caret to whatever opened the dialog, or a keyboard user is
  // dumped back at the top of the document with no idea where they were.
  if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
  lastFocused = null;
}

function modal(openBtn, bg, closeBtn) {
  openBtn.addEventListener('click', () => openModal(bg, openBtn));
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal(bg));
  bg.addEventListener('click', (e) => { if (e.target === bg) closeModal(bg); });

  // Keep Tab inside the dialog while it is open. Without this the focus
  // ring walks straight out into the page behind it, which for a screen
  // reader user makes the dialog effectively invisible.
  bg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || bg.hidden) return;
    const items = [...bg.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

function setRate(idx) {
  state.rateIdx = idx;
  // Re-anchor so the change in rate does not jump the clock.
  state.anchorJd = state.simJd;
  state.anchorReal = performance.now();

  const label = idx === 0 ? RATE_LABELS[0]
    : (idx < 0 ? '− ' : '+ ') + RATE_LABELS[Math.abs(idx)];
  $('#rateVal').textContent = label;
  $('#vpRate').textContent = label;
}

async function reload(force = false) {
  const btn = $('#btnRefresh');
  btn.disabled = true;
  if (force) clearCache();
  setTab('feed');
  term.push('> refreshing NASA feed', 'sys');
  term.status('LINK', 'warn');

  const today = new Date();
  try {
    const res = await fetchNeoWs(today, addDays(today, 6), getApiKey(), { useCache: !force });
    state.sources.neows = res;
    // REFRESH is clickable from the first frame, so this can run before the
    // snapshots land — and it also runs for the whole session if the
    // snapshot fetch failed. Dereferencing state.sources.jpl unguarded threw
    // inside the try, which reported a successful 200 as a feed outage.
    applyRecords(mergeSources(res.objects, state.sources.jpl ? state.sources.jpl.objects : []));
    term.push(`  ${res.meta.cached ? 'CACHED' : 'LIVE'} — ${res.objects.length} objects`, 'ok');
    if (res.meta.remaining != null) term.push(`  quota remaining: ${res.meta.remaining}/${res.meta.limit}`, 'dim');
    term.status(res.meta.cached ? 'CACHED' : 'LIVE', 'ok');
  } catch (err) {
    const why = err instanceof RateLimitError ? 'quota exhausted (HTTP 429)' : err.message;
    term.push(`  FEED UNAVAILABLE: ${why}`, 'err');
    term.status('SNAPSHOT', 'warn');
  }
  btn.disabled = false;
}

/* ---------- animation ---------- */

function startLoop() {
  let last = performance.now();
  let nextGlitch = performance.now() + 9000 + Math.random() * 16000;
  let lastClock = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    // Advance the simulation clock. At rate 0 the terminal tracks the
    // real clock exactly rather than accumulating frame deltas, so it
    // stays correct across a backgrounded tab.
    if (state.rateIdx === 0) {
      state.simJd = jdFromDate(new Date());
    } else {
      const dpr = RATES[Math.abs(state.rateIdx)] * Math.sign(state.rateIdx);
      state.simJd += dpr * dt;
    }

    // Flicker: mostly steady with brief dips, the way a tube with a
    // tired power supply behaves.
    let flicker = 1;
    if (!reduceMotion) {
      flicker = 0.97 + 0.03 * Math.sin(now * 0.011) + 0.012 * Math.sin(now * 0.073);
      if (now > nextGlitch) {
        nextGlitch = now + 9000 + Math.random() * 16000;
        const crt = $('#crt');
        crt.classList.add('glitch');
        setTimeout(() => crt.classList.remove('glitch'), 200);
      }
    }

    vp.update(state.simJd, dateFromJd(state.simJd));
    vp.updateLabels();
    vp.render(now / 1000, flicker);

    if (now - lastClock > 250) {
      lastClock = now;
      updateClock();
    }
  }
  requestAnimationFrame(frame);
}

function updateClock() {
  const d = dateFromJd(state.simJd);
  const iso = d.toISOString();
  $('#statClock').textContent = iso.slice(11, 19);
  $('#vpEpoch').textContent = iso.slice(0, 10) + ' ' + iso.slice(11, 16);

  const dist = vp.controls.target.distanceTo(vp.camera.position);
  $('#vpScaleTxt').textContent = vp.mode === 'helio'
    ? `VIEW ${(dist / HELIO_SCALE).toFixed(2)} AU`
    : `VIEW ${(dist / GEO_SCALE).toFixed(2)} LD`;

  // Say which scale convention is actually in force rather than showing a
  // blanket disclaimer. In the geocentric frame with exaggeration off,
  // Earth really is to scale against the lunar-orbit ring — and that is
  // the single most informative thing on the display.
  $('#vpScaleNote').textContent = vp.mode === 'helio'
    ? 'BODIES NOT TO SCALE'
    : (state.earthExaggerated ? 'EARTH ×20 — NOT TO SCALE' : 'EARTH TO SCALE vs LUNAR ORBIT');

  // Keep the locked target's live distance current without rewriting
  // the sheet, which would throw away the operator's scroll position.
  if (state.tab === 'target' && state.selected && state.selected.kind === 'neo') {
    const row = document.getElementById('liveDist');
    if (row) {
      const v = row.querySelector('.v');
      if (v) v.textContent = liveDistText(targetContext(state.selected).currentKm);
    }
  }
}

/* Pause the rolling feed while the tab is hidden so a backgrounded
   terminal does not accumulate thousands of lines. */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.rateIdx === 0) {
    state.simJd = jdFromDate(new Date());
  }
});
