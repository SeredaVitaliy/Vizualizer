// Студия — главный процесс: окно, загрузка моделей, запуск локальных нейросетей, файлы.
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, protocol, net, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const catalog = require('./lib/catalog');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const IS_WIN = process.platform === 'win32';
const PORT_IMG = 39151, PORT_TXT = 39152;
const RENDERER = path.join(__dirname, 'renderer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const IMG_MIME = { '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.bmp': 'image/bmp', '.gif': 'image/gif', '.pdf': 'application/pdf' };

let win = null;
if (process.env.STUDIO_USER_DATA) app.setPath('userData', process.env.STUDIO_USER_DATA);

/* ---------------- настройки ---------------- */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
function defaultDataDir() {
  // Пути с кириллицей ломают часть движков на Windows, поэтому по умолчанию — короткая латинская папка в корне диска
  if (IS_WIN) return path.join(process.env.SystemDrive || 'C:', 'StudioAI');
  return path.join(app.getPath('userData'), 'data');
}
let settings = { dataDir: '', hfHost: 'https://huggingface.co', vlm: '8b', files: {} };
function loadSettings() {
  try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'))); } catch (e) { /* первый запуск */ }
  if (!settings.dataDir) settings.dataDir = process.env.STUDIO_DATA_DIR || defaultDataDir();
  if (!settings.files) settings.files = {};
}
function saveSettings() {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); }
}
const D = (...p) => path.join(settings.dataDir, ...p);
const isAscii = (s) => /^[\x20-\x7e]*$/.test(s);

