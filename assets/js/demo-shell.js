/* =========================================================
   DEMO SHELL — shared runtime for every interactive under
   resources/demos/<slug>/.

   Load it in <head> WITHOUT defer so the theme is applied
   before first paint (no flash of the wrong theme):

     <script src="../../../assets/js/demo-shell.js"></script>

   Exposes a single global: Demo
     Demo.canvas(el, draw)   DPR-aware canvas; redraws on resize + theme change
     Demo.colors()           current palette, readable from canvas code
     Demo.loop(step)         requestAnimationFrame loop with start/stop
     Demo.range(input, fn)   wire a slider, fires immediately
     Demo.fmt.*              number formatting for science readouts
     Demo.onTheme(fn)        run fn whenever the theme flips
   ========================================================= */
(function (global) {
  'use strict';

  // ---------- Theme: applied immediately, before the body paints ----------
  try {
    var stored = localStorage.getItem('theme');
    if (!stored) {
      stored = global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', stored);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }

  var themeHandlers = [];

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function setTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { }
    // let CSS custom properties settle before canvases re-read them
    requestAnimationFrame(function () {
      for (var i = 0; i < themeHandlers.length; i++) themeHandlers[i](next);
    });
  }

  // ---------- Palette bridge ----------
  // Canvas can't use CSS custom properties, so read them off :root instead of
  // hard-coding hex values in 44 different demos.
  var COLOR_KEYS = [
    'bg', 'surface', 'surface-2', 'line', 'line-soft',
    'text', 'text-2', 'muted',
    'accent', 'accent-strong', 'accent-soft', 'accent-line',
    'track', 'series-1', 'series-2', 'series-3', 'series-4',
    'ok', 'warn', 'bad'
  ];

  function colors() {
    var cs = getComputedStyle(document.documentElement);
    var out = {};
    for (var i = 0; i < COLOR_KEYS.length; i++) {
      var k = COLOR_KEYS[i];
      // expose both 'accent-strong' and camelCase 'accentStrong'
      var v = cs.getPropertyValue('--' + k).trim();
      out[k] = v;
      out[k.replace(/-(\w)/g, function (m, c) { return c.toUpperCase(); })] = v;
    }
    out.series = [out['series-1'], out['series-2'], out['series-3'], out['series-4']];
    return out;
  }

  // ---------- Canvas ----------
  // Handles devicePixelRatio, container resize, and theme flips. The draw
  // callback receives (ctx, width, height, colors) in CSS pixels — never
  // multiply by dpr yourself.
  function canvas(el, draw, opts) {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) throw new Error('Demo.canvas: element not found');

    opts = opts || {};
    var ctx = el.getContext('2d');
    var ratio = opts.aspect || 0.62;   // height as a fraction of width
    var minH = opts.minHeight || 180;
    var maxH = opts.maxHeight || Infinity;
    var w = 0, h = 0, queued = false;

    function resize() {
      var dpr = Math.min(global.devicePixelRatio || 1, 2);
      var rect = el.getBoundingClientRect();
      var cssW = Math.max(1, Math.round(rect.width || el.parentNode.clientWidth || 300));
      var cssH = opts.height
        ? opts.height
        : Math.round(Math.min(maxH, Math.max(minH, cssW * ratio)));

      w = cssW; h = cssH;
      el.width = Math.round(cssW * dpr);
      el.height = Math.round(cssH * dpr);
      el.style.height = cssH + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    var api = {
      ctx: ctx,
      el: el,
      get width() { return w; },
      get height() { return h; },
      clear: function () { ctx.clearRect(0, 0, w, h); },
      redraw: function () {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          ctx.clearRect(0, 0, w, h);
          draw(ctx, w, h, colors());
        });
      },
      // synchronous variant for animation loops that already own the frame
      paint: function () {
        ctx.clearRect(0, 0, w, h);
        draw(ctx, w, h, colors());
      },
      resize: function () { resize(); api.redraw(); }
    };

    resize();

    if (global.ResizeObserver) {
      var ro = new ResizeObserver(function () { resize(); api.redraw(); });
      ro.observe(el.parentNode || el);
    } else {
      global.addEventListener('resize', function () { resize(); api.redraw(); });
    }

    themeHandlers.push(function () { api.redraw(); });

    // first paint once fonts/layout have settled
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { api.resize(); });
    } else {
      api.redraw();
    }

    return api;
  }

  // ---------- Animation loop ----------
  function loop(step) {
    var id = null, last = 0, running = false;

    function frame(t) {
      if (!running) return;
      // Establish the time baseline without ever handing step() a zero dt.
      // A zero-length step looks like "no time left" to any integrator that
      // guards on remaining time, which silently halts the simulation on
      // frame one. Skip the first frame instead.
      if (!last) { last = t; id = requestAnimationFrame(frame); return; }
      var dt = Math.min((t - last) / 1000, 0.1);   // clamp tab-switch jumps
      last = t;
      step(dt, t / 1000);
      id = requestAnimationFrame(frame);
    }

    return {
      start: function () {
        if (running) return;
        running = true; last = 0;
        id = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        if (id) cancelAnimationFrame(id);
        id = null;
      },
      toggle: function () { running ? this.stop() : this.start(); },
      get running() { return running; }
    };
  }

  // ---------- Slider wiring ----------
  // Demo.range('#pH', function (v) { ... }) — fires once immediately so the
  // initial readout matches the initial slider position.
  function range(input, fn) {
    if (typeof input === 'string') input = document.querySelector(input);
    if (!input) return null;
    function handler() { fn(parseFloat(input.value), input); }
    input.addEventListener('input', handler);
    handler();
    return {
      el: input,
      set: function (v) { input.value = v; handler(); },
      get: function () { return parseFloat(input.value); }
    };
  }

  // ---------- Number formatting ----------
  var fmt = {
    // fixed decimals, but never render "-0.00"
    dec: function (x, n) {
      if (!isFinite(x)) return '—';
      var s = x.toFixed(n == null ? 2 : n);
      return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
    },
    // significant figures — the chemistry demos need this constantly
    sig: function (x, n) {
      if (!isFinite(x)) return '—';
      if (x === 0) return '0';
      n = n || 3;
      var out = Number(x.toPrecision(n));
      // avoid JS exponent notation creeping in for mid-range values.
      // sci() counts DECIMALS on the mantissa, so n sig figs is n-1 decimals.
      return Math.abs(out) >= 1e-4 && Math.abs(out) < 1e6 ? String(out) : fmt.sci(x, n - 1);
    },
    // 1.0 × 10⁻⁷  — real superscripts, no MathJax needed
    sci: function (x, n) {
      if (!isFinite(x)) return '—';
      if (x === 0) return '0';
      n = n == null ? 2 : n;
      var exp = Math.floor(Math.log10(Math.abs(x)));
      var mant = x / Math.pow(10, exp);
      // rounding can push 9.99 → 10.0
      if (Math.abs(Number(mant.toFixed(n))) >= 10) { mant /= 10; exp += 1; }
      return mant.toFixed(n) + ' × 10' + fmt.sup(exp);
    },
    sup: function (n) {
      var map = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³',
                  '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
      return String(n).split('').map(function (c) { return map[c] || c; }).join('');
    },
    pct: function (x, n) { return fmt.dec(x * 100, n == null ? 1 : n) + '%'; },
    // 1234567 → "1,234,567"
    comma: function (x) { return Math.round(x).toLocaleString('en-US'); }
  };

  // ---------- Misc helpers ----------
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Seeded RNG — reproducible runs matter for the stochastic demos
  // (drift, chi-square sampling, Monte Carlo equilibrium).
  function rng(seed) {
    var s = (seed == null ? 1 : seed) >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5;  s >>>= 0;
      return s / 4294967296;
    };
  }

  // Box–Muller, for the demos that need normal deviates
  function gauss(rand) {
    var u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ---------- Page chrome ----------
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    var btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', function () {
        setTheme(currentTheme() === 'light' ? 'dark' : 'light');
      });
    }

    // kill transition ghosting while the window is being dragged
    var t;
    global.addEventListener('resize', function () {
      document.body.classList.add('no-transition');
      clearTimeout(t);
      t = setTimeout(function () { document.body.classList.remove('no-transition'); }, 150);
    });
  });

  global.Demo = {
    canvas: canvas,
    colors: colors,
    loop: loop,
    range: range,
    fmt: fmt,
    clamp: clamp,
    lerp: lerp,
    rng: rng,
    gauss: gauss,
    ready: ready,
    theme: currentTheme,
    setTheme: setTheme,
    onTheme: function (fn) { themeHandlers.push(fn); }
  };
})(window);
