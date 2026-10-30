/* Студия — интерфейс. Все тяжёлые вычисления идут в главном процессе (window.studio). */
'use strict';
(function () {
  const S = window.studio;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const GB = 1e9;
  const fmtBytes = (b) => !b ? '—' : b >= GB ? (b / GB).toFixed(b >= 10 * GB ? 0 : 1).replace('.', ',') + ' ГБ' : Math.max(1, Math.round(b / 1e6)) + ' МБ';
  let toastT = 0;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }
  function pressed(box, val, attr) { $$('button', $(box)).forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr || 'v'] === String(val)))); }
  function segValue(box, attr) { const b = $$('button[aria-pressed="true"]', $(box))[0]; return b ? b.dataset[attr || 'v'] : null; }
  function bindSeg(box, cb, attr) { $(box).addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !$(box).contains(b)) return; pressed(box, b.dataset[attr || 'v'], attr); if (cb) cb(b.dataset[attr || 'v']); }); }

  /* ================= холсты ================= */
  function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
  function ctx(c) { return c.getContext('2d', { willReadFrequently: true }); }
  function clone(c) { const n = newCanvas(c.width, c.height); n.getContext('2d').drawImage(c, 0, 0); return n; }
  function resize(src, w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let cur = src;
    while (cur.width / 2 >= w && cur.height / 2 >= h) { const n = newCanvas(cur.width / 2, cur.height / 2); const g = n.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
    const out = newCanvas(w, h); const g = out.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h); return out;
  }
  function toBlob(c, type, q) { return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Не получилось сохранить картинку')), type || 'image/png', q)); }
  async function toBytes(c, type, q) { return new Uint8Array(await (await toBlob(c, type, q)).arrayBuffer()); }
  async function toDataUrl(c) { return c.toDataURL('image/png'); }
  async function fromBytes(bytes, type) {
    const blob = new Blob([bytes], { type: type || 'image/png' });
    const bmp = await createImageBitmap(blob);
    const c = newCanvas(bmp.width, bmp.height); c.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close(); return c;
  }
  async function fromB64(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return fromBytes(u, 'image/png'); }
  function hasAlpha(c) { const d = ctx(c).getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i] < 250) return true; return false; }
  function flatten(c, color) { const n = newCanvas(c.width, c.height); const g = n.getContext('2d'); g.fillStyle = color || '#ffffff'; g.fillRect(0, 0, n.width, n.height); g.drawImage(c, 0, 0); return n; }
  function round16(v) { return Math.max(256, Math.round(v / 16) * 16); }
  function fitBox(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return { w: round16(w * k), h: round16(h * k) }; }

  /* ================= документ и история ================= */
  const doc = { hist: [], idx: -1, name: 'kartinka' };
  const cur = () => doc.hist[doc.idx] ? doc.hist[doc.idx].cv : null;
  function pushHist(cv, label, extra) {
    doc.hist = doc.hist.slice(0, doc.idx + 1);
    doc.hist.push(Object.assign({ cv, label }, extra || {}));
    let px = doc.hist.reduce((a, h) => a + h.cv.width * h.cv.height, 0);
    while (doc.hist.length > 2 && (doc.hist.length > 30 || px > 180e6)) { const r = doc.hist.shift(); px -= r.cv.width * r.cv.height; }
    doc.idx = doc.hist.length - 1;
    onDocChange();
  }
  function replaceTop(cv) { doc.hist[doc.idx].cv = cv; onDocChange(); }
  function undo() { if (doc.idx > 0) { doc.idx--; onDocChange(); toast('Отменено: ' + doc.hist[doc.idx + 1].label); } }
  function redo() { if (doc.idx < doc.hist.length - 1) { doc.idx++; onDocChange(); toast('Повторено: ' + doc.hist[doc.idx].label); } }
  function onDocChange(keepMask) {
    const c = cur();
    $('empty').hidden = !!c; $('cvWrap').hidden = !c;
    ['bSave', 'bCompare', 'bToVector', 'bToLayout'].forEach(id => { $(id).disabled = !c; }); updPrint();
    $('bUndo').disabled = doc.idx <= 0; $('bRedo').disabled = doc.idx >= doc.hist.length - 1;
    if (!c) { $('docInfo').textContent = 'Нет картинки'; return; }
    const main = $('mainCv');
    if (main.width !== c.width || main.height !== c.height) { main.width = c.width; main.height = c.height; }
    const mk = $('maskCv');
    if (mk.width !== c.width || mk.height !== c.height) { mk.width = c.width; mk.height = c.height; }
    else if (!keepMask) { /* размер тот же — маску оставляем */ }
    const g = main.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0);
    $('docInfo').textContent = doc.name + ' · ' + c.width + '×' + c.height + ' px · ' + doc.hist[doc.idx].label;
    layoutCanvas(); updateQualityHint(); updateRemoveBtn();
  }
  async function openBytes(bytes, name, type) {
    try {
      const c = await fromBytes(bytes, type);
      doc.hist = []; doc.idx = -1; doc.name = (name || 'kartinka').replace(/\.[^.]+$/, '');
      cut = null; lastEdit = null; clearMask();
      pushHist(c, 'Исходник');
      if (['check', 'chat', 'models', 'vector', 'layout'].includes(activeTab)) setTab('quality');
    } catch (e) { toast('Не удалось открыть: это точно картинка?'); }
  }

  /* ================= отображение и масштаб ================= */
  let zoom = 'fit';
  function layoutCanvas() {
    const c = cur(); if (!c) return;
    const st = $('stage');
    const aw = st.clientWidth - 48, ah = st.clientHeight - 48;
    const k = zoom === 'fit' ? Math.min(aw / c.width, ah / c.height, c.width < 600 ? 2 : 1) : Number(zoom);
    const w = $('cvWrap'); w.style.width = Math.max(40, c.width * k) + 'px'; w.style.height = Math.max(40, c.height * k) + 'px';
  }
  bindSeg('zoomSeg', v => { zoom = v; layoutCanvas(); }, 'z');
  window.addEventListener('resize', layoutCanvas);
  // «Было / стало»
  const cmp = $('bCompare');
  function showPrev(on) {
    const c = cur(); if (!c) return;
    const prev = on ? (doc.hist[doc.idx - 1] || doc.hist[0]).cv : c;
    const m = $('mainCv'); const g = m.getContext('2d');
    if (on && (prev.width !== m.width || prev.height !== m.height)) { g.clearRect(0, 0, m.width, m.height); g.drawImage(prev, 0, 0, m.width, m.height); }
    else { g.clearRect(0, 0, m.width, m.height); g.drawImage(prev, 0, 0); }
  }
  cmp.addEventListener('pointerdown', () => showPrev(true));
  ['pointerup', 'pointerleave'].forEach(ev => cmp.addEventListener(ev, () => showPrev(false)));

  /* ================= кисть ================= */
  let brushOn = false, brushErase = false, painting = false, lastPt = null;
  const mk = $('maskCv'), ring = $('brushRing');
  function maskColor() { return getComputedStyle(document.documentElement).getPropertyValue('--mask').trim() || '#ff3d7f'; }
  function setBrush(on) {
    brushOn = on; $('cvWrap').classList.toggle('brush', on); $('brushBar').hidden = !on; ring.hidden = true;
    mk.style.display = on || maskHasPaint() ? '' : 'none';
  }
  function clearMask() { mk.getContext('2d').clearRect(0, 0, mk.width, mk.height); maskDirty = true; updateRemoveBtn(); }
  let maskDirty = true, maskPaintCache = false;
  function maskHasPaint() {
    if (!maskDirty) return maskPaintCache;
    if (!mk.width) return false;
    const d = ctx(mk).getImageData(0, 0, mk.width, mk.height).data;
    let any = false; for (let i = 3; i < d.length; i += 32) if (d[i]) { any = true; break; }
    maskDirty = false; maskPaintCache = any; return any;
  }
  function maskBox() {
    const w = mk.width, h = mk.height, d = ctx(mk).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function brushRadius() { const c = cur(); const k = c ? c.width / mk.getBoundingClientRect().width : 1; return Number($('brushSize').value) / 2 * k; }
  function ptFromEvent(e) { const r = mk.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * mk.width, y: (e.clientY - r.top) / r.height * mk.height }; }
  function stroke(a, b) {
    const g = mk.getContext('2d');
    g.globalCompositeOperation = brushErase ? 'destination-out' : 'source-over';
    g.strokeStyle = g.fillStyle = maskColor(); g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = brushRadius() * 2;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.beginPath(); g.arc(b.x, b.y, brushRadius(), 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over'; maskDirty = true;
  }
  mk.addEventListener('pointerdown', e => { if (!brushOn || e.button !== 0) return; painting = true; mk.setPointerCapture(e.pointerId); lastPt = ptFromEvent(e); stroke(lastPt, lastPt); });
  mk.addEventListener('pointermove', e => {
    if (!brushOn) return;
    const r = $('cvWrap').getBoundingClientRect();
    ring.hidden = false; ring.style.left = (e.clientX - r.left) + 'px'; ring.style.top = (e.clientY - r.top) + 'px';
    const d = Number($('brushSize').value); ring.style.width = ring.style.height = d + 'px';
    if (painting) { const p = ptFromEvent(e); stroke(lastPt, p); lastPt = p; }
  });
  mk.addEventListener('pointerup', () => { painting = false; updateRemoveBtn(); });
  mk.addEventListener('pointerleave', () => { ring.hidden = true; });
  bindSeg('brushMode', v => { brushErase = v === 'erase'; }, 'm');
  $('bMaskClear').onclick = () => { clearMask(); };

  /* ================= занятость ================= */
  let busyCancel = null;
  function busy(title, text, opts) {
    opts = opts || {};
    $('busy').hidden = false; $('busyTitle').textContent = title; $('busyText').textContent = text || '';
    const bar = $('busyBar'); bar.classList.toggle('indet', opts.progress == null); bar.firstElementChild.style.width = opts.progress == null ? '' : Math.round(opts.progress * 100) + '%';
    $('busyPreview').hidden = !opts.preview; if (opts.preview) $('busyPreview').src = opts.preview;
    busyCancel = opts.cancel || null; $('busyCancel').hidden = !busyCancel;
  }
  function idle() { $('busy').hidden = true; busyCancel = null; }
  $('busyCancel').onclick = () => { if (busyCancel) { busyCancel(); $('busyText').textContent = 'Останавливаю…'; } };
  function failed(e, what) {
    idle();
    if (e && e.code === 'missing') { toast('Сначала скачай нужные модели'); setTab('models'); return; }
    if (e && e.cancelled) { toast('Отменено'); return; }
    const m = String((e && e.message) || e);
    toast((what || 'Ошибка') + ': ' + m.slice(0, 180));
    console.error(e);
  }

  /* ================= статус моделей ================= */
  let st = null; const jobs = {};
  const packOf = (id) => st && st.packs.find(p => p.id === id);
  async function refreshStatus() { try { st = await S.status(); renderModels(); renderNeeds(); } catch (e) { console.error(e); } }
  S.onStatus(s => { st = s; renderModels(); renderNeeds(); });
  S.onJob(({ id, job }) => { if (job) jobs[id] = job; else delete jobs[id]; renderModels(); renderNeeds(); });
  function compLine(c) {
    const j = jobs[c.id] || c.job;
    let stText = c.installed ? 'Скачано' : 'Не скачано', cls = c.installed ? 'ok' : '', bar = '';
    if (j) {
      if (j.state === 'error') { stText = 'Ошибка'; cls = 'bad'; }
      else if (j.state === 'download') { const p = j.total ? j.done / j.total : 0; stText = Math.floor(p * 100) + '% · ' + fmtBytes(j.done); bar = '<div class="bar"><i style="width:' + (p * 100).toFixed(1) + '%"></i></div>'; }
      else if (j.state === 'unpack') { stText = 'Распаковка…'; bar = '<div class="bar indet"><i></i></div>'; }
      else { stText = 'Подготовка…'; bar = '<div class="bar indet"><i></i></div>'; }
    }
    const err = j && j.state === 'error' ? '<div class="err" style="grid-column:1/-1">' + esc(j.error) + '</div>' : '';
    return '<div class="comp"><span class="name" title="' + esc(c.title) + ' · ' + esc(c.license || '') + '">' + esc(c.title) + '</span><span class="size">' + fmtBytes(c.approx) + '</span><span class="st ' + cls + '">' + esc(stText) + '</span>' + bar + err + '</div>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
  function packBusy(p) { return p.comps.some(c => jobs[c.id] && jobs[c.id].state !== 'error'); }
  function renderModels() {
    if (!st) return;
    $('packs').innerHTML = st.packs.map(p => {
      const busyNow = packBusy(p);
      const right = p.ready ? '<span class="state ok">✓ Готово</span>'
        : busyNow ? '<button class="btn sm" data-stop="' + p.id + '">Остановить</button>'
          : '<button class="btn primary" data-get="' + p.id + '">Скачать · ' + fmtBytes(p.missingBytes) + '</button>';
      return '<div class="pack" style="margin-bottom:12px"><div><h2>' + esc(p.title) + '</h2><p class="what">' + esc(p.what) + '</p></div>' + right + '<div class="comps">' + p.comps.map(compLine).join('') + '</div></div>';
    }).join('');
    $('dataDir').textContent = st.dataDir; $('dirWarn').hidden = st.dataDirAscii && !/\s/.test(st.dataDir);
    $('freeSpace').textContent = st.free != null ? 'Свободно: ' + fmtBytes(st.free) : '';
    pressed('mVlm', st.vlm); pressed('mHost', st.hfHost);
    $('modelsBadge').hidden = st.packs.every(p => p.ready);
  }
  function startPack(id) {
    const p = packOf(id); if (!p) return;
    const ids = p.comps.filter(c => !c.installed).map(c => c.id);
    if (!ids.length) return;
    const need = p.missingBytes;
    if (st.free != null && st.free < need * 1.1) { toast('Не хватает места: нужно ' + fmtBytes(need) + ', свободно ' + fmtBytes(st.free)); return; }
    ids.forEach(i => { jobs[i] = { state: 'resolve' }; });
    renderModels(); renderNeeds();
    S.install(ids).then(s => { st = s; renderModels(); renderNeeds(); }).catch(e => failed(e, 'Загрузка'));
  }
  $('packs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.get) startPack(b.dataset.get);
    if (b.dataset.stop) { const p = packOf(b.dataset.stop); p.comps.forEach(c => S.cancelInstall(c.id)); }
  });
  function renderNeeds() {
    if (!st) return;
    $$('[data-need]').forEach(el => {
      const p = packOf(el.dataset.need); if (!p) return;
      el.hidden = p.ready;
      if (p.ready) return;
      const busyNow = packBusy(p);
      let prog = '';
      if (busyNow) {
        const tot = p.comps.reduce((a, c) => a + c.approx, 0);
        const done = p.comps.reduce((a, c) => a + (c.installed ? c.approx : (jobs[c.id] && jobs[c.id].done) || 0), 0);
        prog = '<div class="bar"><i style="width:' + Math.min(100, done / tot * 100).toFixed(1) + '%"></i></div><span class="hint">Скачиваю… ' + fmtBytes(done) + ' из ' + fmtBytes(tot) + '. Можно пользоваться другими инструментами.</span>';
      }
      el.innerHTML = '<b>Нужно скачать: ' + esc(p.title) + '</b><span class="hint">' + esc(p.what) + '. Один раз, около ' + fmtBytes(p.missingBytes) + '.</span>' +
        (busyNow ? prog : '<div class="row"><button class="btn primary sm" data-get-pack="' + p.id + '">Скачать</button><button class="btn sm" data-goto-models>Подробнее</button></div>');
    });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-get-pack],[data-goto-models]'); if (!b) return;
    if (b.dataset.getPack) startPack(b.dataset.getPack); else setTab('models');
  });
  $('mChooseDir').onclick = async () => { try { st = await S.chooseDataDir(); renderModels(); renderNeeds(); } catch (e) { failed(e); } };
  $('mOpenDir').onclick = () => S.openDataDir();
  bindSeg('mVlm', v => S.setSetting('vlm', v).then(s => { st = s; renderModels(); renderNeeds(); }));
  bindSeg('mHost', v => S.setSetting('hfHost', v).then(s => { st = s; renderModels(); toast('Источник загрузки изменён'); }));
  async function showLog() { try { $('logOut').textContent = (await S.engine('log')) || '—'; } catch (e) { $('logOut').textContent = String(e.message); } }
  $('mLog').onclick = showLog;
  $('mTestImg').onclick = async () => { $('logOut').textContent = 'Запускаю нейросеть для картинок… это может занять до пары минут.'; try { await S.engine('start', 'image'); toast('Нейросеть для картинок запускается нормально'); } catch (e) { failed(e, 'Запуск'); } showLog(); };
  $('mTestTxt').onclick = async () => { $('logOut').textContent = 'Запускаю нейросеть для текста…'; try { await S.engine('start', 'text'); toast('Нейросеть для текста запускается нормально'); } catch (e) { failed(e, 'Запуск'); } showLog(); };

  /* ================= индикатор нейросети ================= */
  let eng = { state: 'off' };
  S.onEngine(e => { eng = e; renderEngine(); if (e.state !== 'ready') sdCapsCache = null; });
  function renderEngine() {
    const p = $('enginePill'); p.className = 'pill ' + (eng.state || 'off');
    const kind = eng.kind === 'image' ? 'картинки' : eng.kind === 'text' ? 'тексты' : '';
    const t = eng.state === 'ready' ? 'Нейросеть готова: ' + kind : eng.state === 'starting' ? 'Загружаю нейросеть: ' + kind + '…' : eng.state === 'error' ? 'Нейросеть не запустилась' : 'Нейросеть выключена';
    $('engineText').textContent = t;
    $('popEngine').textContent = t + (eng.state === 'off' || !eng.state ? ' · запустится сама, когда понадобится' : '');
    $('bUnload').hidden = !(eng.state === 'ready' || eng.state === 'starting');
    $('bEngLog').hidden = eng.state !== 'error';
    if (!$('busy').hidden && eng.state === 'starting') $('busyText').textContent = 'Загружаю нейросеть в память. В первый раз это может занять 1–3 минуты.';
  }
  $('bUnload').onclick = () => S.engine('stop').then(() => toast('Память видеокарты освобождена'));
  $('bEngLog').onclick = () => { popOpen(false); setTab('models'); $$('details', $('viewModels'))[0].open = true; showLog(); };

  /* ================= история картинок (меню у индикатора нейросети) ================= */
  let hist = [];
  function popOpen(on) { $('histPop').hidden = !on; $('enginePill').setAttribute('aria-expanded', String(on)); if (on) renderHist(); }
  $('enginePill').onclick = (e) => { e.stopPropagation(); popOpen($('histPop').hidden); };
  document.addEventListener('pointerdown', e => { if (!$('histPop').hidden && !e.target.closest('.popwrap')) popOpen(false); });
  window.addEventListener('blur', () => { /* клик внутри iframe не доходит сюда — закрываем по потере фокуса */ if (!$('histPop').hidden) setTimeout(() => { if (document.activeElement && document.activeElement.tagName === 'IFRAME') popOpen(false); }, 0); });
  function fmtTime(t) { const d = new Date(t), now = new Date(); const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === now.toDateString() ? 'сегодня, ' + hm : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + hm; }
  function renderHist() {
    $('histCount').textContent = hist.length ? hist.length + ' шт.' : '';
    $('histBadge').hidden = !hist.length; $('histBadge').textContent = hist.length;
    $('histClear').disabled = !hist.length;
    const g = $('histGrid');
    if (!hist.length) { g.innerHTML = '<div class="empty-small">Пока пусто. Здесь появятся картинки, которые сделает нейросеть.</div>'; return; }
    g.innerHTML = hist.map(e => '<div class="hitem" data-id="' + e.id + '" tabindex="0" title="' + esc(e.label + ' · ' + e.w + '×' + e.h + ' · ' + fmtTime(e.t)) + '"><img src="' + e.thumb + '" alt=""><span class="cap">' + esc(e.label) + '</span>' +
      '<div class="acts"><button data-a="open">Открыть</button><button data-a="vector">В вектор</button><button data-a="layout">В вёрстку</button><button data-a="copy">Копировать</button><button data-a="save">Сохранить…</button><button data-a="del" class="del">Удалить</button></div></div>').join('');
  }
  async function histRefresh() { try { hist = await S.histList(); } catch (e) { hist = []; } renderHist(); }
  // результат нейросети — в историю
  async function remember(cv, label) {
    try {
      const alpha = hasAlpha(cv), ext = alpha ? 'png' : 'jpg';
      const bytes = alpha ? await toBytes(cv, 'image/png') : await toBytes(flatten(cv), 'image/jpeg', 0.95);
      const k = Math.min(1, 260 / Math.max(cv.width, cv.height)), tc = flatten(resize(cv, cv.width * k, cv.height * k), '#ffffff');
      const e = await S.histAdd({ bytes, thumb: await toBytes(tc, 'image/jpeg', 0.82), label, w: cv.width, h: cv.height, ext });
      hist.unshift(Object.assign(e, { thumb: tc.toDataURL('image/jpeg', 0.82) })); hist = hist.slice(0, 150);
      renderHist();
    } catch (e) { console.warn('история', e); }
  }
  const histName = (e) => 'studiya-' + new Date(e.t).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  $('histGrid').addEventListener('click', async ev => {
    const it = ev.target.closest('.hitem'); if (!it) return;
    const e = hist.find(x => x.id === it.dataset.id); if (!e) return;
    const b = ev.target.closest('button'), a = b ? b.dataset.a : 'open';
    try {
      if (a === 'del') { await S.histDel(e.id); hist = hist.filter(x => x !== e); renderHist(); return; }
      const f = await S.histGet(e.id), name = histName(e) + '.' + e.ext;
      if (a === 'open') { popOpen(false); await openBytes(f.bytes, name, f.type); doc.hist[doc.idx].label = e.label; onDocChange(); }
      else if (a === 'vector') { popOpen(false); sendToVector(f.bytes, name, f.type); }
      else if (a === 'layout') { popOpen(false); sendToLayout(f.bytes, name, f.type); }
      else if (a === 'copy') { await S.copyImage(f.bytes); toast('Скопировано. Можно вставить в Photoshop или Illustrator (Ctrl+V)'); }
      else if (a === 'save') { const p = await S.saveFile(name, f.bytes); if (p) toast('Сохранено: ' + p); }
    } catch (err) { failed(err); }
  });
  let clearArm = 0;
  $('histClear').onclick = async () => {
    if (!hist.length) return;
    if (Date.now() - clearArm > 3000) { clearArm = Date.now(); $('histClear').textContent = 'Точно очистить?'; $('histClear').classList.add('primary'); setTimeout(() => { $('histClear').textContent = 'Очистить'; $('histClear').classList.remove('primary'); }, 3000); return; }
    clearArm = 0; $('histClear').textContent = 'Очистить'; $('histClear').classList.remove('primary');
    try { await S.histClear(); hist = []; renderHist(); toast('История картинок очищена'); } catch (e) { failed(e); }
  };
  $('histDir').onclick = () => S.histOpenDir();

  /* ================= вкладки ================= */
  let activeTab = 'quality';
  const IMAGE_TABS = ['quality', 'cutout', 'edit', 'create'];
  function setTab(t) {
    activeTab = t;
    $$('.rail button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('viewImage').hidden = !IMAGE_TABS.includes(t);
    $('viewCheck').hidden = t !== 'check'; $('viewChat').hidden = t !== 'chat'; $('viewVector').hidden = t !== 'vector'; $('viewModels').hidden = t !== 'models'; $('viewLayout').hidden = t !== 'layout';
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== t; });
    setBrush((t === 'cutout' && removeMode) || (t === 'edit' && segValue('eScope') === 'area'));
    if (t === 'models') { refreshStatus(); showLog(); }
    updPrint(); popOpen(false);
    requestAnimationFrame(layoutCanvas);
  }
  $$('.rail button').forEach(b => { b.onclick = () => setTab(b.dataset.tab); });

  /* ================= открыть / сохранить ================= */
  async function openDialog() { try { const f = await S.openFile('image'); if (f) openBytes(f.bytes, f.name, f.type); } catch (e) { failed(e); } }
  $('bOpen').onclick = openDialog; $('bOpen2').onclick = openDialog;
  async function saveDialog() {
    const c = cur(); if (!c) return;
    const alpha = hasAlpha(c);
    const name = doc.name + (alpha ? '.png' : '.jpg');
    try {
      const ext = name.split('.').pop();
      const data = ext === 'png' ? await toBytes(c, 'image/png') : await toBytes(flatten(c), 'image/jpeg', 0.95);
      const p = await S.saveFile(name, data);
      if (p) toast('Сохранено: ' + p);
    } catch (e) { failed(e, 'Сохранение'); }
  }
  $('bSave').onclick = saveDialog;
  $('bUndo').onclick = undo; $('bRedo').onclick = redo;
  function postTo(frameId, msg, delay) {
    const f = $(frameId), send = () => f.contentWindow.postMessage(msg, '*');
    if (f.contentDocument && f.contentDocument.readyState === 'complete') setTimeout(send, 50); else f.addEventListener('load', () => setTimeout(send, delay || 250), { once: true });
  }
  function sendToVector(bytes, name, mime) { setTab('vector'); postTo('vzFrame', { type: 'vz-open', bytes, name, mime: mime || 'image/png' }, 200); }
  function sendToLayout(bytes, name, mime) {
    setTab('layout'); postTo('lyFrame', { type: 'layout-add', bytes, name, mime }, 300);
    toast('Картинка добавлена в вёрстку на текущую страницу. Если проект ещё не создан — сначала выбери, что верстаем.');
  }
  $('bToVector').onclick = async () => { const c = cur(); if (!c) return; sendToVector(await toBytes(c, 'image/png'), doc.name + '.png', 'image/png'); };
  $('bToLayout').onclick = async () => {
    const c = cur(); if (!c) return;
    const alpha = hasAlpha(c), bytes = alpha ? await toBytes(c, 'image/png') : await toBytes(flatten(c), 'image/jpeg', 0.95);
    sendToLayout(bytes, doc.name + (alpha ? '.png' : '.jpg'), alpha ? 'image/png' : 'image/jpeg');
  };

  /* ================= печать ================= */
  const PAPER = { A4: [210, 297], A3: [297, 420], A5: [148, 210] };
  let prSrc = null; // {kind:'image'|'svg', w, h (пропорции), wMm?, img (для превью), src()}
  function updPrint() { $('bPrint').disabled = IMAGE_TABS.includes(activeTab) ? !cur() : !['vector', 'layout'].includes(activeTab); }
  function askFrame(frameId, type, reply, ms) {
    return new Promise((res, rej) => {
      const on = (e) => { if (e.data && e.data.type === reply) { window.removeEventListener('message', on); clearTimeout(t); res(e.data); } };
      const t = setTimeout(() => { window.removeEventListener('message', on); rej(new Error('нет ответа')); }, ms || 4000);
      window.addEventListener('message', on); $(frameId).contentWindow.postMessage({ type }, '*');
    });
  }
  async function doPrint() {
    if (activeTab === 'layout') { $('lyFrame').contentWindow.postMessage({ type: 'layout-print' }, '*'); return; }
    if (activeTab === 'vector') {
      let r; try { r = await askFrame('vzFrame', 'vz-get-svg', 'vz-svg'); } catch (e) { toast('Векторизатор не ответил'); return; }
      if (!r.svg) { toast('Сначала открой картинку в векторизаторе'); return; }
      const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(r.svg)));
      const img = new Image(); img.src = url; try { await img.decode(); } catch (e) { /* превью без картинки */ }
      prSrc = { kind: 'svg', w: r.w, h: r.h, wMm: r.wMm, img, src: async () => url, name: r.name };
    } else {
      const c = cur(); if (!c) { toast('Сначала открой картинку'); return; }
      prSrc = { kind: 'image', w: c.width, h: c.height, wMm: null, img: c, name: doc.name,
        src: async (wMm) => { const px = Math.round(wMm / 25.4 * 300), k = Math.min(1, px / c.width), s = k < 1 ? resize(c, c.width * k, c.height * k) : c; return hasAlpha(s) ? s.toDataURL('image/png') : flatten(s).toDataURL('image/jpeg', 0.95); } };
    }
    const fitsA4 = prSrc.wMm && Math.min(Math.max(prSrc.wMm, prSrc.wMm * prSrc.h / prSrc.w) / 287, Math.min(prSrc.wMm, prSrc.wMm * prSrc.h / prSrc.w) / 200) <= 1;
    pressed('prSize', fitsA4 ? 'mm' : 'fit'); $('prWrap').hidden = !fitsA4;
    $('prW').value = Math.round(prSrc.wMm || 150);
    $('printDlg').hidden = false; prLayout();
  }
  function prPlace() {
    const [a, b] = PAPER[segValue('prPaper')], o = segValue('prOrient'), M = 5;
    const land = o === 'l' || (o === 'auto' && prSrc.w > prSrc.h * 1.05);
    const pw = land ? b : a, ph = land ? a : b, aw = pw - 2 * M, ah = ph - 2 * M, asp = prSrc.h / prSrc.w;
    let w, h, note = '';
    if (segValue('prSize') === 'mm') {
      w = Math.max(5, Number($('prW').value) || 100); h = w * asp;
      if (w > aw || h > ah) { const k = Math.min(aw / w, ah / h); w *= k; h *= k; note = ' Не помещается — уменьшено до ширины ' + Math.round(w) + ' мм.'; }
    } else { const k = Math.min(aw / prSrc.w, ah / prSrc.h); w = prSrc.w * k; h = prSrc.h * k; }
    return { pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h, note };
  }
  function prLayout() {
    const P = prPlace(), cv = $('prPrev'), g = cv.getContext('2d'), S0 = 280 / Math.max(P.pw, P.ph);
    g.clearRect(0, 0, 300, 300);
    const ox = (300 - P.pw * S0) / 2, oy = (300 - P.ph * S0) / 2;
    g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 8; g.fillRect(ox, oy, P.pw * S0, P.ph * S0); g.shadowBlur = 0;
    try { g.drawImage(prSrc.img, ox + P.x * S0, oy + P.y * S0, P.w * S0, P.h * S0); } catch (e) { /* svg без размеров */ }
    $('prInfo').textContent = segValue('prPaper') + ' · ' + Math.round(P.w) + '×' + Math.round(P.h) + ' мм' + (prSrc.kind === 'image' ? ' · ' + Math.round(prSrc.w / (P.w / 25.4)) + ' dpi' : ' · вектор') + '.' + P.note;
  }
  bindSeg('prPaper', prLayout); bindSeg('prOrient', prLayout); bindSeg('prSize', v => { $('prWrap').hidden = v !== 'mm'; prLayout(); });
  $('prW').oninput = prLayout;
  $('prCancel').onclick = () => { $('printDlg').hidden = true; };
  $('printDlg').addEventListener('pointerdown', e => { if (e.target.id === 'printDlg') $('printDlg').hidden = true; });
  $('prGo').onclick = async () => {
    const P = prPlace(); $('prGo').disabled = true;
    try {
      const src = await prSrc.src(P.w);
      $('printDlg').hidden = true;
      const r = await S.print({ title: prSrc.name || 'Студия', paper: { w: P.pw, h: P.ph }, sheets: [{ items: [{ src, x: P.x, y: P.y, w: P.w, h: P.h }] }] });
      if (r && r.ok) toast('Отправлено на принтер'); else if (r && r.reason && r.reason !== 'cancelled') toast('Печать не удалась: ' + r.reason);
    } catch (e) { failed(e, 'Печать'); }
    $('prGo').disabled = false;
  };
  $('bPrint').onclick = doPrint;
  S.onCommand(c => { if (c === 'print') { if (!$('bPrint').disabled) doPrint(); } else if (c === 'open') openDialog(); else if (c === 'save') saveDialog(); else if (c === 'undo') undo(); else if (c === 'redo') redo(); });
  window.addEventListener('keydown', e => {
    const t = e.target; if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && (k === 'z' || k === 'я')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && (k === 'y' || k === 'н')) { e.preventDefault(); redo(); }
    else if (mod && (k === 'o' || k === 'щ')) { e.preventDefault(); openDialog(); }
    else if (mod && (k === 's' || k === 'ы')) { e.preventDefault(); saveDialog(); }
    else if (brushOn && (k === '[' || k === 'х')) { $('brushSize').value = Math.max(4, $('brushSize').value * 0.8); }
    else if (brushOn && (k === ']' || k === 'ъ')) { $('brushSize').value = Math.min(300, $('brushSize').value * 1.25); }
  });
  let depth = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); depth++; $('drop').hidden = false; });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); depth = 0; $('drop').hidden = true;
    const f = e.dataTransfer.files[0]; if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (activeTab === 'check' || /pdf$/i.test(f.type)) { setTab('check'); openLayout({ name: f.name, type: f.type, bytes }); }
    else openBytes(bytes, f.name, f.type);
  });
  window.addEventListener('paste', async e => {
    if (activeTab === 'chat' || activeTab === 'vector' || activeTab === 'layout') return;
    const it = Array.from((e.clipboardData && e.clipboardData.items) || []).find(i => i.type.startsWith('image/'));
    if (!it) return; const f = it.getAsFile(); openBytes(new Uint8Array(await f.arrayBuffer()), 'vstavka', f.type);
  });

  /* ================= улучшение качества ================= */
  bindSeg('qModel'); bindSeg('qScale', updateQualityHint);
  function updateQualityHint() {
    const c = cur(); if (!c) { $('qOut').textContent = ''; return; }
    const s = Number(segValue('qScale'));
    const lim = 12000 / 4;
    const pre = Math.max(c.width, c.height) > lim ? lim / Math.max(c.width, c.height) : 1;
    const w = Math.round(c.width * s), h = Math.round(c.height * s);
    $('qOut').textContent = 'Получится ' + w + '×' + h + ' px' + (pre < 1 ? ' (картинка большая — обработаю по уменьшенной копии)' : '');
  }
  S.onUpscaleProgress(p => { if (!$('busy').hidden) { $('busyBar').classList.remove('indet'); $('busyBar').firstElementChild.style.width = p + '%'; } });
  async function upscaleCanvas(c, model) {
    const alpha = hasAlpha(c);
    const lim = 3000;
    const pre = Math.max(c.width, c.height) > lim ? resize(c, c.width * lim / Math.max(c.width, c.height), c.height * lim / Math.max(c.width, c.height)) : c;
    const rgb = alpha ? flatten(pre, '#ffffff') : pre;
    const out = await fromBytes(await S.upscale(await toBytes(rgb, 'image/png'), model), 'image/png');
    if (!alpha) return out;
    const a = resize(pre, out.width, out.height);
    const g = out.getContext('2d'); g.globalCompositeOperation = 'destination-in'; g.drawImage(a, 0, 0); g.globalCompositeOperation = 'source-over';
    return out;
  }
  $('qRun').onclick = async () => {
    const c = cur(); if (!c) { toast('Сначала открой картинку'); return; }
    if (!packOf('quality') || !packOf('quality').ready) { toast('Сначала скачай модель «Улучшение качества»'); return; }
    const s = Number(segValue('qScale')), model = segValue('qModel');
    busy('Улучшаю качество…', 'Обычно 5–40 секунд, зависит от размера.', { progress: 0 });
    try {
      const big = await upscaleCanvas(c, model);
      const out = resize(big, c.width * s, c.height * s);
      pushHist(out, s === 1 ? 'Качество улучшено' : 'Улучшено ×' + s); remember(out, s === 1 ? 'Качество улучшено' : 'Улучшено ×' + s);
      idle(); toast('Готово: ' + out.width + '×' + out.height);
    } catch (e) { failed(e, 'Улучшение'); }
  };

  /* ================= убрать фон ================= */
  let cut = null;
  bindSeg('cBg', v => { $('cColorRow').hidden = v !== 'color'; applyCut(); });
  $('cEdge').oninput = () => { $('cEdgeO').textContent = $('cEdge').value < 35 ? 'мягкие' : $('cEdge').value > 70 ? 'чёткие' : 'обычные'; applyCut(); };
  $('cColor').oninput = applyCut;
  $('cEdge').oninput();
  $('cRun').onclick = async () => {
    const c = cur(); if (!c) { toast('Сначала открой картинку'); return; }
    if (!packOf('cutout').ready) { toast('Сначала скачай модели «Фон и лишние предметы»'); return; }
    busy('Ищу объект и вырезаю фон…', 'Несколько секунд.');
    try {
      const N = 1024, inp = newCanvas(N, N), g = inp.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, N, N); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, N, N);
      const px = g.getImageData(0, 0, N, N).data, data = new Float32Array(3 * N * N);
      const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
      for (let i = 0; i < N * N; i++) for (let ch = 0; ch < 3; ch++) data[ch * N * N + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
      const r = await S.ort('birefnet', { image: { data, dims: [1, 3, N, N] } });
      const o = r.data, dims = r.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
      let mn = Infinity, mx = -Infinity; for (let i = 0; i < ow * oh; i++) { if (o[i] < mn) mn = o[i]; if (o[i] > mx) mx = o[i]; }
      const sig = mn < -0.01 || mx > 1.01;
      const mc = newCanvas(ow, oh), mg = mc.getContext('2d'), md = mg.createImageData(ow, oh);
      for (let i = 0; i < ow * oh; i++) { const v = sig ? 1 / (1 + Math.exp(-o[i])) : o[i]; const a = Math.max(0, Math.min(255, Math.round(v * 255))); md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = a; md.data[i * 4 + 3] = 255; }
      mg.putImageData(md, 0, 0);
      const full = resize(mc, c.width, c.height);
      const fd = ctx(full).getImageData(0, 0, c.width, c.height).data, alpha = new Uint8ClampedArray(c.width * c.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = fd[i * 4];
      if (hasAlpha(c)) { const sd = ctx(c).getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(alpha[i], sd[i * 4 + 3]); }
      cut = { src: c, alpha, w: c.width, h: c.height };
      $('cTune').hidden = false;
      pushHist(renderCut(), 'Фон убран', { tag: 'cutout', cutRef: cut }); remember(cur(), 'Фон убран');
      idle(); toast('Фон убран' + (r.ep === 'dml' ? '' : ' (на процессоре)'));
    } catch (e) { failed(e, 'Фон'); }
  };
  function renderCut() {
    const { src, alpha, w, h } = cut;
    const e = Number($('cEdge').value) / 100, width = 1 - e * 0.9, lo = 0.5 - width / 2;
    const out = newCanvas(w, h), og = ctx(out);
    const sd = ctx(src).getImageData(0, 0, w, h), d = sd.data;
    const bg = segValue('cBg'); const col = bg === 'white' ? [255, 255, 255] : bg === 'color' ? hexRgb($('cColor').value) : null;
    for (let i = 0; i < alpha.length; i++) {
      let a = (alpha[i] / 255 - lo) / width; a = a < 0 ? 0 : a > 1 ? 1 : a;
      if (col) { const k = i * 4; d[k] = d[k] * a + col[0] * (1 - a); d[k + 1] = d[k + 1] * a + col[1] * (1 - a); d[k + 2] = d[k + 2] * a + col[2] * (1 - a); d[k + 3] = 255; }
      else d[i * 4 + 3] = Math.round(a * 255);
    }
    og.putImageData(sd, 0, 0); return out;
  }
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  let cutRaf = 0;
  function applyCut() {
    if (!cut || !doc.hist[doc.idx] || doc.hist[doc.idx].cutRef !== cut) return;
    cancelAnimationFrame(cutRaf); cutRaf = requestAnimationFrame(() => replaceTop(renderCut()));
  }

  /* ================= убрать лишнее (LaMa) ================= */
  let removeMode = false;
  $('rBrush').onclick = () => {
    if (!cur()) { toast('Сначала открой картинку'); return; }
    removeMode = !removeMode; $('rBrush').textContent = removeMode ? 'Закончить выделение' : 'Закрасить кистью';
    setBrush(removeMode); if (removeMode) toast('Закрась то, что нужно убрать');
  };
  function updateRemoveBtn() { $('rRun').disabled = !cur() || !maskHasPaint(); }
  function maskCrop(box, dilate) {
    const m = newCanvas(box.w, box.h), g = m.getContext('2d');
    if (dilate) g.filter = 'blur(' + dilate + 'px)';
    g.drawImage(mk, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h); g.filter = 'none';
    const d = g.getImageData(0, 0, box.w, box.h);
    for (let i = 3; i < d.data.length; i += 4) { const on = d.data[i] > 6 ? 255 : 0; d.data[i - 3] = d.data[i - 2] = d.data[i - 1] = 255; d.data[i] = on; }
    g.putImageData(d, 0, 0); return m;
  }
  function regionAround(b, W, H, mult, minSide) {
    let side = Math.max(minSide, Math.max(b.w, b.h) * mult);
    let w = Math.min(W, side), h = Math.min(H, side);
    let x = Math.round(b.x + b.w / 2 - w / 2), y = Math.round(b.y + b.h / 2 - h / 2);
    x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
    return { x, y, w: Math.round(w), h: Math.round(h) };
  }
  function composite(base, patch, mask, box, feather) {
    const out = clone(base);
    const p = newCanvas(box.w, box.h), pg = p.getContext('2d');
    pg.drawImage(patch, 0, 0, box.w, box.h);
    const f = newCanvas(box.w, box.h), fg = f.getContext('2d'); fg.filter = 'blur(' + feather + 'px)'; fg.drawImage(mask, 0, 0); fg.filter = 'none';
    pg.globalCompositeOperation = 'destination-in'; pg.drawImage(f, 0, 0);
    out.getContext('2d').drawImage(p, box.x, box.y); return out;
  }
  $('rRun').onclick = async () => {
    const c = cur(); if (!c) return;
    if (!packOf('cutout').ready) { toast('Сначала скачай модели «Фон и лишние предметы»'); return; }
    const b = maskBox(); if (!b) { toast('Сначала закрась то, что нужно убрать'); return; }
    busy('Убираю лишнее…', 'Несколько секунд.');
    try {
      const box = regionAround(b, c.width, c.height, 1.7, 192);
      const N = 512;
      const crop = newCanvas(box.w, box.h); crop.getContext('2d').drawImage(c, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const mcrop = maskCrop(box, Math.max(2, Math.round(Math.max(box.w, box.h) / 160)));
      const ci = resize(hasAlpha(crop) ? flatten(crop) : crop, N, N), cd = ctx(ci).getImageData(0, 0, N, N).data;
      const mi = newCanvas(N, N); mi.getContext('2d').drawImage(mcrop, 0, 0, N, N); const md = ctx(mi).getImageData(0, 0, N, N).data;
      const img = new Float32Array(3 * N * N), msk = new Float32Array(N * N);
      for (let i = 0; i < N * N; i++) { img[i] = cd[i * 4] / 255; img[N * N + i] = cd[i * 4 + 1] / 255; img[2 * N * N + i] = cd[i * 4 + 2] / 255; msk[i] = md[i * 4 + 3] > 0 ? 1 : 0; }
      const r = await S.ort('lama', { image: { data: img, dims: [1, 3, N, N] }, mask: { data: msk, dims: [1, 1, N, N] } });
      const o = r.data; let mx = 0; for (let i = 0; i < 3000; i++) if (o[i] > mx) mx = o[i];
      const k = mx <= 1.5 ? 255 : 1;
      const oc = newCanvas(N, N), og = oc.getContext('2d'), od = og.createImageData(N, N);
      for (let i = 0; i < N * N; i++) { od.data[i * 4] = o[i] * k; od.data[i * 4 + 1] = o[N * N + i] * k; od.data[i * 4 + 2] = o[2 * N * N + i] * k; od.data[i * 4 + 3] = 255; }
      og.putImageData(od, 0, 0);
      const out = composite(c, resize(oc, box.w, box.h), mcrop, box, 3);
      clearMask(); pushHist(out, 'Предмет убран'); remember(out, 'Предмет убран'); idle(); toast('Готово. Если остались следы — закрась их и повтори.');
    } catch (e) { failed(e, 'Удаление'); }
  };

  /* ================= нейросеть картинок (FLUX.2 klein через stable-diffusion.cpp) ================= */
  let sdCapsCache = null;
  async function sdCaps() {
    if (sdCapsCache) return sdCapsCache;
    const r = await S.imgApi('GET', '/sdcpp/v1/capabilities');
    sdCapsCache = r.json || {}; return sdCapsCache;
  }
  async function sdGenerate(o) {
    let jobId = null, cancelled = false;
    busy(o.title, 'Запускаю нейросеть…', { cancel: () => { cancelled = true; if (jobId) S.imgApiPeek('POST', '/sdcpp/v1/jobs/' + jobId + '/cancel'); } });
    const caps = await sdCaps();
    if (cancelled) throw { cancelled: true };
    const pm = (caps.preview_modes || []).includes('proj') ? 'proj' : 'none';
    const body = { prompt: o.prompt, negative_prompt: '', width: o.w, height: o.h, seed: o.seed, batch_count: 1, ref_images: o.ref ? [o.ref] : [],
      sample_params: { sample_method: 'euler', sample_steps: 4, guidance: { txt_cfg: 1.0 } }, vae_tiling_params: { enabled: true },
      preview: pm, preview_interval: 1, output_format: 'png' };
    const sub = await S.imgApi('POST', '/sdcpp/v1/img_gen', body);
    if (!sub.json || !sub.json.id) throw new Error((sub.json && (sub.json.error || sub.json.message)) || sub.text || ('сервер ответил ' + sub.status));
    jobId = sub.json.id;
    const t0 = Date.now();
    for (;;) {
      await sleep(900);
      const r = await S.imgApiPeek('GET', '/sdcpp/v1/jobs/' + jobId);
      const j = r.json; if (!j) { if (r.status === 0) throw new Error('Нейросеть закрылась во время работы'); continue; }
      if (j.status === 'completed') { const im = j.result && j.result.images && j.result.images[0]; if (!im) throw new Error('пустой результат'); return fromB64(im.b64_json); }
      if (j.status === 'failed') throw new Error((j.error && j.error.message) || 'не получилось');
      if (j.status === 'cancelled' || cancelled && j.status !== 'generating') throw { cancelled: true };
      const sec = Math.round((Date.now() - t0) / 1000);
      const pv = j.preview, prog = pv && pv.total_steps ? pv.step / pv.total_steps : null;
      busy(o.title, j.status === 'queued' ? 'В очереди…' : (pv ? 'Шаг ' + pv.step + ' из ' + pv.total_steps : 'Готовлю') + ' · ' + sec + ' с', { progress: prog, preview: pv && pv.b64_json ? 'data:image/png;base64,' + pv.b64_json : null, cancel: busyCancel });
    }
  }
  const seed = () => Math.floor(Math.random() * 2147483647);

  /* ---- правка словами ---- */
  const EDIT_CHIPS = [
    ['Тёплый свет', 'make the lighting warm and cozy with soft golden tones'],
    ['Ярче и аппетитнее', 'make the colors more vibrant, fresh and appetizing, slightly brighter'],
    ['Добавить пар', 'add gentle steam rising from the hot food'],
    ['Убрать блики', 'remove harsh reflections and glare, keep everything else the same'],
    ['Деревянный стол', 'place it on a rustic wooden table, keep the dish unchanged'],
    ['Мраморный стол', 'place it on a white marble surface, keep the dish unchanged'],
    ['Белый фон', 'replace the background with clean pure white studio background'],
    ['Тёмный фон', 'replace the background with a dark moody background, dramatic light'],
    ['Добавить зелень', 'add a few fresh herb leaves as garnish'],
    ['Как акварель', 'turn it into a delicate watercolor illustration'],
    ['Чётче', 'make it sharper and more detailed, keep composition identical']
  ];
  $('eChips').innerHTML = EDIT_CHIPS.map(([r, en]) => '<button data-en="' + esc(en) + '">' + esc(r) + '</button>').join('');
  $('eChips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const ta = $('ePrompt'); const v = ta.value.trim();
    ta.value = v ? v.replace(/[.,;\s]*$/, '') + ', ' + b.dataset.en : b.dataset.en; ta.focus();
  });
  bindSeg('eScope', v => {
    $('eScopeHint').textContent = v === 'area' ? 'Закрась кистью место, которое нужно изменить. Остальное останется как было.' : 'Картинка перерисуется целиком по твоему описанию.';
    setBrush(v === 'area' && activeTab === 'edit');
  });
  $('eScopeHint').textContent = 'Картинка перерисуется целиком по твоему описанию.';
  let lastEdit = null;
  async function runEdit(again) {
    const c0 = again && lastEdit ? lastEdit.base : cur();
    if (!c0) { toast('Сначала открой картинку'); return; }
    if (!packOf('image').ready) { toast('Сначала скачай модели «Рисование и правка»'); return; }
    const prompt = (again && lastEdit ? lastEdit.prompt : $('ePrompt').value).trim();
    if (!prompt) { toast('Опиши, что изменить'); $('ePrompt').focus(); return; }
    const area = segValue('eScope') === 'area';
    let box = null, mcrop = null;
    if (area) { const b = maskBox(); if (!b) { toast('Закрась кистью область для правки'); return; } box = regionAround(b, c0.width, c0.height, 1.5, 256); mcrop = maskCrop(box, 6); }
    const src = area ? (() => { const k = newCanvas(box.w, box.h); k.getContext('2d').drawImage(c0, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h); return k; })() : c0;
    const size = fitBox(src.width, src.height, 1024);
    try {
      const ref = await toDataUrl(resize(hasAlpha(src) ? flatten(src) : src, size.w, size.h));
      let out = await sdGenerate({ title: area ? 'Перерисовываю выделенное…' : 'Перерисовываю картинку…', prompt, w: size.w, h: size.h, ref, seed: seed() });
      if (area) out = composite(c0, out, mcrop, box, 8);
      else if ($('eRestore').checked && (src.width > out.width * 1.15 || src.height > out.height * 1.15) && packOf('quality').ready) {
        busy('Возвращаю исходное разрешение…', 'Улучшение качества.', { progress: 0 });
        out = resize(await upscaleCanvas(out, 'photo'), c0.width, c0.height);
      } else if (!area) out = resize(out, c0.width, c0.height);
      lastEdit = { base: c0, prompt };
      if (again && doc.hist[doc.idx] && doc.hist[doc.idx].tag === 'edit') replaceTop(out); else pushHist(out, 'Правка: ' + prompt.slice(0, 40), { tag: 'edit' });
      remember(out, 'Правка: ' + prompt.slice(0, 60));
      if (area) clearMask();
      $('eAgain').disabled = false; idle();
    } catch (e) { failed(e, 'Правка'); }
  }
  $('eRun').onclick = () => runEdit(false);
  $('eAgain').onclick = () => runEdit(true);

  /* ---- создать ---- */
  const STYLES = [
    ['Фото блюда', 'professional food photography, appetizing, soft natural light, shallow depth of field, high detail'],
    ['Вид сверху', 'top-down flat lay food photography, styled table, even soft light'],
    ['На белом фоне', 'isolated on a clean pure white background, studio product shot'],
    ['Акварель', 'delicate watercolor illustration, soft washes, visible paper texture'],
    ['Плоская иллюстрация', 'flat vector style illustration, clean simple shapes, limited color palette'],
    ['Линия', 'minimal line art, thin black ink lines on white background'],
    ['Гравюра', 'vintage engraving illustration, fine hatching, black and white'],
    ['Фон-текстура', 'subtle seamless background texture, no objects, no text']
  ];
  $('gStyles').innerHTML = STYLES.map(([r, en]) => '<button aria-pressed="false" data-en="' + esc(en) + '">' + esc(r) + '</button>').join('');
  $('gStyles').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const on = b.getAttribute('aria-pressed') !== 'true'; $$('button', $('gStyles')).forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', String(on)); });
  bindSeg('gSize');
  $('gRun').onclick = async () => {
    if (!packOf('image').ready) { toast('Сначала скачай модели «Рисование и правка»'); return; }
    let prompt = $('gPrompt').value.trim();
    if (!prompt) { toast('Опиши, что нарисовать'); $('gPrompt').focus(); return; }
    const sty = $$('button[aria-pressed="true"]', $('gStyles'))[0];
    if (sty) prompt += ', ' + sty.dataset.en;
    const [w, h] = segValue('gSize').split('x').map(Number);
    try {
      const out = await sdGenerate({ title: 'Рисую…', prompt, w, h, seed: seed() });
      doc.name = 'sozdano-' + new Date().toISOString().slice(0, 10);
      if (!cur()) { doc.hist = []; doc.idx = -1; }
      pushHist(out, 'Создано'); remember(out, 'Создано: ' + $('gPrompt').value.trim().slice(0, 60)); idle(); toast('Готово. Можно сразу улучшить качество или убрать фон.');
    } catch (e) { failed(e, 'Создание'); }
  };

  /* ================= проверка макета ================= */
  let layout = null, pageSel = 0, pdfjs = null;
  bindSeg('kTab', v => { $('kTextCtl').hidden = v !== 'text'; $('kDesignCtl').hidden = v !== 'design'; $('kIssues').hidden = v !== 'text'; $('kDesignOut').hidden = v !== 'design'; });
  async function loadPdfjs() {
    if (pdfjs) return pdfjs;
    pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
    return pdfjs;
  }
  async function openLayoutDialog() { try { const f = await S.openFile('layout'); if (f) openLayout(f); } catch (e) { failed(e); } }
  $('kOpen').onclick = openLayoutDialog; $('kOpen2').onclick = openLayoutDialog;
  async function openLayout(f) {
    $('kStatus').textContent = 'Открываю…'; $('kIssues').innerHTML = ''; $('kDesignOut').textContent = '';
    try {
      const pages = [];
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const lib = await loadPdfjs();
        const pdf = await lib.getDocument({ data: f.bytes, isEvalSupported: false, cMapUrl: './vendor/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/standard_fonts/', wasmUrl: './vendor/wasm/' }).promise;
        for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
          const pg = await pdf.getPage(i);
          const vp1 = pg.getViewport({ scale: 1 });
          const scale = 1800 / Math.max(vp1.width, vp1.height);
          const vp = pg.getViewport({ scale });
          const cv = newCanvas(vp.width, vp.height); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
          await pg.render({ canvasContext: g, viewport: vp }).promise;
          const tc = await pg.getTextContent();
          const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5] }));
          pages.push({ cv, items, text: linesFromItems(items) });
        }
      } else {
        const cv = await fromBytes(f.bytes, f.type);
        pages.push({ cv, items: null, text: null });
      }
      layout = { name: f.name, pages }; pageSel = 0;
      $('kFile').textContent = f.name + ' · ' + pages.length + ' стр.';
      renderPages(); runRuleChecks();
    } catch (e) { $('kStatus').textContent = ''; failed(e, 'Открытие макета'); }
  }
  function linesFromItems(items) {
    const rows = [];
    items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => {
      const row = rows.find(r => Math.abs(r.y - it.y) < 3);
      if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
    });
    return rows.map(r => r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean).join('\n');
  }
  function renderPages() {
    $('pages').innerHTML = layout.pages.map((p, i) => '<button data-i="' + i + '" aria-current="' + (i === pageSel) + '"><img src="' + resize(p.cv, 160, 160 * p.cv.height / p.cv.width).toDataURL('image/jpeg', 0.8) + '" alt="">Стр. ' + (i + 1) + '</button>').join('');
    $('pageEmpty').hidden = true; $('pageImg').hidden = false;
    $('pageImg').src = layout.pages[pageSel].cv.toDataURL('image/jpeg', 0.9);
    $('kAi').disabled = false; $('kDesign').disabled = false;
  }
  $('pages').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b || !layout) return; pageSel = Number(b.dataset.i); renderPages(); });

  // проверки без ИИ — быстрые и предсказуемые
  function ruleIssues(pageNo, strings) {
    const out = [], add = (frag, problem, fix) => out.push({ page: pageNo, fragment: frag, problem, fix, kind: 'rule' });
    strings.forEach(s => {
      const words = s.match(/[\p{L}\p{N}-]+/gu) || [];
      words.forEach(w => { if (/[А-Яа-яЁё]/.test(w) && /[A-Za-z]/.test(w)) add(w, 'В одном слове смешаны русские и латинские буквы — при поиске и печати это ошибка', 'Перепечатать слово одной раскладкой'); });
      let m;
      const reSp = /\S\s+([,.;:!?)»])/g; while ((m = reSp.exec(s))) add(s.slice(Math.max(0, m.index - 10), m.index + m[0].length + 6).trim(), 'Пробел перед знаком препинания', 'Убрать пробел перед «' + m[1] + '»');
      const reNo = /[,;](?=[А-Яа-яЁёA-Za-z])/g; while ((m = reNo.exec(s))) add(s.slice(Math.max(0, m.index - 10), m.index + 10).trim(), 'Нет пробела после запятой', 'Добавить пробел');
      const reDbl = /(^|[\s(«"-])([\p{L}]{2,})\s+\2(?=[\s.,!?)»"]|$)/giu; while ((m = reDbl.exec(s))) add(m[0].replace(/^[\s(«"-]+/, '').trim(), 'Слово повторяется два раза подряд', 'Убрать повтор');
      const reHy = /\S\s-\s\S/g; while ((m = reHy.exec(s))) add(s.slice(Math.max(0, m.index - 8), m.index + 12).trim(), 'Дефис вместо тире', 'Заменить « - » на « — »');
    });
    return out;
  }
  function raz(n) { const m = n % 10, h = n % 100; return m >= 2 && m <= 4 && (h < 12 || h > 14) ? 'раза' : 'раз'; }
  function consistencyIssues(allText) {
    const out = [];
    const count = (re) => (allText.match(re) || []).length;
    const variants = (label, list, fix) => {
      const used = list.map(([name, re]) => [name, count(re)]).filter(([, n]) => n > 0);
      if (used.length > 1) out.push({ page: null, fragment: used.map(([n, c]) => n + ' — ' + c + ' ' + raz(c)).join(', '), problem: 'Разное написание: ' + label.toLowerCase(), fix, kind: 'rule' });
    };
    variants('Граммы', [['«г»', /\d\s?г(?![\p{L}.])/gu], ['«гр»', /\d\s?гр(?![\p{L}.])/gu], ['«гр.»', /\d\s?гр\./gu], ['«g»', /\d\s?g\b/g]], 'Выбрать один вариант, обычно «г»');
    variants('Миллилитры', [['«мл»', /\d\s?мл/gu], ['«ml»', /\d\s?ml\b/gi], ['«л»', /\d[.,]?\d*\s?л(?![\p{L}])/gu]], 'Выбрать один вариант для объёма');
    variants('Валюта', [['«₽»', /₽/g], ['«руб»', /руб(?![\p{L}.])/gu], ['«руб.»', /руб\./gu], ['«р.»', /\d\s?р\./gu]], 'Написать цены одинаково, например «350 ₽»');
    variants('Пробел между числом и единицей', [['с пробелом', /\d\s(г|гр|мл|₽|руб)(?![\p{L}])/gu], ['без пробела', /\d(г|гр|мл|₽|руб)(?![\p{L}])/gu]], 'Одинаково везде, по правилам — с пробелом');
    variants('Тысячи в ценах', [['«1 200»', /\b\d{1,3}\s\d{3}\b/g], ['«1200»', /(?<!\d\s?)\d{4,6}(?=\s?(₽|руб|р\.))/gu], ['«1.200»', /\b\d{1,3}\.\d{3}\b/g]], 'Одинаковая запись тысяч');
    variants('Кавычки', [['«ёлочки»', /[«»]/g], ['"прямые"', /"/g], ['“лапки”', /[“”„]/g]], 'Одни кавычки на весь макет, в русском тексте — «ёлочки»');
    return out;
  }
  function runRuleChecks() {
    if (!layout) return;
    let issues = [], all = '';
    layout.pages.forEach((p, i) => { if (!p.items) return; issues = issues.concat(ruleIssues(i + 1, p.items.map(it => it.s))); all += p.text + '\n'; });
    issues = consistencyIssues(all).concat(issues);
    const noText = layout.pages.every(p => !p.text);
    layout.ruleIssues = issues; layout.aiIssues = layout.aiIssues || [];
    renderIssues();
    $('kStatus').textContent = noText ? 'В файле нет текстового слоя (картинка или текст в кривых). Нажми «Проверить с ИИ» — нейросеть прочитает текст сама, но может ошибиться на мелком шрифте.'
      : 'Быстрая проверка: ' + issues.length + ' замечаний. Для орфографии и смысла нажми «Проверить с ИИ».';
  }
  function renderIssues() {
    const all = (layout.ruleIssues || []).concat(layout.aiIssues || []);
    if (!all.length) { $('kIssues').innerHTML = '<div class="empty-small">Замечаний пока нет</div>'; return; }
    $('kIssues').innerHTML = all.map(x => '<div class="issue ' + (x.kind === 'ai' ? 'sev-ai' : 'sev-rule') + '"><span class="tag">' + (x.kind === 'ai' ? 'ИИ' : 'Правило') + (x.page ? ' · стр. ' + x.page : ' · весь макет') + '</span>' +
      (x.fragment ? '<span class="frag">' + esc(x.fragment) + '</span>' : '') + '<span>' + esc(x.problem) + '</span>' + (x.fix ? '<span class="fix">→ ' + esc(x.fix) + '</span>' : '') + '</div>').join('');
  }
  function kProgress(p, text) { $('kBar').hidden = p == null; if (p != null) $('kBar').firstElementChild.style.width = Math.round(p * 100) + '%'; if (text != null) $('kStatus').textContent = text; }
  async function chatOnce(messages, opts) {
    const id = 'k' + Date.now() + Math.random();
    const r = await S.chat(id, Object.assign({ messages, temperature: 0.2, max_tokens: 2048 }, opts || {}));
    return r.text;
  }
  function imgMsg(text, dataUrl) { return { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text }] }; }
  function strips(cv) {
    const W = 1280, k = W / cv.width, H = cv.height * k, out = [];
    const sh = 1100, step = 950;
    for (let y = 0; y < H; y += step) { const h = Math.min(sh, H - y); const c = newCanvas(W, h); c.getContext('2d').drawImage(cv, 0, y / k, cv.width, h / k, 0, 0, W, h); out.push(c); if (y + h >= H) break; }
    return out;
  }
  const PROOF = 'Ты опытный корректор меню кафе и ресторанов. Проверь текст ниже. Ищи: орфографические ошибки и опечатки, неправильные окончания и согласование, пунктуацию, ошибки в названиях блюд и ингредиентов, странные или подозрительные цены (0, пропущенная цена, явно лишняя цифра), смешение стилей написания. Не придирайся к стилю, если ошибки нет. Ответь ТОЛЬКО JSON: {"issues":[{"fragment":"точная цитата с ошибкой","problem":"что не так, коротко","fix":"как правильно"}]}. Если ошибок нет — {"issues":[]}.\n\nТекст страницы:\n';
  $('kAi').onclick = async () => {
    if (!layout) return;
    if (!packOf('text').ready) { toast('Сначала скачай модели «Проверка макета и ассистент»'); return; }
    $('kAi').disabled = true; layout.aiIssues = []; renderIssues();
    try {
      for (let i = 0; i < layout.pages.length; i++) {
        const p = layout.pages[i];
        kProgress(i / layout.pages.length, eng.state === 'ready' && eng.kind === 'text' ? 'Проверяю страницу ' + (i + 1) + ' из ' + layout.pages.length + '…' : 'Загружаю нейросеть для текста… первый раз до минуты.');
        let text = p.text;
        if (!text) {
          const parts = [];
          for (const s of strips(p.cv)) parts.push(await chatOnce([imgMsg('Перепиши весь текст с этого фрагмента меню точно как написано, построчно, без комментариев. Сохраняй цены и единицы.', s.toDataURL('image/jpeg', 0.92))], { max_tokens: 1500 }));
          text = p.text = parts.join('\n');
          layout.ruleIssues = layout.ruleIssues.concat(ruleIssues(i + 1, text.split('\n')));
        }
        for (const chunk of chunkText(text, 3500)) {
          const raw = await chatOnce([{ role: 'user', content: PROOF + chunk }], { response_format: { type: 'json_object' } });
          let j = null; try { j = JSON.parse(raw); } catch (e) { const m = raw.match(/\{[\s\S]*\}/); if (m) try { j = JSON.parse(m[0]); } catch (e2) { /* нет JSON */ } }
          (j && Array.isArray(j.issues) ? j.issues : []).forEach(x => { if (x && x.problem) layout.aiIssues.push({ page: i + 1, fragment: String(x.fragment || ''), problem: String(x.problem), fix: x.fix ? String(x.fix) : '', kind: 'ai' }); });
          renderIssues();
        }
      }
      kProgress(null, 'Готово. ИИ нашёл ' + layout.aiIssues.length + ', правила — ' + layout.ruleIssues.length + '. ИИ может ошибаться: перепроверяй его замечания.');
    } catch (e) { kProgress(null, ''); failed(e, 'Проверка'); }
    $('kAi').disabled = false;
  };
  function chunkText(t, n) { const lines = t.split('\n'), out = []; let cur = ''; lines.forEach(l => { if ((cur + l).length > n && cur) { out.push(cur); cur = ''; } cur += l + '\n'; }); if (cur.trim()) out.push(cur); return out; }
  $('kDesign').onclick = async () => {
    if (!layout) return;
    if (!packOf('text').ready) { toast('Сначала скачай модели «Проверка макета и ассистент»'); return; }
    $('kDesign').disabled = true; $('kDesignOut').textContent = '';
    const p = layout.pages[pageSel];
    const img = resize(p.cv, 1280 * p.cv.width / Math.max(p.cv.width, p.cv.height), 1280 * p.cv.height / Math.max(p.cv.width, p.cv.height)).toDataURL('image/jpeg', 0.9);
    const id = 'd' + Date.now();
    pendingStream[id] = (t) => { $('kDesignOut').textContent = t; };
    kProgress(null, eng.kind === 'text' && eng.state === 'ready' ? 'Смотрю на страницу…' : 'Загружаю нейросеть для текста…');
    try {
      await S.chat(id, { messages: [imgMsg('Ты арт-директор, который делает меню для ресторанов. Посмотри на эту страницу меню и дай 5–8 конкретных замечаний по-русски: читаемость (размер и контраст текста), иерархия (видно ли разделы, названия, цены), выравнивание и отступы, единообразие шрифтов и стилей, баланс и пустые места, удобство поиска цены. У каждого замечания укажи, где именно на странице, и как исправить. Пиши кратко, списком. Если что-то сделано хорошо — одной строкой отметь в конце.', img)], temperature: 0.4, max_tokens: 1200 });
      kProgress(null, 'Готово. Это мнение нейросети — решать тебе.');
    } catch (e) { kProgress(null, ''); failed(e, 'Разбор'); }
    delete pendingStream[id];
    $('kDesign').disabled = false;
  };

  /* ================= ассистент ================= */
  const pendingStream = {};
  S.onChatDelta(({ id, text }) => { if (pendingStream[id]) pendingStream[id](text); });
  // Чаты хранятся в профиле программы (chats.json): список, переключение, удаление.
  const SYS = 'Ты — помощник графического дизайнера: вёрстка меню и афиш, тексты, переводы, идеи и советы по картинкам. Отвечай по-русски, кратко и по делу, без воды. Если просят тексты для меню — пиши аппетитно, но без штампов. Если прислали картинку — опирайся на то, что на ней видно.';
  let chats = [], chatId = null, chatBusy = null, busyChat = null, saveT = 0;
  const curChat = () => chats.find(c => c.id === chatId) || null;
  function saveChats() { clearTimeout(saveT); saveT = setTimeout(() => S.storeSet('chats', { v: 1, current: chatId, chats: chats.filter(c => c.msgs.length) }).catch(e => console.warn(e)), 300); }
  function newChatObj() { return { id: 'ch' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: 'Новый чат', t: Date.now(), msgs: [] }; }
  function newChat() {
    const c = curChat();
    if (c && !c.msgs.length) { $('chatIn').focus(); return; }
    const n = newChatObj(); chats.unshift(n); chatId = n.id; renderChatList(); renderMsgs(); $('chatIn').focus();
  }
  function openChat(id) { chatId = id; renderChatList(); renderMsgs(); saveChats(); }
  function deleteChat(id) {
    if (busyChat && busyChat.id === id && chatBusy) S.chatCancel(chatBusy);
    chats = chats.filter(c => c.id !== id);
    if (chatId === id) { const nx = chats.find(c => c.msgs.length) || null; if (nx) chatId = nx.id; else { const n = newChatObj(); chats.unshift(n); chatId = n.id; } }
    renderChatList(); renderMsgs(); saveChats(); toast('Чат удалён');
  }
  function renderChatList() {
    const list = chats.filter(c => c.msgs.length || c.id === chatId);
    $('chatList').innerHTML = list.map(c => '<div class="chatitem" data-id="' + c.id + '" aria-current="' + (c.id === chatId) + '" tabindex="0"><span class="t"><b>' + esc(c.title) + '</b><small>' + (c.msgs.length ? fmtTime(c.t) : 'пустой') + '</small></span>' +
      (c.msgs.length ? '<button class="x" data-del="' + c.id + '" title="Удалить чат" aria-label="Удалить чат">×</button>' : '') + '</div>').join('');
  }
  let delArm = { id: null, t: 0 };
  $('chatList').addEventListener('click', e => {
    const x = e.target.closest('[data-del]');
    if (x) {
      e.stopPropagation();
      if (delArm.id === x.dataset.del && Date.now() - delArm.t < 3000) { delArm.id = null; deleteChat(x.dataset.del); return; }
      delArm = { id: x.dataset.del, t: Date.now() }; x.textContent = 'Удалить?'; x.style.opacity = 1; x.style.width = 'auto'; x.style.fontSize = '12px'; x.style.color = 'var(--danger)';
      setTimeout(renderChatList, 3000); return;
    }
    const it = e.target.closest('.chatitem'); if (it && it.dataset.id !== chatId) openChat(it.dataset.id);
  });
  $('chatList').addEventListener('keydown', e => { const it = e.target.closest('.chatitem'); if (it && e.key === 'Enter') openChat(it.dataset.id); });
  function addMsg(cls, text, img) {
    const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text;
    if (img) { const i = document.createElement('img'); i.src = img; d.append(i); }
    $('msgs').append(d); $('msgs').scrollTop = 1e9; return d;
  }
  let liveBubble = null;
  function renderMsgs() {
    $('msgs').innerHTML = '';
    const c = curChat();
    if (!c || !c.msgs.length) addMsg('sys', 'Помощник дизайнера: тексты и описания, переводы, проверка текста, советы по картинке. Работает на компьютере, без интернета. Каждый разговор сохраняется отдельным чатом слева.');
    if (c) c.msgs.forEach(m => addMsg(m.role === 'user' ? 'me' : 'ai', m.text, m.img));
    liveBubble = null;
    if (chatBusy && busyChat === c) liveBubble = addMsg('ai', busyChat.liveText || 'Думаю…');
    const busyHere = !!chatBusy && busyChat === c;
    $('chatSend').hidden = busyHere; $('chatStop').hidden = !busyHere;
    $('chatClear').disabled = !c || !c.msgs.length;
  }
  function smallImg(dataUrl) {
    return new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(1, 480 / Math.max(im.width, im.height)), c = newCanvas(im.width * k, im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.8)); }; im.onerror = () => res(null); im.src = dataUrl; });
  }
  async function sendChat(textArg, withImg) {
    const text = (textArg != null ? textArg : $('chatIn').value).trim();
    if (!text) return;
    if (chatBusy) { toast('Дождись ответа или нажми «Стоп»'); return; }
    if (!packOf('text').ready) { toast('Сначала скачай модели «Проверка макета и ассистент»'); return; }
    if ((withImg || $('chatImg').checked) && !cur()) { toast('В редакторе нет картинки'); return; }
    const attach = (withImg || $('chatImg').checked) && cur();
    const img = attach ? resize(flatten(cur()), ...(() => { const c = cur(), k = Math.min(1, 1024 / Math.max(c.width, c.height)); return [c.width * k, c.height * k]; })()).toDataURL('image/jpeg', 0.9) : null;
    let c = curChat(); if (!c) { c = newChatObj(); chats.unshift(c); chatId = c.id; }
    $('chatIn').value = '';
    const um = { role: 'user', text, img: img ? await smallImg(img) : null };
    c.msgs.push(um); c.t = Date.now();
    if (c.title === 'Новый чат') c.title = text.replace(/\s+/g, ' ').slice(0, 48);
    chats = [c].concat(chats.filter(x => x !== c));
    // в модель уходят последние 12 сообщений; картинка — только у последнего, раньше — пометкой
    const history = c.msgs.slice(-12).map((m, i, a) => m.role === 'user' && i === a.length - 1 && img ? imgMsg(m.text, img) : { role: m.role, content: m.text + (m.img ? '\n[была приложена картинка]' : '') });
    const id = 'c' + Date.now(); chatBusy = id; busyChat = c; c.liveText = eng.kind === 'text' && eng.state === 'ready' ? 'Думаю…' : 'Загружаю нейросеть… первый раз до минуты.';
    renderChatList(); renderMsgs(); saveChats();
    pendingStream[id] = (t) => { c.liveText = t; if (liveBubble && busyChat === curChat()) { liveBubble.textContent = t; $('msgs').scrollTop = 1e9; } };
    try {
      const r = await S.chat(id, { messages: [{ role: 'system', content: SYS }].concat(history), temperature: 0.6, max_tokens: 1500 });
      if (chats.includes(c)) c.msgs.push({ role: 'assistant', text: r.text || (r.cancelled ? '(остановлено)' : '(пустой ответ)') });
    } catch (e) {
      c.msgs.pop(); if (!c.msgs.length) c.title = 'Новый чат';
      toast('Не получилось: ' + String(e.message).slice(0, 200)); if (e.code === 'missing') setTab('models');
      if (curChat() === c) $('chatIn').value = text;
    }
    delete pendingStream[id]; delete c.liveText; chatBusy = null; busyChat = null;
    renderChatList(); if (curChat() === c || !curChat()) renderMsgs(); else { $('chatSend').hidden = false; $('chatStop').hidden = true; }
    saveChats();
  }
  $('chatSend').onclick = () => sendChat();
  $('chatStop').onclick = () => { if (chatBusy) S.chatCancel(chatBusy); };
  $('chatIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
  $('chatChips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.img) { sendChat(b.dataset.p, true); return; }
    $('chatIn').value = b.dataset.p; $('chatIn').focus();
  });
  $('chatNew').onclick = newChat;
  $('chatClear').onclick = () => { const c = curChat(); if (!c || !c.msgs.length) return; if (delArm.id === 'cur' && Date.now() - delArm.t < 3000) { delArm.id = null; $('chatClear').textContent = 'Удалить чат'; deleteChat(c.id); return; } delArm = { id: 'cur', t: Date.now() }; $('chatClear').textContent = 'Точно удалить?'; setTimeout(() => { $('chatClear').textContent = 'Удалить чат'; }, 3000); };
  async function loadChats() {
    try { const d = await S.storeGet('chats'); if (d && Array.isArray(d.chats)) { chats = d.chats.filter(c => c && c.id && Array.isArray(c.msgs)); chatId = d.current; } } catch (e) { console.warn(e); }
    chats.sort((a, b) => b.t - a.t);
    if (!curChat()) { const n = newChatObj(); chats.unshift(n); chatId = n.id; }
    renderChatList(); renderMsgs();
  }

  /* ================= старт ================= */
  setTab('quality');
  loadChats(); histRefresh();
  refreshStatus().then(() => { if (st && st.packs.every(p => !p.ready)) { setTab('models'); } });
  window.__studioTest = { remember, histRefresh, getHist: () => hist, getChats: () => chats, prPlace, doPrint, doc, openBytes, pushHist, cur, setTab, maskBox, regionAround, linesFromItems, ruleIssues, consistencyIssues, openLayout, sdGenerate, stroke: (a, b) => stroke(a, b) };
})();
