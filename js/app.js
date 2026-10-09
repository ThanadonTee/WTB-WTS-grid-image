(function () {
  'use strict';

  var R = window.GridRenderer;
  var Store = window.Store;

  var PREVIEW_MAX_WIDTH = 1200;
  var MAX_IMAGE_SIDE = 2000;

  // Bump when a default changes enough that old saved values should be dropped.
  var SETTINGS_VERSION = 2;
  var RESET_ON_UPGRADE = ['shape', 'theme', 'accent'];

  var DEFAULTS = {
    mode: 'WTS',
    title: '',
    notes: '',
    contact: '',
    columns: 'auto',
    perImage: 'all',
    shape: 'auto',
    fit: 'cover',
    theme: 'midnight',
    accent: R.THEMES.midnight.accent,
    currency: '$',
    currencyPos: 'before',
    exportWidth: 2048,
    format: 'png',
    showName: true,
    showNote: true,
    showRarity: true,
    showPrice: true,
    showQty: true,
    lang: 'th'
  };

  var state = { settings: Object.assign({}, DEFAULTS), cards: [] };
  var images = new Map(); // card id -> { blob, img, url }

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3600);
  }

  // ---------- Persistence ----------

  var storageOk = true;
  function safe(p) {
    return p.catch(function (err) {
      if (storageOk) console.warn('Saving disabled:', err);
      storageOk = false;
    });
  }

  var saveSettings = debounce(function () {
    safe(Store.set('settings', Object.assign({ version: SETTINGS_VERSION }, state.settings)));
  }, 300);

  var saveCards = debounce(function () {
    var meta = state.cards.map(function (c) {
      return { id: c.id, name: c.name, rarity: c.rarity, price: c.price, qty: c.qty, note: c.note, sold: c.sold, rotation: c.rotation };
    });
    safe(Store.set('cards', meta));
  }, 300);

  // ---------- Images ----------

  function loadImageElement(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  function decode(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob).catch(function () { return loadImageElement(blob); });
    }
    return loadImageElement(blob);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (b) {
        if (b) resolve(b); else reject(new Error('Could not encode image'));
      }, type, quality);
    });
  }

  // Decodes an image file and shrinks huge phone photos so the app stays fast.
  function prepareImage(blob) {
    return decode(blob).then(function (img) {
      var w = img.width, h = img.height;
      var side = Math.max(w, h);
      if (side <= MAX_IMAGE_SIDE) return { blob: blob, img: img };
      var scale = MAX_IMAGE_SIDE / side;
      var c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      if (img.close) img.close();
      var type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return canvasToBlob(c, type, 0.92).then(function (small) {
        return decode(small).then(function (img2) { return { blob: small, img: img2 }; });
      });
    });
  }

  function newCard() {
    return { id: uid(), name: '', rarity: '', price: '', qty: 1, note: '', sold: false, rotation: 0 };
  }

  function addBlobs(blobs) {
    var list = Array.prototype.filter.call(blobs, function (b) {
      return b && (/^image\//.test(b.type) || /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(b.name || ''));
    });
    if (!list.length) {
      toast('Those files don’t look like images.');
      return Promise.resolve();
    }
    var failed = 0;
    // Prepare sequentially so cards keep the order they were picked in.
    return list.reduce(function (p, blob) {
      return p.then(function () {
        return prepareImage(blob).then(function (prepared) {
          var card = newCard();
          images.set(card.id, { blob: prepared.blob, img: prepared.img, url: URL.createObjectURL(prepared.blob) });
          state.cards.push(card);
          safe(Store.set('img:' + card.id, prepared.blob));
        }).catch(function () { failed++; });
      });
    }, Promise.resolve()).then(function () {
      if (failed) toast('Couldn’t read ' + failed + ' image' + (failed > 1 ? 's' : '') + '. Try JPG or PNG (HEIC isn’t supported in every browser).');
      saveCards();
      renderCardList();
      schedulePreview();
    });
  }

  function addFromUrl(url) {
    return fetch(url, { mode: 'cors' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.blob();
      })
      .then(function (blob) {
        if (!/^image\//.test(blob.type)) throw new Error('not an image');
        return addBlobs([blob]);
      })
      .catch(function () {
        toast('That site won’t let the image be loaded directly. Save the image to your device, then add it.');
      });
  }

  // ---------- Settings UI ----------

  function setupSettings() {
    var themeSelect = $('#theme-select');
    Object.keys(R.THEMES).forEach(function (key) {
      var o = document.createElement('option');
      o.value = key;
      o.textContent = R.THEMES[key].name;
      themeSelect.appendChild(o);
    });

    $all('[data-setting]').forEach(function (el) {
      var key = el.getAttribute('data-setting');
      var evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, function () {
        var v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.getAttribute('data-type') === 'number') v = Number(el.value);
        else v = el.value;
        state.settings[key] = v;
        if (key === 'theme') {
          state.settings.accent = R.THEMES[v].accent;
          $('[data-setting="accent"]').value = state.settings.accent;
        }
        if (key === 'lang') syncMode();
        saveSettings();
        schedulePreview();
      });
    });

    $all('#mode button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.settings.mode = btn.getAttribute('data-value');
        syncMode();
        saveSettings();
        schedulePreview();
      });
    });
  }

  function syncSettingsUI() {
    $all('[data-setting]').forEach(function (el) {
      var v = state.settings[el.getAttribute('data-setting')];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v == null ? '' : String(v);
    });
    syncMode();
  }

  function syncMode() {
    var mode = state.settings.mode;
    $all('#mode button').forEach(function (btn) {
      var on = btn.getAttribute('data-value') === mode;
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      btn.classList.toggle('on', on);
    });
    var stamp = R.stampText(state.settings);
    var label = state.settings.lang === 'en' ? stamp.charAt(0) + stamp.slice(1).toLowerCase() : stamp;
    $all('.sold-label').forEach(function (el) { el.textContent = label; });
  }

  // ---------- Card list ----------

  function findCard(id) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return i;
    return -1;
  }

  function renderCardList() {
    var list = $('#card-list');
    var tpl = $('#card-row-template');
    list.textContent = '';
    state.cards.forEach(function (card, i) {
      var li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = card.id;
      var entry = images.get(card.id);
      var img = li.querySelector('.thumb img');
      if (entry) img.src = entry.url;
      img.style.transform = 'rotate(' + (card.rotation || 0) + 'deg)';
      li.querySelectorAll('[data-field]').forEach(function (input) {
        var f = input.getAttribute('data-field');
        if (input.type === 'checkbox') input.checked = !!card[f];
        else input.value = card[f] == null ? '' : card[f];
      });
      li.querySelector('[data-act="up"]').disabled = i === 0;
      li.querySelector('[data-act="down"]').disabled = i === state.cards.length - 1;
      li.classList.toggle('is-sold', !!card.sold);
      list.appendChild(li);
    });
    syncMode();
    var n = state.cards.length;
    $('#card-count').textContent = n;
    $('#btn-export').disabled = !n;
    $('#btn-export-mobile').disabled = !n;
  }

  function setupCardList() {
    var list = $('#card-list');

    function onField(e) {
      var input = e.target;
      var field = input.getAttribute('data-field');
      if (!field) return;
      var li = input.closest('.card-row');
      var idx = findCard(li.dataset.id);
      if (idx < 0) return;
      var card = state.cards[idx];
      if (input.type === 'checkbox') {
        card[field] = input.checked;
        li.classList.toggle('is-sold', !!card.sold);
      } else if (field === 'qty') {
        card.qty = Math.max(1, parseInt(input.value, 10) || 1);
      } else {
        card[field] = input.value;
      }
      saveCards();
      schedulePreview();
    }
    list.addEventListener('input', onField);
    list.addEventListener('change', onField);

    list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var li = btn.closest('.card-row');
      var idx = findCard(li.dataset.id);
      if (idx < 0) return;
      var card = state.cards[idx];
      var act = btn.getAttribute('data-act');

      if (act === 'replace') {
        replaceTarget = card.id;
        $('#replace-input').click();
        return;
      }
      if (act === 'up' && idx > 0) {
        state.cards.splice(idx - 1, 0, state.cards.splice(idx, 1)[0]);
      } else if (act === 'down' && idx < state.cards.length - 1) {
        state.cards.splice(idx + 1, 0, state.cards.splice(idx, 1)[0]);
      } else if (act === 'rotate') {
        card.rotation = ((card.rotation || 0) + 90) % 360;
      } else if (act === 'dup') {
        var copy = Object.assign({}, card, { id: uid() });
        var entry = images.get(card.id);
        if (entry) {
          images.set(copy.id, { blob: entry.blob, img: entry.img, url: URL.createObjectURL(entry.blob) });
          safe(Store.set('img:' + copy.id, entry.blob));
        }
        state.cards.splice(idx + 1, 0, copy);
      } else if (act === 'del') {
        state.cards.splice(idx, 1);
        releaseImage(card.id);
        safe(Store.del('img:' + card.id));
      } else {
        return;
      }
      saveCards();
      renderCardList();
      schedulePreview();
      // Keep keyboard focus on the moved row's button.
      if (act === 'up' || act === 'down') {
        var moved = list.querySelector('[data-id="' + card.id + '"] [data-act="' + act + '"]');
        if (moved && !moved.disabled) moved.focus();
      }
    });
  }

  // A duplicated card shares its decoded image with the original, so only
  // close the decoded image once nothing else uses it.
  function releaseImage(id) {
    var entry = images.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    images.delete(id);
    var stillUsed = false;
    images.forEach(function (other) { if (other.img === entry.img) stillUsed = true; });
    if (!stillUsed && entry.img && entry.img.close) entry.img.close();
  }

  var replaceTarget = null;

  function setupInputs() {
    var fileInput = $('#file-input');
    $('#btn-add').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      addBlobs(fileInput.files).then(function () { fileInput.value = ''; });
    });

    var replaceInput = $('#replace-input');
    replaceInput.addEventListener('change', function () {
      var file = replaceInput.files[0];
      var id = replaceTarget;
      replaceInput.value = '';
      if (!file || !id) return;
      prepareImage(file).then(function (prepared) {
        releaseImage(id);
        images.set(id, { blob: prepared.blob, img: prepared.img, url: URL.createObjectURL(prepared.blob) });
        safe(Store.set('img:' + id, prepared.blob));
        renderCardList();
        schedulePreview();
      }).catch(function () { toast('Couldn’t read that image. Try a JPG or PNG.'); });
    });

    $('#url-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('#url-input');
      var url = input.value.trim();
      if (!url) return;
      addFromUrl(url).then(function () { input.value = ''; });
    });

    document.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) files.push(items[i].getAsFile());
      }
      if (files.length) {
        e.preventDefault();
        addBlobs(files);
      }
    });

    var overlay = $('#drop-overlay');
    var dragDepth = 0;
    function hasFiles(e) {
      var types = e.dataTransfer && e.dataTransfer.types;
      return types && Array.prototype.indexOf.call(types, 'Files') >= 0;
    }
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      dragDepth++;
      overlay.hidden = false;
    });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) overlay.hidden = true;
    });
    window.addEventListener('dragover', function (e) {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', function (e) {
      dragDepth = 0;
      overlay.hidden = true;
      if (!e.dataTransfer) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        addBlobs(e.dataTransfer.files);
        return;
      }
      var uri = e.dataTransfer.getData('text/uri-list');
      if (uri && /^https?:/i.test(uri)) {
        e.preventDefault();
        addFromUrl(uri.split('\n')[0].trim());
      }
    });

    $('#btn-clear').addEventListener('click', function () {
      if (!state.cards.length && !state.settings.title && !state.settings.notes) return;
      if (!confirm('Remove all cards and start a new post? Your style settings and footer are kept.')) return;
      state.cards.forEach(function (c) { safe(Store.del('img:' + c.id)); });
      state.cards = [];
      Array.from(images.keys()).forEach(releaseImage);
      state.settings.title = '';
      state.settings.notes = '';
      saveCards();
      saveSettings();
      syncSettingsUI();
      renderCardList();
      schedulePreview();
    });
  }

  // ---------- Preview & export ----------

  function paginate() {
    var cards = state.cards;
    var per = state.settings.perImage === 'all' ? cards.length : Number(state.settings.perImage);
    if (!per || per < 1) per = Math.max(1, cards.length);
    var pages = [];
    for (var i = 0; i < cards.length; i += per) pages.push(cards.slice(i, i + per));
    if (!pages.length) pages.push([]);
    return pages;
  }

  // Picture height / width. "auto" follows the uploaded images (median shape,
  // ignoring odd ones out) so cards like Vanguard's 350×510 scans are never cropped.
  function resolveRatio() {
    var shape = state.settings.shape;
    if (R.SHAPES[shape]) return R.SHAPES[shape];
    var ratios = [];
    state.cards.forEach(function (card) {
      var entry = images.get(card.id);
      if (!entry || !entry.img.width || !entry.img.height) return;
      var sideways = (card.rotation || 0) % 180 !== 0;
      var r = sideways ? entry.img.width / entry.img.height : entry.img.height / entry.img.width;
      ratios.push(r);
    });
    if (!ratios.length) return R.SHAPES.card;
    ratios.sort(function (a, b) { return a - b; });
    var median = ratios[Math.floor(ratios.length / 2)];
    return Math.min(2, Math.max(0.5, median));
  }

  function resolveColumns(pages, ratio) {
    var c = state.settings.columns;
    if (c && c !== 'auto') return Number(c);
    return R.autoColumns(pages[0].length, ratio);
  }

  // Waits for the image font so exports never fall back to a system font.
  // Includes Thai and ฿ so those font subsets load too.
  var fontsPromise = null;
  function ensureFonts() {
    if (!fontsPromise) {
      if (!document.fonts || !document.fonts.load) {
        fontsPromise = Promise.resolve();
      } else {
        fontsPromise = Promise.all(R.FONT_WEIGHTS.map(function (w) {
          return document.fonts.load(w + ' 32px "' + R.FONT_FAMILY + '"', 'Aa1฿กข');
        })).catch(function () {});
      }
    }
    return fontsPromise;
  }

  function drawables() {
    var map = new Map();
    images.forEach(function (entry, id) { map.set(id, entry.img); });
    return map;
  }

  function renderPages(width) {
    var pages = paginate();
    var ratio = resolveRatio();
    var cols = resolveColumns(pages, ratio);
    var imgs = drawables();
    return pages.map(function (cards, i) {
      var canvas = document.createElement('canvas');
      var size = R.drawPage(canvas, {
        settings: state.settings,
        cards: cards,
        images: imgs,
        pageIndex: i,
        pageCount: pages.length,
        width: width,
        cols: cols,
        ratio: ratio
      });
      return { canvas: canvas, width: size.width, height: size.height };
    });
  }

  var previewQueued = false;
  var schedulePreviewDebounced = debounce(function () {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(function () {
      previewQueued = false;
      renderPreview();
    });
  }, 60);
  function schedulePreview() { schedulePreviewDebounced(); }

  function renderPreview() {
    var exportW = Number(state.settings.exportWidth) || 2048;
    var previewW = Math.min(exportW, PREVIEW_MAX_WIDTH);
    var rendered = renderPages(previewW);
    var wrap = $('#preview-pages');
    wrap.textContent = '';
    rendered.forEach(function (page, i) {
      var fig = document.createElement('figure');
      fig.className = 'preview-page';
      page.canvas.setAttribute('role', 'img');
      page.canvas.setAttribute('aria-label', 'Preview of image ' + (i + 1));
      fig.appendChild(page.canvas);
      if (rendered.length > 1) {
        var cap = document.createElement('figcaption');
        cap.textContent = 'Image ' + (i + 1) + ' of ' + rendered.length;
        fig.appendChild(cap);
      }
      wrap.appendChild(fig);
    });

    var n = state.cards.length;
    var pages = paginate();
    var ratio = resolveRatio();
    var exportH = R.computeLayout({
      settings: state.settings, cards: pages[0], pageIndex: 0, pageCount: pages.length,
      width: exportW, cols: resolveColumns(pages, ratio), ratio: ratio
    }).H;
    var info = n
      ? n + ' card' + (n === 1 ? '' : 's') + ' · ' + rendered.length + ' image' + (rendered.length === 1 ? '' : 's') +
        ' · ' + exportW + ' × ' + exportH + ' px'
      : '';
    $('#preview-info').textContent = info;

    var tall = n && rendered.some(function (p) { return p.height / p.width > 2.2; });
    var warn = $('#preview-warning');
    warn.hidden = !tall;
    if (tall) warn.textContent = 'This image is very tall, so Facebook will show it small. Try more columns or fewer cards per image.';
  }

  var exported = [];

  function fileBase() {
    var d = new Date();
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var mode = state.settings.mode.replace(/[^a-z]+/gi, '-').toLowerCase();
    return mode + '-' + date;
  }

  function formatBytes(b) {
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function clearExported() {
    exported.forEach(function (e) { URL.revokeObjectURL(e.url); });
    exported = [];
  }

  function exportImages() {
    if (!state.cards.length) return;
    var btns = [$('#btn-export'), $('#btn-export-mobile')];
    btns.forEach(function (b) { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Rendering…'; });

    var s = state.settings;
    var type = s.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    var ext = s.format === 'jpeg' ? 'jpg' : 'png';

    // Let the button repaint before the heavy render.
    setTimeout(function () {
      ensureFonts().then(function () {
        var pages = renderPages(Number(s.exportWidth) || 2048);
        return Promise.all(pages.map(function (p) { return canvasToBlob(p.canvas, type, 0.92); }))
          .then(function (blobs) { return { pages: pages, blobs: blobs }; });
      })
        .then(function (res) {
          var pages = res.pages, blobs = res.blobs;
          clearExported();
          var base = fileBase();
          exported = blobs.map(function (blob, i) {
            var name = base + (blobs.length > 1 ? '-' + (i + 1) : '') + '.' + ext;
            return { blob: blob, name: name, url: URL.createObjectURL(blob), canvas: pages[i].canvas, w: pages[i].width, h: pages[i].height };
          });
          showExportDialog();
        })
        .catch(function (err) {
          console.error(err);
          toast('Export failed — try a smaller export width.');
        })
        .then(function () {
          btns.forEach(function (b) { b.textContent = b.dataset.label; b.disabled = !state.cards.length; });
        });
    }, 30);
  }

  function canShareFiles(files) {
    try { return !!(navigator.canShare && navigator.canShare({ files: files })); } catch (e) { return false; }
  }

  function toFile(e) { return new File([e.blob], e.name, { type: e.blob.type }); }

  function shareFiles(files) {
    return navigator.share({ files: files }).catch(function (err) {
      if (err && err.name !== 'AbortError') toast('Sharing didn’t work here. Use Download instead.');
    });
  }

  function copyImage(e) {
    if (!navigator.clipboard || !window.ClipboardItem) {
      toast('Copying images isn’t supported in this browser. Use Download instead.');
      return;
    }
    // Clipboards only reliably accept PNG.
    var png = e.blob.type === 'image/png' ? Promise.resolve(e.blob) : canvasToBlob(e.canvas, 'image/png');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      .then(function () { toast('Copied! Paste it into your Facebook post with Ctrl/⌘+V.'); })
      .catch(function () { toast('Couldn’t copy the image. Use Download instead.'); });
  }

  function showExportDialog() {
    var list = $('#export-list');
    list.textContent = '';
    exported.forEach(function (e, i) {
      var item = document.createElement('div');
      item.className = 'export-item';

      var img = document.createElement('img');
      img.src = e.url;
      img.alt = 'Exported image ' + (i + 1);
      item.appendChild(img);

      var meta = document.createElement('div');
      meta.className = 'export-meta';
      var label = document.createElement('div');
      label.className = 'small';
      label.innerHTML = '<strong></strong><br><span class="muted"></span>';
      label.querySelector('strong').textContent = e.name;
      label.querySelector('span').textContent = e.w + ' × ' + e.h + ' px · ' + formatBytes(e.blob.size);
      meta.appendChild(label);

      var actions = document.createElement('div');
      actions.className = 'export-actions';
      var dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'btn primary';
      dl.textContent = 'Download';
      dl.addEventListener('click', function () { downloadBlob(e.blob, e.name); });
      actions.appendChild(dl);

      var cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'btn';
      cp.textContent = 'Copy';
      cp.addEventListener('click', function () { copyImage(e); });
      actions.appendChild(cp);

      var file = toFile(e);
      if (canShareFiles([file])) {
        var sh = document.createElement('button');
        sh.type = 'button';
        sh.className = 'btn';
        sh.textContent = 'Share';
        sh.addEventListener('click', function () { shareFiles([file]); });
        actions.appendChild(sh);
      }
      meta.appendChild(actions);
      item.appendChild(meta);
      list.appendChild(item);
    });

    var allFiles = exported.map(toFile);
    $('#btn-share-all').hidden = exported.length < 2 || !canShareFiles(allFiles);
    $('#btn-download-all').textContent = exported.length > 1 ? 'Download all (' + exported.length + ')' : 'Download';

    var dlg = $('#export-dialog');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function setupExport() {
    $('#btn-export').addEventListener('click', exportImages);
    $('#btn-export-mobile').addEventListener('click', exportImages);

    var dlg = $('#export-dialog');
    dlg.querySelector('[data-close]').addEventListener('click', function () {
      if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg && dlg.close) dlg.close();
    });

    $('#btn-download-all').addEventListener('click', function () {
      // Space the downloads out so browsers don't drop any.
      exported.forEach(function (e, i) {
        setTimeout(function () { downloadBlob(e.blob, e.name); }, i * 400);
      });
    });
    $('#btn-share-all').addEventListener('click', function () {
      shareFiles(exported.map(toFile));
    });
  }

  // ---------- Boot ----------

  function restore() {
    return Promise.all([Store.get('settings'), Store.get('cards')])
      .then(function (res) {
        var saved = res[0], cards = res[1];
        if (saved && typeof saved === 'object') {
          var outdated = saved.version !== SETTINGS_VERSION;
          Object.keys(DEFAULTS).forEach(function (k) {
            if (outdated && RESET_ON_UPGRADE.indexOf(k) >= 0) return;
            if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k]) state.settings[k] = saved[k];
          });
          if (!R.SHAPES[state.settings.shape]) state.settings.shape = 'auto';
          if (!R.THEMES[state.settings.theme]) state.settings.theme = DEFAULTS.theme;
          if (!R.MODES[state.settings.mode]) state.settings.mode = DEFAULTS.mode;
        }
        if (!Array.isArray(cards)) return;
        return Promise.all(cards.map(function (meta) {
          return Store.get('img:' + meta.id).then(function (blob) {
            if (!blob) return null;
            return decode(blob).then(function (img) {
              images.set(meta.id, { blob: blob, img: img, url: URL.createObjectURL(blob) });
              return Object.assign(newCard(), meta);
            });
          }).catch(function () { return null; });
        })).then(function (restored) {
          state.cards = restored.filter(Boolean);
        });
      })
      .catch(function (err) {
        storageOk = false;
        console.warn('Could not restore previous session:', err);
      });
  }

  function init() {
    setupSettings();
    setupCardList();
    setupInputs();
    setupExport();
    Promise.all([restore(), ensureFonts()]).then(function () {
      saveSettings(); // stamps the current settings version
      syncSettingsUI();
      renderCardList();
      renderPreview();
    });
  }

  init();
})();
