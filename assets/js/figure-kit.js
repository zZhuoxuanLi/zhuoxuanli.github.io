/* Shared helpers for the project figures (fig-speech.js, fig-behavior.js):
   seeded noise so every visitor sees the same synthetic example, canvas sizing,
   rasters in the site's activity colours, mono labels, glides on the site's
   motion curve, pointer scrubbing, and a polite live-region announcer. */
(function () {
  'use strict';

  var M = window.CorticalModel;
  if (!M) return;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var MONO = '"Atkinson Hyperlegible Mono", ui-monospace, Menlo, Consolas, monospace';
  var SANS = '"Atkinson Hyperlegible Next", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  // mulberry32: small and seeded, so the example is identical on every visit.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussian(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Moving average with radius r, edges handled by shrinking the window.
  function smooth(a, r) {
    var out = new Array(a.length);
    for (var i = 0; i < a.length; i++) {
      var s = 0, n = 0;
      for (var j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; n++; }
      out[i] = s / n;
    }
    return out;
  }

  // Sizes a canvas to a CSS height at device resolution and returns its context in CSS pixels.
  function fit(canvas, cssHeight) {
    if (cssHeight) canvas.style.height = cssHeight + 'px';
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, W: w, H: h, dpr: dpr };
  }

  // Paints a rows × cols matrix into a rectangle. kind 'activity' uses the warm/cool
  // activity ramps (values in units of `scale`); kind 'gray' paints values 0..1 as light.
  var scratch = document.createElement('canvas');
  function raster(ctx, rows, x, y, w, h, kind, scale) {
    var nr = rows.length, nc = rows[0].length;
    scratch.width = nc;
    scratch.height = nr;
    var sctx = scratch.getContext('2d'), img = sctx.createImageData(nc, nr), d = img.data;
    for (var r = 0; r < nr; r++) {
      for (var c = 0; c < nc; c++) {
        var v = rows[r][c], i = (r * nc + c) * 4, rgb, a;
        if (kind === 'gray') {
          a = Math.pow(Math.max(0, Math.min(1, v)), 0.6);
          rgb = [237, 237, 237];
        } else {
          var t = Math.min(1, Math.abs(v) / scale);
          rgb = M.activityColor(v, 0.3 + 0.7 * t);
          a = (v < 0 ? 0.55 : 0.92) * Math.pow(t, 0.9);
        }
        d[i] = Math.round(rgb[0] * a); d[i + 1] = Math.round(rgb[1] * a); d[i + 2] = Math.round(rgb[2] * a); d[i + 3] = 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, x, y, w, h);
    ctx.restore();
  }

  // Paints a colour key into an element with the same ramp and opacity as raster() over black:
  // 'activity' runs from the negative peak through zero to the positive peak, 'gray' from 0 to 1.
  function ramp(el, kind) {
    if (!el) return;
    var stops = [];
    for (var i = 0; i <= 20; i++) {
      var rgb, a, f = i / 20;
      if (kind === 'gray') {
        a = Math.pow(f, 0.6);
        rgb = [237, 237, 237];
      } else {
        var v = f * 2 - 1, t = Math.abs(v);
        rgb = M.activityColor(v, 0.3 + 0.7 * t);
        a = (v < 0 ? 0.55 : 0.92) * Math.pow(t, 0.9);
      }
      stops.push('rgb(' + rgb.map(function (c) { return Math.round(c * a); }).join(',') + ') ' + (i * 5) + '%');
    }
    el.style.backgroundImage = 'linear-gradient(90deg, ' + stops.join(', ') + ')';
  }

  // Canvas text in the instrument's voice: mono 13px, or 12px on narrow views, as in Fig. 1.
  function text(ctx, s, x, y, opts) {
    opts = opts || {};
    ctx.font = (opts.weight || 400) + ' ' + (opts.size || 13) + 'px ' + (opts.sans ? SANS : MONO);
    ctx.fillStyle = opts.color || '#8a8a8a';
    ctx.textAlign = opts.align || 'left';
    ctx.textBaseline = opts.baseline || 'alphabetic';
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
  }

  // Glides a value on the site's in-out curve; jumps under reduced motion. Returns a cancel function.
  function glide(from, to, duration, apply, done) {
    var id = 0;
    if (reduceMotion.matches || from === to) { apply(to); if (done) done(); return function () {}; }
    var t0 = 0;
    function step(now) {
      if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / duration);
      apply(from + (to - from) * M.easeInOut(t));
      if (t < 1) id = window.requestAnimationFrame(step);
      else { id = 0; if (done) done(); }
    }
    id = window.requestAnimationFrame(step);
    return function () { if (id) window.cancelAnimationFrame(id); id = 0; };
  }

  // Pointer scrubbing on a canvas: toValue(event) maps a pointer to a value.
  function scrub(canvas, toValue, onValue, onEnd) {
    var active = false;
    canvas.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button > 0) return;
      active = true;
      try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* capture is a nicety */ }
      onValue(toValue(event));
    });
    canvas.addEventListener('pointermove', function (event) { if (active) onValue(toValue(event)); });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (name) {
      canvas.addEventListener(name, function () { if (active) { active = false; if (onEnd) onEnd(); } });
    });
  }

  function announcer(el) {
    var timer = 0;
    return function (message) {
      clearTimeout(timer);
      timer = setTimeout(function () { if (el) el.textContent = message; }, 450);
    };
  }

  function onResize(el, fn) {
    if ('ResizeObserver' in window) {
      var pending = 0;
      new ResizeObserver(function () {
        if (pending) return;
        pending = window.requestAnimationFrame(function () { pending = 0; fn(); });
      }).observe(el);
    } else {
      window.addEventListener('resize', fn);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fn);
  }

  window.FigureKit = {
    rng: rng, gaussian: gaussian, smooth: smooth, fit: fit, raster: raster, ramp: ramp, text: text, mono: MONO,
    glide: glide, scrub: scrub, announcer: announcer, onResize: onResize, reduceMotion: reduceMotion
  };
})();
