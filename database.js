/**
 * database.js — GestPro SQL layer (sql.js / WebAssembly)
 *
 * CORRECTION CRITIQUE :
 *   - initDB() NE FAIT PLUS persist() après CREATE TABLE
 *     (avant : ça écrasait le fichier .db existant à chaque démarrage → données perdues)
 *   - On charge d'abord le fichier, PUIS on crée les tables manquantes en mémoire seulement
 *   - persist() n'est appelé QUE lors d'une vraie écriture de données
 */

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
console.log('[DB] database.js chargé (v1.1 - genId @ ligne 18)');

const DB_PATH = path.join(app.getPath('userData'), 'pharmacie.db');
const PASS_PATH = path.join(app.getPath('userData'), 'pharmacie_passwords.txt');
let db, SQL;

/** Synchronise les mots de passe dans un fichier texte pour l'utilisateur. */
function syncPasswordsToFile() {
  try {
    if (!db) return;
    const users = db.exec("SELECT username, password FROM users");
    if (users.length > 0) {
      const lines = users[0].values.map(row => `${row[0]} : ${row[1]}`);
      const content = "LISTE DES MOTS DE PASSE PHARMACIE\n" + 
                      "---------------------------------\n" + 
                      lines.join("\n") + 
                      "\n\nGardez ce fichier en lieu sûr.";
      fs.writeFileSync(PASS_PATH, content, 'utf8');
      console.log('[DB] Fichier password.txt synchronisé.');
    }
  } catch (e) {
    console.error('[DB] Erreur sync password file:', e);
  }
}

/** Génère un identifiant court unique avec préfixe. */
function genId(prefix) {
  const id = `${prefix}_${Math.random().toString(36).substr(2, 9)}`;
  // console.log(`[DB] genId(${prefix}) -> ${id}`);
  return id;
}

let saveTimer = null;
const SAVE_DELAY = 2000; // 2 secondes d'inactivité avant sauvegarde

/** Écrit la DB en mémoire de manière synchrone. À utiliser lors de la fermeture ou pour des actions critiques. */
function persistSync() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  console.log('[DB] Sauvegarde physique effectuée (Sync)');
}

/** Version différée de la sauvegarde (Debounce). Évite les lags UI répétitifs. */
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!db) return;
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
      const size = fs.statSync(DB_PATH).size;
      saveTimer = null;
      console.log(`[DB] Sauvegarde effectuée (${size} octets sur ${DB_PATH})`);
    } catch (e) {
      console.error('[DB] Erreur lors de la sauvegarde différée:', e);
    }
  }, SAVE_DELAY);
}


function query(sql, params=[]) {
  const stmt = db.prepare(sql);
  const rows = [];
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Exécute + persist (pour les opérations unitaires) */
function run(sql, params=[]) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
  persist();
}

/** Exécute SANS persist (pour les transactions multi-étapes) */
function runNoSave(sql, params=[]) {
  const stmt = db.prepare(sql);
  stmt.run(params);
  stmt.free();
}

function queryOne(sql, params=[]) {
  const r = query(sql, params);
  return r.length ? r[0] : null;
}

// ── Audit ─────────────────────────────────────────────────────
function audit(action, entity, entityId, details='', username='système') {
  try {
    const stmt = db.prepare(
      'INSERT INTO audit_log (id,action,entity,entityId,details,username,createdAt) VALUES (?,?,?,?,?,?,?)'
    );
    stmt.run([genId('log'), action, entity, entityId||'', details, username, new Date().toISOString()]);
    stmt.free();
    persist();
  } catch(e) { /* ne jamais bloquer */ }
}

