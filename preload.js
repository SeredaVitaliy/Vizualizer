// Мост между интерфейсом и главным процессом. Странице доступны только эти функции.
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a).then(r => { if (!r.ok) { const e = new Error(r.error); e.code = /^missing:/.test(r.error) ? 'missing' : 'error'; throw e; } return r.value; });
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, d) => cb(d));
contextBridge.exposeInMainWorld('studio', {
  status: () => call('status'),
  install: (ids) => call('install', ids),
  cancelInstall: (id) => call('cancel-install', id),
  setSetting: (k, v) => call('set-setting', k, v),
  chooseDataDir: () => call('choose-data-dir'),
  openDataDir: () => call('open-data-dir'),
  engine: (action, kind) => call('engine', action, kind),
  imgApi: (method, path, body) => call('img-api', method, path, body),
  imgApiPeek: (method, path, body) => call('img-api-peek', method, path, body),
  chat: (id, body) => call('chat', id, body),
  chatCancel: (id) => call('chat-cancel', id),
  ort: (id, feeds) => call('ort', id, feeds),
  upscale: (bytes, model) => call('upscale', bytes, model),
  openFile: (kind) => call('open-file', kind),
  saveFile: (name, data) => call('save-file', name, data),
  saveMany: (files) => call('save-many', files),
  histList: () => call('hist-list'), histAdd: (item) => call('hist-add', item), histGet: (id) => call('hist-get', id),
  histDel: (id) => call('hist-del', id), histClear: () => call('hist-clear'), histOpenDir: () => call('hist-open-dir'),
  copyImage: (bytes) => call('copy-image', bytes),
  storeGet: (name) => call('store-get', name), storeSet: (name, data) => call('store-set', name, data),
  print: (job) => call('print', job),
  updateState: () => call('update-state'), updateCheck: () => call('update-check'), updateDownload: () => call('update-download'),
  updateCancel: () => call('update-cancel'), updateInstall: () => call('update-install'), updateOpenPage: () => call('update-open-page'),
  onUpdate: on('update'),
  onJob: on('job'), onStatus: on('status'), onEngine: on('engine'), onChatDelta: on('chat-delta'),
  onUpscaleProgress: on('upscale-progress'), onCommand: on('command')
});
// Векторизатор внутри студии использует тот же мост для сохранения
contextBridge.exposeInMainWorld('desktop', {
  vtrace: (rgba, w, h, o) => call('vtrace', rgba, w, h, o),
  openFile: (kind) => call('open-file', kind),
  onVtraceProgress: on('vtrace-progress'),
  upscale: (bytes, model) => call('upscale', bytes, model),
  canUpscale: () => call('status').then(s => !!(s.packs.find(p => p.id === 'quality') || {}).ready),
  canCutout: () => call('status').then(s => !!(s.packs.find(p => p.id === 'cutout') || {}).ready),
  ort: (id, feeds) => call('ort', id, feeds),
  print: (job) => call('print', job),
  save: (name, data) => call('save-file', name, data).then(p => p ? { path: p } : { canceled: true }),
  saveMany: (files) => call('save-many', files).then(p => p ? { path: p } : { canceled: true }),
  onOpen: () => {}, onCommand: () => {}
});
