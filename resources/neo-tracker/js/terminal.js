/* =========================================================
   TERMINAL — the scrolling telemetry column.

   Two modes:
     FEED   a rolling log that cycles through every tracked
            object, one line at a time
     TARGET locked onto one object, showing its full data sheet

   Everything honours prefers-reduced-motion: with it set the
   typewriter resolves instantly and the auto-scroll stops.
   ========================================================= */

const MAX_LINES = 320;

const reduceMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function fmtInt(x) {
  return Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—';
}

export function fmtNum(x, d = 3) {
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}

/** Distances span 8 orders of magnitude here; pick a readable unit. */
export function fmtDist(km) {
  if (!Number.isFinite(km)) return '—';
  if (km < 1000) return fmtInt(km) + ' KM';
  if (km < 1e6) return fmtInt(km) + ' KM';
  return (km / 1e6).toFixed(2) + 'M KM';
}

export function fmtDiam(rec) {
  if (Number.isFinite(rec.dMeasured)) {
    const m = rec.dMeasured;
    return (m < 1 ? fmtInt(m * 1000) + ' M' : fmtNum(m, 2) + ' KM') + ' (MEASURED)';
  }
  // Both ends or nothing. With only one bound present the old code printed
  // the missing end as 0 — "13–0 M" — which reads as a measurement rather
  // than as missing data.
  if (!Number.isFinite(rec.dMin) || !Number.isFinite(rec.dMax)) return '—';
  const lo = rec.dMin, hi = rec.dMax;
  const u = (v) => (hi < 1 ? fmtInt(v * 1000) : fmtNum(v, 2));
  return `${u(lo)}–${u(hi)} ${hi < 1 ? 'M' : 'KM'} (EST)`;
}

export class Terminal {
  constructor(logEl, statusEl) {
    this.log = logEl;
    this.statusEl = statusEl;
    this.lines = [];
    this.mode = 'feed';
    this.locked = null;
    this.cursorIdx = 0;
    this.paused = false;
    this.instant = false;      // latched once the typewriter gives up animating
    this._typing = null;
    this._autoscroll = true;

    // If the operator scrolls up, stop yanking them back to the bottom.
    this.log.addEventListener('scroll', () => {
      const nearBottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
      this._autoscroll = nearBottom;
    });
  }

  /* ---------- primitives ---------- */

  /**
   * Append and enforce the ring-buffer cap. Every line goes through here —
   * the cap used to live only in push(), so a long-running session's data
   * sheets and rules accumulated without bound.
   */
  _append(el) {
    this.log.appendChild(el);
    this.lines.push(el);
    while (this.lines.length > MAX_LINES) {
      const dead = this.lines.shift();
      if (dead.parentNode) dead.parentNode.removeChild(dead);
    }
    this._scroll();
    return el;
  }

  push(text, cls = '') {
    const el = document.createElement('div');
    el.className = 'ln' + (cls ? ' ' + cls : '');
    el.textContent = text;
    return this._append(el);
  }

  /** Line with a dim label and a bright value, the workhorse of the data sheet. */
  pushKV(label, value, cls = '') {
    const el = document.createElement('div');
    el.className = 'ln kv' + (cls ? ' ' + cls : '');
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = value;
    el.append(k, v);
    return this._append(el);
  }

  rule(label) {
    const el = document.createElement('div');
    el.className = 'ln rule';
    el.dataset.label = label || '';
    return this._append(el);
  }

  clear() {
    // A typewriter still running would otherwise keep writing into a node
    // that is no longer in the document, and its promise would resolve
    // against a screen that has moved on.
    this.stopTyping();
    this.log.textContent = '';
    this.lines = [];
    this._autoscroll = true;
  }

  _scroll() {
    if (this._autoscroll) this.log.scrollTop = this.log.scrollHeight;
  }