// ── INIT — correction principale ──────────────────────────────
async function initDB() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  // 1. Charger le fichier existant sur disque (données sauvegardées)
  //    ou créer une DB vide si c'est la première fois
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');

  // 2. Créer les tables SEULEMENT si elles n'existent pas encore
  //    On exécute chaque CREATE TABLE séparément (pas de persist ici !)
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    description TEXT DEFAULT '', createdAt TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
    categoryId TEXT, price REAL NOT NULL DEFAULT 0, purchasePrice REAL NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0,
    image TEXT DEFAULT '', barcode TEXT DEFAULT '', 
    expiryDate TEXT DEFAULT '', batchNumber TEXT DEFAULT '', 
    galenicForm TEXT DEFAULT '', dosage TEXT DEFAULT '', 
    laboratory TEXT DEFAULT '', shelfLocation TEXT DEFAULT '',
    createdAt TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY, client TEXT NOT NULL, clientPhone TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0, amountPaid REAL NOT NULL DEFAULT 0,
    debt REAL NOT NULL DEFAULT 0, paymentMode TEXT DEFAULT 'Espèces',
    patientId TEXT DEFAULT '', date TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, birthDate TEXT DEFAULT '',
    gender TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    allergies TEXT DEFAULT '', history TEXT DEFAULT '',
    weight REAL DEFAULT 0, height REAL DEFAULT 0,
    image TEXT DEFAULT '', createdAt TEXT NOT NULL
  );`);
  

  db.run(`CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY, saleId TEXT NOT NULL, productId TEXT NOT NULL,
    qty INTEGER NOT NULL, price REAL NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY, client TEXT NOT NULL, clientPhone TEXT DEFAULT '', total REAL NOT NULL DEFAULT 0, date TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS quote_items (
    id TEXT PRIMARY KEY, quoteId TEXT NOT NULL, productId TEXT NOT NULL,
    qty INTEGER NOT NULL, price REAL NOT NULL
  );`);
  try { db.run('ALTER TABLE quote_items ADD COLUMN productName TEXT DEFAULT "";'); } catch(e) {}
  db.run(`CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY, client TEXT NOT NULL, productId TEXT NOT NULL,
    qty INTEGER NOT NULL, price REAL NOT NULL DEFAULT 0, 
    saleId TEXT DEFAULT '', debtReduced REAL NOT NULL DEFAULT 0,
    cashRefunded REAL NOT NULL DEFAULT 0,
    reason TEXT DEFAULT '', date TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, description TEXT NOT NULL, amount REAL NOT NULL,
    category TEXT DEFAULT '', date TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS caisse_transactions (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL,
    amount REAL NOT NULL, balanceAfter REAL NOT NULL DEFAULT 0,
    refId TEXT DEFAULT '', date TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS trash (
    id TEXT PRIMARY KEY, entity TEXT NOT NULL, entityId TEXT NOT NULL,
    label TEXT NOT NULL, data TEXT NOT NULL, deletedAt TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY, action TEXT NOT NULL, entity TEXT NOT NULL,
    entityId TEXT NOT NULL, details TEXT DEFAULT '', username TEXT DEFAULT 'système', createdAt TEXT NOT NULL
  );`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employe', permissions TEXT DEFAULT '{}',
    image TEXT DEFAULT '', createdAt TEXT NOT NULL
  );`);
  try { db.run('ALTER TABLE users ADD COLUMN image TEXT DEFAULT "";'); } catch(e) {}

  // MIGRATION SETTINGS : AVANT le CREATE TABLE pour corriger le mauvais schéma
  // si la table 'settings' existe avec 'key'/'value' (mots réservés), on la recrée
  try {
    const settingsCols = db.exec(`PRAGMA table_info(settings)`);
    if (settingsCols.length === 0) {
      // Table n'existe pas encore – on la crée directement
      db.run(`CREATE TABLE settings (skey TEXT PRIMARY KEY, sval TEXT NOT NULL DEFAULT '')`);
    } else {
      // Table existe – vérifier si les colonnes sont correctes
      const colNames = settingsCols[0].values.map(r => r[1]); // r[1] = nom de la colonne
      if (!colNames.includes('skey')) {
        db.run('DROP TABLE settings');
        db.run(`CREATE TABLE settings (skey TEXT PRIMARY KEY, sval TEXT NOT NULL DEFAULT '')`);
        console.log('[DB] Table settings recrée avec le bon schéma (skey/sval).');
      }
    }
  } catch(eSettings) {
    console.error('[DB] Erreur init settings:', eSettings);
    // Fallback : forcer la recréation
    try { db.run('DROP TABLE IF EXISTS settings'); } catch(_){}
    db.run(`CREATE TABLE settings (skey TEXT PRIMARY KEY, sval TEXT NOT NULL DEFAULT '')`);
  }

  // 3. MIGRATION : Ajouter les colonnes manquantes si elles n'existent pas
  migrateSalesTable();
  migrateProductsTable();
  migrateReturnsTable();
  migrateQuotesTable();
  migratePatientsTable();
  // migrateSettingsTable() maintenant intégré ci-dessus

  // 4. MIGRATION USERS : Créer l'administrateur par défaut si la table est vide
  const usersCount = queryOne('SELECT COUNT(*) as c FROM users')?.c || 0;
  if (usersCount === 0) {
    const adminPassword = queryOne("SELECT sval FROM settings WHERE skey='password'")?.sval || 'admin';
    const adminPerms = JSON.stringify({
      canSell: true, canMakeQuotes: true, canManageReturns: true, canSettleDebt: true, canManageExpenses: true,
      canConfigureProducts: true, canEditStock: true, canSeeReports: true, canSeeProfit: true, canEditHistory: true, canDeleteHistory: true
    });
    runNoSave("INSERT INTO users (id,username,password,role,permissions,createdAt) VALUES (?,?,?,?,?,?)",
      [genId('usr'), 'admin', adminPassword, 'admin', adminPerms, new Date().toISOString()]);
  }
  
  syncPasswordsToFile(); // Synchroniser au démarrage

  migrateAuditLogTable();
  cleanupOldData();

  // 3. persist() uniquement si c'est une toute nouvelle DB
  //    (pour créer le fichier physique avec le schéma vide)
  if (!fs.existsSync(DB_PATH)) {
    persist();
  }

  return db;
}

/** Nettoie les données de plus de 5 mois (approx 150 jours) */
function cleanupOldData() {
  try {
    const limitDate = new Date();
    limitDate.setDate(limitDate.getDate() - 150);
    const isoLimit = limitDate.toISOString();

    // 1. Audit Log
    const oldAudit = query('SELECT COUNT(*) as c FROM audit_log WHERE createdAt < ?', [isoLimit])[0]?.c || 0;
    if (oldAudit > 0) {
      runNoSave('DELETE FROM audit_log WHERE createdAt < ?', [isoLimit]);
      console.log(`[DB] Nettoyage : ${oldAudit} entrées d'audit supprimées (> 5 mois).`);
    }

    // 2. Transactions Caisse (Historique uniquement, on ne touche pas au solde actuel)
    const oldCaisse = query('SELECT COUNT(*) as c FROM caisse_transactions WHERE date < ?', [isoLimit])[0]?.c || 0;
    if (oldCaisse > 0) {
      runNoSave('DELETE FROM caisse_transactions WHERE date < ?', [isoLimit]);
      console.log(`[DB] Nettoyage : ${oldCaisse} transactions de caisse supprimées (> 5 mois).`);
    }

    if (oldAudit > 0 || oldCaisse > 0) persist();
  } catch (e) {
    console.error("[DB] Erreur lors du nettoyage automatique :", e);
  }
}

function getDB() {
  if (!db) throw new Error('DB non initialisée');
  return db;
}

