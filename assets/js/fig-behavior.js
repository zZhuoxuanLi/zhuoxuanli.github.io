/* Figure: brain and behavior on one timeline (natural behavior)
   ------------------------------------------------------------------
   Ten made-up minutes of a hospital-room recording. A generated upper-body
   pose gives the tracked wrist's speed; behavior labels and captions stand in
   for a vision–language model; a speech envelope stands in for audio; six
   neural channels stand in for iEEG high-gamma activity. Two hand channels
   were built to follow the wrist, two speech channels to follow talking, one
   channel to rise during reading, and one is noise. The two controls are
   computed live on these numbers: least-squares removal of what wrist
   movement explains, and a three-minute shift of the neural streams. Every value
   is invented: not patient data, not the project's results. */
(function () {
  'use strict';

  var M = window.CorticalModel, K = window.FigureKit;
  var fig = document.querySelector('[data-fig="behavior"]');
  if (!M || !K || !fig) return;
  var canvas = fig.querySelector('[data-behavior-canvas]');
  var poseCanvas = fig.querySelector('[data-behavior-pose]');
  if (!canvas || !canvas.getContext || !poseCanvas) return;
  var slider = fig.querySelector('[data-behavior-slider]');
  var segmentButtons = Array.prototype.slice.call(fig.querySelectorAll('[data-segment]'));
  var signalInputs = Array.prototype.slice.call(fig.querySelectorAll('input[name="fig3-signal"]'));
  var alignInputs = Array.prototype.slice.call(fig.querySelectorAll('input[name="fig3-align"]'));
  var out = {};
  Array.prototype.forEach.call(fig.querySelectorAll('[data-out]'), function (el) { out[el.getAttribute('data-out')] = el; });
  var announce = K.announcer(out.live);

  /* ---------- The synthetic recording ---------- */
  var RATE = 2, SECONDS = 600, N = RATE * SECONDS, SHIFT = 180 * RATE;   // 2 samples per second; shift 3 min
  var SEGMENTS = [
    { label: 'resting', from: 0, to: 60 }, { label: 'reaching', from: 60, to: 85 }, { label: 'eating', from: 85, to: 180 },
    { label: 'talking', from: 180, to: 300 }, { label: 'resting', from: 300, to: 330 }, { label: 'reading', from: 330, to: 420 },
    { label: 'talking', from: 420, to: 500 }, { label: 'resting', from: 500, to: 600 }
  ];
  var CAPTIONS = {
    resting: 'The person lies back with their hands on the blanket.',
    reaching: 'The person reaches toward the bedside table.',
    eating: 'The person eats from a tray on their lap.',
    talking: 'The person talks with someone off camera.',
    reading: 'The person reads a phone held in both hands.'
  };
  var SHORT = { resting: 'rest', reaching: 'reach', eating: 'eat', talking: 'talk', reading: 'read' };
  var CHANNELS = [{ group: 'hand' }, { group: 'hand' }, { group: 'speech' }, { group: 'speech' }, { group: 'other' }, { group: 'other' }];
  var GROUPS = [{ name: 'hand', rows: 2 }, { name: 'speech', rows: 2 }, { name: 'other', rows: 2 }];

  function segmentAt(t) {
    for (var i = 0; i < SEGMENTS.length; i++) if (t >= SEGMENTS[i].from && t < SEGMENTS[i].to) return i;
    return SEGMENTS.length - 1;
  }
  function smoothstep(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
  function lerp(a, b, w) { return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]; }

  var rand = K.rng(20261022);
  // When the person is speaking: utterances of 2–6 s with pauses, only inside "talking" segments.
  var speaking = [];
  SEGMENTS.forEach(function (s) {
    if (s.label !== 'talking') return;
    var t = s.from + 1 + rand() * 2;
    while (t < s.to - 2) {
      var len = 2 + rand() * 4;
      speaking.push([t, Math.min(s.to - 1, t + len)]);
      t += len + 0.6 + rand() * 1.6;
    }
  });
  function isSpeaking(t) {
    for (var i = 0; i < speaking.length; i++) if (t >= speaking[i][0] && t < speaking[i][1]) return true;
    return false;
  }

  // Upper-body pose in body units (hips at 0, up is negative y), for each behavior at time t.
  var REST_R = [0.3, -0.24], REST_L = [-0.3, -0.24];
  function behaviorPose(label, t) {
    var w;
    switch (label) {
      case 'reaching':
        w = Math.max(Math.exp(-0.5 * Math.pow((t - 66) / 1.7, 2)), 0.85 * Math.exp(-0.5 * Math.pow((t - 78) / 1.5, 2)));
        return { R: lerp(REST_R, [0.98, -0.78], w), L: REST_L, prop: 'table' };
      case 'eating':
        w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t - 85) / 9);
        return { R: lerp([0.2, -0.36], [0.06, -1.14], w), L: [-0.26, -0.36], prop: 'tray' };
      case 'talking': {
        var on = isSpeaking(t) ? 1 : 0.25;
        return {
          R: [0.34 + on * 0.018 * Math.sin(2 * Math.PI * t / 3.1), -0.42 + on * 0.014 * Math.sin(2 * Math.PI * t / 2.3 + 1)],
          L: [-0.34 + on * 0.012 * Math.sin(2 * Math.PI * t / 2.7 + 2), -0.36], prop: null
        };
      }
      case 'reading': {
        var scroll = 0.05 * Math.exp(-0.5 * Math.pow((((t - 330) % 12) - 6) / 0.4, 2));
        return { R: [0.13, -0.78 - scroll], L: [-0.13, -0.78], prop: 'phone' };
      }
      default:
        return { R: REST_R, L: REST_L, prop: null };
    }
  }
  function poseAt(t) {
    var i = segmentAt(t), s = SEGMENTS[i], pose = behaviorPose(s.label, t);
    if (i > 0 && t - s.from < 2.5) {   // ease out of the previous behavior
      var prev = behaviorPose(SEGMENTS[i - 1].label, t), w = smoothstep((t - s.from) / 2.5);
      pose = { R: lerp(prev.R, pose.R, w), L: lerp(prev.L, pose.L, w), prop: w < 0.5 ? prev.prop : pose.prop };
    }
    return pose;
  }

  var data = (function generate() {
    var i, j, fine = 10, speed = [], audio = [], talking = [], reading = [];
    // Wrist speed from the pose itself, measured at 10 Hz with a little tracking jitter, then binned to 2 Hz.
    var last = null;
    for (i = 0; i < N; i++) {
      var sum = 0;
      for (j = 0; j < fine / RATE; j++) {
        var t = i / RATE + j / fine, p = poseAt(t).R;
        p = [p[0] + 0.0015 * K.gaussian(rand), p[1] + 0.0015 * K.gaussian(rand)];
        if (last) sum += Math.hypot(p[0] - last[0], p[1] - last[1]) * fine;
        last = p;
      }
      speed.push(sum / (fine / RATE));
      var tm = (i + 0.5) / RATE, label = SEGMENTS[segmentAt(tm)].label;
      talking.push(label === 'talking' ? 1 : 0);
      reading.push(label === 'reading' ? 1 : 0);
      audio.push(isSpeaking(tm) ? 0.45 + 0.5 * rand() : (label === 'eating' && rand() < 0.08 ? 0.12 : 0.02 + 0.03 * rand()));
    }
    // Pose trackers report speed smoothed over a few seconds; scale it so the fastest stretch is 1.
    speed = K.smooth(speed, 4);
    var vmax = Math.max.apply(null, speed);
    speed = speed.map(function (v) { return v / vmax; });
    audio = K.smooth(audio, 2);
    function lead(a, k) { return a.map(function (v, idx) { return a[Math.min(a.length - 1, idx + k)]; }); }
    function noise(sd) { var a = []; for (var n = 0; n < N; n++) a.push(sd * 1.6 * K.gaussian(rand)); return K.smooth(a, 2); }
    var ahead = lead(speed, 1);   // motor activity runs about half a second ahead of the movement
    var raw = [
      ahead.map(function (v, k) { return 3.2 * v; }), ahead.map(function (v) { return 2.4 * v; }),
      audio.map(function (v) { return 2.6 * v; }), audio.map(function (v, k) { return 1.4 * v + 0.9 * talking[k]; }),
      reading.map(function (v) { return 1.2 * v; }), audio.map(function () { return 0; })
    ].map(function (signal, c) {
      var n = noise([0.35, 0.45, 0.35, 0.4, 0.45, 0.5][c]);
      return signal.map(function (v, k) { return v + n[k]; });
    });
    return { speed: speed, audio: audio, talking: talking, raw: raw };
  })();

  /* ---------- The two controls, computed on the synthetic numbers ---------- */
  function shifted(a, k) { return a.map(function (v, idx) { return a[(idx - k + N) % N]; }); }
  // Least squares of y on [1, speed(t), speed(t + 0.5 s), speed(t + 1 s)]; returns residual and R².
  var REGRESSORS = (function () {
    var cols = [data.speed.map(function () { return 1; }), data.speed];
    [1, 2].forEach(function (k) { cols.push(data.speed.map(function (v, idx) { return data.speed[Math.min(N - 1, idx + k)]; })); });
    return cols;
  })();
  function regressOut(y) {
    var p = REGRESSORS.length, A = [], b = [], i, j, k;
    for (i = 0; i < p; i++) {
      A.push([]);
      for (j = 0; j < p; j++) { var s = 0; for (k = 0; k < N; k++) s += REGRESSORS[i][k] * REGRESSORS[j][k]; A[i].push(s); }
      var t = 0; for (k = 0; k < N; k++) t += REGRESSORS[i][k] * y[k];
      b.push(t);
    }
    for (i = 0; i < p; i++) {   // Gaussian elimination with partial pivoting
      var piv = i;
      for (j = i + 1; j < p; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var tmp = A[i]; A[i] = A[piv]; A[piv] = tmp; var tb = b[i]; b[i] = b[piv]; b[piv] = tb;
      for (j = i + 1; j < p; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < p; k++) A[j][k] -= f * A[i][k];
        b[j] -= f * b[i];
      }
    }
    var beta = new Array(p);
    for (i = p - 1; i >= 0; i--) { var s2 = b[i]; for (j = i + 1; j < p; j++) s2 -= A[i][j] * beta[j]; beta[i] = s2 / A[i][i]; }
    var mean = y.reduce(function (a, v) { return a + v; }, 0) / N, ssTot = 0, ssRes = 0, resid = [];
    for (k = 0; k < N; k++) {
      var fit = 0;
      for (i = 0; i < p; i++) fit += beta[i] * REGRESSORS[i][k];
      resid.push(y[k] - fit);
      ssRes += (y[k] - fit) * (y[k] - fit);
      ssTot += (y[k] - mean) * (y[k] - mean);
    }
    return { resid: resid, r2: Math.max(0, 1 - ssRes / ssTot) };
  }
  function corr(a, b) {
    var ma = 0, mb = 0, k;
    for (k = 0; k < N; k++) { ma += a[k]; mb += b[k]; }
    ma /= N; mb /= N;
    var sab = 0, saa = 0, sbb = 0;
    for (k = 0; k < N; k++) { sab += (a[k] - ma) * (b[k] - mb); saa += (a[k] - ma) * (a[k] - ma); sbb += (b[k] - mb) * (b[k] - mb); }
    return sab / Math.sqrt(saa * sbb);
  }
  var VARIANTS = {};
  ['matched', 'shifted'].forEach(function (align) {
    var rows = align === 'matched' ? data.raw : data.raw.map(function (r) { return shifted(r, SHIFT); });
    var fits = rows.map(regressOut);
    var speechMean = rows[2].map(function (v, k) { return (v + rows[3][k]) / 2; });
    VARIANTS[align] = {
      recorded: rows,
      removed: fits.map(function (f) { return f.resid; }),
      r2Hand: (fits[0].r2 + fits[1].r2) / 2,
      r2Speech: (fits[2].r2 + fits[3].r2) / 2,
      match: corr(speechMean, data.talking)
    };
  });

  /* ---------- Layout and drawing ---------- */
  var state = { i: 460, signal: 'recorded', align: 'matched' };
  var view = null, pose = null, L = {};

  function layout() {
    var width = canvas.getBoundingClientRect().width;
    if (!width) return false;
    var narrow = width < 560;
    var gutter = narrow ? 62 : 76, title = 22, gap = 14, rowN = narrow ? 9 : 10, under = 18;
    var H = title + 28 + under + gap + title + 48 + gap + title + 32 + gap + title + 6 * rowN + 26;
    view = K.fit(canvas, H);
    if (!view) return false;
    view.narrow = narrow;
    var x = gutter, w = view.W - gutter - 4, y = title;
    L.gutter = gutter;
    L.labels = { x: x, y: y, w: w, h: 28, under: under }; y += 28 + under + gap + title;
    L.speed = { x: x, y: y, w: w, h: 48 }; y += 48 + gap + title;
    L.audio = { x: x, y: y, w: w, h: 32 }; y += 32 + gap + title;
    L.neural = { x: x, y: y, w: w, h: 6 * rowN, row: rowN }; y += 6 * rowN;
    L.axis = y + 4;
    pose = K.fit(poseCanvas);
    return true;
  }
  function TX(seconds) { return L.labels.x + (seconds / SECONDS) * L.labels.w; }
  function IX(i) { return L.labels.x + (i / N) * L.labels.w; }

  function area(ctx, values, box, mirror) {
    ctx.beginPath();
    var mid = box.y + box.h / 2, base = box.y + box.h, i, x;
    for (i = 0; i < N; i++) {
      x = IX(i + 0.5);
      var v = Math.max(0, Math.min(1, values[i]));
      var yy = mirror ? mid - v * box.h / 2 : base - v * (box.h - 2);
      if (i === 0) ctx.moveTo(x, mirror ? mid : base);
      ctx.lineTo(x, yy);
    }
    if (mirror) {
      for (i = N - 1; i >= 0; i--) ctx.lineTo(IX(i + 0.5), mid + Math.max(0, Math.min(1, values[i])) * box.h / 2);
    } else {
      ctx.lineTo(IX(N - 0.5), base);
    }
    ctx.closePath();
  }

  function draw() {
    if (!view) return;
    var ctx = view.ctx, W = view.W, H = view.H, narrow = view.narrow, fs = narrow ? 12 : 13;
    var variant = VARIANTS[state.align], rows = variant[state.signal];
    var t = state.i / RATE, seg = segmentAt(t + 0.25);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Track titles say what each stream stands in for: every value here is generated.
    var tc = '#8a8a8a';
    K.text(ctx, narrow ? 'Behavior labels, stand-in' : 'Behavior labels · stand-in for a vision–language model', 0, L.labels.y - 8, { color: tc, size: fs });
    K.text(ctx, narrow ? 'Wrist speed, generated pose' : 'Wrist speed · from the generated pose', 0, L.speed.y - 8, { color: tc, size: fs });
    K.text(ctx, narrow ? 'Speech envelope' : 'Speech · synthetic sound envelope', 0, L.audio.y - 8, { color: tc, size: fs });
    var suffix = (state.signal === 'removed' ? ' · movement removed' : '') + (state.align === 'shifted' ? ' · shifted 3 min' : '');
    K.text(ctx, (narrow ? 'Neural, 6 synthetic' : 'Neural activity · 6 synthetic channels') + suffix, 0, L.neural.y - 8, { color: state.align === 'shifted' || state.signal === 'removed' ? '#ababab' : tc, size: fs });

    // Behavior labels as spans; the one under the cursor is outlined in yellow. A span too narrow
    // for its word takes a short form, or else the word sits just below it on a short tick.
    ctx.font = '400 ' + fs + 'px ' + K.mono;
    // One name per behavior across the row: if any span of a behavior is too narrow for the full
    // word, every span of that behavior uses the short form.
    var useShort = {};
    SEGMENTS.forEach(function (s) {
      if (ctx.measureText(s.label).width > TX(s.to) - TX(s.from) - 10) useShort[s.label] = true;
    });
    var underRight = -Infinity;   // labels below the track are packed left to right so they never overlap
    SEGMENTS.forEach(function (s, i) {
      var x0 = TX(s.from) + 1, x1 = TX(s.to) - 1, box = L.labels, mid = (x0 + x1) / 2, room = x1 - x0 - 8;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(x0, box.y, x1 - x0, box.h);
      ctx.lineWidth = i === seg ? 1.5 : 1;
      ctx.strokeStyle = i === seg ? '#ffd23f' : 'rgba(255, 255, 255, 0.2)';
      ctx.strokeRect(x0 + 0.5, box.y + 0.5, x1 - x0 - 1, box.h - 1);
      var color = i === seg ? '#ededed' : '#ababab';
      var name = useShort[s.label] ? SHORT[s.label] : s.label;
      ctx.font = '400 ' + fs + 'px ' + K.mono;
      if (ctx.measureText(name).width <= room) {
        K.text(ctx, name, mid, box.y + box.h / 2 + 4, { color: color, align: 'center', size: fs });
      } else {
        var word = SHORT[s.label], ww = ctx.measureText(word).width;
        var left = Math.max(box.x, underRight + 8, Math.min(box.x + box.w - ww, mid - ww / 2));
        underRight = left + ww;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(Math.round(mid), box.y + box.h, 1, 4);
        K.text(ctx, word, left, box.y + box.h + 15, { color: color, size: fs });
      }
    });

    // Wrist speed and the speech envelope as quiet grays: measurements, not activity.
    area(ctx, data.speed, L.speed, false);
    ctx.fillStyle = 'rgba(237, 237, 237, 0.16)';
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(237, 237, 237, 0.75)';
    ctx.stroke();
    area(ctx, data.audio, L.audio, true);
    ctx.fillStyle = 'rgba(237, 237, 237, 0.42)';
    ctx.fill();

    // Neural channels in the activity colours, grouped in the gutter.
    K.raster(ctx, rows, L.neural.x, L.neural.y, L.neural.w, L.neural.h, 'activity', 3);
    var r0 = 0;
    GROUPS.forEach(function (g, gi) {
      var y0 = L.neural.y + r0 * L.neural.row;
      if (gi) { ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'; ctx.fillRect(L.neural.x, Math.round(y0), L.neural.w, 1); }
      K.text(ctx, g.name, L.gutter - 10, y0 + g.rows * L.neural.row / 2 + 4, { color: '#ababab', align: 'right', size: fs });
      r0 += g.rows;
    });

    // The current moment through every track (not through titles or labels), and its place on the axis.
    var cx = Math.round(IX(state.i + 0.5));
    ctx.fillStyle = 'rgba(237, 237, 237, 0.34)';
    [L.labels, L.speed, L.audio, L.neural].forEach(function (box) { ctx.fillRect(cx, box.y, 1, box.h); });
    var every = narrow ? 5 : 2;   // label every 2 minutes, or every 5 on narrow screens
    for (var m = 0; m <= 10; m++) {
      var x = TX(m * 60);
      ctx.fillStyle = 'rgba(237, 237, 237, 0.4)';
      ctx.fillRect(Math.round(x), L.axis, 1, m % every ? 3 : 5);
      if (m % every === 0 && m < 10) K.text(ctx, m + ':00', x, L.axis + 19, { color: '#8a8a8a', align: m === 0 ? 'left' : 'center', size: fs });
    }
    K.text(ctx, '10:00', TX(600), L.axis + 19, { color: '#8a8a8a', align: 'right', size: fs });
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(cx - 1, L.axis - 1, 3, 8);

    drawPose(t);
  }

  function elbow(shoulder, wrist, outward) {
    var a = 0.42, b = 0.4, dx = wrist[0] - shoulder[0], dy = wrist[1] - shoulder[1];
    var d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, Math.hypot(dx, dy)));
    var base = Math.atan2(dy, dx), alpha = Math.acos((a * a + d * d - b * b) / (2 * a * d));
    var e1 = [shoulder[0] + a * Math.cos(base + alpha), shoulder[1] + a * Math.sin(base + alpha)];
    var e2 = [shoulder[0] + a * Math.cos(base - alpha), shoulder[1] + a * Math.sin(base - alpha)];
    var s1 = e1[1] + outward * e1[0] * 0.5, s2 = e2[1] + outward * e2[0] * 0.5;   // prefer low, outward elbows
    return s1 > s2 ? e1 : e2;
  }

  function drawPose(t) {
    if (!pose) return;
    var ctx = pose.ctx, W = pose.W, H = pose.H;
    var fs = W < 360 ? 12 : 13;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    var s = Math.min(W / 3.1, (H - 64) / 1.45), ox = W / 2, oy = H - 50;
    function P(p) { return [ox + p[0] * s, oy + p[1] * s]; }
    var p = poseAt(t);

    // The scene as thin labelled outlines: the bed, and the prop the current behavior uses.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    var b0 = P([-1.05, 0]), b1 = P([1.05, 0.2]);
    ctx.strokeRect(Math.round(b0[0]) + 0.5, Math.round(b0[1]) + 0.5, Math.round(b1[0] - b0[0]), Math.round(b1[1] - b0[1]));
    K.text(ctx, 'bed', b1[0] + 6, b1[1] - 2, { color: '#8a8a8a', size: fs });
    var props = {
      tray: { a: [-0.52, -0.37], b: [0.52, -0.31], label: [0.6, -0.31] },
      table: { a: [0.86, -0.72], b: [1.34, -0.64], label: [0.86, -0.92], cup: [1.06, -0.86, 0.12, 0.14] },
      phone: { a: [-0.11, -1.0], b: [0.11, -0.66], label: [0.2, -0.82] }
    };
    var prop = props[p.prop];
    if (prop) {
      var pa = P(prop.a), pb = P(prop.b), pl = P(prop.label);
      ctx.strokeRect(Math.round(pa[0]) + 0.5, Math.round(pa[1]) + 0.5, Math.round(pb[0] - pa[0]), Math.round(pb[1] - pa[1]));
      if (prop.cup) { var c0 = P(prop.cup); ctx.strokeRect(Math.round(c0[0]) + 0.5, Math.round(c0[1]) + 0.5, Math.round(prop.cup[2] * s), Math.round(prop.cup[3] * s)); }
      K.text(ctx, p.prop === 'table' ? 'table, cup' : p.prop, pl[0], pl[1] - 4, { color: '#8a8a8a', size: fs });
    }

    // Keypoints and the skeleton a pose estimator returns: face points, shoulders, elbows, wrists, hips.
    var kp = {
      nose: [0, -1.26], eyeL: [-0.06, -1.32], eyeR: [0.06, -1.32], earL: [-0.15, -1.29], earR: [0.15, -1.29],
      shL: [-0.32, -0.96], shR: [0.32, -0.96], hipL: [-0.22, -0.05], hipR: [0.22, -0.05], wrL: p.L, wrR: p.R
    };
    kp.elR = elbow(kp.shR, p.R, 1);
    kp.elL = elbow(kp.shL, p.L, -1);
    var bones = [['nose', 'eyeL'], ['nose', 'eyeR'], ['eyeL', 'eyeR'], ['eyeL', 'earL'], ['eyeR', 'earR'], ['earL', 'shL'], ['earR', 'shR'],
      ['shL', 'shR'], ['shL', 'elL'], ['elL', 'wrL'], ['shR', 'elR'], ['elR', 'wrR'], ['shL', 'hipL'], ['shR', 'hipR'], ['hipL', 'hipR']];
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = 'rgba(237, 237, 237, 0.7)';
    ctx.beginPath();
    bones.forEach(function (b) {
      var a = P(kp[b[0]]), c = P(kp[b[1]]);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(c[0], c[1]);
    });
    ctx.stroke();
    ctx.fillStyle = '#ededed';
    Object.keys(kp).forEach(function (name) {
      if (name === 'wrR') return;
      var q = P(kp[name]);
      ctx.beginPath();
      ctx.arc(q[0], q[1], 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // The tracked wrist, with its last three seconds as a fading trail.
    for (var k = 6; k >= 1; k--) {
      var q = P(poseAt(Math.max(0, t - k * 0.5)).R);
      ctx.fillStyle = 'rgba(255, 210, 63, ' + (0.08 + 0.05 * (6 - k)).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(q[0], q[1], 3, 0, Math.PI * 2);
      ctx.fill();
    }
    var wr = P(p.R);
    ctx.beginPath();
    ctx.arc(wr[0], wr[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    K.text(ctx, 'Generated keypoints, not video', 0, 14, { color: '#8a8a8a', size: fs });
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(5, H - 9, 4, 0, Math.PI * 2);
    ctx.fill();
    K.text(ctx, 'tracked wrist', 14, H - 4, { color: '#ababab', size: fs });
  }

  /* ---------- Readouts ---------- */
  var EXPLAIN = {
    recorded: 'Every stream here is generated and lined up in time, the way the real framework lines up measured ones. While the person talks, the speech channels rise and the hand channels stay low; while they eat, the hand channels follow every lift of the wrist.',
    removed: 'With what wrist movement explains removed, the hand channels go quiet, but the speech channels still rise while the person talks, and one other channel while they read. Activity left after accounting for movement is the kind of signal the project looks for.',
    shifted: 'Shifted by three minutes, the neural streams no longer line up with the labels or the wrist. A real relationship should disappear under this control; if decoding still worked, it would point to slow drift or another artifact.'
  };
  function clock(i) {
    var s = Math.floor(i / RATE);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function update(speak) {
    var t = state.i / RATE, label = SEGMENTS[segmentAt(t + 0.25)].label, variant = VARIANTS[state.align];
    var match = 'r = ' + variant.match.toFixed(2);
    var explained = Math.round(100 * variant.r2Hand) + '% / ' + Math.round(100 * variant.r2Speech) + '%';
    if (out.time) out.time.textContent = clock(state.i);
    if (out.label) out.label.textContent = label;
    if (out.match) out.match.textContent = match;
    if (out.explained) out.explained.textContent = explained;
    if (out.caption) out.caption.textContent = '“' + CAPTIONS[label] + '”';
    if (out.explain) out.explain.textContent = state.align === 'shifted' ? EXPLAIN.shifted : EXPLAIN[state.signal];
    segmentButtons.forEach(function (b) { b.toggleAttribute('data-active', b.getAttribute('data-segment') === label); });
    if (slider) {
      slider.value = String(state.i);
      slider.setAttribute('aria-valuetext', clock(state.i) + ', ' + label);
    }
    if (speak) {
      announce(clock(state.i) + ', ' + label + '. In this example, speech channels versus talking labels: ' + match.replace('r = ', 'r ') +
        '; movement explains ' + Math.round(100 * variant.r2Hand) + ' percent of the hand channels and ' + Math.round(100 * variant.r2Speech) + ' percent of the speech channels.');
    }
  }

  var queued = 0;
  function render() { queued = 0; draw(); }
  function requestRender() { if (!queued) queued = window.requestAnimationFrame(render); }
  function setIndex(i) {
    var k = Math.max(0, Math.min(N - 1, Math.round(i)));
    if (k === state.i) return;
    state.i = k;
    update(true);
    requestRender();
  }

  /* ---------- Input ---------- */
  var cancelGlide = function () {};
  if (slider) slider.addEventListener('input', function () { cancelGlide(); setIndex(Number(slider.value)); });
  segmentButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var name = button.getAttribute('data-segment');
      var s = SEGMENTS.filter(function (x) { return x.label === name; })[0];
      var target = Math.round(((s.from + s.to) / 2) * RATE);
      cancelGlide();
      cancelGlide = K.glide(state.i, target, Math.min(900, 300 + Math.abs(target - state.i) * 0.6), setIndex);
    });
  });
  function bindRadios(inputs, key) {
    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state[key] = input.value;
        update(true);
        requestRender();
      });
    });
  }
  bindRadios(signalInputs, 'signal');
  bindRadios(alignInputs, 'align');
  K.scrub(canvas, function (event) {
    var rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left - L.labels.x) / L.labels.w) * N;
  }, function (i) { cancelGlide(); setIndex(i); });

  /* ---------- Setup ---------- */
  K.ramp(fig.querySelector('[data-ramp="activity"]'), 'activity');
  signalInputs.forEach(function (input) { input.checked = input.value === state.signal; });
  alignInputs.forEach(function (input) { input.checked = input.value === state.align; });
  if (layout()) draw();
  update(false);
  K.onResize(fig.querySelector('.views'), function () { if (layout()) draw(); });
})();
