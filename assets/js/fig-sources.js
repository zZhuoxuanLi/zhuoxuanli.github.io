/* Figure: what the electrode array records
   ------------------------------------------------------------------
   Linked views of one toy source (see model.js): a section through a single
   fold, and the electrode grid seen from above. Both views share a crosshair
   at the source, the way slice views do in a neuroimaging viewer. Optional
   estimates (L2 minimum-norm and sparse Bayesian learning) are painted into
   the cortex. Illustration only; no noise; not research code. */
(function () {
  'use strict';

  var M = window.CorticalModel;
  var fig = document.querySelector('[data-fig="sources"]');
  if (!M || !fig) return;
  var canvas = fig.querySelector('[data-fig-canvas]');
  var arrayCanvas = fig.querySelector('[data-fig-array]');
  if (!canvas || !canvas.getContext || !arrayCanvas) return;
  var ctx = canvas.getContext('2d');
  var actx = arrayCanvas.getContext('2d');
  var stage = canvas.parentNode;
  var handle = fig.querySelector('[data-fig-handle]');
  var slider = fig.querySelector('[data-fig-slider]');
  var resetButton = fig.querySelector('[data-fig-reset]');
  var presetButtons = Array.prototype.slice.call(fig.querySelectorAll('[data-preset]'));
  var methodInputs = Array.prototype.slice.call(fig.querySelectorAll('input[name="fig1-method"]'));
  var out = {};
  Array.prototype.forEach.call(fig.querySelectorAll('[data-out]'), function (el) { out[el.getAttribute('data-out')] = el; });
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Model ---------- */
  var HALF = 1.25, ELEC_Y = 0.5;
  var CONTACTS = [-16, -12, -8, -4, 0, 4, 8, 12, 16];   // 4 mm pitch; the row in the section
  var ROWS = [-8, -4, 0, 4, 8];                         // grid rows along the fold (array view)
  var PATH_X = 30, SRC_LIMIT = 13, GRID_LIMIT = 22, N_GRID = 161;
  var Y_TOP = 3.0, Y_BOT = -18.4, FUNDUS_DEPTH = 14;
  var V_REF = 1 / Math.pow(ELEC_Y + HALF, 2);           // crown source directly beneath a contact
  var DEG = Math.PI / 180;

  var fold = M.buildFold({ xMin: -PATH_X, xMax: PATH_X, sulci: [{ x: 0, depth: FUNDUS_DEPTH }], half: HALF });
  var path = fold.path, total = fold.total, pial = fold.pial, white = fold.white;
  var sLo = PATH_X - SRC_LIMIT, sHi = total - (PATH_X - SRC_LIMIT);

  // Candidate sources for the estimates, and the lead field of the section row.
  var gridLo = PATH_X - GRID_LIMIT, gridHi = total - (PATH_X - GRID_LIMIT);
  var GRID_DS = (gridHi - gridLo) / (N_GRID - 1);
  var grid = [];
  for (var g = 0; g < N_GRID; g++) grid.push(M.at(fold, gridLo + GRID_DS * g));
  var inverse = M.createInverse(CONTACTS.map(function (cx) { return grid.map(function (src) { return M.potential(cx, ELEC_Y, 0, src); }); }));
  var estFirst = 0, estLast = path.length - 1;
  while (estFirst < path.length - 1 && path[estFirst].s < gridLo) estFirst++;
  while (estLast > 0 && path[estLast].s > gridHi) estLast--;

  var REGION_NAME = { crown: 'Gyral crown', lip: 'Lip of the sulcus', wall: 'Sulcal wall', fundus: 'Fundus' };
  var EXPLAIN = {
    crown: 'On a gyral crown the source points straight at the array, so the contacts nearest it record a strong, focal signal.',
    lip: 'At the lip of the sulcus the cortex bends away from the array. The source tilts, and its signal weakens and spreads across contacts.',
    wall: 'In the sulcal wall the source points sideways. The array records a weak, split pattern, positive on one side of the fold and negative on the other.',
    fundus: 'At the fundus the source points toward the array again, but from deep in the fold, so the array records only a faint, broad bump.'
  };
  var METHOD_NOTE = {
    mne: 'Minimum-norm estimation picks the pattern with the least total activity that explains the recordings. Shallow sources need less activity to produce the same signal, so deep activity tends to be spread toward the surface.',
    sbl: 'Sparse Bayesian learning lets the data switch most candidate sources off, which favors a compact explanation. This example has no noise and a perfect head model. Real recordings are much harder, which is what the benchmarks in my project test.'
  };
  var METHOD_NAME = { mne: 'Minimum-norm', sbl: 'Sparse Bayesian' };

  var PRESETS = {
    crown: M.nearest(fold, -12, -HALF, sLo, sHi).s,
    wall: M.nearest(fold, -(0.5 + HALF), -7, sLo, sHi).s,
    fundus: M.nearest(fold, 0, -FUNDUS_DEPTH - HALF, sLo, sHi).s
  };
  var state = { s: PRESETS.wall, method: 'off' };
  var cache = { key: '', x: null };

  function measure(src) { return CONTACTS.map(function (cx) { return M.potential(cx, ELEC_Y, 0, src); }); }

  function compute() {
    var src = M.at(fold, state.s);
    var y = measure(src), gmax = 0;
    y.forEach(function (v) { gmax = Math.max(gmax, Math.abs(v)); });
    var est = null, err = null;
    if (state.method !== 'off') {
      var key = state.method + ':' + state.s.toFixed(3);
      if (cache.key !== key) {
        cache.key = key;
        cache.x = state.method === 'mne' ? inverse.minimumNorm(y) : inverse.sparseBayesian(y, 160);
      }
      est = cache.x;
      var best = 0, bestV = -1;
      for (var n = 0; n < N_GRID; n++) if (Math.abs(est[n]) > bestV) { bestV = Math.abs(est[n]); best = n; }
      err = Math.hypot(grid[best].x - src.x, grid[best].y - src.y);
    }
    return { src: src, y: y, gmax: gmax, est: est, err: err };
  }

  /* ---------- Section view ---------- */
  var view = { x0: -20, k: 16, W: 0, H: 0, dpr: 1, narrow: false };
  var field = { canvas: document.createElement('canvas'), cell: 3, w: 0, h: 0, img: null };
  field.ctx = field.canvas.getContext('2d');
  var grain = (function () {
    var n = document.createElement('canvas');
    n.width = n.height = 128;
    var gg = n.getContext('2d'), img = gg.createImageData(128, 128), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var v = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 70;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, v));
      d[i + 3] = 255;
    }
    gg.putImageData(img, 0, 0);
    return n;
  })();

  function X(x) { return (x - view.x0) * view.k; }
  function Y(y) { return (Y_TOP - y) * view.k; }
  function polyline(c, pts, move) {
    pts.forEach(function (p, i) {
      if (i === 0 && move !== false) c.moveTo(X(p.x), Y(p.y)); else c.lineTo(X(p.x), Y(p.y));
    });
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a.toFixed(3) + ')'; }

  // Draws a label and keeps it inside the canvas.
  function label(c, text, x, y, align, color, size, width) {
    c.font = '400 ' + size + 'px "Atkinson Hyperlegible Mono", ui-monospace, Menlo, Consolas, monospace';
    c.textBaseline = 'middle';
    var w = c.measureText(text).width, pad = 6;
    var left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    left = Math.max(pad, Math.min(left, width - pad - w));
    c.textAlign = 'left';
    c.fillStyle = color;
    c.fillText(text, left, y);
  }

  function layoutSection() {
    var w = Math.round(stage.getBoundingClientRect().width);
    if (!w) return false;
    view.narrow = w < 560;
    view.k = view.narrow ? w / 28 : Math.min(w / 40, 17);
    view.x0 = -(w / view.k) / 2;
    view.W = w;
    view.H = Math.round((Y_TOP - Y_BOT) * view.k);
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = view.H + 'px';
    canvas.width = Math.round(view.W * view.dpr);
    canvas.height = Math.round(view.H * view.dpr);
    field.cell = view.narrow ? 2 : 3;
    field.w = Math.ceil(view.W / field.cell);
    field.h = Math.ceil(view.H / field.cell);
    field.canvas.width = field.w;
    field.canvas.height = field.h;
    field.img = field.ctx.createImageData(field.w, field.h);
    return true;
  }

  function drawField(src, strength) {
    var data = field.img.data, w = field.w, h = field.h, cell = field.cell;
    for (var j = 0; j < h; j++) {
      var y = Y_TOP - ((j + 0.5) * cell) / view.k;
      for (var i = 0; i < w; i++) {
        var idx = (j * w + i) * 4;
        if (y > ELEC_Y) { data[idx + 3] = 0; continue; }
        var x = view.x0 + ((i + 0.5) * cell) / view.k;
        var dx = x - src.x, dy = y - src.y;
        var r2 = dx * dx + dy * dy + 0.03;
        var v = (src.nx * dx + src.ny * dy) / (r2 * Math.sqrt(r2));
        var t = (Math.log(Math.abs(v) / V_REF + 1e-12) / Math.LN10 + 2.6) / 2.6;   // 0.25% to 100% of the reference
        if (t <= 0) { data[idx + 3] = 0; continue; }
        if (t > 1) t = 1;
        var c = M.activityColor(v, 0.25 + 0.75 * t);
        data[idx] = c[0]; data[idx + 1] = c[1]; data[idx + 2] = c[2];
        data[idx + 3] = Math.round(255 * strength * 0.66 * Math.pow(t, 1.25));
      }
    }
    field.ctx.putImageData(field.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(field.canvas, 0, 0, w * cell, h * cell);
  }

  function renderSection(m) {
    var src = m.src, est = m.est, k = view.k, W = view.W, H = view.H;
    var fs = view.narrow ? 12 : 13;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Underlay: white and gray matter, windowed dark so activity reads on top.
    ctx.beginPath();
    polyline(ctx, white);
    ctx.lineTo(X(PATH_X), H + 10);
    ctx.lineTo(X(-PATH_X), H + 10);
    ctx.closePath();
    ctx.fillStyle = '#4f4f4f';
    ctx.fill();
    ctx.beginPath();
    polyline(ctx, pial);
    polyline(ctx, white.slice().reverse(), false);
    ctx.closePath();
    ctx.fillStyle = '#2c2c2c';
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = ctx.createPattern(grain, 'repeat');
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Potential around the source, on a log scale, warm positive and cool negative.
    drawField(src, est ? 0.45 : 1);

    // Estimate painted into the gray-matter ribbon in thin slices.
    if (est) {
      var peak = 0;
      for (var e = 0; e < N_GRID; e++) peak = Math.max(peak, Math.abs(est[e]));
      var base = [44, 44, 44];
      var slice = Math.max(1, Math.round(1 / (k * 0.02)));
      ctx.lineWidth = 0.8;
      ctx.lineJoin = 'round';
      for (var i = estFirst; i < estLast && peak; i += slice) {
        var j = Math.min(i + slice, estLast);
        var u = ((path[i].s + path[j].s) / 2 - gridLo) / GRID_DS;
        var q0 = Math.max(0, Math.min(N_GRID - 2, Math.floor(u)));
        var fr = Math.max(0, Math.min(1, u - q0));
        var v = est[q0] * (1 - fr) + est[q0 + 1] * fr;
        var a = Math.abs(v) / peak;
        var mix = 0.95 * Math.pow(a, 0.7);
        var tint = M.activityColor(v, 0.3 + 0.7 * a);
        var fill = 'rgb(' + Math.round(base[0] + (tint[0] - base[0]) * mix) + ',' + Math.round(base[1] + (tint[1] - base[1]) * mix) + ',' + Math.round(base[2] + (tint[2] - base[2]) * mix) + ')';
        ctx.beginPath();
        ctx.moveTo(X(pial[i].x), Y(pial[i].y));
        ctx.lineTo(X(pial[j].x), Y(pial[j].y));
        ctx.lineTo(X(white[j].x), Y(white[j].y));
        ctx.lineTo(X(white[i].x), Y(white[i].y));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = fill;
        ctx.stroke();
      }
    }

    // FreeSurfer-style contours: white-matter surface yellow, pial surface red.
    ctx.lineWidth = 1.3;
    ctx.beginPath(); polyline(ctx, white); ctx.strokeStyle = 'rgba(255, 210, 63, 0.9)'; ctx.stroke();
    ctx.beginPath(); polyline(ctx, pial); ctx.strokeStyle = 'rgba(255, 77, 61, 0.95)'; ctx.stroke();

    // Labels and scale.
    var lc = '#a0a0a0';
    label(ctx, 'gyral crown', X(-12), Y(-4.3), 'center', lc, fs, W);
    label(ctx, 'white matter', X(view.narrow ? 9.5 : 11.5), Y(-10.5), 'center', lc, fs, W);
    label(ctx, 'sulcal wall', X(-3.8), Y(-11.2), 'right', lc, fs, W);
    ctx.fillStyle = lc;
    ctx.fillRect(X(-3.6), Y(-11.2), X(-2.2) - X(-3.6), 1);
    label(ctx, 'fundus', X(0), Y(-17.7), 'center', lc, fs, W);
    var sbX = Math.max(X(view.narrow ? -12.5 : -17), 10), sbY = Y(-16.9);
    ctx.fillStyle = '#ededed';
    ctx.fillRect(sbX, sbY, 4 * k, 1.5);
    ctx.fillRect(sbX, sbY - 3, 1.5, 7);
    ctx.fillRect(sbX + 4 * k - 1.5, sbY - 3, 1.5, 7);
    label(ctx, '4 mm', sbX + 2 * k, Y(-17.8), 'center', '#ededed', fs, W);

    // Electrode strip and contacts on an absolute scale: faint when the source is deep.
    var top = Y(ELEC_Y + 0.85), bottom = Y(ELEC_Y);
    ctx.fillStyle = 'rgba(235, 235, 235, 0.12)';
    ctx.fillRect(X(-18.2), top, X(18.2) - X(-18.2), bottom - top);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.fillRect(X(-18.2), top, X(18.2) - X(-18.2), 1);
    label(ctx, 'electrodes, 4 mm apart', X(-18), Y(ELEC_Y + 1.75), 'left', lc, fs, W);
    var cr = Math.max(4, 0.6 * k);
    CONTACTS.forEach(function (cx, ci) {
      var val = m.y[ci];
      var t = (Math.log(Math.abs(val) / V_REF + 1e-12) / Math.LN10 + 2) / 2;   // 1% to 100% of a crown source
      t = Math.max(0, Math.min(1, t));
      ctx.beginPath();
      ctx.arc(X(cx), Y(ELEC_Y), cr, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      if (t > 0.02) {
        ctx.fillStyle = rgba(M.activityColor(val, 0.35 + 0.65 * t), 0.2 + 0.8 * t);
        ctx.fill();
      }
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.stroke();
    });

    // Shared crosshair at the source, linked to the array view.
    var sx = X(src.x), sy = Y(src.y);
    ctx.fillStyle = 'rgba(255, 210, 63, 0.35)';
    ctx.fillRect(Math.round(sx), 0, 1, H);

    // The source.
    var tipX = X(src.x + 1.55 * src.nx), tipY = Y(src.y + 1.55 * src.ny);
    var tailX = X(src.x - 0.75 * src.nx), tailY = Y(src.y - 0.75 * src.ny);
    var ux = tipX - tailX, uy = tipY - tailY, ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    var head = Math.max(6, 0.42 * k);
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(13, 1.05 * k), 0, Math.PI * 2);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(tipX - ux * head * 0.6, tipY - uy * head * 0.6);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#ededed';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * head - uy * head * 0.55, tipY - uy * head + ux * head * 0.55);
    ctx.lineTo(tipX - ux * head + uy * head * 0.55, tipY - uy * head - ux * head * 0.55);
    ctx.closePath();
    ctx.fillStyle = '#ededed';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(4.5, 0.4 * k), 0, Math.PI * 2);
    if (est) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ededed';
      ctx.stroke();
    } else {
      ctx.fillStyle = '#ffe478';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }

    if (handle) handle.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px)';
  }

  /* ---------- Array view (top-down) ---------- */
  var aview = { W: 0, H: 0, k: 10, dpr: 1, x0: -19.5, z0: -10.5 };
  var amap = { canvas: document.createElement('canvas'), w: 0, h: 0, img: null, cell: 3 };
  amap.ctx = amap.canvas.getContext('2d');

  function layoutArray() {
    var w = Math.round(arrayCanvas.getBoundingClientRect().width);
    if (!w) return false;
    aview.W = w;
    aview.k = w / 39;
    aview.H = Math.round(21 * aview.k);
    aview.dpr = Math.min(window.devicePixelRatio || 1, 2);
    arrayCanvas.style.height = aview.H + 'px';
    arrayCanvas.width = Math.round(w * aview.dpr);
    arrayCanvas.height = Math.round(aview.H * aview.dpr);
    amap.w = Math.ceil(aview.W / amap.cell);
    amap.h = Math.ceil(aview.H / amap.cell);
    amap.canvas.width = amap.w;
    amap.canvas.height = amap.h;
    amap.img = amap.ctx.createImageData(amap.w, amap.h);
    return true;
  }
  function AX(x) { return (x - aview.x0) * aview.k; }
  function AZ(z) { return (z - aview.z0) * aview.k; }

  function renderArray(m) {
    var src = m.src, W = aview.W, H = aview.H, k = aview.k;
    var fs = W < 360 ? 12 : 13;
    actx.setTransform(aview.dpr, 0, 0, aview.dpr, 0, 0);
    actx.fillStyle = '#000';
    actx.fillRect(0, 0, W, H);

    // Peak over the grid sets the display scale (stated beside the map).
    var peak = 0, vals = [];
    ROWS.forEach(function (z) {
      CONTACTS.forEach(function (x) {
        var v = M.potential(x, ELEC_Y, z, src);
        vals.push({ x: x, z: z, v: v });
        if (Math.abs(v) > peak) peak = Math.abs(v);
      });
    });

    // Interpolated potential across the grid area.
    var data = amap.img.data, cell = amap.cell;
    for (var j = 0; j < amap.h; j++) {
      var z = aview.z0 + ((j + 0.5) * cell) / k;
      for (var i = 0; i < amap.w; i++) {
        var idx = (j * amap.w + i) * 4;
        var x = aview.x0 + ((i + 0.5) * cell) / k;
        if (x < -18 || x > 18 || z < -10 || z > 10 || !peak) { data[idx + 3] = 0; continue; }
        var v = M.potential(x, ELEC_Y, z, src);
        var t = Math.min(1, Math.abs(v) / peak);
        var c = M.activityColor(v, 0.3 + 0.7 * t);
        data[idx] = c[0]; data[idx + 1] = c[1]; data[idx + 2] = c[2];
        data[idx + 3] = Math.round(255 * 0.8 * Math.pow(t, 0.9));
      }
    }
    amap.ctx.putImageData(amap.img, 0, 0);
    actx.imageSmoothingEnabled = true;
    actx.drawImage(amap.canvas, 0, 0, amap.w * cell, amap.h * cell);

    // Silicone sheet outline.
    actx.lineWidth = 1;
    actx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    actx.strokeRect(AX(-18) + 0.5, AZ(-10) + 0.5, AX(18) - AX(-18), AZ(10) - AZ(-10));

    // The fold beneath the array: drawn deliberately, though the array cannot see into it.
    actx.save();
    actx.setLineDash([4, 4]);
    actx.strokeStyle = 'rgba(255, 77, 61, 0.75)';
    actx.beginPath();
    actx.moveTo(AX(-0.5), AZ(-10)); actx.lineTo(AX(-0.5), AZ(10));
    actx.moveTo(AX(0.5), AZ(-10)); actx.lineTo(AX(0.5), AZ(10));
    actx.stroke();
    // The row shown in the section.
    actx.strokeStyle = 'rgba(255, 210, 63, 0.6)';
    actx.strokeRect(AX(-17.6) + 0.5, AZ(-1.6) + 0.5, AX(17.6) - AX(-17.6), AZ(1.6) - AZ(-1.6));
    actx.restore();

    // Contacts.
    var cr = Math.max(4, 0.62 * k);
    vals.forEach(function (c) {
      var t = peak ? Math.abs(c.v) / peak : 0;
      actx.beginPath();
      actx.arc(AX(c.x), AZ(c.z), cr, 0, Math.PI * 2);
      actx.fillStyle = '#000';
      actx.fill();
      if (t > 0.03) {
        actx.fillStyle = rgba(M.activityColor(c.v, 0.35 + 0.65 * t), 0.25 + 0.75 * t);
        actx.fill();
      }
      actx.lineWidth = 1.1;
      actx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      actx.stroke();
    });

    // Linked crosshair at the source's position along the array.
    actx.fillStyle = 'rgba(255, 210, 63, 0.5)';
    actx.fillRect(Math.round(AX(src.x)), 0, 1, H);

    label(actx, 'fold below', AX(1.4), AZ(-9.1), 'left', '#ff8a7e', fs, W);
    label(actx, 'row in the section', AX(-17.4), AZ(2.6), 'left', '#ffd23f', fs, W);

    if (out.gain) {
      var gain = peak ? V_REF / peak : 1;
      out.gain.textContent = gain < 1.5 ? 'Colours at true scale' : 'Colours scaled ×' + (gain < 10 ? gain.toFixed(1) : Math.round(gain)) + ' to show the pattern';
    }
  }

  /* ---------- Readout ---------- */
  function formatPct(v) {
    if (v >= 10) return Math.round(v) + '%';
    if (v >= 1) return v.toFixed(1) + '%';
    return v.toFixed(2) + '%';
  }

  var liveTimer = 0, lastSummary = '';
  function updateReadout(m) {
    var src = m.src, region = src.part || 'crown';
    var depth = ELEC_Y - src.y;
    var angle = Math.round(Math.acos(Math.max(-1, Math.min(1, src.ny))) / DEG);
    var orient = angle <= 8 ? 'facing the array, ' + angle + '°' : Math.abs(angle - 90) <= 8 ? 'sideways, ' + angle + '°' : 'tilted, ' + angle + '°';
    if (out.explain) out.explain.textContent = EXPLAIN[region];
    if (out.region) out.region.textContent = REGION_NAME[region];
    if (out.depth) out.depth.textContent = depth.toFixed(1) + ' mm';
    if (out.orient) out.orient.textContent = orient;
    if (out.peak) out.peak.textContent = formatPct(100 * m.gmax / V_REF);
    if (out.method) {
      out.method.hidden = state.method === 'off';
      out.method.textContent = state.method === 'off' ? '' : METHOD_NOTE[state.method];
    }
    if (out.legend) out.legend.hidden = state.method === 'off';
    if (out['error-row']) out['error-row'].hidden = m.err === null;
    if (out.error && m.err !== null) out.error.textContent = m.err.toFixed(1) + ' mm';
    presetButtons.forEach(function (b) { b.toggleAttribute('data-active', b.getAttribute('data-preset') === region); });
    if (slider) slider.setAttribute('aria-valuetext', REGION_NAME[region] + ', ' + depth.toFixed(1) + ' mm below the electrodes');
    lastSummary = REGION_NAME[region] + ', ' + depth.toFixed(1) + ' mm below the electrodes. Peak signal ' + formatPct(100 * m.gmax / V_REF) + ' of a crown source.' +
      (m.err !== null ? ' ' + METHOD_NAME[state.method] + ' estimate peaks ' + m.err.toFixed(1) + ' mm from the true source.' : '');
  }
  function announceSoon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () { if (out.live) out.live.textContent = lastSummary; }, 450);
  }

  /* ---------- Rendering and state ---------- */
  var queued = 0;
  function render() {
    queued = 0;
    if (!field.img || !amap.img) return;
    var m = compute();
    renderSection(m);
    renderArray(m);
  }
  function requestRender() { if (!queued) queued = window.requestAnimationFrame(render); }
  function refreshText() { updateReadout(compute()); }

  function setS(s, origin) {
    state.s = Math.min(sHi, Math.max(sLo, s));
    if (slider && origin !== 'slider') slider.value = String(Math.round(1000 * (state.s - sLo) / (sHi - sLo)));
    refreshText();
    requestRender();
  }

  var tween = 0;
  function cancelTween() { if (tween) window.cancelAnimationFrame(tween); tween = 0; }
  function tweenTo(target) {
    cancelTween();
    if (reduceMotion.matches) { setS(target, 'preset'); announceSoon(); return; }
    var from = state.s, t0 = 0;
    var duration = Math.min(900, 300 + Math.abs(target - from) * 20);
    function step(now) {
      if (!t0) t0 = now;
      var t = Math.min(1, (now - t0) / duration);
      setS(from + (target - from) * M.easeInOut(t), 'tween');
      if (t < 1) tween = window.requestAnimationFrame(step);
      else { tween = 0; announceSoon(); }
    }
    tween = window.requestAnimationFrame(step);
  }

  function toModel(event) {
    var rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / view.k + view.x0, y: Y_TOP - (event.clientY - rect.top) / view.k };
  }

  if (slider) {
    slider.addEventListener('input', function () {
      cancelTween();
      setS(sLo + (sHi - sLo) * Number(slider.value) / 1000, 'slider');
      announceSoon();
    });
  }
  presetButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = PRESETS[button.getAttribute('data-preset')];
      if (typeof target === 'number') tweenTo(target);
    });
  });
  methodInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (!input.checked) return;
      state.method = input.value;
      refreshText();
      requestRender();
      announceSoon();
    });
  });
  if (resetButton) {
    resetButton.addEventListener('click', function () {
      methodInputs.forEach(function (input) { input.checked = input.value === 'off'; });
      state.method = 'off';
      tweenTo(PRESETS.wall);
      refreshText();
    });
  }

  var dragging = false;
  if (handle) {
    handle.addEventListener('pointerdown', function (event) {
      if (event.button !== undefined && event.button > 0) return;
      event.preventDefault();
      cancelTween();
      dragging = true;
      handle.classList.add('is-dragging');
      document.documentElement.classList.add('is-dragging-source');   // no text selection mid-drag
      try { handle.setPointerCapture(event.pointerId); } catch (e) { /* capture is a nicety */ }
    });
    handle.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      var pt = toModel(event);
      setS(M.nearest(fold, pt.x, pt.y, sLo, sHi).s, 'drag');
    });
    var endDrag = function () {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.documentElement.classList.remove('is-dragging-source');
      announceSoon();
    };
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
    handle.addEventListener('lostpointercapture', endDrag);
  }
  canvas.addEventListener('click', function (event) {
    var pt = toModel(event);
    var hit = M.nearest(fold, pt.x, pt.y, sLo, sHi);
    if (hit.dist < 2.6) tweenTo(hit.s);
  });
  canvas.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'mouse' || dragging) return;
    var pt = toModel(event);
    canvas.style.cursor = M.nearest(fold, pt.x, pt.y, sLo, sHi).dist < 2.6 ? 'pointer' : '';
  });

  /* ---------- Setup ---------- */
  // Colour key: the array map's own ramp, from the negative peak through zero to the positive peak.
  var colorbar = fig.querySelector('[data-colorbar]');
  if (colorbar) colorbar.style.backgroundImage = (function () {
    var stops = [];
    for (var i = 0; i <= 20; i++) {
      var p = i / 10 - 1, t = Math.abs(p);
      var col = M.activityColor(p, 0.3 + 0.7 * t), alpha = 0.8 * Math.pow(t, 0.9);   // as composited over black in renderArray
      stops.push('rgb(' + col.map(function (v) { return Math.round(v * alpha); }).join(',') + ') ' + (i * 5) + '%');
    }
    return 'linear-gradient(90deg, ' + stops.join(', ') + ')';
  })();

  function layout() {
    var a = layoutSection(), b = layoutArray();
    if (a && b) render();
  }
  if (slider) slider.value = String(Math.round(1000 * (state.s - sLo) / (sHi - sLo)));
  refreshText();
  layout();
  if ('ResizeObserver' in window) {
    var pending = 0;
    var ro = new ResizeObserver(function () {
      if (pending) return;
      pending = window.requestAnimationFrame(function () { pending = 0; layout(); });
    });
    ro.observe(stage);
    ro.observe(arrayCanvas);
  } else {
    window.addEventListener('resize', layout);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(requestRender);
})();