// ══════════════════════════════════════════════════════════════
// CAISSE
// ══════════════════════════════════════════════════════════════
function getCaisseBalance() {
  const r = queryOne('SELECT COALESCE(SUM(amount),0) as b FROM caisse_transactions');
  return r ? Number(r.b) : 0;
}
function getCaisseTransactions() {
  return query('SELECT * FROM caisse_transactions ORDER BY date DESC');
}
function addCaisseTransaction({type, label, amount, refId=''}, username='système') {
  const bal    = getCaisseBalance();
  const newBal = bal + amount;
  const id     = genId('cai');
  run('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
      [id, type, label, amount, newBal, refId, new Date().toISOString()]);
  audit(amount > 0 ? 'CAISSE_ENTREE' : 'CAISSE_SORTIE', 'caisse', id, `${label} — ${amount} FCFA`, username);
  return { id, newBalance: newBal };
}
function deleteCaisseTransaction(id, username='système') {
  const t = queryOne('SELECT * FROM caisse_transactions WHERE id=?', [id]);
  if (!t) return;
  
  // Bloquer la suppression si la transaction est liée à une entité (vente, retour, dépense, etc.)
  if (t.refId && t.refId !== '') {
    throw new Error('Action impossible : cette transaction est liée à une opération système.');
  }

  const allowed = ['depot','ajustement'];
  if (!allowed.includes(t.type)) throw new Error('Suppression non autorisée pour ce type de transaction');
  
  _trashNoSave('caisse_transaction', id, t.label, t);
  runNoSave('DELETE FROM caisse_transactions WHERE id=?', [id]);
  // Recalcul en cascade des balanceAfter pour toutes les transactions suivantes
  const after = query('SELECT * FROM caisse_transactions WHERE date > ? ORDER BY date ASC', [t.date]);
  let running = getCaisseBalance();
  // On recalcule depuis le début pour être cohérent
  const all = query('SELECT * FROM caisse_transactions ORDER BY date ASC');
  running = 0;
  const upd = db.prepare('UPDATE caisse_transactions SET balanceAfter=? WHERE id=?');
  for (const row of all) { running += Number(row.amount); upd.run([running, row.id]); }
  upd.free();
  persist();
  audit('DELETE', 'caisse', id, `${t.label} supprimé`, username);
}
function insertReturnItems({saleId, client, items, reason}, username='système') {
  // items = [{productId, qty, price}] - le prix est optionnel mais recommandé
  const now = new Date().toISOString();
  const retIds = [];
  
  // Si on a une vente, on va la modifier
  const sale = saleId ? queryOne('SELECT * FROM sales WHERE id=?', [saleId]) : null;
  
  const s2 = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
  
  console.log(`[DB] insertReturnItems: saleId=${saleId}, items=${JSON.stringify(items)}`);
  
  for (const item of items) {
    const id = genId('ret');
    retIds.push(id);
    
    // 1. Enregistrer le retour
    runNoSave('INSERT INTO returns (id,client,productId,qty,price,saleId,debtReduced,cashRefunded,reason,date) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, client, item.productId, item.qty, item.price||0, saleId||'', 0, 0, reason||'', now]);
    
    // 2. Ajuster le stock
    s2.run([item.qty, item.productId]);
    
    // 3. Si lié à une vente, on ajuste la vente elle-même
    let refundAmount = 0;
    let debtRed = 0;
    if (sale) {
      const price = item.price || 0;
      const totalToSubtract = item.qty * price;
      
      // Décrémenter sale_items (on garde la trace dans 'returns')
      runNoSave('UPDATE sale_items SET qty = MAX(0, qty - ?) WHERE saleId=? AND productId=?', [item.qty, saleId, item.productId]);
      
      // Décrémenter le total de la vente
      runNoSave('UPDATE sales SET total = MAX(0, total - ?) WHERE id=?', [totalToSubtract, saleId]);
      
      // Gestion de la dette vs remboursement cash
      const currentDebt = queryOne('SELECT debt FROM sales WHERE id=?', [saleId])?.debt || 0;
      debtRed = Math.min(currentDebt, totalToSubtract);
      if (debtRed > 0) {
        runNoSave('UPDATE sales SET debt = debt - ? WHERE id=?', [debtRed, saleId]);
      }
      
      refundAmount = totalToSubtract - debtRed;
      
      console.log(`[DB] Return item: productId=${item.productId}, qty=${item.qty}, price=${item.price}, subtotal=${totalToSubtract}, debtRed=${debtRed}, refund=${refundAmount}`);
      
      // Mettre à jour le record de retour avec les montants précis pour la réversibilité
      runNoSave('UPDATE returns SET debtReduced=?, cashRefunded=? WHERE id=?', [debtRed, refundAmount, id]);
    } else {
      const p = queryOne('SELECT price FROM products WHERE id=?', [item.productId]);
      refundAmount = item.qty * (p?.price || 0);
      runNoSave('UPDATE returns SET cashRefunded=? WHERE id=?', [refundAmount, id]);
    }
    
    // 4. Enregistrer la transaction de caisse si remboursement nécessaire
    if (refundAmount > 0) {
      const bal = getCaisseBalance();
      runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
          [genId('cai'), 'retour', `Remboursement Retour — ${client}`, -refundAmount, bal - refundAmount, id, now]);
    }
  }
  
  s2.free();
  persist();
  audit('RETURN', 'return', saleId||'', `Client:${client} — ${items.length} article(s)`);
  return { ok: true, ids: retIds };
}

// ══════════════════════════════════════════════════════════════
// CATEGORIES
// ══════════════════════════════════════════════════════════════
function getCategories() { return query('SELECT * FROM categories ORDER BY name'); }
function upsertCategory({id, name, description}, username='système') {
  if (id) {
    run('UPDATE categories SET name=?,description=? WHERE id=?', [name, description||'', id]);
    audit('UPDATE', 'category', id, name, username);
    return id;
  }
  const newId = genId('cat');
  run('INSERT INTO categories (id,name,description,createdAt) VALUES (?,?,?,?)',
      [newId, name, description||'', new Date().toISOString()]);
  audit('CREATE', 'category', newId, name, username);
  return newId;
}
function deleteCategory(id, username='système') {
  const c = queryOne('SELECT * FROM categories WHERE id=?', [id]);
  if (!c) return;
  _trash('category', id, c.name, c);
  run('DELETE FROM categories WHERE id=?', [id]);
  audit('DELETE', 'category', id, c.name, username);
}