/* ---------------- состояние компонентов ---------------- */
function compInfo(id) {
  const e = catalog.engines[id], m = catalog.models[id], c = e || m;
  const file = settings.files[id];
  const ok = !!file && fs.existsSync(file);
  return { id, kind: e ? 'engine' : 'model', title: c.title, approx: c.approx, license: c.license, installed: ok, file: ok ? file : null, job: jobs[id] || null };
}
function status() {
  const packs = catalog.packs(settings).map(p => {
    const comps = p.needs.map(compInfo);
    return Object.assign({}, p, { comps, ready: comps.every(c => c.installed), missingBytes: comps.filter(c => !c.installed).reduce((a, c) => a + c.approx, 0) });
  });
  let free = null;
  try { fs.mkdirSync(settings.dataDir, { recursive: true }); const st = fs.statfsSync(settings.dataDir); free = st.bavail * st.bsize; } catch (e) { /* нет доступа */ }
  return { packs, dataDir: settings.dataDir, dataDirAscii: isAscii(settings.dataDir), free, hfHost: settings.hfHost, vlm: settings.vlm, engine: engineState(), platform: process.platform };
}
function push(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

/* ---------------- загрузка ---------------- */
const jobs = {};       // id -> {state, done, total, error}
const aborts = {};
async function fetchJson(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Studio/1.0', Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + url);
  return r.json();
}
async function resolveUrl(id) {
  const e = catalog.engines[id];
  if (e) {
    const base = (process.env.STUDIO_GH_API || 'https://api.github.com') + '/repos/' + e.gh.repo + '/releases/';
    let rel = null;
    try { rel = await fetchJson(base + 'tags/' + e.gh.tag); } catch (err) { /* выпуск удалён — берём последний */ }
    let asset = rel && rel.assets.find(a => e.gh.pattern.test(a.name));
    if (!asset) { rel = await fetchJson(base + 'latest'); asset = rel.assets.find(a => e.gh.pattern.test(a.name)); }
    if (!asset) throw new Error('В релизе ' + e.gh.repo + ' нет сборки для Windows с Vulkan');
    return { url: asset.browser_download_url, name: asset.name, size: asset.size };
  }
  const m = catalog.models[id];
  const host = settings.hfHost.replace(/\/+$/, '');
  const list = await fetchJson(host + '/api/models/' + m.hf.repo + '/tree/main?recursive=true');
  const files = list.filter(f => f.type === 'file');
  for (const re of m.hf.patterns) {
    const f = files.find(x => re.test(x.path));
    if (f) return { url: host + '/' + m.hf.repo + '/resolve/main/' + f.path.split('/').map(encodeURIComponent).join('/'), name: path.basename(f.path), size: (f.lfs && f.lfs.size) || f.size };
  }
  throw new Error('В репозитории ' + m.hf.repo + ' не нашёлся нужный файл');
}
async function downloadTo(url, dest, size, id, extraHeaders) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let have = 0;
  try { have = (await fsp.stat(part)).size; } catch (e) { have = 0; }
  if (size && have >= size) { await fsp.rename(part, dest); return; }
  const ctl = new AbortController(); aborts[id] = ctl;
  const headers = Object.assign({ 'User-Agent': 'Studio/1.0' }, extraHeaders || {});
  if (have > 0) headers.Range = 'bytes=' + have + '-';
  const r = await net.fetch(url, { headers, signal: ctl.signal });
  if (!(r.status === 200 || r.status === 206)) throw new Error('Сервер ответил ' + r.status);
  if (r.status === 200) have = 0;
  const total = size || (Number(r.headers.get('content-length')) + have) || 0;
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  const reader = r.body.getReader();
  let done = have, last = 0;
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
      done += value.length;
      const now = Date.now();
      if (now - last > 250) { last = now; jobs[id] = { state: 'download', done, total }; push('job', { id, job: jobs[id] }); }
    }
  } finally { await new Promise(res => out.end(res)); delete aborts[id]; }
  if (total && done < total) throw new Error('Загрузка прервалась, нажми «Скачать» ещё раз — она продолжится');
  await fsp.rename(part, dest);
}
function findFile(dir, name) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { const r = findFile(p, name); if (r) return r; }
    else if (ent.name.toLowerCase() === name.toLowerCase()) return p;
  }
  return null;
}
async function install(id) {
  if (jobs[id] && jobs[id].state !== 'error') return;
  const e = catalog.engines[id];
  try {
    jobs[id] = { state: 'resolve', done: 0, total: 0 }; push('job', { id, job: jobs[id] });
    const src = await resolveUrl(id);
    const fetchRetry = async (dest) => {
      for (let attempt = 1; ; attempt++) {
        try { await downloadTo(src.url, dest, src.size, id); return; }
        catch (err) {
          if (attempt >= 5 || /aborted|AbortError|ENOSPC/i.test(String(err && err.message))) throw err;
          jobs[id] = { state: 'download', done: jobs[id] && jobs[id].done || 0, total: src.size || 0, retry: attempt }; push('job', { id, job: jobs[id] });
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
    };
    if (e) {
      const zip = D('downloads', src.name);
      await fetchRetry(zip);
      jobs[id] = { state: 'unpack', done: 0, total: 0 }; push('job', { id, job: jobs[id] });
      const dir = D('engines', id);
      await fsp.rm(dir, { recursive: true, force: true });
      const AdmZip = require('adm-zip');
      await new Promise((res, rej) => new AdmZip(zip).extractAllToAsync(dir, true, false, err => err ? rej(err) : res()));
      const exe = findFile(dir, e.exe);
      if (!exe) throw new Error('В архиве не найден ' + e.exe);
      settings.files[id] = exe;
      await fsp.rm(zip, { force: true });
    } else {
      const dest = D('models', id, src.name);
      await fetchRetry(dest);
      settings.files[id] = dest;
    }
    saveSettings();
    delete jobs[id];
  } catch (err) {
    jobs[id] = { state: 'error', error: friendlyNetError(err) };
  }
  push('job', { id, job: jobs[id] || null }); push('status', status());
}
function friendlyNetError(err) {
  const m = String((err && err.message) || err);
  if (/aborted|AbortError/i.test(m)) return 'Загрузка остановлена';
  if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ENOTFOUND/i.test(m)) return 'Нет интернета или сайт недоступен';
  if (/ERR_CONNECTION|ETIMEDOUT|ECONNRESET|ERR_TIMED_OUT|ERR_CONTENT_LENGTH|ERR_HTTP2|прервалась/i.test(m)) return 'Соединение оборвалось. Нажми «Скачать» ещё раз — загрузка продолжится. Если повторяется, включи зеркало в настройках ниже';
  if (/ENOSPC/i.test(m)) return 'Не хватает места на диске';
  return m;
}

/* ---------------- движки ---------------- */
let engine = { kind: null, proc: null, state: 'off', log: [], error: null };
function engineState() { return { kind: engine.kind, state: engine.state, error: engine.error }; }
function setEngine(patch) { Object.assign(engine, patch); push('engine', engineState()); }
function addLog(s) { String(s).split(/\r?\n/).forEach(l => { if (l.trim()) engine.log.push(l); }); if (engine.log.length > 400) engine.log.splice(0, engine.log.length - 400); }
async function stopEngine() {
  const p = engine.proc;
  if (!p) { setEngine({ kind: null, state: 'off', error: null }); return; }
  engine.proc = null;
  await new Promise(res => {
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* уже завершён */ } res(); }, 4000);
    p.once('exit', () => { clearTimeout(t); res(); });
    try { p.kill(); } catch (e) { clearTimeout(t); res(); }
  });
  setEngine({ kind: null, state: 'off', error: null });
}
function need(...ids) {
  const miss = ids.filter(id => !compInfo(id).installed);
  if (miss.length) throw new Error('missing:' + miss.join(','));
  return ids.map(id => settings.files[id]);
}
function engineSpec(kind) {
  if (kind === 'image') {
    const [exe, dm, te, vae] = need('sdcpp', 'klein', 'kleinTe', 'flux2vae');
    return { exe, port: PORT_IMG, args: ['--diffusion-model', dm, '--llm', te, '--vae', vae, '--listen-ip', '127.0.0.1', '--listen-port', String(PORT_IMG), '--offload-to-cpu', '--vae-tiling', '--steps', '4', '--cfg-scale', '1.0', '--sampling-method', 'euler'],
      ready: async () => { const r = await localJson(PORT_IMG, 'GET', '/sdcpp/v1/models/status'); if (r.json && r.json.state === 'error') throw new Error(r.json.error || 'Модель не загрузилась'); return r.status === 200 && r.json && r.json.state === 'ready'; } };
  }
  const ids = settings.vlm === '4b' ? ['llama', 'vlm4', 'vlm4proj'] : ['llama', 'vlm8', 'vlm8proj'];
  const [exe, m, proj] = need(...ids);
  return { exe, port: PORT_TXT, args: ['-m', m, '--mmproj', proj, '--host', '127.0.0.1', '--port', String(PORT_TXT), '-c', '8192', '--jinja', '-np', '1'],
    ready: async () => { const r = await localJson(PORT_TXT, 'GET', '/health'); return r.status === 200; } };
}
let starting = null;
async function ensureEngine(kind) {
  if (engine.kind === kind && engine.state === 'ready' && engine.proc) return;
  if (starting) { await starting.catch(() => {}); if (engine.kind === kind && engine.state === 'ready') return; }
  starting = (async () => {
    const spec = engineSpec(kind);
    await stopEngine();
    engine.log = [];
    setEngine({ kind, state: 'starting', error: null });
    addLog('> ' + path.basename(spec.exe) + ' ' + spec.args.join(' '));
    const p = spawn(spec.exe, spec.args, { cwd: path.dirname(spec.exe), windowsHide: true });
    engine.proc = p;
    let exited = null;
    p.stdout.on('data', addLog); p.stderr.on('data', addLog);
    p.on('exit', code => { exited = code; if (engine.proc === p) { engine.proc = null; setEngine({ kind: null, state: 'off', error: engine.state === 'ready' ? 'Нейросеть неожиданно закрылась (код ' + code + ')' : null }); } });
    p.on('error', err => { exited = -1; addLog(String(err)); });
    const t0 = Date.now();
    while (Date.now() - t0 < 6 * 60e3) {
      if (exited !== null) throw new Error('Движок закрылся при запуске. ' + lastLog());
      try { if (await spec.ready()) { setEngine({ state: 'ready' }); return; } } catch (err) { if (!/fetch failed|ECONNREFUSED/i.test(String(err.message))) throw err; }
      await new Promise(r => setTimeout(r, 800));
    }
    throw new Error('Движок не запустился за 6 минут. ' + lastLog());
  })();
  try { await starting; }
  catch (err) { await stopEngine(); setEngine({ state: 'error', error: String(err.message || err) }); throw err; }
  finally { starting = null; }
}
function lastLog() { return engine.log.slice(-6).join(' | ').slice(-600); }

