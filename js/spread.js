/*
 * Spread splitter — turns one photo of cards laid out on a mat into
 * separate card images.
 *
 * Detection is a heuristic tuned for the usual WTS "spread" photo: piles of
 * cards in rows on a playmat, each pile fanned so the copies behind peek out
 * on the left (or above) and the front card is fully visible. It finds the
 * rows and piles from the gaps of mat between them, crops each pile's front
 * card, and estimates the number of copies from the repeating card edges.
 * Every box can be fixed by hand before the cards are added.
 */
(function (global) {
  'use strict';

  var CARD_RATIO = 1.4;     // height / width of a (sleeved) physical card
  var WORK_SIZE = 800;      // detection runs on a copy this big
  var BG_DISTANCE = 50;     // colour distance from the mat that counts as "card"

  // ---------- Detection ----------

  function smooth(p, k) {
    k = Math.max(1, Math.round(k));
    var n = p.length, out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var sum = 0;
      for (var j = i - k; j <= i + k; j++) sum += p[Math.min(n - 1, Math.max(0, j))];
      out[i] = sum / (2 * k + 1);
    }
    return out;
  }

  function maxOf(p, a, b) {
    var m = -Infinity;
    for (var i = Math.max(0, a); i < Math.min(p.length, b); i++) if (p[i] > m) m = p[i];
    return m === -Infinity ? 0 : m;
  }

  // Splits [0, n) at valleys of the profile — places much emptier than the
  // peaks on both sides, i.e. the strips of mat between rows or piles.
  function segments(profile, minLen, win) {
    var p = smooth(profile, Math.max(1, minLen * 0.04));
    var n = p.length, cuts = [];
    for (var i = 1; i < n - 1; i++) {
      if (p[i] <= p[i - 1] && p[i] <= p[i + 1]) {
        var l = maxOf(p, i - win, i), r = maxOf(p, i + 1, i + 1 + win);
        if (p[i] < 0.6 * Math.min(l, r)) {
          var last = cuts[cuts.length - 1];
          if (last !== undefined && i - last < minLen * 0.5) {
            if (p[i] < p[last]) cuts[cuts.length - 1] = i;
          } else {
            cuts.push(i);
          }
        }
      }
    }
    var bounds = [0].concat(cuts, [n]), segs = [];
    for (var s = 0; s < bounds.length - 1; s++) {
      var a = bounds[s], b = bounds[s + 1];
      var peak = maxOf(p, a, b), first = -1, lastIdx = -1;
      for (var k = a; k < b; k++) {
        if (p[k] > 0.5 * peak) { if (first < 0) first = k; lastIdx = k; }
      }
      if (first >= 0 && lastIdx - first >= minLen) segs.push([first, lastIdx + 1]);
    }
    return segs;
  }

  // Smallest strong repeat distance in a profile (the spacing of fanned copies).
  function period(prof, lo, hi) {
    var n = prof.length, mean = 0, v = 0, i;
    for (i = 0; i < n; i++) mean += prof[i];
    mean /= n || 1;
    for (i = 0; i < n; i++) v += (prof[i] - mean) * (prof[i] - mean);
    v = v / (n || 1) + 1e-6;
    var cs = [];
    for (var lag = lo; lag <= hi && lag < n; lag++) {
      var c = 0;
      for (i = 0; i + lag < n; i++) c += (prof[i] - mean) * (prof[i + lag] - mean);
      cs.push([c / (n - lag) / v, lag]);
    }
    if (!cs.length) return 0;
    var best = Math.max.apply(null, cs.map(function (x) { return x[0]; }));
    if (best < 0.1) return 0;
    for (var j = 0; j < cs.length; j++) {
      var l = j > 0 ? cs[j - 1][0] : -1, r = j + 1 < cs.length ? cs[j + 1][0] : -1;
      if (cs[j][0] >= l && cs[j][0] >= r && cs[j][0] >= 0.75 * best) return cs[j][1];
    }
    return 0;
  }

  // Returns piles as { x, y, w, h, qty } in 0–1 image coordinates.
  function detect(source) {
    var sw = source.width, sh = source.height;
    var scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));
    var W = Math.max(1, Math.round(sw * scale)), H = Math.max(1, Math.round(sh * scale));
    var c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, W, H);
    var px = ctx.getImageData(0, 0, W, H).data;

    // Mat colour: the most common (coarsely quantised) colour along the edges.
    var bw = Math.max(2, Math.round(Math.min(W, H) * 0.02));
    var counts = {}, sums = {};
    function sample(x, y) {
      var o = (y * W + x) * 4, r = px[o], g = px[o + 1], b = px[o + 2];
      var key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
      counts[key] = (counts[key] || 0) + 1;
      var s = sums[key] || (sums[key] = [0, 0, 0]);
      s[0] += r; s[1] += g; s[2] += b;
    }
    var x, y;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        if (y < bw || y >= H - bw || x < bw || x >= W - bw) sample(x, y);
      }
    }
    var bestKey = null;
    Object.keys(counts).forEach(function (k) { if (bestKey === null || counts[k] > counts[bestKey]) bestKey = k; });
    var bg = sums[bestKey].map(function (v) { return v / counts[bestKey]; });

    var fg = new Uint8Array(W * H), lum = new Float32Array(W * H);
    for (var i = 0, o = 0; i < W * H; i++, o += 4) {
      var dr = px[o] - bg[0], dg = px[o + 1] - bg[1], db = px[o + 2] - bg[2];
      fg[i] = Math.sqrt(dr * dr + dg * dg + db * db) > BG_DISTANCE ? 1 : 0;
      lum[i] = (px[o] + px[o + 1] + px[o + 2]) / 3;
    }
    function gx(x, y) { return x > 0 && x < W - 1 ? Math.abs(lum[y * W + x + 1] - lum[y * W + x - 1]) : 0; }
    function gy(x, y) { return y > 0 && y < H - 1 ? Math.abs(lum[(y + 1) * W + x] - lum[(y - 1) * W + x]) : 0; }

    function rowProfile(x0, x1, y0, y1) {
      var p = new Float32Array(y1 - y0);
      for (var yy = y0; yy < y1; yy++) {
        var s = 0;
        for (var xx = x0; xx < x1; xx++) s += fg[yy * W + xx];
        p[yy - y0] = s / Math.max(1, x1 - x0);
      }
      return p;
    }
    function colProfile(x0, x1, y0, y1) {
      var p = new Float32Array(x1 - x0);
      for (var xx = x0; xx < x1; xx++) {
        var s = 0;
        for (var yy = y0; yy < y1; yy++) s += fg[yy * W + xx];
        p[xx - x0] = s / Math.max(1, y1 - y0);
      }
      return p;
    }

    var piles = [];
    segments(rowProfile(0, W, 0, H), H * 0.08, Math.round(H * 0.1)).forEach(function (row) {
      var y0 = row[0], y1 = row[1], rh = y1 - y0;
      segments(colProfile(0, W, y0, y1), rh * 0.3, Math.round(rh * 0.5)).forEach(function (col) {
        var x0 = col[0], x1 = col[1];
        // Tighten the pile vertically; generous so dark card art isn't cut off.
        var pr = smooth(rowProfile(x0, x1, y0, y1), Math.max(1, rh * 0.02));
        var peak = maxOf(pr, 0, pr.length), top = -1, bottom = -1;
        for (var k = 0; k < pr.length; k++) if (pr[k] > 0.3 * peak) { if (top < 0) top = k; bottom = k; }
        var py0 = top >= 0 ? y0 + top : y0, py1 = top >= 0 ? y0 + bottom + 1 : y1;
        var fill = 0;
        for (var yy = py0; yy < py1; yy++) for (var xx = x0; xx < x1; xx++) fill += fg[yy * W + xx];
        fill /= Math.max(1, (py1 - py0) * (x1 - x0));
        if (fill < 0.45) return; // mostly mat (logos, zone outlines)
        piles.push(frontCard(x0, py0, x1, py1));
      });
    });

    function frontCard(x0, y0, x1, y1) {
      var w = x1 - x0, h = y1 - y0, prof, yy, xx, lag;
      if (h / w > CARD_RATIO * 1.2) {
        // Fanned downwards: copies peek out above, the front card is at the bottom.
        var ch = w * CARD_RATIO, vstrip = h - ch;
        var ya = y0, yb = Math.min(y1, Math.round(y0 + vstrip + ch * 0.15));
        var xa = x0 + Math.round(w * 0.03), xb = x0 + Math.round(w * 0.3);
        prof = new Float32Array(yb - ya);
        for (yy = ya; yy < yb; yy++) { for (xx = xa; xx < xb; xx++) prof[yy - ya] += gy(xx, yy); }
        lag = period(prof, Math.max(2, Math.round(ch * 0.08)), Math.max(3, Math.round(Math.min(prof.length * 0.8, ch * 0.5))));
        return { x: x0, y: y1 - ch, w: w, h: ch, qty: 1 + (lag ? Math.round(vstrip / lag) : 1) };
      }
      var cw = h / CARD_RATIO;
      if (w < cw * 1.2) return { x: x0, y: y0, w: w, h: h, qty: 1 };
      // Fanned sideways: copies peek out on the left; their top-left corners
      // (grade/cost icons) repeat at a steady spacing.
      var strip = w - cw;
      var ya2 = y0 + Math.round(h * 0.03), yb2 = y0 + Math.round(h * 0.3);
      var xb2 = Math.min(x1, Math.round(x0 + strip + cw * 0.15));
      prof = new Float32Array(xb2 - x0);
      for (xx = x0; xx < xb2; xx++) { for (yy = ya2; yy < yb2; yy++) prof[xx - x0] += gx(xx, yy); }
      lag = period(prof, Math.max(2, Math.round(cw * 0.1)), Math.max(3, Math.round(Math.min(prof.length * 0.8, cw * 0.5))));
      return { x: x1 - cw, y: y0, w: cw, h: h, qty: 1 + (lag ? Math.round(strip / lag) : 1) };
    }

    return piles.map(function (p) {
      return { x: p.x / W, y: p.y / H, w: p.w / W, h: p.h / H, qty: Math.max(1, Math.min(99, p.qty)) };
    });
  }

  // ---------- Review dialog ----------

  var dlg, stage, img, boxLayer, toolbar, qtyOut, addBtn, hint;
  var state = null; // { bitmap, url, boxes: [{x,y,w,h,qty}], selected, onAdd }

  function el(id) { return document.getElementById(id); }

  function setup() {
    dlg = el('split-dialog');
    stage = el('split-stage');
    img = el('split-img');
    boxLayer = el('split-boxes');
    toolbar = el('split-toolbar');
    qtyOut = el('split-qty');
    addBtn = el('split-add');
    hint = el('split-hint');

    dlg.querySelector('[data-close]').addEventListener('click', close);
    dlg.addEventListener('close', cleanup);
    el('split-qty-minus').addEventListener('click', function () { bumpQty(-1); });
    el('split-qty-plus').addEventListener('click', function () { bumpQty(1); });
    el('split-delete').addEventListener('click', removeSelected);
    el('split-clear').addEventListener('click', function () {
      state.boxes = [];
      state.selected = -1;
      renderBoxes();
    });
    addBtn.addEventListener('click', finish);
    dlg.addEventListener('keydown', function (e) {
      if (!state || state.selected < 0) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    });
    stage.addEventListener('pointerdown', onPointerDown);
  }

  function open(bitmap, onAdd) {
    if (!dlg) setup();
    var c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext('2d').drawImage(bitmap, 0, 0);
    state = { bitmap: bitmap, boxes: [], selected: -1, onAdd: onAdd, url: null };
    c.toBlob(function (blob) {
      if (!state) return;
      state.url = URL.createObjectURL(blob);
      img.src = state.url;
    }, 'image/jpeg', 0.85);
    var found = [];
    try { found = detect(bitmap); } catch (err) { console.warn('Detection failed', err); }
    state.boxes = found;
    hint.textContent = found.length
      ? 'Found ' + found.length + ' card' + (found.length === 1 ? '' : 's') + '. Each box becomes one card — drag to move, drag the corner to resize, tap an empty spot to add a box. Check the quantities.'
      : 'Couldn’t find the cards automatically. Tap each card to add a box, then drag the corner to fit.';
    renderBoxes();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function close() {
    if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); cleanup(); }
  }

  function cleanup() {
    if (!state) return;
    if (state.url) URL.revokeObjectURL(state.url);
    state = null;
    img.removeAttribute('src');
    boxLayer.textContent = '';
  }

  // Box height in 0–1 units for a card-shaped box of the given width.
  function cardHeightFor(w) {
    return w * CARD_RATIO * (state.bitmap.width / state.bitmap.height);
  }

  function renderBoxes() {
    boxLayer.textContent = '';
    state.boxes.forEach(function (b, i) {
      var d = document.createElement('div');
      d.className = 'split-box' + (i === state.selected ? ' selected' : '');
      d.dataset.index = i;
      d.style.left = b.x * 100 + '%';
      d.style.top = b.y * 100 + '%';
      d.style.width = b.w * 100 + '%';
      d.style.height = b.h * 100 + '%';
      var tag = document.createElement('span');
      tag.className = 'split-tag';
      tag.textContent = (i + 1) + ' · ×' + b.qty;
      d.appendChild(tag);
      var handle = document.createElement('span');
      handle.className = 'split-handle';
      handle.setAttribute('aria-hidden', 'true');
      d.appendChild(handle);
      boxLayer.appendChild(d);
    });
    var sel = state.boxes[state.selected];
    toolbar.hidden = !sel;
    if (sel) qtyOut.textContent = sel.qty;
    var n = state.boxes.length;
    addBtn.disabled = !n;
    addBtn.textContent = n ? 'Add ' + n + ' card' + (n === 1 ? '' : 's') : 'Add cards';
  }

  function bumpQty(d) {
    var b = state.boxes[state.selected];
    if (!b) return;
    b.qty = Math.max(1, Math.min(99, b.qty + d));
    renderBoxes();
  }

  function removeSelected() {
    if (state.selected < 0) return;
    state.boxes.splice(state.selected, 1);
    state.selected = -1;
    renderBoxes();
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function onPointerDown(e) {
    if (!state || e.button > 0) return;
    var rect = stage.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width, py = (e.clientY - rect.top) / rect.height;
    var boxEl = e.target.closest('.split-box');
    var mode, index, start;

    if (boxEl) {
      index = Number(boxEl.dataset.index);
      mode = e.target.classList.contains('split-handle') ? 'resize' : 'move';
    } else {
      // Tap on the photo: add a card-sized box there (sized like the others).
      var widths = state.boxes.map(function (b) { return b.w; }).sort(function (a, b) { return a - b; });
      var w = widths.length ? widths[Math.floor(widths.length / 2)] : 0.15;
      var h = cardHeightFor(w);
      state.boxes.push({ x: clamp(px - w / 2, 0, 1 - w), y: clamp(py - h / 2, 0, Math.max(0, 1 - h)), w: w, h: h, qty: 1 });
      index = state.boxes.length - 1;
      mode = 'move';
    }
    state.selected = index;
    renderBoxes();
    e.preventDefault();
    start = { px: px, py: py, box: Object.assign({}, state.boxes[index]) };

    function onMove(ev) {
      var mx = (ev.clientX - rect.left) / rect.width, my = (ev.clientY - rect.top) / rect.height;
      var b = state.boxes[index];
      if (!b) return;
      if (mode === 'move') {
        b.x = clamp(start.box.x + mx - start.px, 0, 1 - b.w);
        b.y = clamp(start.box.y + my - start.py, 0, 1 - b.h);
      } else {
        b.w = clamp(mx - b.x, 0.02, 1 - b.x);
        b.h = clamp(my - b.y, 0.02, 1 - b.y);
      }
      var d = boxLayer.children[index];
      if (d) {
        d.style.left = b.x * 100 + '%';
        d.style.top = b.y * 100 + '%';
        d.style.width = b.w * 100 + '%';
        d.style.height = b.h * 100 + '%';
      }
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // Reading order: top-to-bottom rows, left-to-right within a row.
  function readingOrder(boxes) {
    var hs = boxes.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
    var rowH = (hs[Math.floor(hs.length / 2)] || 0.2) * 0.6;
    return boxes.slice().sort(function (a, b) {
      var ra = Math.round((a.y + a.h / 2) / rowH), rb = Math.round((b.y + b.h / 2) / rowH);
      return ra - rb || a.x - b.x;
    });
  }

  function finish() {
    if (!state || !state.boxes.length) return;
    var bmp = state.bitmap, onAdd = state.onAdd;
    var crops = readingOrder(state.boxes).map(function (b) {
      var sx = Math.round(b.x * bmp.width), sy = Math.round(b.y * bmp.height);
      var sw = Math.max(1, Math.round(b.w * bmp.width)), sh = Math.max(1, Math.round(b.h * bmp.height));
      var c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
      return new Promise(function (resolve) {
        c.toBlob(function (blob) { resolve({ blob: blob, qty: b.qty }); }, 'image/jpeg', 0.92);
      });
    });
    addBtn.disabled = true;
    Promise.all(crops).then(function (items) {
      close();
      onAdd(items.filter(function (it) { return it.blob; }));
    });
  }

  global.SpreadSplitter = { open: open, detect: detect };
})(window);