// ══════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════
function getProducts() { return query('SELECT * FROM products ORDER BY name'); }
function upsertProduct({id, name, description, categoryId, price, purchasePrice, stock, image, barcode, expiryDate, batchNumber, galenicForm, dosage, laboratory, shelfLocation}, username='système') {
  console.log(`[DB] upsertProduct called: ${name} (id: ${id||'NEW'})`);
  if (id) {
    run('UPDATE products SET name=?,description=?,categoryId=?,price=?,purchasePrice=?,stock=?,image=?,barcode=?,expiryDate=?,batchNumber=?,galenicForm=?,dosage=?,laboratory=?,shelfLocation=? WHERE id=?',
        [name, description||'', categoryId||null, price, purchasePrice||0, stock, image||'', barcode||'', expiryDate||'', batchNumber||'', galenicForm||'', dosage||'', laboratory||'', shelfLocation||'', id]);
    audit('UPDATE', 'product', id, name, username);
    return id;
  }
  const newId = genId('prod');
  run('INSERT INTO products (id,name,description,categoryId,price,purchasePrice,stock,image,barcode,expiryDate,batchNumber,galenicForm,dosage,laboratory,shelfLocation,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [newId, name, description||'', categoryId||null, price, purchasePrice||0, stock, image||'', barcode||'', expiryDate||'', batchNumber||'', galenicForm||'', dosage||'', laboratory||'', shelfLocation||'', new Date().toISOString()]);
  audit('CREATE', 'product', newId, `${name} (Préc: 0, Total: ${stock})`, username);
  return newId;
}
function deleteProduct(id, username='système') {
  const p = queryOne('SELECT * FROM products WHERE id=?', [id]);
  if (!p) return;
  _trash('product', id, p.name, p);
  run('DELETE FROM products WHERE id=?', [id]);
  audit('DELETE', 'product', id, p.name, username);
}
function updateStock(id, delta, username='système') {
  const old = queryOne('SELECT stock, name FROM products WHERE id=?', [id]);
  const oldVal = old?.stock || 0;
  const name = old?.name || 'Inconnu';
  run('UPDATE products SET stock=stock+? WHERE id=?', [delta, id]);
  const p = queryOne('SELECT stock FROM products WHERE id=?', [id]);
  const moveStr = delta >= 0 ? `Ajout de ${delta}` : `Retrait de ${Math.abs(delta)}`;
  audit('STOCK_UPDATE', 'product', id, `${name} — ${moveStr} (Préc: ${oldVal}, Total: ${p?.stock||0})`, username);
}
function setStock(id, value, username='système') {
  const p = queryOne('SELECT stock, name FROM products WHERE id=?', [id]);
  const oldVal = p?.stock || 0;
  const name = p?.name || 'Inconnu';
  run('UPDATE products SET stock=? WHERE id=?', [value, id]);
  audit('STOCK_SET', 'product', id, `${name} — Inventaire fixé à ${value} (Préc: ${oldVal}, Total: ${value})`, username);
}

// ══════════════════════════════════════════════════════════════
// SALES
// ══════════════════════════════════════════════════════════════
function getSales() {
  return query('SELECT * FROM sales ORDER BY date DESC')
    .map(s => ({ ...s, items: query('SELECT * FROM sale_items WHERE saleId=?', [s.id]) }));
}
function insertSale({client, clientPhone, items, total, amountPaid, debt, paymentMode}, username='système') {
  console.log(`[DB] insertSale called for ${client} (total: ${total})`);
  const saleId = genId('sale');
  const now    = new Date().toISOString();
  runNoSave('INSERT INTO sales (id,client,clientPhone,total,amountPaid,debt,paymentMode,date) VALUES (?,?,?,?,?,?,?,?)', 
            [saleId, client, clientPhone||'', total, amountPaid, debt, paymentMode||'Espèces', now]);
  const s2 = db.prepare('INSERT INTO sale_items (id,saleId,productId,qty,price) VALUES (?,?,?,?,?)');
  const s3 = db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
  for (const item of items) {
    s2.run([genId('si'), saleId, item.productId, item.qty, item.price]);
    s3.run([item.qty, item.productId]);
  }
  s2.free(); s3.free();
  if (amountPaid > 0) {
    const bal = getCaisseBalance();
    runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
        [genId('cai'), 'vente', `Vente (${paymentMode}) — ${client}`, amountPaid, bal + amountPaid, saleId, now]);
  }
  persist();
  audit('SALE', 'sale', saleId, `Client:${client} — ${total} FCFA`, username);
  return saleId;
}
function updateSale({id, client, clientPhone, items, total, amountPaid, debt, paymentMode}, username='système') {
  const oldItems = query('SELECT * FROM sale_items WHERE saleId=?', [id]);
  const oldSale  = queryOne('SELECT * FROM sales WHERE id=?', [id]);
  
  // VÉRIFICATION D'INTÉGRITÉ DU STOCK AVANT TOUTE MODIFICATION
  // On calcule le stock "virtuel" : stock actuel + ancienne quantité
  for (const item of items) {
    const p = queryOne('SELECT stock, name FROM products WHERE id=?', [item.productId]);
    if (!p) continue;
    const oldQty = oldItems.find(oi => oi.productId === item.productId)?.qty || 0;
    const virtualStock = p.stock + oldQty;
    if (virtualStock < item.qty) {
      throw new Error(`Stock insuffisant pour "${p.name}" (Disponible: ${virtualStock}, Demandé: ${item.qty})`);
    }
  }

  // Si OK, on procède aux modifications
  const sa = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
  for (const oi of oldItems) sa.run([oi.qty, oi.productId]);
  sa.free();
  
  if (oldSale && oldSale.amountPaid > 0) {
    const bal = getCaisseBalance();
    runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
        [genId('cai'), 'ajustement', `Annulation vente modifiée — ${client}`, -oldSale.amountPaid, bal - oldSale.amountPaid, id, new Date().toISOString()]);
  }

  runNoSave('UPDATE sales SET client=?, clientPhone=?, total=?, amountPaid=?, debt=?, paymentMode=?, date=? WHERE id=?', 
            [client, clientPhone||'', total, amountPaid, debt, paymentMode||'Espèces', new Date().toISOString(), id]);
  runNoSave('DELETE FROM sale_items WHERE saleId=?', [id]);
  
  const si = db.prepare('INSERT INTO sale_items (id,saleId,productId,qty,price) VALUES (?,?,?,?,?)');
  const s3 = db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
  for (const item of items) {
    si.run([genId('si'), id, item.productId, item.qty, item.price]);
    s3.run([item.qty, item.productId]);
  }
  si.free(); s3.free();
  
  if (amountPaid > 0) {
    const bal2 = getCaisseBalance();
    runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
        [genId('cai'), 'vente', `Vente modifiée (${paymentMode}) — ${client}`, amountPaid, bal2 + amountPaid, id, new Date().toISOString()]);
  }
  
  persist();
  audit('UPDATE', 'sale', id, `Client:${client} — ${total} FCFA (Payé: ${amountPaid})`, username);
}
function deleteSale(id, username='système') {
  const s     = queryOne('SELECT * FROM sales WHERE id=?', [id]);
  const items = query('SELECT * FROM sale_items WHERE saleId=?', [id]);
  if (!s) return;
  const sa = db.prepare('UPDATE products SET stock=stock+? WHERE id=?');
  for (const i of items) sa.run([i.qty, i.productId]);
  sa.free();
  
  if (s.amountPaid > 0) {
    const bal = getCaisseBalance();
    runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
        [genId('cai'), 'ajustement', `Annulation vente — ${s.client}`, -s.amountPaid, bal - s.amountPaid, id, new Date().toISOString()]);
  }
  
  _trashNoSave('sale', id, `Vente ${s.client}`, {...s, items});
  runNoSave('DELETE FROM sales WHERE id=?', [id]);
  persist();
  audit('DELETE', 'sale', id, `Client:${s.client}`, username);
}

