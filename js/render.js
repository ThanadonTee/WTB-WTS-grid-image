/*
 * Grid renderer — draws one WTB/WTS page onto a canvas.
 *
 * Every size is derived from the output width, so the on-screen preview and
 * the full-resolution export are pixel-for-pixel the same layout.
 */
(function (global) {
  'use strict';

  var FONT_FAMILY = 'Kanit';
  var FONT_STACK =
    '"' + FONT_FAMILY + '", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", ' +
    '"Noto Sans Thai", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", Arial, sans-serif';
  var FONT_WEIGHTS = [400, 500, 600, 700];

  var THEMES = {
    midnight: { name: 'Midnight', bg: '#0b1220', bg2: '#141d33', imgBg: '#1b2740', text: '#f8fafc', muted: '#9fb0c9', accent: '#facc15' },
    clean:    { name: 'Clean white', bg: '#f4f6fa', bg2: '#e6ebf2', imgBg: '#dfe5ee', text: '#0f172a', muted: '#5b6b82', accent: '#dc2626' },
    electric: { name: 'Electric yellow', bg: '#fde047', bg2: '#fbbf24', imgBg: '#fef3c7', text: '#1c1917', muted: '#57534e', accent: '#dc2626' },
    ocean:    { name: 'Ocean', bg: '#0c4a6e', bg2: '#082f49', imgBg: '#0e5a85', text: '#f0f9ff', muted: '#bae6fd', accent: '#fbbf24' },
    sakura:   { name: 'Sakura', bg: '#fdf2f8', bg2: '#fbcfe8', imgBg: '#ffffff', text: '#500724', muted: '#9d174d', accent: '#db2777' },
    carbon:   { name: 'Carbon', bg: '#0f0f0f', bg2: '#1a1a1a', imgBg: '#262626', text: '#fafafa', muted: '#a3a3a3', accent: '#22c55e' }
  };

  var MODES = {
    'WTS':       { color: '#16a34a', stamp: 'SOLD' },
    'WTB':       { color: '#2563eb', stamp: 'FOUND' },
    'WTT':       { color: '#9333ea', stamp: 'TRADED' },
    'WTS / WTT': { color: '#0d9488', stamp: 'SOLD' },
    'WTB / WTS': { color: '#ea580c', stamp: 'DONE' }
  };

  // Height / width of the picture area for each fixed card shape.
  // ("auto" is resolved by the app from the uploaded images.)
  var SHAPES = { vanguard: 510 / 350, card: 88 / 63, slab: 1.7, square: 1 };

  // Common rarity codes across Pokémon, One Piece, Yu-Gi-Oh!, MTG, Lorcana, etc.
  var RARITY_COLORS = [
    [/^(c|common)$/i, '#6b7280'],
    [/^(u|uc|unc|uncommon)$/i, '#059669'],
    [/^(r|rare|holo|holo rare)$/i, '#2563eb'],
    [/^(rr|double rare|super rare|sr)$/i, '#7c3aed'],
    [/^(rrr|triple rare|ultra rare|ex|gx|v|vmax|vstar)$/i, '#c026d3'],
    [/^(ar|art rare|ir|illustration rare|chr|csr|tr)$/i, '#0d9488'],
    [/^(sar|special art rare|sir|special illustration rare|ssr|enchanted)$/i, '#db2777'],
    [/^(ur|ultra|sec|secret|secret rare|scr|hr|hyper rare|gold|ghost|starlight|qcsr|mr|manga|manga rare)$/i, '#b45309'],
    [/^(l|leader)$/i, '#dc2626'],
    [/^(sp|special|alt|alt art|aa|parallel|p|m|mythic|mythic rare|legendary)$/i, '#ea580c'],
    [/^(or|origin rare|lr|zr|dsr|ffr|fr|exsec|exrrr|vr|svr|sgr|sns|gr)$/i, '#a16207'],
    [/^(td|trial deck)$/i, '#64748b'],
    [/^(pr|promo)$/i, '#475569']
  ];

  function rarityColor(rarity) {
    var r = String(rarity || '').trim();
    for (var i = 0; i < RARITY_COLORS.length; i++) {
      if (RARITY_COLORS[i][0].test(r)) return RARITY_COLORS[i][1];
    }
    var h = 0;
    for (var j = 0; j < r.length; j++) h = (h * 31 + r.charCodeAt(j)) % 360;
    return 'hsl(' + h + ', 62%, 42%)';
  }

  function font(weight, size) {
    return weight + ' ' + Math.max(1, Math.round(size)) + 'px ' + FONT_STACK;
  }

  function readableOn(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    var v = parseInt(m[1], 16);
    var c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(function (x) {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return lum > 0.45 ? '#111111' : '#ffffff';
  }

  function formatPrice(price, settings) {
    var p = String(price == null ? '' : price).trim();
    if (!p) return '';
    // Only decorate plain numbers; leave "Trade", "Offer", "฿500 obo" etc. untouched.
    if (!/^[\d\s.,]+$/.test(p)) return p;
    var digits = p.replace(/[\s,]/g, '');
    if (/^\d+(\.\d+)?$/.test(digits)) {
      var parts = digits.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      p = parts.join('.');
    }
    var cur = String(settings.currency || '').trim();
    if (!cur) return p;
    return settings.currencyPos === 'after' ? p + ' ' + cur : cur + p;
  }

  var measureCanvas = null;
  function measureCtx() {
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    return measureCanvas.getContext('2d');
  }

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    var chars = Array.from(text);
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
    return chars.length ? chars.join('').trimEnd() + '…' : '';
  }

  // Greedy wrap that prefers spaces but also breaks languages without spaces (Thai, Japanese).
  function wrapLines(ctx, text, maxWidth, maxLines) {
    var lines = [];
    var paras = String(text || '').split(/\r?\n/);
    for (var p = 0; p < paras.length; p++) {
      var line = [];
      var chars = Array.from(paras[p]);
      for (var i = 0; i < chars.length; i++) {
        line.push(chars[i]);
        if (line.length > 1 && ctx.measureText(line.join('')).width > maxWidth) {
          var breakAt = -1;
          for (var k = line.length - 1; k > 0; k--) {
            if (/\s/.test(line[k])) { breakAt = k; break; }
          }
          if (breakAt > 0) {
            lines.push(line.slice(0, breakAt).join('').trimEnd());
            line = line.slice(breakAt + 1);
          } else {
            lines.push(line.slice(0, -1).join(''));
            line = [chars[i]];
          }
        }
      }
      lines.push(line.join('').trimEnd());
    }
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + '…', maxWidth);
    }
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // Picks a column count that leaves few empty slots and keeps the image roughly portrait.
  function autoColumns(n, ratio) {
    if (n <= 1) return 1;
    var cellAspect = (ratio || SHAPES.card) + 0.05;
    var best = 1, bestScore = Infinity;
    for (var c = 1; c <= 6; c++) {
      var rows = Math.ceil(n / c);
      var empty = rows * c - n;
      var aspect = (rows * cellAspect) / c;
      var score = empty * 0.6 + Math.abs(Math.log(aspect / 1.1)) * 2;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  function drawImageFit(ctx, img, rotation, x, y, w, h, fit) {
    var rot = ((rotation || 0) % 360 + 360) % 360;
    var sideways = rot === 90 || rot === 270;
    var iw = sideways ? img.height : img.width;
    var ih = sideways ? img.width : img.height;
    var scale = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((rot * Math.PI) / 180);
    var uw = sideways ? dh : dw, uh = sideways ? dw : dh;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -uw / 2, -uh / 2, uw, uh);
    ctx.restore();
  }

  /*
   * opts = {
   *   settings, cards (this page), images (Map id -> drawable),
   *   pageIndex, pageCount, width, cols, ratio (picture height / width)
   * }
   */
  function computeLayout(opts) {
    var s = opts.settings;
    var W = Math.round(opts.width);
    var u = W / 1000;
    var ctx = measureCtx();
    var cards = opts.cards;
    var pad = 28 * u;
    var L = { W: W, u: u, pad: pad };

    // ---- Header: [MODE] Title ........ 1/3
    var modeLabel = s.mode || 'WTS';
    L.pillFont = font(600, 30 * u);
    ctx.font = L.pillFont;
    L.pillW = ctx.measureText(modeLabel).width + 40 * u;
    L.pillH = 54 * u;

    L.pageLabel = opts.pageCount > 1 ? (opts.pageIndex + 1) + '/' + opts.pageCount : '';
    L.pageFont = font(500, 24 * u);
    ctx.font = L.pageFont;
    L.pageW = L.pageLabel ? ctx.measureText(L.pageLabel).width : 0;

    L.titleX = pad + L.pillW + 18 * u;
    L.titleFont = font(600, 38 * u);
    L.titleLH = 48 * u;
    ctx.font = L.titleFont;
    var titleMaxW = W - L.titleX - pad - (L.pageW ? L.pageW + 20 * u : 0);
    var title = String(s.title || '').trim();
    L.titleLines = title ? wrapLines(ctx, title, titleMaxW, 2) : [];
    L.headerY = pad;
    L.row1H = Math.max(L.pillH, L.titleLines.length * L.titleLH);

    var y = pad + L.row1H;
    L.notesFont = font(400, 24 * u);
    L.notesLH = 33 * u;
    ctx.font = L.notesFont;
    var notes = String(s.notes || '').trim();
    L.noteLines = notes ? wrapLines(ctx, notes, W - 2 * pad, 6) : [];
    if (L.noteLines.length) {
      y += 12 * u;
      L.notesY = y;
      y += L.noteLines.length * L.notesLH;
    }
    y += 22 * u;

    // ---- Grid: pictures nearly edge to edge, details as tags on the picture.
    var n = cards.length;
    var ratio = opts.ratio || SHAPES.card;
    var cols = Math.max(1, opts.cols || autoColumns(n, ratio));
    var gap = 10 * u;
    var cw = (W - 2 * pad - (cols - 1) * gap) / cols;
    var cs = Math.min(cw, 420 * u); // scale for text and tags
    var g = {
      cols: cols, gap: gap, cw: cw, cs: cs, imgH: cw * ratio,
      tagH: cs * 0.125, tagM: cs * 0.04, tagPad: cs * 0.04,
      priceFont: font(600, cs * 0.085), badgeFont: font(600, cs * 0.066), qtyFont: font(600, cs * 0.07),
      nameFont: font(500, cs * 0.072), nameLH: cs * 0.092,
      noteFont: font(400, cs * 0.06), noteLH: cs * 0.078
    };

    var nameRows = 0, hasNote = false;
    g.items = cards.map(function (card) {
      var it = { card: card, nameLines: [], note: '', price: '', rarity: '', qty: '' };
      if (s.showName && String(card.name || '').trim()) {
        ctx.font = g.nameFont;
        it.nameLines = wrapLines(ctx, String(card.name).trim(), cw, 2);
        nameRows = Math.max(nameRows, it.nameLines.length);
      }
      if (s.showNote && String(card.note || '').trim()) {
        ctx.font = g.noteFont;
        it.note = ellipsize(ctx, String(card.note).trim().replace(/\s+/g, ' '), cw);
        hasNote = true;
      }
      if (s.showPrice) it.price = formatPrice(card.price, s);
      if (s.showRarity) it.rarity = String(card.rarity || '').trim();
      if (s.showQty && Number(card.qty) > 1) it.qty = '×' + Math.floor(Number(card.qty));
      return it;
    });

    // Optional caption under each picture, only when some card on the page has one.
    var captionText = nameRows * g.nameLH + (hasNote ? g.noteLH : 0);
    g.captionH = captionText ? cs * 0.035 + captionText : 0;
    g.cellH = g.imgH + g.captionH;
    g.rows = Math.max(1, Math.ceil(n / cols));
    g.rowGap = g.captionH ? gap * 1.8 : gap;
    g.y = y;
    y += n ? g.rows * g.cellH + (g.rows - 1) * g.rowGap : 320 * u;
    L.grid = g;

    // ---- Footer
    L.footFont = font(500, 24 * u);
    L.footLH = 33 * u;
    ctx.font = L.footFont;
    var contact = String(s.contact || '').trim();
    L.footLines = contact ? wrapLines(ctx, contact, W - 2 * pad, 3) : [];
    if (L.footLines.length) {
      y += 22 * u;
      L.footY = y;
      y += L.footLines.length * L.footLH;
    }
    y += pad;
    L.H = Math.ceil(y);
    return L;
  }

  function drawPage(canvas, opts) {
    var s = opts.settings;
    var theme = THEMES[s.theme] || THEMES.midnight;
    var accent = s.accent || theme.accent;
    var mode = MODES[s.mode] || MODES.WTS;
    var L = computeLayout(opts);
    var u = L.u, W = L.W, H = L.H, pad = L.pad;

    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.textBaseline = 'middle';

    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.bg);
    bg.addColorStop(1, theme.bg2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Mode pill
    var pillY = L.headerY + (L.row1H - L.pillH) / 2;
    ctx.fillStyle = mode.color;
    roundRect(ctx, pad, pillY, L.pillW, L.pillH, 12 * u);
    ctx.fill();
    ctx.fillStyle = readableOn(mode.color);
    ctx.font = L.pillFont;
    ctx.textAlign = 'center';
    ctx.fillText(s.mode || 'WTS', pad + L.pillW / 2, pillY + L.pillH / 2 + 2 * u);

    // Title
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = L.titleFont;
    var titleTop = L.headerY + (L.row1H - L.titleLines.length * L.titleLH) / 2;
    L.titleLines.forEach(function (line, i) {
      ctx.fillText(line, L.titleX, titleTop + L.titleLH * (i + 0.5) + 2 * u);
    });

    // Page label
    if (L.pageLabel) {
      ctx.fillStyle = theme.muted;
      ctx.font = L.pageFont;
      ctx.textAlign = 'right';
      ctx.fillText(L.pageLabel, W - pad, L.headerY + L.row1H / 2 + 2 * u);
      ctx.textAlign = 'left';
    }

    // Notes
    if (L.noteLines.length) {
      ctx.fillStyle = theme.muted;
      ctx.font = L.notesFont;
      L.noteLines.forEach(function (line, i) {
        ctx.fillText(line, pad, L.notesY + L.notesLH * (i + 0.5) + 1 * u);
      });
    }

    // Grid
    var g = L.grid;
    if (!g.items.length) {
      ctx.strokeStyle = theme.muted;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 3 * u;
      ctx.setLineDash([16 * u, 12 * u]);
      roundRect(ctx, pad, g.y, W - 2 * pad, 320 * u, 20 * u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = theme.muted;
      ctx.font = font(500, 30 * u);
      ctx.textAlign = 'center';
      ctx.fillText('Add card images to fill the grid', W / 2, g.y + 160 * u);
      ctx.textAlign = 'left';
    }

    g.items.forEach(function (it, idx) {
      var col = idx % g.cols;
      var row = Math.floor(idx / g.cols);
      var x = pad + col * (g.cw + g.gap);
      var y = g.y + row * (g.cellH + g.rowGap);
      drawCell(ctx, it, x, y, g, s, theme, accent, mode, opts.images, u);
    });

    // Footer
    if (L.footLines.length) {
      ctx.fillStyle = theme.text;
      ctx.font = L.footFont;
      ctx.textAlign = 'center';
      L.footLines.forEach(function (line, i) {
        ctx.fillText(line, W / 2, L.footY + L.footLH * (i + 0.5) + 1 * u);
      });
      ctx.textAlign = 'left';
    }

    return { width: W, height: H };
  }

  // A small rounded label with a soft shadow so it reads on any card art.
  function drawTag(ctx, text, x, y, h, padX, bg, fg, fontStr, u) {
    ctx.font = fontStr;
    var w = ctx.measureText(text).width + padX * 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 8 * u;
    ctx.shadowOffsetY = 2 * u;
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, h * 0.3);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + padX, y + h / 2 + h * 0.04);
    return w;
  }

  function measureTag(ctx, text, padX, fontStr) {
    ctx.font = fontStr;
    return ctx.measureText(text).width + padX * 2;
  }

  function drawCell(ctx, it, x, y, g, s, theme, accent, mode, images, u) {
    var card = it.card;
    var cw = g.cw, ih = g.imgH;

    // Picture
    ctx.save();
    roundRect(ctx, x, y, cw, ih, cw * 0.035);
    ctx.clip();
    ctx.fillStyle = theme.imgBg;
    ctx.fillRect(x, y, cw, ih);
    var img = images && images.get(card.id);
    if (img) {
      drawImageFit(ctx, img, card.rotation, x, y, cw, ih, s.fit);
    } else {
      ctx.fillStyle = theme.muted;
      ctx.font = font(500, g.cs * 0.06);
      ctx.textAlign = 'center';
      ctx.fillText('No image', x + cw / 2, y + ih / 2);
      ctx.textAlign = 'left';
    }

    if (card.sold) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y, cw, ih);
      var stamp = mode.stamp;
      ctx.save();
      ctx.translate(x + cw / 2, y + ih / 2);
      ctx.rotate(-0.3);
      var fs = cw * 0.16;
      ctx.font = font(700, fs);
      var sw = Math.min(ctx.measureText(stamp).width + fs * 0.8, cw * 1.05);
      var sh = fs * 1.45;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, -sw / 2, -sh / 2, sw, sh, fs * 0.2);
      ctx.fill();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = fs * 0.1;
      roundRect(ctx, -sw / 2 + fs * 0.12, -sh / 2 + fs * 0.12, sw - fs * 0.24, sh - fs * 0.24, fs * 0.12);
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'center';
      ctx.fillText(stamp, 0, fs * 0.06, sw - fs * 0.5);
      ctx.restore();
    }
    ctx.restore();

    // Tags on the picture: rarity bottom-left, price bottom-right, quantity top-right.
    var m = g.tagM, th = g.tagH, tp = g.tagPad;
    var tagY = y + ih - m - th;
    var avail = cw - 2 * m;
    var priceW = 0;
    if (it.price) {
      ctx.font = g.priceFont;
      var price = ellipsize(ctx, it.price, avail - 2 * tp);
      priceW = measureTag(ctx, price, tp, g.priceFont);
      drawTag(ctx, price, x + cw - m - priceW, tagY, th, tp, accent, readableOn(accent), g.priceFont, u);
    }
    if (it.rarity) {
      var room = avail - priceW - (priceW ? m * 0.6 : 0);
      if (room > th) {
        ctx.font = g.badgeFont;
        var label = ellipsize(ctx, it.rarity, room - 2 * tp * 0.8);
        if (label) drawTag(ctx, label, x + m, tagY, th, tp * 0.8, rarityColor(it.rarity), '#ffffff', g.badgeFont, u);
      }
    }
    if (it.qty) {
      var qw = measureTag(ctx, it.qty, tp * 0.8, g.qtyFont);
      drawTag(ctx, it.qty, x + cw - m - qw, y + m, th, tp * 0.8, 'rgba(15,23,42,0.82)', '#ffffff', g.qtyFont, u);
    }

    // Caption
    if (g.captionH) {
      var ty = y + ih + g.cs * 0.035;
      if (it.nameLines.length) {
        ctx.fillStyle = theme.text;
        ctx.font = g.nameFont;
        it.nameLines.forEach(function (line, i) {
          ctx.fillText(line, x, ty + g.nameLH * (i + 0.5) + 1 * u);
        });
        ty += it.nameLines.length * g.nameLH;
      }
      if (it.note) {
        ctx.fillStyle = theme.muted;
        ctx.font = g.noteFont;
        ctx.fillText(it.note, x, ty + g.noteLH / 2 + 1 * u);
      }
    }
  }

  global.GridRenderer = {
    THEMES: THEMES,
    MODES: MODES,
    SHAPES: SHAPES,
    FONT_FAMILY: FONT_FAMILY,
    FONT_WEIGHTS: FONT_WEIGHTS,
    autoColumns: autoColumns,
    computeLayout: computeLayout,
    drawPage: drawPage,
    formatPrice: formatPrice,
    rarityColor: rarityColor
  };
})(window);