async function localJson(port, method, p, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch('http://127.0.0.1:' + port + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { /* не JSON */ }
    return { status: r.status, json, text: json ? undefined : text.slice(0, 2000) };
  } finally { clearTimeout(t); }
}

/* ---------------- ONNX (фон, удаление предметов) ---------------- */
let ort = null; const sessions = {};
async function session(id) {
  if (sessions[id]) return sessions[id];
  const [file] = need(id);
  if (!ort) ort = require('onnxruntime-node');
  let s = null;
  for (const ep of (IS_WIN ? [['dml'], ['cpu']] : [['cpu']])) {
    try { s = await ort.InferenceSession.create(file, { executionProviders: ep, graphOptimizationLevel: 'all' }); s._ep = ep[0]; break; }
    catch (err) { if (ep[0] === 'cpu') throw err; }
  }
  sessions[id] = s; return s;
}
async function ortRun(id, feeds) {
  const s = await session(id);
  const inputs = {};
  const names = s.inputNames.slice();
  // feeds: {role: {data, dims}}; роли «image» и «mask» сопоставляем по имени входа, остальное — по порядку
  const roles = Object.keys(feeds);
  roles.forEach((role, i) => {
    let name = names.find(n => n.toLowerCase().includes(role));
    if (!name) name = names.filter(n => !Object.values(inputs).includes(n))[i] || names[i];
    inputs[name] = new ort.Tensor('float32', Float32Array.from(feeds[role].data), feeds[role].dims);
  });
  let out;
  try { out = await s.run(inputs); }
  catch (err) {
    if (s._ep === 'dml') { delete sessions[id]; const c = await ort.InferenceSession.create(settings.files[id], { executionProviders: ['cpu'] }); c._ep = 'cpu'; sessions[id] = c; out = await c.run(inputs); }
    else throw err;
  }
  const first = out[s.outputNames[0]] || out[Object.keys(out)[0]];
  return { data: first.data, dims: first.dims, ep: sessions[id]._ep };
}