  status(text, cls) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.className = 'sys-status' + (cls ? ' ' + cls : '');
  }

  /* ---------- typewriter ---------- */

  /**
   * Resolves when the whole line has been typed (or immediately under
   * prefers-reduced-motion, or once `instant` has been latched).
   *
   * Driven by requestAnimationFrame rather than a per-character timeout:
   * browsers clamp nested setTimeout to 4 ms and throttle it hard in
   * background tabs, which stretched a one-second boot into ten.
   *
   * The watchdog matters more than it looks. A tab opened in the
   * background gets no animation frames at all, so an rAF-driven
   * typewriter never finishes — and anything awaiting it waits forever.
   * If the frames do not arrive in time the line is completed from a
   * timer instead and `instant` is latched, so the rest of the boot
   * gives up on animating rather than stalling line by line.
   */
  type(text, cls = '', durationMs = 260) {
    return new Promise((resolve) => {
      const el = this.push('', cls);
      if (reduceMotion || this.instant || !text) { el.textContent = text; resolve(el); return; }

      let done = false;
      const finish = (latchInstant) => {
        if (done) return;
        done = true;
        if (this._typing) { cancelAnimationFrame(this._typing); this._typing = null; }
        clearTimeout(watchdog);
        if (latchInstant) this.instant = true;
        el.textContent = text;
        this._scroll();
        resolve(el);
      };

      const watchdog = setTimeout(() => finish(true), durationMs + 400);

      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / durationMs);
        el.textContent = text.slice(0, Math.max(1, Math.round(t * text.length)));
        this._scroll();
        if (t < 1) this._typing = requestAnimationFrame(tick);
        else finish(false);
      };
      this._typing = requestAnimationFrame(tick);
    });
  }

  async boot(lines) {
    for (const [text, cls, pause] of lines) {
      await this.type(text, cls);
      if (pause && !reduceMotion) await sleep(pause);
    }
  }

  stopTyping() {
    if (this._typing) { cancelAnimationFrame(this._typing); this._typing = null; }
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- line builders ---------- */

/**
 * The rolling feed line. Format follows the brief:
 *   ID: 3757234 | VELOCITY: 42,000 KM/H | MISS DISTANCE: 0.03 AU
 */
export function feedLine(rec) {
  const vKph = Number.isFinite(rec.vKps) ? fmtInt(rec.vKps * 3600) : '—';
  const miss = Number.isFinite(rec.missAu) ? rec.missAu.toFixed(4) : '—';
  const ld = Number.isFinite(rec.missLd) ? rec.missLd.toFixed(1) : '—';
  return `ID: ${rec.id} | ${rec.name} | V: ${vKph} KM/H | MISS: ${miss} AU (${ld} LD)`;
}

/**
 * Full data sheet for the locked target. Ordering is deliberate: what it is,
 * where it goes, how well we know it, and only then the hazard framing —
 * which is written to defuse the usual misreading of "potentially hazardous".
 */
/**
 * Route to the right sheet. A planet, a satellite and an asteroid share
 * almost no fields, and forcing them through one template would mean a
 * column of em-dashes for whichever kind is not an asteroid.
 */
export function writeDataSheet(term, rec, ctx) {
  if (!rec) return;
  if (rec.kind === 'planet' || rec.kind === 'moon' || rec.kind === 'sun') return writeBodySheet(term, rec, ctx);
  if (rec.kind === 'sat') return writeSatSheet(term, rec, ctx);
  if (rec.kind === 'craft') return writeCraftSheet(term, rec, ctx);
  return writeNeoSheet(term, rec, ctx);
}

/* ---------- planets, moons, the Sun ---------- */

function writeBodySheet(term, rec, ctx) {
  const i = rec.info || {};
  term.clear();
  term.rule('TARGET LOCK');
  term.push(`▶ ${rec.name}`, 'hdr');
  if (i.blurb) term.push('  ' + i.blurb, 'dim wrap');

  term.rule('PHYSICAL');
  term.pushKV('MEAN RADIUS', fmtInt(i.radiusKm) + ' KM');
  if (rec.name !== 'Sun') {
    term.pushKV('vs EARTH', (i.radiusKm / 6371).toFixed(3) + ' ×');
  }
  term.pushKV('ROTATION', i.day || '—');
  if (rec.kind === 'planet') term.pushKV('KNOWN MOONS', String(i.moons));

  if (ctx && Number.isFinite(ctx.sunAu)) {
    term.rule('POSITION');
    term.pushKV('DISTANCE FROM SUN', fmtNum(ctx.sunAu, 4) + ' AU');
    term.pushKV('  IN KM', fmtDist(ctx.sunAu * 149597870.7));
  }
  if (ctx && Number.isFinite(ctx.earthAu)) {
    term.pushKV('DISTANCE FROM EARTH', fmtNum(ctx.earthAu, 5) + ' AU');
    term.pushKV('  IN LIGHT TIME', fmtLightTime(ctx.earthAu));
  }
  if (ctx && Number.isFinite(ctx.phase)) {
    term.pushKV('ILLUMINATED', Math.round(ctx.phase * 100) + '%');
  }

  if (ctx && ctx.el) {
    term.rule('ORBIT');
    term.pushKV('SEMI-MAJOR AXIS', fmtNum(ctx.el.a, 5) + ' AU');
    term.pushKV('ECCENTRICITY', fmtNum(ctx.el.e, 5));
    term.pushKV('INCLINATION', fmtNum(ctx.el.i, 4) + '°');
    term.pushKV('PERIOD', fmtNum(Math.pow(ctx.el.a, 1.5), 3) + ' YR');
  }

  term.rule('NOTE');
  term.push('  Positions come from JPL\'s approximate-elements table for the major ' +
            'planets. Globes are drawn far larger than scale so they are visible at all; ' +
            'the distances between them are the honest part.', 'dim wrap');
}

function fmtLightTime(au) {
  const s = au * 499.005;              // 1 AU in light-seconds
  if (s < 90) return fmtNum(s, 1) + ' S';
  if (s < 5400) return fmtNum(s / 60, 1) + ' MIN';
  return fmtNum(s / 3600, 2) + ' H';
}

/* ---------- Earth-orbit satellites ---------- */

function writeSatSheet(term, rec, ctx) {
  term.clear();
  term.rule('TARGET LOCK');
  term.push(`▶ ${rec.name}`, 'hdr');
  term.push('  Human-made object in Earth orbit.', 'dim');

  term.rule('IDENTITY');
  term.pushKV('NORAD ID', String(rec.norad));
  term.pushKV('INTL DESIGNATOR', rec.intlDes || '—');
  term.pushKV('ORBIT REGIME', `${rec.regime.code} — ${rec.regime.name}`);

  term.rule('STATE VECTOR');
  if (ctx && ctx.state) {
    term.pushKV('ALTITUDE', fmtInt(ctx.state.altKm) + ' KM');
    if (Number.isFinite(ctx.state.speedKmS)) {
      term.pushKV('SPEED', fmtNum(ctx.state.speedKmS, 2) + ' KM/S  (' +
        fmtInt(ctx.state.speedKmS * 3600) + ' KM/H)');
    }
    if (Number.isFinite(ctx.state.lat)) {
      term.pushKV('SUB-POINT LAT', fmtNum(ctx.state.lat, 2) + '°');
      term.pushKV('SUB-POINT LON', fmtNum(ctx.state.lon, 2) + '°');
    }
  } else {
    term.push('  SGP4 could not propagate this element set to the current time.', 'warn wrap');
  }

  term.rule('ORBIT');
  term.pushKV('PERIOD', Number.isFinite(rec.periodMin) ? fmtNum(rec.periodMin, 1) + ' MIN' : '—');
  term.pushKV('REVS PER DAY', fmtNum(rec.meanMotion, 4));
  term.pushKV('INCLINATION', fmtNum(rec.inc, 3) + '°');
  term.pushKV('ECCENTRICITY', fmtNum(rec.ecc, 6));
  term.pushKV('REV AT EPOCH', rec.revs != null ? fmtInt(rec.revs) : '—');
  term.pushKV('ELEMENT EPOCH', String(rec.epochIso || '—').replace('T', ' ').slice(0, 19));

  term.rule('NOTE');
  term.push('  Propagated with SGP4 from CelesTrak element sets — the model these ' +
            'elements are defined against. A TLE degrades within days, so an old set is ' +
            'genuinely worse data, not merely older.', 'dim wrap');
}

/* ---------- deep-space spacecraft ---------- */

function writeCraftSheet(term, rec, ctx) {
  term.clear();
  term.rule('TARGET LOCK');
  term.push(`▶ ${rec.name}`, 'hdr');
  if (rec.note) term.push('  ' + rec.note, 'dim wrap');

  term.rule('POSITION');
  if (ctx && Number.isFinite(ctx.sunAu)) {
    term.pushKV('DISTANCE FROM SUN', fmtNum(ctx.sunAu, 3) + ' AU');
    term.pushKV('  IN KM', fmtDist(ctx.sunAu * 149597870.7));
    term.pushKV('  LIGHT TIME', fmtLightTime(ctx.sunAu));
  }
  if (ctx && Number.isFinite(ctx.earthAu)) {
    term.pushKV('DISTANCE FROM EARTH', fmtNum(ctx.earthAu, 3) + ' AU');
    term.pushKV('  SIGNAL ROUND TRIP', fmtLightTime(ctx.earthAu * 2));
  }

  term.rule('TRAJECTORY');
  const el = rec.el;
  if (el) {
    const escaping = el.e >= 1;
    term.pushKV('ECCENTRICITY', fmtNum(el.e, 5) + (escaping ? '  (HYPERBOLIC)' : ''));
    term.pushKV('SEMI-MAJOR AXIS', fmtNum(el.a, 5) + ' AU');
    term.pushKV('INCLINATION', fmtNum(el.i, 4) + '°');
    term.pushKV('PERIHELION q', fmtNum(rec.q, 5) + ' AU');
    term.pushKV('APHELION Q', Number.isFinite(rec.ad) ? fmtNum(rec.ad, 4) + ' AU' : 'NONE — ESCAPING');
    term.pushKV('PERIOD', Number.isFinite(rec.per) ? fmtNum(rec.per / 365.25, 2) + ' YR' : 'NONE — ESCAPING');
    if (escaping) {
      term.push('  On an escape trajectory: eccentricity above 1 means the Sun cannot ' +
                'hold it. It will keep going, indefinitely.', 'dim wrap');
    }
  }

  term.rule('SOURCE');
  term.pushKV('EPHEMERIS', 'JPL HORIZONS');
  term.pushKV('ELEMENT EPOCH', el ? 'JD ' + fmtNum(el.epoch, 1) : '—');
  term.push('  Horizons sends no CORS header, so these elements were fetched ' +
            'server-side and committed with the page.', 'dim wrap');
}

/* ---------- asteroids ---------- */

function writeNeoSheet(term, rec, ctx) {
  term.clear();
  term.rule('TARGET LOCK');
  term.push(`▶ ${rec.name}${rec.nickname && rec.nickname !== rec.name ? '  “' + rec.nickname + '”' : ''}`, 'hdr');
  if (rec.note) term.push('  ' + rec.note, 'dim wrap');

  term.rule('IDENTITY');
  term.pushKV('DESIGNATION', rec.name);
  term.pushKV('OBJECT ID', String(rec.id));
  term.pushKV('ORBIT CLASS', rec.cls ? `${rec.cls}${rec.clsDesc ? ' — ' + shorten(rec.clsDesc) : ''}` : '—');
  term.pushKV('ABS MAGNITUDE', Number.isFinite(rec.H) ? 'H = ' + rec.H.toFixed(2) : '—');
  term.pushKV('DIAMETER', fmtDiam(rec));
  if (Number.isFinite(rec.albedo)) term.pushKV('ALBEDO', rec.albedo.toFixed(2));
  if (Number.isFinite(rec.rotPer)) term.pushKV('ROTATION', rec.rotPer.toFixed(2) + ' H');
  if (rec.spec) term.pushKV('SPECTRAL TYPE', rec.spec);

  term.rule('CLOSE APPROACH');
  if (rec.caDate) {
    term.pushKV('EPOCH', String(rec.caDate).toUpperCase());
    term.pushKV('MISS DISTANCE', `${fmtNum(rec.missAu, 5)} AU`);
    term.pushKV('  IN LUNAR DIST', `${fmtNum(rec.missLd, 2)} LD`);
    term.pushKV('  IN KM', fmtDist(rec.missKm));
    // null * 3600 is 0, so an unknown velocity used to print "0 KM/H" —
    // a fabricated measurement rather than an admission of missing data.
    term.pushKV('REL VELOCITY', Number.isFinite(rec.vKps)
      ? `${fmtNum(rec.vKps, 2)} KM/S  (${fmtInt(rec.vKps * 3600)} KM/H)`
      : '—');
  } else {
    term.push('  no close approach within 0.05 AU in the catalogued window', 'dim wrap');
  }

  // Tagged so the animation loop can refresh just this value as the clock
  // runs, instead of rewriting the sheet and losing scroll position.
  //
  // Labelled COMPUTED because every other number in this block is NASA's
  // published value and this one is not — it comes from the two-body
  // propagation in astro.js and inherits its drift.
  const live = term.pushKV('DISTANCE NOW (COMPUTED)', liveDistText(ctx && ctx.currentKm));
  live.id = 'liveDist';

  term.rule('ORBIT');
  const el = rec.el;
  if (el) {
    term.pushKV('SEMI-MAJOR AXIS', fmtNum(el.a, 5) + ' AU');
    term.pushKV('ECCENTRICITY', fmtNum(el.e, 5));
    term.pushKV('INCLINATION', fmtNum(el.i, 4) + '°');
    term.pushKV('ASC NODE Ω', fmtNum(el.om, 4) + '°');
    term.pushKV('ARG PERIHELION ω', fmtNum(el.w, 4) + '°');
    term.pushKV('MEAN ANOMALY M', fmtNum(el.ma, 4) + '°');
    term.pushKV('PERIHELION q', fmtNum(rec.q, 5) + ' AU');
    term.pushKV('APHELION Q', fmtNum(rec.ad, 5) + ' AU');
    term.pushKV('PERIOD', Number.isFinite(rec.per) ? `${fmtNum(rec.per, 1)} D  (${fmtNum(rec.per / 365.25, 2)} YR)` : '—');
    term.pushKV('EARTH MOID', Number.isFinite(rec.moid) ? fmtNum(rec.moid, 5) + ' AU' : '—');
  }

  term.rule('SOLUTION QUALITY');
  term.pushKV('ELEMENT EPOCH', el ? 'JD ' + fmtNum(el.epoch, 1) : '—');
  if (ctx && Number.isFinite(ctx.epochAgeDays)) {
    // Sign matters: an element set whose epoch is in the future is being
    // extrapolated backwards, and labelling that "FROM NOW" hid which way
    // the propagation is running.
    const d = ctx.epochAgeDays;
    const age = Math.abs(d);
    term.pushKV('EPOCH AGE', `${fmtInt(age)} D ${d >= 0 ? 'BEFORE NOW' : 'AFTER NOW'}`,
      age > 400 ? 'warn' : '');
  }
  term.pushKV('CONDITION CODE', rec.unc != null ? `${rec.unc} / 9` : '—');
  term.pushKV('OBSERVATIONS', rec.nobs != null ? fmtInt(rec.nobs) : '—');
  term.pushKV('DATA ARC', Number.isFinite(rec.arc) ? fmtInt(rec.arc) + ' D' : '—');
  term.pushKV('SOURCE', rec.source.toUpperCase().replace('-', ' / '));

  term.rule('HAZARD');
  term.pushKV('PHA FLAG', rec.pha ? 'TRUE' : 'FALSE', rec.pha ? 'warn' : '');
  term.pushKV('SENTRY OBJECT', rec.sentry ? 'TRUE' : 'FALSE', rec.sentry ? 'warn' : '');

  // Do not assert which test a non-PHA object failed. The flag comes from
  // JPL's own solution, and the MOID and H printed above are from a
  // possibly different epoch — so "it fails the MOID or the size cut"
  // can be contradicted by the two numbers on the same sheet.
  term.push(
    rec.pha
      ? '  PHA is a filing category, not a forecast. It means the orbit passes within 0.05 AU of ' +
        'Earth\'s and the object is absolute magnitude H 22 or brighter — close enough and large ' +
        'enough to be worth tracking. It does not mean an impact is expected.'
      : '  Not on the potentially-hazardous list. That list takes objects whose orbit comes within ' +
        '0.05 AU of Earth\'s and which are H 22 or brighter.',
    'dim wrap'
  );

  // Where an object IS on the Sentry risk list, print the real numbers
  // rather than leaving a bare TRUE that reads far more alarming than the
  // probabilities warrant.
  if (rec.sentry) {
    if (Number.isFinite(rec.sentryIp)) {
      term.pushKV('  CUMULATIVE IP', rec.sentryIp.toExponential(2) +
        (Number.isFinite(rec.sentryN) ? `  over ${fmtInt(rec.sentryN)} encounters` : ''));
    }
    if (Number.isFinite(rec.sentryPs)) {
      term.pushKV('  PALERMO SCALE', rec.sentryPs.toFixed(2));
    }
    term.push(
      '  Sentry lists every object with any non-zero computed impact probability over the next ' +
      'century or more, however small. A Palermo value below 0 means the hazard is below the ' +
      'background risk from objects that size. These are watch-list entries, not predictions.',
      'dim wrap'
    );
  }

  if (rec.jplUrl) {
    term.rule('REFERENCE');
    const el2 = term.push('', '');
    const a = document.createElement('a');
    a.href = rec.jplUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'JPL SMALL-BODY DATABASE ENTRY ▸';
    el2.appendChild(a);
  }
}

export function liveDistText(km) {
  if (!Number.isFinite(km)) return '—';
  return `${fmtDist(km)}  (${fmtNum(km / 384400, 1)} LD)`;
}

function shorten(s) {
  const t = String(s).split(/[;(]/)[0].trim();
  return t.length > 46 ? t.slice(0, 44) + '…' : t;
}
