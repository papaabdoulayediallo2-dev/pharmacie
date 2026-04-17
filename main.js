const { app, BrowserWindow, Menu, shell, dialog, ipcMain, BrowserView } = require('electron');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const notifier = require('node-notifier');

let mainWindow;
let whatsappView;
const isMac = process.platform === 'darwin';

// ── Base de données ──────────────────────────────────────────
// CORRECTION : DB initialisée au démarrage de l'app, AVANT l'ouverture de la fenêtre.
// Cela garantit que les données SQLite sont chargées depuis le disque
// dès le premier appel IPC — plus jamais de données vides au redémarrage.
let dbModule = null;
let dbReady  = false;

async function initDbEarly() {
  dbModule = require('./database.js');
  await dbModule.initDB();
  dbReady = true;
}

async function getDb() {
  if (!dbReady) await initDbEarly();
  return dbModule;
}

// ── Fenêtre principale ───────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 14, y: 16 },
    backgroundColor: '#f4f3ee',
    show: false,
    icon: path.join(__dirname, 'assets', isMac ? 'icon.icns' : 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.on('maximize',            () => mainWindow.webContents.send('win-maximized', true));
  mainWindow.on('unmaximize',          () => mainWindow.webContents.send('win-maximized', false));
  mainWindow.on('enter-full-screen',   () => mainWindow.webContents.send('win-fullscreen', true));
  mainWindow.on('leave-full-screen',   () => mainWindow.webContents.send('win-fullscreen', false));

  // Bloquer les raccourcis développeurs / navigateur
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const isDevTools = input.control && input.shift && input.key.toLowerCase() === 'i';
    const isReload = (input.control && input.key.toLowerCase() === 'r') || input.key === 'F5';
    if (isDevTools || isReload) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { 
    mainWindow = null; 
    if (whatsappView) whatsappView.webContents.destroy(); // Nettoyage BrowserView
  });
}

