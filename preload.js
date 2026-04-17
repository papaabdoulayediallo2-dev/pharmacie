const { contextBridge, ipcRenderer } = require('electron');

function db(channel, ...args) { return ipcRenderer.invoke(channel, ...args); }

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Fenêtre ────────────────────────────────────────────
  minimize:    () => ipcRenderer.send('win-minimize'),
  maximize:    () => ipcRenderer.send('win-maximize'),
  close:       () => ipcRenderer.send('win-close'),
  isMaximized: () => ipcRenderer.sendSync('win-is-max'),
  print:       () => ipcRenderer.send('win-print'),
  printPreview:() => ipcRenderer.send('win-print-preview'),
  exportPdfHidden: (name, html) => ipcRenderer.invoke('win-export-pdf-hidden', name, html),
  exportImage:     (name, html) => ipcRenderer.invoke('win-export-image', name, html),
  exportAccounting: (name, start, end, type) => ipcRenderer.invoke('db:exportAccounting', name, start, end, type),
  previewAccounting: (start, end, type, theme) => ipcRenderer.invoke('db:previewAccounting', start, end, type, theme),

  showInFolder:    (path) => ipcRenderer.send('show-in-folder', path),
  imagePreview:    (path) => ipcRenderer.send('win-image-preview', path),
  about:       () => ipcRenderer.send('win-about'),
  onMaximized:  (cb) => ipcRenderer.on('win-maximized',  (_, v) => cb(v)),
  onFullscreen: (cb) => ipcRenderer.on('win-fullscreen', (_, v) => cb(v)),

  // ── Catégories ─────────────────────────────────────────
  getCategories:  (...args) => db('db:getCategories', ...args),
  upsertCategory: (...args) => db('db:upsertCategory', ...args),
  deleteCategory: (...args) => db('db:deleteCategory', ...args),

  // ── Produits ───────────────────────────────────────────
  getProducts:   (...args) => db('db:getProducts', ...args),
  upsertProduct: (...args) => db('db:upsertProduct', ...args),
  deleteProduct: (...args) => db('db:deleteProduct', ...args),
  updateStock:   (...args) => db('db:updateStock', ...args),
  setStock:      (...args) => db('db:setStock', ...args),

  // ── Ventes ─────────────────────────────────────────────
  getSales:    (...args) => db('db:getSales', ...args),
  insertSale:  (...args) => db('db:insertSale', ...args),
  updateSale:  (...args) => db('db:updateSale', ...args),
  deleteSale:  (...args) => db('db:deleteSale', ...args),

  // ── Devis ──────────────────────────────────────────────
  getQuotes:          (...args) => db('db:getQuotes', ...args),
  upsertQuote:        (...args) => db('db:upsertQuote', ...args),
  deleteQuote:        (...args) => db('db:deleteQuote', ...args),
  convertQuoteToSale: (...args) => db('db:convertQuoteToSale', ...args),

  // ── Retours ────────────────────────────────────────────
  getReturns:       (...args) => db('db:getReturns', ...args),
  insertReturn:     (...args) => db('db:insertReturn', ...args),
  insertReturnItems:(...args) => db('db:insertReturnItems', ...args),
  deleteReturn:     (...args) => db('db:deleteReturn', ...args),

  // ── Dépenses ───────────────────────────────────────────
  getExpenses:   (...args) => db('db:getExpenses', ...args),
  upsertExpense: (...args) => db('db:upsertExpense', ...args),
  deleteExpense: (...args) => db('db:deleteExpense', ...args),

  // ── Caisse ─────────────────────────────────────────────
  getCaisseBalance:          (...args) => db('db:getCaisseBalance', ...args),
  getCaisseTransactions:     (...args) => db('db:getCaisseTransactions', ...args),
  addCaisseTransaction:      (...args) => db('db:addCaisseTransaction', ...args),
  deleteCaisseTransaction:   (...args) => db('db:deleteCaisseTransaction', ...args),

  // ── Users ──────────────────────────────────────────────
  getUsers:   (...args) => db('db:getUsers', ...args),
  authUser:   (...args) => db('db:authUser', ...args),
  upsertUser: (...args) => db('db:upsertUser', ...args),
  deleteUser: (...args) => db('db:deleteUser', ...args),

  // ── Patients ───────────────────────────────────────────
  getPatients:   (...args) => db('db:getPatients', ...args),
  upsertPatient: (...args) => db('db:upsertPatient', ...args),
  deletePatient: (...args) => db('db:deletePatient', ...args),

  // ── Corbeille ──────────────────────────────────────────
  getTrash:         (...args) => db('db:getTrash', ...args),
  restoreFromTrash: (...args) => db('db:restoreFromTrash', ...args),
  emptyTrash:       (...args) => db('db:emptyTrash', ...args),
  deleteFromTrash:  (...args) => db('db:deleteFromTrash', ...args),
  moveToTrash:      (e, ei, l, d) => db('db:moveToTrash', e, ei, l, d),

  // ── Paramètres (Settings) ──────────────────────────────────
  getSettings:  (...args) => db('db:getSettings', ...args),
  setSetting:   (...args) => db('db:setSetting', ...args),

  // ── Audit log ──────────────────────────────────────────
  getAuditLog: () => db('db:getAuditLog'),

  // ── DB info & migration ────────────────────────────────
  dbGetInfo:                 ()  => db('db:getInfo'),
  dbMigrateFromLocalStorage: (d) => db('db:migrateFromLocalStorage', d),
  dbOpenFolder:              ()  => ipcRenderer.send('db:openFolder'),
  dbBackup:                  ()  => ipcRenderer.invoke('db:backup'),
  notify:                    (t, m) => ipcRenderer.send('win-notify', { title: t, message: m }),
  savePasswordFile:          (p) => db('save-password-file', p),
  whatsappShow:              (s) => ipcRenderer.send('whatsapp:show', s),
  whatsappSetBounds:         (b) => ipcRenderer.send('whatsapp:set-bounds', b),
  whatsappGetStatus:         ()  => ipcRenderer.invoke('whatsapp:get-status'),
  whatsappSend:              (d) => ipcRenderer.send('whatsapp:send', d),
  whatsappLogout:            ()  => ipcRenderer.invoke('whatsapp:logout'),
  whatsappRefresh:           ()  => ipcRenderer.send('whatsapp:refresh'),
  setAppIcon: (icon) => ipcRenderer.send('win-set-icon', icon),
  setAppName: (name) => ipcRenderer.send('win-set-title', name),
});
