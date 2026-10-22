/* Hero viewer: a synthetic coronal slab drawn like an MRI slice in a viewer.
   White matter with scanner grain, FreeSurfer-style white-matter (yellow) and
   pial (red) contours, an ECoG strip on the crowns, and one source whose
   signal at each contact comes from the shared dipole model. The gray matter
   is shaded by how strongly a source there reaches the electrodes, so the
   cortex the strip barely sees is drawn dim on purpose.
   One authored moment on load: the slice is acquired, then the source moves
   from a crown into the deepest fold and rests there. The pointer probes
   the cortex afterwards. Schematic and synthetic, not patient data. */
(function () {
  'use strict';

  var M = window.CorticalModel;
  var root = document.querySelector('[data-hero-viewer]');
  if (!M || !root) return;
  var canvas = root.querySelector('[data-hero-canvas]');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var outRegion = document.querySelector('[data-hero-out="region"]');
  var outDepth = document.querySelector('[data-hero-out="depth"]');
  var outSignal = document.querySelector('[data-hero-out="signal"]');
  var hint = document.querySelector('[data-hero-hint]');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia('(pointer: coarse)');

  var HALF = 1.25, ELEC_Y = 0.5;
  var V_REF = 1 / Math.pow(ELEC_Y + HALF, 2);     // a crown source directly beneath a contact
  var Y_TOP = 2.0, Y_BOT = -20.5;                  // visible depth range, mm
  var BAND = 28;                                   // px kept black above the strip for the truth label
  var DEEP_X = 4;                                  // the deepest fold
  var REGION_NAME = { crown: 'Gyral crown', lip: 'Lip of the sulcus', wall: 'Sulcal wall', fundus: 'Fundus' };
  var fold = M.buildFold({
    xMin: -200, xMax: 200, lip: 3.2, dome: 1.6,
    sulci: [
      { x: -158, depth: 9 }, { x: -124, depth: 12 }, { x: -92, depth: 10 }, { x: -60, depth: 8 },
      { x: -27, depth: 11 }, { x: DEEP_X, depth: 16 }, { x: 31, depth: 8 }, { x: 62, depth: 12 },
      { x: 94, depth: 9 }, { x: 127, depth: 11 }, { x: 160, depth: 8 }
    ]
  });
  var CONTACTS = [];
  for (var cx = -196; cx <= 196; cx += 4) CONTACTS.push(cx);

  // Reach: the peak of a source's potential along the electrode plane, relative to a crown
  // source directly beneath a contact. For a source at depth d whose cortical normal is tilted
  // θ from vertical, the peak is REACH[θ] / d², where REACH[θ] is the maximum of cos²φ · cos(φ − θ).
  var REACH = (function () {
    var table = [];
    for (var deg = 0; deg <= 180; deg++) {
      var best = 0, th = deg * Math.PI / 180;
      for (var phi = -89.5; phi <= 89.5; phi += 0.5) {
        var f = phi * Math.PI / 180, c = Math.cos(f);
        best = Math.max(best, Math.abs(c * c * Math.cos(f - th)));
      }
      table.push(best);
    }
    return table;
  })();
  function reach(p) {
    var d = ELEC_Y - p.y;
    return REACH[Math.round(Math.abs(Math.atan2(p.nx, p.ny)) * 180 / Math.PI)] / (d * d) / V_REF;
  }

  var view = { W: 0, H: 0, k: 10, x0: 0, top: 0, dpr: 1, narrow: false };
  var base = document.createElement('canvas');
  var state = { s: 0, probe: null, pointer: null, journey: 0, settled: false };
  var REST = M.nearest(fold, DEEP_X - 1.75, -7, 0, fold.total).s;      // left wall of the deep fold
  var START = M.nearest(fold, DEEP_X - 12, -HALF, 0, fold.total).s;    // crown to its left
  state.s = REST;

  function X(x) { return (x - view.x0) * view.k; }
  function Y(y) { return view.top + (Y_TOP - y) * view.k; }

  function trace(c, pts, move) {
    pts.forEach(function (p, i) {
      if (i === 0 && move !== false) c.moveTo(X(p.x), Y(p.y)); else c.lineTo(X(p.x), Y(p.y));
    });
  }

  function makeNoise() {
    var n = document.createElement('canvas');
    n.width = n.height = 160;
    var g = n.getContext('2d'), img = g.createImageData(160, 160), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      // Rician-looking grain: magnitude of two Gaussian-ish samples around mid gray.
      var a = (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
      var b = (Math.random() + Math.random() + Math.random() - 1.5) * 0.9;
      var v = 128 + 60 * (Math.sqrt(a * a + b * b) - 0.75);
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return n;
  }
  var noise = makeNoise();

  // The stylesheet sets the slice's size; below the label band the full depth range fits
  // its height, and the width shows as much cortex as that true scale allows.
  function layout() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.round(rect.width), h = Math.round(rect.height);
    if (!w || !h) return false;
    view.W = w;
    view.H = h;
    view.top = BAND;
    view.k = (h - BAND) / (Y_TOP - Y_BOT);
    view.narrow = w < 640;
    view.x0 = (view.narrow ? DEEP_X - 2 : 0) - w / view.k / 2;
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * view.dpr);
    canvas.height = Math.round(h * view.dpr);
    base.width = canvas.width;
    base.height = canvas.height;
    drawBase();
    return true;
  }

  // Everything that does not change with the source: tissue, grain, contours, strip, labels.
  var tissue = document.createElement('canvas');
  function drawBase() {
    var b = base.getContext('2d'), W = view.W, H = view.H, k = view.k;
    b.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    b.fillStyle = '#000';
    b.fillRect(0, 0, W, H);

    // Tissue is drawn apart, then softened like a reconstructed slice (partial volume),
    // so only the surface contours stay crisp.
    tissue.width = base.width;
    tissue.height = base.height;
    var t = tissue.getContext('2d');
    t.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    t.beginPath();
    trace(t, fold.white);
    t.lineTo(X(fold.white[fold.white.length - 1].x), H + 10);
    t.lineTo(X(fold.white[0].x), H + 10);
    t.closePath();
    t.fillStyle = '#5e5e5e';                 // white matter: brighter than gray matter on T1, windowed dark
    t.fill();
    // Image formation, white matter only (the cortex's brightness is data): a faint, slow
    // intensity drift as in a real acquisition, and a dimming with depth as under a surface coil.
    t.globalCompositeOperation = 'source-atop';
    [[0.18, 0.75, 0.55, 0.10], [0.62, 1.05, 0.7, -0.08], [0.9, 0.6, 0.45, 0.07]].forEach(function (blob) {
      var gx = blob[0] * W, gy = blob[1] * H, gr = blob[2] * W;
      var grad = t.createRadialGradient(gx, gy, 0, gx, gy, gr);
      var c = blob[3] > 0 ? '255,255,255' : '0,0,0';
      grad.addColorStop(0, 'rgba(' + c + ',' + Math.abs(blob[3]) + ')');
      grad.addColorStop(1, 'rgba(' + c + ',0)');
      t.fillStyle = grad;
      t.fillRect(0, 0, W, H);
    });
    var fade = t.createLinearGradient(0, Y(-3), 0, Y(-20));
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    t.fillStyle = fade;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'source-over';

    // Gray matter, shaded by reach: full T1 gray where a source reaches the strip as well as
    // a crown source, close to black where it reaches it at 1% or less.
    var lo = view.x0 - 4, hi = view.x0 + W / k + 4, n = fold.path.length, STEP = 6;
    for (var i = 0; i < n - 1; i += STEP) {
      var p = fold.path[i];
      if (p.x < lo || p.x > hi) continue;
      var j = Math.min(n - 1, i + STEP + 3);              // overlap neighbours so no seams show
      var r = Math.max(0, Math.min(1, (Math.log(reach(p)) / Math.LN10 + 2) / 2));
      var g = Math.round(14 + 52 * r);
      t.beginPath();
      t.moveTo(X(fold.pial[i].x), Y(fold.pial[i].y));
      t.lineTo(X(fold.pial[j].x), Y(fold.pial[j].y));
      t.lineTo(X(fold.white[j].x), Y(fold.white[j].y));
      t.lineTo(X(fold.white[i].x), Y(fold.white[i].y));
      t.closePath();
      t.fillStyle = 'rgb(' + g + ',' + g + ',' + g + ')';
      t.fill();
    }

    b.save();
    b.filter = 'blur(' + Math.max(0.8, 0.12 * k).toFixed(2) + 'px)';
    b.drawImage(tissue, 0, 0, W, H);
    b.restore();
    tissue.width = tissue.height = 0;        // release the scratch canvas until the next layout

    b.save();
    b.globalCompositeOperation = 'overlay';
    b.globalAlpha = 0.55;
    b.fillStyle = b.createPattern(noise, 'repeat');
    b.fillRect(0, 0, W, H);
    b.restore();

    b.lineJoin = 'round';
    b.lineWidth = 1.25;
    b.beginPath(); trace(b, fold.white); b.strokeStyle = 'rgba(255, 210, 63, 0.9)'; b.stroke();
    b.beginPath(); trace(b, fold.pial); b.strokeStyle = 'rgba(255, 77, 61, 0.95)'; b.stroke();

    // Silicone strip resting on the crowns.
    var top = Y(ELEC_Y + 0.8), bottom = Y(ELEC_Y);
    b.fillStyle = 'rgba(235, 235, 235, 0.12)';
    b.fillRect(X(CONTACTS[0] - 2), top, X(CONTACTS[CONTACTS.length - 1] + 2) - X(CONTACTS[0] - 2), bottom - top);
    b.fillStyle = 'rgba(255, 255, 255, 0.22)';
    b.fillRect(X(CONTACTS[0] - 2), top, X(CONTACTS[CONTACTS.length - 1] + 2) - X(CONTACTS[0] - 2), 1);

    var font = '400 ' + (view.narrow ? 12 : 13) + 'px "Atkinson Hyperlegible Mono", ui-monospace, Menlo, Consolas, monospace';

    // Scale bar, bottom left: 1 cm. (Left out of the wide still image, whose edges get cropped.)
    b.font = font;
    b.textAlign = 'left';
    if (!root.hasAttribute('data-still')) {
      var sx = Math.max(16, X(view.x0 + 2)), sy = H - 18, len = 10 * k;
      b.fillStyle = 'rgba(237, 237, 237, 0.85)';
      b.fillRect(sx, sy, len, 1.5);
      b.fillRect(sx, sy - 4, 1.5, 9);
      b.fillRect(sx + len - 1.5, sy - 4, 1.5, 9);
      b.textBaseline = 'bottom';
      b.fillText('1 cm', sx, sy - 6);
    }

    // One annotation for the cortex the strip barely sees: the deep fold's far wall.
    // It wraps when one line would run into the next fold (about 18 mm of white matter).
    var lines = ['under 5% of a crown source'];
    if (view.narrow || b.measureText(lines[0]).width / k > 18) lines = ['under 5% of', 'a crown source'];
    var lh = view.narrow ? 16 : 17;
    var tx = X(DEEP_X + 4.2), ty = Y(-10) - (lines.length - 1) * lh / 2;
    var ax = X(DEEP_X + 1.75), ay = Y(-9.6);
    b.strokeStyle = 'rgba(237, 237, 237, 0.6)';
    b.lineWidth = 1;
    b.beginPath();
    b.moveTo(tx - 5, Y(-10));
    b.lineTo(ax, ay);
    b.stroke();
    b.beginPath();
    b.arc(ax, ay, 2.25, 0, Math.PI * 2);
    b.fillStyle = 'rgba(237, 237, 237, 0.9)';
    b.fill();
    b.save();
    b.shadowColor = '#000';
    b.shadowBlur = 4;
    b.fillStyle = '#d0d0d0';
    b.textBaseline = 'middle';
    lines.forEach(function (s, i) { b.fillText(s, tx, ty + i * lh); });
    b.restore();
  }

  function signalAt(src) {
    var peak = 0, values = [];
    CONTACTS.forEach(function (c) {
      var v = M.potential(c, ELEC_Y, 0, src);
      values.push(v);
      if (Math.abs(v) > peak) peak = Math.abs(v);
    });
    return { values: values, peak: peak };
  }

  function format(pct) {
    if (pct >= 10) return Math.round(pct) + '%';
    if (pct >= 1) return pct.toFixed(1) + '%';
    return pct.toFixed(2) + '%';
  }

  function render() {
    frame = 0;
    if (!view.W) return;
    var W = view.W, H = view.H, k = view.k;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(base, 0, 0, W, H);

    var src = M.at(fold, state.s);
    var sig = signalAt(src);
    var sx = X(src.x), sy = Y(src.y);

    // Crosshair, as in a slice viewer: at the pointer while probing, otherwise through the source at rest.
    var cross = state.pointer || (state.journey ? null : { x: sx, y: sy });
    if (cross && cross.y >= view.top) {
      ctx.fillStyle = state.pointer ? 'rgba(237, 237, 237, 0.32)' : 'rgba(237, 237, 237, 0.2)';
      ctx.fillRect(0, Math.round(cross.y), W, 1);
      ctx.fillRect(Math.round(cross.x), view.top, 1, H - view.top);   // stops at the label band
    }

    // Contacts: unlit ones stay drawn as rings, lit ones take the activity colour.
    var r = Math.max(3, 0.55 * k);
    CONTACTS.forEach(function (c, i) {
      var px = X(c);
      if (px < -r || px > W + r) return;
      var v = sig.values[i];
      var t = (Math.log(Math.abs(v) / V_REF + 1e-12) / Math.LN10 + 2) / 2;   // 1% to 100% of a crown source
      t = Math.max(0, Math.min(1, t));
      ctx.beginPath();
      ctx.arc(px, Y(ELEC_Y), r, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      if (t > 0.02) {
        var col = M.activityColor(v, 0.35 + 0.65 * t);
        ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (0.2 + 0.8 * t).toFixed(3) + ')';
        ctx.fill();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.stroke();
    });

    // The source: a dipole arrow along the cortical normal and a bright core.
    var tipX = X(src.x + 1.7 * src.nx), tipY = Y(src.y + 1.7 * src.ny);
    var tailX = X(src.x - 0.8 * src.nx), tailY = Y(src.y - 0.8 * src.ny);
    var ux = tipX - tailX, uy = tipY - tailY, ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    var head = Math.max(5, 0.45 * k);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#ededed';
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX - ux * head * 0.6, tipY - uy * head * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * head - uy * head * 0.55, tipY - uy * head + ux * head * 0.55);
    ctx.lineTo(tipX - ux * head + uy * head * 0.55, tipY - uy * head - ux * head * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#ededed';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4, 0.42 * k), 0, Math.PI * 2);
    ctx.fillStyle = '#ffe478';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    var depth = ELEC_Y - src.y;
    if (outRegion) outRegion.textContent = REGION_NAME[src.part] || '';
    if (outDepth) outDepth.textContent = depth.toFixed(1) + ' mm';
    if (outSignal) outSignal.textContent = format(100 * sig.peak / V_REF) + ' of a crown source';
  }

  var frame = 0;
  function request() { if (!frame) frame = window.requestAnimationFrame(render); }

  /* ---------- The one authored sequence ---------- */
  function playJourney() {
    if (reduceMotion.matches) { state.s = REST; request(); return; }
    canvas.classList.add('is-acquiring');
    state.s = START;
    var t0 = 0, delay = 650, duration = 4200;
    function step(now) {
      if (!t0) t0 = now;
      var t = Math.min(1, Math.max(0, (now - t0 - delay) / duration));
      state.s = START + (REST - START) * M.easeInOut(t);
      render();
      if (t < 1 && state.journey) state.journey = window.requestAnimationFrame(step);
      else { state.journey = 0; request(); }               // settle: the crosshair locks onto the source
    }
    state.journey = window.requestAnimationFrame(step);
    request();
  }
  function stopJourney() {
    if (state.journey) window.cancelAnimationFrame(state.journey);
    state.journey = 0;
  }

  /* ---------- Probing with the pointer ---------- */
  function toModel(event) {
    var rect = canvas.getBoundingClientRect();
    var px = event.clientX - rect.left, py = event.clientY - rect.top;
    return { px: px, py: py, x: px / view.k + view.x0, y: Y_TOP - (py - view.top) / view.k };
  }
  function probe(event) {
    var m = toModel(event);
    state.pointer = { x: m.px, y: m.py };
    var lo = M.sAtCrownX(fold, view.x0 + 1), hi = fold.total - (fold.path[fold.path.length - 1].x - (view.x0 + view.W / view.k - 1));
    var hit = M.nearest(fold, m.x, m.y, lo, hi);
    if (hit.dist < 3) { stopJourney(); state.s = hit.s; }
    request();
  }
  canvas.addEventListener('pointermove', function (event) {
    if (event.pointerType === 'touch') return;
    probe(event);
  });
  canvas.addEventListener('pointerdown', function (event) { probe(event); });
  canvas.addEventListener('pointerleave', function () { state.pointer = null; request(); });

  if (hint && coarse.matches) hint.textContent = 'Tap the cortex to probe it.';

  /* ---------- Setup ---------- */
  if (layout()) render();
  var started = false;
  function start() {
    if (started) return;
    started = true;
    playJourney();
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) start();
    }, { threshold: 0.25 }).observe(canvas);
  } else {
    start();
  }
  if ('ResizeObserver' in window) {
    var pending = 0;
    new ResizeObserver(function () {
      if (pending) return;
      pending = window.requestAnimationFrame(function () { pending = 0; if (layout()) render(); });
    }).observe(root);
  } else {
    window.addEventListener('resize', function () { if (layout()) render(); });
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (layout()) render(); });
})();