/* ---------------- улучшение качества ---------------- */
async function upscale(bytes, model) {
  const [exe] = need('esrgan');
  const tmp = D('tmp'); await fsp.mkdir(tmp, { recursive: true });
  const stamp = Date.now() + '-' + Math.floor(Math.random() * 1e6);
  const inp = path.join(tmp, 'in-' + stamp + '.png'), out = path.join(tmp, 'out-' + stamp + '.png');
  await fsp.writeFile(inp, Buffer.from(bytes));
  const args = ['-i', inp, '-o', out, '-n', model === 'art' ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus', '-s', '4', '-f', 'png'];
  const log = [];
  try {
    await new Promise((res, rej) => {
      const p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
      p.stdout.on('data', d => log.push(String(d))); p.stderr.on('data', d => {
        const s = String(d); log.push(s);
        const m = s.match(/(\d+(?:[.,]\d+)?)%/); if (m) push('upscale-progress', parseFloat(m[1].replace(',', '.')));
      });
      p.on('error', rej);
      p.on('exit', code => code === 0 ? res() : rej(new Error('Real-ESRGAN завершился с кодом ' + code + '. ' + log.join('').slice(-400))));
    });
    return await fsp.readFile(out);
  } finally { fsp.rm(inp, { force: true }); fsp.rm(out, { force: true }); }
}

/* ---------------- векторизация (VTracer в отдельном потоке) ---------------- */
let vtWorker = null; const vtJobs = {}; let vtSeq = 0;
function vtraceWorker() {
  if (vtWorker) return vtWorker;
  const { Worker } = require('worker_threads');
  // внутри упакованной программы файлы для потока лежат рядом с архивом app.asar
  const file = path.join(__dirname.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked'), 'lib', 'vtrace-worker.js');
  vtWorker = new Worker(file);
  vtWorker.on('message', m => {
    const j = vtJobs[m.id]; if (!j) return;
    if (m.progress) { push('vtrace-progress', m.progress); return; }
    delete vtJobs[m.id]; m.ok ? j.res(m) : j.rej(new Error(m.error));
  });
  vtWorker.on('error', err => { Object.values(vtJobs).forEach(j => j.rej(err)); for (const k in vtJobs) delete vtJobs[k]; vtWorker = null; });
  vtWorker.on('exit', () => { vtWorker = null; });
  return vtWorker;
}
function vtrace(rgba, w, h, o) {
  return new Promise((res, rej) => {
    const id = ++vtSeq; vtJobs[id] = { res, rej };
    const buf = Buffer.from(rgba); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    vtraceWorker().postMessage({ id, rgba: ab, w, h, o }, [ab]);
  });
}

/* ---------------- чат с потоковой выдачей ---------------- */
const chats = {};
async function chatStream(id, body) {
  await ensureEngine('text');
  const ctl = new AbortController(); chats[id] = ctl;
  let text = '';
  try {
    const r = await fetch('http://127.0.0.1:' + PORT_TXT + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ stream: true }, body)), signal: ctl.signal });
    if (!r.ok) throw new Error('Нейросеть ответила ' + r.status + ': ' + (await r.text()).slice(0, 300));
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (delta) { text += delta; push('chat-delta', { id, text }); } } catch (e) { /* неполная строка */ }
      }
    }
    return { text };
  } catch (err) {
    if (ctl.signal.aborted) return { text, cancelled: true };
    throw err;
  } finally { delete chats[id]; }
}