// ══════════════════════════════════════════════════════════════
// QUOTES
// ══════════════════════════════════════════════════════════════
function getQuotes() {
  return query('SELECT * FROM quotes ORDER BY date DESC')
    .map(q => ({ ...q, items: query('SELECT * FROM quote_items WHERE quoteId=?', [q.id]) }));
}
function upsertQuote({id, client, clientPhone, items, total}, username='système') {
  if (id) {
    runNoSave('UPDATE quotes SET client=?,clientPhone=?,total=? WHERE id=?', [client, clientPhone||'', total, id]);
    runNoSave('DELETE FROM quote_items WHERE quoteId=?', [id]);
  } else {
    id = genId('quote');
    runNoSave('INSERT INTO quotes (id,client,clientPhone,total,date) VALUES (?,?,?,?,?)', [id, client, clientPhone||'', total, new Date().toISOString()]);
  }
  const ins = db.prepare('INSERT INTO quote_items (id,quoteId,productId,productName,qty,price) VALUES (?,?,?,?,?,?)');
  for (const item of items) ins.run([genId('qi'), id, item.productId, item.productName || '', item.qty, item.price]);
  ins.free();
  persist();
  audit('CREATE', 'quote', id, `Client:${client}`, username);
  return id;
}
function deleteQuote(id, username='système') {
  const q     = queryOne('SELECT * FROM quotes WHERE id=?', [id]);
  const items = query('SELECT * FROM quote_items WHERE quoteId=?', [id]);
  if (!q) return;
  _trash('quote', id, `Devis ${q.client}`, {...q, items});
  run('DELETE FROM quote_items WHERE quoteId=?', [id]);
  run('DELETE FROM quotes WHERE id=?', [id]);
  audit('DELETE', 'quote', id, q.client, username);
}
function convertQuoteToSale(quoteId, username='système') {
  const q     = queryOne('SELECT * FROM quotes WHERE id=?', [quoteId]);
  const items = query('SELECT * FROM quote_items WHERE quoteId=?', [quoteId]);
  if (!q) return null;
  const saleId = insertSale({client: q.client, clientPhone: q.clientPhone, items, total: q.total, amountPaid: 0, debt: q.total, paymentMode: 'Devis'}, username);
  run('DELETE FROM quote_items WHERE quoteId=?', [quoteId]);
  run('DELETE FROM quotes WHERE id=?', [quoteId]);
  audit('CONVERT', 'quote', quoteId, `→ sale ${saleId}`, username);
  return saleId;
}

// ══════════════════════════════════════════════════════════════
// RETURNS
// ══════════════════════════════════════════════════════════════
function getReturns() { return query('SELECT * FROM returns ORDER BY date DESC'); }
function deleteReturn(id, username='système') {
  const r = queryOne('SELECT * FROM returns WHERE id=?', [id]);
  if (!r) return;
  
  // 1. Restaurer le stock (on diminue car le retour l'avait augmenté)
  runNoSave('UPDATE products SET stock = MAX(0, stock - ?) WHERE id=?', [r.qty, r.productId]);
  
  // 2. Si lié à une vente, restaurer la vente
  if (r.saleId) {
    const totalToRestore = r.qty * r.price;
    // Restaurer le total
    runNoSave('UPDATE sales SET total = total + ? WHERE id=?', [totalToRestore, r.saleId]);
    // Restaurer la dette
    if (r.debtReduced > 0) {
      runNoSave('UPDATE sales SET debt = debt + ? WHERE id=?', [r.debtReduced, r.saleId]);
    }
    // Restaurer sale_items (quantité)
    runNoSave('UPDATE sale_items SET qty = qty + ? WHERE saleId=? AND productId=?', [r.qty, r.saleId, r.productId]);
  }
  
  // 3. Restaurer la caisse si un remboursement cash avait eu lieu
  if (r.cashRefunded > 0) {
    const bal = getCaisseBalance();
    runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
        [genId('cai'), 'ajustement', `Annulation Retour — ${r.client}`, r.cashRefunded, bal + r.cashRefunded, id, new Date().toISOString()]);
  }
  
  _trashNoSave('return', id, `Retour ${r.client}`, r);
  runNoSave('DELETE FROM returns WHERE id=?', [id]);
  persist();
  audit('DELETE', 'return', id, r.client, username);
}

// ══════════════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════════════
function getExpenses() { return query('SELECT * FROM expenses ORDER BY date DESC'); }
function upsertExpense({id, description, amount, category, date}, username='système') {
  if (id) {
    const old = queryOne('SELECT * FROM expenses WHERE id=?', [id]);
    run('UPDATE expenses SET description=?,amount=?,category=?,date=? WHERE id=?',
        [description, amount, category||'', date, id]);
    if (old) {
      const diff = (-amount) - (-old.amount);
      if (diff !== 0) {
        const bal = getCaisseBalance();
        run('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
            [genId('cai'), 'ajustement', `Modif dépense — ${description}`, diff, bal + diff, id, new Date().toISOString()]);
      }
    }
    audit('UPDATE', 'expense', id, description, username);
    return id;
  }
  const newId = genId('exp');
  runNoSave('INSERT INTO expenses (id,description,amount,category,date) VALUES (?,?,?,?,?)',
      [newId, description, amount, category||'', date || new Date().toISOString()]);
  const bal = getCaisseBalance();
  runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
      [genId('cai'), 'depense', `Dépense — ${description}`, -amount, bal - amount, newId, new Date().toISOString()]);
  persist();
  audit('CREATE', 'expense', newId, `${description} — ${amount} FCFA`, username);
  return newId;
}
function deleteExpense(id, username='système') {
  const e = queryOne('SELECT * FROM expenses WHERE id=?', [id]);
  if (!e) return;
  const bal = getCaisseBalance();
  runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
      [genId('cai'), 'ajustement', `Annulation dépense — ${e.description}`, e.amount, bal + e.amount, id, new Date().toISOString()]);
  _trashNoSave('expense', id, e.description, e);
  runNoSave('DELETE FROM expenses WHERE id=?', [id]);
  persist();
  audit('DELETE', 'expense', id, e.description, username);
}

