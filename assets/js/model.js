/* Cortical fold model shared by the hero viewer and Fig. 1.
   ------------------------------------------------------------------
   A toy model for illustration, not research code. Units are millimetres.
   The section plane has x across and y up, with y = 0 at the pial surface
   of the crowns; z runs along the fold, out of the section. Sources are
   point current dipoles at mid-cortical depth, oriented perpendicular to the
   cortex, in an unbounded uniform conductor. Exposes window.CorticalModel. */
(function (root) {
  'use strict';

  var DEG = Math.PI / 180;

  /* Mid-cortical path for a row of sulci. Each sulcus is { x, depth } where
     depth is the pial depth of its fundus below the crowns. opts.dome gives
     the crowns between sulci a gentle arch of that height (mm), joined to the
     lips without a kink; 0 keeps them flat. Returns samples
     { x, y, nx, ny, s, part, sulcus, side } plus pial and white-matter offsets. */
  function buildFold(opts) {
    var half = opts.half || 1.25;          // half of a 2.5 mm cortex
    var gap = opts.gap || 0.5;             // half-width of the CSF gap in a sulcus
    var lip = opts.lip || 2.0;             // bend radius of mid-cortex at each lip
    var dome = opts.dome || 0;
    var step = opts.step || 0.02;
    var wallX = gap + half;
    var pts = [];
    var sulci = opts.sulci;

    // Arch angle for each interior crown (between sulcus k-1 and k), so the crown's
    // sagitta is about `dome`; the lips then end on the crown's tangent.
    var archAngle = [];
    for (var c = 1; c < sulci.length; c++) {
      var L0 = (sulci[c].x - wallX - lip) - (sulci[c - 1].x + wallX + lip);
      var a = dome > 0 && L0 > 0 ? 2 * Math.atan(2 * dome / L0) : 0;
      if (a) a = 2 * Math.atan(2 * dome / (L0 + 2 * lip * Math.sin(a)));
      archAngle[c] = a;
    }

    function add(x, y, nx, ny, part, sulcus, side) {
      var prev = pts[pts.length - 1];
      var ds = prev ? Math.hypot(x - prev.x, y - prev.y) : 0;
      if (prev && ds < 1e-9) return;
      pts.push({ x: x, y: y, nx: nx, ny: ny, s: prev ? prev.s + ds : 0, part: part, sulcus: sulcus, side: side });
    }
    function line(x0, y0, x1, y1, nx, ny, part, sulcus, side) {
      var n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (var i = 0; i <= n; i++) add(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, nx, ny, part, sulcus, side);
    }
    function arc(cx, cy, r, a0, a1, inward, part, sulcus, side) {
      var n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step));
      for (var i = 0; i <= n; i++) {
        var a = a0 + (a1 - a0) * i / n, c = Math.cos(a), sn = Math.sin(a);
        add(cx + r * c, cy + r * sn, inward ? -c : c, inward ? -sn : sn, part, sulcus, side);
      }
    }

    var prevEnd = { x: opts.xMin, y: -half };
    sulci.forEach(function (sul, k) {
      var xc = sul.x, fundusC = -sul.depth + gap;
      var aL = archAngle[k] || 0, aR = archAngle[k + 1] || 0;
      var leftC = { x: xc - wallX - lip, y: -half - (aL ? dome : 0) - lip * Math.cos(aL) };
      var rightC = { x: xc + wallX + lip, y: -half - (aR ? dome : 0) - lip * Math.cos(aR) };
      var lipStart = { x: leftC.x + lip * Math.sin(aL), y: leftC.y + lip * Math.cos(aL) };

      // Crown leading into this sulcus: an arch between two lips, or flat at the ends.
      if (aL) {
        var R = (lipStart.x - prevEnd.x) / (2 * Math.sin(aL));
        arc((prevEnd.x + lipStart.x) / 2, lipStart.y - R * Math.cos(aL), R, 90 * DEG + aL, 90 * DEG - aL, false, 'crown', k, 'left');
      } else {
        line(prevEnd.x, -half, lipStart.x, -half, 0, 1, 'crown', k, 'left');
      }
      arc(leftC.x, leftC.y, lip, 90 * DEG - aL, 0, false, 'lip', k, 'left');
      line(xc - wallX, leftC.y, xc - wallX, fundusC, 1, 0, 'wall', k, 'left');
      arc(xc, fundusC, wallX, 180 * DEG, 360 * DEG, true, 'fundus', k, 'mid');
      line(xc + wallX, fundusC, xc + wallX, rightC.y, -1, 0, 'wall', k, 'right');
      arc(rightC.x, rightC.y, lip, 180 * DEG, 90 * DEG + aR, false, 'lip', k, 'right');
      prevEnd = { x: rightC.x - lip * Math.sin(aR), y: rightC.y + lip * Math.cos(aR) };
    });
    line(prevEnd.x, -half, opts.xMax, -half, 0, 1, 'crown', sulci.length, 'right');

    return {
      half: half,
      path: pts,
      total: pts[pts.length - 1].s,
      pial: pts.map(function (p) { return { x: p.x + half * p.nx, y: p.y + half * p.ny }; }),
      white: pts.map(function (p) { return { x: p.x - half * p.nx, y: p.y - half * p.ny }; })
    };
  }

  // Interpolated point on the path at arc length s.
  function at(fold, s) {
    var path = fold.path;
    s = Math.min(Math.max(s, 0), fold.total);
    var lo = 0, hi = path.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (path[mid].s <= s) lo = mid; else hi = mid;
    }
    var a = path[lo], b = path[hi];
    var t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    var nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
    var nl = Math.hypot(nx, ny) || 1;
    var c = t < 0.5 ? a : b;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: nx / nl, ny: ny / nl, part: c.part, sulcus: c.sulcus, side: c.side, s: s };
  }

  // Nearest path sample to (x, y), limited to arc lengths [lo, hi].
  function nearest(fold, x, y, lo, hi) {
    var path = fold.path, best = 0, bestD = Infinity;
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      if (p.s < lo || p.s > hi) continue;
      var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) { bestD = d; best = p.s; }
    }
    return { s: best, dist: Math.sqrt(bestD) };
  }

  // Arc length where the path first reaches x on a crown (paths start at xMin).
  function sAtCrownX(fold, x) {
    var path = fold.path;
    for (var i = 0; i < path.length; i++) if (path[i].part === 'crown' && path[i].x >= x) return path[i].s;
    return fold.total;
  }

  /* Potential of a unit dipole lying in the section plane (z = 0), measured
     at (x, y, z). Constant factors are dropped; only ratios are shown. */
  function potential(x, y, z, src) {
    var dx = x - src.x, dy = y - src.y;
    var r2 = dx * dx + dy * dy + z * z + 1e-9;
    return (src.nx * dx + src.ny * dy) / (r2 * Math.sqrt(r2));
  }

  /* ---------- Small dense linear algebra ---------- */
  function solve(A, b) {
    var n = b.length;
    var m = A.map(function (row, i) { return row.slice().concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      var tmp = m[c]; m[c] = m[piv]; m[piv] = tmp;
      var d = m[c][c] || 1e-300;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = m[r2][c] / d;
        if (f) for (var k = c; k <= n; k++) m[r2][k] -= f * m[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var sum = m[i][n];
      for (var j = i + 1; j < n; j++) sum -= m[i][j] * x[j];
      x[i] = sum / (m[i][i] || 1e-300);
    }
    return x;
  }

  function invert(A) {
    var n = A.length;
    var m = A.map(function (row, i) {
      var e = [];
      for (var k = 0; k < n; k++) e.push(k === i ? 1 : 0);
      return row.slice().concat(e);
    });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
      var tmp = m[c]; m[c] = m[piv]; m[piv] = tmp;
      var d = m[c][c] || 1e-300;
      for (var k2 = 0; k2 < 2 * n; k2++) m[c][k2] /= d;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var f = m[r2][c];
        if (f) for (var k3 = 0; k3 < 2 * n; k3++) m[r2][k3] -= f * m[c][k3];
      }
    }
    return m.map(function (row) { return row.slice(n); });
  }

  /* An inverse problem over candidate sources: L is contacts x sources. */
  function createInverse(L) {
    var M = L.length, N = L[0].length, G = [], trace = 0;
    for (var i = 0; i < M; i++) {
      G.push([]);
      for (var j = 0; j < M; j++) {
        var acc = 0;
        for (var n = 0; n < N; n++) acc += L[i][n] * L[j][n];
        G[i].push(acc);
      }
      trace += G[i][i];
    }

    // L2 minimum-norm estimate with a very light ridge.
    function minimumNorm(y) {
      var lam = 1e-6 * trace / M;
      var A = G.map(function (row, r) { return row.map(function (v, c) { return v + (r === c ? lam : 0); }); });
      var w = solve(A, y), x = new Float64Array(N);
      for (var n = 0; n < N; n++) {
        var acc = 0;
        for (var m = 0; m < M; m++) acc += L[m][n] * w[m];
        x[n] = acc;
      }
      return x;
    }

    // Sparse Bayesian learning, one time sample, convex-bounding updates:
    // gamma_n <- |x_n| / sqrt(l_n' Sigma^-1 l_n).
    function sparseBayesian(y, iterations) {
      var yy = 0, m, k, n;
      for (m = 0; m < M; m++) yy += y[m] * y[m];
      var lam = 1e-6 * yy / M + 1e-300;
      var gam = new Float64Array(N);
      gam.fill(yy / trace);
      var x = new Float64Array(N), Sigma = [], Si, w;
      for (m = 0; m < M; m++) Sigma.push(new Array(M));

      function update() {
        for (m = 0; m < M; m++) {
          for (k = 0; k <= m; k++) {
            var acc = 0;
            for (n = 0; n < N; n++) if (gam[n]) acc += gam[n] * L[m][n] * L[k][n];
            Sigma[m][k] = Sigma[k][m] = acc + (m === k ? lam : 0);
          }
        }
        Si = invert(Sigma);
        w = new Array(M);
        for (m = 0; m < M; m++) {
          var acc2 = 0;
          for (k = 0; k < M; k++) acc2 += Si[m][k] * y[k];
          w[m] = acc2;
        }
      }

      for (var it = 0; it < iterations; it++) {
        update();
        var next = new Float64Array(N), top = 0;
        for (n = 0; n < N; n++) {
          if (!gam[n]) continue;
          var z = 0, proj = 0;
          for (m = 0; m < M; m++) {
            var u = 0;
            for (k = 0; k < M; k++) u += Si[m][k] * L[k][n];
            z += L[m][n] * u;
            proj += L[m][n] * w[m];
          }
          x[n] = gam[n] * proj;
          next[n] = Math.abs(x[n]) / Math.sqrt(Math.max(z, 1e-300));
          if (next[n] > top) top = next[n];
        }
        for (n = 0; n < N; n++) gam[n] = next[n] > top * 1e-10 ? next[n] : 0;
      }
      update();
      for (n = 0; n < N; n++) {
        var proj2 = 0;
        for (m = 0; m < M; m++) proj2 += L[m][n] * w[m];
        x[n] = gam[n] * proj2;
      }
      return x;
    }

    return { minimumNorm: minimumNorm, sparseBayesian: sparseBayesian };
  }

  /* Colour maps used for activity: positive values on "hot", negative on "cool",
     as in common source-estimate displays. t runs 0..1. */
  var HOT = [[0, [90, 6, 6]], [0.35, [214, 32, 28]], [0.68, [246, 140, 30]], [1, [255, 228, 120]]];
  var COOL = [[0, [4, 24, 82]], [0.35, [30, 94, 226]], [0.68, [44, 176, 236]], [1, [160, 236, 255]]];
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1], b = stops[i], f = (t - a[0]) / (b[0] - a[0]);
        return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + (b[1][c] - a[1][c]) * f); });
      }
    }
    return stops[stops.length - 1][1].slice();
  }
  function activityColor(value, t) { return ramp(value >= 0 ? HOT : COOL, t); }

  /* The site's on-screen movement curve, cubic-bezier(0.77, 0, 0.175, 1),
     the same as --ease-in-out in styles.css, for canvas-driven motion. */
  function cubicBezier(p1x, p1y, p2x, p2y) {
    var cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    var cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
    function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
    function slopeX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x, i;
      for (i = 0; i < 8; i++) {
        var err = sampleX(t) - x, d = slopeX(t);
        if (Math.abs(err) < 1e-6 || Math.abs(d) < 1e-6) break;
        t -= err / d;
      }
      if (!(t >= 0 && t <= 1) || Math.abs(sampleX(t) - x) > 1e-4) {
        var lo = 0, hi = 1;
        t = x;
        for (i = 0; i < 40; i++) {
          var v = sampleX(t);
          if (Math.abs(v - x) < 1e-6) break;
          if (v < x) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
      }
      return sampleY(t);
    };
  }
  var easeInOut = cubicBezier(0.77, 0, 0.175, 1);

  root.CorticalModel = {
    buildFold: buildFold,
    at: at,
    nearest: nearest,
    sAtCrownX: sAtCrownX,
    potential: potential,
    createInverse: createInverse,
    activityColor: activityColor,
    easeInOut: easeInOut
  };
})(window);
