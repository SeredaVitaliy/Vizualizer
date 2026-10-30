/* Конструктор вёрстки: меню на скобе и афиши в нескольких форматах. Единицы — миллиметры. */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const DESK = window.desktop || null;
  const MM2PT = 72 / 25.4;
  const FORMATS = [
    { id: 'A6', label: 'A6 · 105×148', w: 105, h: 148 }, { id: 'A5', label: 'A5 · 148×210', w: 148, h: 210 },
    { id: 'A4', label: 'A4 · 210×297', w: 210, h: 297 }, { id: 'A3', label: 'A3 · 297×420', w: 297, h: 420 },
    { id: 'A2', label: 'A2 · 420×594', w: 420, h: 594 }, { id: 'A1', label: 'A1 · 594×841', w: 594, h: 841 },
    { id: 'EURO', label: 'Евро · 99×210', w: 99, h: 210 }, { id: 'SQ', label: 'Квадрат · 210×210', w: 210, h: 210 },
    { id: 'B2', label: 'Плакат · 500×700', w: 500, h: 700 }, { id: 'CUSTOM', label: 'Свой размер…', w: 0, h: 0 }
  ];
  const fmtById = (id) => FORMATS.find(f => f.id === id);
  let toastT = 0;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
  function busy(t, s) { $('busy').hidden = false; $('busyTitle').textContent = t; $('busyText').textContent = s || ''; }
  function idle() { $('busy').hidden = true; }
  const uid = (p) => (p || 'e') + Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const r2 = (v) => Math.round(v * 100) / 100;

  /* ================= состояние ================= */
  let doc = null;            // {type, name, bleed, safe, format?, pages?, variants?}
  const assets = {};         // id -> {id, kind:'img'|'svg'|'pdf', mime, bytes, pw, ph, url, name, bitmap?}
  let cur = 0;               // активная страница/формат
  let selId = null;
  let zoom = 'fit', preview = false, overview = false;
  const undoStack = [], redoStack = [];

  const surfaces = () => doc.type === 'booklet'
    ? doc.pages.map((p, i) => ({ id: p.id, w: doc.format.w, h: doc.format.h, els: p.els, label: pageLabel(i) }))
    : doc.variants.map(v => ({ id: v.id, w: v.format.w, h: v.format.h, els: v.els, label: v.format.label || (v.format.w + '×' + v.format.h) }));
  const surf = (i) => surfaces()[i == null ? cur : i];
  function pageLabel(i) { const n = doc.pages.length; return i === 0 ? 'Обложка' : i === n - 1 ? 'Задняя обложка' : 'Стр. ' + (i + 1); }
  function findEl(id) { for (const [si, s] of surfaces().entries()) { const e = s.els.find(x => x.id === id); if (e) return { el: e, si, s }; } return null; }

  function snapshot() { return JSON.stringify({ doc, cur, selId }); }
  function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; updUndo(); }
  function restore(s) { const o = JSON.parse(s); doc = o.doc; cur = Math.min(o.cur, surfaces().length - 1); selId = o.selId; renderAll(); }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updUndo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updUndo(); }
  function updUndo() { $('bUndo').disabled = !undoStack.length; $('bRedo').disabled = !redoStack.length; }

  /* ================= шрифты ================= */
  let localFonts = [];       // FontData из системы
  const families = new Map(); // family -> [faces]
  const faceAlias = new Map(); // postscriptName -> css alias
  async function loadFonts() {
    try {
      if (window.queryLocalFonts) localFonts = await window.queryLocalFonts();
    } catch (e) { console.warn('fonts', e); }
    localFonts.forEach(f => { if (!families.has(f.family)) families.set(f.family, []); families.get(f.family).push(f); });
    if (!families.size) ['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Segoe UI'].forEach(n => families.set(n, [{ family: n, style: 'Regular', fullName: n, postscriptName: '', fake: true }]));
    const sel = $('tFamily'); sel.innerHTML = [...families.keys()].sort((a, b) => a.localeCompare(b)).map(f => '<option>' + esc(f) + '</option>').join('');
  }
  function defaultFace() {
    for (const n of ['Arial', 'Segoe UI', 'Roboto', 'Helvetica', 'Liberation Sans', 'DejaVu Sans']) {
      const fs = families.get(n); if (fs) return faceInfo(fs.find(f => /^(regular|normal|book)$/i.test(f.style)) || fs[0]);
    }
    const first = families.values().next().value; return faceInfo(first[0]);
  }
  function faceInfo(f) { return { family: f.family, style: f.style, full: f.fullName, ps: f.postscriptName }; }
  async function ensureFace(face) {
    const key = face.ps || face.full || face.family;
    if (faceAlias.has(key)) return faceAlias.get(key);
    const alias = 'F_' + key.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40) + '_' + faceAlias.size;
    let ok = false;
    try {
      const srcs = [face.full, face.ps].filter(Boolean).map(n => 'local("' + n.replace(/"/g, '') + '")').join(', ');
      if (srcs) { const ff = new FontFace(alias, srcs); await ff.load(); document.fonts.add(ff); ok = true; }
    } catch (e) { /* шрифт не найден по имени */ }
    const css = ok ? '"' + alias + '"' : '"' + face.family + '", sans-serif';
    faceAlias.set(key, css); return css;
  }

  /* ================= текст ================= */
  const measureCv = document.createElement('canvas').getContext('2d');
  const PX = 4; // пикселей на пункт при измерениях
  function layoutText(el, css) {
    const sizePx = el.size * PX;
    measureCv.font = sizePx + 'px ' + css;
    const maxW = el.w * MM2PT * PX;
    const lines = [];
    String(el.text || '').split('\n').forEach(par => {
      const words = par.split(/(\s+)/); let line = '';
      for (const wd of words) {
        const test = line + wd;
        if (line && measureCv.measureText(test.trimEnd()).width > maxW && wd.trim()) { lines.push(line.trimEnd()); line = wd.trimStart(); }
        else line = test;
      }
      lines.push(line.trimEnd());
    });
    const m = measureCv.measureText('Ёjgy');
    const asc = (m.fontBoundingBoxAscent || sizePx * 0.8) / PX, desc = (m.fontBoundingBoxDescent || sizePx * 0.2) / PX;
    const lh = el.lh * el.size;
    return { lines: lines.map(t => ({ t, w: measureCv.measureText(t).width / PX })), asc, desc, lh, heightPt: Math.max(1, lines.length) * lh };
  }
  function baselinePt(L, i) { return (L.lh - (L.asc + L.desc)) / 2 + L.asc + i * L.lh; }
  async function fitTextHeight(el) { const css = await ensureFace(el.font); const L = layoutText(el, css); el.h = r2(L.heightPt / MM2PT); return L; }
  async function drawTextTo(ctx, el, pxPerMm, ox, oy) {
    const css = await ensureFace(el.font), L = layoutText(el, css), k = pxPerMm / MM2PT;
    ctx.save(); ctx.globalAlpha = el.opacity == null ? 1 : el.opacity; ctx.fillStyle = el.color; ctx.font = (el.size * k) + 'px ' + css; ctx.textBaseline = 'alphabetic';
    const bw = el.w * MM2PT;
    L.lines.forEach((ln, i) => {
      let x = 0; if (el.align === 'center') x = (bw - ln.w) / 2; else if (el.align === 'right') x = bw - ln.w;
      ctx.fillText(ln.t, ox + x * k, oy + baselinePt(L, i) * k);
    });
    ctx.restore();
  }

  /* ================= файлы и ресурсы ================= */
  let pdfjs = null;
  async function pdfLib() { if (!pdfjs) { pdfjs = await import('../vendor/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.mjs'; } return pdfjs; }
  async function renderPdfPage(bytes, scale) {
    const lib = await pdfLib();
    const pdf = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false, cMapUrl: '../vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '../vendor/standard_fonts/', wasmUrl: '../vendor/wasm/' }).promise;
    const pg = await pdf.getPage(1); const vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
    return { canvas: c, wPt: vp1.width, hPt: vp1.height };
  }
  async function addAsset(bytes, name, mime) {
    const id = uid('a');
    const lower = (name || '').toLowerCase();
    const kind = /pdf/.test(mime) || lower.endsWith('.pdf') ? 'pdf' : /svg/.test(mime) || lower.endsWith('.svg') ? 'svg' : 'img';
    const a = { id, kind, mime: mime || (kind === 'pdf' ? 'application/pdf' : kind === 'svg' ? 'image/svg+xml' : 'image/png'), bytes: new Uint8Array(bytes), name };
    if (kind === 'pdf') {
      const r = await renderPdfPage(a.bytes, 150 / 72);
      a.pw = r.wPt; a.ph = r.hPt; a.unit = 'pt';
      a.url = URL.createObjectURL(await new Promise(res => r.canvas.toBlob(res, 'image/png')));
    } else {
      a.url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }));
      const img = new Image(); img.src = a.url; await img.decode().catch(() => {});
      a.pw = img.naturalWidth || 1000; a.ph = img.naturalHeight || 1000; a.unit = 'px';
      if (kind === 'svg') { a.unit = 'svg'; }
    }
    assets[id] = a; return a;
  }
  async function placeAsset(a, at) {
    const s = surf(), b = doc.bleed, sf = doc.safe;
    const ratio = a.pw / a.ph, pageR = s.w / s.h;
    let w, h, x, y;
    if (a.kind === 'pdf') { w = a.pw / MM2PT; h = a.ph / MM2PT; }
    if (a.kind === 'pdf' && Math.abs(w - s.w) < 2 && Math.abs(h - s.h) < 2) { x = 0; y = 0; }                   // PDF уже в размер страницы
    else if (a.kind === 'pdf' && Math.abs(w - (s.w + 2 * b)) < 2 && Math.abs(h - (s.h + 2 * b)) < 2) { x = -b; y = -b; } // PDF с вылетами
    else if (Math.abs(ratio / pageR - 1) < 0.06) { w = s.w + 2 * b; h = w / ratio; if (h < s.h + 2 * b) { h = s.h + 2 * b; w = h * ratio; } x = (s.w - w) / 2; y = (s.h - h) / 2; } // пропорции страницы — под обрез
    else { const aw = s.w - 2 * sf, ah = s.h - 2 * sf; w = aw; h = w / ratio; if (h > ah) { h = ah; w = h * ratio; } x = (s.w - w) / 2; y = (s.h - h) / 2; }
    if (at) { x = at.x - w / 2; y = at.y - h / 2; }
    const el = { id: uid(), type: 'image', asset: a.id, x: r2(x), y: r2(y), w: r2(w), h: r2(h), opacity: 1 };
    pushUndo(); s.els.push(el); selId = el.id; renderAll();
  }
  async function importFiles(list, at) {
    for (const f of list) {
      try { const a = await addAsset(f.bytes, f.name, f.type); await placeAsset(a, at); }
      catch (e) { toast('Не удалось открыть ' + f.name + ': ' + (e.message || e)); }
    }
  }

  /* ================= отрисовка страниц ================= */
  function scaleFor(stage) {
    if (zoom !== 'fit') return Number(zoom) * 96 / 25.4; // 100% — как на экране при 96 dpi
    const st = $('stage'), aw = st.clientWidth - 104, ah = st.clientHeight - 96, b = doc.bleed;
    if (overview && doc.type === 'poster') {
      const vs = surfaces(), totalW = vs.reduce((a, s) => a + s.w + 2 * b, 0), maxH = Math.max(...vs.map(s => s.h + 2 * b));
      return Math.max(0.3, Math.min((aw - 28 * (vs.length - 1)) / totalW, (ah - 30) / maxH));
    }
    const s = surf(); const w = doc.type === 'booklet' ? 2 * (s.w + b) : s.w + 2 * b;
    return Math.max(0.3, Math.min(aw / w, ah / (s.h + 2 * b)));
  }
  function pageEl(s, si, k, opts) {
    opts = opts || {};
    const b = doc.bleed, sf = doc.safe;
    // для разворота: у страницы вылет только с наружной стороны
    const padL = opts.side === 'right' ? 0 : b, padR = opts.side === 'left' ? 0 : b;
    const pg = document.createElement('div'); pg.className = 'pg'; pg.dataset.si = si;
    pg.style.width = (s.w + padL + padR) * k + 'px'; pg.style.height = (s.h + 2 * b) * k + 'px';
    const els = document.createElement('div'); els.className = 'els'; els.style.left = padL * k + 'px'; els.style.top = b * k + 'px'; els.style.width = s.w * k + 'px'; els.style.height = s.h * k + 'px';
    pg.append(els);
    s.els.forEach(e => els.append(elNode(e, k, opts.thumb)));
    if (!opts.thumb) {
      const ov = document.createElement('div'); ov.className = 'ov';
      const add = (cls, l, t, w, h) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px' }); ov.append(d); };
      const W = (s.w + padL + padR) * k, H = (s.h + 2 * b) * k;
      add('bl', 0, 0, W, b * k); add('bl', 0, H - b * k, W, b * k);
      if (padL) add('bl', 0, b * k, padL * k, s.h * k);
      if (padR) add('bl', W - padR * k, b * k, padR * k, s.h * k);
      add('trimline', padL * k - 1, b * k - 1, s.w * k + 2, s.h * k + 2);
      add('safeline', (padL + sf) * k, (b + sf) * k, (s.w - 2 * sf) * k, (s.h - 2 * sf) * k);
      pg.append(ov);
    }
    return pg;
  }
  const textCache = new Map();
  function elNode(e, k, thumb) {
    const d = document.createElement('div'); d.className = 'el ' + e.type; d.dataset.id = e.id;
    Object.assign(d.style, { left: e.x * k + 'px', top: e.y * k + 'px', width: e.w * k + 'px', height: e.h * k + 'px', opacity: e.opacity == null ? 1 : e.opacity });
    if (e.type === 'image') { const a = assets[e.asset]; const img = document.createElement('img'); img.draggable = false; if (a) img.src = a.url; d.append(img); }
    else if (e.type === 'rect') d.style.background = e.fill;
    else if (e.type === 'text') {
      const c = document.createElement('canvas'); const dpr = thumb ? 1 : Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.max(1, Math.ceil(e.w * k * dpr)); c.height = Math.max(1, Math.ceil(e.h * k * dpr)); d.append(c);
      d.style.opacity = 1;
      drawTextTo(c.getContext('2d'), Object.assign({}, e, { opacity: 1 }), k * dpr, 0, 0).then(() => { d.style.opacity = e.opacity == null ? 1 : e.opacity; });
    }
    return d;
  }
  function spreadOf(i) { // индексы страниц разворота, где лежит страница i
    const n = doc.pages.length;
    if (i === 0) return [null, 0];
    if (i === n - 1) return [n - 1, null];
    const left = i % 2 === 1 ? i : i - 1; return [left, left + 1];
  }
  function renderStage() {
    const sp = $('spread'); sp.innerHTML = ''; sp.classList.toggle('multi', overview && doc.type === 'poster');
    $('stage').classList.toggle('preview', preview);
    const k = scaleFor(); renderStage.k = k;
    if (doc.type === 'booklet') {
      const [l, r] = spreadOf(cur), all = surfaces();
      [[l, 'left'], [r, 'right']].forEach(([i, side]) => {
        if (i == null) { const blank = document.createElement('div'); blank.className = 'pg blank'; blank.style.width = (all[0].w + doc.bleed) * k + 'px'; blank.style.height = (all[0].h + 2 * doc.bleed) * k + 'px'; sp.append(blank); return; }
        const pe = pageEl(all[i], i, k, { side: (l != null && r != null) ? side : null });
        if (i === cur) pe.classList.add('active-surface');
        const num = document.createElement('div'); num.className = 'pnum'; num.textContent = all[i].label; num.style[side === 'left' ? 'left' : 'right'] = '8px'; pe.append(num);
        sp.append(pe);
      });
    } else if (overview) {
      surfaces().forEach((s, i) => {
        const col = document.createElement('div'); col.className = 'fmtcol';
        const pe = pageEl(s, i, k); if (i === cur) pe.classList.add('active-surface');
        const lb = document.createElement('div'); lb.className = 'fmtlabel'; lb.textContent = s.label;
        col.append(pe, lb); sp.append(col);
      });
    } else sp.append(pageEl(surf(), cur, k));
    drawSelection();
  }
  function nodeOf(id) { return document.querySelector('.spread .el[data-id="' + id + '"]'); }
  function drawSelection() {
    $$('.selbox').forEach(x => x.remove());
    if (!selId || preview) return;
    const n = nodeOf(selId); if (!n) return;
    const box = document.createElement('div'); box.className = 'selbox';
    Object.assign(box.style, { left: n.style.left, top: n.style.top, width: n.style.width, height: n.style.height });
    const f = findEl(selId);
    const hs = f && f.el.type === 'text' ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const pos = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };
    hs.forEach(h => { const d = document.createElement('div'); d.className = 'h ' + h; d.dataset.h = h; d.style.left = pos[h][0] + '%'; d.style.top = pos[h][1] + '%'; box.append(d); });
    n.parentElement.append(box);
  }

  /* ================= левая колонка ================= */
  function renderThumbs() {
    const box = $('thumbs'); box.innerHTML = '';
    const all = surfaces();
    if (doc.type === 'booklet') {
      $('leftTitle').textContent = 'Страницы · ' + all.length;
      $('pageHint').textContent = all.length % 4 ? 'Нужно кратно 4: сейчас ' + all.length : 'Кратно 4 — собирается на скобе';
      $('pageHint').style.color = all.length % 4 ? 'var(--warn)' : '';
      const spreads = [[null, 0]]; for (let i = 1; i < all.length - 1; i += 2) spreads.push([i, i + 1 < all.length - 1 ? i + 1 : null]); if (all.length > 1) spreads.push([all.length - 1, null]);
      spreads.forEach(pair => {
        const th = document.createElement('div'); th.className = 'th'; const has = pair.filter(x => x != null);
        th.setAttribute('aria-current', String(has.includes(cur)));
        const row = document.createElement('div'); row.className = 'pair';
        const k = 70 / (all[0].h + 2 * doc.bleed);
        pair.forEach(i => {
          if (i == null) { const sp = document.createElement('div'); sp.style.width = (all[0].w) * k + 'px'; row.append(sp); return; }
          const pe = pageEl(all[i], i, k, { thumb: true }); pe.style.cursor = 'pointer'; pe.onclick = (ev) => { ev.stopPropagation(); cur = i; selId = null; renderAll(); };
          if (i === cur) pe.style.outline = '2px solid var(--accent)';
          row.append(pe);
        });
        th.append(row);
        const lb = document.createElement('div'); lb.className = 'lbl'; lb.textContent = has.map(i => all[i].label).join(' · '); th.append(lb);
        th.onclick = () => { cur = has[0]; selId = null; renderAll(); };
        box.append(th);
      });
      $('leftFoot').innerHTML = '<button class="btn sm wide" id="addPages">+ 4 страницы</button><div class="row"><button class="btn sm" id="pgLeft" title="Переместить страницу левее">← Стр.</button><button class="btn sm" id="pgRight" title="Переместить страницу правее">Стр. →</button><button class="btn sm danger" id="pgDel" title="Удалить текущую страницу">Удалить</button></div>';
      $('addPages').onclick = () => { pushUndo(); const n = doc.pages.length; const add = [0, 1, 2, 3].map(() => ({ id: uid('p'), els: [] })); doc.pages.splice(n - 1, 0, ...add); renderAll(); toast('Добавлено 4 страницы перед задней обложкой'); };
      $('pgDel').onclick = () => { if (doc.pages.length <= 1) return; pushUndo(); doc.pages.splice(cur, 1); cur = Math.max(0, cur - 1); selId = null; renderAll(); if (doc.pages.length % 4) toast('Страниц ' + doc.pages.length + ' — для скобы нужно кратно 4'); };
      $('pgLeft').onclick = () => { if (cur <= 0) return; pushUndo(); const p = doc.pages.splice(cur, 1)[0]; doc.pages.splice(cur - 1, 0, p); cur--; renderAll(); };
      $('pgRight').onclick = () => { if (cur >= doc.pages.length - 1) return; pushUndo(); const p = doc.pages.splice(cur, 1)[0]; doc.pages.splice(cur + 1, 0, p); cur++; renderAll(); };
    } else {
      $('leftTitle').textContent = 'Форматы · ' + all.length; $('pageHint').textContent = 'Каждый формат можно подогнать отдельно'; $('pageHint').style.color = '';
      all.forEach((s, i) => {
        const th = document.createElement('div'); th.className = 'th'; th.setAttribute('aria-current', String(i === cur));
        const k = 110 / Math.max(s.w, s.h);
        th.append(pageEl(s, i, k, { thumb: true }));
        const lb = document.createElement('div'); lb.className = 'lbl'; lb.textContent = s.label; th.append(lb);
        if (all.length > 1) { const acts = document.createElement('div'); acts.className = 'acts'; acts.innerHTML = '<button title="Удалить формат">✕</button>'; acts.firstChild.onclick = (ev) => { ev.stopPropagation(); pushUndo(); doc.variants.splice(i, 1); cur = Math.min(cur, doc.variants.length - 1); selId = null; renderAll(); }; th.append(acts); }
        th.onclick = () => { cur = i; selId = null; renderAll(); };
        box.append(th);
      });
      $('leftFoot').innerHTML = '<select id="newFmt">' + FORMATS.filter(f => f.id !== 'CUSTOM').map(f => '<option value="' + f.id + '">' + f.label + '</option>').join('') + '</select><button class="btn sm wide" id="addFmt">+ Добавить формат</button><button class="btn sm wide" id="bOverview" aria-pressed="' + overview + '">Все форматы рядом</button>';
      $('addFmt').onclick = () => { const f = fmtById($('newFmt').value); addVariant({ id: f.id, label: f.label, w: f.w, h: f.h }); };
      $('bOverview').onclick = () => { overview = !overview; renderAll(); };
    }
  }
  function addVariant(f) {
    pushUndo();
    const src = doc.variants[cur];
    const els = adaptEls(src.els, src.format, f);
    doc.variants.push({ id: uid('v'), format: Object.assign({}, f), els });
    cur = doc.variants.length - 1; selId = null; renderAll();
    toast('Формат ' + f.label + ' добавлен. Элементы перенесены пропорционально — проверь и подгони.');
  }

  /* ================= перенос на другой формат ================= */
  function adaptEls(els, from, to) {
    const b = doc.bleed, s = Math.min(to.w / from.w, to.h / from.h);
    return els.map(e0 => {
      const e = clone(e0); e.id = uid();
      const full = e.x <= 1 && e.y <= 1 && e.x + e.w >= from.w - 1 && e.y + e.h >= from.h - 1;
      if (full && e.type === 'rect') { e.x = -b; e.y = -b; e.w = to.w + 2 * b; e.h = to.h + 2 * b; return e; }
      if (full && e.type === 'image') {
        const r = e.w / e.h; let w = to.w + 2 * b, h = w / r; if (h < to.h + 2 * b) { h = to.h + 2 * b; w = h * r; }
        e.w = r2(w); e.h = r2(h); e.x = r2((to.w - w) / 2); e.y = r2((to.h - h) / 2); return e;
      }
      const cx = (e.x + e.w / 2) / from.w * to.w, cy = (e.y + e.h / 2) / from.h * to.h;
      e.w = r2(e.w * s); e.h = r2(e.h * s); if (e.type === 'text') e.size = r2(e.size * s);
      e.x = r2(cx - e.w / 2); e.y = r2(cy - e.h / 2);
      return e;
    });
  }

  /* ================= выбор, перетаскивание, привязки ================= */
  let drag = null;
  $('stage').addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const h = ev.target.closest('.h'), elN = ev.target.closest('.el'), pg = ev.target.closest('.pg');
    if (pg && !pg.classList.contains('blank')) { const si = Number(pg.dataset.si); if (si !== cur && !h) { cur = si; } }
    if (h && selId) { startDrag(ev, selId, h.dataset.h); return; }
    if (elN) { selId = elN.dataset.id; const f = findEl(selId); if (f) cur = f.si; renderProps(); renderStage(); renderThumbs(); startDrag(ev, selId, null); return; }
    if (selId) { selId = null; renderProps(); drawSelection(); }
    if (pg) renderThumbs();
  });
  function startDrag(ev, id, handle) {
    const f = findEl(id); if (!f) return;
    drag = { id, handle, sx: ev.clientX, sy: ev.clientY, orig: clone(f.el), moved: false, s: f.s };
    $('stage').setPointerCapture(ev.pointerId);
  }
  function snapLines(s, excludeId) {
    const b = doc.bleed, sf = doc.safe;
    const xs = [0, s.w, s.w / 2, sf, s.w - sf, -b, s.w + b], ys = [0, s.h, s.h / 2, sf, s.h - sf, -b, s.h + b];
    s.els.forEach(e => { if (e.id === excludeId) return; xs.push(e.x, e.x + e.w, e.x + e.w / 2); ys.push(e.y, e.y + e.h, e.y + e.h / 2); });
    return { xs, ys };
  }
  $('stage').addEventListener('pointermove', ev => {
    const k = renderStage.k || 1;
    if (!drag) { const pg = ev.target.closest('.pg'); if (pg && !pg.classList.contains('blank')) { const r = pg.querySelector('.els').getBoundingClientRect(); $('cursorInfo').textContent = 'X ' + ((ev.clientX - r.left) / k).toFixed(1) + ' · Y ' + ((ev.clientY - r.top) / k).toFixed(1) + ' мм'; } return; }
    const dx = (ev.clientX - drag.sx) / k, dy = (ev.clientY - drag.sy) / k;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 0.5 / k * 3) return;
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    const f = findEl(drag.id); if (!f) return; const e = f.el, o = drag.orig;
    const tol = 6 / k, L = snapLines(drag.s, e.id); const guides = [];
    const snap = (val, list, axis) => { let best = null, bd = tol; list.forEach(v => { const d = Math.abs(v - val); if (d < bd) { bd = d; best = v; } }); if (best != null) guides.push([axis, best]); return best; };
    if (!drag.handle) {
      let x = o.x + dx, y = o.y + dy;
      if (!ev.altKey) {
        const cands = [[x, 0], [x + o.w, o.w], [x + o.w / 2, o.w / 2]]; for (const [v, off] of cands) { const s2 = snap(v, L.xs, 'x'); if (s2 != null) { x = s2 - off; break; } }
        const cy = [[y, 0], [y + o.h, o.h], [y + o.h / 2, o.h / 2]]; for (const [v, off] of cy) { const s2 = snap(v, L.ys, 'y'); if (s2 != null) { y = s2 - off; break; } }
      }
      e.x = r2(x); e.y = r2(y);
    } else {
      const hd = drag.handle, keep = (e.type !== 'rect') !== ev.shiftKey && hd.length === 2;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (hd.includes('w')) x0 = o.x + dx; if (hd.includes('e')) x1 = o.x + o.w + dx;
      if (hd.includes('n')) y0 = o.y + dy; if (hd.includes('s')) y1 = o.y + o.h + dy;
      if (!ev.altKey) { if (hd.includes('w')) { const s2 = snap(x0, L.xs, 'x'); if (s2 != null) x0 = s2; } if (hd.includes('e')) { const s2 = snap(x1, L.xs, 'x'); if (s2 != null) x1 = s2; } if (hd.includes('n')) { const s2 = snap(y0, L.ys, 'y'); if (s2 != null) y0 = s2; } if (hd.includes('s')) { const s2 = snap(y1, L.ys, 'y'); if (s2 != null) y1 = s2; } }
      let w = Math.max(2, x1 - x0), h = Math.max(2, y1 - y0);
      if (keep) { const r = o.w / o.h; if (w / h > r) w = h * r; else h = w / r; if (hd.includes('w')) x0 = o.x + o.w - w; if (hd.includes('n')) y0 = o.y + o.h - h; }
      if (e.type === 'text' && hd.length === 2) { e.size = r2(Math.max(4, o.size * w / o.w)); }
      e.x = r2(x0); e.y = r2(y0); e.w = r2(w); if (e.type !== 'text') e.h = r2(h); else e.h = r2(o.h * w / o.w);
    }
    const n = nodeOf(e.id);
    if (n) {
      Object.assign(n.style, { left: e.x * k + 'px', top: e.y * k + 'px', width: e.w * k + 'px', height: e.h * k + 'px' });
      if (e.type === 'text' && drag.handle) { const c = n.querySelector('canvas'); const dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(1, Math.ceil(e.w * k * dpr)); c.height = Math.max(1, Math.ceil(e.h * k * dpr)); drawTextTo(c.getContext('2d'), Object.assign({}, e, { opacity: 1 }), k * dpr, 0, 0); }
    }
    drawSelection(); showGuides(guides, n);
    fillXYWH(e);
  });
  function showGuides(gs, n) {
    $$('.guide').forEach(g => g.remove()); if (!n) return;
    const k = renderStage.k, host = n.parentElement;
    gs.forEach(([axis, v]) => { const g = document.createElement('div'); g.className = 'guide ' + (axis === 'x' ? 'v' : 'h2'); g.style[axis === 'x' ? 'left' : 'top'] = v * k + 'px'; host.append(g); });
  }
  $('stage').addEventListener('pointerup', async () => {
    if (!drag) return; const d = drag; drag = null; $$('.guide').forEach(g => g.remove());
    if (d.moved) { const f = findEl(d.id); if (f && f.el.type === 'text') await fitTextHeight(f.el); renderAll(); }
  });

  /* ================= свойства ================= */
  function fillXYWH(e) { $('pX').value = r2(e.x); $('pY').value = r2(e.y); $('pW').value = r2(e.w); $('pH').value = r2(e.h); }
  function renderProps() {
    const f = selId && findEl(selId);
    $('noSel').hidden = !!f; $('selProps').hidden = !f;
    if (!f) { renderDocInfo(); return; }
    const e = f.el;
    $('selTitle').textContent = { image: 'Картинка', text: 'Текст', rect: 'Плашка' }[e.type];
    fillXYWH(e); $('pH').disabled = e.type === 'text';
    $('pOpacity').value = Math.round((e.opacity == null ? 1 : e.opacity) * 100); $('oOpacity').textContent = $('pOpacity').value + '%';
    $('textProps').hidden = e.type !== 'text'; $('rectProps').hidden = e.type !== 'rect';
    $('fitBtns').querySelector('[data-fit="bleed"]').hidden = e.type === 'text';
    const di = $('dpiInfo'); di.hidden = true;
    if (e.type === 'image') {
      const a = assets[e.asset];
      if (a && a.unit === 'px') {
        const dpi = Math.round(a.pw / (e.w / 25.4)); di.hidden = false; di.className = 'dpi' + (dpi < 200 ? ' low' : '');
        di.textContent = dpi + ' dpi при печати' + (dpi < 200 ? ' — мало для печати, будет мыльно. Лучше 300 dpi: уменьши картинку или улучши качество во вкладке «Улучшить».' : dpi < 280 ? ' — нормально' : ' — отлично');
      } else if (a) { di.hidden = false; di.className = 'dpi'; di.textContent = a.kind === 'pdf' ? 'PDF — вставится в итоговый файл векторно, без потери качества.' : 'SVG — при экспорте в PDF растрируется в 600 dpi.'; }
    }
    if (e.type === 'text') {
      if (document.activeElement !== $('tText')) $('tText').value = e.text;
      $('tFamily').value = e.font.family; fillStyles(e.font.family, e.font.style);
      $('tSize').value = e.size; $('tLh').value = e.lh; $('tColor').value = e.color;
      $$('#tAlign button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === e.align)));
      $('fontHint').textContent = localFonts.length ? '' : 'Список шрифтов системы недоступен — в PDF текст будет картинкой 600 dpi.';
    }
    if (e.type === 'rect') $('rFill').value = e.fill;
  }
  function fillStyles(fam, style) {
    const faces = families.get(fam) || [];
    $('tStyle').innerHTML = faces.map(f => '<option>' + esc(f.style) + '</option>').join('');
    if (style) $('tStyle').value = style;
  }
  function renderDocInfo() {
    const all = surfaces();
    $('docInfo').innerHTML = doc.type === 'booklet'
      ? '<b>Меню на скобе</b><br>Формат страницы ' + doc.format.w + '×' + doc.format.h + ' мм, ' + all.length + ' стр.<br>В развороте ' + (doc.format.w * 2) + '×' + doc.format.h + ' мм. Вылет ' + doc.bleed + ' мм, поля ' + doc.safe + ' мм.'
      : '<b>Афиша</b><br>' + all.map(s => s.label).join(', ') + '<br>Вылет ' + doc.bleed + ' мм, поля ' + doc.safe + ' мм.';
  }
  function editSel(fn, noUndo) { const f = selId && findEl(selId); if (!f) return; if (!noUndo) pushUndo(); fn(f.el, f.s); }
  ['pX', 'pY', 'pW', 'pH'].forEach(id => $(id).addEventListener('change', () => editSel(async (e) => {
    const v = parseFloat($(id).value); if (!isFinite(v)) return;
    if (id === 'pX') e.x = v; if (id === 'pY') e.y = v;
    if (id === 'pW') { const r = e.w / e.h; e.w = Math.max(1, v); if (e.type === 'image') e.h = r2(e.w / r); }
    if (id === 'pH') { const r = e.w / e.h; e.h = Math.max(1, v); if (e.type === 'image') e.w = r2(e.h * r); }
    if (e.type === 'text') await fitTextHeight(e);
    renderAll();
  })));
  $('pOpacity').addEventListener('input', () => editSel(e => { e.opacity = $('pOpacity').value / 100; $('oOpacity').textContent = $('pOpacity').value + '%'; const n = nodeOf(e.id); if (n) n.style.opacity = e.opacity; }, true));
  $('pOpacity').addEventListener('change', () => { pushUndo(); renderThumbs(); });
  $('fitBtns').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    editSel(async (e, s) => {
      const bl = doc.bleed, sf = doc.safe, r = e.w / e.h;
      if (b.dataset.fit === 'bleed') { if (e.type === 'rect') { e.x = -bl; e.y = -bl; e.w = s.w + 2 * bl; e.h = s.h + 2 * bl; } else { let w = s.w + 2 * bl, h = w / r; if (h < s.h + 2 * bl) { h = s.h + 2 * bl; w = h * r; } e.w = r2(w); e.h = r2(h); e.x = r2((s.w - w) / 2); e.y = r2((s.h - h) / 2); } }
      else if (b.dataset.fit === 'safe') { const aw = s.w - 2 * sf, ah = s.h - 2 * sf; if (e.type === 'rect') { e.x = sf; e.y = sf; e.w = aw; e.h = ah; } else { let w = aw, h = w / r; if (e.type !== 'text' && h > ah) { h = ah; w = h * r; } e.w = r2(w); e.h = r2(h); e.x = r2((s.w - w) / 2); e.y = r2((s.h - h) / 2); if (e.type === 'text') await fitTextHeight(e); } }
      else { e.x = r2((s.w - e.w) / 2); e.y = r2((s.h - e.h) / 2); }
      renderAll();
    });
  });
  $('pUp').onclick = () => editSel((e, s) => { const i = s.els.indexOf(e); s.els.splice(i, 1); s.els.push(e); renderAll(); });
  $('pDown').onclick = () => editSel((e, s) => { const i = s.els.indexOf(e); s.els.splice(i, 1); s.els.unshift(e); renderAll(); });
  $('pDel').onclick = () => editSel((e, s) => { s.els.splice(s.els.indexOf(e), 1); selId = null; renderAll(); });
  $('pDup').onclick = () => editSel((e, s) => { const c = clone(e); c.id = uid(); c.x += 5; c.y += 5; s.els.push(c); selId = c.id; renderAll(); });
  $('pCopyAll').onclick = () => editSel((e, s) => {
    let n = 0;
    surfaces().forEach((t, i) => { if (t.id === s.id) return; const c = doc.type === 'poster' ? adaptEls([e], s, t)[0] : Object.assign(clone(e), { id: uid() }); t.els.push(c); n++; });
    renderAll(); toast('Скопировано на ' + n + (doc.type === 'poster' ? ' форматов' : ' страниц'));
  });
  let tTimer = 0;
  $('tText').addEventListener('input', () => { clearTimeout(tTimer); const v = $('tText').value; tTimer = setTimeout(() => editSel(async e => { e.text = v; await fitTextHeight(e); renderStage(); renderThumbs(); fillXYWH(e); }), 250); });
  $('tFamily').addEventListener('change', () => { fillStyles($('tFamily').value); applyFace(); });
  $('tStyle').addEventListener('change', applyFace);
  function applyFace() {
    const fam = $('tFamily').value, st = $('tStyle').value, faces = families.get(fam) || [];
    const f = faces.find(x => x.style === st) || faces[0]; if (!f) return;
    editSel(async e => { e.font = faceInfo(f); await fitTextHeight(e); renderAll(); });
  }
  ['tSize', 'tLh'].forEach(id => $(id).addEventListener('change', () => editSel(async e => { const v = parseFloat($(id).value); if (!isFinite(v)) return; if (id === 'tSize') e.size = Math.max(4, v); else e.lh = Math.max(0.7, v); await fitTextHeight(e); renderAll(); })));
  $('tColor').addEventListener('change', () => editSel(e => { e.color = $('tColor').value; renderAll(); }));
  $('tAlign').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) editSel(e => { e.align = b.dataset.a; renderAll(); }); });
  $('rFill').addEventListener('change', () => editSel(e => { e.fill = $('rFill').value; renderAll(); }));

  /* ================= добавление ================= */
  $('addImg').onclick = async () => { try { const f = await DESK.openFile('layout-asset'); if (f) await importFiles([f]); } catch (e) { toast(e.message); } };
  $('addText').onclick = async () => {
    const s = surf(), face = defaultFace();
    const el = { id: uid(), type: 'text', text: 'Заголовок', font: face, size: Math.round(Math.max(12, s.w / 8)), lh: 1.15, color: '#1a1a1a', align: 'center', x: doc.safe, y: s.h / 3, w: s.w - 2 * doc.safe, h: 20, opacity: 1 };
    await fitTextHeight(el); pushUndo(); s.els.push(el); selId = el.id; renderAll(); $('tText').focus(); $('tText').select();
  };
  $('addRect').onclick = () => { const s = surf(); const el = { id: uid(), type: 'rect', fill: '#f2e3c6', x: s.w * 0.15, y: s.h * 0.4, w: s.w * 0.7, h: s.h * 0.2, opacity: 1 }; pushUndo(); s.els.push(el); selId = el.id; renderAll(); };
  let depth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('drop').hidden = false; });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; $('drop').hidden = true; if (!doc) return;
    const pg = e.target.closest && e.target.closest('.pg'); let at = null;
    if (pg && !pg.classList.contains('blank')) { cur = Number(pg.dataset.si); const r = pg.querySelector('.els').getBoundingClientRect(), k = renderStage.k; at = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; }
    const files = await Promise.all(Array.from(e.dataTransfer.files).map(async f => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })));
    await importFiles(files, files.length === 1 ? at : null);
  });
  const pendingAdds = [];
  window.addEventListener('message', async e => {
    const d = e.data; if (!d || d.type !== 'layout-add' || !d.bytes) return;
    const f = { name: d.name, type: d.mime, bytes: d.bytes };
    if (doc) await importFiles([f]); else { pendingAdds.push(f); toast('Картинка подождёт: выбери, что верстаем, и она появится на первой странице'); }
  });
  async function flushPending() { if (pendingAdds.length) await importFiles(pendingAdds.splice(0)); }

  /* ================= формат документа ================= */
  function renderFormatBar() {
    const s = surf(), f = doc.type === 'booklet' ? doc.format : doc.variants[cur].format;
    const sel = $('fmtSel');
    sel.innerHTML = FORMATS.map(x => '<option value="' + x.id + '">' + x.label + '</option>').join('');
    const match = FORMATS.find(x => x.id !== 'CUSTOM' && ((x.w === f.w && x.h === f.h) || (x.w === f.h && x.h === f.w)));
    sel.value = match ? match.id : 'CUSTOM';
    $('customWH').hidden = !!match; $('cW').value = s.w; $('cH').value = s.h;
    $('bleed').value = doc.bleed; $('safe').value = doc.safe;
    $('xImposed').hidden = doc.type !== 'booklet';
    sel.title = doc.type === 'booklet' ? 'Формат всех страниц' : 'Формат выбранного варианта';
  }
  function setFormat(w, h, id, label) {
    pushUndo();
    if (doc.type === 'booklet') { const from = doc.format, to = { w, h }; doc.pages.forEach(p => { p.els = adaptEls(p.els, from, to); }); doc.format = { id, w, h }; }
    else { const v = doc.variants[cur]; v.els = adaptEls(v.els, v.format, { w, h }); v.format = { id, w, h, label: label || (w + '×' + h) }; }
    selId = null; renderAll();
  }
  $('fmtSel').addEventListener('change', () => {
    const f = fmtById($('fmtSel').value);
    if (f.id === 'CUSTOM') { $('customWH').hidden = false; return; }
    const s = surf(), land = s.w > s.h;
    setFormat(land ? f.h : f.w, land ? f.w : f.h, f.id, f.label + (land ? ' альбом' : ''));
  });
  ['cW', 'cH'].forEach(id => $(id).addEventListener('change', () => { const w = parseFloat($('cW').value), h = parseFloat($('cH').value); if (w >= 20 && h >= 20) setFormat(w, h, 'CUSTOM', w + '×' + h + ' мм'); }));
  $('bOrient').onclick = () => { const s = surf(); const f = doc.type === 'booklet' ? doc.format : doc.variants[cur].format; setFormat(s.h, s.w, f.id, (f.label || '').replace(/ альбом$/, '') + (s.h > s.w ? ' альбом' : '')); };
  $('bleed').addEventListener('change', () => { const v = Math.max(0, Math.min(10, parseFloat($('bleed').value) || 0)); pushUndo(); doc.bleed = v; renderAll(); });
  $('safe').addEventListener('change', () => { const v = Math.max(0, Math.min(30, parseFloat($('safe').value) || 0)); pushUndo(); doc.safe = v; renderAll(); });
  $('docName').addEventListener('change', () => { doc.name = $('docName').value.trim() || 'Без названия'; });

  /* ================= вид ================= */
  $('zoomSeg').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; zoom = b.dataset.z; $$('#zoomSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); renderStage(); });
  $('bPreview').onclick = () => { preview = !preview; $('bPreview').setAttribute('aria-pressed', String(preview)); renderStage(); };
  window.addEventListener('resize', () => { if (doc) renderStage(); });
  $('bUndo').onclick = undo; $('bRedo').onclick = redo;
  window.addEventListener('keydown', ev => {
    if (!doc) return;
    const t = ev.target; if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key.toLowerCase();
    if (mod && (k === 'z' || k === 'я')) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
    if (mod && (k === 'y' || k === 'н')) { ev.preventDefault(); redo(); return; }
    if (mod && (k === 'd' || k === 'в')) { ev.preventDefault(); $('pDup').click(); return; }
    if (!selId) return;
    if (k === 'delete' || k === 'backspace') { ev.preventDefault(); $('pDel').click(); return; }
    const step = ev.shiftKey ? 10 : 1, mv = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k];
    if (mv) { ev.preventDefault(); editSel(e => { e.x = r2(e.x + mv[0]); e.y = r2(e.y + mv[1]); renderAll(); }); }
  });
  function renderAll() { renderFormatBar(); renderStage(); renderThumbs(); renderProps(); updUndo(); $('docName').value = doc.name; }

  /* ================= экспорт ================= */
  $('bExport').onclick = (e) => { e.stopPropagation(); $('exportMenu').hidden = !$('exportMenu').hidden; };
  document.addEventListener('click', () => { $('exportMenu').hidden = true; });
  $('exportMenu').addEventListener('click', ev => { const b = ev.target.closest('button[data-x]'); if (!b) return; $('exportMenu').hidden = true; if (b.dataset.x === 'print') openPrint(); else doExport(b.dataset.x); });
  const fontBytes = new Map();
  async function fontFileBytes(face) {
    const key = face.ps || face.full;
    if (fontBytes.has(key)) return fontBytes.get(key);
    const fd = localFonts.find(f => (face.ps && f.postscriptName === face.ps) || f.fullName === face.full);
    const b = fd ? new Uint8Array(await (await fd.blob()).arrayBuffer()) : null;
    fontBytes.set(key, b); return b;
  }
  async function rasterOf(a, wMm, hMm, dpi) {
    const pxW = Math.max(1, Math.round(wMm / 25.4 * dpi)), pxH = Math.max(1, Math.round(hMm / 25.4 * dpi));
    const c = document.createElement('canvas'); c.width = pxW; c.height = pxH;
    if (a.kind === 'pdf') { const r = await renderPdfPage(a.bytes, pxW / a.pw); c.getContext('2d').drawImage(r.canvas, 0, 0, pxW, pxH); }
    else { const img = new Image(); img.src = a.url; await img.decode(); c.getContext('2d').drawImage(img, 0, 0, pxW, pxH); }
    return c;
  }
  const canvasPng = (c) => new Promise(res => c.toBlob(b => b.arrayBuffer().then(x => res(new Uint8Array(x))), 'image/png'));
  async function buildPdf(mode) {
    const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = PDFLib;
    const pdf = await PDFDocument.create(); pdf.registerFontkit(window.fontkit);
    pdf.setTitle(doc.name); pdf.setCreator('Студия'); pdf.setProducer('Студия');
    const imgCache = new Map(), pdfCache = new Map(), fontCache = new Map();
    const warn = new Set();
    async function embedAsset(a, e) {
      if (a.kind === 'pdf') { if (!pdfCache.has(a.id)) { const [p] = await pdf.embedPdf(a.bytes, [0]); pdfCache.set(a.id, p); } return { pdfPage: pdfCache.get(a.id) }; }
      if (a.kind === 'svg') { const key = a.id + '@' + e.w + 'x' + e.h; if (!imgCache.has(key)) imgCache.set(key, await pdf.embedPng(await canvasPng(await rasterOf(a, e.w, e.h, 600)))); return { img: imgCache.get(key) }; }
      if (!imgCache.has(a.id)) {
        let im;
        if (/jpe?g/.test(a.mime)) im = await pdf.embedJpg(a.bytes);
        else if (/png/.test(a.mime)) im = await pdf.embedPng(a.bytes);
        else { const img = new Image(); img.src = a.url; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); im = await pdf.embedPng(await canvasPng(c)); }
        imgCache.set(a.id, im);
      }
      return { img: imgCache.get(a.id) };
    }
    async function embedFont(face) {
      const key = face.ps || face.full;
      if (fontCache.has(key)) return fontCache.get(key);
      let f = null; const bytes = await fontFileBytes(face);
      if (bytes) { try { f = await pdf.embedFont(bytes, { subset: true }); } catch (e1) { try { f = await pdf.embedFont(bytes, { subset: false }); } catch (e2) { f = null; } } }
      fontCache.set(key, f); return f;
    }
    // рисуем поверхность: trimL/trimT — левый верхний угол линии реза в координатах PDF (пункты, ось Y вверх)
    async function drawSurface(page, s, trimL, trimT, clipR) {
      page.pushOperators(pushGraphicsState(), rectangle(clipR.x, clipR.y, clipR.w, clipR.h), clip(), endPath());
      for (const e of s.els) {
        const x = trimL + e.x * MM2PT, w = e.w * MM2PT, h = e.h * MM2PT, y = trimT - e.y * MM2PT - h, op = e.opacity == null ? 1 : e.opacity;
        if (e.type === 'rect') { const c = hexRgb(e.fill); page.drawRectangle({ x, y, width: w, height: h, color: rgb(c[0], c[1], c[2]), opacity: op, borderWidth: 0 }); }
        else if (e.type === 'image') {
          const a = assets[e.asset]; if (!a) continue;
          const em = await embedAsset(a, e);
          if (em.pdfPage) page.drawPage(em.pdfPage, { x, y, width: w, height: h, opacity: op });
          else page.drawImage(em.img, { x, y, width: w, height: h, opacity: op });
        } else if (e.type === 'text') {
          const css = await ensureFace(e.font), L = layoutText(e, css), font = await embedFont(e.font);
          let ok = !!font;
          if (ok) {
            try {
              const c = hexRgb(e.color);
              L.lines.forEach((ln, i) => {
                if (!ln.t) return;
                const tw = font.widthOfTextAtSize(ln.t, e.size);
                let tx = x; if (e.align === 'center') tx = x + (w - tw) / 2; else if (e.align === 'right') tx = x + w - tw;
                page.drawText(ln.t, { x: tx, y: trimT - e.y * MM2PT - baselinePt(L, i), size: e.size, font, color: rgb(c[0], c[1], c[2]), opacity: op });
              });
            } catch (err) { ok = false; }
          }
          if (!ok) {
            warn.add(e.font.family);
            const dpi = 600, c = document.createElement('canvas'); c.width = Math.ceil(e.w / 25.4 * dpi); c.height = Math.ceil(e.h / 25.4 * dpi);
            await drawTextTo(c.getContext('2d'), Object.assign({}, e, { opacity: 1 }), dpi / 25.4, 0, 0);
            page.drawImage(await pdf.embedPng(await canvasPng(c)), { x, y, width: w, height: h, opacity: op });
          }
        }
      }
      page.pushOperators(popGraphicsState());
    }
    function marks(page, tl, tt, tw, th, off) {
      const len = 5 * MM2PT, gap = off, col = PDFLib.rgb(0, 0, 0), t = 0.3;
      const xs = [tl, tl + tw], ys = [tt, tt - th];
      xs.forEach(x => ys.forEach(y => {
        const sy = y === tt ? 1 : -1, sx = x === tl ? -1 : 1;
        page.drawLine({ start: { x, y: y + sy * gap }, end: { x, y: y + sy * (gap + len) }, thickness: t, color: col });
        page.drawLine({ start: { x: x + sx * gap, y }, end: { x: x + sx * (gap + len), y }, thickness: t, color: col });
      }));
    }
    const b = doc.bleed * MM2PT, all = surfaces();
    if (mode === 'pdf-imposed') {
      const n = all.length, W = all[0].w * MM2PT, H = all[0].h * MM2PT, M = 10 * MM2PT;
      if (n % 4) throw new Error('Для спуска полос нужно число страниц, кратное 4 (сейчас ' + n + ')');
      for (let k = 0; k < n / 4; k++) {
        const sides = [[n - 1 - 2 * k, 2 * k], [2 * k + 1, n - 2 - 2 * k]];
        for (const [li, ri] of sides) {
          const pw = 2 * W + 2 * b + 2 * M, ph = H + 2 * b + 2 * M, page = pdf.addPage([pw, ph]);
          const tl = M + b, tt = ph - M - b;
          await drawSurface(page, all[li], tl, tt, { x: M, y: M, w: W + b, h: H + 2 * b });
          await drawSurface(page, all[ri], tl + W, tt, { x: M + b + W, y: M, w: W + b, h: H + 2 * b });
          marks(page, tl, tt, 2 * W, H, b + 2);
          const fx = tl + W; page.drawLine({ start: { x: fx, y: tt + b + 2 }, end: { x: fx, y: tt + b + 2 + 5 * MM2PT }, thickness: 0.3, color: PDFLib.rgb(0, 0, 0), dashArray: [2, 2] });
          page.drawLine({ start: { x: fx, y: tt - H - b - 2 }, end: { x: fx, y: tt - H - b - 2 - 5 * MM2PT }, thickness: 0.3, color: PDFLib.rgb(0, 0, 0), dashArray: [2, 2] });
          page.setTrimBox(tl, tt - H, 2 * W, H); page.setBleedBox(tl - b, tt - H - b, 2 * W + 2 * b, H + 2 * b);
        }
      }
    } else {
      const M = mode === 'pdf-marks' ? 10 * MM2PT : 0;
      for (const s of all) {
        const W = s.w * MM2PT, H = s.h * MM2PT, pw = W + 2 * b + 2 * M, ph = H + 2 * b + 2 * M, page = pdf.addPage([pw, ph]);
        await drawSurface(page, s, M + b, ph - M - b, { x: M, y: M, w: W + 2 * b, h: H + 2 * b });
        page.setTrimBox(M + b, M + b, W, H); page.setBleedBox(M, M, W + 2 * b, H + 2 * b);
        if (M) marks(page, M + b, ph - M - b, W, H, b + 2);
      }
    }
    return { bytes: await pdf.save(), warn };
  }
  // bl — вылеты по сторонам {l,t,r,b} в мм (для печати); без него — по линии реза
  async function renderCanvas(s, dpi, bl) {
    bl = bl || { l: 0, t: 0, r: 0, b: 0 };
    const pxmm = dpi / 25.4, c = document.createElement('canvas'); c.width = Math.max(1, Math.round((s.w + bl.l + bl.r) * pxmm)); c.height = Math.max(1, Math.round((s.h + bl.t + bl.b) * pxmm));
    const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    const ox = bl.l * pxmm, oy = bl.t * pxmm;
    for (const e of s.els) {
      g.save(); g.globalAlpha = e.opacity == null ? 1 : e.opacity;
      if (e.type === 'rect') { g.fillStyle = e.fill; g.fillRect(ox + e.x * pxmm, oy + e.y * pxmm, e.w * pxmm, e.h * pxmm); }
      else if (e.type === 'image') { const a = assets[e.asset]; if (a) { const r = a.kind === 'pdf' ? await rasterOf(a, e.w, e.h, dpi) : await (async () => { const im = new Image(); im.src = a.url; await im.decode(); return im; })(); g.drawImage(r, ox + e.x * pxmm, oy + e.y * pxmm, e.w * pxmm, e.h * pxmm); } }
      else if (e.type === 'text') { g.restore(); await drawTextTo(g, e, pxmm, ox + e.x * pxmm, oy + e.y * pxmm); continue; }
      g.restore();
    }
    return c;
  }
  async function renderPng(s, dpi) { return canvasPng(await renderCanvas(s, dpi)); }
  async function doExport(kind) {
    if (!doc) return;
    const safeName = (doc.name || 'maket').replace(/[\\/:*?"<>|]+/g, '_');
    try {
      if (kind === 'png') {
        busy('Готовлю PNG…', '300 dpi, по линии реза');
        const files = []; const all = surfaces();
        for (let i = 0; i < all.length; i++) files.push({ name: safeName + '-' + (doc.type === 'booklet' ? 'str' + (i + 1) : all[i].label.replace(/[^\wА-Яа-я×.-]+/g, '_')) + '.png', data: await renderPng(all[i], 300) });
        idle();
        const r = files.length === 1 ? await DESK.save(files[0].name, files[0].data) : await DESK.saveMany(files);
        if (r && !r.canceled) toast('Сохранено: ' + r.path);
        return;
      }
      if (kind === 'pdf-imposed' && doc.pages.length % 4) { toast('Для печати на скобе нужно кратно 4 страниц. Сейчас ' + doc.pages.length + '.'); return; }
      busy('Готовлю PDF…', kind === 'pdf-imposed' ? 'Раскладываю страницы для печати с двух сторон' : 'Встраиваю картинки и шрифты');
      const { bytes, warn } = await buildPdf(kind);
      idle();
      const suffix = kind === 'pdf-imposed' ? '-dlya-pechati' : kind === 'pdf-marks' ? '-s-metkami' : '';
      const r = await DESK.save(safeName + suffix + '.pdf', bytes);
      if (r && !r.canceled) toast('Сохранено: ' + r.path + (warn.size ? '. Шрифт ' + [...warn].join(', ') + ' вставлен картинкой 600 dpi' : '') + (kind === 'pdf-imposed' ? '. Печать: двусторонняя, переворот по короткому краю' : ''));
    } catch (e) { idle(); toast('Не получилось: ' + (e.message || e)); console.error(e); }
  }

  /* ================= печать на принтере ================= */
  // Листы собираются здесь: страницы рисуются картинками (250 dpi), метки реза — векторными линиями.
  const PAPERS = { A4: [210, 297], A3: [297, 420] };
  function prOpts() {
    const what = $$('#prWhat button[aria-pressed="true"]')[0];
    return { what: what ? what.dataset.v : 'pages', paper: $$('#prPaper button[aria-pressed="true"]')[0].dataset.v, scale: $$('#prScale button[aria-pressed="true"]')[0].dataset.v, marks: $('prMarks').checked };
  }
  // раскладка: список листов, на каждом — страницы с положением в мм
  function printPlan(o) {
    const all = surfaces(), b = o.marks ? doc.bleed : 0, pad = o.marks ? b + 8 : 0; // место под метки
    const groups = []; // [{pages:[{si, side}] , w, h}]
    if (o.what === 'booklet') {
      const n = all.length;
      for (let k = 0; k < n / 4; k++) [[n - 1 - 2 * k, 2 * k], [2 * k + 1, n - 2 - 2 * k]].forEach(([l, r]) => groups.push({ pages: [{ si: l, dx: 0, side: 'L' }, { si: r, dx: all[0].w, side: 'R' }], w: all[0].w * 2, h: all[0].h, fold: true }));
    } else {
      const idx = o.what === 'current' ? [cur] : all.map((_, i) => i);
      idx.forEach(i => groups.push({ pages: [{ si: i, dx: 0, side: 'S' }], w: all[i].w, h: all[i].h }));
    }
    const [pa, pb] = PAPERS[o.paper], M = 5;
    let minK = Infinity, tight = false;
    const sheets = groups.map(g => {
      // kt — во сколько раз страница помещается на лист целиком (без полей), kp — с полями и местом под метки
      const need = (land) => { const pw = land ? pb : pa, ph = land ? pa : pb; return { pw, ph, kt: Math.min(pw / g.w, ph / g.h), kp: Math.min((pw - 2 * M) / (g.w + 2 * pad), (ph - 2 * M) / (g.h + 2 * pad)) }; };
      const P = need(false), L = need(true);
      let best, k;
      if (o.scale === 'real') { best = L.kt > P.kt ? L : P; if (best.kt >= 1) k = 1; else { best = L.kp > P.kp ? L : P; k = Math.min(1, best.kp); } }
      else { best = L.kp > P.kp ? L : P; k = best.kp; }
      minK = Math.min(minK, k);
      const W = g.w * k, H = g.h * k, x0 = (best.pw - W) / 2, y0 = (best.ph - H) / 2;
      if (x0 < M - 0.01 || y0 < M - 0.01) tight = true;
      return { pw: best.pw, ph: best.ph, k, x0, y0, W, H, g, b, pad };
    });
    return { sheets, minK, tight };
  }
  function marksSvg(sh) {
    const { pw, ph, x0, y0, W, H, k, b, g } = sh, off = b * k + 2, len = 6, L = [];
    const xs = [x0, x0 + W], ys = [y0, y0 + H];
    xs.forEach(x => ys.forEach(y => {
      const sy = y === y0 ? -1 : 1, sx = x === x0 ? -1 : 1;
      L.push([x, y + sy * off, x, y + sy * (off + len)], [x + sx * off, y, x + sx * (off + len), y]);
    }));
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + pw + 'mm" height="' + ph + 'mm" viewBox="0 0 ' + pw + ' ' + ph + '"><g stroke="#000" stroke-width="0.12" fill="none">' + L.map(l => '<line x1="' + l[0].toFixed(2) + '" y1="' + l[1].toFixed(2) + '" x2="' + l[2].toFixed(2) + '" y2="' + l[3].toFixed(2) + '"/>').join('');
    if (g.fold) { const fx = x0 + W / 2; svg += '<line x1="' + fx + '" y1="' + (y0 - off) + '" x2="' + fx + '" y2="' + (y0 - off - len) + '" stroke-dasharray="1 1"/><line x1="' + fx + '" y1="' + (y0 + H + off) + '" x2="' + fx + '" y2="' + (y0 + H + off + len) + '" stroke-dasharray="1 1"/>'; }
    return 'data:image/svg+xml;base64,' + btoa(svg + '</g></svg>');
  }
  async function sheetItems(sh, dpi) {
    const all = surfaces(), items = [], { k, x0, y0, b, g } = sh;
    for (const p of g.pages) {
      const s = all[p.si], bl = { l: p.side === 'R' ? 0 : b, r: p.side === 'L' ? 0 : b, t: b, b: b };
      const c = await renderCanvas(s, dpi * k, bl);
      items.push({ src: c.toDataURL('image/jpeg', 0.92), x: x0 + (p.dx - bl.l) * k, y: y0 - bl.t * k, w: (s.w + bl.l + bl.r) * k, h: (s.h + bl.t + bl.b) * k });
    }
    if (b > 0 || sh.pad) items.push({ src: marksSvg(sh), x: 0, y: 0, w: sh.pw, h: sh.ph });
    return items;
  }
  let prTimer = 0;
  function openPrint() {
    if (!doc) { toast('Сначала создай или открой проект'); return; }
    const book = doc.type === 'booklet', ok4 = book && doc.pages.length % 4 === 0;
    $('prWhat').innerHTML = book
      ? (ok4 ? '<button data-v="booklet" aria-pressed="true">Брошюрой — сложить и скрепить</button>' : '') + '<button data-v="pages" aria-pressed="' + !ok4 + '">Каждая страница отдельно</button><button data-v="current" aria-pressed="false">Только текущая</button>'
      : '<button data-v="current" aria-pressed="true">Текущий формат</button><button data-v="pages" aria-pressed="false">Все форматы</button>';
    $('printDlg').hidden = false; prUpdate();
  }
  function prUpdate() {
    clearTimeout(prTimer);
    const o = prOpts(), plan = printPlan(o), sh = plan.sheets[0];
    const notes = [];
    notes.push('Листов: ' + plan.sheets.length + ' (' + o.paper + ').');
    if (o.scale === 'real' && plan.minK < 0.999) notes.push('Не помещается в 100% — будет уменьшено до ' + Math.round(plan.minK * 100) + '%. Возьми лист побольше или «Вписать в лист».');
    if (o.scale === 'fit' && plan.minK > 1.001) notes.push('Увеличено до ' + Math.round(plan.minK * 100) + '%.');
    if (plan.tight) notes.push('Страницы почти во весь лист: домашний принтер может не пропечатать 3–5 мм у края, метки реза частично не поместятся.');
    if (o.what === 'booklet') notes.push('Печатай с двух сторон, переворот по короткому краю. Если принтер так не умеет: распечатай нечётные листы, переверни пачку и распечатай чётные. Затем сложи пополам и скрепи.');
    $('prNote').textContent = notes.join(' ');
    // превью первого листа
    const cv = $('prPrev'), g = cv.getContext('2d'); g.clearRect(0, 0, 320, 320);
    if (!sh) return;
    const S0 = 300 / Math.max(sh.pw, sh.ph), ox = (320 - sh.pw * S0) / 2, oy = (320 - sh.ph * S0) / 2;
    g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 8; g.fillRect(ox, oy, sh.pw * S0, sh.ph * S0); g.shadowBlur = 0;
    $('prInfo').textContent = 'Лист 1: ' + (sh.pw > sh.ph ? 'альбомный' : 'книжный') + ', ' + Math.round(sh.k * 100) + '%';
    prTimer = setTimeout(async () => {
      try {
        const items = await sheetItems(sh, 300 / Math.max(sh.pw, sh.ph) * 25.4 * 1.2);
        for (const it of items) { const im = new Image(); im.src = it.src; await im.decode(); g.drawImage(im, ox + it.x * S0, oy + it.y * S0, it.w * S0, it.h * S0); }
      } catch (e) { console.warn(e); }
    }, 60);
  }
  ['prWhat', 'prPaper', 'prScale'].forEach(id => $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $$('button', $(id)).forEach(x => x.setAttribute('aria-pressed', String(x === b))); prUpdate(); }));
  $('prMarks').onchange = prUpdate;
  $('prCancel').onclick = () => { $('printDlg').hidden = true; };
  $('printDlg').addEventListener('pointerdown', e => { if (e.target.id === 'printDlg') $('printDlg').hidden = true; });
  $('prGo').onclick = async () => {
    const o = prOpts(), plan = printPlan(o);
    $('printDlg').hidden = true; busy('Готовлю листы для печати…', '');
    try {
      const sheets = [];
      for (let i = 0; i < plan.sheets.length; i++) { $('busyText').textContent = 'Лист ' + (i + 1) + ' из ' + plan.sheets.length; sheets.push({ items: await sheetItems(plan.sheets[i], 250) }); }
      idle();
      const sh = plan.sheets[0];
      const r = await DESK.print({ title: doc.name, paper: { w: sh.pw, h: sh.ph }, duplex: o.what === 'booklet' ? 'shortEdge' : null, sheets });
      if (r && r.ok) toast('Отправлено на принтер'); else if (r && r.reason && r.reason !== 'cancelled') toast('Печать не удалась: ' + r.reason);
    } catch (e) { idle(); toast('Не получилось: ' + (e.message || e)); console.error(e); }
  };
  window.addEventListener('message', e => { if (e.data && e.data.type === 'layout-print') openPrint(); });
  window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 'з')) { e.preventDefault(); openPrint(); } });

  /* ================= проект ================= */
  function b64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
  function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  $('bProjSave').onclick = async () => {
    if (!doc) return;
    const used = new Set(); surfaces().forEach(s => s.els.forEach(e => { if (e.asset) used.add(e.asset); }));
    const data = { app: 'studio-layout', version: 1, doc, assets: [...used].map(id => { const a = assets[id]; return { id, kind: a.kind, mime: a.mime, name: a.name, data: b64(a.bytes) }; }) };
    busy('Сохраняю проект…');
    try { const r = await DESK.save((doc.name || 'proekt').replace(/[\\/:*?"<>|]+/g, '_') + '.verstka.json', JSON.stringify(data)); idle(); if (r && !r.canceled) toast('Проект сохранён: ' + r.path); }
    catch (e) { idle(); toast(e.message); }
  };
  async function openProject() {
    try {
      const f = await DESK.openFile('layout-project'); if (!f) return;
      busy('Открываю проект…');
      const data = JSON.parse(new TextDecoder().decode(f.bytes));
      if (data.app !== 'studio-layout') throw new Error('это не проект вёрстки');
      for (const a of data.assets) { const na = await addAsset(unb64(a.data), a.name, a.mime); assets[a.id] = Object.assign(na, { id: a.id }); }
      doc = data.doc; cur = 0; selId = null; undoStack.length = 0; redoStack.length = 0;
      idle(); $('start').hidden = true; renderAll();
    } catch (e) { idle(); toast('Не удалось открыть: ' + (e.message || e)); }
  }
  $('bProjOpen').onclick = () => { $('sClose').hidden = !doc; $('start').hidden = false; };
  $('sOpen').onclick = openProject;
  $('sClose').onclick = () => { $('start').hidden = true; };

  /* ================= старт ================= */
  function initStart() {
    $('sBookFmt').innerHTML = FORMATS.filter(f => ['A6', 'A5', 'A4', 'EURO', 'SQ'].includes(f.id)).map(f => '<option value="' + f.id + '"' + (f.id === 'A5' ? ' selected' : '') + '>' + f.label + '</option>').join('');
    $('sPosterFmts').innerHTML = FORMATS.filter(f => ['A4', 'A3', 'A2', 'A1', 'B2', 'SQ'].includes(f.id)).map(f => '<label><input type="checkbox" value="' + f.id + '"' + (['A4', 'A3', 'A2'].includes(f.id) ? ' checked' : '') + '>' + f.label + '</label>').join('');
  }
  $('sBook').onclick = () => {
    const f = fmtById($('sBookFmt').value), n = Number($('sBookPages').value);
    doc = { type: 'booklet', name: 'Меню', bleed: 3, safe: 5, format: { id: f.id, w: f.w, h: f.h }, pages: Array.from({ length: n }, () => ({ id: uid('p'), els: [] })) };
    cur = 0; selId = null; undoStack.length = 0; redoStack.length = 0; $('start').hidden = true; renderAll(); flushPending();
  };
  $('sPoster').onclick = () => {
    const ids = $$('#sPosterFmts input:checked').map(i => i.value); if (!ids.length) { toast('Выбери хотя бы один формат'); return; }
    doc = { type: 'poster', name: 'Афиша', bleed: 3, safe: 10, variants: ids.map(id => { const f = fmtById(id); return { id: uid('v'), format: { id: f.id, w: f.w, h: f.h, label: f.label }, els: [] }; }) };
    cur = 0; selId = null; overview = false; undoStack.length = 0; redoStack.length = 0; $('start').hidden = true; renderAll();
    toast('Подсказка: сверстай первый формат, затем «На все страницы» или «Добавить формат» перенесёт элементы с подгонкой'); flushPending();
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]; }

  initStart(); updUndo();
  loadFonts();
  window.__layoutTest = { printPlan, sheetItems, openPrint, prOpts, get doc() { return doc; }, set doc(v) { doc = v; }, assets, importFiles, buildPdf, renderPng, surfaces, renderAll, adaptEls, addVariant, setCur: (i) => { cur = i; renderAll(); }, select: (id) => { selId = id; renderAll(); } };
})();
