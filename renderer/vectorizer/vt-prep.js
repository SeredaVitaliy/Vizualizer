/* Подготовка картинки к векторизации: находим «настоящие» цвета, убираем полутона по краям
   и шум, чтобы участки одного цвета стали ровно одним цветом. Работает и в браузере, и в Node. */
(function (root) {
  'use strict';

  // sRGB -> OKLab (та же метрика, что внутри VTracer)
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function oklab(r, g, b) {
    const R = lin[r], G = lin[g], B = lin[b];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const hex = (c) => '#' + c.map(v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
  function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // Выборка непрозрачных пикселей; вес краёв понижаем, чтобы полутона не становились отдельными цветами
  function sample(img, max) {
    const { data, width: w, height: h } = img, n = w * h, step = Math.max(1, Math.floor(n / max));
    const out = [];
    for (let p = 0; p < n; p += step) {
      const i = p * 4; if (data[i + 3] < 128) continue;
      const x = p % w, y = (p / w) | 0;
      let edge = 0;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        for (const q of [i - 4, i + 4, i - w * 4, i + w * 4]) edge = Math.max(edge, Math.abs(data[q] - r) + Math.abs(data[q + 1] - g) + Math.abs(data[q + 2] - b));
      }
      if (edge > 90) continue; // пиксель на резком перепаде — скорее всего полутон сглаживания
      out.push([data[i], data[i + 1], data[i + 2]]);
    }
    return out;
  }

  function kmeans(pts, k, iters) {
    const labs = pts.map(p => oklab(p[0], p[1], p[2]));
    const rand = rng(11); k = Math.min(k, labs.length);
    const C = [labs[Math.floor(rand() * labs.length)]], d = new Float64Array(labs.length).fill(Infinity);
    while (C.length < k) {
      let sum = 0; const last = C[C.length - 1];
      for (let i = 0; i < labs.length; i++) { const q = dist2(labs[i], last); if (q < d[i]) d[i] = q; sum += d[i]; }
      if (!sum) break;
      let t = rand() * sum, j = 0; for (; j < labs.length - 1; j++) { t -= d[j]; if (t <= 0) break; }
      C.push(labs[j]);
    }
    let assign = new Int32Array(labs.length);
    for (let it = 0; it < (iters || 12); it++) {
      const acc = C.map(() => [0, 0, 0, 0, 0, 0, 0]);
      for (let i = 0; i < labs.length; i++) {
        let best = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const q = dist2(labs[i], C[c]); if (q < bd) { bd = q; best = c; } }
        assign[i] = best; const A = acc[best]; A[0] += labs[i][0]; A[1] += labs[i][1]; A[2] += labs[i][2]; A[3]++; A[4] += pts[i][0]; A[5] += pts[i][1]; A[6] += pts[i][2];
      }
      C.forEach((c, j) => { const A = acc[j]; if (A[3]) C[j] = [A[0] / A[3], A[1] / A[3], A[2] / A[3]]; });
      if (it === (iters || 12) - 1) return C.map((c, j) => ({ lab: c, n: acc[j][3], rgb: acc[j][3] ? [acc[j][4] / acc[j][3], acc[j][5] / acc[j][3], acc[j][6] / acc[j][3]] : null })).filter(c => c.n);
    }
  }

  /* Автоматическая палитра: много кластеров, затем слияние близких оттенков.
     merge — порог слияния в OKLab (0.02 ~ едва заметно, 0.08 ~ явно разные оттенки одного цвета). */
  function palette(img, opts) {
    opts = opts || {};
    const pts = sample(img, 120000);
    if (!pts.length) return [];
    let cl = kmeans(pts, Math.min(opts.maxK || 40, Math.max(2, pts.length >> 3)), 14);
    const total = cl.reduce((a, c) => a + c.n, 0);
    cl.sort((a, b) => b.n - a.n);
    const merge2 = (opts.merge == null ? 0.045 : opts.merge) ** 2;
    const heads = [];
    for (const c of cl) {
      const h = heads.find(x => dist2(x.lab, c.lab) < merge2);
      if (h) { const n = h.n + c.n; h.rgb = h.rgb.map((v, i) => (v * h.n + c.rgb[i] * c.n) / n); h.lab = h.lab.map((v, i) => (v * h.n + c.lab[i] * c.n) / n); h.n = n; }
      else heads.push({ lab: c.lab.slice(), rgb: c.rgb.slice(), n: c.n });
    }
    const minShare = opts.minShare == null ? 0.0015 : opts.minShare;
    let keep = heads.filter(h => h.n / total >= minShare);
    // оттенок, лежащий «между» двумя крупными цветами и занимающий мало места, — это полутон сглаживания
    keep = keep.filter((c, ci) => {
      if (c.n / total > 0.03) return true;
      for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) {
        if (i === ci || j === ci || keep[i].n < c.n * 2 || keep[j].n < c.n * 2) continue;
        const A = keep[i].lab, B = keep[j].lab, ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
        if (!L2) continue;
        const t = ((c.lab[0] - A[0]) * ab[0] + (c.lab[1] - A[1]) * ab[1] + (c.lab[2] - A[2]) * ab[2]) / L2;
        if (t < 0.08 || t > 0.92) continue;
        const P = [A[0] + ab[0] * t, A[1] + ab[1] * t, A[2] + ab[2] * t];
        const lim = c.n / total < 0.01 ? Math.min(0.3 * Math.sqrt(L2), 0.07) : Math.min(0.25 * Math.sqrt(L2), 0.035);
        if (dist2(P, c.lab) < lim * lim) return false;
      }
      return true;
    });
    if (opts.maxColors && keep.length > opts.maxColors) keep = keep.slice(0, opts.maxColors);
    // Проверка остатка: если для заметной группы пикселей в палитре нет похожего цвета
    // (например, белая шерсть в синей тени монитора), добавляем недостающие цвета, иначе пиксели «прилипнут» к чужому.
    const labsAll = pts.map(p => oklab(p[0], p[1], p[2]));
    for (let pass = 0; pass < 2; pass++) {
      const K = keep.length, far = [], farL = [];
      const pairOk = K <= 20;
      for (let i = 0; i < labsAll.length; i++) {
        const L = labsAll[i]; let d = Infinity;
        for (let k = 0; k < K; k++) { const q = dist2(L, keep[k].lab); if (q < d) d = q; }
        if (d < 0.07 * 0.07) continue;
        if (pairOk) { // объясняется смесью двух цветов (полутон на границе) — не новый цвет
          let mix = false;
          for (let a = 0; a < K && !mix; a++) for (let b = a + 1; b < K; b++) {
            const A = keep[a].lab, B = keep[b].lab, ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; if (!L2) continue;
            let t = ((L[0] - A[0]) * ab[0] + (L[1] - A[1]) * ab[1] + (L[2] - A[2]) * ab[2]) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            if ((L[0] - A[0] - ab[0] * t) ** 2 + (L[1] - A[1] - ab[1] * t) ** 2 + (L[2] - A[2] - ab[2] * t) ** 2 < 0.055 * 0.055) { mix = true; break; }
          }
          if (mix) continue;
        }
        far.push(pts[i]); farL.push(L);
      }
      if (far.length < Math.max(30, labsAll.length * 0.0015)) break;
      const add = kmeans(far, Math.min(10, Math.max(1, Math.round(far.length / (labsAll.length * 0.004)))), 10) || [];
      let added = 0;
      add.sort((x, y) => y.n - x.n).forEach(c => {
        if (c.n < labsAll.length * 0.0008) return;
        if (keep.some(k => dist2(k.lab, c.lab) < merge2)) return;
        keep.push({ lab: c.lab, rgb: c.rgb, n: c.n }); added++;
      });
      if (!added) break;
    }
    if (opts.locked && opts.locked.length) {
      // зафиксированные цвета заменяют ближайшие найденные
      opts.locked.forEach(hx => {
        const rgb = [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)], lab = oklab(rgb[0], rgb[1], rgb[2]);
        let bi = -1, bd = Infinity; keep.forEach((k, i) => { if (k.locked) return; const q = dist2(k.lab, lab); if (q < bd) { bd = q; bi = i; } });
        if (bi >= 0 && bd < 0.12 ** 2) keep[bi] = { lab, rgb, n: keep[bi].n, locked: true }; else keep.push({ lab, rgb, n: 0, locked: true });
      });
    }
    return keep.map(h => ({ hex: hex(h.rgb), rgb: h.rgb.map(Math.round), lab: h.lab, share: h.n / total, locked: !!h.locked }));
  }

  /* Каждому пикселю — ближайший цвет палитры, затем фильтр большинства 3×3:
     убирает одиночные пиксели и «бахрому» полутонов по краям. */
  function quantize(img, pal, opts) {
    opts = opts || {};
    const { data, width: w, height: h } = img, n = w * h;
    const labs = pal.map(p => p.lab), K = pal.length;
    let lab = new Uint8Array(n); const cache = new Map();
    // Пиксель может быть смесью двух цветов (сглаживание краёв, сжатие). Тогда он достаётся тому цвету, которого в смеси больше,
    // а не случайному третьему, который оказался ближе по оттенку.
    const pairs = [];
    if (K <= 20) for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
      const A = labs[a], B = labs[b], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      if (L2 > 0) pairs.push([a, b, A, ab, L2]);
    }
    function assign(L) {
      let k1 = 0, d1 = Infinity;
      for (let k = 0; k < K; k++) { const q = dist2(L, labs[k]); if (q < d1) { d1 = q; k1 = k; } }
      if (d1 < 0.03 ** 2 || !pairs.length) return k1;
      let bestPair = null, bd = Infinity, bt = 0;
      for (const [a, b, A, ab, L2] of pairs) {
        let t = ((L[0] - A[0]) * ab[0] + (L[1] - A[1]) * ab[1] + (L[2] - A[2]) * ab[2]) / L2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const q = (L[0] - A[0] - ab[0] * t) ** 2 + (L[1] - A[1] - ab[1] * t) ** 2 + (L[2] - A[2] - ab[2] * t) ** 2;
        if (q < bd) { bd = q; bestPair = [a, b]; bt = t; }
      }
      if (bestPair && bd < d1 * 0.5) return bt < 0.5 ? bestPair[0] : bestPair[1];
      return k1;
    }
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      if (data[i + 3] < 128) { lab[p] = 255; continue; }
      const key = (data[i] >> 2) << 12 | (data[i + 1] >> 2) << 6 | (data[i + 2] >> 2);
      let c = cache.get(key);
      if (c === undefined) { c = assign(oklab(data[i], data[i + 1], data[i + 2])); cache.set(key, c); }
      lab[p] = c;
    }
    // пиксели на резких перепадах (полутона сглаживания): выбираем только среди цветов сплошных участков рядом
    const edge = new Uint8Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const p = y * w + x, i = p * 4; let g = 0;
      for (const q of [i - 4, i + 4, i - w * 4, i + w * 4]) g = Math.max(g, Math.abs(data[q] - data[i]) + Math.abs(data[q + 1] - data[i + 1]) + Math.abs(data[q + 2] - data[i + 2]));
      if (g > 48) edge[p] = 1;
    }
    const R = 3, fixed = new Uint8Array(lab), cand = new Uint8Array(256);
    if (opts.edgeFix) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x; if (!edge[p] || lab[p] === 255) continue;
      const list = [];
      for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const q = yy * w + xx; if (edge[q]) continue; const v = lab[q]; if (v !== 255 && !cand[v]) { cand[v] = 1; list.push(v); } } }
      const own = lab[p];
      if (list.length && list.indexOf(own) < 0) {
        const i = p * 4, L = oklab(data[i], data[i + 1], data[i + 2]);
        if (dist2(L, labs[own]) < 0.045 ** 2) {
          // уверенно свой цвет и рядом есть такие же пиксели — тонкий штрих, а не полутон или соринка
          let same = 0;
          for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -2; dx <= 2; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && lab[yy * w + xx] === own) same++; } }
          if (same >= 7) { list.forEach(v => { cand[v] = 0; }); continue; }
        }
        let bd = Infinity, best = own;
        for (const v of list) { const q = dist2(L, labs[v]); if (q < bd) { bd = q; best = v; } cand[v] = 0; }
        fixed[p] = best;
      } else list.forEach(v => { cand[v] = 0; });
    }
    lab = fixed;
    const passes = opts.cleanup == null ? 2 : opts.cleanup;
    const cnt = new Uint16Array(256);
    for (let it = 0; it < passes; it++) {
      const out = new Uint8Array(lab);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const p = y * w + x, me = lab[p];
        let best = me, bc = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = lab[p + dy * w + dx]; cnt[v]++; }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = lab[p + dy * w + dx]; if (cnt[v] > bc || (cnt[v] === bc && v === me)) { bc = cnt[v]; best = v; } }
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[lab[p + dy * w + dx]] = 0;
        if (bc >= 5) out[p] = best;
      }
      lab = out;
    }
    // мелкие «островки» другого цвета (артефакты сжатия, обрывки полутонов) отдаём соседу, с которым у них самая длинная граница
    const minArea = opts.minArea == null ? Math.max(10, Math.round(n * 0.00002)) : opts.minArea;
    if (minArea > 0) {
      const comp = new Int32Array(n).fill(-1), stack = new Int32Array(n), border = new Map();
      let cid = 0;
      for (let p0 = 0; p0 < n; p0++) {
        if (comp[p0] >= 0 || lab[p0] === 255) continue;
        const col = lab[p0]; let sp = 0, size = 0; stack[sp++] = p0; comp[p0] = cid; const members = [];
        border.clear();
        while (sp) {
          const p = stack[--sp]; size++; if (size <= minArea) members.push(p);
          const x = p % w;
          const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1];
          for (const q of nb) {
            if (q < 0) continue;
            const v = lab[q];
            if (v === col) { if (comp[q] < 0) { comp[q] = cid; stack[sp++] = q; } }
            else if (v !== 255) border.set(v, (border.get(v) || 0) + 1);
          }
        }
        if (size < minArea && border.size) {
          let best = -1, bc = 0; border.forEach((c, v) => { if (c > bc) { bc = c; best = v; } });
          for (const p of members) lab[p] = best;
        }
        cid++;
      }
    }
    // Мелкие объекты (буквы, значки): если в них намешаны цвета только по краям — делаем объект одного цвета
    if (opts.glyphs !== false) {
      const bc = new Map();
      for (let x = 0; x < w; x++) { for (const p of [x, n - w + x]) if (lab[p] !== 255) bc.set(lab[p], (bc.get(lab[p]) || 0) + 1); }
      for (let y = 0; y < h; y++) { for (const p of [y * w, y * w + w - 1]) if (lab[p] !== 255) bc.set(lab[p], (bc.get(lab[p]) || 0) + 1); }
      let bg = -1, bgc = 0; bc.forEach((c, v) => { if (c > bgc) { bgc = c; bg = v; } });
      const maxGlyph = Math.max(400, Math.round(n * 0.004));
      const seen = new Uint8Array(n), stack = new Int32Array(n), cnt2 = new Float64Array(256), raw = new Int32Array(256);
      for (let p0 = 0; p0 < n; p0++) {
        if (seen[p0] || lab[p0] === bg || lab[p0] === 255) continue;
        let sp = 0; stack[sp++] = p0; seen[p0] = 1; const mem = []; let big = false;
        while (sp) {
          const p = stack[--sp]; if (!big) { mem.push(p); if (mem.length > maxGlyph) big = true; }
          const x = p % w;
          for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < n - w ? p + w : -1]) {
            if (q < 0 || seen[q]) continue; const v = lab[q]; if (v === bg || v === 255) continue; seen[q] = 1; stack[sp++] = q;
          }
        }
        if (big || mem.length < 4) continue;
        const used = [];
        for (const p of mem) { const v = lab[p]; if (!raw[v]) used.push(v); raw[v]++; cnt2[v] += edge[p] ? 0.25 : 1; }
        if (used.length > 1) {
          let m = used[0]; for (const v of used) if (cnt2[v] > cnt2[m]) m = v;
          for (const p of mem) { const v = lab[p]; if (v !== m && (edge[p] || raw[v] / mem.length < 0.2)) lab[p] = m; }
        }
        for (const v of used) { raw[v] = 0; cnt2[v] = 0; }
      }
    }
    const rgba = new Uint8Array(n * 4);
    for (let p = 0; p < n; p++) { const c = lab[p]; if (c === 255) continue; const r = pal[c].rgb; rgba[p * 4] = r[0]; rgba[p * 4 + 1] = r[1]; rgba[p * 4 + 2] = r[2]; rgba[p * 4 + 3] = 255; }
    const counts = new Array(K).fill(0); for (let p = 0; p < n; p++) if (lab[p] !== 255) counts[lab[p]]++;
    return { rgba, labels: lab, counts };
  }

  // Определить характер картинки, чтобы подобрать порог слияния
  function analyze(img) {
    const pts = sample(img, 60000), bins = new Map();
    pts.forEach(p => { const k = (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4); bins.set(k, (bins.get(k) || 0) + 1); });
    const arr = [...bins.values()].sort((a, b) => b - a);
    let cover = 0, n95 = 0; for (const v of arr) { cover += v; n95++; if (cover >= pts.length * 0.95) break; }
    return n95 <= 40 ? 'logo' : n95 <= 450 ? 'illustration' : 'photo';
  }

  // Нерезкое маскирование: возвращает тонким линиям и мелкому тексту полный цвет после увеличения/сжатия
  function sharpen(img, radius, amount) {
    const { data, width: w, height: h } = img, n = w * h, r = Math.max(1, Math.round(radius));
    const src = new Float32Array(n * 3), tmp = new Float32Array(n * 3), blur = new Float32Array(n * 3);
    for (let p = 0; p < n; p++) { src[p * 3] = data[p * 4]; src[p * 3 + 1] = data[p * 4 + 1]; src[p * 3 + 2] = data[p * 4 + 2]; }
    const box = (inp, out, horiz) => {
      const len = horiz ? w : h, lines = horiz ? h : w, win = 2 * r + 1;
      for (let l = 0; l < lines; l++) for (let c = 0; c < 3; c++) {
        let acc = 0; const at = (i) => { i = i < 0 ? 0 : i >= len ? len - 1 : i; return (horiz ? (l * w + i) : (i * w + l)) * 3 + c; };
        for (let i = -r; i <= r; i++) acc += inp[at(i)];
        for (let i = 0; i < len; i++) { out[at(i)] = acc / win; acc += inp[at(i + r + 1)] - inp[at(i - r)]; }
      }
    };
    blur.set(src);
    for (let k = 0; k < 2; k++) { box(blur, tmp, true); box(tmp, blur, false); }
    for (let p = 0; p < n; p++) for (let c = 0; c < 3; c++) {
      const v = src[p * 3 + c] + amount * (src[p * 3 + c] - blur[p * 3 + c]);
      data[p * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return img;
  }

  const api = { oklab, palette, quantize, analyze, hex, sharpen };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.VTPrep = api;
})(typeof self !== 'undefined' ? self : this);