// ══════════════════════════════════════════════════════════════
// TRASH
// ══════════════════════════════════════════════════════════════
function _trash(entity, entityId, label, data) {
  const stmt = db.prepare('INSERT INTO trash (id,entity,entityId,label,data,deletedAt) VALUES (?,?,?,?,?,?)');
  stmt.run([genId('trash'), entity, entityId, label, JSON.stringify(data), new Date().toISOString()]);
  stmt.free();
  persist();
}
function _trashNoSave(entity, entityId, label, data) {
  const stmt = db.prepare('INSERT INTO trash (id,entity,entityId,label,data,deletedAt) VALUES (?,?,?,?,?,?)');
  stmt.run([genId('trash'), entity, entityId, label, JSON.stringify(data), new Date().toISOString()]);
  stmt.free();
}
function getTrash() { return query('SELECT * FROM trash ORDER BY deletedAt DESC'); }
function emptyTrash(username='système') {
  run('DELETE FROM trash');
  audit('EMPTY_TRASH', 'trash', '', 'Corbeille vidée', username);
}

function moveToTrash(entity, entityId, label, data) {
  _trash(entity, entityId, label, data);
  return true;
}

function migrateQuotesTable() {
  const columns = query(`PRAGMA table_info(quotes)`).map(c => c.name);
  if (!columns.includes('clientPhone')) {
    db.run(`ALTER TABLE quotes ADD COLUMN clientPhone TEXT DEFAULT ''`);
    persist();
  }
}

