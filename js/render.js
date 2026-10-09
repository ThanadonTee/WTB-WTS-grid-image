/*
 * Grid renderer — draws one WTB/WTS page onto a canvas.
 *
 * Every size is derived from the output width, so the on-screen preview and
 * the full-resolution export are pixel-for-pixel the same layout.
 */
(function (global) {
  'use strict';

  var FONT_STACK =
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", ' +
    '"Noto Sans Thai", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", Arial, sans-serif';

  var THEMES = {
    midnight: { name: 'Midnight', bg: '#0b1220', bg2: '#17223b', panel: '#1b2740', imgBg: '#0f172a', text: '#f8fafc', muted: '#9fb0c9', accent: '#facc15', line: 'rgba(255,255,255,0.10)' },
    clean:    { name: 'Clean white', bg: '#eef2f7', bg2: '#dfe6ef', panel: '#ffffff', imgBg: '#f1f5f9', text: '#0f172a', muted: '#64748b', accent: '#dc2626', line: 'rgba(15,23,42,0.12)' },
    electric: { name: 'Electric yellow', bg: '#fde047', bg2: '#fbbf24', panel: '#fffbeb', imgBg: '#fef3c7', text: '#1c1917', muted: '#57534e', accent: '#dc2626', line: 'rgba(28,25,23,0.18)' },
    ocean:    { name: 'Ocean', bg: '#0c4a6e', bg2: '#082f49', panel: '#0e5a85', imgBg: '#083350', text: '#f0f9ff', muted: '#bae6fd', accent: '#fbbf24', line: 'rgba(255,255,255,0.14)' },
    sakura:   { name: 'Sakura', bg: '#fdf2f8', bg2: '#fbcfe8', panel: '#ffffff', imgBg: '#fdf2f8', text: '#500724', muted: '#9d174d', accent: '#db2777', line: 'rgba(80,7,36,0.12)' },
    carbon:   { name: 'Carbon', bg: '#111111', bg2: '#1f1f1f', panel: '#262626', imgBg: '#171717', text: '#fafafa', muted: '#a3a3a3', accent: '#22c55e', line: 'rgba(255,255,255,0.10)' }
  };

  var MODES = {
    'WTS':       { color: '#16a34a', stamp: 'SOLD' },
    'WTB':       { color: '#2563eb', stamp: 'FOUND' },
    'WTT':       { color: '#9333ea', stamp: 'TRADED' },
    'WTS / WTT': { color: '#0d9488', stamp: 'SOLD' },
    'WTB / WTS': { color: '#ea580c', stamp: 'DONE' }
  };

  // Height / width of the picture area for each card shape.
  var SHAPES = { card: 88 / 63, slab: 1.7, square: 1 };

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
  function autoColumns(n) {
    if (n <= 1) return 1;
    var best = 1, bestScore = Infinity;
    for (var c = 1; c <= 6; c++) {
      var rows = Math.ceil(n / c);
      var empty = rows * c - n;
      var aspect = (rows * 1.62) / c;
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
   *   pageIndex, pageCount, width, cols
   * }
   */
  function computeLayout(opts) {
    var s = opts.settings;
    var W = Math.round(opts.width);
    var u = W / 1000;
    var ctx = measureCtx();
    var cards = opts.cards;
    var L = { W: W, u: u, pad: 36 * u };
    var pad = L.pad;

    // ---- Header: [MODE] Title ........ 1/3
    var modeLabel = s.mode || 'WTS';
    L.pillFont = font(800, 40 * u);
    ctx.font = L.pillFont;
    L.pillW = ctx.measureText(modeLabel).width + 56 * u;
    L.pillH = 68 * u;

    L.pageLabel = opts.pageCount > 1 ? (opts.pageIndex + 1) + '/' + opts.pageCount : '';
    L.pageFont = font(700, 26 * u);
    ctx.font = L.pageFont;
    L.pageW = L.pageLabel ? ctx.measureText(L.pageLabel).width + 36 * u : 0;
    L.pageH = 48 * u;

    L.titleX = pad + L.pillW + 22 * u;
    L.titleFont = font(800, 44 * u);
    L.titleLH = 54 * u;
    ctx.font = L.titleFont;
    var titleMaxW = W - L.titleX - pad - (L.pageW ? L.pageW + 16 * u : 0);
    var title = String(s.title || '').trim();
    L.titleLines = title ? wrapLines(ctx, title, titleMaxW, 2) : [];
    L.headerY = pad;
    L.row1H = Math.max(L.pillH, L.titleLines.length * L.titleLH);

    var y = pad + L.row1H;
    L.notesFont = font(500, 26 * u);
    L.notesLH = 36 * u;
    ctx.font = L.notesFont;
    var notes = String(s.notes || '').trim();
    L.noteLines = notes ? wrapLines(ctx, notes, W - 2 * pad, 8) : [];
    if (L.noteLines.length) {
      y += 18 * u;
      L.notesY = y;
      y += L.noteLines.length * L.notesLH;
    }
    y += 28 * u;

    // ---- Grid
    var n = cards.length;
    var cols = Math.max(1, opts.cols || autoColumns(n));
    var gap = 18 * u;
    var cw = (W - 2 * pad - (cols - 1) * gap) / cols;
    var cs = Math.min(cw, 400 * u); // text scale inside a cell
    var ip = Math.max(cs * 0.045, 4 * u);
    var imgW = cw - 2 * ip;
    var imgH = imgW * (SHAPES[s.shape] || SHAPES.card);

    var g = {
      cols: cols, gap: gap, cw: cw, cs: cs, ip: ip, imgW: imgW, imgH: imgH,
      nameFont: font(700, cs * 0.072), nameLH: cs * 0.09,
      noteFont: font(500, cs * 0.058), noteLH: cs * 0.075,
      priceFont: font(800, cs * 0.11), rowH: cs * 0.13,
      badgeFont: font(800, cs * 0.06), qtyFont: font(800, cs * 0.068)
    };

    var nameRows = 0, hasNote = false, hasRow = false;
    g.items = cards.map(function (card) {
      var it = { card: card, nameLines: [], note: '', price: '', rarity: '', qty: '' };
      if (s.showName && String(card.name || '').trim()) {
        ctx.font = g.nameFont;
        it.nameLines = wrapLines(ctx, String(card.name).trim(), imgW, 2);
        nameRows = Math.max(nameRows, it.nameLines.length);
      }
      if (s.showNote && String(card.note || '').trim()) {
        ctx.font = g.noteFont;
        it.note = ellipsize(ctx, String(card.note).trim().replace(/\s+/g, ' '), imgW);
        hasNote = true;
      }
      if (s.showPrice) it.price = formatPrice(card.price, s);
      if (s.showRarity) it.rarity = String(card.rarity || '').trim();
      if (s.showQty && Number(card.qty) > 1) it.qty = '×' + Math.floor(Number(card.qty));
      if (it.price || it.rarity || it.qty) hasRow = true;
      return it;
    });

    var textBlock = nameRows * g.nameLH + (hasNote ? g.noteLH : 0);
    g.nameRows = nameRows;
    g.hasNote = hasNote;
    g.hasRow = hasRow;
    g.infoH = 0;
    if (textBlock || hasRow) {
      g.infoH = ip * 0.9 + textBlock + (hasRow ? (textBlock ? cs * 0.025 : 0) + g.rowH : 0);
    }
    g.cellH = ip + imgH + g.infoH + ip;
    var rows = Math.max(1, Math.ceil(n / cols));
    g.rows = rows;
    g.y = y;
    var gridH = n ? rows * g.cellH + (rows - 1) * gap : 320 * u;
    y += gridH;
    L.grid = g;

    // ---- Footer
    L.footFont = font(600, 26 * u);
    L.footLH = 36 * u;
    ctx.font = L.footFont;
    var contact = String(s.contact || '').trim();
    L.footLines = contact ? wrapLines(ctx, contact, W - 2 * pad, 3) : [];
    if (L.footLines.length) {
      y += 30 * u;
      L.dividerY = y;
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

    // Background
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.bg);
    bg.addColorStop(1, theme.bg2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Mode pill
    var pillY = L.headerY + (L.row1H - L.pillH) / 2;
    ctx.fillStyle = mode.color;
    roundRect(ctx, pad, pillY, L.pillW, L.pillH, 16 * u);
    ctx.fill();
    ctx.fillStyle = readableOn(mode.color);
    ctx.font = L.pillFont;
    ctx.textAlign = 'center';
    ctx.fillText(s.mode || 'WTS', pad + L.pillW / 2, pillY + L.pillH / 2 + 1 * u);

    // Title
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = L.titleFont;
    var titleTop = L.headerY + (L.row1H - L.titleLines.length * L.titleLH) / 2;
    L.titleLines.forEach(function (line, i) {
      ctx.fillText(line, L.titleX, titleTop + L.titleLH * (i + 0.5));
    });

    // Page label
    if (L.pageLabel) {
      var px = W - pad - L.pageW;
      var py = L.headerY + (L.row1H - L.pageH) / 2;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 2.5 * u;
      roundRect(ctx, px, py, L.pageW, L.pageH, L.pageH / 2);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.font = L.pageFont;
      ctx.textAlign = 'center';
      ctx.fillText(L.pageLabel, px + L.pageW / 2, py + L.pageH / 2 + 1 * u);
      ctx.textAlign = 'left';
    }

    // Notes
    if (L.noteLines.length) {
      ctx.fillStyle = theme.muted;
      ctx.font = L.notesFont;
      L.noteLines.forEach(function (line, i) {
        ctx.fillText(line, pad, L.notesY + L.notesLH * (i + 0.5));
      });
    }

    // Grid
    var g = L.grid;
    if (!g.items.length) {
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 4 * u;
      ctx.setLineDash([18 * u, 14 * u]);
      roundRect(ctx, pad, g.y, W - 2 * pad, 320 * u, 24 * u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = theme.muted;
      ctx.font = font(600, 30 * u);
      ctx.textAlign = 'center';
      ctx.fillText('Add card images to fill the grid', W / 2, g.y + 160 * u);
      ctx.textAlign = 'left';
    }

    g.items.forEach(function (it, idx) {
      var col = idx % g.cols;
      var row = Math.floor(idx / g.cols);
      var x = pad + col * (g.cw + g.gap);
      var y = g.y + row * (g.cellH + g.gap);
      drawCell(ctx, it, x, y, g, s, theme, accent, mode, opts.images, u);
    });

    // Footer
    if (L.footLines.length) {
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(pad, L.dividerY);
      ctx.lineTo(W - pad, L.dividerY);
      ctx.stroke();
      ctx.fillStyle = theme.text;
      ctx.font = L.footFont;
      ctx.textAlign = 'center';
      L.footLines.forEach(function (line, i) {
        ctx.fillText(line, W / 2, L.footY + L.footLH * (i + 0.5));
      });
      ctx.textAlign = 'left';
    }

    return { width: W, height: H };
  }

  function drawCell(ctx, it, x, y, g, s, theme, accent, mode, images, u) {
    var card = it.card;
    var cs = g.cs, ip = g.ip;

    // Panel
    ctx.fillStyle = theme.panel;
    roundRect(ctx, x, y, g.cw, g.cellH, cs * 0.05);
    ctx.fill();

    // Picture
    var ix = x + ip, iy = y + ip;
    var radius = g.imgW * 0.045;
    ctx.save();
    roundRect(ctx, ix, iy, g.imgW, g.imgH, radius);
    ctx.clip();
    ctx.fillStyle = theme.imgBg;
    ctx.fillRect(ix, iy, g.imgW, g.imgH);
    var img = images && images.get(card.id);
    if (img) {
      drawImageFit(ctx, img, card.rotation, ix, iy, g.imgW, g.imgH, s.fit);
    } else {
      ctx.fillStyle = theme.muted;
      ctx.font = font(600, cs * 0.06);
      ctx.textAlign = 'center';
      ctx.fillText('No image', ix + g.imgW / 2, iy + g.imgH / 2);
      ctx.textAlign = 'left';
    }

    if (card.sold) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ix, iy, g.imgW, g.imgH);
      var stamp = mode.stamp;
      ctx.save();
      ctx.translate(ix + g.imgW / 2, iy + g.imgH / 2);
      ctx.rotate(-0.3);
      var fs = g.imgW * 0.17;
      ctx.font = font(900, fs);
      var sw = Math.min(ctx.measureText(stamp).width + fs * 0.8, g.imgW * 1.05);
      var sh = fs * 1.45;
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      roundRect(ctx, -sw / 2, -sh / 2, sw, sh, fs * 0.2);
      ctx.fill();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = fs * 0.12;
      roundRect(ctx, -sw / 2 + fs * 0.12, -sh / 2 + fs * 0.12, sw - fs * 0.24, sh - fs * 0.24, fs * 0.12);
      ctx.stroke();
      ctx.fillStyle = '#dc2626';
      ctx.textAlign = 'center';
      ctx.fillText(stamp, 0, fs * 0.05, sw - fs * 0.5);
      ctx.restore();
    }
    ctx.restore();

    // Info: name and note flow from the top, the price row sits at the bottom
    // so prices line up across a row even when names wrap differently.
    var ty = iy + g.imgH + ip * 0.9;
    ctx.textAlign = 'left';
    if (it.nameLines.length) {
      ctx.fillStyle = theme.text;
      ctx.font = g.nameFont;
      it.nameLines.forEach(function (line, i) {
        ctx.fillText(line, ix, ty + g.nameLH * (i + 0.5));
      });
      ty += it.nameLines.length * g.nameLH;
    }
    if (it.note) {
      ctx.fillStyle = theme.muted;
      ctx.font = g.noteFont;
      ctx.fillText(it.note, ix, ty + g.noteLH / 2);
    }
    if (g.hasRow) {
      var cy = y + g.cellH - ip - g.rowH / 2;
      var right = ix + g.imgW;

      var priceW = 0;
      if (it.price) {
        ctx.font = g.priceFont;
        var price = ellipsize(ctx, it.price, g.imgW);
        priceW = ctx.measureText(price).width;
        ctx.fillStyle = accent;
        ctx.textAlign = 'right';
        ctx.fillText(price, right, cy + 1 * u);
        ctx.textAlign = 'left';
      }

      var leftMax = g.imgW - priceW - (priceW ? cs * 0.04 : 0);
      var lx = ix;
      if (it.rarity && leftMax > cs * 0.12) {
        ctx.font = g.badgeFont;
        var bp = cs * 0.03;
        var label = ellipsize(ctx, it.rarity, Math.max(0, leftMax - 2 * bp));
        if (label) {
          var bw = ctx.measureText(label).width + 2 * bp;
          var bh = g.rowH * 0.74;
          ctx.fillStyle = rarityColor(it.rarity);
          roundRect(ctx, lx, cy - bh / 2, bw, bh, bh * 0.28);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, lx + bp, cy + 1 * u);
          lx += bw + cs * 0.03;
        }
      }
      if (it.qty) {
        ctx.font = g.qtyFont;
        if (lx + ctx.measureText(it.qty).width <= ix + leftMax) {
          ctx.fillStyle = theme.text;
          ctx.fillText(it.qty, lx, cy + 1 * u);
        }
      }
    }
  }

  global.GridRenderer = {
    THEMES: THEMES,
    MODES: MODES,
    SHAPES: SHAPES,
    autoColumns: autoColumns,
    computeLayout: computeLayout,
    drawPage: drawPage,
    formatPrice: formatPrice,
    rarityColor: rarityColor
  };
})(window);