// ── WhatsApp BrowserView (Intégrée) ──────────────────────────
function getWhatsAppView() {
  if (whatsappView) return whatsappView;

  whatsappView = new BrowserView({
    webPreferences: {
      partition: 'persist:pharmacie',
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  whatsappView.webContents.loadURL('https://web.whatsapp.com', { userAgent });

  whatsappView.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return whatsappView;
}

// ── Menu natif ───────────────────────────────────────────────
function buildMenu() {
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' }, { role: 'services' },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' },
      { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ]}] : []),
    { label: 'Fichier', submenu: [
      { label: 'Imprimer', accelerator: 'CmdOrCtrl+P', click: () => mainWindow?.webContents.print() },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit', label: 'Quitter' },
    ]},
    { label: 'Édition', submenu: [
      { role: 'undo', label: 'Annuler' }, { role: 'redo', label: 'Rétablir' },
      { type: 'separator' },
      { role: 'cut', label: 'Couper' }, { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' }, { role: 'selectAll', label: 'Tout sélectionner' },
    ]},
    { label: 'Affichage', submenu: [
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ══════════════════════════════════════════════════════════════
// IPC — Contrôles fenêtre
// ══════════════════════════════════════════════════════════════
ipcMain.on('win-minimize',  () => mainWindow?.minimize());
ipcMain.on('win-maximize',  () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win-close',     () => mainWindow?.close());
ipcMain.on('win-is-max',    (e) => { e.returnValue = mainWindow?.isMaximized() ?? false; });
ipcMain.on('win-print',     () => mainWindow?.webContents.print());
ipcMain.on('win-notify',    (event, { title, message }) => {
  notifier.notify({
    title: title || 'Pharmacie',
    message: message || '',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    sound: true,
    wait: false
  });
});
ipcMain.on('win-set-icon', (event, iconDataUrl) => {
  if (!mainWindow || !iconDataUrl) return;
  try {
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromDataURL(iconDataUrl);
    mainWindow.setIcon(img);
  } catch (e) {
    console.error('Failed to set icon:', e);
  }
});
ipcMain.on('win-set-title', (event, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});
ipcMain.handle('win-export-pdf-hidden', async (e, filename, htmlContent) => {
  if (!mainWindow) return { ok: false, error: 'No mainWindow' };
  try {
    let pdfData;

    if (htmlContent) {
      // Rendu dans une fenêtre invisible dédiée (pour les exports n'utilisant pas la vue actuelle)
      const pdfWin = new BrowserWindow({
        width: 794, height: 1123,
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      const cssPath = path.join(__dirname, 'style.css');
      const cssContent = fs.existsSync(cssPath) 
        ? `<link rel="stylesheet" href="file://${cssPath.replace(/\\/g, '/')}">` 
        : '';
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">${cssContent}</head><body>${htmlContent}</body></html>`;
      await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
      pdfData = await pdfWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
      pdfWin.close();
    } else {
      // UTILISATION DE LA FENÊTRE PRINCIPALE
      // Garantit l'identité exacte avec ce que l'utilisateur voit à l'écran (ex: Catalogue)
      pdfData = await mainWindow.webContents.printToPDF({ 
        printBackground: true, 
        pageSize: 'A4',
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });
    }

    const safeFilename = filename || `Export_${Date.now()}.pdf`;
    const pdfPath = path.join(app.getPath('downloads'), safeFilename);
    fs.writeFileSync(pdfPath, pdfData);
    return { ok: true, filePath: pdfPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('win-export-image', async (e, filename, htmlContent) => {
  try {
    const zoom = 4.0;
    const win = new BrowserWindow({
      width: 1000 * zoom, height: 1500 * zoom, 
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { 
        nodeIntegration: false, 
        contextIsolation: true,
        zoomFactor: zoom
      }
    });
    const cssPath = path.join(__dirname, 'style.css');
    const cssContent = fs.existsSync(cssPath) 
      ? `<link rel="stylesheet" href="file://${cssPath.replace(/\\/g, '/')}">` 
      : '';
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">${cssContent}
      <style>
        body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
        * { box-sizing: border-box; }
      </style></head><body>${htmlContent}</body></html>`;
    
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    
    // Attendre le rendu et les images
    await new Promise(r => setTimeout(r, 800));
    
    // Auto-redimensionnement à la taille réelle du contenu (Width & Height)
    const dimensions = await win.webContents.executeJavaScript(`
      (() => {
        const el = document.body.firstChild;
        return { 
          w: el.offsetWidth || document.body.scrollWidth, 
          h: el.offsetHeight || document.body.scrollHeight 
        };
      })()
    `);
    win.setSize(Math.round((dimensions.w + 4) * zoom), Math.round((dimensions.h + 4) * zoom));
    
    // Petit délai après resize
    await new Promise(r => setTimeout(r, 100));

    const image = await win.webContents.capturePage();
    const imgPath = path.join(app.getPath('downloads'), filename);
    fs.writeFileSync(imgPath, image.toPNG());
    win.close();
    return { ok: true, filePath: imgPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.on('show-in-folder', (e, p) => shell.showItemInFolder(p));

ipcMain.on('win-print-preview', async () => {
  if (!mainWindow) return;
  try {
    const pdfData = await mainWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    });
    const pdfPath = path.join(app.getPath('temp'), `Pharmacie_print_${Date.now()}.pdf`);
    fs.writeFileSync(pdfPath, pdfData);
    
    // Ouvrir une fenetre native Electron pour l'aperçu, qui supporte l'impression
    const previewWin = new BrowserWindow({
      title: 'Aperçu avant impression',
      width: 900,
      height: 800,
      icon: path.join(__dirname, 'assets', isMac ? 'icon.icns' : 'icon.ico'),
      parent: mainWindow,
      modal: true,
      webPreferences: {
        plugins: true
      }
    });
    previewWin.setMenu(null);
    previewWin.loadURL(`file://${pdfPath}`);
  } catch (error) {
    console.error('Erreur creation PDF:', error);
  }
});

ipcMain.on('win-image-preview', (event, imagePath) => {
  if (!imagePath) return;
  
  const previewWin = new BrowserWindow({
    title: 'Aperçu de l\'image',
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', isMac ? 'icon.icns' : 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Si c'est un dataURL (base64) ou un chemin de fichier
  if (imagePath.startsWith('data:')) {
    previewWin.loadURL(imagePath);
  } else {
    previewWin.loadFile(imagePath);
  }
});

ipcMain.on('win-about', () => {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'À propos de Pharmacie',
    message: 'Pharmacie — Gestion Officine',
    detail: `Version : ${app.getVersion()}\nElectron : ${process.versions.electron}\nNode.js  : ${process.versions.node}\n\nGérez vos médicaments, ventes, stock\net rapports en toute simplicité.`,
    buttons: ['OK'],
  });
});

// ══════════════════════════════════════════════════════════════
// IPC — Base de données (invoke = async request/response)
// ══════════════════════════════════════════════════════════════
function dbHandle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const db = await getDb();
      return { ok: true, data: fn(db, ...args) };
    } catch (err) {
      console.error(`[DB] ${channel}:`, err.message);
      return { ok: false, error: err.message };
    }
  });
}

// Categories
dbHandle('db:getCategories',  (db)     => db.getCategories());
dbHandle('db:upsertCategory', (db, ...args)  => db.upsertCategory(...args));
dbHandle('db:deleteCategory', (db, ...args) => db.deleteCategory(...args));

// Products
dbHandle('db:getProducts',   (db)             => db.getProducts());
dbHandle('db:upsertProduct', (db, ...args)          => db.upsertProduct(...args));
dbHandle('db:deleteProduct', (db, ...args)         => db.deleteProduct(...args));
dbHandle('db:updateStock',   (db, ...args)  => db.updateStock(...args));
dbHandle('db:setStock',      (db, ...args)    => db.setStock(...args));

// Sales
dbHandle('db:getSales',    (db)     => db.getSales());
dbHandle('db:insertSale',  (db, ...args)  => db.insertSale(...args));
dbHandle('db:updateSale',  (db, ...args)  => db.updateSale(...args));
dbHandle('db:deleteSale',  (db, ...args) => db.deleteSale(...args));

// Quotes
dbHandle('db:getQuotes',          (db)     => db.getQuotes());
dbHandle('db:upsertQuote',        (db, ...args)  => db.upsertQuote(...args));
dbHandle('db:deleteQuote',        (db, ...args) => db.deleteQuote(...args));
dbHandle('db:convertQuoteToSale', (db, ...args) => db.convertQuoteToSale(...args));

// Returns
dbHandle('db:getReturns',       (db)     => db.getReturns());
dbHandle('db:insertReturn',     (db, ...args)  => db.insertReturn(...args));
dbHandle('db:insertReturnItems',(db, ...args)  => db.insertReturnItems(...args));
dbHandle('db:deleteReturn',     (db, ...args) => db.deleteReturn(...args));

// Expenses
dbHandle('db:getExpenses',   (db)     => db.getExpenses());
dbHandle('db:upsertExpense', (db, ...args)  => db.upsertExpense(...args));
dbHandle('db:deleteExpense', (db, ...args) => db.deleteExpense(...args));

// Users
dbHandle('db:getUsers',   (db)             => db.getUsers());
dbHandle('db:authUser',   (db, ...args)   => db.authUser(...args));
dbHandle('db:upsertUser', (db, ...args)          => db.upsertUser(...args));
dbHandle('db:deleteUser', (db, ...args)         => db.deleteUser(...args));

// Patients
dbHandle('db:getPatients',   (db)            => db.getPatients());
dbHandle('db:upsertPatient', (db, ...args)   => db.upsertPatient(...args));
dbHandle('db:deletePatient', (db, ...args)   => db.deletePatient(...args));

// Caisse
dbHandle('db:getCaisseBalance',          (db)     => db.getCaisseBalance());
dbHandle('db:getCaisseTransactions',     (db)     => db.getCaisseTransactions());
dbHandle('db:addCaisseTransaction',      (db, ...args)  => db.addCaisseTransaction(...args));
dbHandle('db:deleteCaisseTransaction',   (db, ...args) => db.deleteCaisseTransaction(...args));

// Corbeille
dbHandle('db:getTrash',          (db)     => db.getTrash());
dbHandle('db:restoreFromTrash',  (db, ...args) => db.restoreFromTrash(...args));
dbHandle('db:emptyTrash',        (db, ...args) => db.emptyTrash(...args));
dbHandle('db:deleteFromTrash',   (db, ...args) => db.deleteFromTrash(...args));
dbHandle('db:moveToTrash',      (db, ...args) => db.moveToTrash(...args));

// Audit log
dbHandle('db:getAuditLog',  (db)     => db.getAuditLog());

// Settings
dbHandle('db:getSettings',  (db, ...args) => db.getSettings(...args));
dbHandle('db:setSetting',   (db, ...args) => db.setSetting(...args));

// Infos & migration
dbHandle('db:getInfo',                 (db)     => db.getDbInfo());
dbHandle('db:migrateFromLocalStorage', (db, d)  => db.migrateFromLocalStorage(d));

// Ouvrir le dossier userData dans l'explorateur
ipcMain.on('db:openFolder', () => {
  shell.openPath(app.getPath('userData'));
});

ipcMain.handle('db:exportAccounting', async (event, nameOrStart, startOrEnd, maybeEnd, maybeType) => {
  try {
    let filename = null;
    let startDate = nameOrStart;
    let endDate = startOrEnd;
    let type = null;

    // Détection robuste des arguments
    if (typeof nameOrStart === 'string' && nameOrStart.includes('T') && nameOrStart.includes('Z')) {
      startDate = nameOrStart;
      endDate = startOrEnd;
      type = maybeEnd;
      filename = null;
    } else if (nameOrStart === null || typeof nameOrStart === 'string') {
      filename = nameOrStart;
      startDate = startOrEnd;
      endDate = maybeEnd;
      type = maybeType;
    }

    // Normalisation du type ('all' par défaut si inconnu)
    const exportType = type || 'all';
    console.log(`[Export] Commande reçue - Filename: ${filename}, Start: ${startDate}, End: ${endDate}, Type: ${exportType}`);

    const db = await getDb();
    
    // ── Extraction des données ──────────────────────────────────
    const startObj = startDate ? new Date(startDate) : null;
    const endObj = endDate ? new Date(endDate) : null;
    
    const filterByDate = (itemDate) => {
      if (!startObj || !endObj || !itemDate) return true;
      const d = new Date(itemDate);
      return d >= startObj && d <= endObj;
    };

    const sales = db.getSales().filter(s => filterByDate(s.date));
    const expenses = db.getExpenses().filter(e => filterByDate(e.date));
    
    // Le rapport "Caisse Global" n'a pas de filtre de date dans l'UI
    const transactions = exportType === 'caisse_total' 
      ? db.getCaisseTransactions() 
      : db.getCaisseTransactions().filter(t => filterByDate(t.date));
      
    const returns = db.getReturns().filter(r => filterByDate(r.date));
    const products = db.getProducts();
    
    // Audit Log : Filtre exact de l'UI pour "Mouvements de Stock" (Entrées)
    const allAuditLog = db.getAuditLog(5000);
    const auditLog = allAuditLog.filter(l => {
      const isDateValid = filterByDate(l.createdAt);
      return isDateValid && l.entity === 'product' && 
             (l.action === 'STOCK_UPDATE' || l.action === 'STOCK_SET' || l.action === 'CREATE');
    }).filter(l => {
      if (l.action === 'STOCK_UPDATE') {
        // Details format: "Nom — Ajout de X (Préc: Y, Total: Z)" ou "Nom — Retrait de X (...)"
        return l.details && l.details.includes('Ajout de');
      }
      return true;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Pharmacie';
    workbook.created = new Date();

    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } },
      alignment: { horizontal: 'center' },
      border: { bottom: { style: 'thin' } }
    };

    // ── ONDLET 1: RÉSUMÉ & PROFIT ('profit', 'all', 'daily') ───
    if (['all', 'daily', 'profit'].includes(exportType)) {
      const sheetProfit = workbook.addWorksheet('Analyse Profit');
      sheetProfit.columns = [
        { header: 'Indicateur', key: 'label', width: 30 },
        { header: 'Valeur', key: 'value', width: 20 }
      ];
      sheetProfit.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

      let totalVentes = 0;
      let totalCoutAchat = 0;
      sales.forEach(s => {
        totalVentes += s.total;
        (s.items || []).forEach(item => {
          const p = products.find(x => x.id === item.productId);
          totalCoutAchat += item.qty * (p?.purchasePrice || 0);
        });
      });
      const margeBrute = totalVentes - totalCoutAchat;
      const totalDep = expenses.reduce((a, b) => a + b.amount, 0);
      const profitNet = margeBrute - totalDep;

      sheetProfit.addRows([
        { label: 'Total Chiffre d\'Affaires', value: totalVentes },
        { label: 'Total Coût d\'Achat (Estimé)', value: totalCoutAchat },
        { label: 'Marge Brute', value: margeBrute },
        { label: 'Total Dépenses', value: totalDep },
        { label: 'BÉNÉFICE NET', value: profitNet }
      ]);
      sheetProfit.getRow(6).font = { bold: true, size: 12 };
    }

    // ── ONGLET 2: VENTES (GLOBALES) ('sales', 'all', 'daily', 'profit') ───
    if (['all', 'daily', 'sales', 'profit'].includes(exportType)) {
      const sheetSales = workbook.addWorksheet('Ventes');
      sheetSales.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Client', key: 'client', width: 25 },
        { header: 'Total', key: 'total', width: 15 },
        { header: 'Payé', key: 'amountPaid', width: 15 },
        { header: 'Dette', key: 'debt', width: 15 },
        { header: 'Mode', key: 'paymentMode', width: 15 }
      ];
      sheetSales.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      sales.forEach(s => sheetSales.addRow({ 
        date: s.date, client: s.client, total: s.total, 
        amountPaid: s.amountPaid, debt: s.debt, paymentMode: s.paymentMode 
      }));
    }

    // ── ONGLET 3: DÉTAILS VENDUS ('products', 'sales', 'all', 'daily', 'profit') ───
    if (['all', 'daily', 'sales', 'profit', 'products'].includes(exportType)) {
      const sheetDetails = workbook.addWorksheet('Détails Ventes');
      sheetDetails.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Produit', key: 'productName', width: 30 },
        { header: 'Quantité', key: 'qty', width: 10 },
        { header: 'Prix Unitaire', key: 'price', width: 15 },
        { header: 'Sous-total', key: 'subtotal', width: 15 }
      ];
      sheetDetails.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      sales.forEach(s => {
        (s.items || []).forEach(item => {
          const p = products.find(x => x.id === item.productId);
          sheetDetails.addRow({
            date: s.date, productName: p?.name || 'Produit inconnu',
            qty: item.qty, price: item.price, subtotal: item.qty * item.price
          });
        });
      });
    }

    // ── ONGLET 4: DÉPENSES ('expenses', 'all', 'daily') ─────────
    if (['all', 'daily', 'expenses', 'profit'].includes(exportType)) {
      const sheetExp = workbook.addWorksheet('Dépenses');
      sheetExp.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Catégorie', key: 'category', width: 20 },
        { header: 'Description', key: 'description', width: 35 },
        { header: 'Montant', key: 'amount', width: 15 }
      ];
      sheetExp.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      expenses.forEach(e => sheetExp.addRow({ date: e.date, category: e.category || '—', description: e.description, amount: e.amount }));
    }

    // ── ONGLET 5: RETOURS ('all', 'daily', 'returns') ───────────────────────
    if (['all', 'daily', 'returns'].includes(exportType)) {
      const sheetRet = workbook.addWorksheet('Retours');
      sheetRet.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Client', key: 'client', width: 20 },
        { header: 'Produit', key: 'product', width: 25 },
        { header: 'Qté', key: 'qty', width: 10 },
        { header: 'Remboursé', key: 'refund', width: 15 },
        { header: 'Motif', key: 'reason', width: 30 }
      ];
      sheetRet.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      returns.forEach(r => {
        const p = products.find(x => x.id === r.productId);
        sheetRet.addRow({ 
          date: r.date, client: r.client, product: p?.name || r.productId, 
          qty: r.qty, refund: r.cashRefunded, reason: r.reason 
        });
      });
    }

    // ── ONGLET 6: MOUVEMENTS DE STOCK ('stock_mouvements', 'all') 
    if (['all', 'stock_mouvements'].includes(exportType)) {
      const sheetMove = workbook.addWorksheet('Mouvements Stock');
      sheetMove.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Produit', key: 'product', width: 25 },
        { header: 'Action', key: 'action', width: 20 },
        { header: 'Détails Mouvement', key: 'details', width: 40 }
      ];
      sheetMove.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      const actionFr = { STOCK_UPDATE: 'Ajout de stock', STOCK_SET: 'Inventaire fixé', CREATE: 'Création produit' };
      auditLog.forEach(l => {
        const p = products.find(x => x.id === l.entityId);
        sheetMove.addRow({ date: l.createdAt, product: p?.name || 'Supprimé', action: actionFr[l.action] || l.action, details: l.details });
      });
    }

    // ── ONGLET 7: INVENTAIRE ACTUEL ('products_list', 'stock_mouvements', 'all')
    if (['all', 'stock_mouvements', 'products_list'].includes(exportType)) {
      const sheetStock = workbook.addWorksheet('Inventaire Actuel');
      sheetStock.columns = [
        { header: 'Nom Produit', key: 'name', width: 30 },
        { header: 'Catégorie', key: 'category', width: 20 },
        { header: 'Prix Achat', key: 'purchasePrice', width: 15 },
        { header: 'Prix Vente', key: 'price', width: 15 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Code Barre', key: 'barcode', width: 20 }
      ];
      sheetStock.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      
      const categories = db.getCategories();
      products.forEach(p => {
        const cat = categories.find(c => c.id === p.categoryId);
        sheetStock.addRow({ 
          name: p.name, category: cat ? cat.name : '—', price: p.price, 
          purchasePrice: p.purchasePrice, stock: p.stock, barcode: p.barcode 
        });
      });
    }

    // ── ONGLET 8: HISTORIQUE CAISSE ('caisse_history', 'all', 'daily') 
    if (['all', 'daily', 'caisse_history'].includes(exportType)) {
      const sheetCaisse = workbook.addWorksheet('Historique Caisse');
      sheetCaisse.columns = [
        { header: 'Date', key: 'date', width: 22 },
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Libellé', key: 'label', width: 35 },
        { header: 'Montant', key: 'amount', width: 15 }
      ];
      sheetCaisse.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      transactions.forEach(t => sheetCaisse.addRow({ date: t.date, type: t.type, label: t.label, amount: t.amount }));
    }

    // ── ONGLET 9: BILAN CAISSE ('caisse_total', 'all') 
    if (['all', 'caisse_total'].includes(exportType)) {
      const sheetBilan = workbook.addWorksheet('Bilan Caisse Global');
      sheetBilan.columns = [
        { header: 'Indicateur', key: 'label', width: 30 },
        { header: 'Montant', key: 'value', width: 20 }
      ];
      sheetBilan.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      
      const totalV = sales.reduce((s, x) => s + x.total, 0);
      const totalD = expenses.reduce((s, x) => s + x.amount, 0);
      const solde = db.getCaisseBalance();
      
      sheetBilan.addRow({ label: 'Total Ventes', value: totalV });
      sheetBilan.addRow({ label: 'Total Dépenses', value: totalD });
      sheetBilan.addRow({ label: 'Solde Caisse', value: solde });
      sheetBilan.addRow({ label: 'Nombre de ventes', value: sales.length });
    }

    // ── ONGLET 10: RENTABILITÉ PAR PRODUIT ('profit_by_product', 'all') ───
    if (['all', 'profit_by_product'].includes(exportType)) {
      const sheetRent = workbook.addWorksheet('Rentabilité par Produit');
      sheetRent.columns = [
        { header: 'Produit', key: 'name', width: 30 },
        { header: 'Qté Vendue', key: 'qty', width: 15 },
        { header: 'Chiffre d\'Affaires', key: 'revenue', width: 20 },
        { header: 'Coût d\'Achat Total', key: 'cost', width: 20 },
        { header: 'Marge Totale (Bénéfice)', key: 'profit', width: 25 },
        { header: 'Marge %', key: 'marginPct', width: 15 }
      ];
      sheetRent.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      
      const stats = {};
      sales.forEach(sale => {
        (sale.items||[]).forEach(item => {
          if(!stats[item.productId]) stats[item.productId] = { qty:0, revenue:0, cost:0 };
          const p = products.find(prod => prod.id === item.productId);
          stats[item.productId].qty += item.qty;
          stats[item.productId].revenue += item.qty * item.price;
          stats[item.productId].cost += item.qty * (p?.purchasePrice || 0);
        });
      });
      
      Object.entries(stats).forEach(([pid, data]) => {
        const p = products.find(prod => prod.id === pid);
        const profit = data.revenue - data.cost;
        const marginPct = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
        sheetRent.addRow({
          name: p?.name || 'Inconnu',
          qty: data.qty,
          revenue: data.revenue,
          cost: data.cost,
          profit: profit,
          marginPct: marginPct.toFixed(1) + '%'
        });
      });

      const sheetDorm = workbook.addWorksheet('Produits Dormants');
      sheetDorm.columns = [
        { header: 'Produit', key: 'name', width: 30 },
        { header: 'Catégorie', key: 'category', width: 20 },
        { header: 'Stock Actuel', key: 'stock', width: 15 },
        { header: 'Valeur de vente estimée', key: 'value', width: 25 }
      ];
      sheetDorm.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
      const categories = db.getCategories();
      const dormant = products.filter(p => !stats[p.id] && p.stock > 0).sort((a,b) => b.stock - a.stock);
      dormant.forEach(p => {
        const cat = categories.find(c=>c.id===p.categoryId);
        sheetDorm.addRow({ name: p.name, category: cat?.name||'—', stock: p.stock, value: p.price * p.stock });
      });
    }

    // Sécurité: Si aucun onglet n'a été créé (type inconnu), on crée un onglet par défaut
    if (workbook.worksheets.length === 0) {
       workbook.addWorksheet('Aucune donnée');
    }

    // ── SAUVEGARDE ──────────────────────────────────────────────
    const downloadsPath = app.getPath('downloads');
    let safeName = filename;
    if (!safeName || typeof safeName !== 'string' || safeName.includes('T')) {
      const now = new Date();
      // On ajoute le type dans le nom du fichier pour plus de clarté
      const typeStr = exportType !== 'all' ? `_${exportType}` : '';
      safeName = `Export_${typeStr}_${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}_${now.getHours()}-${now.getMinutes()}.xlsx`;
    }
    safeName = safeName.replace(/[<>:"/\\|?*]/g, '_');
    if (!safeName.endsWith('.xlsx')) safeName += '.xlsx';

    const finalPath = path.join(downloadsPath, safeName);
    await workbook.xlsx.writeFile(finalPath);
    
    console.log(`[Export] Succès : ${finalPath}`);
    return { ok: true, filePath: finalPath };
  } catch (err) {
    console.error('[App] Erreur critique exportAccounting:', err);
    return { ok: false, error: err.message };
  }
});

// ── APERÇU EXCEL NATIF ────────────────────────────────────────

function generateExcelPreviewHtml(sheetsData, tempXlsxPath, exportLabel, theme) {
  const safeData = JSON.stringify(sheetsData).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const safePath = tempXlsxPath.replace(/\\/g, '\\\\');
  const isDark = theme === 'dark';

  // Theme tokens
  const tokens = isDark ? `
    --bg:           #111210;
    --surface:      #1e1f1b;
    --surface2:     #252620;
    --header-bg:    linear-gradient(135deg, #1a2d1a 0%, #0d1a0d 100%);
    --border:       #2d2e28;
    --text:         #eceae2;
    --text2:        #a8a89e;
    --text3:        #6a6a62;
    --accent:       #5ab04e;
    --accent-dim:   rgba(90,176,78,0.12);
    --table-even:   #1a1b18;
    --table-hover:  #222e22;
    --thead-bg:     #252620;
    --thead-text:   #a0b0a0;
    --num-color:    #5ab04e;
    --num-red:      #e05b50;
    --tab-inactive: #6a6a62;
    --tab-active-bg:#1e1f1b;
    --tab-bar-bg:   #161713;
    --infobar-bg:   #161713;
    --statusbar-bg: #0d0e0c;
    --scrollbar:    #2d2e28;
    --col-sep:      rgba(255,255,255,0.07);
    --btn-sec-bg:   rgba(255,255,255,0.07);
    --btn-sec-color:#c8c8c0;
    --btn-sec-bdr:  rgba(255,255,255,0.12);
    --empty-color:  #505050;
  ` : `
    --bg:           #f4f3ee;
    --surface:      #ffffff;
    --surface2:     #f0efe9;
    --header-bg:    linear-gradient(135deg, #2d5a27 0%, #1e3d1a 100%);
    --border:       #e0ddd6;
    --text:         #1a1a18;
    --text2:        #5a5a54;
    --text3:        #9a9a90;
    --accent:       #2d5a27;
    --accent-dim:   rgba(45,90,39,0.08);
    --table-even:   #f7f6f1;
    --table-hover:  #ebf5e8;
    --thead-bg:     #2d5a27;
    --thead-text:   #ffffff;
    --num-color:    #2d5a27;
    --num-red:      #c0392b;
    --tab-inactive: #7a7a72;
    --tab-active-bg:#ffffff;
    --tab-bar-bg:   #eae9e3;
    --infobar-bg:   #eae9e3;
    --statusbar-bg: #e0dfd9;
    --scrollbar:    #c8c6be;
    --col-sep:      rgba(0,0,0,0.09);
    --btn-sec-bg:   rgba(0,0,0,0.06);
    --btn-sec-color:#3a3a34;
    --btn-sec-bdr:  rgba(0,0,0,0.15);
    --empty-color:  #b0b0a8;
  `;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Aperçu Export Excel</title>
  <link rel="stylesheet" href="file://${__dirname.replace(/\\/g, '/')}/fontawesome/css/all.min.css">
  <style>
    :root { ${tokens} }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    /* ── Header ── */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 24px;
      background: var(--header-bg);
      border-bottom: 2px solid var(--accent);
      flex-shrink: 0;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .header-logo {
      width: 34px; height: 34px;
      background: rgba(255,255,255,0.18);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      color: #fff;
    }
    .header-title { font-size: 16px; font-weight: 700; color: #fff; }
    .header-sub { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 1px; }
    .header-actions { display: flex; gap: 10px; }
    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px; font-weight: 600;
      border: none; cursor: pointer;
      transition: all 0.18s ease;
    }
    .btn-secondary {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-color);
      border: 1px solid var(--btn-sec-bdr);
    }
    .btn-secondary:hover { filter: brightness(1.1); }
    /* Forcer texte blanc sur le header (toujours sombre) quel que soit le thème */
    .header .btn-secondary {
      background: rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.92);
      border: 1px solid rgba(255,255,255,0.28);
    }
    .header .btn-secondary:hover {
      background: rgba(255,255,255,0.22);
      color: #fff;
    }
    .btn-success {
      background: rgba(255,255,255,0.22); color: #fff;
      border: 1px solid rgba(255,255,255,0.35);
    }
    .btn-success:hover { background: rgba(255,255,255,0.32); transform: translateY(-1px); }
    /* ── Tab Bar ── */
    .tab-bar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 10px 20px 0;
      background: var(--tab-bar-bg);
      border-bottom: 1px solid var(--border);
      overflow-x: auto;
      flex-shrink: 0;
    }
    .tab {
      padding: 9px 18px;
      border-radius: 8px 8px 0 0;
      font-size: 13px; font-weight: 500;
      color: var(--tab-inactive);
      cursor: pointer;
      border: 1px solid transparent;
      border-bottom: none;
      transition: all 0.15s;
      white-space: nowrap;
      user-select: none;
    }
    .tab:hover { color: var(--text); background: var(--accent-dim); }
    .tab.active {
      color: var(--accent);
      background: var(--tab-active-bg);
      border-color: var(--border);
      border-bottom-color: var(--tab-active-bg);
      font-weight: 700;
    }
    .tab-icon { margin-right: 6px; font-size: 12px; }
    /* ── Info Bar ── */
    .info-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 22px;
      background: var(--infobar-bg);
      border-bottom: 1px solid var(--border);
      font-size: 12px;
      color: var(--text3);
      flex-shrink: 0;
    }
    .info-bar .row-count { color: var(--accent); font-weight: 700; }
    /* ── Table ── */
    .table-container { flex: 1; overflow: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: auto; }
    thead th {
      position: sticky; top: 0;
      background: var(--thead-bg);
      color: var(--thead-text);
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.07em;
      padding: 11px 16px; text-align: left;
      border-bottom: 2px solid var(--accent);
      border-right: 1px solid var(--col-sep);
      white-space: nowrap; z-index: 10;
    }
    thead th:last-child { border-right: none; }
    tbody tr { border-bottom: 1px solid var(--border); transition: background 0.1s; }
    tbody tr:nth-child(even) { background: var(--table-even); }
    tbody tr:hover { background: var(--table-hover) !important; }
    tbody td { padding: 10px 16px; color: var(--text); vertical-align: middle; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-right: 1px solid var(--col-sep); }
    tbody td:last-child { border-right: none; }
    td.num { text-align: right; font-family: 'Courier New', monospace; color: var(--num-color); font-weight: 700; white-space: nowrap; }
    td.num-red { text-align: right; font-family: 'Courier New', monospace; color: var(--num-red); font-weight: 700; white-space: nowrap; }
    td.num-int { text-align: right; font-family: 'Courier New', monospace; color: var(--text2); font-weight: 600; white-space: nowrap; }
    td.date { color: var(--text3); font-size: 12px; white-space: nowrap; }
    .currency { font-size: 10px; font-weight: 400; opacity: 0.6; letter-spacing: 0.04em; margin-left: 3px; }
    tr.summary-row td { font-weight: 700; font-size: 14px; background: var(--accent-dim) !important; border-top: 2px solid var(--accent); }
    /* Empty state */
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 200px; color: var(--empty-color); font-size: 14px;
    }
    .empty-state .icon { font-size: 40px; margin-bottom: 12px; opacity: 0.4; }
    /* Scrollbar */
    ::-webkit-scrollbar { width: 7px; height: 7px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text3); }
    /* Status bar */
    .status-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 22px;
      background: var(--statusbar-bg);
      border-top: 1px solid var(--border);
      font-size: 11px; color: var(--text3);
      flex-shrink: 0;
    }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .notification {
      position: fixed; bottom: 40px; left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: var(--accent); color: #fff;
      padding: 10px 20px; border-radius: 8px;
      font-size: 13px; font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      opacity: 0; transition: all 0.3s ease;
      pointer-events: none; z-index: 1000;
    }
    .notification.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-brand">
      <div class="header-logo"><i class="fas fa-chart-bar"></i></div>
      <div>
        <div class="header-title">Aperçu Export Excel</div>
        <div class="header-sub">${exportLabel}</div>
      </div>
    </div>
    <div class="header-actions">
      <button class="btn btn-secondary" onclick="openInExcel()" title="Ouvrir dans Microsoft Excel">
        <i class="fas fa-external-link-alt"></i> Ouvrir dans Excel
      </button>
      <button class="btn btn-success" onclick="downloadExcel()" title="Enregistrer dans Téléchargements">
        <i class="fas fa-download"></i> Télécharger .xlsx
      </button>
    </div>
  </div>

  <div class="tab-bar" id="tabBar"></div>

  <div class="info-bar">
    <span id="sheetInfo"></span>
    <span id="rowCount" class="row-count"></span>
  </div>

  <div class="table-container">
    <div id="tableContainer"></div>
  </div>

  <div class="status-bar">
    <div class="status-dot"></div>
    <span>Excel</span>
    <span style="margin-left:auto; color:#333;">${safePath}</span>
  </div>

  <div class="notification" id="notification"></div>

  <script>
    const { ipcRenderer } = require('electron');
    const TEMP_PATH = \`${safePath}\`;
    const SHEETS = JSON.parse(\`${safeData}\`);

    // ── Cell type detection ───────────────────────────────────
    // Colonnes FCFA (montants monétaires)
    const currencyHeaders = [
      'total','payé','amountpaid','debt','montant','sous-total','remboursé','marge',
      'valeur','prix achat','prix vente','salaire','amount','price','purchaseprice',
      'subtotal','solde','bénéfice','chiffre','revenus','coût','refund'
    ];
    // Colonnes entières SANS FCFA (quantités)
    const intHeaders = ['stock','qté','quantité','qty','nombre de ventes'];
    // Colonnes texte (ne pas traiter comme nombres même si ce sont des chiffres)
    const textHeaders = ['code barre','barcode','barre','code'];
    // Colonnes dates
    const dateHeaders = ['date','createdat','created_at','deletedat'];

    function isCurrencyHeader(h) { const l=(h||'').toLowerCase(); return currencyHeaders.some(k=>l.includes(k)); }
    function isIntHeader(h)      { const l=(h||'').toLowerCase(); return intHeaders.some(k=>l===k||l.includes(k)); }
    function isTextHeader(h)     { const l=(h||'').toLowerCase(); return textHeaders.some(k=>l.includes(k)); }
    function isDateHeader(h)     { const l=(h||'').toLowerCase(); return dateHeaders.some(k=>l.includes(k)); }

    function formatCell(val, header) {
      if (val === null || val === undefined || val === '') return '<span style="color:var(--text3)">—</span>';
      const h = (header||'').toLowerCase();

      // Texte forcé (Code Barre etc.) → pas de traitement numérique
      if (isTextHeader(h)) return { val: String(val), cls: '' };

      // Entiers simples (stock, quantité) → nombre sans FCFA
      if (isIntHeader(h) && (typeof val === 'number' || !isNaN(Number(val)))) {
        const n = Number(val);
        return { val: n.toLocaleString('fr-FR'), cls: 'num-int' };
      }

      // Montants FCFA
      if (isCurrencyHeader(h) && (typeof val === 'number' || !isNaN(Number(val)))) {
        const n = Number(val);
        const fmt = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const cls = n < 0 ? 'num-red' : 'num';
        return { val: fmt + ' <span class="currency">FCFA</span>', cls };
      }

      // Dates
      if (isDateHeader(h) && typeof val === 'string' && (val.includes('T') || val.includes('-'))) {
        try {
          const d = new Date(val);
          const formatted = d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
          return { val: formatted, cls: 'date' };
        } catch(_) {}
      }

      // Texte plain
      return { val: String(val), cls: '' };
    }

    // ── Render sheet ──────────────────────────────────────────
    let currentSheet = 0;

    function renderSheet(idx) {
      currentSheet = idx;
      const sheet = SHEETS[idx];
      if (!sheet || !sheet.rows.length) {
        document.getElementById('tableContainer').innerHTML = \`
          <div class="empty-state"><div class="icon"><i class="fas fa-table fa-2x"></i></div><div>Aucune donnée dans cet onglet</div></div>
        \`;
        document.getElementById('sheetInfo').textContent = sheet?.name || '';
        document.getElementById('rowCount').textContent = '0 ligne';
        return;
      }

      const headers = sheet.rows[0];
      const dataRows = sheet.rows.slice(1);

      let html = '<table><thead><tr>';
      headers.forEach(h => { html += \`<th>\${h||''}</th>\`; });
      html += '</tr></thead><tbody>';

      dataRows.forEach((row, ri) => {
        const isSummary = ri === dataRows.length - 1 && headers.length <= 2;
        html += \`<tr\${isSummary ? ' class="summary-row"' : ''}>\`;
        headers.forEach((h, ci) => {
          const raw = row[ci];
          const result = formatCell(raw, h);
          if (typeof result === 'object') {
            html += \`<td class="\${result.cls}">\${result.val}</td>\`;
          } else {
            html += \`<td>\${result}</td>\`;
          }
        });
        html += '</tr>';
      });

      html += '</tbody></table>';

      document.getElementById('tableContainer').innerHTML = html;
      document.getElementById('sheetInfo').textContent = sheet.name;
      const count = dataRows.length;
      document.getElementById('rowCount').textContent = count + (count > 1 ? ' lignes' : ' ligne');

      // Update tab highlight
      document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
    }

    // ── Build tabs ────────────────────────────────────────────
    const tabIcons = {
      'Analyse Profit': 'fa-chart-line', 'Ventes': 'fa-shopping-cart', 'Détails Ventes': 'fa-list',
      'Dépenses': 'fa-wallet', 'Retours': 'fa-undo-alt', 'Mouvements Stock': 'fa-boxes',
      'Inventaire Actuel': 'fa-warehouse', 'Historique Caisse': 'fa-history', 'Bilan Caisse Global': 'fa-coins'
    };

    const tabBar = document.getElementById('tabBar');
    SHEETS.forEach((sheet, i) => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (i === 0 ? ' active' : '');
      const iconClass = tabIcons[sheet.name] || 'fa-file-alt';
      tab.innerHTML = \`<span class="tab-icon"><i class="fas \${iconClass}"></i></span>\${sheet.name}\`;
      tab.onclick = () => renderSheet(i);
      tabBar.appendChild(tab);
    });

    // Initial render
    renderSheet(0);

    // ── Actions ───────────────────────────────────────────────
    function showNotification(msg) {
      const n = document.getElementById('notification');
      n.innerHTML = msg;
      n.classList.add('show');
      setTimeout(() => n.classList.remove('show'), 3000);
    }

    function downloadExcel() {
      ipcRenderer.send('preview:save-excel', TEMP_PATH);
      showNotification('<i class="fas fa-check-circle"></i> Fichier enregistré dans Téléchargements');
    }

    function openInExcel() {
      ipcRenderer.send('preview:open-excel', TEMP_PATH);
    }
  </script>
</body>
</html>`;
}