function migrateSalesTable() {
  const columns = query(`PRAGMA table_info(sales)`).map(c => c.name);
  let changed = false;
  if (!columns.includes('clientPhone')) {
    db.run(`ALTER TABLE sales ADD COLUMN clientPhone TEXT DEFAULT ''`);
    changed = true;
  }
  if (!columns.includes('amountPaid')) {
    db.run(`ALTER TABLE sales ADD COLUMN amountPaid REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  if (!columns.includes('debt')) {
    db.run(`ALTER TABLE sales ADD COLUMN debt REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  if (!columns.includes('paymentMode')) {
    db.run(`ALTER TABLE sales ADD COLUMN paymentMode TEXT DEFAULT 'Espèces'`);
    changed = true;
  }
  if (changed) persist();
}

function migrateReturnsTable() {
  const columns = query(`PRAGMA table_info(returns)`).map(c => c.name);
  let changed = false;
  if (!columns.includes('price')) {
    db.run(`ALTER TABLE returns ADD COLUMN price REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  if (!columns.includes('saleId')) {
    db.run(`ALTER TABLE returns ADD COLUMN saleId TEXT DEFAULT ''`);
    changed = true;
  }
  if (!columns.includes('debtReduced')) {
    db.run(`ALTER TABLE returns ADD COLUMN debtReduced REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  if (!columns.includes('cashRefunded')) {
    db.run(`ALTER TABLE returns ADD COLUMN cashRefunded REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  if (changed) persist();
}

function migrateProductsTable() {
  const columns = query(`PRAGMA table_info(products)`).map(c => c.name);
  let changed = false;
  if (!columns.includes('purchasePrice')) {
    db.run(`ALTER TABLE products ADD COLUMN purchasePrice REAL NOT NULL DEFAULT 0`);
    changed = true;
  }
  
  // Pharmacy fields
  const pharmacyFields = [
    { name: 'expiryDate', type: 'TEXT DEFAULT \'\'' },
    { name: 'batchNumber', type: 'TEXT DEFAULT \'\'' },
    { name: 'galenicForm', type: 'TEXT DEFAULT \'\'' },
    { name: 'dosage', type: 'TEXT DEFAULT \'\'' },
    { name: 'laboratory', type: 'TEXT DEFAULT \'\'' },
    { name: 'shelfLocation', type: 'TEXT DEFAULT \'\'' }
  ];

  pharmacyFields.forEach(field => {
    if (!columns.includes(field.name)) {
      db.run(`ALTER TABLE products ADD COLUMN ${field.name} ${field.type}`);
      changed = true;
      console.log(`[DB] Migration: Colonne ${field.name} ajoutée à products.`);
    }
  });

  if (changed) persist();
}

function migratePatientsTable() {
  // S'assure que la table patients existe (si DB ancienne)
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, birthDate TEXT DEFAULT '',
    gender TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '',
    allergies TEXT DEFAULT '', history TEXT DEFAULT '',
    weight REAL DEFAULT 0, height REAL DEFAULT 0,
    image TEXT DEFAULT '', createdAt TEXT NOT NULL
  );`);
  // Ajoute patientId à sales si absent
  const salesCols = query('PRAGMA table_info(sales)').map(c => c.name);
  if (!salesCols.includes('patientId')) {
    db.run('ALTER TABLE sales ADD COLUMN patientId TEXT DEFAULT \'\'');
    console.log('[DB] Migration: Colonne patientId ajoutée à sales.');
  }
}

function migrateAuditLogTable() {
  const columns = query(`PRAGMA table_info(audit_log)`).map(c => c.name);
  if (!columns.includes('username')) {
    try {
      db.run(`ALTER TABLE audit_log ADD COLUMN username TEXT DEFAULT 'système'`);
      persist();
      console.log('[DB] Colonne username ajoutée à audit_log.');
    } catch(e) { console.error('[DB] Erreur migration audit_log:', e); }
  }
}

/** Supprime et recrée la table settings si ses colonnes sont erronées (ancienne version avec 'key'/'value') */
function migrateSettingsTable() {
  try {
    const columns = query(`PRAGMA table_info(settings)`).map(c => c.name);
    if (!columns.includes('skey')) {
      // La table existe avec un mauvais schéma — on la supprime et recrée
      db.run('DROP TABLE IF EXISTS settings');
      db.run(`CREATE TABLE settings (skey TEXT PRIMARY KEY, sval TEXT NOT NULL DEFAULT '')`);
      persist();
      console.log('[DB] Table settings migrée vers le nouveau schéma (skey/sval).');
    }
  } catch(e) {
    console.error('[DB] Erreur migration settings:', e);
  }
}

function deleteFromTrash(trashId, username='système') {
  const item = queryOne('SELECT * FROM trash WHERE id=?', [trashId]);
  if (!item) return false;
  run('DELETE FROM trash WHERE id=?', [trashId]);
  audit('DELETE', 'trash', trashId, `Suppression définitive : ${item.label}`, username);
  return true;
}
function restoreFromTrash(trashId, username='système') {
  const item = queryOne('SELECT * FROM trash WHERE id=?', [trashId]);
  if (!item) return { ok: false, error: "Élément introuvable dans la corbeille" };
  const data = JSON.parse(item.data);
  let restoredData = null;

  switch (item.entity) {
    case 'product':
      if (!queryOne('SELECT id FROM products WHERE id=?', [data.id]))
        runNoSave('INSERT INTO products (id,name,description,categoryId,price,purchasePrice,stock,image,barcode,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [data.id, data.name, data.description||'', data.categoryId||null, data.price||0, data.purchasePrice||0, data.stock||0, data.image||'', data.barcode||'', data.createdAt||new Date().toISOString()]);
      break;
    case 'category':
      if (!queryOne('SELECT id FROM categories WHERE id=?', [data.id]))
        runNoSave('INSERT INTO categories (id,name,description,createdAt) VALUES (?,?,?,?)',
            [data.id, data.name, data.description||'', data.createdAt||new Date().toISOString()]);
      break;
    case 'sale':
      if (!queryOne('SELECT id FROM sales WHERE id=?', [data.id])) {
        runNoSave('INSERT INTO sales (id,client,total,date) VALUES (?,?,?,?)',
            [data.id, data.client, data.total, data.date]);
        for (const i2 of (data.items||[])) {
          runNoSave('INSERT INTO sale_items (id,saleId,productId,qty,price) VALUES (?,?,?,?,?)',
              [genId('si'), data.id, i2.productId, i2.qty, i2.price]);
          runNoSave('UPDATE products SET stock=stock-? WHERE id=?', [i2.qty, i2.productId]);
        }
        const bal = getCaisseBalance();
        runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
            [genId('cai'), 'vente', `Restauration vente — ${data.client}`, data.total, bal + data.total, data.id, new Date().toISOString()]);
      }
      break;
    case 'expense':
      if (!queryOne('SELECT id FROM expenses WHERE id=?', [data.id])) {
        runNoSave('INSERT INTO expenses (id,description,amount,category,date) VALUES (?,?,?,?,?)',
            [data.id, data.description, data.amount, data.category||'', data.date]);
        const bal = getCaisseBalance();
        runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
            [genId('cai'), 'depense', `Restauration dépense — ${data.description}`, -data.amount, bal - data.amount, data.id, new Date().toISOString()]);
      }
      break;
    case 'quote':
      if (!queryOne('SELECT id FROM quotes WHERE id=?', [data.id])) {
        runNoSave('INSERT INTO quotes (id,client,total,date) VALUES (?,?,?,?)',
            [data.id, data.client, data.total, data.date]);
        for (const i2 of (data.items||[]))
          runNoSave('INSERT INTO quote_items (id,quoteId,productId,qty,price) VALUES (?,?,?,?,?)',
              [genId('qi'), data.id, i2.productId, i2.qty, i2.price]);
      }
      break;
    case 'return':
      if (!queryOne('SELECT id FROM returns WHERE id=?', [data.id])) {
        // Restaurer le record
        runNoSave('INSERT INTO returns (id,client,productId,qty,price,saleId,debtReduced,cashRefunded,reason,date) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [data.id, data.client, data.productId, data.qty, data.price||0, data.saleId||'', data.debtReduced||0, data.cashRefunded||0, data.reason||'', data.date]);
        
        // 1. Restaurer le stock (inc)
        runNoSave('UPDATE products SET stock=stock+? WHERE id=?', [data.qty, data.productId]);
        
        // 2. Restaurer l'impact sur la vente si saleId
        if (data.saleId) {
          const totalToSubtract = data.qty * (data.price || 0);
          runNoSave('UPDATE sale_items SET qty = MAX(0, qty - ?) WHERE saleId=? AND productId=?', [data.qty, data.saleId, data.productId]);
          runNoSave('UPDATE sales SET total = MAX(0, total - ?) WHERE id=?', [totalToSubtract, data.saleId]);
          if (data.debtReduced > 0) {
            runNoSave('UPDATE sales SET debt = MAX(0, debt - ?) WHERE id=?', [data.debtReduced, data.saleId]);
          }
        }
        
        // 3. Restaurer l'impact sur la caisse si cashRefunded
        if (data.cashRefunded > 0) {
          const bal = getCaisseBalance();
          runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
              [genId('cai'), 'retour', `Restauration Retour — ${data.client}`, -data.cashRefunded, bal - data.cashRefunded, data.id, new Date().toISOString()]);
        }
      }
      break;
    case 'caisse_transaction':
      if (!queryOne('SELECT id FROM caisse_transactions WHERE id=?', [data.id])) {
        runNoSave('INSERT INTO caisse_transactions (id,type,label,amount,balanceAfter,refId,date) VALUES (?,?,?,?,?,?,?)',
            [data.id, data.type, data.label, data.amount, data.balanceAfter, data.refId||'', data.date]);
      }
      break;
    case 'app_logo':
      restoredData = data.logo;
      break;
  }
  runNoSave('DELETE FROM trash WHERE id=?', [trashId]);
  persist();
  audit('RESTORE', item.entity, item.entityId, item.label, username);
  return { ok: true, entity: item.entity, data: restoredData };
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
/** Retourne tous les paramètres sous forme d'objet {skey: sval} */
function getSettings() {
  const rows = query('SELECT skey, sval FROM settings');
  const obj = {};
  for (const r of rows) obj[r.skey] = r.sval;
  return obj;
}
/** Définit un paramètre (INSERT OR REPLACE) et persiste */
function setSetting(key, value, authUsername='système') {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (skey, sval) VALUES (?, ?)');
  stmt.run([key, value === null || value === undefined ? '' : String(value)]);
  stmt.free();
  audit('UPDATE', 'setting', key, String(value).substring(0, 50), authUsername);
  persist();
}

// ══════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════
function getAuditLog(limit=500) {
  return query('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT ?', [limit]);
}

// ══════════════════════════════════════════════════════════════
// INFO & MIGRATION
// ══════════════════════════════════════════════════════════════
function getDbInfo() {
  const tables = ['categories','products','sales','sale_items','quotes','quote_items',
                  'returns','expenses','caisse_transactions','trash','audit_log'];
  const counts = {};
  for (const t of tables) {
    const r = queryOne(`SELECT COUNT(*) as c FROM ${t}`);
    counts[t] = r ? Number(r.c) : 0;
  }
  console.log('[DB] getDbInfo counts:', JSON.stringify(counts));
  return {
    path: DB_PATH,
    counts,
    size: (() => { try { return fs.statSync(DB_PATH).size; } catch { return 0; } })()
  };
}

function migrateFromLocalStorage(data) {
  for (const c of (data.categories||[]))
    if (!queryOne('SELECT id FROM categories WHERE id=?', [c.id]))
      run('INSERT INTO categories (id,name,description,createdAt) VALUES (?,?,?,?)',
          [c.id, c.name, c.description||'', c.createdAt||new Date().toISOString()]);
  for (const p of (data.products||[]))
    if (!queryOne('SELECT id FROM products WHERE id=?', [p.id]))
      run('INSERT INTO products (id,name,description,categoryId,price,purchasePrice,stock,image,barcode,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [p.id, p.name, p.description||'', p.categoryId||null, p.price||0, p.purchasePrice||0, p.stock||0, p.image||'', p.barcode||'', p.createdAt||new Date().toISOString()]);
  for (const s of (data.sales||[])) {
    if (!queryOne('SELECT id FROM sales WHERE id=?', [s.id])) {
      run('INSERT INTO sales (id,client,total,date) VALUES (?,?,?,?)',
          [s.id, s.client, s.total||0, s.date||new Date().toISOString()]);
      for (const item of (s.items||[]))
        run('INSERT INTO sale_items (id,saleId,productId,qty,price) VALUES (?,?,?,?,?)',
            [genId('si'), s.id, item.productId, item.qty, item.price]);
    }
  }
  for (const q of (data.quotes||[])) {
    if (!queryOne('SELECT id FROM quotes WHERE id=?', [q.id])) {
      run('INSERT INTO quotes (id,client,total,date) VALUES (?,?,?,?)',
          [q.id, q.client, q.total||0, q.date||new Date().toISOString()]);
      for (const item of (q.items||[]))
        run('INSERT INTO quote_items (id,quoteId,productId,qty,price) VALUES (?,?,?,?,?)',
            [genId('qi'), q.id, item.productId, item.qty, item.price]);
    }
  }
  for (const r of (data.returns||[]))
    if (!queryOne('SELECT id FROM returns WHERE id=?', [r.id]))
      run('INSERT INTO returns (id,client,productId,qty,reason,date) VALUES (?,?,?,?,?,?)',
          [r.id, r.client, r.productId, r.qty, r.reason||'', r.date||new Date().toISOString()]);
  for (const e of (data.expenses||[]))
    if (!queryOne('SELECT id FROM expenses WHERE id=?', [e.id]))
      run('INSERT INTO expenses (id,description,amount,category,date) VALUES (?,?,?,?,?)',
          [e.id, e.description, e.amount, e.category||'', e.date||new Date().toISOString()]);
  return getDbInfo();
}

function auditAction(action, module, details) {
  // Rétrocompatibilité et export pour l'API
  audit(action, module, '', details);
}

// ══════════════════════════════════════════════════════════════
// PATIENTS
// ══════════════════════════════════════════════════════════════
function getPatients() {
  return query('SELECT * FROM patients ORDER BY name');
}
function upsertPatient({id, name, birthDate, gender, phone, email, allergies, history, weight, height, image}, username='système') {
  if (id) {
    run('UPDATE patients SET name=?,birthDate=?,gender=?,phone=?,email=?,allergies=?,history=?,weight=?,height=?,image=? WHERE id=?',
        [name, birthDate||'', gender||'', phone||'', email||'', allergies||'', history||'', weight||0, height||0, image||'', id]);
    audit('UPDATE', 'patient', id, name, username);
    return id;
  }
  const newId = genId('pat');
  run('INSERT INTO patients (id,name,birthDate,gender,phone,email,allergies,history,weight,height,image,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [newId, name, birthDate||'', gender||'', phone||'', email||'', allergies||'', history||'', weight||0, height||0, image||'', new Date().toISOString()]);
  audit('CREATE', 'patient', newId, name, username);
  return newId;
}
function deletePatient(id, username='système') {
  const p = queryOne('SELECT * FROM patients WHERE id=?', [id]);
  if (!p) return;
  run('DELETE FROM patients WHERE id=?', [id]);
  audit('DELETE', 'patient', id, p.name, username);
}

// ══════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════
function getUsers() { 
  // hasPassword est vrai si le mdp n'est pas nul et pas vide
  return query('SELECT id, username, role, permissions, image, createdAt, (password IS NOT NULL AND password != "") as hasPassword FROM users ORDER BY username'); 
}
function authUser(username, password) {
  return queryOne('SELECT id, username, role, permissions FROM users WHERE username=? AND password=?', [username, password]);
}
function upsertUser({id, username, password, role, permissions, image}, authUsername='système') {
  if (id) {
    if (password !== undefined && password !== null) {
      // Si password est fourni (même vide ""), on le met à jour
      run('UPDATE users SET username=?, password=?, role=?, permissions=?, image=? WHERE id=?', [username, password, role||'employe', permissions||'{}', image||'', id]);
    } else {
      run('UPDATE users SET username=?, role=?, permissions=?, image=? WHERE id=?', [username, role||'employe', permissions||'{}', image||'', id]);
    }
    audit('UPDATE', 'user', id, username, authUsername);
    syncPasswordsToFile(); // Synchroniser après modif
    return id;
  }
  const newId = genId('usr');
  run('INSERT INTO users (id,username,password,role,permissions,image,createdAt) VALUES (?,?,?,?,?,?,?)',
      [newId, username, password, role||'employe', permissions||'{}', image||'', new Date().toISOString()]);
  audit('CREATE', 'user', newId, username, authUsername);
  syncPasswordsToFile(); // Synchroniser après modif
  return newId;
}
function deleteUser(id, authUsername='système') {
  const u = queryOne('SELECT * FROM users WHERE id=?', [id]);
  if (!u) return;
  if (u.role === 'admin') throw new Error("Impossible de supprimer l'administrateur principal.");
  run('DELETE FROM users WHERE id=?', [id]);
  audit('DELETE', 'user', id, u.username, authUsername);
}

module.exports = {
  initDB, getDB,
  getCaisseBalance, getCaisseTransactions, addCaisseTransaction, deleteCaisseTransaction,
  getCategories, upsertCategory, deleteCategory,
  getProducts, upsertProduct, deleteProduct, updateStock, setStock,
  getSales, insertSale, updateSale, deleteSale,
  getQuotes, upsertQuote, deleteQuote, convertQuoteToSale,
  getReturns, insertReturnItems, deleteReturn,
  getExpenses, upsertExpense,  deleteExpense,

  getPatients, upsertPatient, deletePatient,

  getUsers,
  authUser,
  upsertUser,
  deleteUser,

  getTrash, restoreFromTrash, emptyTrash, deleteFromTrash, moveToTrash,
  getAuditLog,
  getSettings, setSetting,
  getDbInfo, migrateFromLocalStorage,
  persistSync,
};