/* ---------------- IPC ---------------- */
function wrap(fn) { return async (_e, ...a) => { try { return { ok: true, value: await fn(...a) }; } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } }; }
ipcMain.handle('status', wrap(() => status()));
ipcMain.handle('install', wrap(async ids => { for (const id of ids) await install(id); return status(); }));
ipcMain.handle('cancel-install', wrap(id => { if (aborts[id]) aborts[id].abort(); return true; }));
ipcMain.handle('set-setting', wrap(async (k, v) => {
  if (!['hfHost', 'vlm', 'ghToken'].includes(k)) throw new Error('bad key');
  settings[k] = k === 'ghToken' ? String(v || '').trim() : v; saveSettings();
  if (k === 'ghToken') { upd = { state: 'idle' }; return checkUpdate(); }
  if (k === 'vlm' && engine.kind === 'text') await stopEngine();
  return status();
}));
ipcMain.handle('choose-data-dir', wrap(async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка для моделей (нужно ~15 ГБ)', defaultPath: settings.dataDir, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return status();
  await stopEngine();
  settings.dataDir = r.filePaths[0]; settings.files = {};
  // подхватываем уже скачанное в новой папке
  for (const id of Object.keys(Object.assign({}, catalog.engines, catalog.models))) {
    const dir = catalog.engines[id] ? D('engines', id) : D('models', id);
    if (!fs.existsSync(dir)) continue;
    const want = catalog.engines[id] ? catalog.engines[id].exe : null;
    const f = want ? findFile(dir, want) : (fs.readdirSync(dir).filter(n => !n.endsWith('.part')).map(n => path.join(dir, n))[0]);
    if (f) settings.files[id] = f;
  }
  saveSettings(); return status();
}));
ipcMain.handle('open-data-dir', wrap(() => shell.openPath(settings.dataDir)));
ipcMain.handle('engine', wrap(async (action, kind) => {
  if (action === 'stop') { await stopEngine(); return engineState(); }
  if (action === 'log') return engine.log.slice(-120).join('\n');
  await ensureEngine(kind); return engineState();
}));
ipcMain.handle('img-api', wrap(async (method, p, body) => { await ensureEngine('image'); return localJson(PORT_IMG, method, p, body, 120000); }));
ipcMain.handle('img-api-peek', wrap(async (method, p, body) => { if (engine.kind !== 'image' || engine.state !== 'ready') return { status: 0 }; return localJson(PORT_IMG, method, p, body, 30000); }));
ipcMain.handle('chat', wrap((id, body) => chatStream(id, body)));
ipcMain.handle('chat-cancel', wrap(id => { if (chats[id]) chats[id].abort(); return true; }));
ipcMain.handle('ort', wrap((id, feeds) => ortRun(id, feeds)));
ipcMain.handle('upscale', wrap((bytes, model) => upscale(bytes, model)));
ipcMain.handle('vtrace', wrap((rgba, w, h, o) => vtrace(rgba, w, h, o)));
ipcMain.handle('open-file', wrap(async (kind) => {
  const filters = kind === 'layout'
    ? [{ name: 'Макет (PDF или картинка)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] }]
    : kind === 'layout-asset' ? [{ name: 'Картинка, PDF или SVG', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf'] }]
    : kind === 'layout-project' ? [{ name: 'Проект вёрстки', extensions: ['json'] }]
    : [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }];
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0];
  return { name: path.basename(f), type: IMG_MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', bytes: await fsp.readFile(f) };
}));
let lastSaveDir = null;
ipcMain.handle('save-file', wrap(async (name, data) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(lastSaveDir || app.getPath('pictures'), name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  await fsp.writeFile(r.filePath, typeof data === 'string' ? data : Buffer.from(data));
  lastSaveDir = path.dirname(r.filePath);
  return r.filePath;
}));
ipcMain.handle('save-many', wrap(async (files) => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка для файлов', defaultPath: lastSaveDir || app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  for (const f of files) await fsp.writeFile(path.join(r.filePaths[0], path.basename(f.name)), typeof f.data === 'string' ? f.data : Buffer.from(f.data));
  lastSaveDir = r.filePaths[0]; shell.openPath(r.filePaths[0]);
  return r.filePaths[0];
}));

/* ---------------- история картинок («буфер») ---------------- */
// Каждый результат нейросети сохраняется в папку history рядом с моделями: полная картинка и маленькое превью.
const HIST_MAX = 150;
const histDir = () => D('history');
let histChain = Promise.resolve();
const histLock = (fn) => (histChain = histChain.then(fn, fn));
async function histRead() { try { return JSON.parse(await fsp.readFile(path.join(histDir(), 'index.json'), 'utf8')); } catch (e) { return []; } }
async function histWrite(list) { await fsp.mkdir(histDir(), { recursive: true }); await fsp.writeFile(path.join(histDir(), 'index.json'), JSON.stringify(list)); }
const histFile = (e, kind) => path.join(histDir(), e.id + (kind === 'thumb' ? '-t.jpg' : '.' + (e.ext || 'png')));
async function histDrop(e) { await fsp.rm(histFile(e), { force: true }); await fsp.rm(histFile(e, 'thumb'), { force: true }); }
ipcMain.handle('hist-list', wrap(() => histLock(async () => {
  const list = await histRead(), out = [];
  for (const e of list) {
    try { out.push(Object.assign({}, e, { thumb: 'data:image/jpeg;base64,' + (await fsp.readFile(histFile(e, 'thumb'))).toString('base64') })); } catch (err) { /* файл удалён вручную */ }
  }
  return out;
})));
ipcMain.handle('hist-add', wrap((item) => histLock(async () => {
  const list = await histRead();
  const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: String(item.label || '').slice(0, 120), w: item.w | 0, h: item.h | 0, t: Date.now(), ext: item.ext === 'jpg' ? 'jpg' : 'png', src: String(item.src || '').slice(0, 40) };
  await fsp.mkdir(histDir(), { recursive: true });
  await fsp.writeFile(histFile(e), Buffer.from(item.bytes));
  await fsp.writeFile(histFile(e, 'thumb'), Buffer.from(item.thumb));
  list.unshift(e);
  for (const old of list.splice(HIST_MAX)) await histDrop(old);
  await histWrite(list);
  return e;
})));
ipcMain.handle('hist-get', wrap((id) => histLock(async () => {
  const e = (await histRead()).find(x => x.id === id); if (!e) throw new Error('Картинка уже удалена');
  return { bytes: await fsp.readFile(histFile(e)), name: e.label, type: e.ext === 'jpg' ? 'image/jpeg' : 'image/png' };
})));
ipcMain.handle('hist-del', wrap((id) => histLock(async () => {
  const list = await histRead(), i = list.findIndex(x => x.id === id);
  if (i >= 0) { await histDrop(list[i]); list.splice(i, 1); await histWrite(list); }
  return true;
})));
ipcMain.handle('hist-clear', wrap(() => histLock(async () => {
  for (const e of await histRead()) await histDrop(e);
  await histWrite([]); return true;
})));
ipcMain.handle('hist-open-dir', wrap(async () => { await fsp.mkdir(histDir(), { recursive: true }); return shell.openPath(histDir()); }));
ipcMain.handle('copy-image', wrap(async (bytes) => {
  const img = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (typeof clipboard.writeImage === 'function') { clipboard.writeImage(img); return true; }
  const { ClipboardItem } = require('electron');
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
  return true;
}));

/* ---------------- чаты ассистента ---------------- */
const STORE = { chats: 'chats.json' };
ipcMain.handle('store-get', wrap(async (name) => {
  if (!STORE[name]) throw new Error('bad store');
  try { return JSON.parse(await fsp.readFile(path.join(app.getPath('userData'), STORE[name]), 'utf8')); } catch (e) { return null; }
}));
ipcMain.handle('store-set', wrap(async (name, data) => {
  if (!STORE[name]) throw new Error('bad store');
  const f = path.join(app.getPath('userData'), STORE[name]);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f + '.tmp', JSON.stringify(data)); await fsp.rename(f + '.tmp', f);
  return true;
}));