// ── Handler : Aperçu Excel Natif ─────────────────────────────
ipcMain.handle('db:previewAccounting', async (event, startDate, endDate, type, theme) => {
  try {
    const exportType = type || 'all';
    const db = await getDb();

    const startObj = startDate ? new Date(startDate) : null;
    const endObj   = endDate   ? new Date(endDate)   : null;
    const filterByDate = (d) => {
      if (!startObj || !endObj || !d) return true;
      const dt = new Date(d);
      return dt >= startObj && dt <= endObj;
    };

    const sales       = db.getSales().filter(s => filterByDate(s.date));
    const expenses    = db.getExpenses().filter(e => filterByDate(e.date));
    const transactions = exportType === 'caisse_total'
      ? db.getCaisseTransactions()
      : db.getCaisseTransactions().filter(t => filterByDate(t.date));
    const returns  = db.getReturns().filter(r => filterByDate(r.date));
    const products = db.getProducts();
    const allAudit = db.getAuditLog(5000);
    const auditLog = allAudit.filter(l => {
      const valid = filterByDate(l.createdAt);
      return valid && l.entity === 'product' &&
             (l.action === 'STOCK_UPDATE' || l.action === 'STOCK_SET' || l.action === 'CREATE');
    }).filter(l => {
      if (l.action === 'STOCK_UPDATE') {
        // Details format: "Nom — Ajout de X (Préc: Y, Total: Z)" ou "Nom — Retrait de X (...)"
        return l.details && l.details.includes('Ajout de');
      }
      return true;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Pharmacie';
    workbook.created = new Date();

    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } },
      alignment: { horizontal: 'center' },
      border: { bottom: { style: 'thin' } }
    };

    if (['all', 'daily', 'profit'].includes(exportType)) {
      const ws = workbook.addWorksheet('Analyse Profit');
      ws.columns = [{ header: 'Indicateur', key: 'label', width: 30 }, { header: 'Valeur', key: 'value', width: 20 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      let tV = 0, tCA = 0;
      sales.forEach(s => { tV += s.total; (s.items||[]).forEach(i => { const p = products.find(x=>x.id===i.productId); tCA += i.qty*(p?.purchasePrice||0); }); });
      const tD = expenses.reduce((a,b)=>a+b.amount,0);
      ws.addRows([{ label: "Total Chiffre d'Affaires", value: tV }, { label: "Total Coût d'Achat (Estimé)", value: tCA }, { label: 'Marge Brute', value: tV-tCA }, { label: 'Total Dépenses', value: tD }, { label: 'BÉNÉFICE NET', value: tV-tCA-tD }]);
      ws.getRow(6).font = { bold: true, size: 12 };
    }
    if (['all', 'daily', 'sales', 'profit'].includes(exportType)) {
      const ws = workbook.addWorksheet('Ventes');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Client', key: 'client', width: 25 }, { header: 'Total', key: 'total', width: 15 }, { header: 'Payé', key: 'amountPaid', width: 15 }, { header: 'Dette', key: 'debt', width: 15 }, { header: 'Mode', key: 'paymentMode', width: 15 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      sales.forEach(s => ws.addRow({ date: s.date, client: s.client, total: s.total, amountPaid: s.amountPaid, debt: s.debt, paymentMode: s.paymentMode }));
    }
    if (['all', 'daily', 'sales', 'profit', 'products'].includes(exportType)) {
      const ws = workbook.addWorksheet('Détails Ventes');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Produit', key: 'productName', width: 30 }, { header: 'Quantité', key: 'qty', width: 10 }, { header: 'Prix Unitaire', key: 'price', width: 15 }, { header: 'Sous-total', key: 'subtotal', width: 15 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      sales.forEach(s => (s.items||[]).forEach(item => { const p = products.find(x=>x.id===item.productId); ws.addRow({ date: s.date, productName: p?.name||'Inconnu', qty: item.qty, price: item.price, subtotal: item.qty*item.price }); }));
    }
    if (['all', 'daily', 'expenses', 'profit'].includes(exportType)) {
      const ws = workbook.addWorksheet('Dépenses');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Catégorie', key: 'category', width: 20 }, { header: 'Description', key: 'description', width: 35 }, { header: 'Montant', key: 'amount', width: 15 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      expenses.forEach(e => ws.addRow({ date: e.date, category: e.category||'—', description: e.description, amount: e.amount }));
    }
    if (['all', 'daily', 'returns'].includes(exportType)) {
      const ws = workbook.addWorksheet('Retours');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Client', key: 'client', width: 20 }, { header: 'Produit', key: 'product', width: 25 }, { header: 'Qté', key: 'qty', width: 10 }, { header: 'Remboursé', key: 'refund', width: 15 }, { header: 'Motif', key: 'reason', width: 30 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      returns.forEach(r => { const p = products.find(x=>x.id===r.productId); ws.addRow({ date: r.date, client: r.client, product: p?.name||r.productId, qty: r.qty, refund: r.cashRefunded, reason: r.reason }); });
    }
    if (['all', 'stock_mouvements'].includes(exportType)) {
      const ws = workbook.addWorksheet('Mouvements Stock');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Produit', key: 'product', width: 25 }, { header: 'Action', key: 'action', width: 20 }, { header: 'Détails', key: 'details', width: 40 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      const actionFr = { STOCK_UPDATE: 'Ajout de stock', STOCK_SET: 'Inventaire fixé', CREATE: 'Création produit' };
      auditLog.forEach(l => { const p = products.find(x=>x.id===l.entityId); ws.addRow({ date: l.createdAt, product: p?.name||'Supprimé', action: actionFr[l.action] || l.action, details: l.details }); });
    }
    if (['all', 'stock_mouvements', 'products_list'].includes(exportType)) {
      const ws = workbook.addWorksheet('Inventaire Actuel');
      ws.columns = [{ header: 'Nom Produit', key: 'name', width: 30 }, { header: 'Catégorie', key: 'category', width: 20 }, { header: 'Prix Achat', key: 'purchasePrice', width: 15 }, { header: 'Prix Vente', key: 'price', width: 15 }, { header: 'Stock', key: 'stock', width: 10 }, { header: 'Code Barre', key: 'barcode', width: 20 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      const categories = db.getCategories();
      products.forEach(p => { const cat = categories.find(c=>c.id===p.categoryId); ws.addRow({ name: p.name, category: cat?.name||'—', purchasePrice: p.purchasePrice, price: p.price, stock: p.stock, barcode: p.barcode }); });
    }
    if (['all', 'daily', 'caisse_history'].includes(exportType)) {
      const ws = workbook.addWorksheet('Historique Caisse');
      ws.columns = [{ header: 'Date', key: 'date', width: 22 }, { header: 'Type', key: 'type', width: 15 }, { header: 'Libellé', key: 'label', width: 35 }, { header: 'Montant', key: 'amount', width: 15 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      transactions.forEach(t => ws.addRow({ date: t.date, type: t.type, label: t.label, amount: t.amount }));
    }
    if (['all', 'caisse_total'].includes(exportType)) {
      const ws = workbook.addWorksheet('Bilan Caisse Global');
      ws.columns = [{ header: 'Indicateur', key: 'label', width: 30 }, { header: 'Montant', key: 'value', width: 20 }];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      const tV = sales.reduce((s,x)=>s+x.total,0);
      const tD = expenses.reduce((s,x)=>s+x.amount,0);
      ws.addRows([{ label: 'Total Ventes', value: tV }, { label: 'Total Dépenses', value: tD }, { label: 'Solde Caisse', value: db.getCaisseBalance() }, { label: 'Nombre de ventes', value: sales.length }]);
    }
    if (['all', 'profit_by_product'].includes(exportType)) {
      // 1. Rentabilité détaillée
      const ws = workbook.addWorksheet('Rentabilité par Produit');
      ws.columns = [
        { header: 'Produit', key: 'name', width: 30 },
        { header: 'Qté Vendue', key: 'qty', width: 15 },
        { header: 'Chiffre d\'Affaires', key: 'revenue', width: 20 },
        { header: 'Coût d\'Achat Total', key: 'cost', width: 20 },
        { header: 'Marge Totale (Bénéfice)', key: 'profit', width: 25 },
        { header: 'Marge %', key: 'marginPct', width: 15 }
      ];
      ws.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      
      const stats = {};
      sales.forEach(sale => {
        (sale.items||[]).forEach(item => {
          if(!stats[item.productId]) stats[item.productId] = { qty:0, revenue:0, cost:0 };
          const p = products.find(x=>x.id===item.productId);
          stats[item.productId].qty += item.qty;
          stats[item.productId].revenue += item.qty * item.price;
          stats[item.productId].cost += item.qty * (p?.purchasePrice || 0);
        });
      });
      
      Object.entries(stats).forEach(([pid, data]) => {
        const p = products.find(x=>x.id===pid);
        const profit = data.revenue - data.cost;
        const marginPct = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
        ws.addRow({
          name: p?.name || 'Inconnu',
          qty: data.qty,
          revenue: data.revenue,
          cost: data.cost,
          profit: profit,
          marginPct: marginPct.toFixed(1) + '%'
        });
      });

      // 2. Produits Dormants
      const wsDorm = workbook.addWorksheet('Produits Dormants');
      wsDorm.columns = [
        { header: 'Produit', key: 'name', width: 30 },
        { header: 'Catégorie', key: 'category', width: 20 },
        { header: 'Stock Actuel', key: 'stock', width: 15 },
        { header: 'Valeur de vente estimée', key: 'value', width: 25 }
      ];
      wsDorm.getRow(1).eachCell(c => Object.assign(c, headerStyle));
      const categories = db.getCategories();
      const dormant = products.filter(p => !stats[p.id] && p.stock > 0).sort((a,b) => b.stock - a.stock);
      dormant.forEach(p => {
        const cat = categories.find(c=>c.id===p.categoryId);
        wsDorm.addRow({ name: p.name, category: cat?.name||'—', stock: p.stock, value: p.price * p.stock });
      });
    }

    if (workbook.worksheets.length === 0) workbook.addWorksheet('Aucune donnée');

    // Save temp .xlsx
    const tempXlsxPath = path.join(app.getPath('temp'), `Pharmacie_preview_${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(tempXlsxPath);

    // Convert worksheets → plain JS arrays for HTML embedding
    const sheetsData = [];
    for (const ws of workbook.worksheets) {
      const rows = [];
      ws.eachRow((row) => {
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          vals.push(cell.value !== null && cell.value !== undefined ? cell.value : '');
        });
        rows.push(vals);
      });
      sheetsData.push({ name: ws.name, rows });
    }

    // Build label string
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    const exportLabel = `${exportType.toUpperCase()} — ${dateStr}`;

    // Generate and save HTML
    const html = generateExcelPreviewHtml(sheetsData, tempXlsxPath, exportLabel, theme || 'light');
    const tempHtmlPath = path.join(app.getPath('temp'), `Pharmacie_preview_${Date.now()}.html`);
    fs.writeFileSync(tempHtmlPath, html, 'utf8');

    // Open preview window
    const previewWin = new BrowserWindow({
      title: 'Aperçu Export Excel',
      width: 1200,
      height: 760,
      minWidth: 800,
      minHeight: 500,
      icon: path.join(__dirname, 'assets', isMac ? 'icon.icns' : 'icon.ico'),
      parent: mainWindow,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    });
    previewWin.setMenu(null);
    await previewWin.loadFile(tempHtmlPath);

    previewWin.on('closed', () => {
      try { fs.unlinkSync(tempHtmlPath); } catch(_) {}
      // Keep temp xlsx for "open in excel" — it's in system temp, OS will clean it
    });

    return { ok: true };
  } catch(err) {
    console.error('[Preview] Erreur:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.on('preview:save-excel', (event, tempPath) => {
  try {
    const now = new Date();
    const stamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}_${now.getHours()}-${now.getMinutes()}`;
    const destName = `Export_Pharmacie_${stamp}.xlsx`;
    const destPath = path.join(app.getPath('downloads'), destName);
    fs.copyFileSync(tempPath, destPath);
    shell.showItemInFolder(destPath);
    console.log(`[Preview] Excel saved to: ${destPath}`);
  } catch(err) {
    console.error('[Preview] save-excel error:', err);
  }
});

ipcMain.on('preview:open-excel', (event, tempPath) => {
  shell.openPath(tempPath).catch(err => console.error('[Preview] open-excel error:', err));
});

// ── SAUVEGARDE COMPLÈTE (ZIP) ──────────────────────────────────
ipcMain.handle('db:backup', async () => {
  try {
    const userData = app.getPath('userData');
    const downloads = app.getPath('downloads');
    const dbPath = path.join(userData, 'Pharmacie.db');
    const passPath = path.join(userData, 'password.txt');
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2,'0')}-${now.getDate().toString().padStart(2,'0')}_${now.getHours()}-${now.getMinutes()}`;
    const zipName = `Pharmacie_Backup_${timestamp}.zip`;
    const zipPath = path.join(downloads, zipName);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        console.log(`[Backup] Archive créée : ${zipName} (${archive.pointer()} octets)`);
        resolve({ ok: true, filename: zipName });
      });

      archive.on('error', (err) => {
        console.error('[Backup] Erreur Archiver:', err);
        resolve({ ok: false, error: err.message });
      });

      archive.pipe(output);

      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'Pharmacie.db' });
      }
      if (fs.existsSync(passPath)) {
        archive.file(passPath, { name: 'password.txt' });
      }

      const info = JSON.stringify({
        appName: 'Pharmacie',
        version: '4.3.2',
        date: now.toISOString(),
        description: 'Sauvegarde complète (Base de données + Passwords)'
      }, null, 2);
      archive.append(info, { name: 'backup_info.json' });

      archive.finalize();
    });
  } catch (e) {
    console.error('[Backup] Erreur globale:', e);
    return { ok: false, error: e.message };
  }
});

// ── WhatsApp IPC (Intégré) ──────────────────────────────────
ipcMain.handle('whatsapp:get-status', async () => {
  // On force la création si pas encore faite
  const view = getWhatsAppView();
  try {
    // Vérifier si la page est entièrement chargée
    const isLoaded = !view.webContents.isLoading();
    if (!isLoaded) {
      console.log('[WhatsApp Status] Page en cours de chargement...');
      return { connected: false };
    }
    // Vérification via DOM de WhatsApp Web
    const isLogged = await view.webContents.executeJavaScript(`
      (function() {
        // WhatsApp stocke le user ID dans localStorage quand connecté
        const wid = localStorage.getItem('last-wid-md') || localStorage.getItem('last-wid');
        const hasChatPanel = !!document.querySelector('[data-testid="chat-list-search"]') || !!document.querySelector('#pane-side');
        return !!(wid || hasChatPanel);
      })()
    `).catch(() => false);

    const url = view.webContents.getURL();
    console.log(`[WhatsApp Status] URL: ${url}, Logged: ${isLogged}`);
    return { 
      connected: (isLogged && url.includes('web.whatsapp.com')),
      url 
    };
  } catch (e) {
    console.error('[WhatsApp Status] Erreur:', e.message);
    return { connected: false };
  }
});

ipcMain.on('whatsapp:show', (event, show) => {
  if (!mainWindow) return;
  const view = getWhatsAppView();
  if (show) {
    mainWindow.setBrowserView(view);
  } else {
    mainWindow.setBrowserView(null);
  }
});

ipcMain.on('whatsapp:set-bounds', (event, bounds) => {
  if (whatsappView) {
    // bounds est passé depuis le renderer { x, y, width, height }
    whatsappView.setBounds(bounds);
  }
});

ipcMain.on('whatsapp:send', (event, { phone, message }) => {
  const view = getWhatsAppView();
  const url = `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  
  view.webContents.loadURL(url, { userAgent });
  // On ne force pas le show ici car l'utilisateur est peut être déjà dans l'onglet
});

ipcMain.handle('whatsapp:logout', async () => {
  const { session } = require('electron');
  await session.fromPartition('persist:whatsapp').clearStorageData();
  const view = getWhatsAppView();
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  await view.webContents.loadURL('https://web.whatsapp.com', { userAgent });
  return { ok: true };
});

ipcMain.on('whatsapp:refresh', () => {
  if (whatsappView) whatsappView.webContents.reload();
});

// Sauvegarder le mot de passe dans un fichier texte (récupération)
ipcMain.handle('save-password-file', (event, password) => {
  const fs = require('fs');
  const path = require('path');
  const filePath = path.join(app.getPath('userData'), 'password.txt');
  try {
    if (password && password.trim() !== '') {
      fs.writeFileSync(filePath, `VOTRE MOT DE PASSE DE CONNEXION Pharmacie EST : ${password}`, 'utf8');
    } else {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    return { ok: true };
  } catch (err) {
    console.error('[App] Erreur save-password-file:', err.message);
    return { ok: false, error: err.message };
  }
});

// ══════════════════════════════════════════════════════════════
// Lifecycle
// ══════════════════════════════════════════════════════════════
app.whenReady().then(async () => {
  // Initialiser la DB en premier — AVANT de créer la fenêtre
  await initDbEarly();
  buildMenu();
  createWindow();

  // Pré-initialiser WhatsApp en arrière-plan (session persistante)
  // sans attendre → permet la détection même si on n'a pas visité l'onglet
  setTimeout(() => {
    console.log('[App] Pré-chargement WhatsApp en arrière-plan...');
    getWhatsAppView();
  }, 2000);

  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });

// Assurer la sauvegarde finale avant de quitter (très important pour le mode debounced)
app.on('before-quit', () => {
  if (dbModule && dbModule.persistSync) {
    console.log('[App] Fermeture : Sauvegarde finale de la base de données...');
    dbModule.persistSync();
  }
});

