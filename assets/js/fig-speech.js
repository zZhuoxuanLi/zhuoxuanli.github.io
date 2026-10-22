/* Figure: from brain activity to a sentence (speech decoding)
   ------------------------------------------------------------------
   One made-up attempt to say "I need some water". Top: neural features on
   16 electrodes over speech motor cortex, grouped by the articulator they
   follow. Middle: a decoder's phoneme probabilities in 20 ms frames, with a
   blank for "no new sound", as in connectionist temporal classification (CTC).
   Bottom: the words, spelled with no language model, an n-gram model, or an
   n-gram model plus a large language model (LLM). The decoder mishears one
   vowel (EY for AO), so each stage has something to repair. Every value is
   invented: not participant data, not the team's models, not results. */
(function () {
  'use strict';

  var M = window.CorticalModel, K = window.FigureKit;
  var fig = document.querySelector('[data-fig="speech"]');
  if (!M || !K || !fig) return;
  var canvas = fig.querySelector('[data-speech-canvas]');
  if (!canvas || !canvas.getContext) return;
  var slider = fig.querySelector('[data-speech-slider]');
  var wordButtons = Array.prototype.slice.call(fig.querySelectorAll('[data-word]'));
  var modeInputs = Array.prototype.slice.call(fig.querySelectorAll('input[name="fig2-lm"]'));
  var out = {};
  Array.prototype.forEach.call(fig.querySelectorAll('[data-out]'), function (el) { out[el.getAttribute('data-out')] = el; });
  var announce = K.announcer(out.live);

  /* ---------- The synthetic attempt ---------- */
  var DT = 0.02, FRAMES = 120, DURATION = FRAMES * DT;   // 2.4 s in 20 ms frames
  var ROWS = ['blank', 'AY', 'N', 'IY', 'D', 'S', 'AH', 'M', 'W', 'AO', 'EY', 'T', 'ER'];
  var GROUPS = [{ name: 'lips', short: 'lips' }, { name: 'tongue tip', short: 'tip' }, { name: 'tongue body', short: 'body' }, { name: 'larynx', short: 'larynx' }];
  var PER_GROUP = 4, ELECTRODES = GROUPS.length * PER_GROUP;
  var TARGET = ['I', 'need', 'some', 'water'];
  var WORD_SPAN = [[0.24, 0.46], [0.56, 1.02], [1.06, 1.46], [1.5, 2.1]];   // seconds, for the brackets
  // What the person attempted, when the decoder emits each sound, and how it splits the probability.
  var SOUNDS = [
    { ph: 'AY', word: 0, t: 0.34, p: { AY: 0.86, AH: 0.05 } },
    { ph: 'N', word: 1, t: 0.66, p: { N: 0.78, M: 0.12 } },
    { ph: 'IY', word: 1, t: 0.8, p: { IY: 0.84, EY: 0.06 } },
    { ph: 'D', word: 1, t: 0.94, p: { D: 0.8, T: 0.1 } },
    { ph: 'S', word: 2, t: 1.14, p: { S: 0.88 } },
    { ph: 'AH', word: 2, t: 1.26, p: { AH: 0.74, AO: 0.08, ER: 0.05 } },
    { ph: 'M', word: 2, t: 1.38, p: { M: 0.82, N: 0.1 } },
    { ph: 'W', word: 3, t: 1.58, p: { W: 0.86 } },
    { ph: 'AO', word: 3, t: 1.72, p: { EY: 0.48, AO: 0.41, AH: 0.04 } },   // misheard: EY wins, AO close behind
    { ph: 'T', word: 3, t: 1.88, p: { T: 0.83, D: 0.09 } },
    { ph: 'ER', word: 3, t: 2.02, p: { ER: 0.86 } }
  ];
  var MISHEARD = 8;
  // How strongly each attempted sound drives each articulator group: lips, tongue tip, tongue body, larynx.
  var ART = {
    AY: [0.1, 0, 1, 0.6], N: [0, 1, 0.1, 0.5], IY: [0, 0.1, 0.9, 0.6], D: [0, 1, 0, 0.4], S: [0, 0.9, 0.1, 0],
    AH: [0, 0, 0.7, 0.6], M: [1, 0, 0, 0.5], W: [1, 0, 0.4, 0.5], AO: [0.6, 0, 0.8, 0.6], T: [0, 1, 0, 0], ER: [0.3, 0, 0.8, 0.6]
  };
  var MODES = {
    none: {
      title: 'no language model', words: ['eye', 'need', 'sum', 'waiter'], vowel: 'EY',
      candidates: [{ text: 'eye need sum waiter', tag: 'spelled', chosen: true }],
      explain: 'With no language model, each group of phonemes is spelled as a dictionary word. Sounds alone can’t tell “I” from “eye” or “some” from “sum”, and the decoder heard EY, as in “waiter”.'
    },
    ngram: {
      title: 'n-gram model', words: ['I', 'need', 'some', 'waiter'], vowel: 'EY',
      candidates: [{ text: 'I need some waiter', tag: 'chosen', chosen: true }, { text: 'I need some water' }, { text: 'eye need some waiter' }],
      explain: 'An n-gram model scores word sequences by how often words follow one another. It fixes “I” and “some”, but keeps “waiter”, because the decoder’s phonemes say EY.'
    },
    llm: {
      title: 'n-gram model + LLM', words: ['I', 'need', 'some', 'water'], vowel: 'AO',
      candidates: [{ text: 'I need some waiter', tag: 'n-gram’s pick' }, { text: 'I need some water', tag: 'chosen', chosen: true }, { text: 'eye need some waiter' }],
      explain: 'A large language model rereads the top candidates with their phonemes. AO, as in “water”, was a close second at that moment, and “I need some water” makes sense, so it wins.'
    }
  };

  var data = (function generate() {
    var rand = K.rng(20261021);
    // Decoder output: each frame splits its probability over the phonemes and the blank.
    var post = [], f, i;
    for (f = 0; f < FRAMES; f++) post.push(ROWS.map(function () { return 0.006 * rand(); }));
    SOUNDS.forEach(function (s) {
      s.frame = Math.round(s.t / DT);
      [[s.frame, 1], [s.frame + 1, 0.55]].forEach(function (pair) {
        Object.keys(s.p).forEach(function (ph) { post[pair[0]][ROWS.indexOf(ph)] += s.p[ph] * pair[1]; });
      });
    });
    post.forEach(function (row) {
      var rest = 0;
      for (i = 1; i < row.length; i++) rest += row[i];
      row[0] = Math.max(0.02, 1 - rest);
      var total = row.reduce(function (a, b) { return a + b; }, 0);
      for (i = 0; i < row.length; i++) row[i] /= total;
    });
    // For display the blank row is dimmed, so the phonemes, not the pauses between them, carry the eye.
    var postRows = ROWS.map(function (ph, r) { return post.map(function (frame) { return frame[r] * (r === 0 ? 0.3 : 1); }); });

    // Neural features: each electrode follows its articulator group, slightly ahead of the sound, plus noise.
    var neural = [];
    for (var e = 0; e < ELECTRODES; e++) {
      var group = Math.floor(e / PER_GROUP), gain = 0.65 + 0.55 * rand(), lead = 0.09 + 0.07 * rand();
      var noise = [];
      for (f = 0; f < FRAMES; f++) noise.push(0.45 * K.gaussian(rand));
      noise = K.smooth(noise, 2);
      var row = [];
      for (f = 0; f < FRAMES; f++) {
        var t = (f + 0.5) * DT, v = noise[f];
        for (i = 0; i < SOUNDS.length; i++) {
          var a = ART[SOUNDS[i].ph][group];
          if (a) v += 3.1 * a * gain * Math.exp(-0.5 * Math.pow((t - (SOUNDS[i].t - lead)) / 0.06, 2));
        }
        row.push(v);
      }
      neural.push(row);
    }
    return { post: post, postRows: postRows, neural: neural };
  })();

  function ranked(frame) {
    var row = data.post[frame];
    var order = row.map(function (p, i) { return i; }).sort(function (a, b) { return row[b] - row[a]; });
    return order.map(function (i) { return { ph: ROWS[i], p: row[i] }; });
  }
  function wordAt(frame) {
    var t = (frame + 0.5) * DT;
    for (var i = 0; i < WORD_SPAN.length; i++) if (t >= WORD_SPAN[i][0] - 0.04 && t <= WORD_SPAN[i][1] + 0.04) return i;
    return -1;
  }

  /* ---------- Layout and drawing ---------- */
  var state = { frame: SOUNDS[MISHEARD].frame, mode: 'llm' };
  var view = null, L = {};

  function layout() {
    var width = canvas.getBoundingClientRect().width;
    if (!width) return false;
    var narrow = width < 560;
    var gutter = narrow ? 58 : 98, title = 22, gap = narrow ? 14 : 16;
    var rowA = narrow ? 6 : 7, rowB = narrow ? 12 : 14, strip = narrow ? 56 : 60, axis = 26;
    var H = title + ELECTRODES * rowA + gap + title + ROWS.length * rowB + gap + title + strip + axis;
    view = K.fit(canvas, H);
    if (!view) return false;
    view.narrow = narrow;
    var x = gutter, w = view.W - gutter - 4, y = title;
    L.gutter = gutter;
    L.raster = { x: x, y: y, w: w, h: ELECTRODES * rowA, row: rowA };
    y += L.raster.h + gap + title;
    L.post = { x: x, y: y, w: w, h: ROWS.length * rowB, row: rowB };
    y += L.post.h + gap + title;
    L.strip = { x: x, y: y, w: w, h: strip };
    L.axis = y + strip + 2;
    return true;
  }
  function X(seconds) { return L.raster.x + (seconds / DURATION) * L.raster.w; }
  function FX(frame) { return L.raster.x + (frame / FRAMES) * L.raster.w; }

  function draw() {
    if (!view) return;
    var ctx = view.ctx, W = view.W, H = view.H, narrow = view.narrow, mode = MODES[state.mode];
    var cw = L.post.w / FRAMES, fs = narrow ? 12 : 13;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Track titles, in the instrument's voice.
    var titleColor = '#8a8a8a';
    K.text(ctx, narrow ? 'Neural features, 16 electrodes' : 'Neural features · 16 electrodes over speech motor cortex', 0, L.raster.y - 8, { color: titleColor, size: fs });
    K.text(ctx, narrow ? 'Decoder: phoneme probabilities' : 'Decoder output · phoneme probabilities, one column per 20 ms', 0, L.post.y - 8, { color: titleColor, size: fs });
    K.text(ctx, 'Words · ' + mode.title, 0, L.strip.y - 8, { color: titleColor, size: fs });

    // Neural features in the activity colours, with the articulator groups named in the gutter.
    K.raster(ctx, data.neural, L.raster.x, L.raster.y, L.raster.w, L.raster.h, 'activity', 3.4);
    GROUPS.forEach(function (g, i) {
      var y0 = L.raster.y + i * PER_GROUP * L.raster.row;
      if (i) { ctx.fillStyle = 'rgba(255, 255, 255, 0.14)'; ctx.fillRect(L.raster.x, Math.round(y0), L.raster.w, 1); }
      K.text(ctx, narrow ? g.short : g.name, L.gutter - 10, y0 + PER_GROUP * L.raster.row / 2 + 4, { color: '#ababab', align: 'right', size: fs });
    });

    // Phoneme probabilities as light on black; the blank row is "no new sound".
    K.raster(ctx, data.postRows, L.post.x, L.post.y, L.post.w, L.post.h, 'gray');
    ROWS.forEach(function (ph, r) {
      K.text(ctx, ph, L.gutter - 10, L.post.y + (r + 0.5) * L.post.row + 4, { color: r === 0 ? '#8a8a8a' : '#ababab', align: 'right', size: fs });
    });

    // The current moment: a column across the decoder output and a hairline through every track.
    var cx = FX(state.frame + 0.5);
    ctx.fillStyle = 'rgba(255, 210, 63, 0.16)';
    ctx.fillRect(FX(state.frame), L.post.y, Math.max(1, cw), L.post.h);
    ctx.fillStyle = 'rgba(237, 237, 237, 0.34)';
    [L.raster, L.post, L.strip].forEach(function (box) { ctx.fillRect(Math.round(cx), box.y, 1, box.h); });

    // The decoded path: one yellow mark per sound, on the phoneme this mode keeps.
    SOUNDS.forEach(function (s, i) {
      var kept = i === MISHEARD ? mode.vowel : s.ph;
      var r = ROWS.indexOf(kept), x0 = L.post.x + s.frame * cw - 1.5, w0 = 2 * cw + 3;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffd23f';
      ctx.strokeRect(x0, L.post.y + r * L.post.row - 0.5, w0, L.post.row + 1);
      if (i === MISHEARD && kept !== 'EY') {
        // The decoder's own top guess, set aside by the language model.
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(237, 237, 237, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x0, L.post.y + ROWS.indexOf('EY') * L.post.row - 0.5, w0, L.post.row + 1);
        ctx.restore();
      }
    });

    // Phonemes at the moment they were emitted, then brackets and the words this mode produces.
    var phY = L.strip.y + 12, brY = L.strip.y + 22;
    if (narrow) {
      // Too little room to place each phoneme at its moment: show each word's phonemes as one group.
      TARGET.forEach(function (w, wi) {
        var group = SOUNDS.map(function (s, i) { return s.word === wi ? (i === MISHEARD ? mode.vowel : s.ph) : null; }).filter(Boolean).join(' ');
        K.text(ctx, group, (X(WORD_SPAN[wi][0]) + X(WORD_SPAN[wi][1])) / 2, phY, { color: '#ededed', align: 'center', size: fs });
      });
    } else {
      SOUNDS.forEach(function (s, i) {
        K.text(ctx, i === MISHEARD ? mode.vowel : s.ph, FX(s.frame + 1), phY, { color: '#ededed', align: 'center', size: fs });
      });
    }
    mode.words.forEach(function (word, i) {
      var x0 = X(WORD_SPAN[i][0]), x1 = X(WORD_SPAN[i][1]), mid = (x0 + x1) / 2;
      ctx.fillStyle = 'rgba(237, 237, 237, 0.35)';
      ctx.fillRect(x0, brY, x1 - x0, 1);
      ctx.fillRect(x0, brY - 4, 1, 5);
      ctx.fillRect(x1 - 1, brY - 4, 1, 5);
      var wrong = word !== TARGET[i];
      var ww = K.text(ctx, word, mid, brY + 24, { size: narrow ? 16 : 18, weight: 700, sans: true, color: wrong ? '#ababab' : '#ededed', align: 'center' });
      if (wrong) {
        ctx.fillStyle = '#8a8a8a';
        for (var dx = -ww / 2; dx < ww / 2; dx += 4) ctx.fillRect(Math.round(mid + dx), brY + 30, 2, 2);
      }
    });

    // Time axis, with the current moment marked in yellow.
    [0, 0.5, 1, 1.5, 2].forEach(function (s) {
      var x = X(s);
      ctx.fillStyle = 'rgba(237, 237, 237, 0.4)';
      ctx.fillRect(Math.round(x), L.axis, 1, 5);
      K.text(ctx, s === 2 ? '2.0 s' : s.toFixed(1), x, L.axis + 19, { color: '#8a8a8a', align: s === 0 ? 'left' : 'center', size: fs });
    });
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(Math.round(cx) - 1, L.axis - 1, 3, 8);
  }

  /* ---------- Readouts ---------- */
  function pct(p) { return Math.round(p * 100) + '%'; }
  function guessText(g) { return g.ph + ' ' + pct(g.p); }
  function seconds(frame) { return (frame * DT).toFixed(2) + ' s'; }

  function update(speak) {
    var mode = MODES[state.mode], ranks = ranked(state.frame);
    var wrong = mode.words.filter(function (w, i) { return w !== TARGET[i]; }).length;
    if (out.time) out.time.textContent = seconds(state.frame);
    if (out.top) out.top.textContent = guessText(ranks[0]);
    if (out.second) out.second.textContent = guessText(ranks[1]);
    if (out.errors) out.errors.textContent = wrong + ' of ' + TARGET.length;
    if (out.explain) out.explain.textContent = mode.explain;
    var current = wordAt(state.frame);
    if (out.sentence) {
      // The word under the cursor carries the yellow state mark, linking the sentence back to the tracks.
      out.sentence.innerHTML = mode.words.map(function (w, i) {
        var cls = 'word' + (w !== TARGET[i] ? ' is-wrong' : '') + (i === current ? ' is-current' : '');
        return '<span class="' + cls + '">' + w + (w !== TARGET[i] ? '<span class="visually-hidden"> (wrong)</span>' : '') + '</span>';
      }).join(' ');
    }
    if (out.candidates) {
      out.candidates.innerHTML = mode.candidates.map(function (c) {
        return '<li' + (c.chosen ? ' data-chosen' : '') + '><span>' + c.text + '</span>' + (c.tag ? '<span class="cand-tag">' + c.tag + '</span>' : '') + '</li>';
      }).join('');
    }
    wordButtons.forEach(function (b) { b.toggleAttribute('data-active', Number(b.getAttribute('data-word')) === current); });
    if (slider) {
      slider.value = String(state.frame);
      slider.setAttribute('aria-valuetext', seconds(state.frame).replace(' s', ' seconds') + ', top guess ' + guessText(ranks[0]));
    }
    if (speak) announce(seconds(state.frame).replace(' s', ' seconds') + '. Decoder’s top guess ' + guessText(ranks[0]) + ', runner-up ' + guessText(ranks[1]) +
      '. With ' + (state.mode === 'none' ? 'no language model' : state.mode === 'ngram' ? 'an n-gram model' : 'an n-gram model and an LLM') +
      ': “' + mode.words.join(' ') + '”, ' + (wrong ? wrong + ' wrong ' + (wrong === 1 ? 'word' : 'words') : 'no wrong words') + '.');
  }

  var queued = 0;
  function render() { queued = 0; draw(); }
  function requestRender() { if (!queued) queued = window.requestAnimationFrame(render); }

  function setFrame(frame) {
    var f = Math.max(0, Math.min(FRAMES - 1, Math.round(frame)));
    if (f === state.frame) return;
    state.frame = f;
    update(true);
    requestRender();
  }

  /* ---------- Input ---------- */
  var cancelGlide = function () {};
  if (slider) slider.addEventListener('input', function () { cancelGlide(); setFrame(Number(slider.value)); });
  wordButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var w = Number(button.getAttribute('data-word'));
      var target = SOUNDS.filter(function (s) { return s.word === w; })[0].frame;
      cancelGlide();
      cancelGlide = K.glide(state.frame, target, Math.min(800, 280 + Math.abs(target - state.frame) * 6), setFrame);
    });
  });
  modeInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (!input.checked) return;
      state.mode = input.value;
      update(true);
      requestRender();
    });
  });
  K.scrub(canvas, function (event) {
    var rect = canvas.getBoundingClientRect();
    return ((event.clientX - rect.left - L.raster.x) / L.raster.w) * FRAMES;
  }, function (frame) { cancelGlide(); setFrame(frame); });

  /* ---------- Setup ---------- */
  K.ramp(fig.querySelector('[data-ramp="activity"]'), 'activity');
  K.ramp(fig.querySelector('[data-ramp="gray"]'), 'gray');
  modeInputs.forEach(function (input) { input.checked = input.value === state.mode; });
  if (layout()) draw();
  update();
  K.onResize(canvas.parentNode, function () { if (layout()) draw(); });
})();