/* ---------------- печать ---------------- */
// job: { paper:{w,h} мм (как лежит лист), duplex:'shortEdge'|'longEdge'|null, title, sheets:[{ items:[{src,x,y,w,h}] }] }
// Каждый лист — отдельная страница; картинки ставятся в миллиметрах. Открывается обычное окно печати Windows.
async function printJob(job) {
  const W = Number(job.paper.w), H = Number(job.paper.h);
  if (!(W > 0 && H > 0) || !Array.isArray(job.sheets) || !job.sheets.length) throw new Error('Нечего печатать');
  const escA = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + escA(job.title || 'Студия') + '</title><style>' +
    '@page{size:' + W + 'mm ' + H + 'mm;margin:0}html,body{margin:0;padding:0;background:#fff}' +
    '.s{position:relative;width:' + W + 'mm;height:' + H + 'mm;overflow:hidden;break-after:page;page-break-after:always}.s:last-child{break-after:auto;page-break-after:auto}' +
    'img{position:absolute;display:block}</style></head><body>' +
    job.sheets.map(s => '<div class="s">' + (s.items || []).map(it => '<img src="' + escA(it.src) + '" style="left:' + it.x + 'mm;top:' + it.y + 'mm;width:' + it.w + 'mm;height:' + it.h + 'mm">').join('') + '</div>').join('') +
    '</body></html>';
  const tmp = D('tmp'); await fsp.mkdir(tmp, { recursive: true });
  const file = path.join(tmp, 'print-' + Date.now() + '.html');
  await fsp.writeFile(file, html);
  const pw = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await pw.loadFile(file);
    if (process.env.STUDIO_PRINT_PDF) { // для проверок: вместо принтера пишем PDF
      const pdf = await pw.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: 'none' } });
      await fsp.writeFile(process.env.STUDIO_PRINT_PDF, pdf); return { ok: true, pdf: process.env.STUDIO_PRINT_PDF };
    }
    const land = W > H;
    const opts = { silent: false, printBackground: true, margins: { marginType: 'none' }, landscape: land,
      pageSize: { width: Math.round(Math.min(W, H) * 1000), height: Math.round(Math.max(W, H) * 1000) } };
    if (job.duplex) opts.duplexMode = job.duplex;
    return await new Promise(res => pw.webContents.print(opts, (ok, reason) => res({ ok, reason: reason || '' })));
  } finally { if (!pw.isDestroyed()) pw.destroy(); fsp.rm(file, { force: true }); }
}
ipcMain.handle('print', wrap(printJob));

