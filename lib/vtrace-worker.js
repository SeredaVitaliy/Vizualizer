// Фоновый поток векторизации: выравнивание цветов + VTracer. Тяжёлая картинка не подвешивает окно.
'use strict';
const { parentPort } = require('worker_threads');
const path = require('path');
const P = require(path.join(__dirname, '..', 'renderer', 'vectorizer', 'vt-prep.js'));
const vt = require('@visioncortex/vtracer');

function hexToPal(hx) {
  const rgb = [parseInt(hx.slice(1, 3), 16), parseInt(hx.slice(3, 5), 16), parseInt(hx.slice(5, 7), 16)];
  return { hex: hx.toLowerCase(), rgb, lab: P.oklab(rgb[0], rgb[1], rgb[2]), share: 0, locked: true };
}

parentPort.on('message', (msg) => {
  const { id, rgba, w, h, o } = msg;
  const step = (text) => parentPort.postMessage({ id, progress: text });
  try {
    const img = { data: new Uint8Array(rgba), width: w, height: h };
    if (process.env.STUDIO_DUMP) require('fs').writeFileSync(process.env.STUDIO_DUMP, JSON.stringify({ w, h, o, data: Buffer.from(rgba).toString('base64') }));
    const t0 = Date.now();
    if (o.sharpen) { step('Повышаю резкость…'); P.sharpen(img, o.sharpen.radius, o.sharpen.amount); }
    step('Ищу основные цвета…');
    let pal;
    if (o.strict && o.locked && o.locked.length) pal = o.locked.map(hexToPal);
    else pal = P.palette(img, { merge: o.merge, maxColors: o.maxColors || 0, locked: o.locked || [], minShare: o.minShare });
    if (!pal.length) throw new Error('На картинке нет непрозрачных пикселей');
    step('Выравниваю цвета (' + pal.length + ')…');
    const q = P.quantize(img, pal, { cleanup: o.cleanup, minArea: o.minArea, glyphs: o.glyphs !== false });
    step('Строю кривые…');
    const opts = { mode: o.polygon ? 'polygon' : 'spline', hierarchical: 'stacked', palette: pal.map(p => p.hex), filterSpeckle: o.speckle == null ? 2 : o.speckle,
      colorPrecision: 8, layerDifference: 0, cornerThreshold: o.corner || 60, lengthThreshold: o.length || 4, spliceThreshold: 45, pathPrecision: 2 };
    if (o.simplify) opts.simplify = o.simplify;
    const svg = vt.convertPixels(q.rgba, w, h, opts);
    parentPort.postMessage({ id, ok: true, svg, palette: pal.map(p => ({ hex: p.hex, locked: !!p.locked, share: p.share })), ms: Date.now() - t0 });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: String((e && e.message) || e) });
  }
});