/* ---------------- обновление программы ---------------- */
// Новые версии выходят в Releases репозитория. Программа сама проверяет последний выпуск,
// по кнопке скачивает новый exe рядом с текущим, запускает его и закрывается; новая версия удаляет старый exe.
const UPD_REPO = 'SeredaVitaliy/Vizualizer';
const APP_VERSION = require('./package.json').version;
const UPD_ID = 'app-update';
let upd = { state: 'idle' }; // idle | checking | none | available | downloading | ready | private | error
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
const updDir = () => process.env.PORTABLE_EXECUTABLE_DIR || D('updates');
function verCmp(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0), pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}
function ghHeaders() {
  const h = { 'User-Agent': 'Studio/' + APP_VERSION, Accept: 'application/vnd.github+json' };
  if (settings.ghToken) h.Authorization = 'Bearer ' + settings.ghToken;
  return h;
}
function updState() { return Object.assign({}, upd, { current: APP_VERSION, hasToken: !!settings.ghToken, portable: !!portableExe(), repo: UPD_REPO }); }
function updPush() { push('update', updState()); }
async function checkUpdate() {
  if (upd.state === 'downloading' || upd.state === 'checking') return updState();
  const prev = upd; upd = Object.assign({}, prev, { state: 'checking' }); updPush();
  try {
    const r = await net.fetch((process.env.STUDIO_GH_API || 'https://api.github.com') + '/repos/' + UPD_REPO + '/releases/latest', { headers: ghHeaders() });
    if (r.status === 401) upd = { state: 'error', error: 'Ключ доступа GitHub не подходит или истёк' };
    else if (r.status === 404 || r.status === 403) upd = settings.ghToken ? { state: 'error', error: 'Ключ не даёт доступа к репозиторию ' + UPD_REPO } : { state: 'private' };
    else if (!r.ok) throw new Error('GitHub ответил ' + r.status);
    else {
      const j = await r.json(), v = String(j.tag_name || '').replace(/^v/, '');
      const a = (j.assets || []).find(x => /portable\.exe$/i.test(x.name));
      if (a && verCmp(v, APP_VERSION) > 0) {
        const file = path.join(updDir(), a.name);
        let ready = false; try { ready = (await fsp.stat(file)).size === a.size; } catch (e) { /* ещё не скачано */ }
        upd = { state: ready ? 'ready' : 'available', version: v, notes: String(j.body || ''), page: j.html_url, file, asset: { name: a.name, size: a.size, api: a.url, direct: a.browser_download_url } };
      } else upd = { state: 'none' };
    }
  } catch (e) { upd = { state: 'error', error: 'Не удалось проверить: ' + String((e && e.message) || e) }; }
  upd.checkedAt = Date.now(); updPush(); return updState();
}
// у закрытого репозитория файл отдаётся по временной ссылке — получаем её без скачивания
function assetLocation(apiUrl) {
  return new Promise((res, rej) => {
    const h = ghHeaders(); h.Accept = 'application/octet-stream';
    const req = net.request({ url: apiUrl, redirect: 'manual', headers: h });
    req.on('redirect', (code, method, url) => { res(url); try { req.abort(); } catch (e) { /* уже закрыт */ } });
    req.on('response', (r) => { rej(new Error('GitHub ответил ' + r.statusCode)); });
    req.on('error', rej); req.end();
  });
}
async function downloadUpdate() {
  if (upd.state !== 'available' && upd.state !== 'error') return updState();
  if (!upd.asset) { await checkUpdate(); if (upd.state !== 'available') return updState(); }
  const u = upd; upd = Object.assign({}, u, { state: 'downloading', error: '' }); updPush();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const url = settings.ghToken ? await assetLocation(u.asset.api) : u.asset.direct;
        await downloadTo(url, u.file, u.asset.size, UPD_ID);
        break;
      } catch (err) {
        if (attempt >= 5 || /aborted|AbortError|ENOSPC/i.test(String(err && err.message))) throw err;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    if ((await fsp.stat(u.file)).size !== u.asset.size) throw new Error('файл скачался не полностью');
    delete jobs[UPD_ID]; push('job', { id: UPD_ID, job: null });
    upd = Object.assign({}, u, { state: 'ready', error: '' });
  } catch (e) {
    delete jobs[UPD_ID]; push('job', { id: UPD_ID, job: null });
    upd = Object.assign({}, u, { state: 'available', error: /aborted|AbortError/i.test(String(e && e.message)) ? '' : 'Загрузка не удалась: ' + String((e && e.message) || e) });
  }
  updPush(); return updState();
}
async function installUpdate() {
  if (upd.state !== 'ready' || !upd.file) throw new Error('Обновление ещё не скачано');
  if (!portableExe()) { shell.showItemInFolder(upd.file); return { shown: true }; }
  await new Promise((res, rej) => {
    const p = spawn(upd.file, [], { detached: true, stdio: 'ignore', cwd: path.dirname(upd.file) });
    p.once('error', (e) => rej(new Error('Не удалось запустить новую версию: ' + e.message + '. Запусти ' + path.basename(upd.file) + ' вручную.')));
    p.once('spawn', () => { p.unref(); res(); });
  });
  setTimeout(() => app.quit(), 300);
  return { restarting: true };
}
// после обновления: убрать старые версии рядом с текущим exe (старая программа может ещё закрываться — пробуем несколько раз)
async function cleanupOldVersions() {
  const me = portableExe(); if (!me) return;
  const dir = path.dirname(me);
  for (let attempt = 0; attempt < 12; attempt++) {
    let left = 0;
    for (const n of fs.readdirSync(dir)) {
      const m = /^Studio-(\d+\.\d+\.\d+)-portable\.exe(\.part)?$/i.exec(n);
      if (!m || path.join(dir, n).toLowerCase() === me.toLowerCase() || verCmp(m[1], APP_VERSION) >= 0) continue;
      try { await fsp.rm(path.join(dir, n), { force: true }); } catch (e) { left++; }
    }
    if (!left) return;
    await new Promise(r => setTimeout(r, 10000));
  }
}
ipcMain.handle('update-state', wrap(() => updState()));
ipcMain.handle('update-check', wrap(() => checkUpdate()));
ipcMain.handle('update-download', wrap(() => downloadUpdate()));
ipcMain.handle('update-cancel', wrap(() => { if (aborts[UPD_ID]) aborts[UPD_ID].abort(); return true; }));
ipcMain.handle('update-install', wrap(() => installUpdate()));
ipcMain.handle('update-open-page', wrap(() => shell.openExternal(upd.page || 'https://github.com/' + UPD_REPO + '/releases')));

/* ---------------- окно ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640, title: 'Студия', icon: path.join(__dirname, 'renderer', 'icon.png'), backgroundColor: '#eceef2', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, sandbox: true, spellcheck: true }
  });
  win.loadURL('app://studio/index.html');
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
}
function buildMenu() {
  const send = (c) => () => push('command', c);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Файл', submenu: [
      { label: 'Открыть картинку…', accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: send('print') },
      { type: 'separator' }, { role: 'quit', label: 'Выход' }] },
    { label: 'Правка', submenu: [
      { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: send('undo'), registerAccelerator: false },
      { label: 'Повторить', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo'), registerAccelerator: false },
      { type: 'separator' }, { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' }] },
    { label: 'Вид', submenu: [
      { role: 'resetZoom', label: 'Обычный масштаб интерфейса' }, { role: 'zoomIn', label: 'Крупнее' }, { role: 'zoomOut', label: 'Мельче' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Во весь экран' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' }] }
  ]));
}

app.whenReady().then(() => {
  loadSettings();
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER)) return new Response('forbidden', { status: 403 });
    try {
      const data = await fsp.readFile(file);
      return new Response(data, { headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  // системные шрифты нужны конструктору вёрстки (список и встраивание в PDF)
  const ses = require('electron').session.defaultSession;
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(String((details && details.requestingUrl) || '').startsWith('app://') && ['local-fonts', 'clipboard-sanitized-write', 'clipboard-read'].includes(perm)));
  ses.setPermissionCheckHandler((wc, perm, origin) => String(origin || '').startsWith('app://') && ['local-fonts', 'clipboard-sanitized-write', 'clipboard-read'].includes(perm));
  buildMenu(); createWindow();
  // проверка обновлений: через 8 секунд после запуска и раз в 6 часов
  setTimeout(() => { checkUpdate(); cleanupOldVersions().catch(() => {}); }, 8000);
  setInterval(checkUpdate, 6 * 3600 * 1000);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (engine.proc) try { engine.proc.kill(); } catch (e) { /* уже закрыт */ } Object.values(aborts).forEach(a => a.abort()); });
