/* ============================================================
   Pharmacie — Application de Gestion Commerciale v2
   ============================================================ */

// ─── STORE ────────────────────────────────────────────────────
let store = {
  products:[], categories:[], sales:[], quotes:[],
  returns:[], expenses:[], caisseTransactions:[], trash:[], auditLog:[],
  patients:[], settings: {}
};
let caisseBalance = 0;
let currentUser = null;
let usersList = []; // Liste des comptes employés

const IS_ELECTRON = !!window.electronAPI;

// ─── STORAGE FALLBACK ─────────────────────────────────────────
function saveStore() {
  if(IS_ELECTRON) return;
  Object.keys(store).forEach(k => localStorage.setItem('gp_'+k, JSON.stringify(store[k])));
}
function loadStore() {
  if(IS_ELECTRON) return;
  Object.keys(store).forEach(k => {
    const d = localStorage.getItem('gp_'+k);
    if(d) store[k] = JSON.parse(d);
  });
}

// ─── LOAD FROM SQLITE ─────────────────────────────────────────────────────
let appInitialized = false; // Flag pour n'exécuter le contrôle login qu'au démarrage

async function loadFromDB() {
  if(!IS_ELECTRON) return;
  const [cats,prods,sales,quotes,rets,exps,cTxns,trash,audit,settingsRes, usersRes, patientsRes] = await Promise.all([
    window.electronAPI.getCategories(),
    window.electronAPI.getProducts(),
    window.electronAPI.getSales(),
    window.electronAPI.getQuotes(),
    window.electronAPI.getReturns(),
    window.electronAPI.getExpenses(),
    window.electronAPI.getCaisseTransactions(),
    window.electronAPI.getTrash(),
    window.electronAPI.getAuditLog(),
    window.electronAPI.getSettings(),
    window.electronAPI.getUsers ? window.electronAPI.getUsers() : {data: []},
    window.electronAPI.getPatients ? window.electronAPI.getPatients() : {data: []}
  ]);
  store.categories         = cats.data    || [];
  store.products           = prods.data   || [];
  store.sales              = sales.data   || [];
  store.quotes             = quotes.data  || [];
  store.returns            = rets.data    || [];
  store.expenses           = exps.data    || [];
  store.caisseTransactions = cTxns.data   || [];
  store.trash              = trash.data   || [];
  store.auditLog           = audit.data   || [];
  store.settings           = settingsRes.data || {};
  usersList                = usersRes?.data || [];
  store.patients           = patientsRes?.data || [];

  // Normalisation des réglages booléens (SQLite stocke en string)
  if (store.settings.ticket_mode !== undefined) {
    store.settings.ticket_mode = String(store.settings.ticket_mode) === 'true';
  }
  
  // Mise à jour de l'UI du format d'impression au démarrage
  updateTicketModeUI();

  // Migration unique depuis localStorage si la base settings est vide
  if (Object.keys(store.settings).length === 0) {
    const keys = ['APP_NAME','APP_PHONE','APP_ADDRESS','APP_LOGO','APP_DESC'];
    for (const k of keys) {
      const v = localStorage.getItem('PHARMACIE_' + k);
      if (v) {
        await window.electronAPI.setSetting('PHARMACIE_' + k, v);
        store.settings['PHARMACIE_' + k] = v;
      }
    }
  }

  // Calcul solde caisse
  if(IS_ELECTRON) {
    const b = await window.electronAPI.getCaisseBalance();
    caisseBalance = b.data || 0;
  } else {
    caisseBalance = store.caisseTransactions.reduce((s,t) => s + Number(t.amount), 0);
  }
  updateCaisseBadge();

  // Vérification activation & login — UNE SEULE FOIS au démarrage
  if (IS_ELECTRON && !appInitialized) {
    appInitialized = true;
    const activated = store.settings['PHARMACIE_ACTIVATED'] === 'true';
    if (!activated) {
      document.getElementById('activationOverlay').style.display = 'flex';
      document.getElementById('activationCodeInput').focus();
    } else {
      // Afficher toujours le login multi-comptes
      renderLoginUsers();
      
      // Auto-login si un seul utilisateur sans mot de passe
      if (usersList.length === 1 && !usersList[0].hasPassword) {
         appInitialized = true;
         // On simule une connexion immédiate
         currentUser = usersList[0];
         if (typeof currentUser.permissions === 'string') {
           try { currentUser.permissions = JSON.parse(currentUser.permissions); } catch(e) { currentUser.permissions = {}; }
         }
         applyPermissions();
         toast(`Connexion automatique : ${currentUser.username}`);
         renderDashboard();
      } else {
         document.getElementById('loginOverlay').style.display = 'flex';
         if (usersList.length === 1) {
            onLoginUserSelect(usersList[0].username, true);
            const r = document.querySelector('input[name="loginUser"]');
            if (r) r.checked = true;
         }
      }
    }
    // Charger le statut WhatsApp au démarrage pour le fallback
    refreshWhatsAppStatus();
  }
}

/** Affiche la liste des utilisateurs sous forme de sélection (Radio) pour le login */
function renderLoginUsers() {
  const container = document.getElementById('loginUserRadioList');
  if (!container) return;
  if (!usersList.length) {
    container.innerHTML = '<div style="padding:20px; color:var(--danger);">Erreur : Aucun compte trouvé.</div>';
    return;
  }
  container.innerHTML = usersList.map((u, i) => `
    <label class="login-user-card ${u.role==='admin'?'admin':''}" onclick="onLoginUserSelect('${u.username}', ${!!u.hasPassword})">
      <input type="radio" name="loginUser" value="${u.username}" data-haspassword="${u.hasPassword ? '1' : '0'}">
      <div class="user-info">
        <div class="user-icon" style="background-image: url('${u.image || ''}'); background-size: cover; background-position: center;">
          ${u.image ? '' : `<i class="fas fa-${u.role==='admin'?'user-shield':'user'}"></i>`}
        </div>
        <div class="user-text">
          <div class="user-name">${u.username}</div>
          <div class="user-role">${u.role==='admin'?'Administrateur':'Employé'}</div>
        </div>
      </div>
      <div class="check-mark"><i class="fas fa-check-circle"></i></div>
    </label>
  `).join('');
}

function updateCaisseBadge() {
  const el = document.getElementById('caisseSolde');
  if(el) {
    el.dataset.value = caisseBalance;
    if (el.dataset.hidden === '1') el.textContent = '••••••';
    else el.textContent = fmt(caisseBalance);
  }
  const el2 = document.getElementById('caisseCurrentBalance');
  if(el2) {
    el2.dataset.value = caisseBalance;
    if(el2.dataset.hidden === '1') el2.textContent = '••••••';
    else el2.textContent = fmt(caisseBalance);
  }
  const el3 = document.getElementById('settingsCaisseBalance');
  if(el3) el3.textContent = fmt(caisseBalance);
  const el4 = document.getElementById('stat-caisse');
  if(el4) el4.textContent = fmt(caisseBalance);
}

function genId(prefix='id') { return prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,7); }

// ─── NAVIGATION ───────────────────────────────────────────────
const sectionTitles = {
  dashboard:'Tableau de bord', caisse:'Caisse', products:'Produits',
  categories:'Catégories', stock:'Gestion du stock', sales:'Ventes',
  quotes:'Devis', returns:'Retours clients', expenses:'Dépenses',
  patients:'Dossiers Patients',
  reports:'Rapports', whatsapp:'WhatsApp', audit: 'Journal d\'Audit',
  corbeille: 'Corbeille', settings:'Paramètres'
};

let currentSection = 'dashboard';
let isWhatsAppConnected = false;

function navigate(section) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('section-'+section)?.classList.add('active');
  document.querySelector(`.nav-item[data-section="${section}"]`)?.classList.add('active');
  document.getElementById('pageTitle').textContent = sectionTitles[section];
  currentSection = section;
  const actions = { products:'+ Produit',categories:'+ Catégorie',sales:'+ Vente',quotes:'+ Devis',returns:'+ Retour',expenses:'+ Dépense',patients:'+ Patient' };
  const topBtn = document.getElementById('topActionBtn');
  topBtn.textContent = actions[section]||'';
  topBtn.style.display = actions[section]?'':'none';
  document.getElementById('sidebar').classList.remove('mobile-open');
  const renders = {
    dashboard:renderDashboard, caisse:renderCaisse, products:renderProducts,
    categories:renderCategories, stock:renderStock, sales:renderSales,
    quotes:renderQuotes, returns:renderReturns, expenses:renderExpenses,
    patients:renderPatients,
    audit:renderAuditLog, corbeille:renderCorbeilleSection, settings:renderSettings
  };
  renders[section]?.();

  // Gestion WhatsApp BrowserView
  const waControls = document.getElementById('waTopbarControls');
  if (waControls) waControls.style.display = section === 'whatsapp' ? 'flex' : 'none';

  if (IS_ELECTRON && window.electronAPI.whatsappShow) {
    if (section === 'whatsapp') {
      window.electronAPI.whatsappShow(true);
      setTimeout(updateWhatsAppView, 50);
      refreshWhatsAppStatus();
    } else {
      window.electronAPI.whatsappShow(false);
    }
  }
}

function handleTopAction() {
  const actions = {
    products:()=>openProductModal(), categories:()=>openCategoryModal(),
    sales:()=>openSaleModal(), quotes:()=>openQuoteModal(),
    returns:()=>openReturnModal(), expenses:()=>openExpenseModal(),
    patients:()=>openPatientModal()
  };
  actions[currentSection]?.();
}

// Redimensionnement automatique de WhatsApp si l'onglet est actif
window.addEventListener('resize', () => {
  if (currentSection === 'whatsapp') updateWhatsAppView();
});

// ─── MODALS ───────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function confirmDelete(msg, cb) {
  document.getElementById('confirmMessage').innerHTML = msg;
  document.getElementById('confirmBtn').onclick = ()=>{ cb(); closeModal('confirmModal'); };
  openModal('confirmModal');
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(message, type='success') {
  const icons = {success:'<i class="fas fa-check-circle"></i>',error:'<i class="fas fa-times-circle"></i>',warning:'<i class="fas fa-exclamation-triangle"></i>',info:'<i class="fas fa-info-circle"></i>'};
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]||'●'}</span><span>${message}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateX(60px)'; setTimeout(()=>el.remove(),300); }, 3000);
}

// ─── HELPERS ──────────────────────────────────────────────────
function fmt(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n))+' FCFA'; }
function fmtDate(d) {
  if(!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function fmtDateTime(d) {
  if(!d) return '—';
  return new Date(d).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}

// ─── CAISSE ─────────────────────────────────────────────
function renderCaisse() {
  const tbody = document.getElementById('caisseBody');
  if(!tbody) return;
  updateCaisseBadge();
  const filter = document.getElementById('caisseTypeFilter')?.value||'';
  let txns = [...store.caisseTransactions];
  if(filter) txns = txns.filter(t=>t.type===filter);
  txns.sort((a,b)=>new Date(b.date)-new Date(a.date));

  if(!txns.length) {
    tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-coins"></i></div><p>Aucune transaction enregistrée.</p></div></td></tr>`;
    return;
  }
  const deletable = ['depot'];
  const canDelete = currentUser?.role === 'admin' || currentUser?.permissions?.canDeleteHistory;
  tbody.innerHTML = txns.map(t=>{
    const pos = Number(t.amount)>=0;
    const isSystem = t.refId && t.refId !== '';
    const delBtn = (deletable.includes(t.type) && !isSystem && canDelete)
      ? `<button class="btn-icon danger" onclick="deleteCaisseTransactionFn('${t.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>`
      : '';
    return `<tr>
      <td class="text-muted">${fmtDateTime(t.date)}</td>
      <td><span class="caisse-type-badge caisse-type-${t.type}">${t.type}</span></td>
      <td>${t.label}</td>
      <td class="${pos?'caisse-amount-positive':'caisse-amount-negative'}">${pos?'+':''}${fmt(Number(t.amount))}</td>
      <td class="font-mono">${fmt(Number(t.balanceAfter))}</td>
      <td><div class="actions-cell">${delBtn}</div></td>
    </tr>`;
  }).join('');
  updateCaisseTotals();
}

// ─── TOTAUX CAISSE (JOUR & GLOBAL) ────────────────────────────
function updateCaisseTotals() {
  const today = new Date().toISOString().split('T')[0];
  const totalVentesDay = store.sales
    .filter(s => s.date.startsWith(today))
    .reduce((sum, s) => sum + s.total, 0);
  const totalDepensesDay = store.expenses
    .filter(e => e.date.startsWith(today))
    .reduce((sum, e) => sum + e.amount, 0);
    
  const totalVentesGlobal = store.sales.reduce((sum, s) => sum + s.total, 0);
  const totalDepensesGlobal = store.expenses.reduce((sum, e) => sum + e.amount, 0);

  const elV = document.getElementById('caisseTotalVentes');
  const elD = document.getElementById('caisseTotalDepenses');
  const elVG = document.getElementById('caisseTotalVentesGlobal');
  const elDG = document.getElementById('caisseTotalDepensesGlobal');

  if (elV) {
    elV.dataset.value = totalVentesDay;
    if (elV.dataset.hidden === '1') elV.textContent = '••••••';
    else elV.textContent = fmt(totalVentesDay);
  }
  if (elD) {
    elD.dataset.value = totalDepensesDay;
    if (elD.dataset.hidden === '1') elD.textContent = '••••••';
    else elD.textContent = fmt(totalDepensesDay);
  }
  if (elVG) {
    elVG.dataset.value = totalVentesGlobal;
    if (elV && elV.dataset.hidden === '1') elVG.textContent = '••••••'; // Sync with day-eye
    else elVG.textContent = fmt(totalVentesGlobal);
  }
  if (elDG) {
    elDG.dataset.value = totalDepensesGlobal;
    if (elD && elD.dataset.hidden === '1') elDG.textContent = '••••••'; // Sync with day-eye
    else elDG.textContent = fmt(totalDepensesGlobal);
  }
}

function toggleCaisseTotal(elId, eyeId) {
  const el = document.getElementById(elId);
  const eye = document.getElementById(eyeId);
  if (!el) return;
  
  const isCurrentlyHidden = el.dataset.hidden === '1';
  const newHiddenState = isCurrentlyHidden ? '' : '1';
  
  // Basculer l'élément cible
  el.dataset.hidden = newHiddenState;
  if (newHiddenState === '1') {
    el.textContent = '••••••';
    if (eye) { eye.classList.remove('fa-eye'); eye.classList.add('fa-eye-slash'); }
  } else {
    el.textContent = fmt(Number(el.dataset.value || 0));
    if (eye) { eye.classList.remove('fa-eye-slash'); eye.classList.add('fa-eye'); }
  }

  // Synchronisation spéciale pour le solde principal
  if (elId === 'caisseCurrentBalance') {
    const topEl = document.getElementById('caisseSolde');
    if (topEl) {
      topEl.dataset.hidden = newHiddenState;
      topEl.textContent = (newHiddenState === '1') ? '••••••' : fmt(caisseBalance);
    }
  }
  
  // Synchronisation pour les totaux Ventes / Dépenses (Day & Global)
  if (elId === 'caisseTotalVentes') {
    const globalEl = document.getElementById('caisseTotalVentesGlobal');
    if (globalEl) {
      globalEl.dataset.hidden = newHiddenState;
      globalEl.textContent = (newHiddenState === '1') ? '••••••' : fmt(Number(globalEl.dataset.value || 0));
    }
  }
  if (elId === 'caisseTotalDepenses') {
    const globalEl = document.getElementById('caisseTotalDepensesGlobal');
    if (globalEl) {
      globalEl.dataset.hidden = newHiddenState;
      globalEl.textContent = (newHiddenState === '1') ? '••••••' : fmt(Number(globalEl.dataset.value || 0));
    }
  }
}

function printZReport() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const salesToday = store.sales.filter(s => s.date.startsWith(today));
  const transToday = store.caisseTransactions.filter(t => t.date.startsWith(today));
  const expensesToday = store.expenses.filter(e => e.date.startsWith(today));

  const byMode = {
    'Espèces': 0,
    'Orange Money': 0,
    'Wave': 0,
    'Chèque': 0,
    'Crédit': 0
  };

  salesToday.forEach(s => {
    const mode = s.paymentMode || 'Espèces';
    if (byMode[mode] !== undefined) byMode[mode] += s.total;
    else byMode['Autre'] = (byMode['Autre'] || 0) + s.total;
  });

  const cashSales = salesToday.filter(s => (s.paymentMode||'Espèces') === 'Espèces').reduce((sum, s) => sum + s.amountPaid, 0);
  const deposits = transToday.filter(t => t.type === 'depot').reduce((sum, t) => sum + t.amount, 0);
  const withdrawals = transToday.filter(t => t.type === 'ajustement' && t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const expensesCash = expensesToday.reduce((sum, e) => sum + e.amount, 0); // Assuming all expenses are cash for simplicity unless tracked otherwise

  const expectedCash = (cashSales + deposits) - (withdrawals + expensesCash);

  const phone = getAppPhone();
  const address = getAppAddress();
  const contactHtml = (phone || address) ? `<div style="font-size:12px;color:#666;margin-bottom:15px">${address ? address+' | ' : ''}${phone}</div>` : '';

  const logo = getAppLogo();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:60px; max-width:180px; object-fit:contain; margin-bottom:8px;">` : '';

  let html = `
    <div style="padding:30px; font-family:sans-serif; color:#333; max-width:500px; margin:auto; border:1px solid #eee">
      <h2 style="text-align:center; color:var(--primary); margin-bottom:5px">Rapport journalier</h2>
      <div style="text-align:center; margin-bottom:20px">
        ${logoHtml}
        <div style="font-weight:700; font-size:18px">${getAppName()}</div>
        ${contactHtml}
        <div style="font-size:14px">Date : ${fmtDate(now.toISOString())} à ${now.toLocaleTimeString('fr-FR')}</div>
      </div>

      <h3 style="border-bottom:2px solid #eee; padding-bottom:5px">Chiffre d'affaires par mode</h3>
      <table style="width:100%; border-collapse:collapse; margin-bottom:20px">
        ${Object.entries(byMode).map(([mode, total]) => `
          <tr>
            <td style="padding:8px 0; border-bottom:1px solid #f9f9f9">${mode}</td>
            <td style="padding:8px 0; border-bottom:1px solid #f9f9f9; text-align:right; font-weight:700">${fmt(total)}</td>
          </tr>
        `).join('')}
        <tr style="font-size:1.1em; color:var(--primary)">
          <td style="padding:12px 0; border-top:2px solid #eee"><strong>Total Ventes</strong></td>
          <td style="padding:12px 0; border-top:2px solid #eee; text-align:right"><strong>${fmt(salesToday.reduce((sum, s) => sum + s.total, 0))}</strong></td>
        </tr>
      </table>

      <h3 style="border-bottom:2px solid #eee; padding-bottom:5px">Contrôle de l'Espèce (Cash)</h3>
      <table style="width:100%; border-collapse:collapse; margin-bottom:20px">
        <tr><td style="padding:5px 0">Ventes en espèces (reçu)</td><td style="text-align:right">+ ${fmt(cashSales)}</td></tr>
        <tr><td style="padding:5px 0">Dépôts directs</td><td style="text-align:right">+ ${fmt(deposits)}</td></tr>
        <tr><td style="padding:5px 0">Retraits / Ajustements</td><td style="text-align:right">- ${fmt(withdrawals)}</td></tr>
        <tr><td style="padding:5px 0">Dépenses payées</td><td style="text-align:right">- ${fmt(expensesCash)}</td></tr>
        <tr style="font-size:1.2em; border-top:2px solid #333">
          <td style="padding:10px 0"><strong>ESPÈCES ATTENDUES</strong></td>
          <td style="text-align:right"><strong>${fmt(expectedCash)}</strong></td>
        </tr>
      </table>

      <div style="margin-top:40px; border-top:1px dashed #ccc; padding-top:20px; text-align:center; font-size:12px; color:#888">
        Imprimé le ${now.toLocaleString('fr-FR')}
      </div>
    </div>
  `;

  document.getElementById('printArea').innerHTML = html;
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

async function deleteCaisseTransactionFn(id) {
  confirmDelete('Supprimer ce dépôt / ajustement ? Le solde sera recalculé.', async()=>{
    if(IS_ELECTRON){
      const res = await window.electronAPI.deleteCaisseTransaction(id, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error,'error');
      await loadFromDB();
    } else {
      const t = store.caisseTransactions.find(x=>x.id===id);
      if(t) {
        store.caisseTransactions = store.caisseTransactions.filter(x=>x.id!==id);
        caisseBalance -= Number(t.amount);
        saveStore();
      }
    }
    updateCaisseBadge();
    renderCaisse();
    toast('Transaction supprimée','warning');
  });
}

function printCaisse() {
  const filter = document.getElementById('caisseTypeFilter')?.value||'';
  let txns = [...store.caisseTransactions];
  if(filter) txns = txns.filter(t=>t.type===filter);
  txns.sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!txns.length) return toast('Aucune transaction à imprimer','warning');
  const rows = txns.map(t=>{
    const pos = Number(t.amount)>=0;
    return `<tr><td>${fmtDateTime(t.date)}</td><td>${t.type}</td><td>${t.label}</td>
      <td style="text-align:right;color:${pos?'#2d5a27':'#c0392b'}">${pos?'+':''}${fmt(Number(t.amount))}</td>
      <td style="text-align:right">${fmt(Number(t.balanceAfter))}</td></tr>`;
  }).join('');
  
  const phone = getAppPhone();
  const address = getAppAddress();
  const contactHtml = (phone || address) ? `<div style="font-size:12px;color:#666;line-height:1.4;margin-top:4px">${address ? address+'<br>' : ''}${phone}</div>` : '';
  const logo = getAppLogo();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:60px; max-width:180px; object-fit:contain; margin-bottom:8px;">` : '';

  document.getElementById('printArea').innerHTML=`
    <div class="invoice-header"><div><div class="invoice-title">Journal de Caisse</div>
    <div style="font-size:13px;color:#666">${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</div></div>
    <div style="text-align:right">${logoHtml}<div style="font-size:22px;font-weight:700;color:#2d5a27">${getAppName()}</div>${contactHtml}</div></div>
    <table class="invoice-table">
      <thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th style="text-align:right">Montant</th><th style="text-align:right">Solde après</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="invoice-total">Solde actuel : ${fmt(caisseBalance)}</div>`;
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

function openCaisseDepotModal() {
  document.getElementById('caisseDepotAmount').value='';
  document.getElementById('caisseDepotLabel').value='';
  document.getElementById('caisseDepotType').value='depot';
  openModal('caisseDepotModal');
}

async function saveCaisseDepot() {
  const type  = document.getElementById('caisseDepotType').value;
  const amount= parseFloat(document.getElementById('caisseDepotAmount').value)||0;
  const label = document.getElementById('caisseDepotLabel').value.trim();
  if(amount<=0) return toast('Montant invalide','error');
  if(!label) return toast('Libellé requis','error');

  if(type==='depense' && amount>caisseBalance){
    return toast(`Le montant (${fmt(amount)}) dépasse le solde en caisse (${fmt(caisseBalance)}).`,'error');
  }

  if(IS_ELECTRON){
    if (type === 'depot') {
      const res = await window.electronAPI.insertSale({client: label, items: [], total: amount, amountPaid: amount, debt: 0, paymentMode: 'Espèces'}, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error,'error');
    } else {
      const res = await window.electronAPI.upsertExpense({description: label, amount: amount, category: 'Dépense directe', date: new Date().toISOString()}, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error,'error');
    }
    await loadFromDB();
  } else {
    if (type === 'depot') {
      caisseBalance += amount;
      const saleId = genId('sale');
      store.sales.unshift({id:saleId, client:label, clientPhone:'', total:amount, amountPaid:amount, debt:0, paymentMode:'Espèces', items:[], date:new Date().toISOString()});
      store.caisseTransactions.unshift({id:genId('cai'), type:'vente', label:`Vente (Espèces) — ${label}`, amount:amount, balanceAfter:caisseBalance, refId:saleId, date:new Date().toISOString()});
    } else {
      caisseBalance -= amount;
      const expId = genId('exp');
      store.expenses.unshift({id:expId, description:label, amount:amount, category:'Dépense directe', date:new Date().toISOString()});
      store.caisseTransactions.unshift({id:genId('cai'), type:'depense', label:`Dépense — ${label}`, amount:-amount, balanceAfter:caisseBalance, refId:expId, date:new Date().toISOString()});
    }
    saveStore();
  }
  closeModal('caisseDepotModal');
  toast(type === 'depot' ? `Dépôt enregistré comme vente (+${fmt(amount)})` : `Ajustement enregistré comme dépense (-${fmt(amount)})`);
  updateCaisseBadge();
  if (currentSection === 'caisse') renderCaisse();
  if (currentSection === 'sales' && type === 'depot') renderSales();
  if (currentSection === 'expenses' && type === 'ajustement') renderExpenses();
}

async function saveCaisseFromSettings() {
  const amount = parseFloat(document.getElementById('caisseSettingAmount').value)||0;
  const label  = document.getElementById('caisseSettingLabel').value.trim()||'Fonds de départ';
  const type   = document.getElementById('caisseSettingType').value;
  if(amount<=0) return toast('Montant invalide','error');
  
  if(type==='depense' && amount>caisseBalance){
    return toast(`Le montant (${fmt(amount)}) dépasse le solde en caisse (${fmt(caisseBalance)}).`,'error');
  }
  
  if(IS_ELECTRON){
    if (type === 'depot') {
      const res = await window.electronAPI.insertSale({client: label, items: [], total: amount, amountPaid: amount, debt: 0, paymentMode: 'Espèces'}, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error,'error');
    } else {
      const res = await window.electronAPI.upsertExpense({description: label, amount: amount, category: 'Dépense directe', date: new Date().toISOString()}, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error,'error');
    }
    await loadFromDB();
  } else {
    if (type === 'depot') {
      caisseBalance += amount;
      const saleId = genId('sale');
      store.sales.unshift({id:saleId, client:label, clientPhone:'', total:amount, amountPaid:amount, debt:0, paymentMode:'Espèces', items:[], date:new Date().toISOString()});
      store.caisseTransactions.unshift({id:genId('cai'), type:'vente', label:`Vente (Espèces) — ${label}`, amount:amount, balanceAfter:caisseBalance, refId:saleId, date:new Date().toISOString()});
    } else {
      caisseBalance -= amount;
      const expId = genId('exp');
      store.expenses.unshift({id:expId, description:label, amount:amount, category:'Dépense directe', date:new Date().toISOString()});
      store.caisseTransactions.unshift({id:genId('cai'), type:'depense', label:`Dépense — ${label}`, amount:-amount, balanceAfter:caisseBalance, refId:expId, date:new Date().toISOString()});
    }
    saveStore();
  }
  toast(`Caisse mise à jour : ${fmt(caisseBalance)}`);
  updateCaisseBadge();
  const settingsBalEl = document.getElementById('settingsCaisseBalance');
  if (settingsBalEl) settingsBalEl.textContent = fmt(caisseBalance);
}

// ─── APP IDENTITY CONFIGURATION ──────────────────────────────────────────────
function _settingGet(key, def='') {
  // En mode Electron, on lit depuis store.settings (chargé depuis SQLite)
  // En mode navigateur, on reste sur localStorage comme fallback
  if (IS_ELECTRON) return store.settings[key] || def;
  return localStorage.getItem(key) || def;
}
async function _settingSet(key, value) {
  if (IS_ELECTRON) {
    await window.electronAPI.setSetting(key, value, currentUser?.username);
    store.settings[key] = value;
  } else {
    localStorage.setItem(key, value);
  }
}

async function saveAppName() {
  const name    = document.getElementById('settingsAppName').value.trim();
  const phone   = document.getElementById('settingsAppPhone').value.trim();
  const address = document.getElementById('settingsAppAddress').value.trim();
  const desc    = document.getElementById('settingsAppDesc') ? document.getElementById('settingsAppDesc').value.trim() : '';

  if(!name) return toast("Nom de l'application requis", "error");

  await _settingSet('PHARMACIE_APP_NAME', name);
  await _settingSet('PHARMACIE_APP_PHONE', phone);
  await _settingSet('PHARMACIE_APP_ADDRESS', address);
  await _settingSet('PHARMACIE_APP_DESC', desc);

  applyAppName();
  toast('Identité enregistrée');
}

async function createBackupArchive() {
  if (!IS_ELECTRON) return;
  try {
    toast('Création de la sauvegarde en cours...', 'info');
    const res = await window.electronAPI.dbBackup();
    if (res && res.ok) {
      toast(`Sauvegarde réussie : ${res.filename}`, 'success');
    } else {
      toast(`Erreur de sauvegarde : ${res?.error || 'Inconnue'}`, 'error');
    }
  } catch (e) {
    toast(`Erreur système : ${e.message}`, 'error');
  }
}
function applyAppName() {
  const name    = _settingGet('PHARMACIE_APP_NAME', 'Pharmacie');
  const phone   = _settingGet('PHARMACIE_APP_PHONE');
  const address = _settingGet('PHARMACIE_APP_ADDRESS');
  const desc    = _settingGet('PHARMACIE_APP_DESC');

  const nameEl = document.getElementById('settingsAppName');
  const phoneEl = document.getElementById('settingsAppPhone');
  const addrEl = document.getElementById('settingsAppAddress');
  const descEl = document.getElementById('settingsAppDesc');
  if (nameEl) nameEl.value = name;
  if (phoneEl) phoneEl.value = phone;
  if (addrEl) addrEl.value = address;
  if (descEl) descEl.value = desc;

  const oldGroup = document.getElementById('settingsOldPassGroup');
  const loginPass = store.settings['PHARMACIE_LOGIN_PASSWORD'];
  if (oldGroup) {
    oldGroup.style.display = (loginPass && loginPass.trim() !== '') ? 'block' : 'none';
  }

  document.title = `${name} — Gestion Commerciale`;
  const tbTitle = document.querySelector('.titlebar-title');
  if(tbTitle) tbTitle.textContent = name;
  const logoText = document.querySelector('.logo-text');
  if(logoText) logoText.textContent = name;
  document.querySelectorAll('.logo-text').forEach(el=>el.textContent = name);
  document.title = name;
  if (window.electronAPI && window.electronAPI.setAppName) {
    window.electronAPI.setAppName(name);
  }

  // Logo
  _applyLogoPreview(getAppLogo());
}
function getAppName()    { return _settingGet('PHARMACIE_APP_NAME', 'Pharmacie'); }
function getAppPhone()   { return _settingGet('PHARMACIE_APP_PHONE'); }
function getAppAddress() { return _settingGet('PHARMACIE_APP_ADDRESS'); }
function getAppDesc()    { return _settingGet('PHARMACIE_APP_DESC'); }
function getAppLogo()    { return _settingGet('PHARMACIE_APP_LOGO') || null; }

// ─── ACTIVATION POUR LE CODE─────────────────────────────────────────────────────────────
async function validateActivation() {
  const input = document.getElementById('activationCodeInput');
  const code = input.value.trim();
  if (code === 'laye2810') {
    await _settingSet('PHARMACIE_ACTIVATED', 'true');
    document.getElementById('activationOverlay').style.display = 'none';
    toast('Logiciel activé avec succès ✓', 'success');
  } else {
    toast('Code d\'activation incorrect', 'error');
    input.value = '';
    input.focus();
  }
}

// Écouter la touche Entrée sur les champs d'activation et de connexion
document.addEventListener('DOMContentLoaded', () => {
  const actInput = document.getElementById('activationCodeInput');
  if (actInput) {
    actInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') validateActivation();
    });
  }
  const logInput = document.getElementById('loginCodeInput');
  if (logInput) {
    logInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') validateLogin();
    });
  }
});

// ─── UTILITAIRES INTERFACE ────────────────────────────────────────────────
function onUserPhotoChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const b64 = e.target.result;
    document.getElementById('userPhotoPreview').innerHTML = `<img src="${b64}" style="width:100%; height:100%; object-fit:cover;">`;
    document.getElementById('userPhotoPreview').dataset.img = b64;
  };
  reader.readAsDataURL(file);
}

function toggleNoPassword(checked) {
  const ids = ['userPassword', 'userPasswordConfirm'];
  const icons = ['toggleNewPwd', 'toggleConfirmPwd'];
  ids.forEach((id, i) => {
    const el = document.getElementById(id);
    el.disabled = checked;
    if (checked) {
        el.value = '';
        el.style.opacity = '0.5';
        document.getElementById(icons[i]).style.pointerEvents = 'none';
        document.getElementById(icons[i]).style.opacity = '0.3';
    } else {
        el.style.opacity = '1';
        document.getElementById(icons[i]).style.pointerEvents = 'auto';
        document.getElementById(icons[i]).style.opacity = '1';
    }
  });
}

function togglePasswordVisibility(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon = document.getElementById(iconId);
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

// ─── CONNEXION & SÉCURITÉ ──────────────────────────────────────────────────
/** Gère la sélection d'un utilisateur au login : affiche le champ code si nécessaire */
function onLoginUserSelect(username, hasPassword) {
  const section = document.getElementById('loginPasswordSection');
  const input = document.getElementById('loginCodeInput');
  if (!section || !input) return;

  input.value = ''; // Reset du champ au changement d'utilisateur
  
  if (hasPassword) {
    section.style.display = 'block';
    setTimeout(() => input.focus(), 50);
  } else {
    section.style.display = 'none';
    validateLogin(); // Connexion directe si pas de mot de passe
  }
}

async function validateLogin() {
  const radio = document.querySelector('input[name="loginUser"]:checked');
  const user = radio ? radio.value : '';
  if(!user) return toast('Veuillez sélectionner un compte','error');
  
  const hasPass = radio.dataset.haspassword === '1';
  const pass = hasPass ? document.getElementById('loginCodeInput').value : "";
  
  if(hasPass && !pass) return toast('Veuillez saisir votre code','error');
  
  const res = await window.electronAPI.authUser(user, pass);
  if(res.ok){
    currentUser = res.data;
    if (typeof currentUser.permissions === 'string') {
      try { currentUser.permissions = JSON.parse(currentUser.permissions); } catch(e) { currentUser.permissions = {}; }
    }
    applyPermissions();
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('loginCodeInput').value = '';
    toast(`Bienvenue ${currentUser.username} !`);
    if(appInitialized) {
      renderDashboard();
      updateAuditUserSelect();
    }
  } else {
    toast('Code incorrect','error');
  }
}

function logout() {
  currentUser = null;
  renderLoginUsers(); // Rafraîchir la liste des radios
  document.getElementById('loginCodeInput').value = '';
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('loginCodeInput').focus();
  toast('Déconnexion réussie');
}

/** Helper centralisé pour les permissions */
function hasPerm(key) {
  if (!currentUser) return false;
  if (currentUser.role === 'admin') return true;
  return !!(currentUser.permissions && currentUser.permissions[key]);
}

function applyPermissions() {
  if (!currentUser) return;
  const p = currentUser.permissions || {};
  const isAdmin = currentUser.role === 'admin';

  // 1. Onglets de navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(nav => {
    const section = nav.dataset.section;
    if (section === 'settings') nav.style.display = isAdmin ? 'flex' : 'none';
    if (section === 'audit') nav.style.display = isAdmin ? 'flex' : 'none';
    if (section === 'dashboard') nav.style.display = (isAdmin || p.canSeeDashboard) ? 'flex' : 'none';
    if (section === 'categories') nav.style.display = (isAdmin || p.canManageCategories) ? 'flex' : 'none';
    if (section === 'reports') nav.style.display = (isAdmin || p.canSeeReports) ? 'flex' : 'none';
    if (section === 'quotes') nav.style.display = (isAdmin || p.canMakeQuotes) ? 'flex' : 'none';
    if (section === 'returns') nav.style.display = (isAdmin || p.canManageReturns) ? 'flex' : 'none';
    if (section === 'expenses') nav.style.display = (isAdmin || p.canManageExpenses) ? 'flex' : 'none';
    if (section === 'stock') nav.style.display = (isAdmin || p.canEditStock) ? 'flex' : 'none';
  });

  // 2. Boutons d'action rapides (Caisse)
  const btnDepot = document.querySelector('button[onclick="openCaisseDepotModal()"]');
  if (btnDepot) btnDepot.style.display = (isAdmin || p.canManageExpenses) ? 'block' : 'none';

  // 3. Bouton Profit / bénéfice sur Dashboard et Rapports
  const profitCards = document.querySelectorAll('.stat-card.profit, .stat-card:has(#stat-profit)');
  profitCards.forEach(c => c.style.display = (isAdmin || p.canSeeProfit) ? 'flex' : 'none');
  
  // 4. Les boutons "Supprimer" sont gérés dynamiquement dans les renders (Products, Sales...)
}

// --- GESTION DES UTILISATEURS (ADMIN) ---
async function renderUsers() {
  if (currentUser?.role !== 'admin') return;
  const res = await window.electronAPI.getUsers();
  usersList = res.data || [];
  const tbody = document.getElementById('usersBody');
  if (!tbody) return;

  tbody.innerHTML = usersList.map(u => `
    <tr>
      <td><strong>${u.username}</strong></td>
      <td><span class="badge ${u.role==='admin'?'success':'info'}">${u.role}</span></td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" onclick="openUserModal('${u.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
          ${u.role !== 'admin' ? `<button class="btn-icon danger" onclick="deleteUser('${u.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function openUserModal(id = null) {
  const u = id ? usersList.find(x => x.id === id) : null;
  document.getElementById('userId').value = id || '';
  document.getElementById('userUsername').value = u ? u.username : '';
  
  // Photo
  const preview = document.getElementById('userPhotoPreview');
  if (u && u.image) {
    preview.innerHTML = `<img src="${u.image}" style="width:100%; height:100%; object-fit:cover;">`;
    preview.dataset.img = u.image;
  } else {
    preview.innerHTML = `<i class="fas fa-user" style="font-size:60px; color:var(--text3);"></i>`;
    preview.dataset.img = '';
  }
  document.getElementById('userPhotoInput').value = '';

  // Réinitialisation des mdp et visibilité
  document.getElementById('userOldPassword').value = '';
  document.getElementById('userOldPassword').type = 'password';
  document.getElementById('toggleOldPwd').className = 'fas fa-eye password-toggle-icon';

  document.getElementById('userPassword').value = '';
  document.getElementById('userPassword').type = 'password';
  document.getElementById('toggleNewPwd').className = 'fas fa-eye password-toggle-icon';

  document.getElementById('userPasswordConfirm').value = '';
  document.getElementById('userPasswordConfirm').type = 'password';
  document.getElementById('toggleConfirmPwd').className = 'fas fa-eye password-toggle-icon';
  
  // Option "Sans mdp"
  const hasPwd = u ? (u.hasPassword == 1 || u.hasPassword === true) : false;
  document.getElementById('userId').dataset.hadpwd = hasPwd ? '1' : '0';
  document.getElementById('userNoPassword').checked = !hasPwd && id; 
  toggleNoPassword(!hasPwd && id);

  // Afficher "ancien mdp" seulement si on modifie
  document.getElementById('oldPwdSection').style.display = id ? 'block' : 'none';
  
  document.getElementById('userRole').value = u ? u.role : 'employe';
  document.getElementById('userModalTitle').textContent = id ? 'Modifier Utilisateur' : 'Créer un compte';
  document.getElementById('pwdHint').style.display = id ? 'block' : 'none';

  // Cocher les perms
  const perms = u ? (typeof u.permissions === 'string' ? JSON.parse(u.permissions) : u.permissions) : {};
  const list = ['canSell', 'canMakeQuotes', 'canManageReturns', 'canSettleDebt', 'canManageExpenses', 'canConfigureProducts', 'canEditStock', 'canSeeReports', 'canSeeProfit', 'canEditHistory', 'canDeleteHistory', 'canSeeDashboard', 'canManageCategories'];
  list.forEach(k => {
    const el = document.getElementById('perm_'+k);
    if(el) el.checked = perms[k] || false;
  });

  togglePermissionsPanels();
  openModal('userModal');
}

function togglePermissionsPanels() {
  const role = document.getElementById('userRole').value;
  document.getElementById('permissionsPanel').style.display = role === 'admin' ? 'none' : 'block';
}

async function saveUser() {
  const id = document.getElementById('userId').value;
  const username = document.getElementById('userUsername').value.trim();
  const role = document.getElementById('userRole').value;

  const newPass = document.getElementById('userPassword').value.trim();
  const confirmPass = document.getElementById('userPasswordConfirm').value.trim();
  const oldPass = document.getElementById('userOldPassword').value.trim();
  const noPass = document.getElementById('userNoPassword').checked;
  const hadPwd = document.getElementById('userId').dataset.hadpwd === '1';

  if (!username) return toast('Le nom d’utilisateur est requis', 'warning');

  // 1. Confirmation (seulement si on veut un mdp)
  if (!noPass && (confirmPass !== "" || newPass !== "")) {
    if (newPass !== confirmPass) return toast('Le nouveau mot de passe et la confirmation ne correspondent pas', 'error');
  }

  // 2. Ancien mdp requis si modification ET (changement de mdp OU désactivation d'un mdp existant)
  if (id && ((!noPass && (newPass !== "" || confirmPass !== "")) || (noPass && hadPwd))) {
    const auth = await window.electronAPI.authUser(username, oldPass);
    if (!auth.ok || !auth.data) {
      return toast("L'ancien mot de passe est incorrect. Action refusée.", "error");
    }
  }

  const perms = {};
  const list = ['canSell', 'canMakeQuotes', 'canManageReturns', 'canSettleDebt', 'canManageExpenses', 'canConfigureProducts', 'canEditStock', 'canSeeReports', 'canSeeProfit', 'canDeleteHistory', 'canSeeDashboard', 'canManageCategories'];
  list.forEach(k => { 
    const el = document.getElementById('perm_'+k);
    if(el) perms[k] = el.checked; 
  });

  const image = document.getElementById('userPhotoPreview').dataset.img || '';

  // Déterminer la valeur du mdp à envoyer
  let passwordValue;
  if (noPass) {
    passwordValue = ""; // Désactiver
  } else {
    passwordValue = (id && newPass === "" && confirmPass === "") ? undefined : newPass;
  }

  const res = await window.electronAPI.upsertUser({
    id, username, password: passwordValue, role, permissions: JSON.stringify(perms), image
  }, currentUser?.username);

  if (res.ok) {
    toast('Utilisateur enregistré avec succès');
    closeModal('userModal');
    loadFromDB(); // Recharger la liste
    renderUsers();
  } else {
    toast('Erreur: ' + res.error, 'error');
  }
}

async function deleteUser(id) {
  confirmDelete('Supprimer définitivement ce compte ?', async () => {
    const res = await window.electronAPI.deleteUser(id, currentUser?.username);
    if (res.ok) {
      toast('Utilisateur supprimé');
      loadFromDB();
      renderUsers();
    }
  });
}

// --- CATALOGUE WHATSAPP ---
function openCatalogModal() {
  // Remplir les checkboxes des catégories
  const catList = document.getElementById('catalogCatCheckboxes');
  catList.innerHTML = store.categories.map(c => `
    <label style="display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer;">
      <input type="checkbox" class="catalog-cat-item" value="${c.id}"> ${c.name}
    </label>
  `).join('');
  
  // Remplir la sélection manuelle des produits
  const manualList = document.getElementById('catalogManualSelection');
  manualList.innerHTML = store.products.map(p => `
    <label style="display:flex; align-items:center; gap:8px; padding:4px 0; border-bottom:1px solid var(--border); font-size:13px; cursor:pointer;">
      <input type="checkbox" class="catalog-manual-item" value="${p.id}"> ${p.name} (${fmt(p.price)})
    </label>
  `).join('');

  openModal('catalogModal');
}

function toggleCatalogExportType() {
  const type = document.querySelector('input[name="catalogExportType"]:checked').value;
  document.getElementById('catalogCatCheckboxes').style.display = type === 'category' ? 'block' : 'none';
  document.getElementById('catalogManualSelection').style.display = type === 'manual' ? 'block' : 'none';
}

function getSelectedCatalogProducts() {
  const type = document.querySelector('input[name="catalogExportType"]:checked').value;
  let products = [];

  if (type === 'all') {
    products = store.products;
  } else if (type === 'category') {
    const checkedCats = Array.from(document.querySelectorAll('.catalog-cat-item:checked')).map(cb => cb.value);
    if (!checkedCats.length) { toast('Veuillez cocher au moins une catégorie', 'warning'); return null; }
    products = store.products.filter(p => checkedCats.includes(p.categoryId));
  } else {
    const checked = Array.from(document.querySelectorAll('.catalog-manual-item:checked')).map(cb => cb.value);
    if (!checked.length) { toast('Veuillez sélectionner au moins un produit', 'warning'); return null; }
    products = store.products.filter(p => checked.includes(p.id));
  }
  return products;
}

function generateCatalogHTML(products) {
  const logo = getAppLogo();
  const appName = getAppName();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:80px; max-width:200px; object-fit:contain; display:block; margin: 0 auto 10px;">` : '';

  return `
    <div style="font-family: sans-serif; padding: 20px; background: white !important; color: black !important; min-height: 100%;">
      <div style="text-align:center; margin-bottom:30px; border-bottom:2px solid #25D366; padding-bottom:20px; background: white !important;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:5px; margin-bottom:15px;">
          ${logoHtml}
          <div style="font-size:26px; font-weight:800; color:#1a1a1a; letter-spacing:1px; text-transform:uppercase;">${appName}</div>
        </div>
        <h1 style="margin:0; font-size:22px; color:#333; font-weight:700; letter-spacing:2px;">CATALOGUE PRODUITS</h1>
        <p style="margin:8px 0 0; color:#666; font-size:13px;">Mis à jour le ${new Date().toLocaleDateString('fr-FR')}</p>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; background: white !important;">
        ${products.map(p => `
          <div class="catalog-print-item" style="border: 1px solid #eee; border-radius: 8px; padding: 12px; text-align: center; background: white !important; display:flex; flex-direction:column; justify-content:space-between; height: 240px; break-inside: avoid; page-break-inside: avoid;">
            <div style="width:100%; height:130px; display:flex; align-items:center; justify-content:center; margin-bottom:8px; background: white !important;">
              ${p.image ? `<img src="${p.image}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:4px;">` : `<div style="width:60px; height:60px; background:#f9f9f9; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#ddd; font-size:24px;"><i class="fas fa-image"></i></div>`}
            </div>
            <div style="background: white !important;">
              <h3 style="margin: 0; font-size:14px; color:#333; line-height:1.2; max-height:34px; overflow:hidden;">${p.name}</h3>
              <p style="margin: 4px 0; font-weight:700; color:#27ae60; font-size:16px;">${fmt(p.price)}</p>
              <span style="font-size:10px; color:#999; text-transform:uppercase; letter-spacing:0.5px;">${store.categories.find(c => c.id === p.categoryId)?.name || 'Général'}</span>
            </div>
          </div>
        `).join('')}
      </div>
      
      <div style="margin-top:40px; text-align:center; border-top:1px solid #eee; padding-top:15px; color:#888; font-size:11px; background: white !important;">
        <p style="font-weight:700; color:#444; margin-bottom:3px;">${store.settings['PHARMACIE_APP_NAME'] || 'Pharmacie'}</p>
        <p>${store.settings['PHARMACIE_APP_PHONE'] || ''} ${store.settings['PHARMACIE_APP_ADDRESS'] ? ' — ' + store.settings['PHARMACIE_APP_ADDRESS'] : ''}</p>
      </div>
    </div>
  `;
}

async function exportAndShareCatalog() {
  const products = getSelectedCatalogProducts();
  if (!products || !products.length) return;

  toast('Génération du catalogue PDF...', 'info');
  const htmlResult = generateCatalogHTML(products);
  
  // On utilise printArea pour garantir l'identité avec l'impression
  document.getElementById('printArea').innerHTML = htmlResult;

  const filename = `Catalogue_${new Date().getTime()}.pdf`;
  // on passe null en htmlContent pour que main.js utilise le rendu de la fenêtre principale (printArea)
  const res = await window.electronAPI.exportPdfHidden(filename, null);
  
  // Nettoyage immédiat
  document.getElementById('printArea').innerHTML = '';

  if (res.ok) {
    toast('Catalogue PDF prêt !');
    closeModal('catalogModal');
    // Ouvrir le dossier et rediriger vers WA
    window.electronAPI.showInFolder(res.filePath);
    setTimeout(() => {
      navigate('whatsapp');
      toast('Glissez-déposez le fichier dans WhatsApp pour l\'envoyer', 'info');
    }, 500); // Réduit le délai pour plus de fluidité
  } else {
    toast('Erreur lors de l\'export : ' + res.error, 'error');
  }
}

async function printCatalog() {
  const products = getSelectedCatalogProducts();
  if (!products || !products.length) return;

  const html = generateCatalogHTML(products);
  document.getElementById('printArea').innerHTML = html;
  closeModal('catalogModal');

  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

// ─────────────────────────────────────────────────────────────
// ─── WHATSAPP INTEGRATION ────────────────────────────────────
async function updateWhatsAppView() {
  const container = document.getElementById('whatsappContainer');
  if (!container || currentSection !== 'whatsapp') return;

  const rect = container.getBoundingClientRect();
  const bounds = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
  
  if (IS_ELECTRON && window.electronAPI.whatsappSetBounds) {
    window.electronAPI.whatsappSetBounds(bounds);
  }
}

// Mise à jour du statut global (peut être appelée depuis n'importe quel onglet)
async function checkWhatsAppStatus() {
  // Si le module WhatsApp est désactivé dans les paramètres → fallback navigateur
  const moduleSettings = getModuleSettings();
  if (moduleSettings['whatsapp'] === false) {
    isWhatsAppConnected = false;
    return false;
  }

  if (!IS_ELECTRON || !window.electronAPI.whatsappGetStatus) return false;
  try {
    let status = await window.electronAPI.whatsappGetStatus();
    
    // Si la page charge encore, on attend et on réessaie une fois
    if (!status.connected && status.url === '') {
      await new Promise(r => setTimeout(r, 1500));
      status = await window.electronAPI.whatsappGetStatus();
    }
    
    isWhatsAppConnected = status.connected;
    console.log("[WA Status] connected =", isWhatsAppConnected, "| url =", status.url);
    return isWhatsAppConnected;
  } catch(e) {
    isWhatsAppConnected = false;
    return false;
  }
}

// Mise à jour du badge d'affichage DANS l'onglet whatsapp + polling
async function refreshWhatsAppStatus() {
  await checkWhatsAppStatus(); // On met toujours à jour la variable globale

  const badge = document.getElementById('whatsappStatusBadge');
  if (!badge) return; // Le badge peut ne pas exister si on est hors onglet WA → c'est ok
  
  if (isWhatsAppConnected) {
    badge.innerHTML = 'Connecté <i class="fas fa-check"></i>';
    badge.className = 'badge success';
  } else if (IS_ELECTRON && window.electronAPI.whatsappGetStatus) {
    badge.innerHTML = 'Non lié <i class="fas fa-exclamation-triangle"></i>';
    badge.className = 'badge warning';
    // Polling pour détecter le scan automatiquement
    if (currentSection === 'whatsapp') {
      setTimeout(refreshWhatsAppStatus, 2000);
    }
  } else {
    badge.textContent = 'Navigateur';
    badge.className = 'badge info';
  }
}

async function logoutWhatsApp() {
  confirmDelete('Déconnecter votre compte WhatsApp de Pharmacie ?', async () => {
    if (IS_ELECTRON && window.electronAPI.whatsappLogout) {
      await window.electronAPI.whatsappLogout();
      toast('Déconnecté avec succès', 'info');
      refreshWhatsAppStatus();
    }
  });
}

function refreshWhatsApp() {
  if (IS_ELECTRON && window.electronAPI.whatsappRefresh) {
    window.electronAPI.whatsappRefresh();
    toast('Actualisation de WhatsApp...', 'info');
  }
}

// ─── LOGO MANAGEMENT ────────────────────────────────────────────────────────
function handleLogoUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result;
    await _settingSet('PHARMACIE_APP_LOGO', base64);
    _applyLogoPreview(base64);
    toast('Logo enregistré');
  };
  reader.readAsDataURL(file);
}
async function removeLogo() {
  const logo = getAppLogo();
  if (logo && IS_ELECTRON) {
    await window.electronAPI.moveToTrash('app_logo', 'current', 'Logo Entreprise', { logo });
  }
  await _settingSet('PHARMACIE_APP_LOGO', '');
  _applyLogoPreview(null);
  toast('Logo envoyé à la corbeille', 'warning');
  if (currentSection === 'settings') renderTrashList();
}
function _applyLogoPreview(src) {
  const img = document.getElementById('appLogoPreview');
  const btn = document.getElementById('removeLogoBtn');
  const tbLogo = document.querySelector('.titlebar-logo');
  const sbLogo = document.querySelector('.logo .logo-icon');
  if (!img) return;
  if(src) {
    img.src = src; img.style.display = 'block';
    if(btn) btn.style.display = '';
    if(tbLogo) tbLogo.innerHTML = `<img src="${src}" style="height:22px; width:auto; object-fit:contain; vertical-align:middle;">`;
    if(sbLogo) sbLogo.innerHTML = `<img src="${src}" style="width:32px; height:32px; object-fit:contain; border-radius:4px;">`;
    if (window.electronAPI && window.electronAPI.setAppIcon) {
      window.electronAPI.setAppIcon(src);
    }
  } else {
    img.src = '';
    img.style.display = 'none';
    if(btn) btn.style.display = 'none';
    if(tbLogo) tbLogo.innerHTML = `<i class="fas fa-store"></i>`;
    if(sbLogo) sbLogo.innerHTML = `<i class="fas fa-store"></i>`;
    if (window.electronAPI && window.electronAPI.setAppIcon) {
      window.electronAPI.setAppIcon(null); // Reset to default icon
    }
  }
}

// ─────────────────────────────────────────────────────────────

// ─── CATEGORIES ───────────────────────────────────────────────
function openCategoryModal(id=null) {
  document.getElementById('categoryId').value='';
  document.getElementById('categoryName').value='';
  document.getElementById('categoryDescription').value='';
  document.getElementById('categoryModalTitle').textContent = id?'Modifier la catégorie':'Ajouter une catégorie';
  if(id){
    const c=store.categories.find(c=>c.id===id);
    if(c){ document.getElementById('categoryId').value=c.id; document.getElementById('categoryName').value=c.name; document.getElementById('categoryDescription').value=c.description||''; }
  }
  openModal('categoryModal');
}
let isSavingCategory = false;
async function saveCategory() {
  if(isSavingCategory) return;
  isSavingCategory = true;
  try {
  const id=document.getElementById('categoryId').value;
  const name=document.getElementById('categoryName').value.trim();
  const description=document.getElementById('categoryDescription').value.trim();
  if(!name) return toast('Le nom est requis','error');
  if(IS_ELECTRON){
    const res = await window.electronAPI.upsertCategory({id:id||undefined, name, description}, currentUser?.username);
    if(!res.ok) return toast('Erreur: '+res.error,'error');
    await loadFromDB();
  } else {
    if(id){ const i=store.categories.findIndex(c=>c.id===id); store.categories[i]={...store.categories[i],name,description}; }
    else store.categories.push({id:genId('cat'),name,description,createdAt:new Date().toISOString()});
    saveStore();
  }
  toast(id?'Catégorie mise à jour':'Catégorie ajoutée');
  closeModal('categoryModal'); renderCategories(); updateCategorySelects();
  } finally {
    isSavingCategory = false;
  }
}
function deleteCategory(id) {
  confirmDelete('Supprimer cette catégorie ? Elle ira à la corbeille.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteCategory(id, currentUser?.username); await loadFromDB(); }
    else { store.categories=store.categories.filter(c=>c.id!==id); saveStore(); }
    renderCategories(); updateCategorySelects(); toast('Catégorie supprimée','warning');
  });
}
function renderCategories() {
  const tbody=document.getElementById('categoriesBody'); if(!tbody) return;
  const canDelete = currentUser?.role === 'admin' || currentUser?.permissions?.canDeleteHistory;
  if(!store.categories.length){
    tbody.innerHTML=`<tr><td colspan="4"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-th-large"></i></div><p>Aucune catégorie.</p></div></td></tr>`; return;
  }
  tbody.innerHTML=store.categories.map(cat=>{
    const count=store.products.filter(p=>p.categoryId===cat.id).length;
    const delBtn = hasPerm('canManageCategories') ? `<button class="btn-icon danger" onclick="deleteCategory('${cat.id}')"><i class="fas fa-trash-alt"></i></button>` : '';
    return `<tr><td><strong>${cat.name}</strong></td><td class="text-muted">${cat.description||'—'}</td>
    <td><span class="badge badge-info">${count} produit${count>1?'s':''}</span></td>
    <td><div class="actions-cell"><button class="btn-icon" onclick="openCategoryModal('${cat.id}')"><i class="fas fa-edit"></i></button>${delBtn}</div></td></tr>`;
  }).join('');
}
function updateCategorySelects() {
  ['productCategory', 'productCatFilter', 'stockCatFilter', 'salesCatFilter'].forEach(sid => {
    const sel=document.getElementById(sid); if(!sel) return;
    const cur=sel.value; const isFilter=sid.includes('Filter');
    sel.innerHTML=isFilter?'<option value="">Toutes les catégories</option>':'<option value="">Sélectionner...</option>';
    store.categories.forEach(c=>{ sel.innerHTML+=`<option value="${c.id}">${c.name}</option>`; });
    if(cur) sel.value=cur;
  });
}

// ─── PRODUCTS ─────────────────────────────────────────────────
function openProductModal(id=null) {
  const isAdmin = currentUser?.role === 'admin';
  if (id && !isAdmin) {
    return toast("Modification interdite. Contactez l'administrateur.", 'error');
  }

  ['productId','productName','productDescription','productPrice','productPurchasePrice','productStock','productImage','productBarcode', 'productExpiryDate', 'productBatchNumber', 'productGalenicForm', 'productDosage', 'productLaboratory', 'productShelfLocation'].forEach(f=>document.getElementById(f).value='');
  document.getElementById('productPurchaseType').value='unitaire';
  document.getElementById('productModalTitle').textContent=id?'Modifier le produit':'Ajouter un produit';
  document.getElementById('productImagePreview').style.display='none';
  updateCategorySelects();
  if(id){
    const p=store.products.find(p=>p.id===id);
    if(p){
      document.getElementById('productId').value=p.id;
      document.getElementById('productName').value=p.name;
      document.getElementById('productDescription').value=p.description||'';
      document.getElementById('productCategory').value=p.categoryId||'';
      document.getElementById('productPrice').value=p.price;
      document.getElementById('productPurchasePrice').value=p.purchasePrice||'';
      document.getElementById('productPurchaseType').value='unitaire';
      
      const stockInput = document.getElementById('productStock');
      stockInput.value = p.stock;
      stockInput.disabled = true;
      stockInput.title = "Pour modifier le stock, allez dans l'onglet Stock";
      
      const bInput = document.getElementById('productBarcode');
      bInput.value = p.barcode || '';
      bInput.disabled = true;
      bInput.title = "Le code-barre ne peut pas être modifié";
      bInput.parentElement.querySelectorAll('button').forEach(b => b.style.display = 'none');
      
      document.getElementById('productImage').value=p.image||'';
      
      // Pharmacy fields
      document.getElementById('productExpiryDate').value=p.expiryDate||'';
      document.getElementById('productBatchNumber').value=p.batchNumber||'';
      document.getElementById('productGalenicForm').value=p.galenicForm||'';
      document.getElementById('productDosage').value=p.dosage||'';
      document.getElementById('productLaboratory').value=p.laboratory||'';
      document.getElementById('productShelfLocation').value=p.shelfLocation||'';
      
      if(p.image) showImagePreview(p.image);
    }
  } else {
    const stockInput = document.getElementById('productStock');
    stockInput.disabled = false;
    stockInput.title = "";
    
    const bInput = document.getElementById('productBarcode');
    bInput.disabled = false;
    bInput.title = "";
    bInput.parentElement.querySelectorAll('button').forEach(b => b.style.display = '');
  }
  openModal('productModal');
  if(!id) setTimeout(() => document.getElementById('productBarcode')?.focus(), 300);
}

function loadProductImageFile(input) {
  const file=input.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=(e)=>{
    document.getElementById('productImage').value=e.target.result;
    showImagePreview(e.target.result);
  };
  reader.readAsDataURL(file);
}

function previewProductImage() {
  const val=document.getElementById('productImage').value.trim();
  if(val) showImagePreview(val); else document.getElementById('productImagePreview').style.display='none';
}

function showImagePreview(src) {
  const el=document.getElementById('productImagePreview');
  el.style.display='block';
  el.innerHTML=`<img src="${src}" onerror="this.parentElement.style.display='none'" alt="Aperçu">`;
}
let isSavingProduct = false;
async function saveProduct() {
  if(isSavingProduct) return;
  isSavingProduct = true;
  try {
  const id=document.getElementById('productId').value;
  const name=document.getElementById('productName').value.trim();
  const price=parseFloat(document.getElementById('productPrice').value)||0;
  let purchasePriceInput=parseFloat(document.getElementById('productPurchasePrice').value)||0;
  const purchaseType=document.getElementById('productPurchaseType').value;
  const stockStr=document.getElementById('productStock').value;
  const stock=parseInt(stockStr)||0;
  const categoryId=document.getElementById('productCategory').value;
  const description=document.getElementById('productDescription').value.trim();
  const image=document.getElementById('productImage').value.trim();
  let barcode=document.getElementById('productBarcode').value.trim();
  const expiryDate=document.getElementById('productExpiryDate').value;
  const batchNumber=document.getElementById('productBatchNumber').value.trim();
  const galenicForm=document.getElementById('productGalenicForm').value.trim();
  const dosage=document.getElementById('productDosage').value.trim();
  const laboratory=document.getElementById('productLaboratory').value.trim();
  const shelfLocation=document.getElementById('productShelfLocation').value.trim();
  
  if(!name) return toast('Le nom du produit est requis','error');
  if(isNaN(price) || price <= 0) return toast('Le prix de vente est obligatoire et doit être positif','error');
  if(purchasePriceInput<0) return toast('Le prix d\'achat doit être positif','error');
  if(!id && (stockStr === "" || stock < 0)) return toast('La quantité initiale est obligatoire et doit être positive','error');

  // Vérification de l'unicité du nom (insensible à la casse)
  const existing = store.products.find(p => p.name.toLowerCase() === name.toLowerCase() && p.id !== id);
  if (existing) return toast(`Le produit "${name}" existe déjà.`,'error');

  // Vérification de l'unicité du code-barre (si renseigné)
  if (barcode) {
    const duplicateBarcode = store.products.find(p => p.barcode === barcode && p.id !== id);
    if (duplicateBarcode) return toast(`Le code-barre "${barcode}" est déjà utilisé par le produit "${duplicateBarcode.name}".`, 'error');
  }

  // Génération automatique du code-barre pour les nouveaux produits s'il est vide
  if(!id && !barcode) {
    do {
      barcode = Math.floor(1000000000000 + Math.random() * 9000000000000).toString();
    } while(store.products.some(p => p.barcode === barcode));
  }

  let purchasePrice = purchasePriceInput;
  if(purchaseType === 'total' && stock > 0) {
      purchasePrice = purchasePriceInput / stock;
  }

  if(IS_ELECTRON){
    const res = await window.electronAPI.upsertProduct({
      id:id||undefined,name,price,purchasePrice,stock,categoryId,description,image,barcode,
      expiryDate, batchNumber, galenicForm, dosage, laboratory, shelfLocation
    }, currentUser?.username);
    if(!res.ok) return toast('Erreur: '+res.error,'error');
    await loadFromDB();
  } else {
    if(id){ 
      const i=store.products.findIndex(p=>p.id===id); 
      store.products[i]={
        ...store.products[i],name,price,purchasePrice,stock,categoryId,description,image,barcode,
        expiryDate, batchNumber, galenicForm, dosage, laboratory, shelfLocation
      }; 
    }
    else store.products.push({
      id:genId('prod'),name,price,purchasePrice,stock,categoryId,description,image,barcode,
      expiryDate, batchNumber, galenicForm, dosage, laboratory, shelfLocation,
      createdAt:new Date().toISOString()
    });
    saveStore();
  }
  toast(id?'Produit mis à jour':'Produit ajouté');
  closeModal('productModal'); renderProducts(); checkLowStock();
  } finally {
    isSavingProduct = false;
  }
}

function generateBarcode() {
  // Générer 12 chiffres aléatoires
  let code = "";
  for(let i=0; i<12; i++) code += Math.floor(Math.random()*10);
  
  // Calcul du 13ème chiffre (checksum EAN13)
  let sum = 0;
  for(let i=0; i<12; i++) {
    sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
  }
  let checksum = (10 - (sum % 10)) % 10;
  code += checksum;
  
  document.getElementById('productBarcode').value = code;
}

function printBarcode(id) {
  const p = store.products.find(p => p.id === id);
  if(!p) return;
  if(!p.barcode) return toast("Ce produit n'a pas de code-barre", 'warning');
  
  // Afficher le nom dans le modal
  const nameEl = document.getElementById('barcodeProdName');
  if(nameEl) nameEl.textContent = p.name;
  
  openModal('barcodePrintModal');
  try {
    if (typeof JsBarcode === 'undefined') {
      return toast("Bibliothèque JsBarcode non chargée", 'error');
    }
    const format = /^\d{13}$/.test(p.barcode) ? "EAN13" : "CODE128";
    try {
      JsBarcode("#barcodeCanvas", p.barcode, {
        format: format,
        lineColor: "#000",
        width: 2,
        height: 60,
        displayValue: true
      });
    } catch (err) {
      console.warn("EAN13 checksum failed, falling back to CODE128", err);
      JsBarcode("#barcodeCanvas", p.barcode, {
        format: "CODE128",
        lineColor: "#000",
        width: 2,
        height: 60,
        displayValue: true
      });
    }
    document.getElementById('barcodeCanvas').dataset.productId = id;
  } catch(e) {
    toast('Impossible de générer le code-barre', 'error');
  }
}

function printBarcodeLabel() {
  const id = document.getElementById('barcodeCanvas').dataset.productId;
  const p = store.products.find(x => x.id === id);
  const svg = document.getElementById('barcodeCanvas').outerHTML;
  document.getElementById('printArea').innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:10px; font-family: sans-serif;">
      <div style="font-size:16px; font-weight:bold; margin-bottom:5px; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p ? p.name : ''}</div>
      ${svg}
    </div>
  `;
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

async function exportBarcodeImageAction() {
  const id = document.getElementById('barcodeCanvas').dataset.productId;
  const p = store.products.find(x => x.id === id);
  if (!p) return;
  
  closeModal('barcodePrintModal');
  toast('Génération de l\'étiquette 4K...', 'info');

  const canvas = document.createElement('canvas');
  let barcodeDataUrl = '';
  if (window.JsBarcode) {
    try {
      const format = /^\d{13}$/.test(p.barcode) ? "EAN13" : "CODE128";
      try {
        JsBarcode(canvas, p.barcode, { format: format, width: 4, height: 120, displayValue: true, fontSize: 20 });
      } catch (err) {
        JsBarcode(canvas, p.barcode, { format: "CODE128", width: 4, height: 120, displayValue: true, fontSize: 20 });
      }
      barcodeDataUrl = canvas.toDataURL("image/png");
    } catch (e) { 
      console.error(e);
      // Fallback ultime si toDataURL échoue
    }
  }

  const html = `
    <div style="display:inline-block; padding:15px; background:white; text-align:center; font-family: 'Segoe UI', Roboto, sans-serif; border-radius:15px; border:1px solid #e0e0e0; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
      <div style="font-size:20px; font-weight:800; color:#000; margin-bottom:5px; text-transform:uppercase; letter-spacing:0.3px; line-height:1.1;">${p.name}</div>
      <img src="${barcodeDataUrl}" style="max-width:100%; height:auto; display:block; margin: 0 auto;">
    </div>
  `;

  const filename = `Etiquette_${p.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().getTime()}.png`;
  const res = await window.electronAPI.exportImage(filename, html);

  if (res.ok) {
    toast('Étiquette enregistrée en 4K');
    window.electronAPI.showInFolder(res.filePath);
  } else {
    toast('Erreur d\'exportation: ' + res.error, 'error');
  }
}

function printProduct(id, includeBarcode = true) {
  const p = store.products.find(x => x.id === id);
  if (!p) return;
  const cat = store.categories.find(c => c.id === p.categoryId);
  
  const logo = getAppLogo();
  const appName = getAppName();
  const phone = getAppPhone();
  const address = getAppAddress();
  
  const logoHtml = logo ? `<img src="${logo}" style="max-height:70px; max-width:180px; object-fit:contain; margin-bottom:10px;">` : '';
  const contactHtml = (phone || address) ? `<div style="font-size:12px; color:#666; line-height:1.4;">${address ? address + '<br>' : ''}${phone}</div>` : '';

  let barcodeImgHtml = '';
  if (includeBarcode && p.barcode && window.JsBarcode) {
    const canvas = document.createElement('canvas');
    try {
      const format = /^\d{13}$/.test(p.barcode) ? "EAN13" : "CODE128";
      try {
        JsBarcode(canvas, p.barcode, { format: format, width: 2, height: 60, displayValue: false });
      } catch (err) {
        JsBarcode(canvas, p.barcode, { format: "CODE128", width: 2, height: 60, displayValue: false });
      }
      const barcodeDataUrl = canvas.toDataURL("image/png");
      barcodeImgHtml = `
        <div style="margin-top:20px; text-align:center; padding:15px; border:1px dashed #ddd; border-radius:8px;">
          <div style="font-size:11px; color:#999; margin-bottom:8px; text-transform:uppercase;">${p.name}</div>
          <img src="${barcodeDataUrl}" style="max-width:100%;">
          <div style="font-family:monospace; margin-top:5px; font-size:13px;">${p.barcode}</div>
        </div>`;
    } catch (e) { console.error("Barcode generation failed", e); }
  }

  const html = `
    <div style="padding:40px; font-family: 'Segoe UI', Roboto, sans-serif; color:#333; max-width:800px; margin:auto; background:white;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f0f0f0; padding-bottom:20px; margin-bottom:30px;">
        <div style="max-width: 450px;">
          <div style="font-size:14px; color:#999; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:5px;">Fiche Produit</div>
          <h1 style="margin:0; font-size:32px; color:#1a1a1a; font-weight:800; line-height:1.1;">${p.name}</h1>
          <div style="margin-top:10px;"><span style="background:#eef2ff; color:#4f46e5; padding:4px 12px; border-radius:20px; font-size:13px; font-weight:600;">${cat ? cat.name : 'Général'}</span></div>
        </div>
        <div style="text-align:right; flex:1; padding-left:20px;">
          ${logoHtml}
          <div style="font-size:20px; font-weight:700; color:#1a1a1a; word-wrap:break-word;">${appName}</div>
          ${contactHtml}
        </div>
      </div>

      <div style="display:flex; gap:40px; margin-bottom:40px; align-items:flex-start;">
        <div style="flex: 0 0 300px;">
          <div style="width:300px; height:300px; border:1px solid #f0f0f0; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fafafa;">
            ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:contain;">` : `<i class="fas fa-image" style="font-size:60px; color:#ddd;"></i>`}
          </div>
          ${barcodeImgHtml}
        </div>
        
        <div style="flex:1;">
          <div style="margin-bottom:25px;">
            <div style="font-size:12px; color:#999; text-transform:uppercase; margin-bottom:5px;">Prix de vente</div>
            <div style="font-size:36px; font-weight:800; color:#27ae60;">${fmt(p.price)}</div>
          </div>
          
          <div style="display:grid; grid-template-columns:1fr; gap:20px; margin-bottom:30px; padding:20px; background:#f9fafb; border-radius:12px;">
            <div>
              <div style="font-size:11px; color:#999; text-transform:uppercase; margin-bottom:4px;">Disponibilité</div>
              <div style="font-size:18px; font-weight:700; color:${p.stock > 0 ? '#1a1a1a' : '#e74c3c'}">
                ${p.stock > 0 ? p.stock + ' en stock' : 'En rupture'}
              </div>
            </div>
          </div>

          <div>
            <div style="font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">Description</div>
            <div style="font-size:15px; line-height:1.6; color:#4b5563; white-space:pre-wrap;">${p.description || 'Aucune description disponible pour ce produit.'}</div>
          </div>
        </div>
      </div>

      <div style="margin-top:50px; padding-top:20px; border-top:1px solid #eee; text-align:center; color:#999; font-size:14px; font-weight:700;">
        ${appName}
      </div>
    </div>
  `;

  document.getElementById('printArea').innerHTML = html;
  
  setTimeout(() => {
    if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
      window.electronAPI.printPreview();
    } else {
      window.print();
    }
  }, 150);
}

function openProductPrintOptions(id) {
  openProductPreview(id);
}

function confirmPrintProduct(includeBarcode) {
  // Cette fonction n'est plus utilisée directement par l'UI principale
  const id = currentPreviewData.productId;
  printProduct(id, includeBarcode);
}

async function exportProductImageAction(requestedBarcode = true) {
  // Cette fonction n'est plus utilisée directement par l'UI principale
  openProductPreview(currentPreviewData.productId, requestedBarcode);
}

function renderProductCardHTML(productId, includeBarcode) {
  const p = store.products.find(x => x.id === productId);
  if (!p) return "";

  const cat = store.categories.find(c => c.id === p.categoryId);
  const logo = getAppLogo();
  const appName = getAppName();
  const phone = getAppPhone();
  const address = getAppAddress();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:70px; max-width:180px; object-fit:contain; margin-bottom:10px;">` : '';
  const contactHtml = (phone || address) ? `<div style="font-size:12px; color:#666; line-height:1.4;">${address ? address + '<br>' : ''}${phone}</div>` : '';

  let barcodeImgHtml = '';
  const barcodeValue = p.barcode ? String(p.barcode).trim() : '';

  if (includeBarcode && barcodeValue && typeof JsBarcode !== 'undefined') {
    const canvas = document.createElement('canvas');
    try {
      // EAN13 must have exactly 13 digits
      const format = /^\d{13}$/.test(barcodeValue) ? "EAN13" : "CODE128";
      try {
        JsBarcode(canvas, barcodeValue, { 
          format: format, 
          width: 2, 
          height: 60, 
          displayValue: false,
          margin: 0
        });
      } catch(e) {
        // Fallback to CODE128 if EAN13 fails (e.g. invalid checksum)
        JsBarcode(canvas, barcodeValue, { 
          format: "CODE128", 
          width: 2, 
          height: 60, 
          displayValue: false,
          margin: 0
        });
      }
      const barcodeDataUrl = canvas.toDataURL("image/png");
      barcodeImgHtml = `
        <div style="margin-top:20px; text-align:center; padding:15px; border:1px dashed #ddd; border-radius:8px; background:#fff;">
          <div style="font-size:11px; color:#999; margin-bottom:8px; text-transform:uppercase;">${p.name}</div>
          <img src="${barcodeDataUrl}" style="max-height:80px; max-width:100%; object-fit:contain;">
          <div style="font-family:monospace; margin-top:5px; font-size:14px; font-weight:700; color:#000;">${barcodeValue}</div>
        </div>`;
    } catch(e) { 
      console.error("Barcode generation error:", e);
      barcodeImgHtml = `<div style="color:red; font-size:11px; margin-top:10px;">Erreur de génération du code-barre</div>`;
    }
  }

  return `
    <div style="padding:40px; font-family: 'Segoe UI', Roboto, sans-serif; color:#333; width:800px; margin:0 auto; background:white; box-sizing:border-box;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #f0f0f0; padding-bottom:20px; margin-bottom:30px;">
        <div style="max-width: 450px;">
          <div style="font-size:14px; color:#999; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:5px;">Fiche Produit</div>
          <h1 style="margin:0; font-size:32px; color:#1a1a1a; font-weight:800; line-height:1.1;">${p.name}</h1>
          <div style="margin-top:10px;"><span style="background:#eef2ff; color:#4f46e5; padding:4px 12px; border-radius:20px; font-size:13px; font-weight:600;">${cat ? cat.name : 'Général'}</span></div>
        </div>
        <div style="text-align:right; flex:1; padding-left:20px;">
          ${logoHtml}
          <div style="font-size:20px; font-weight:700; color:#1a1a1a; word-wrap:break-word;">${appName}</div>
          ${contactHtml}
        </div>
      </div>

      <div style="display:flex; gap:40px; margin-bottom:40px; align-items:flex-start;">
        <div style="flex: 0 0 300px;">
          <div style="width:300px; height:300px; border:1px solid #f0f0f0; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fafafa;">
            ${p.image ? `<img src="${p.image}" style="width:100%; height:100%; object-fit:contain;">` : `<i class="fas fa-image" style="font-size:60px; color:#ddd;"></i>`}
          </div>
          ${barcodeImgHtml}
        </div>
        
        <div style="flex:1;">
          <div style="margin-bottom:25px;">
            <div style="font-size:12px; color:#999; text-transform:uppercase; margin-bottom:5px;">Prix de vente</div>
            <div style="font-size:42px; font-weight:800; color:#27ae60; line-height:1;">${fmt(p.price)}</div>
          </div>
          
          <div style="margin-bottom:30px; padding:20px; background:#f9fafb; border-radius:12px; border:1px solid #f0f4f8;">
            <div>
              <div style="font-size:11px; color:#999; text-transform:uppercase; margin-bottom:4px;">Disponibilité</div>
              <div style="font-size:18px; font-weight:700; color:${p.stock > 0 ? '#1a1a1a' : '#e74c3c'}">
                ${p.stock > 0 ? p.stock + ' en stock' : 'En rupture'}
              </div>
            </div>
          </div>

          <div>
            <div style="font-size:12px; color:#999; text-transform:uppercase; margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">Description</div>
            <div style="font-size:15px; line-height:1.6; color:#4b5563; white-space:pre-wrap;">${p.description || 'Aucune description disponible pour ce produit.'}</div>
          </div>
        </div>
      </div>

      <div style="margin-top:50px; padding-top:20px; border-top:1px solid #eee; text-align:center; color:#999; font-size:14px; font-weight:700; text-transform:uppercase; letter-spacing:1px;">
        ${appName}
      </div>
      <div style="height:20px;"></div>
    </div>
  `;
}

let currentPreviewData = { productId: null, includeBarcode: false };

function openProductPreview(id, defaultIncludeBarcode = true) {
  const p = store.products.find(x => x.id === id);
  if (!p) return;

  currentPreviewData = { productId: id, includeBarcode: defaultIncludeBarcode && !!p.barcode };
  
  // Synchroniser l'interrupteur
  const toggle = document.getElementById('previewIncludeBarcodeToggle');
  if (toggle) {
    toggle.checked = currentPreviewData.includeBarcode;
    toggle.disabled = !p.barcode; // Désactiver si pas de barcode dispo
  }

  const html = renderProductCardHTML(id, currentPreviewData.includeBarcode);
  const container = document.getElementById('productCardPreviewContainer');
  if (container) container.innerHTML = html;
  
  openModal('productCardPreviewModal');
}

function updatePreviewFromOptions() {
  if (!currentPreviewData.productId) return;
  const toggle = document.getElementById('previewIncludeBarcodeToggle');
  if (!toggle) return;

  currentPreviewData.includeBarcode = toggle.checked;

  const html = renderProductCardHTML(currentPreviewData.productId, currentPreviewData.includeBarcode);
  const container = document.getElementById('productCardPreviewContainer');
  if (container) container.innerHTML = html;
}

function confirmPrintProductFromPreview() {
  if (!currentPreviewData.productId) return;
  closeModal('productCardPreviewModal');
  printProduct(currentPreviewData.productId, currentPreviewData.includeBarcode);
}

async function confirmExportProductImageFromPreview() {
  if (!currentPreviewData.productId) return;
  const p = store.products.find(x => x.id === currentPreviewData.productId);
  if (!p) return;

  closeModal('productCardPreviewModal');
  toast('Génération de l\'image...', 'info');

  const html = renderProductCardHTML(currentPreviewData.productId, currentPreviewData.includeBarcode);
  const filename = `Produit_${p.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().getTime()}.png`;
  
  const res = await window.electronAPI.exportImage(filename, html);

  if (res.ok) {
    toast('Image enregistrée dans Téléchargements');
    window.electronAPI.showInFolder(res.filePath);
  } else {
    toast('Erreur lors de l\'export image: ' + res.error, 'error');
  }
}

function deleteProduct(id) {
  confirmDelete('Supprimer ce produit ? Il ira à la corbeille.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteProduct(id, currentUser?.username); await loadFromDB(); }
    else { store.products=store.products.filter(p=>p.id!==id); saveStore(); }
    renderProducts(); toast('Produit supprimé','warning');
  });
}

function renderProducts() {
  const tbody=document.getElementById('productsBody'); if(!tbody) return;
  const search=document.getElementById('productSearch')?.value.toLowerCase()||'';
  const catFilter=document.getElementById('productCatFilter')?.value||'';
  const sort=document.getElementById('productSort')?.value||'';
  let prods=store.products.filter(p=>p.name.toLowerCase().includes(search)&&(!catFilter||p.categoryId===catFilter));
  if(sort==='price-asc') prods.sort((a,b)=>a.price-b.price);
  else if(sort==='price-desc') prods.sort((a,b)=>b.price-a.price);
  else if(sort==='stock-asc') prods.sort((a,b)=>a.stock-b.stock);
  else if(sort==='stock-desc') prods.sort((a,b)=>b.stock-a.stock);
  if(!prods.length){
    tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-box"></i></div><p>Aucun produit trouvé.</p></div></td></tr>`; return;
  }
  tbody.innerHTML=prods.map(p=>{
    const cat=store.categories.find(c=>c.id===p.categoryId);
    const stockBadge=p.stock===0?`<span class="badge badge-danger">Rupture</span>`:p.stock<=5?`<span class="badge badge-warning">${p.stock}</span>`:`<span class="badge badge-success">${p.stock}</span>`;
    const imgPreviewAttr = p.image ? `onclick="event.stopPropagation(); window.electronAPI.imagePreview('${p.image.replace(/'/g, "\\'")}')" title="Cliquer pour agrandir"` : '';
    const imgEl=p.image?`<img src="${p.image}" class="product-img" alt="${p.name}" ${imgPreviewAttr} onerror="this.style.display='none'">`:`<div class="product-img-placeholder"><i class="fas fa-box"></i></div>`;
    return `<tr>
      <td>${imgEl}</td>
      <td><strong>${p.name}</strong>${p.barcode?`<br><small class="text-muted font-mono">${p.barcode}</small>`:''}</td>
      <td>${cat?`<span class="badge badge-info">${cat.name}</span>`:'<span class="text-muted">—</span>'}</td>
      <td class="font-mono">${fmt(p.price)}</td>
      <td>${stockBadge}</td>
      <td>${renderExpiryBadge(p.expiryDate)}</td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" onclick="printBarcode('${p.id}')" title="Imprimer Code-barre"><i class="fas fa-barcode"></i></button>
          <button class="btn-icon" onclick="openProductPrintOptions('${p.id}')" title="Imprimer fiche produit"><i class="fas fa-print"></i></button>
          <button class="btn-icon" onclick="openProductModal('${p.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
          ${hasPerm('canDeleteHistory') ? `<button class="btn-icon danger" onclick="deleteProduct('${p.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>` : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

function renderExpiryBadge(dateStr) {
  if (!dateStr) return '<span class="text-muted">—</span>';
  
  const expiry = new Date(dateStr);
  const now = new Date();
  const diffTime = expiry - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const dateFormatted = new Date(dateStr).toLocaleDateString('fr-FR');
  
  if (diffDays < 0) {
    return `<span class="badge badge-danger" title="Périmé le ${dateFormatted}"><i class="fas fa-calendar-times"></i> Périmé</span>`;
  } else if (diffDays <= 90) { // Moins de 3 mois
    return `<span class="badge badge-warning" title="Périt le ${dateFormatted}"><i class="fas fa-clock"></i> ${dateFormatted}</span>`;
  } else {
    return `<span class="badge badge-success" title="Périt le ${dateFormatted}"><i class="fas fa-calendar-check"></i> ${dateFormatted}</span>`;
  }
}

// ─── STOCK ────────────────────────────────────────────────────
function renderStock() {
  const tbody=document.getElementById('stockBody'); if(!tbody) return;
  const search=document.getElementById('stockSearch')?.value.toLowerCase()||'';
  const catFilter=document.getElementById('stockCatFilter')?.value||'';
  const low=store.products.filter(p=>p.stock<=5);
  const banner=document.getElementById('stockAlertBanner');
  if(banner) banner.style.display=low.length?'':'none';
  if(!store.products.length){
    tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-warehouse"></i></div><p>Aucun produit.</p></div></td></tr>`; return;
  }
  const filtered=store.products.filter(p=>{
    const matchesSearch=p.name.toLowerCase().includes(search);
    const matchesCat=!catFilter||p.categoryId===catFilter;
    return matchesSearch && matchesCat;
  });
  const sorted=[...filtered].sort((a,b)=>a.stock-b.stock);
  if(!sorted.length && search){
     tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><p>Aucun résultat pour cette recherche.</p></div></td></tr>`; return;
  }
  tbody.innerHTML=sorted.map(p=>{
    const cat=store.categories.find(c=>c.id===p.categoryId);
    const status=p.stock===0?['Rupture','badge-danger']:p.stock<=5?['Stock faible','badge-warning']:['En stock','badge-success'];
    return `<tr><td><strong>${p.name}</strong></td><td>${cat?cat.name:'—'}</td>
    <td class="font-mono" style="font-size:16px;font-weight:700">${p.stock}</td>
    <td><span class="badge ${status[1]}">${status[0]}</span></td>
    <td><button class="btn btn-sm btn-outline" onclick="openStockModal('${p.id}')">Ajuster</button></td></tr>`;
  }).join('');
}
function openStockModal(productId) {
  document.getElementById('stockProductId').value=productId;
  document.getElementById('stockQty').value=1;
  document.getElementById('stockOperation').value='add';
  const p=store.products.find(p=>p.id===productId);
  document.getElementById('stockModalTitle').textContent=`Stock : ${p?.name||''}`;
  openModal('stockModal');
}
async function applyStockAdjustment() {
  const pid=document.getElementById('stockProductId').value;
  const op=document.getElementById('stockOperation').value;
  const qty=parseInt(document.getElementById('stockQty').value)||0;
  if(qty<=0) return toast('Quantité invalide','error');
  const p=store.products.find(p=>p.id===pid);
  if(op==='remove'&&p&&p.stock<qty) return toast('Stock insuffisant','error');
  const delta=op==='add'?qty:-qty;
  if(IS_ELECTRON){ const res = await window.electronAPI.updateStock(pid, delta, currentUser?.username); if(!res.ok) return toast('Erreur: '+res.error,'error'); await loadFromDB(); }
  else { const i=store.products.findIndex(p=>p.id===pid); if(i>=0) store.products[i].stock+=delta; saveStore(); }
  toast(op==='add'?`+${qty} unités ajoutées`:`−${qty} unités retirées`,op==='add'?'success':'warning');
  closeModal('stockModal'); renderStock(); checkLowStock();
}
function checkLowStock() {
  // Les alertes sont déjà visibles via les badges et la bannière de la section Stock.
  // Suppression des toasts automatiques pour éviter l'avalanche de messages.
}

// ─── SALES ────────────────────────────────────────────────────
let saleItemsData=[];
let posActiveCategory = '';

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playScanBeep(type = 'success') {
  const toggle = document.getElementById('posSoundToggle');
  if (toggle && !toggle.checked) return; // Son désactivé
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
  } else {
      osc.type = 'square';
      osc.frequency.setValueAtTime(2500, audioCtx.currentTime); 
      gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.1);
  }
}
function togglePosSound() {
  const toggle = document.getElementById('posSoundToggle');
  if (store.settings) {
    store.settings.posSound = toggle.checked;
    if (IS_ELECTRON && window.electronAPI) window.electronAPI.setSetting('posSound', toggle.checked);
    else saveStore();
  }
}

function openSaleModal(id=null) {
  const isAdmin = currentUser?.role === 'admin';
  if (id && !isAdmin) {
    return toast("Modification de vente interdite pour les employés.", 'error');
  }
  
  if (store.settings && store.settings.posSound !== undefined) {
    const toggle = document.getElementById('posSoundToggle');
    if (toggle) toggle.checked = !!store.settings.posSound;
  }

  saleItemsData=[];
  document.getElementById('saleId').value='';
  document.getElementById('saleClient').value='';
  document.getElementById('saleClientPhone').value='';
  document.getElementById('saleBarcodeInput').value='';
  document.getElementById('salePaymentMode').value='Espèces';
  document.getElementById('saleAmountPaid').value='';
  document.getElementById('saleDebtZone').style.display='none';
  document.getElementById('saleDebtToggleBtn').style.color='';
  document.getElementById('saleDebtToggleBtn').style.borderColor='';
  document.getElementById('saleDebtToggleBtn').innerHTML='<i class="fas fa-hand-holding-usd"></i> C\'est une dette';
  document.getElementById('saleDebtPreview').style.display='none';
  document.getElementById('saleModalTitle').textContent=id?'Modifier la vente':'Nouvelle vente';
  
  // POS Resets
  document.getElementById('posSearchInput').value = '';
  posActiveCategory = '';
  renderPosCategories();
  renderPosProducts();

  if(id){
    const s=store.sales.find(s=>s.id===id);
    if(s){
      document.getElementById('saleId').value=s.id;
      document.getElementById('saleClient').value=s.client;
      document.getElementById('saleClientPhone').value=s.clientPhone||'';
      document.getElementById('salePaymentMode').value=s.paymentMode||'Espèces';
      if(s.debt>0){
        document.getElementById('saleAmountPaid').value=s.amountPaid;
        document.getElementById('saleDebtZone').style.display='';
        document.getElementById('saleDebtToggleBtn').style.color='var(--danger)';
        document.getElementById('saleDebtToggleBtn').style.borderColor='var(--danger)';
        document.getElementById('saleDebtToggleBtn').innerHTML='<i class="fas fa-times-circle"></i> Annuler la dette';
      }
      saleItemsData=s.items.map(i=>({...i}));
    }
  }
  
  renderSaleItems(); 
  openModal('saleModal');
  setTimeout(() => document.getElementById('saleBarcodeInput')?.focus(), 300);
}

function renderPosCategories() {
  const c = document.getElementById('posCategoryChips');
  if(!c) return;
  const cats = store.categories || [];
  let html = `<button class="pos-chip ${posActiveCategory===''?'active':''}" onclick="setPosCategory('')">Tout</button>`;
  cats.forEach(cat => {
    html += `<button class="pos-chip ${posActiveCategory===cat.id?'active':''}" onclick="setPosCategory('${cat.id}')">${cat.name}</button>`;
  });
  c.innerHTML = html;
}

function setPosCategory(catId) {
  posActiveCategory = catId;
  renderPosCategories();
  renderPosProducts();
}

function filterPosProducts() {
  renderPosProducts();
}

function renderPosProducts() {
  const g = document.getElementById('posProductGrid');
  if(!g) return;
  const query = (document.getElementById('posSearchInput')?.value || '').toLowerCase();
  
  let prods = store.products;
  if(posActiveCategory) {
    prods = prods.filter(p => p.categoryId === posActiveCategory);
  }
  if(query) {
    prods = prods.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.barcode && p.barcode.includes(query)) ||
      p.price.toString().includes(query)
    );
  }
  
  if(prods.length === 0) {
    g.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 30px; color:var(--text3);">Aucun produit trouvé.</div>`;
    return;
  }
  
  g.innerHTML = prods.map(p => {
    const stockClass = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
    const stockText = p.stock === 0 ? 'Rupture' : p.stock;
    const imgHtml = p.image 
      ? `<img src="${p.image}" class="pos-card-img" alt="${p.name}">`
      : `<div class="pos-card-placeholder"><i class="fas fa-box"></i></div>`;
      
    return `
      <div class="pos-product-card" onclick="addPosItem('${p.id}')">
        <div class="pos-card-stock ${stockClass}">${stockText}</div>
        ${imgHtml}
        <div class="pos-card-title" title="${p.name}">${p.name}</div>
        <div class="pos-card-price">${fmt(p.price)}</div>
      </div>
    `;
  }).join('');
}

function addPosItem(productId) {
  const p = store.products.find(x => x.id === productId);
  if(!p) return;
  
  const existing = saleItemsData.find(i => i.productId === productId);
  const currentQty = existing ? existing.qty : 0;
  
  const saleId = document.getElementById('saleId').value;
  if (!saleId && currentQty >= p.stock) {
    playScanBeep('error');
    toast(`Stock insuffisant ! Il ne reste que ${p.stock} exemplaire(s).`, 'error');
    return;
  }
  
  if(existing) {
    existing.qty += 1;
  } else {
    saleItemsData.push({productId: p.id, qty: 1, price: p.price});
  }
  playScanBeep('success');
  renderSaleItems();
  
  // Re-focus barcode input to allow continuous typing/scanning
  const barcodeInput = document.getElementById('saleBarcodeInput');
  if(barcodeInput) barcodeInput.focus();
}

function removeSaleItem(idx) { 
  saleItemsData.splice(idx,1); 
  renderSaleItems(); 
  document.getElementById('saleBarcodeInput')?.focus();
}

function updatePosQty(idx, delta) {
  const item = saleItemsData[idx];
  const p = store.products.find(x => x.id === item.productId);
  let newQty = item.qty + delta;
  if (newQty < 1) newQty = 1;
  
  const saleId = document.getElementById('saleId').value;
  if (!saleId && p && newQty > p.stock) {
    playScanBeep('error');
    toast(`Stock insuffisant ! Il ne reste que ${p.stock} exemplaire(s).`, 'error');
    newQty = p.stock;
  }
  
  item.qty = newQty;
  renderSaleItems();
  document.getElementById('saleBarcodeInput')?.focus();
}

function setPosQty(idx, val) {
  const item = saleItemsData[idx];
  const p = store.products.find(x => x.id === item.productId);
  let newQty = parseInt(val) || 1;
  if(newQty < 1) newQty = 1;
  
  const saleId = document.getElementById('saleId').value;
  if (!saleId && p && newQty > p.stock) {
    playScanBeep('error');
    toast(`Stock insuffisant ! Il ne reste que ${p.stock} exemplaire(s).`, 'error');
    newQty = p.stock > 0 ? p.stock : 1;
  }
  
  item.qty = newQty;
  renderSaleItems();
  document.getElementById('saleBarcodeInput')?.focus();
}

function setPosPrice(idx, val) {
  const item = saleItemsData[idx];
  let newPrice = parseFloat(val) || 0;
  if(newPrice < 0) newPrice = 0;
  item.price = newPrice;
  renderSaleItems();
  document.getElementById('saleBarcodeInput')?.focus();
}

function renderSaleItems() {
  const c=document.getElementById('saleItems'); if(!c) return;
  if(saleItemsData.length === 0) {
    c.innerHTML = `<div style="text-align:center; padding: 20px; color:var(--text3); font-size:13px;"><i class="fas fa-shopping-cart fa-2x" style="margin-bottom:10px; opacity:0.5;"></i><br>Le panier est vide</div>`;
    updateSaleTotal();
    return;
  }
  
  c.innerHTML=saleItemsData.map((item,idx)=>{
    const p = store.products.find(x => x.id === item.productId);
    const name = p ? p.name : 'Produit inconnu';
    return `
    <div class="pos-item-row" style="align-items:flex-start;">
      <div class="pos-item-info" style="min-width:0; padding-top:4px;">
        <div class="pos-item-title" title="${name}" style="white-space:normal; line-height:1.2;">${name}</div>
      </div>
      <div class="pos-item-qty" style="margin-top:2px;">
        <button class="pos-qty-btn" onclick="updatePosQty(${idx}, -1)">–</button>
        <input type="number" class="pos-qty-input" value="${item.qty}" min="1" onchange="setPosQty(${idx}, this.value)">
        <button class="pos-qty-btn" onclick="updatePosQty(${idx}, 1)">+</button>
      </div>
      <div class="pos-item-price-edit" style="display:flex; flex-direction:column; align-items:flex-end; margin-top:2px;">
         <input type="number" class="pos-qty-input" style="width:75px; height:28px; font-weight:bold; text-align:right; font-size:13px; color:var(--primary); padding-right:4px;" value="${item.price}" min="0" onchange="setPosPrice(${idx}, this.value)" title="Prix unitaire">
         <div style="margin-top:4px; font-size:11px; color:var(--text3); font-weight:600;">
           Total: <span style="color:var(--text)">${fmt(item.qty * item.price)}</span>
         </div>
      </div>
      <button class="btn-icon danger" style="padding:4px 8px; margin-left:4px; margin-top:2px;" onclick="removeSaleItem(${idx})"><i class="fas fa-trash-alt"></i></button>
    </div>`;
  }).join('');
  updateSaleTotal();
}

function updateSaleTotal() {
  const total=saleItemsData.reduce((s,i)=>s+(i.qty*i.price),0);
  const el=document.getElementById('saleTotalDisplay'); if(el) el.textContent=fmt(total);
  updateSaleDebtPreview();
}

function updateSaleDebtPreview() {
  const total = saleItemsData.reduce((s,i)=>s+(i.qty*i.price),0);
  const zone = document.getElementById('saleDebtZone');
  if (!zone || zone.style.display === 'none') return; // pas de dette = pas d'apercu
  
  const amountPaidInput = document.getElementById('saleAmountPaid');
  const preview = document.getElementById('saleDebtPreview');
  let paid = parseFloat(amountPaidInput.value);
  if (isNaN(paid) || paid < 0) paid = 0;
  const debt = total - paid;
  if (debt > 0) {
    preview.style.display = 'block';
    preview.textContent = `→ Reste à payer (Dette) : ${fmt(debt)}`;
  } else if (debt < 0) {
    preview.style.display = 'block';
    preview.textContent = `→ Crédit à rendre : ${fmt(-debt)}`;
  } else {
    preview.style.display = 'none';
  }
}

function toggleSaleDebt() {
  const zone = document.getElementById('saleDebtZone');
  const btn = document.getElementById('saleDebtToggleBtn');
  if (!zone) return;
  const isOpen = zone.style.display !== 'none';
  if (isOpen) {
    zone.style.display = 'none';
    btn.style.color = '';
    btn.style.borderColor = '';
    btn.innerHTML = '<i class="fas fa-hand-holding-usd"></i> C\'est une dette';
    document.getElementById('saleAmountPaid').value = '';
    document.getElementById('saleDebtPreview').style.display = 'none';
  } else {
    zone.style.display = 'block';
    btn.style.color = 'var(--danger)';
    btn.style.borderColor = 'var(--danger)';
    btn.innerHTML = '<i class="fas fa-times-circle"></i> Annuler la dette';
    const sap = document.getElementById('saleAmountPaid');
    if(sap) sap.focus();
    updateSaleDebtPreview();
  }
}

let html5QrScanner = null;
let currentScannerTargetInputId = null;

async function startScanner(targetInputId) {
  currentScannerTargetInputId = targetInputId;
  openModal('scannerModal');
  
  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("reader");
  }

  const cameraSelect = document.getElementById('cameraSelect');
  const cameraSelectContainer = document.getElementById('cameraSelectContainer');
  
  try {
    const devices = await Html5Qrcode.getCameras();
    if (devices && devices.length > 0) {
      cameraSelect.innerHTML = '';
      devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.id;
        option.text = device.label || `Caméra ${index + 1}`;
        cameraSelect.appendChild(option);
      });
      
      if (devices.length > 1) {
        cameraSelectContainer.style.display = 'block';
      } else {
        cameraSelectContainer.style.display = 'none';
      }
      
      let deviceToUse = devices[0].id;
      const webcamKeywords = ['integrated', 'webcam', 'internal', 'usb', 'facetime', 'fujitsu', 'hp', 'lenovo', 'dell'];
      const phoneKeywords = ['phone', 'téléphone', 'link to windows', 'lien avec windows', 'ipvc', 'iriun', 'droidcam'];
      
      const bestWebcam = devices.find(d => {
        const label = d.label.toLowerCase();
        return webcamKeywords.some(k => label.includes(k)) && !phoneKeywords.some(k => label.includes(k));
      });
      
      if (bestWebcam) {
        deviceToUse = bestWebcam.id;
      } else {
        const nonPhone = devices.find(d => !phoneKeywords.some(k => d.label.toLowerCase().includes(k)));
        if (nonPhone) deviceToUse = nonPhone.id;
      }
      
      cameraSelect.value = deviceToUse;
      await runScanner(deviceToUse);
    } else {
      toast("Aucune caméra détectée", "error");
      closeModal('scannerModal');
    }
  } catch (err) {
    console.error("Erreur cameras:", err);
    toast("Erreur d'accès aux caméras", "error");
    closeModal('scannerModal');
  }
}

async function runScanner(deviceId) {
  if (html5QrScanner.isScanning) {
    await html5QrScanner.stop();
  }

  const qrCodeSuccessCallback = (decodedText, decodedResult) => {
    document.getElementById(currentScannerTargetInputId).value = decodedText;
    if (currentScannerTargetInputId === 'saleBarcodeInput') {
      scanBarcodeInSale({ key: 'Enter', target: document.getElementById(currentScannerTargetInputId), preventDefault: () => {} });
    }
    stopScanner();
    toast("Code détecté ✓", "success");
  };

  const config = { 
    fps: 30,
    qrbox: (viewfinderWidth, viewfinderHeight) => {
      return {
        width: Math.min(viewfinderWidth * 0.7, 550),
        height: Math.min(viewfinderHeight * 0.4, 350)
      };
    },
    experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE
    ]
  };

  await html5QrScanner.start(deviceId, config, qrCodeSuccessCallback);
}

async function changeCamera() {
  const deviceId = document.getElementById('cameraSelect').value;
  try {
    await runScanner(deviceId);
  } catch (err) {
    toast("Erreur lors du changement de caméra", "error");
  }
}

async function stopScanner() {
  if (html5QrScanner && html5QrScanner.isScanning) {
    try {
      await html5QrScanner.stop();
    } catch (err) {
      console.warn("Erreur arrêt scanner:", err);
    }
  }
  closeModal('scannerModal');
}

function scanBarcodeInSale(event) {
  if (event.key !== 'Enter') return;
  const input = document.getElementById('saleBarcodeInput');
  const code = input.value.trim();
  if (!code) return;
  const product = store.products.find(p => p.barcode === code);
  if (!product) {
    toast(`Code-barre non trouvé : ${code}`, 'error');
    input.value = '';
    return;
  }
  
  addPosItem(product.id);
  input.value = '';
  // Beep handled in addPosItem
  // toast(`${product.name} ajouté ✓`, 'success'); // Remove toast it's too noticeable for fast scanning
}
let isSavingSale = false;
async function saveSale() {
  if(isSavingSale) return;
  isSavingSale = true;
  try {
  const id=document.getElementById('saleId').value;
  const client = document.getElementById('saleClient').value.trim() || 'Client';
  const validItems=saleItemsData.filter(i=>i.productId&&i.qty>0);
  if(!validItems.length) return toast('Ajoutez au moins un produit','error');
  for(const item of validItems){
    const p=store.products.find(p=>p.id===item.productId); if(!p) continue;
    if(!id&&p.stock<item.qty) return toast(`Stock insuffisant : ${p.name}`,'error');
  }
  const total=validItems.reduce((s,i)=>s+i.qty*i.price,0);
  const clientPhone = document.getElementById('saleClientPhone').value.trim();
  const paymentMode = document.getElementById('salePaymentMode').value;
  // Si la zone dette est active, on lit le montant payé ; sinon paiement complet
  const debtZoneOpen = document.getElementById('saleDebtZone').style.display !== 'none';
  let amountPaid = debtZoneOpen ? (parseFloat(document.getElementById('saleAmountPaid').value) || 0) : total;
  const debt = Math.max(0, total - amountPaid);

  if(IS_ELECTRON){
    const saleData = {id, client, clientPhone, items:validItems, total, amountPaid, debt, paymentMode};
    const res=id ? await window.electronAPI.updateSale(saleData, currentUser?.username) : await window.electronAPI.insertSale(saleData, currentUser?.username);
    if(!res.ok) return toast('Erreur: '+res.error,'error');
    await loadFromDB();
    toast(id?'Vente mise à jour':'Vente enregistrée ✓');
    closeModal('saleModal'); renderSales(); updateCaisseBadge();
    if(!id) {
      // Notifications Windows
      if (debt > 0) {
        window.electronAPI.notify('Dette Client', `${client} doit encore ${formatPrice(debt)} GNF`);
      }
      validItems.forEach(item => {
        const p = store.products.find(x => x.id === item.productId);
        if (p && p.stock <= 2) {
          window.electronAPI.notify('Stock Faible !', `${p.name} : seulement ${p.stock} restant(s)`);
        }
      });
      printInvoice(res.data);
    }
  } else {
    if(id){
      const old=store.sales.find(s=>s.id===id);
      if(old) {
        old.items.forEach(oi=>{const pi=store.products.findIndex(p=>p.id===oi.productId);if(pi>=0)store.products[pi].stock+=oi.qty;});
        caisseBalance -= old.total;
      }
      validItems.forEach(item=>{const pi=store.products.findIndex(p=>p.id===item.productId);if(pi>=0)store.products[pi].stock-=item.qty;});
      const si=store.sales.findIndex(s=>s.id===id);
      store.sales[si]={...store.sales[si],client,items:validItems,total,date:new Date().toISOString()};
      caisseBalance += total; saveStore(); toast('Vente mise à jour'); closeModal('saleModal'); renderSales();
    } else {
      validItems.forEach(item=>{const pi=store.products.findIndex(p=>p.id===item.productId);if(pi>=0)store.products[pi].stock-=item.qty;});
      const newSale={id:genId('sale'),client,items:validItems,total,date:new Date().toISOString()};
      store.sales.push(newSale);
      caisseBalance+=total; saveStore(); toast('Vente enregistrée ✓'); closeModal('saleModal'); renderSales();
      printInvoice(newSale.id);
    }
    updateCaisseBadge();
  }
  checkLowStock();
  } finally {
    isSavingSale = false;
  }
}
function deleteSale(id) {
  confirmDelete('Supprimer cette vente ? Le stock sera restauré.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteSale(id, currentUser?.username); await loadFromDB(); updateCaisseBadge(); }
    else {
      const s=store.sales.find(s=>s.id===id);
      if(s){ s.items.forEach(item=>{const pi=store.products.findIndex(p=>p.id===item.productId);if(pi>=0)store.products[pi].stock+=item.qty;}); caisseBalance-=s.total; }
      store.sales=store.sales.filter(s=>s.id!==id); saveStore(); updateCaisseBadge();
    }
    renderSales(); toast('Vente supprimée','warning');
  });
}
function renderSales() {
  const tbody=document.getElementById('salesBody'); if(!tbody) return;
  const search=document.getElementById('salesSearch')?.value.toLowerCase()||'';
  const dateFrom=document.getElementById('salesDateFrom')?.value;
  const dateTo=document.getElementById('salesDateTo')?.value;
  const catId = document.getElementById('salesCatFilter')?.value;
  let sales = [...store.sales].filter(s => {
    let match = s.client.toLowerCase().includes(search);
    // Recherche par produit
    if (!match && search) {
      match = s.items.some(item => {
        const p = store.products.find(p => p.id === item.productId);
        return p?.name.toLowerCase().includes(search);
      });
    }
    // Filtre par catégorie
    if (catId) {
      const hasCat = s.items.some(item => {
        const p = store.products.find(p => p.id === item.productId);
        return p?.categoryId === catId;
      });
      match = match && hasCat;
    }

    if (dateFrom) { const d1 = new Date(dateFrom); d1.setHours(0, 0, 0, 0); match = match && new Date(s.date) >= d1; }
    if (dateTo) { const d2 = new Date(dateTo); d2.setHours(23, 59, 59, 999); match = match && new Date(s.date) <= d2; }
    return match;
  });
  
  // Pré-calcul des numéros de facture permanents (basé sur l'ordre chronologique ASC)
  const allSalesACS = [...store.sales].sort((a,b) => new Date(a.date) - new Date(b.date));
  const saleToNum = new Map();
  allSalesACS.forEach((s, idx) => saleToNum.set(s.id, idx + 1));

  sales.sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!sales.length){ tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-shopping-cart"></i></div><p>Aucune vente.</p></div></td></tr>`; return; }
  tbody.innerHTML=sales.map((s,i)=>{
    const summary=s.items.map(item=>{const p=store.products.find(p=>p.id===item.productId); return `${p?.name||'?'} ×${item.qty}`;}).join(', ');
    const debtBadge = s.debt > 0 ? `<br><span class="badge badge-danger" style="font-size:10px">Reste: ${fmt(s.debt)}</span>` : '';
    const whatsappBtn = s.clientPhone ? `<button class="btn-icon" style="color:#25D366; font-size:12px; font-weight:bold" onclick="sendWhatsAppReceipt('${s.id}')" title="WhatsApp (Texte)"><i class="fab fa-whatsapp"></i> TXT</button>
    <button class="btn-icon" style="color:#25D366; font-size:12px; font-weight:bold" onclick="sendWhatsAppReceiptPdf('${s.id}')" title="WhatsApp (PDF)"><i class="fab fa-whatsapp"></i> PDF</button>` : '';
    const settleDebtBtn = s.debt > 0 ? `<button class="btn-icon" onclick="settleDebt('${s.id}')" title="Solder la dette" style="color:var(--warning)"><i class="fas fa-hand-holding-usd"></i></button>` : '';
    
    const saleNum = saleToNum.get(s.id);
    return `<tr>
      <td class="font-mono text-muted">#${String(saleNum).padStart(4,'0')}</td>
      <td><strong>${s.client}</strong>${s.clientPhone?`<br><small class="text-muted">${s.clientPhone}</small>`:''}</td>
      <td class="text-muted" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${summary}</td>
      <td class="font-mono text-success"><strong>${fmt(s.total)}</strong>${debtBadge}</td>
      <td class="text-muted"><small>${s.paymentMode || 'Espèces'}</small><br>${fmtDate(s.date)}</td>
      <td><div class="actions-cell">
        ${whatsappBtn}
        ${hasPerm('canSettleDebt') ? settleDebtBtn : ''}
        <button class="btn-icon" onclick="printInvoice('${s.id}')" title="Facture"><i class="fas fa-print"></i></button>
        ${hasPerm('canEditHistory') ? `<button class="btn-icon" onclick="openSaleModal('${s.id}')" title="Modifier"><i class="fas fa-edit"></i></button>` : ''}
        ${hasPerm('canDeleteHistory') ? `<button class="btn-icon danger" onclick="deleteSale('${s.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div></td></tr>`;
  }).join('');
}

// ─── SALE HISTORY (READ ONLY) ─────────────────────────────────
function openSaleHistoryModal() {
  document.getElementById('saleHistorySearch').value = '';
  renderSaleHistory();
  openModal('saleHistoryModal');
}

function filterSaleHistory() {
  renderSaleHistory();
}

function renderSaleHistory() {
  const tbody = document.getElementById('saleHistoryBody');
  if (!tbody) return;
  const search = document.getElementById('saleHistorySearch').value.toLowerCase();
  
  // Sort sales by date DESC
  let sales = [...store.sales].sort((a,b) => new Date(b.date) - new Date(a.date));
  
  if (search) {
    sales = sales.filter(s => 
      s.client.toLowerCase().includes(search) || 
      fmtDate(s.date).includes(search) ||
      s.total.toString().includes(search)
    );
  }
  
  if (!sales.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-muted" style="text-align:center; padding:20px;">Aucune vente trouvée.</td></tr>`;
    return;
  }

  // Pre-calculate invoice numbers
  const allSalesACS = [...store.sales].sort((a,b) => new Date(a.date) - new Date(b.date));
  const saleToNum = new Map();
  allSalesACS.forEach((s, idx) => saleToNum.set(s.id, idx + 1));

  tbody.innerHTML = sales.map(s => {
    const num = saleToNum.get(s.id);
    return `<tr>
      <td class="font-mono text-muted">#${String(num).padStart(4,'0')}</td>
      <td><strong>${s.client}</strong></td>
      <td class="font-mono text-success">${fmt(s.total)}</td>
      <td class="text-muted"><small>${fmtDate(s.date)}</small></td>
      <td>
        <button class="btn btn-outline btn-sm" onclick="viewSaleDetails('${s.id}')">
          <i class="fas fa-eye"></i> Voir détails
        </button>
      </td>
    </tr>`;
  }).join('');
}

function viewSaleDetails(saleId) {
  const s = store.sales.find(x => x.id === saleId);
  if (!s) return;
  
  const header = document.getElementById('saleDetailHeader');
  const tbody = document.getElementById('saleDetailBody');
  
  header.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-weight:700; font-size:16px; color:var(--primary);">${s.client}</div>
        <div style="font-size:12px; color:var(--text3);">${fmtDate(s.date)} — ${s.paymentMode || 'Espèces'}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:11px; text-transform:uppercase; color:var(--text3);">Total Vente</div>
        <div style="font-size:18px; font-weight:800; color:var(--success);">${fmt(s.total)}</div>
      </div>
    </div>
  `;
  
  tbody.innerHTML = s.items.map(item => {
    const p = store.products.find(x => x.id === item.productId);
    const pName = p ? p.name : 'Produit inconnu';
    return `<tr>
      <td>${pName}</td>
      <td class="font-mono">${item.qty}</td>
      <td class="font-mono">${fmt(item.price)}</td>
      <td class="font-mono" style="font-weight:600;">${fmt(item.qty * item.price)}</td>
    </tr>`;
  }).join('');
  
  openModal('saleDetailViewModal');
}

async function sendWhatsAppReceipt(saleId) {
  const s = store.sales.find(x => x.id === saleId);
  if (!s || !s.clientPhone) return toast("Numéro de téléphone manquant", "warning");
  
  const appName = getAppName();
  let text = `*Reçu de vente — ${appName}*\n\n`;
  text += `Client : ${s.client}\n`;
  text += `Date : ${fmtDate(s.date)}\n`;
  text += `---------------------------\n`;
  
  s.items.forEach(item => {
    const p = store.products.find(x => x.id === item.productId);
    text += `- ${p?.name || 'Produit'} : ${item.qty} x ${fmt(item.price)} = ${fmt(item.qty * item.price)}\n`;
  });
  
  text += `---------------------------\n`;
  text += `*TOTAL : ${fmt(s.total)}*\n`;
  if (s.debt > 0) {
    text += `Payé : ${fmt(s.amountPaid)}\n`;
    text += `*Reste à payer : ${fmt(s.debt)}*\n`;
  }
  text += `\nMerci de votre confiance !`;
  
  const encoded = encodeURIComponent(text);
  const phone = s.clientPhone.replace(/\D/g, '');
  const finalPhone = (phone.length === 9) ? '221' + phone : phone; 

  // Vérifier si WhatsApp interne est connecté
  await checkWhatsAppStatus();
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.whatsappSend && isWhatsAppConnected) {
    window.electronAPI.whatsappSend({ phone: finalPhone, message: text });
    navigate('whatsapp');
  } else {
    window.open(`https://wa.me/${finalPhone}?text=${encoded}`, '_blank');
  }
}

async function sendWhatsAppReceiptPdf(saleId) {
  const s = store.sales.find(x => x.id === saleId);
  if (!s || !s.clientPhone) return toast("Numéro de téléphone manquant", "warning");

  const allSorted = [...store.sales].sort((a, b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === saleId);
  const num = String(idx + 1).padStart(5, '0');
  const rows=s.items.map(item=>{
    const p=store.products.find(p=>p.id===item.productId);
    return `<tr><td>${p?.name||'—'}</td><td style="text-align:center">${item.qty}</td><td style="text-align:right">${fmt(item.price)}</td><td style="text-align:right">${fmt(item.qty*item.price)}</td></tr>`;
  }).join('');
  const logo    = getAppLogo();
  const desc    = getAppDesc();
  const phoneApp = getAppPhone();
  const appName  = getAppName();

  const logoHtml  = logo    ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
  const descHtml  = desc    ? `<div style="font-size:12px;color:#444;margin-bottom:3px;">${desc}</div>` : '';
  const phoneHtml = phoneApp ? `<div style="font-size:12px;color:#555;">${phoneApp}</div>` : '';

  const debtRowHtml = s.debt > 0 ? `<tr style="color:#c0392b;"><td colspan="3" style="text-align:right;font-size:13px;">Reste à payer</td><td style="text-align:right;font-size:13px;font-weight:600;">${fmt(s.debt)}</td></tr>` : '';

  document.getElementById('printArea').innerHTML=`
    <div class="invoice-header-boxes">
      <div class="invoice-box invoice-box-company">
        ${logoHtml}
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${appName}</div>
        ${descHtml}${phoneHtml}
      </div>
      <div class="invoice-box invoice-box-client">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Facture</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;">N° ${num}</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;">${fmtDate(s.date)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Client</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px;">${s.client}</div>
      </div>
    </div>
    <table class="invoice-table">
      <thead><tr><th>Produit</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="invoice-total-row"><td colspan="3" style="text-align:right;font-weight:700;font-size:15px;">TOTAL</td><td style="text-align:right;font-weight:700;font-size:15px;">${fmt(s.total)}</td></tr>
        ${s.amountPaid < s.total ? `<tr><td colspan="3" style="text-align:right;font-size:13px;">Payé</td><td style="text-align:right;font-size:13px;">${fmt(s.amountPaid)}</td></tr>` : ''}
        ${debtRowHtml}
      </tbody>
    </table>
    <div class="invoice-footer">Merci pour votre achat — ${appName}</div>`;

  await checkWhatsAppStatus();
  toast('Génération de la facture PDF...', 'info');
  
  const phone = s.clientPhone.replace(/\D/g, '');
  const finalPhone = (phone.length === 9) ? '221' + phone : phone; 
  const msg = `Bonjour ${s.client},\nVoici votre facture N° ${num} en pièce jointe.\nMerci de votre achat. — ${getAppName()}`;
  const url = `https://wa.me/${finalPhone}?text=${encodeURIComponent(msg)}`;

  if (IS_ELECTRON && window.electronAPI && window.electronAPI.exportPdfHidden) {
    const filename = `Facture_${s.client.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
    // On utilise désormais le rendu de la fenêtre principale (null passé pour htmlContent)
    const res = await window.electronAPI.exportPdfHidden(filename, null);
    
    document.getElementById('printArea').innerHTML = ''; // Nettoyage après export

    if (res.ok) {
        if (window.electronAPI.whatsappSend && isWhatsAppConnected) {
          window.electronAPI.whatsappSend({ phone: finalPhone, message: msg });
          navigate('whatsapp'); // On bascule directement sur l'onglet !
        } else {
          window.open(url, '_blank');
        }
        // CORRECTION : use res.filePath instead of res.path
        window.electronAPI.showInFolder(res.filePath);
        toast('PDF généré ! Le dossier est ouvert. Glissez-le dans WhatsApp.', 'success');
    } else {
        toast('Erreur PDF: ' + res.error, 'error');
    }
  } else {
    document.getElementById('printArea').innerHTML = '';
    window.open(url, '_blank');
  }
}

function settleDebt(saleId) {
  const s = store.sales.find(x => x.id === saleId);
  if (!s || s.debt <= 0) return;

  document.getElementById('debtSaleId').value = saleId;
  document.getElementById('debtModalDesc').innerText = `Reste à payer par ${s.client} : ${fmt(s.debt)}`;
  const input = document.getElementById('debtAmountPaid');
  input.value = s.debt;
  input.max = s.debt;
  
  document.getElementById('debtModal').classList.add('open');
  input.focus();
}

async function confirmSettleDebt() {
  const saleId = document.getElementById('debtSaleId').value;
  const s = store.sales.find(x => x.id === saleId);
  if (!s || s.debt <= 0) return closeModal('debtModal');

  const amountStr = document.getElementById('debtAmountPaid').value;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) return toast("Montant invalide", "error");
  if (amount > s.debt) return toast(`Le montant saisi (${fmt(amount)}) dépasse la dette (${fmt(s.debt)}) !`, "error");

  const newPaid = s.amountPaid + amount;
  const newDebt = Math.max(0, s.total - newPaid);

  if (IS_ELECTRON) {
    // On réutilise updateSale mais avec les nouvelles valeurs de paiement
    const res = await window.electronAPI.updateSale({
      ...s,
      amountPaid: newPaid,
      debt: newDebt
    }, currentUser?.username);
    if (!res.ok) return toast("Erreur: " + res.error, "error");
    await loadFromDB();
  } else {
    const idx = store.sales.findIndex(x => x.id === saleId);
    store.sales[idx].amountPaid = newPaid;
    store.sales[idx].debt = newDebt;
    caisseBalance += amount;
    // Ajout transaction caisse
    store.caisseTransactions.push({
      id: genId('cai'), type: 'vente', label: `Versement dette — ${s.client}`,
      amount: amount, balanceAfter: caisseBalance, refId: saleId, date: new Date().toISOString()
    });
    saveStore();
  }
  
  toast(`Paiement de ${fmt(amount)} enregistré`, "success");
  closeModal('debtModal');
  renderSales();
  updateCaisseBadge();
}

function toggleTicketMode() {
  if (!store.settings) store.settings = {};
  // On s'assure de travailler sur un vrai booléen
  const current = String(store.settings.ticket_mode) === 'true';
  store.settings.ticket_mode = !current;
  
  if (IS_ELECTRON) {
    window.electronAPI.setSetting('ticket_mode', store.settings.ticket_mode);
  } else {
    saveStore();
  }
  updateTicketModeUI();
  toast(`Format ${store.settings.ticket_mode ? 'Ticket' : 'Standard'} activé`);
}

function updateTicketModeUI() {
  const btn = document.getElementById('btnToggleTicketMode');
  if (!btn) return;
  const isTicket = store.settings?.ticket_mode;
  btn.classList.toggle('active', !!isTicket);
  btn.innerHTML = `<i class="fas fa-receipt"></i> <span>Format: ${isTicket ? 'Tickets' : 'Standard'}</span>`;
  if (isTicket) {
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';
    btn.style.borderColor = 'var(--accent)';
  } else {
    btn.style.background = 'transparent';
    btn.style.color = 'var(--text2)';
    btn.style.borderColor = 'var(--border)';
  }
}

// ─── INVOICE PRINT ────────────────────────────────────────────
function printInvoice(saleId) {
  const s=store.sales.find(s=>s.id===saleId); if(!s) return;
  const allSorted = [...store.sales].sort((a, b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === saleId);
  const num = String(idx + 1).padStart(5, '0');
  
  const isTicketMode = store.settings?.ticket_mode;
  const printArea = document.getElementById('printArea');
  printArea.classList.toggle('ticket-mode', !!isTicketMode);

  const logo    = getAppLogo();
  const desc    = getAppDesc();
  const phone   = getAppPhone();
  const appName = getAppName();
  const address = getAppAddress();

  if (isTicketMode) {
    // FORMAT EXPERT POS 58mm (32 chars per line)
    const W = 32;
    const center = (t) => {
      const s = String(t).trim().toUpperCase();
      if(s.length >= W) return s.slice(0, W);
      const leftPad = Math.floor((W - s.length) / 2);
      return ' '.repeat(leftPad) + s;
    };
    const justify = (l, r) => {
      const left = String(l).trim().toUpperCase();
      const right = String(r).trim().toUpperCase();
      const spaces = W - left.length - right.length;
      if (spaces > 0) return left + ' '.repeat(spaces) + right;
      if (spaces === 0) return left + right;
      // Si trop long, on met le prix sur la ligne suivante aligné à droite
      return left + '\n' + ' '.repeat(W - right.length) + right;
    };

    const rows = s.items.map(item => {
      const p = store.products.find(p => p.id === item.productId);
      const name = p?.name || 'PRODUIT';
      const qtyLine = `${item.qty} X ${fmt(item.price)}`;
      const totalLine = fmt(item.qty * item.price);
      return `<tr><td style="white-space:pre; font-size:11px; line-height:1.2;">${name}\n${justify(qtyLine, totalLine)}</td></tr>`;
    }).join('');

    const header = `${center(appName)}\n${center(desc || '')}\n${center(address || '')}\n${center(phone || '')}`;
    const ticketInfo = `${center('TICKET N° ' + num)}\n${center(fmtDateTime(s.date))}`;

    printArea.innerHTML = `
      <div class="invoice-box" style="white-space:pre; font-size:11px; line-height:1.2; text-align:left;">
${header}
${'='.repeat(W)}
${ticketInfo}
${'='.repeat(W)}
<table class="invoice-table" style="width:100%">
  <tbody>
    ${rows}
    <tr class="invoice-total-row">
      <td style="white-space:pre; font-weight:bold; font-size:13px; padding-top:5px;">${justify('TOTAL', fmt(s.total))}</td>
    </tr>
    ${s.amountPaid < s.total ? `
      <tr><td style="padding-top:2px; font-size:11px;">${justify('PAYE', fmt(s.amountPaid))}</td></tr>
      <tr><td style="font-weight:bold; color:red; font-size:12px;">${justify('RESTE', fmt(s.debt))}</td></tr>
    ` : ''}
  </tbody>
</table>
${'-'.repeat(W)}
<div style="text-align:center; font-size:10px; margin-top:5px;">
  MERCI POUR VOTRE VISITE!<br>
  A BIENTOT CHEZ ${appName.toUpperCase()}
</div>
      </div>
    `;
  } else {
    // Format FACTURE STANDARD (A4)
    const rows=s.items.map(item=>{
      const p=store.products.find(p=>p.id===item.productId);
      return `<tr><td>${p?.name||'—'}</td><td style="text-align:center">${item.qty}</td><td style="text-align:right">${fmt(item.price)}</td><td style="text-align:right">${fmt(item.qty*item.price)}</td></tr>`;
    }).join('');

    const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
    const descHtml = desc ? `<div style="font-size:12px;color:#444;margin-bottom:3px;">${desc}</div>` : '';
    const phoneHtml = phone ? `<div style="font-size:12px;color:#555;">${phone}</div>` : '';

    const debtRow = s.debt > 0 ? `
      <tr style="color:#c0392b;">
        <td colspan="3" style="text-align:right;font-size:13px;border-top:1px solid #eee;">Reste à payer</td>
        <td style="text-align:right;font-size:13px;font-weight:600;border-top:1px solid #eee;">${fmt(s.debt)}</td>
      </tr>` : '';

    printArea.innerHTML=`
      <div class="invoice-header-boxes">
        <div class="invoice-box invoice-box-company">
          ${logoHtml}
          <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${appName}</div>
          ${descHtml}
          ${phoneHtml}
        </div>
        <div class="invoice-box invoice-box-client">
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Facture</div>
          <div style="font-size:18px;font-weight:700;margin-bottom:4px;">N° ${num}</div>
          <div style="font-size:12px;color:#555;margin-bottom:10px;">${fmtDate(s.date)}</div>
          <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Client</div>
          <div style="font-size:14px;font-weight:600;margin-top:3px;">${s.client}</div>
        </div>
      </div>
      <table class="invoice-table">
        <thead><tr><th>Produit</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
        <tbody>
          ${rows}
          <tr class="invoice-total-row">
            <td colspan="3" style="text-align:right;font-weight:700;font-size:15px;">TOTAL</td>
            <td style="text-align:right;font-weight:700;font-size:15px;">${fmt(s.total)}</td>
          </tr>
          ${s.amountPaid < s.total ? `<tr><td colspan="3" style="text-align:right;font-size:13px;">Payé</td><td style="text-align:right;font-size:13px;">${fmt(s.amountPaid)}</td></tr>` : ''}
          ${debtRow}
        </tbody>
      </table>
      <div class="invoice-footer">Merci pour votre achat — ${appName}</div>`;
  }

  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

// ─── QUOTES ───────────────────────────────────────────────────
let quoteItemsData=[];
let quotePosActiveCategory = '';

function openQuoteModal(id=null) {
  quoteItemsData=[];
  document.getElementById('quoteId').value='';
  document.getElementById('quoteClient').value='';
  document.getElementById('quoteClientPhone').value='';
  document.getElementById('quoteCustomName').value='';
  document.getElementById('quoteCustomPrice').value='';
  document.getElementById('quoteModalTitle').textContent=id?'Modifier le devis':'Nouveau devis';
  
  // POS Resets
  document.getElementById('quotePosSearchInput').value = '';
  quotePosActiveCategory = '';
  renderQuotePosCategories();
  renderQuotePosProducts();

  if(id){ 
    const q=store.quotes.find(q=>q.id===id); 
    if(q){ 
      document.getElementById('quoteId').value=q.id; 
      document.getElementById('quoteClient').value=q.client; 
      document.getElementById('quoteClientPhone').value=q.clientPhone||''; 
      quoteItemsData=q.items.map(i=>({...i, productName: i.productName || (store.products.find(p=>p.id===i.productId)?.name || '')})); 
    } 
  }
  
  renderQuoteItems(); 
  openModal('quoteModal');
}

function renderQuotePosCategories() {
  const c = document.getElementById('quotePosCategoryChips');
  if(!c) return;
  const cats = store.categories || [];
  let html = `<button class="pos-chip ${quotePosActiveCategory===''?'active':''}" onclick="setQuotePosCategory('')">Tout</button>`;
  cats.forEach(cat => {
    html += `<button class="pos-chip ${quotePosActiveCategory===cat.id?'active':''}" onclick="setQuotePosCategory('${cat.id}')">${cat.name}</button>`;
  });
  c.innerHTML = html;
}

function setQuotePosCategory(catId) {
  quotePosActiveCategory = catId;
  renderQuotePosCategories();
  renderQuotePosProducts();
}

function filterQuotePosProducts() {
  renderQuotePosProducts();
}

function renderQuotePosProducts() {
  const g = document.getElementById('quotePosProductGrid');
  if(!g) return;
  const query = (document.getElementById('quotePosSearchInput')?.value || '').toLowerCase();
  
  let prods = store.products;
  if(quotePosActiveCategory) {
    prods = prods.filter(p => p.categoryId === quotePosActiveCategory);
  }
  if(query) {
    prods = prods.filter(p => 
      p.name.toLowerCase().includes(query) || 
      (p.barcode && p.barcode.includes(query)) ||
      p.price.toString().includes(query)
    );
  }
  
  if(prods.length === 0) {
    g.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding: 30px; color:var(--text3);">Aucun produit trouvé.</div>`;
    return;
  }
  
  g.innerHTML = prods.map(p => {
    const stockClass = p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : '';
    const stockText = p.stock === 0 ? 'Rupture' : p.stock;
    const imgHtml = p.image 
      ? `<img src="${p.image}" class="pos-card-img" alt="${p.name}">`
      : `<div class="pos-card-placeholder"><i class="fas fa-box"></i></div>`;
      
    return `
      <div class="pos-product-card" onclick="addQuotePosItem('${p.id}')">
        <div class="pos-card-stock ${stockClass}">${stockText}</div>
        ${imgHtml}
        <div class="pos-card-title" title="${p.name}">${p.name}</div>
        <div class="pos-card-price">${fmt(p.price)}</div>
      </div>
    `;
  }).join('');
}

function addQuotePosItem(productId) {
  const p = store.products.find(x => x.id === productId);
  if(!p) return;
  
  const existing = quoteItemsData.find(i => i.productId === productId);
  if(existing) {
    existing.qty += 1;
  } else {
    quoteItemsData.push({productId: p.id, productName: p.name, qty: 1, price: p.price});
  }
  playScanBeep('success');
  renderQuoteItems();
}

function addCustomQuoteItem() {
  const nameInput = document.getElementById('quoteCustomName');
  const priceInput = document.getElementById('quoteCustomPrice');
  const name = nameInput.value.trim();
  const price = parseFloat(priceInput.value) || 0;
  
  if(!name) {
    toast("Le nom du produit libre est requis", "error");
    return;
  }
  
  quoteItemsData.push({productId: 'custom', productName: name, qty: 1, price: price });
  playScanBeep('success');
  renderQuoteItems();
  
  nameInput.value = '';
  priceInput.value = '';
  nameInput.focus();
}

function removeQuoteItem(idx) { 
  quoteItemsData.splice(idx,1); 
  renderQuoteItems(); 
}

function updateQuoteQty(idx, delta) {
  const item = quoteItemsData[idx];
  let newQty = item.qty + delta;
  if (newQty < 1) newQty = 1;
  item.qty = newQty;
  renderQuoteItems();
}

function setQuoteQty(idx, val) {
  const item = quoteItemsData[idx];
  let newQty = parseInt(val) || 1;
  if(newQty < 1) newQty = 1;
  item.qty = newQty;
  renderQuoteItems();
}

function setQuotePrice(idx, val) {
  const item = quoteItemsData[idx];
  let newPrice = parseFloat(val) || 0;
  if(newPrice < 0) newPrice = 0;
  item.price = newPrice;
  renderQuoteItems();
}

function setQuoteCustomName(idx, val) {
  const item = quoteItemsData[idx];
  if(item.productId !== 'custom') return;
  item.productName = val.trim();
}

function renderQuoteItems() {
  const c=document.getElementById('quoteItems'); if(!c) return;
  if(quoteItemsData.length === 0) {
    c.innerHTML = `<div style="text-align:center; padding: 20px; color:var(--text3); font-size:13px;"><i class="fas fa-shopping-cart fa-2x" style="margin-bottom:10px; opacity:0.5;"></i><br>Le devis est vide</div>`;
    updateQuoteTotal();
    return;
  }
  
  c.innerHTML = quoteItemsData.map((item,idx)=>{
    let titleHtml;
    if(item.productId === 'custom') {
      titleHtml = `<input type="text" class="form-input" style="width:100%; height:26px; padding:0 6px; font-weight:600; font-size:12px; border:1px solid var(--accent); color:var(--text);" value="${item.productName}" onchange="setQuoteCustomName(${idx}, this.value)" placeholder="Nom du produit libre">`;
    } else {
       const pName = item.productName || (store.products.find(x => x.id === item.productId)?.name || 'Produit inconnu');
       titleHtml = `<div class="pos-item-title" title="${pName}">${pName}</div>`;
    }
    
    return `
    <div class="pos-item-row" style="align-items:flex-start;">
      <div class="pos-item-info" style="min-width:0; padding-top:4px;">
        ${titleHtml}
      </div>
      <div class="pos-item-qty" style="margin-top:2px;">
        <button class="pos-qty-btn" onclick="updateQuoteQty(${idx}, -1)">–</button>
        <input type="number" class="pos-qty-input" value="${item.qty}" min="1" onchange="setQuoteQty(${idx}, this.value)">
        <button class="pos-qty-btn" onclick="updateQuoteQty(${idx}, 1)">+</button>
      </div>
      <div class="pos-item-price-edit" style="display:flex; flex-direction:column; align-items:flex-end; margin-top:2px;">
         <input type="number" class="pos-qty-input" style="width:75px; height:28px; font-weight:bold; text-align:right; font-size:13px; color:var(--primary); padding-right:4px;" value="${item.price}" min="0" onchange="setQuotePrice(${idx}, this.value)" title="Prix unitaire">
         <div style="margin-top:4px; font-size:11px; color:var(--text3); font-weight:600;">
           Total: <span style="color:var(--text)">${fmt(item.qty * item.price)}</span>
         </div>
      </div>
      <button class="btn-icon danger" style="padding:4px 8px; margin-left:4px; margin-top:2px;" onclick="removeQuoteItem(${idx})"><i class="fas fa-trash-alt"></i></button>
    </div>`;
  }).join('');
  updateQuoteTotal();
}

function updateQuoteTotal() {
  const total=quoteItemsData.reduce((s,i)=>s+(i.qty*i.price),0);
  const el=document.getElementById('quoteTotalDisplay'); if(el) el.textContent=fmt(total);
}
let isSavingQuote = false;
async function saveQuote() {
  if(isSavingQuote) return;
  isSavingQuote = true;
  try {
  const id=document.getElementById('quoteId').value;
  const client=document.getElementById('quoteClient').value.trim();
  const clientPhone=document.getElementById('quoteClientPhone').value.trim();
  if(!client) return toast('Le nom du client est requis','error');
  const validItems=quoteItemsData.filter(i=>i.productId&&i.qty>0&&(i.productId!=='custom'||i.productName.trim()!==''));
  if(!validItems.length) return toast('Ajoutez au moins un produit','error');
  const total=validItems.reduce((s,i)=>s+i.qty*i.price,0);
  if(IS_ELECTRON){ const res = await window.electronAPI.upsertQuote({id:id||undefined,client,clientPhone,items:validItems,total}, currentUser?.username); if(!res.ok) return toast('Erreur: '+res.error,'error'); await loadFromDB(); }
  else {
    if(id){ const qi=store.quotes.findIndex(q=>q.id===id); store.quotes[qi]={...store.quotes[qi],client,clientPhone,items:validItems,total}; }
    else store.quotes.push({id:genId('quote'),client,clientPhone,items:validItems,total,date:new Date().toISOString()});
    saveStore();
  }
  toast(id?'Devis mis à jour':'Devis créé'); closeModal('quoteModal'); renderQuotes();
  } finally {
    isSavingQuote = false;
  }
}
async function convertQuoteToSale(id) {
  const q=store.quotes.find(q=>q.id===id); if(!q) return;
  if(q.items.some(i=>i.productId==='custom')) return toast('Ce devis contient des produits libres et ne peut pas être converti directement en vente.','error');
  if(IS_ELECTRON){ const res = await window.electronAPI.convertQuoteToSale(id, currentUser?.username); if(!res.ok) return toast('Erreur: '+res.error,'error'); await loadFromDB(); updateCaisseBadge(); }
  else {
    for(const item of q.items){ const p=store.products.find(p=>p.id===item.productId); if(p&&p.stock<item.qty) return toast(`Stock insuffisant : ${p.name}`,'error'); }
    q.items.forEach(item=>{const pi=store.products.findIndex(p=>p.id===item.productId);if(pi>=0)store.products[pi].stock-=item.qty;});
    store.sales.push({id:genId('sale'),client:q.client,items:q.items,total:q.total,date:new Date().toISOString()});
    store.quotes=store.quotes.filter(q=>q.id!==id); caisseBalance+=q.total; saveStore(); updateCaisseBadge();
  }
  renderQuotes(); toast('Devis converti en vente'); checkLowStock();
}
function getQuotePrintHTML(q, num) {
  const rows = q.items.map(item => {
    const pName = item.productId === 'custom' ? item.productName : (store.products.find(p => p.id === item.productId)?.name || '—');
    return `<tr><td>${pName}</td><td style="text-align:center">${item.qty}</td><td style="text-align:right">${fmt(item.price)}</td><td style="text-align:right">${fmt(item.qty * item.price)}</td></tr>`;
  }).join('');

  const logo = getAppLogo();
  const desc = getAppDesc();
  const phone = getAppPhone();
  const address = getAppAddress();
  const appName = getAppName();

  const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
  const descHtml = desc ? `<div style="font-size:12px;color:#444;margin-bottom:3px;">${desc}</div>` : '';
  const phoneHtml = phone ? `<div style="font-size:12px;color:#555;">${phone}</div>` : '';
  const contactHtml = (phone || address) ? `<div style="font-size:12px;color:#666;line-height:1.4;margin-top:4px">${address ? address + '<br>' : ''}${phone}</div>` : '';

  return `
    <div class="invoice-header-boxes">
      <div class="invoice-box invoice-box-company">
        ${logoHtml}
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${appName}</div>
        ${descHtml}
        ${contactHtml}
      </div>
      <div class="invoice-box invoice-box-client">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Devis</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;">N° ${num}</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;">${fmtDate(q.date)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Client</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px;">${q.client}</div>
      </div>
    </div>
    <table class="invoice-table">
      <thead><tr><th>Produit</th><th>Qté</th><th>Prix unit.</th><th>Total</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="invoice-total-row">
          <td colspan="3" style="text-align:right;font-weight:700;font-size:15px;">TOTAL ESTIMÉ</td>
          <td style="text-align:right;font-weight:700;font-size:15px;">${fmt(q.total)}</td>
        </tr>
      </tbody>
    </table>
    <div class="invoice-footer">Devis valable 30 jours — ${appName}</div>`;
}

function printQuote(id) {
  const q = store.quotes.find(q => q.id === id); if (!q) return;
  const allSorted = [...store.quotes].sort((a, b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === id);
  const num = String(idx + 1).padStart(5, '0');
  document.getElementById('printArea').innerHTML = getQuotePrintHTML(q, num);
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}
function deleteQuote(id) {
  confirmDelete('Supprimer ce devis ? Il ira à la corbeille.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteQuote(id, currentUser?.username); await loadFromDB(); }
    else { store.quotes=store.quotes.filter(q=>q.id!==id); saveStore(); }
    renderQuotes(); toast('Devis supprimé','warning');
  });
}
function renderQuotes() {
  const tbody=document.getElementById('quotesBody'); if(!tbody) return;
  
  // Pré-calcul des numéros de devis permanents (ASC)
  const allQuotesASC = [...store.quotes].sort((a,b) => new Date(a.date) - new Date(b.date));
  const quoteToNum = new Map();
  allQuotesASC.forEach((q, idx) => quoteToNum.set(q.id, idx + 1));

  const sorted=[...store.quotes].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!sorted.length){ tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-file-invoice"></i></div><p>Aucun devis.</p></div></td></tr>`; return; }
  tbody.innerHTML=sorted.map((q,i)=>{
    const qNum = quoteToNum.get(q.id);
    return `<tr>
      <td class="font-mono text-muted">#${String(qNum).padStart(4,'0')}</td>
      <td><strong>${q.client}</strong></td>
      <td class="font-mono"><strong>${fmt(q.total)}</strong></td>
      <td class="text-muted">${fmtDate(q.date)}</td>
      <td><div class="actions-cell">
        <button class="btn btn-sm btn-outline" onclick="convertQuoteToSale('${q.id}')">→ Vente</button>
        ${q.clientPhone ? `<button class="btn-icon" style="color:#25D366; font-size:12px; font-weight:bold" onclick="shareQuoteWhatsAppText('${q.id}')" title="WhatsApp (Texte)"><i class="fab fa-whatsapp"></i> TXT</button>
        <button class="btn-icon" style="color:#25D366; font-size:12px; font-weight:bold" onclick="shareQuoteWhatsAppPdf('${q.id}')" title="WhatsApp (PDF)"><i class="fab fa-whatsapp"></i> PDF</button>` : ''}
        <button class="btn-icon" onclick="printQuote('${q.id}')" title="Imprimer / OBTENIR PDF"><i class="fas fa-print"></i></button>
        <button class="btn-icon" onclick="openQuoteModal('${q.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
        ${hasPerm('canDeleteHistory') ? `<button class="btn-icon danger" onclick="deleteQuote('${q.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div></td></tr>`;
  }).join('');
}

function shareQuoteWhatsAppText(id) {
  const q = store.quotes.find(q=>q.id===id); if(!q) return;
  if(!q.clientPhone) return toast('Aucun numéro WhatsApp pour ce client','warning');
  
  checkWhatsAppStatus().then(() => {
    const allSorted = [...store.quotes].sort((a, b) => new Date(a.date) - new Date(b.date));
    const idx = allSorted.findIndex(x => x.id === id);
    const num = String(idx + 1).padStart(5, '0');
    let text = `Bonjour ${q.client},\nVoici votre devis N° ${num} du ${fmtDate(q.date)} :\n\n`;
    q.items.forEach(item => {
      const pName = item.productId === 'custom' ? item.productName : (store.products.find(p=>p.id===item.productId)?.name||'Inconnu');
      text += `- ${item.qty}x ${pName} à ${fmt(item.price)} = ${fmt(item.qty*item.price)}\n`;
    });
    text += `\n*Total estimé : ${fmt(q.total)}*\n\nMerci de votre confiance. — ${getAppName()}`;
    const cleanPhone = q.clientPhone.replace(/[^0-9+]/g, '');
    if (IS_ELECTRON && window.electronAPI && window.electronAPI.whatsappSend && isWhatsAppConnected) {
      window.electronAPI.whatsappSend({ phone: cleanPhone, message: text });
      navigate('whatsapp');
    } else {
      const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
      window.open(url, '_blank');
    }
  });
}

async function shareQuoteWhatsAppPdf(id) {
  const q = store.quotes.find(q => q.id === id); if (!q) return;
  if (!q.clientPhone) return toast('Aucun numéro WhatsApp pour ce client', 'warning');

  await checkWhatsAppStatus();
  const allSorted = [...store.quotes].sort((a, b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === id);
  const num = String(idx + 1).padStart(5, '0');
  
  // On génère EXACTEMENT le même HTML que pour l'impression
  document.getElementById('printArea').innerHTML = getQuotePrintHTML(q, num);

  toast('Génération du devis PDF...', 'info');
  const cleanPhone = q.clientPhone.replace(/[^0-9+]/g, '');
  const msg = `Bonjour ${q.client},\nVoici votre devis N° ${num} en pièce jointe.\nMerci de votre confiance. — ${getAppName()}`;
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;

  if (IS_ELECTRON && window.electronAPI && window.electronAPI.exportPdfHidden) {
    const filename = `Devis_${q.client.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.pdf`;
    // On utilise désormais le rendu de la fenêtre principale (null passé pour htmlContent)
    const res = await window.electronAPI.exportPdfHidden(filename, null);
    
    document.getElementById('printArea').innerHTML = ''; // Nettoyage après export

    if (res.ok) {
      if (window.electronAPI.whatsappSend && isWhatsAppConnected) {
        window.electronAPI.whatsappSend({ phone: cleanPhone, message: msg });
        navigate('whatsapp');
      } else {
        window.open(url, '_blank');
      }
      // CORRECTION : use res.filePath instead of res.path
      window.electronAPI.showInFolder(res.filePath);
      toast('Devis PDF généré et dossier ouvert', 'success');
    } else {
      toast('Erreur PDF: ' + res.error, 'error');
    }
  } else {
    document.getElementById('printArea').innerHTML = '';
    window.open(url, '_blank');
  }
}

// ─── RETURNS ─────────────────────────────────────────────
function openReturnModal() {
  // Remplir la liste des ventes
  const sel = document.getElementById('returnSaleSelect');
  sel.innerHTML = '<option value="">-- Choisir une vente --</option>';
  const sorted = [...store.sales].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!sorted.length) { toast('Aucune vente trouvée. Enregistrez une vente avant de faire un retour.','warning'); return; }
  sorted.forEach((s,i)=>{
    const num = '#'+String(i+1).padStart(4,'0');
    sel.innerHTML += `<option value="${s.id}">${num} — ${s.client} (${fmtDate(s.date)}) — ${fmt(s.total)}</option>`;
  });
  document.getElementById('returnItemsSection').style.display='none';
  document.getElementById('returnReason').value='';
  openModal('returnModal');
}
function onReturnSaleChange() {
  const saleId = document.getElementById('returnSaleSelect').value;
  const section = document.getElementById('returnItemsSection');
  if(!saleId) { section.style.display='none'; return; }
  const sale = store.sales.find(s=>s.id===saleId);
  if(!sale) { section.style.display='none'; return; }
  const list = document.getElementById('returnItemsList');
  list.innerHTML = sale.items.map((item,idx)=>{
    const prod = store.products.find(p=>p.id===item.productId);
    const name = prod?.name || 'Produit supprimé';
    return `<div class="sale-item-row" style="align-items:center;gap:12px;margin-bottom:8px">
      <label class="switch-container">
        <label class="switch">
          <input type="checkbox" id="retChk_${idx}" value="${item.productId}">
          <span class="slider round"></span>
        </label>
        <span class="switch-label" style="flex:1;font-weight:600">${name}</span>
      </label>
      <span class="text-muted" style="font-size:13px">Acheté : ${item.qty}</span>
      <input type="number" id="retQty_${idx}" class="form-input" style="width:80px" min="1" max="${item.qty}" value="1" placeholder="Qté">
    </div>`;
  }).join('');
  section.style.display='';
}
let isSavingReturn = false;
async function saveReturn() {
  if(isSavingReturn) return;
  isSavingReturn = true;
  try {
  const saleId = document.getElementById('returnSaleSelect').value;
  if(!saleId) return toast('Sélectionnez une vente','error');
  const sale = store.sales.find(s=>s.id===saleId);
  if(!sale) return toast('Vente introuvable','error');
  const reason = document.getElementById('returnReason').value.trim();
  if(!reason) return toast('Motif requis','error');
  const items = [];
  sale.items.forEach((item,idx)=>{
    const chk = document.getElementById(`retChk_${idx}`);
    if(chk?.checked) {
      const qty = parseInt(document.getElementById(`retQty_${idx}`).value)||1;
      const maxQty = item.qty;
      items.push({productId:item.productId, qty:Math.min(qty,maxQty), price:item.price});
    }
  });
  if(!items.length) return toast('Sélectionnez au moins un produit','error');
  if(IS_ELECTRON){
    const res = await window.electronAPI.insertReturnItems({saleId, client:sale.client, items, reason}, currentUser?.username);
    if(!res.ok) return toast('Erreur: '+res.error,'error');
    await loadFromDB(); updateCaisseBadge();
  } else {
    items.forEach(item=>{
      const pi = store.products.findIndex(p=>p.id===item.productId);
      if(pi>=0) store.products[pi].stock += item.qty;
      const prod = pi>=0 ? store.products[pi] : null;
      const refundAmt = -(item.qty * (prod?.price||0));
      caisseBalance += refundAmt;
      store.returns.push({id:genId('ret'),client:sale.client,productId:item.productId,qty:item.qty,reason,date:new Date().toISOString()});
      store.caisseTransactions.push({id:genId('cai'),type:'retour',label:`Retour — ${sale.client}`,amount:refundAmt,balanceAfter:caisseBalance,date:new Date().toISOString()});
    });
    saveStore(); updateCaisseBadge();
  }
  toast(`Retour enregistré — ${items.length} produit(s)`,'success'); closeModal('returnModal'); renderReturns();
  } finally {
    isSavingReturn = false;
  }
}
function deleteReturn(id) {
  confirmDelete('Supprimer ce retour ? Le stock sera ajusté et l\'élément ira à la corbeille.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteReturn(id, currentUser?.username); await loadFromDB(); updateCaisseBadge(); }
    else { const r=store.returns.find(r=>r.id===id); if(r){const pi=store.products.findIndex(p=>p.id===r.productId);if(pi>=0)store.products[pi].stock-=r.qty;} store.returns=store.returns.filter(r=>r.id!==id); saveStore(); }
    renderReturns(); toast('Retour supprimé','warning');
  });
}
function renderReturns() {
  const tbody=document.getElementById('returnsBody'); if(!tbody) return;

  // Pré-calcul des numéros de retours permanents (ASC)
  const allReturnsASC = [...store.returns].sort((a,b) => new Date(a.date) - new Date(b.date));
  const returnToNum = new Map();
  allReturnsASC.forEach((r, idx) => returnToNum.set(r.id, idx + 1));

  const sorted=[...store.returns].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if(!sorted.length){ tbody.innerHTML=`<tr><td colspan="8"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-undo-alt"></i></div><p>Aucun retour.</p></div></td></tr>`; return; }
  tbody.innerHTML=sorted.map((r,i)=>{ 
    const rNum = returnToNum.get(r.id);
    const p=store.products.find(p=>p.id===r.productId); 
    const cash = r.cashRefunded > 0 ? `<div class="text-danger">-${fmt(r.cashRefunded)} (Cash)</div>` : '';
    const debt = r.debtReduced > 0 ? `<div class="text-warning">-${fmt(r.debtReduced)} (Dette)</div>` : '';
    return `<tr>
      <td class="font-mono text-muted">#${String(rNum).padStart(4,'0')}</td>
      <td><strong>${r.client}</strong></td>
      <td>${p?.name||'Produit supprimé'}</td>
      <td class="font-mono">${r.qty}</td>
      <td>${cash}${debt}${!cash && !debt ? '—' : ''}</td>
      <td class="text-muted">${r.reason}</td>
      <td class="text-muted">${fmtDate(r.date)}</td>
      <td><div class="actions-cell">
        <button class="btn-icon" onclick="printReturn('${r.id}')" title="Imprimer Bon de retour"><i class="fas fa-print"></i></button>
        ${hasPerm('canDeleteHistory') ? `<button class="btn-icon danger" onclick="deleteReturn('${r.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div></td>
    </tr>`; 
  }).join('');
}

// ─── EXPENSES ─────────────────────────────────────────────────
function checkExpenseVsCaisse() {
  const amount=parseFloat(document.getElementById('expenseAmount').value)||0;
  const warn=document.getElementById('expenseCaisseWarning');
  const btn=document.getElementById('expenseSaveBtn');
  if(amount>caisseBalance){
    warn.style.display=''; warn.textContent=`⚠ Ce montant (${fmt(amount)}) dépasse le solde de la caisse (${fmt(caisseBalance)}). Opération impossible.`;
    btn.disabled=true; btn.style.opacity='0.5';
  } else {
    warn.style.display='none'; btn.disabled=false; btn.style.opacity='';
  }
}
function openExpenseModal(id=null) {
  document.getElementById('expenseId').value=''; document.getElementById('expenseDesc').value='';
  document.getElementById('expenseAmount').value=''; document.getElementById('expenseCat').value='';
  document.getElementById('expenseDate').value=new Date().toISOString().split('T')[0];
  document.getElementById('expenseModalTitle').textContent=id?'Modifier la dépense':'Ajouter une dépense';
  document.getElementById('expenseCaisseWarning').style.display='none';
  document.getElementById('expenseSaveBtn').disabled=false;
  document.getElementById('expenseSaveBtn').style.opacity='';
  if(id){ const e=store.expenses.find(e=>e.id===id); if(e){ document.getElementById('expenseId').value=e.id; document.getElementById('expenseDesc').value=e.description; document.getElementById('expenseAmount').value=e.amount; document.getElementById('expenseCat').value=e.category||''; document.getElementById('expenseDate').value=e.date?.split('T')[0]||''; } }
  openModal('expenseModal');
}
let isSavingExpense = false;
async function saveExpense() {
  if(isSavingExpense) return;
  isSavingExpense = true;
  try {
  const id=document.getElementById('expenseId').value;
  const description=document.getElementById('expenseDesc').value.trim();
  const amount=parseFloat(document.getElementById('expenseAmount').value)||0;
  const category=document.getElementById('expenseCat').value.trim();
  const date=document.getElementById('expenseDate').value;
  if(!description) return toast('Description requise','error');
  if(amount<=0) return toast('Montant invalide','error');
  // Vérification caisse (seulement pour nouvelle dépense)
  if(!id && amount>caisseBalance) return toast(`Solde insuffisant en caisse (${fmt(caisseBalance)})`, 'error');
  if(IS_ELECTRON){ const res = await window.electronAPI.upsertExpense({id:id||undefined,description,amount,category,date}, currentUser?.username); if(!res.ok) return toast('Erreur: '+res.error,'error'); await loadFromDB(); updateCaisseBadge(); }
  else {
    if(id){ const i=store.expenses.findIndex(e=>e.id===id); store.expenses[i]={...store.expenses[i],description,amount,category,date}; }
    else { store.expenses.push({id:genId('exp'),description,amount,category,date:date||new Date().toISOString()}); caisseBalance-=amount; }
    saveStore(); updateCaisseBadge();
  }
  toast(id?'Dépense mise à jour':'Dépense ajoutée'); closeModal('expenseModal'); renderExpenses();
  } finally {
    isSavingExpense = false;
  }
}
function deleteExpense(id) {
  confirmDelete('Supprimer cette dépense ? Elle ira à la corbeille.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.deleteExpense(id, currentUser?.username); await loadFromDB(); updateCaisseBadge(); }
    else { const e=store.expenses.find(e=>e.id===id); if(e) caisseBalance+=e.amount; store.expenses=store.expenses.filter(e=>e.id!==id); saveStore(); updateCaisseBadge(); }
    renderExpenses(); toast('Dépense supprimée','warning');
  });
}
function renderExpenses() {
  const tbody=document.getElementById('expensesBody'); if(!tbody) return;

  // Pré-calcul des numéros de dépenses permanents (ASC)
  const allExpensesASC = [...store.expenses].sort((a,b) => new Date(a.date) - new Date(b.date));
  const expenseToNum = new Map();
  allExpensesASC.forEach((e, idx) => expenseToNum.set(e.id, idx + 1));

  const search=document.getElementById('expensesSearch')?.value.toLowerCase()||'';
  const sorted=[...store.expenses].filter(e=>e.description.toLowerCase().includes(search)).sort((a,b)=>new Date(b.date)-new Date(a.date));
  const info=document.getElementById('caisseExpenseInfo');
  if(info) info.textContent=`Solde caisse disponible : ${fmt(caisseBalance)}`;
  if(!sorted.length){ tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><div class="empty-state-icon">◌</div><p>Aucune dépense.</p></div></td></tr>`; return; }
  tbody.innerHTML=sorted.map((e,i)=>{
    const eNum = expenseToNum.get(e.id);
    return `<tr>
      <td class="font-mono text-muted">#${String(eNum).padStart(4,'0')}</td>
      <td><strong>${e.description}</strong></td>
      <td class="font-mono text-danger"><strong>${fmt(e.amount)}</strong></td>
      <td>${e.category?`<span class="badge badge-info">${e.category}</span>`:'—'}</td>
      <td class="text-muted">${fmtDate(e.date)}</td>
      <td><div class="actions-cell">
        <button class="btn-icon" onclick="printExpense('${e.id}')" title="Imprimer Reçu"><i class="fas fa-print"></i></button>
        ${e.category === 'Ajustement Caissier' ? '' : `<button class="btn-icon" onclick="openExpenseModal('${e.id}')"><i class="fas fa-edit"></i></button>`}
        ${hasPerm('canDeleteHistory') ? `<button class="btn-icon danger" onclick="deleteExpense('${e.id}')"><i class="fas fa-trash-alt"></i></button>` : ''}
      </div></td></tr>`;
  }).join('');
}

function printExpense(id) {
  const e = store.expenses.find(x => x.id === id); if (!e) return;
  const allSorted = [...store.expenses].sort((a,b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === id);
  const num = String(idx + 1).padStart(5, '0');
  
  const logo = getAppLogo();
  const appName = getAppName();
  const phone = getAppPhone();
  const address = getAppAddress();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
  const contactHtml = (phone || address) ? `<div style="font-size:12px;color:#666;line-height:1.4;margin-top:4px">${address ? address + '<br>' : ''}${phone}</div>` : '';

  document.getElementById('printArea').innerHTML = `
    <div class="invoice-header-boxes">
      <div class="invoice-box invoice-box-company">
        ${logoHtml}
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${appName}</div>
        ${contactHtml}
      </div>
      <div class="invoice-box invoice-box-client">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Reçu de dépense</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;">N° ${num}</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;">${fmtDate(e.date)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Catégorie</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px;">${e.category || 'Générale'}</div>
      </div>
    </div>
    <div style="margin:20px 0; border:1px solid #eee; padding:15px; border-radius:8px;">
      <div style="font-size:12px; color:#888; text-transform:uppercase; margin-bottom:5px;">Description</div>
      <div style="font-size:16px; font-weight:600; margin-bottom:15px;">${e.description}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #eee; padding-top:10px;">
        <span style="font-weight:700; font-size:18px;">MONTANT TOTAL</span>
        <span style="font-weight:700; font-size:22px; color:var(--danger);">${fmt(e.amount)}</span>
      </div>
    </div>
    <div class="invoice-footer">Document généré par ${appName}</div>`;
    
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) window.electronAPI.printPreview();
  else window.print();
}

function printReturn(id) {
  const r = store.returns.find(x => x.id === id); if (!r) return;
  const p = store.products.find(x => x.id === r.productId);
  const allSorted = [...store.returns].sort((a,b) => new Date(a.date) - new Date(b.date));
  const idx = allSorted.findIndex(x => x.id === id);
  const num = String(idx + 1).padStart(5, '0');
  
  const logo = getAppLogo();
  const appName = getAppName();
  const phone = getAppPhone();
  const address = getAppAddress();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
  const contactHtml = (phone || address) ? `<div style="font-size:12px;color:#666;line-height:1.4;margin-top:4px">${address ? address + '<br>' : ''}${phone}</div>` : '';

  const refundDetails = [];
  if (r.cashRefunded > 0) refundDetails.push(`Remboursement Espèces : ${fmt(r.cashRefunded)}`);
  if (r.debtReduced > 0) refundDetails.push(`Déduction Dette : ${fmt(r.debtReduced)}`);

  document.getElementById('printArea').innerHTML = `
    <div class="invoice-header-boxes">
      <div class="invoice-box invoice-box-company">
        ${logoHtml}
        <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:4px;">${appName}</div>
        ${contactHtml}
      </div>
      <div class="invoice-box invoice-box-client">
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Bon de retour</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:4px;">N° ${num}</div>
        <div style="font-size:12px;color:#555;margin-bottom:10px;">${fmtDate(r.date)}</div>
        <div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;">Client</div>
        <div style="font-size:14px;font-weight:600;margin-top:3px;">${r.client}</div>
      </div>
    </div>
    <table class="invoice-table" style="margin-top:20px;">
      <thead><tr><th>Produit</th><th>Quantité</th><th>Motif</th></tr></thead>
      <tbody>
        <tr>
          <td>${p?.name || 'Produit supprimé'}</td>
          <td style="text-align:center">${r.qty}</td>
          <td>${r.reason}</td>
        </tr>
      </tbody>
    </table>
    ${refundDetails.length ? `
    <div style="margin-top:15px; padding:10px; border:1px dashed #ccc; border-radius:5px; font-size:13px;">
      <strong>Détails du remboursement :</strong><br>
      ${refundDetails.join('<br>')}
    </div>` : ''}
    <div class="invoice-footer">Bon de retour — ${appName}</div>`;
    
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) window.electronAPI.printPreview();
  else window.print();
}
function renderDashboard() {
  const totalSales=store.sales.reduce((s,sale)=>s+sale.total,0);
  const totalExpenses=store.expenses.reduce((s,e)=>s+e.amount,0);
  
  let profitSurVentes = 0;
  store.sales.forEach(sale => {
    sale.items.forEach(item => {
      const p = store.products.find(prod => prod.id === item.productId);
      // Si le prix d'achat est connu, on calcule la marge réelle
      // Sinon on peut considérer par défaut une marge de 0 pour ne pas fausser le chiffre vers le haut
      if (p && p.purchasePrice > 0) {
        profitSurVentes += (item.price - p.purchasePrice) * item.qty;
      }
    });
  });
  
  const profit = profitSurVentes - totalExpenses;
  document.getElementById('stat-products').textContent=store.products.length;
  document.getElementById('stat-categories').textContent=store.categories.length;
  document.getElementById('stat-instock').textContent=store.products.filter(p=>p.stock>0).length;
  document.getElementById('stat-outstock').textContent=store.products.filter(p=>p.stock===0).length;
  document.getElementById('stat-sales').textContent=fmt(totalSales);
  document.getElementById('stat-expenses').textContent=fmt(totalExpenses);
  const gmEl = document.getElementById('stat-gross-margin');
  if(gmEl) gmEl.textContent = fmt(profitSurVentes);
  document.getElementById('stat-caisse').textContent=fmt(caisseBalance);
  renderDashboardCharts();
  renderActivityFeed();
  renderStockAlerts();
  renderStatistics();
  updateAuditUserSelect();
}

function renderStockAlerts() {
  const container = document.getElementById('dashboardStockAlerts');
  if(!container) return;
  
  // 1. Calcul de la vitesse de vente (15 derniers jours)
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  const recentSales = store.sales.filter(s => new Date(s.date) >= fifteenDaysAgo);
  const salesCount = {};
  recentSales.forEach(s => s.items.forEach(i => {
    salesCount[i.productId] = (salesCount[i.productId] || 0) + i.qty;
  }));

  const alerts = [];
  store.products.forEach(p => {
    const isOut = p.stock === 0;
    const soldIn15Days = salesCount[p.id] || 0;
    const dailyVelocity = soldIn15Days / 15;
    
    // Alerte si: rupture, seuil critique statique (<= 5), OU rupture prévue dans court délai (< 3 jours)
    let type = 'none';
    let msg = '';
    let daysLeft = Infinity;

    if (isOut) {
      type = 'danger';
      msg = 'Rupture immédiate';
    } else if (p.stock <= 5) {
      type = 'warning';
      msg = `${p.stock} restant(s) (Critique)`;
    } else if (dailyVelocity > 0) {
      daysLeft = p.stock / dailyVelocity;
      if (daysLeft < 3) {
        type = 'warning';
        msg = `Rupture estimée dans ${Math.ceil(daysLeft)} jour(s)`;
      }
    }

    if (type !== 'none') {
      alerts.push({ p, type, msg, isOut, daysLeft });
    }
  });

  // Trier: Ruptures d'abord, puis par urgence
  alerts.sort((a,b) => {
    if (a.isOut !== b.isOut) return a.isOut ? -1 : 1;
    return a.daysLeft - b.daysLeft;
  });

  if(!alerts.length) {
    container.innerHTML = `<div class="trash-empty-state" style="color:var(--success)"><i class="fas fa-check-circle"></i> Stock sain. Aucune rupture prévue.</div>`;
    return;
  }
  
  container.innerHTML = alerts.map(alt => {
    const isDanger = alt.type === 'danger';
    const cat = store.categories.find(c => c.id === alt.p.categoryId)?.name || 'Sans catégorie';
    return `
      <div class="activity-item" style="border-left-color:${isDanger ? 'var(--danger)' : 'var(--warning)'};cursor:pointer" onclick="navigate('stock'); setTimeout(()=>document.getElementById('section-stock').scrollIntoView(), 100)">
        <div class="activity-icon" style="color:${isDanger ? 'var(--danger)' : 'var(--warning)'}; background:${isDanger ? 'var(--danger-light)' : 'var(--warning-light)'}">
          <i class="fas ${isDanger ? 'fa-times-circle' : 'fa-chart-line'}"></i>
        </div>
        <div class="activity-text">
          <strong>${alt.p.name}</strong> <span class="text-muted">(${cat})</span>
        </div>
        <div class="activity-time" style="color:${isDanger ? 'var(--danger)' : 'var(--warning)'}; font-weight:700; font-size:13px">
          ${alt.msg}
        </div>
      </div>
    `;
  }).join('');
}
let currentAuditFilter = 'all';
let auditUserFilter = 'all';

function filterAuditLog(mode, btn) {
  currentAuditFilter = mode;
  auditUserFilter = mode === 'me' ? (currentUser?.username || 'all') : 'all';
  
  const select = document.getElementById('auditUserSelect');
  if (select) {
    select.value = auditUserFilter;
    // Si on clique sur "Mes actions" ou "Tout", on synchronise le select
  }

  document.querySelectorAll('#auditLogFilters .btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderActivityFeed();
}

function filterAuditLogByUser(username) {
  auditUserFilter = username;
  
  // Synchroniser les boutons
  const btnAll = document.getElementById('btnFilterAll');
  const btnMe = document.getElementById('btnFilterMe');
  document.querySelectorAll('#auditLogFilters .btn').forEach(b => b.classList.remove('active'));
  
  if (username === 'all') {
    if (btnAll) btnAll.classList.add('active');
    currentAuditFilter = 'all';
  } else if (currentUser && username === currentUser.username) {
    if (btnMe) btnMe.classList.add('active');
    currentAuditFilter = 'me';
  }
  
  renderActivityFeed();
}

async function updateAuditUserSelect() {
  const select = document.getElementById('auditUserSelect');
  if (!select) return;

  const isAdmin = currentUser?.role === 'admin';
  select.style.display = isAdmin ? 'block' : 'none';
  
  if (!isAdmin) return;

  // Récupérer la liste des utilisateurs pour remplir le select
  const res = await window.electronAPI.getUsers();
  const users = res.data || [];
  
  let html = `<option value="all">Tous les utilisateurs</option>`;
  users.forEach(u => {
    html += `<option value="${u.username}">${u.username}</option>`;
  });
  
  select.innerHTML = html;
  select.value = auditUserFilter;
}

function renderActivityFeed() {
  const feed=document.getElementById('activityFeed'); if(!feed) return;
  
  let logs = [...store.auditLog];
  
  // Filtrage par utilisateur
  if (auditUserFilter !== 'all') {
    logs = logs.filter(log => log.username === auditUserFilter);
  }
  
  if(!logs.length){ feed.innerHTML=`<div class="empty-state"><p>Aucune activité enregistrée.</p></div>`; return; }
  
  const iconMap={
    SALE:'<i class="fas fa-coins"></i>', RETURN:'<i class="fas fa-undo"></i>',
    CREATE:'<i class="fas fa-plus"></i>', UPDATE:'<i class="fas fa-edit"></i>',
    DELETE:'<i class="fas fa-trash"></i>', STOCK_UPDATE:'<i class="fas fa-warehouse"></i>',
    STOCK_SET:'<i class="fas fa-warehouse"></i>', CONVERT:'<i class="fas fa-exchange-alt"></i>',
    RESTORE:'<i class="fas fa-undo"></i>', UPSERT:'<i class="fas fa-edit"></i>',
    CAISSE_ENTREE:'<i class="fas fa-arrow-up"></i>', CAISSE_SORTIE:'<i class="fas fa-arrow-down"></i>',
    EMPTY_TRASH:'<i class="fas fa-trash-alt"></i>'
  };

  const actionLabels={
    SALE:'Vente', RETURN:'Retour', CREATE:'Création', UPDATE:'Modification',
    DELETE:'Suppression', STOCK_UPDATE:'Stock +', STOCK_SET:'Stock Fixé',
    CONVERT:'Conversion', RESTORE:'Restauration', UPSERT:'Mise à jour',
    CAISSE_ENTREE:'Entrée Caisse', CAISSE_SORTIE:'Sortie Caisse', EMPTY_TRASH:'Corbeille Vidée'
  };

  const entityLabels={
    product:'Produit', category:'Catégorie', sale:'Vente', quote:'Devis',
    expense:'Dépense', caisse_transaction:'Caisse', trash:'Corbeille',
    user:'Compte', return: 'Retour'
  };

  feed.innerHTML=logs.map(log=>{
    const action = actionLabels[log.action] || log.action;
    const entity = entityLabels[log.entity] || log.entity;
    const userDisplay = log.username ? ` — Par <strong>${log.username}</strong>` : '';
    
    return `
    <div class="activity-item">
      <div class="activity-icon">${iconMap[log.action]||'<i class="fas fa-circle"></i>'}</div>
      <div class="activity-text">
        <strong>${action}</strong> ${entity} ${log.details?`<span class="text-muted">(${log.details})</span>`:''}
        ${userDisplay}
      </div>
      <div class="activity-time">${fmtDateTime(log.createdAt)}</div>
    </div>`;
  }).join('');
}


function ecDestroy(id){ const el=document.getElementById(id); if(el){ const inst=echarts.getInstanceByDom(el); if(inst) inst.dispose(); } }
function ecInit(id){ const el=document.getElementById(id); if(!el) return null; ecDestroy(id); return echarts.init(el); }
function ecTextColor(){ return document.documentElement.getAttribute('data-theme')==='dark'?'#a8a89e':'#5a5a54'; }
function ecGridColor(){ return document.documentElement.getAttribute('data-theme')==='dark'?'#2d2e28':'#e8e6df'; }

function renderDashboardCharts() {
  const tc=ecTextColor(), gc=ecGridColor();
  const last7=getLast7DaysSales();
  const c1=ecInit('salesChart');
  if(c1) c1.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:last7.labels,axisLabel:{color:tc},splitLine:{lineStyle:{color:gc}}},yAxis:{type:'value',axisLabel:{color:tc},splitLine:{lineStyle:{color:gc}}},series:[{name:'Ventes',type:'line',data:last7.values,smooth:true,areaStyle:{color:'rgba(45,90,39,0.12)'},lineStyle:{color:'#2d5a27'},itemStyle:{color:'#2d5a27'}}]});
  const topProds=getTopProducts(5);
  const c2=ecInit('topProductsChart');
  if(c2&&topProds.labels.length) c2.setOption({tooltip:{trigger:'item'},legend:{bottom:0,textStyle:{color:tc}},series:[{name:'Produits',type:'pie',radius:['40%','60%'],center:['50%','40%'],data:topProds.labels.map((n,i)=>({name:n,value:topProds.values[i]})),itemStyle:{borderWidth:2,borderColor:'var(--bg1)'},color:['#2d5a27','#5ab04e','#9ed49a','#d4780a','#e8961a']}]});
  const monthly=getLast12MonthsData();
  const c3=ecInit('salesVsExpensesChart');
  if(c3) c3.setOption({tooltip:{trigger:'axis'},legend:{top:0,textStyle:{color:tc}},xAxis:{type:'category',data:monthly.labels,axisLabel:{color:tc},splitLine:{lineStyle:{color:gc}}},yAxis:{type:'value',axisLabel:{color:tc},splitLine:{lineStyle:{color:gc}}},series:[{name:'Ventes',type:'line',smooth:true,data:monthly.sales,itemStyle:{color:'#2d5a27'},lineStyle:{width:3},areaStyle:{color:'rgba(45,90,39,0.08)'}},{name:'Dépenses',type:'line',smooth:true,data:monthly.expenses,itemStyle:{color:'#d4780a'},lineStyle:{width:3}}]});
}
function getLast7DaysSales(){
  const labels=[],values=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    labels.push(d.toLocaleDateString('fr-FR',{weekday:'short',day:'numeric'}));
    values.push(store.sales.filter(s=>new Date(s.date).toDateString()===d.toDateString()).reduce((sum,s)=>sum+s.total,0));
  }
  return{labels,values};
}
function getLast12MonthsData(){
  const labels=[],sales=[],expenses=[];
  const now = new Date();
  for(let i=11;i>=0;i--){
    const d=new Date(now.getFullYear(), now.getMonth()-i, 1);
    const m = d.getMonth();
    const y = d.getFullYear();
    labels.push(d.toLocaleDateString('fr-FR',{month:'short',year:'2-digit'}));
    
    // Ventes : filtrage robuste
    const monthlySales = store.sales.filter(s => {
      const sd = new Date(s.date);
      return sd.getMonth() === m && sd.getFullYear() === y;
    }).reduce((sum, s) => sum + (Number(s.total) || 0), 0);
    sales.push(monthlySales);
    
    // Dépenses : filtrage robuste (gère YYYY-MM-DD et ISO string)
    const monthlyExpenses = store.expenses.filter(e => {
      if (!e.date) return false;
      const dateStr = String(e.date);
      if (dateStr.length >= 7 && dateStr.includes('-')) {
        const parts = dateStr.split('-');
        const ey = parseInt(parts[0]);
        const em = parseInt(parts[1]) - 1;
        return ey === y && em === m;
      }
      const ed = new Date(e.date);
      return ed.getMonth() === m && ed.getFullYear() === y;
    }).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    expenses.push(monthlyExpenses);
  }
  return {labels, sales, expenses};
}
function getTopProducts(limit=5){
  const counts={};
  store.sales.forEach(s=>s.items.forEach(item=>{counts[item.productId]=(counts[item.productId]||0)+item.qty;}));
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  return{labels:sorted.map(([id])=>store.products.find(p=>p.id===id)?.name||'Inconnu'),values:sorted.map(([,v])=>v)};
}

// ─── REPORTS ──────────────────────────────────────────────────
function toggleCustomDates(){
  const p=document.getElementById('reportPeriod').value;
  const show=p==='custom';
  document.getElementById('reportFrom').style.display=show?'':'none';
  document.getElementById('reportTo').style.display=show?'':'none';
}
function getDateRange(period){
  const now=new Date(); let from,to;
  if(period==='all_time'){from=new Date(0);to=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59);}
  else if(period==='day'){from=new Date(now.getFullYear(),now.getMonth(),now.getDate());to=new Date(now.getFullYear(),now.getMonth(),now.getDate(),23,59,59);}
  else if(period==='week'){const day=now.getDay();from=new Date(now);from.setDate(now.getDate()-day);to=new Date(from);to.setDate(from.getDate()+6);}
  else if(period==='month'){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,0);}
  else{from=new Date(document.getElementById('reportFrom').value);to=new Date(document.getElementById('reportTo').value);to.setHours(23,59,59);}
  return{from,to};
}
function generateReport(){
  const type=document.getElementById('reportType').value;
  const period=document.getElementById('reportPeriod').value;
  const{from,to}=getDateRange(period);
  const todayExact = new Date().toLocaleDateString('fr-FR', {weekday:'long', day:'numeric', month:'long', year:'numeric'});
  const periodLabel = {all_time:'Depuis le début', day:"Aujourd'hui", week:'Cette semaine', month:'Ce mois', custom:`${fmtDate(from.toISOString())} → ${fmtDate(to.toISOString())}`}[period];
  const titles = {
    sales:'Rapport Ventes', expenses:'Rapport Dépenses', profit:'Rapport Bénéfices',
    profit_by_product: 'Rentabilité par Produit',
    products:'Produits vendus', returns:'Rapport Retours', products_list:'Liste des Produits en Stock',
    daily:'Rapport Journalier', caisse_total:'Rapport Caisse Global', stock_mouvements: 'Mouvements de Stock (Entrées)'
  };
  let html = `<div class="report-title">${titles[type] || type}</div>`;
  if (type === 'daily') html += `<div class="report-subtitle">${todayExact}</div>`;
  else if (type !== 'products_list' && type !== 'caisse_total') html += `<div class="report-subtitle">${periodLabel}</div>`;
  if(type==='sales'){
    const f=store.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to;});
    html+=`<div class="report-summary-grid"><div class="report-summary-card"><div class="rsv">${f.length}</div><div class="rsl">Ventes</div></div><div class="report-summary-card"><div class="rsv">${fmt(f.reduce((s,x)=>s+x.total,0))}</div><div class="rsl">Total</div></div></div>`;
    if(f.length) html+=`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Client</th><th>Total</th><th>Date</th></tr></thead><tbody>${f.map(s=>`<tr><td>${s.client}</td><td class="font-mono">${fmt(s.total)}</td><td>${fmtDate(s.date)}</td></tr>`).join('')}</tbody></table></div>`;
  } else if(type==='expenses'){
    const f=store.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;});
    html+=`<div class="report-summary-grid"><div class="report-summary-card"><div class="rsv">${f.length}</div><div class="rsl">Dépenses</div></div><div class="report-summary-card"><div class="rsv">${fmt(f.reduce((s,x)=>s+x.amount,0))}</div><div class="rsl">Total</div></div></div>`;
    if(f.length) html+=`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Description</th><th>Montant</th><th>Catégorie</th><th>Date</th></tr></thead><tbody>${f.map(e=>`<tr><td>${e.description}</td><td class="font-mono">${fmt(e.amount)}</td><td>${e.category||'—'}</td><td>${fmtDate(e.date)}</td></tr>`).join('')}</tbody></table></div>`;
  } else if(type==='profit'){
    const sales=store.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to;});
    const exps=store.expenses.filter(e=>{const d=new Date(e.date);return d>=from&&d<=to;});
    const tS=sales.reduce((s,x)=>s+x.total,0);
    const tE=exps.reduce((s,x)=>s+x.amount,0);
    
    let profitSurVentes = 0;
    sales.forEach(sale => {
      sale.items.forEach(item => {
        const p = store.products.find(prod => prod.id === item.productId);
        if (p && p.purchasePrice > 0) {
          profitSurVentes += (item.price - p.purchasePrice) * item.qty;
        }
      });
    });
    const netProfit = profitSurVentes - tE;

    html+=`<div class="report-summary-grid"><div class="report-summary-card"><div class="rsv">${fmt(tS)}</div><div class="rsl">Ventes</div></div><div class="report-summary-card"><div class="rsv">${fmt(tE)}</div><div class="rsl">Dépenses</div></div><div class="report-summary-card"><div class="rsv" style="color:${netProfit>=0?'var(--success)':'var(--danger)'}">${fmt(netProfit)}</div><div class="rsl">Bénéfice net</div></div></div>`;
  } else if(type==='profit_by_product'){
    const salesInRange = store.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to;});
    const stats = {};
    salesInRange.forEach(sale => {
      sale.items.forEach(item => {
        if(!stats[item.productId]) stats[item.productId] = { qty:0, revenue:0, cost:0 };
        const p = store.products.find(prod => prod.id === item.productId);
        stats[item.productId].qty += item.qty;
        stats[item.productId].revenue += item.qty * item.price;
        stats[item.productId].cost += item.qty * (p?.purchasePrice || 0);
      });
    });

    const results = Object.entries(stats).map(([pid, data]) => {
      const p = store.products.find(prod => prod.id === pid);
      const profit = data.revenue - data.cost;
      const marginPct = data.revenue > 0 ? (profit / data.revenue) * 100 : 0;
      return { id: pid, name: p?.name || 'Inconnu', qty: data.qty, revenue: data.revenue, cost: data.cost, profit, marginPct };
    }).sort((a,b) => b.profit - a.profit);

    // Stars & Dormants
    const stars = results.slice(0, 3);
    const dormantProducts = store.products.filter(p => !stats[p.id] && p.stock > 0).sort((a,b) => b.stock - a.stock);
    const displayedDormants = dormantProducts.slice(0, 20);

    html += `<div class="report-summary-grid">
      <div class="report-summary-card"><div class="rsv" style="color:var(--success); font-size:16px;">${stars[0]?.name || '—'}</div><div class="rsl"><i class="fas fa-star"></i> Meilleure Marge</div></div>
      <div class="report-summary-card"><div class="rsv">${dormantProducts.length}</div><div class="rsl"><i class="fas fa-bed"></i> Produits Sans Ventes</div></div>
    </div>`;

    html += `<h4 style="margin:20px 0 10px; font-weight:600;"><i class="fas fa-chart-line" style="color:var(--primary); margin-right:8px;"></i> Performance des Produits</h4>`;
    html += `<div class="table-wrapper"><table class="data-table"><thead><tr>
      <th>Produit</th><th class="text-right">Qté</th><th class="text-right">CA</th><th class="text-right">Marge Totale</th><th class="text-right">% Marge</th>
    </tr></thead><tbody>`;
    
    if (results.length === 0) {
      html += `<tr><td colspan="5" style="text-align:center; color:var(--text3); padding:30px;">Aucune vente enregistrée sur cette période.</td></tr>`;
    } else {
      results.forEach((r, idx) => {
        const isStar = idx < 3;
        const badge = isStar ? `<span class="badge" style="background:#d4af37; color:white; font-size:10px; margin-left:6px; vertical-align:middle;">TOP</span>` : '';
        const marginColor = r.marginPct > 30 ? 'var(--success)' : (r.marginPct > 15 ? 'var(--warning)' : 'var(--danger)');
        html += `<tr>
          <td><div style="display:flex; align-items:center;"><strong>${r.name}</strong>${badge}</div></td>
          <td class="text-right font-mono">${r.qty}</td>
          <td class="text-right font-mono">${fmt(r.revenue)}</td>
          <td class="text-right font-mono" style="font-weight:700; color:var(--num-color);">${fmt(r.profit)}</td>
          <td class="text-right font-mono"><span style="color:${marginColor}; font-weight:bold;">${r.marginPct.toFixed(1)}%</span></td>
        </tr>`;
      });
    }
    html += `</tbody></table></div>`;

    if (displayedDormants.length > 0) {
      html += `<h4 style="margin:30px 0 10px; font-weight:600;"><i class="fas fa-exclamation-triangle" style="color:var(--warning); margin-right:8px;"></i> Produits Dormants (En stock mais non vendus sur la période)</h4>`;
      html += `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Nom du Produit</th><th>Catégorie</th><th>Stock Actuel</th><th>Valeur Possible</th></tr></thead><tbody>`;
      displayedDormants.forEach(p => {
        const cat = store.categories.find(c => c.id === p.categoryId)?.name || '—';
        html += `<tr><td>${p.name}</td><td>${cat}</td><td class="font-mono">${p.stock}</td><td class="font-mono">${fmt(p.price * p.stock)}</td></tr>`;
      });
      html += `</tbody></table></div>`;
    }
  } else if(type==='products'){
    const sales=store.sales.filter(s=>{const d=new Date(s.date);return d>=from&&d<=to;});
    const counts={};
    sales.forEach(s=>s.items.forEach(i=>{counts[i.productId]=(counts[i.productId]||0)+i.qty;}));
    const rows=Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([pid,qty])=>{const p=store.products.find(p=>p.id===pid);return `<tr><td>${p?.name||'—'}</td><td class="font-mono">${qty}</td></tr>`;}).join('');
    html+=`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Produit</th><th>Qté vendue</th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="text-muted">Aucune donnée</td></tr>'}</tbody></table></div>`;
  } else if(type==='returns'){
    const f=store.returns.filter(r=>{const d=new Date(r.date);return d>=from&&d<=to;});
    html+=`<div class="report-summary-grid"><div class="report-summary-card"><div class="rsv">${f.length}</div><div class="rsl">Retours</div></div></div>`;
    if(f.length) html+=`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Client</th><th>Produit</th><th>Qté</th><th>Motif</th><th>Date</th></tr></thead><tbody>${f.map(r=>{const p=store.products.find(p=>p.id===r.productId);return `<tr><td>${r.client}</td><td>${p?.name||'—'}</td><td>${r.qty}</td><td>${r.reason}</td><td>${fmtDate(r.date)}</td></tr>`;}).join('')}</tbody></table></div>`;
  } else if(type==='products_list'){
    const totalValue = store.products.reduce((s,p)=>s+(p.price*p.stock),0);
    html+=`<div class="report-summary-grid"><div class="report-summary-card"><div class="rsv">${store.products.length}</div><div class="rsl">Total Produits</div></div><div class="report-summary-card"><div class="rsv">${fmt(totalValue)}</div><div class="rsl">Valeur du Stock</div></div></div>`;
    if(store.products.length) html+=`<div class="table-wrapper"><table class="data-table"><thead><tr><th>Nom</th><th>Catégorie</th><th>Prix</th><th>Stock</th><th>Valeur</th></tr></thead><tbody>${store.products.map(p=>{
      const cat=store.categories.find(c=>c.id===p.categoryId)?.name||'—';
      return `<tr><td>${p.name}</td><td>${cat}</td><td class="font-mono">${fmt(p.price)}</td><td class="font-mono">${p.stock}</td><td class="font-mono">${fmt(p.price*p.stock)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  } else if(type==='daily'){
    // ─── RAPPORT JOURNALIER ─────────────────────────────────────
    const today2 = new Date().toISOString().split('T')[0];
    const salesToday = store.sales.filter(s=>s.date.startsWith(today2));
    const expToday   = store.expenses.filter(e=>e.date.startsWith(today2));
    const retToday   = store.returns.filter(r=>r.date.startsWith(today2));
    const totalSales = salesToday.reduce((s,x)=>s+x.total, 0);
    const totalExp   = expToday.reduce((s,x)=>s+x.amount, 0);
    const totalRet   = retToday.reduce((s,x)=>s+(x.qty*(store.products.find(p=>p.id===x.productId)?.price||0)), 0);
    const soldeNet   = totalSales - totalExp - totalRet;

    // Produits vendus du jour (agrégés depuis ventes normales)
    const prodCounts = {};
    salesToday.forEach(s => s.items.forEach(i => {
      if(!prodCounts[i.productId]) prodCounts[i.productId]={qty:0,total:0};
      prodCounts[i.productId].qty += i.qty;
      prodCounts[i.productId].total += i.qty * i.price;
    }));
    // Dépôts directs (ventes sans items = entrées directes)
    const depotsDirect = salesToday.filter(s => !s.items || s.items.length === 0);

    html += `<div class="report-summary-grid">
      <div class="report-summary-card"><div class="rsv" style="color:var(--success)">${fmt(totalSales)}</div><div class="rsl">Total Ventes</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:var(--danger)">${fmt(totalExp)}</div><div class="rsl">Total Dépenses</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:var(--warning)">${fmt(totalRet)}</div><div class="rsl">Total Retours</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:${soldeNet>=0?'var(--success)':'var(--danger)'}">${fmt(soldeNet)}</div><div class="rsl">Solde Net du Jour</div></div>
    </div>`;

    // Tableau produits vendus
    const prodRows = Object.entries(prodCounts).map(([pid,v])=>{
      const p = store.products.find(x=>x.id===pid);
      return `<tr><td>${p?.name||'—'}</td><td class="font-mono">${v.qty}</td><td class="font-mono">${fmt(v.total)}</td></tr>`;
    }).join('');
    // Dépôts directs comme lignes supplémentaires
    const depotRows = depotsDirect.map(s => `<tr><td><em>${s.client||'Dépôt direct'}</em> <span class="badge badge-info" style="font-size:10px">Entrée directe</span></td><td class="font-mono">—</td><td class="font-mono caisse-amount-positive">+${fmt(s.total)}</td></tr>`).join('');
    html += `<h4 style="margin:16px 0 8px;font-weight:600;"><i class="fas fa-shopping-cart" style="color:var(--primary);margin-right:6px;"></i> Ventes & Entrées du jour</h4>`;
    html += (prodRows || depotRows)
      ? `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Produit / Libellé</th><th>Qté</th><th>Montant</th></tr></thead><tbody>${prodRows}${depotRows}</tbody></table></div>`
      : `<p class="text-muted">Aucune vente aujourd'hui.</p>`;

    // Tableau dépenses
    html += `<h4 style="margin:16px 0 8px;font-weight:600;"><i class="fas fa-wallet" style="color:var(--danger);margin-right:6px;"></i> Dépenses du jour</h4>`;
    html += expToday.length
      ? `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Description</th><th>Catégorie</th><th>Montant</th></tr></thead><tbody>${expToday.map(e=>`<tr><td>${e.description}</td><td>${e.category||'—'}</td><td class="font-mono caisse-amount-negative">-${fmt(e.amount)}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="text-muted">Aucune dépense aujourd'hui.</p>`;

    // Tableau retours
    html += `<h4 style="margin:16px 0 8px;font-weight:600;"><i class="fas fa-undo-alt" style="color:var(--warning);margin-right:6px;"></i> Retours clients du jour</h4>`;
    html += retToday.length
      ? `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Client</th><th>Produit</th><th>Qté</th><th>Motif</th></tr></thead><tbody>${retToday.map(r=>{const p=store.products.find(x=>x.id===r.productId);return `<tr><td>${r.client}</td><td>${p?.name||'—'}</td><td>${r.qty}</td><td>${r.reason||'—'}</td></tr>`;}).join('')}</tbody></table></div>`
      : `<p class="text-muted">Aucun retour aujourd'hui.</p>`;
  } else if (type === 'caisse_total') {
    // ─── RAPPORT CAISSE GLOBAL (pas de filtre date) ─────────────
    const totalV = store.sales.reduce((s,x)=>s+x.total, 0);
    const totalD = store.expenses.reduce((s,x)=>s+x.amount, 0);
    const solde  = caisseBalance;
    html += `<div class="report-summary-grid">
      <div class="report-summary-card"><div class="rsv" style="color:var(--success)">${fmt(totalV)}</div><div class="rsl"><i class="fas fa-arrow-up"></i> Total Ventes</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:var(--danger)">${fmt(totalD)}</div><div class="rsl"><i class="fas fa-arrow-down"></i> Total Dépenses</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:${solde>=0?'var(--success)':'var(--danger)'}">${fmt(solde)}</div><div class="rsl"><i class="fas fa-coins"></i> Solde Caisse</div></div>
      <div class="report-summary-card"><div class="rsv" style="color:var(--text1)">${store.sales.length}</div><div class="rsl">Nombre de ventes</div></div>
    </div>`;
  } else if (type === 'stock_mouvements') {
    const additions = store.auditLog.filter(l => {
      const d = new Date(l.createdAt);
      return d >= from && d <= to && 
             l.entity === 'product' && 
             (l.action === 'STOCK_UPDATE' || l.action === 'STOCK_SET' || l.action === 'CREATE');
    }).filter(l => {
      if (l.action === 'STOCK_UPDATE') {
        // Nouveau format: "Ajout de X" ou "Retrait de X"
        if (l.details.includes('Ajout de')) return true;
        
        // Ancien format: "delta 5"
        if (l.details.includes('delta ')) {
          const delta = parseInt(l.details.replace('delta ', '')) || 0;
          return delta > 0;
        }
        return false;
      }
      return true;
    });

    html += `<div class="table-wrapper"><table class="data-table"><thead><tr><th>Produit</th><th>Type</th><th>Stock avant</th><th>Ajout</th><th>Stock après</th><th>Date & Heure</th></tr></thead><tbody>`;
    if (additions.length) {
      html += additions.map(l => {
        const p = store.products.find(x => x.id === l.entityId);
        let qty = l.details;
        let prevStock = '—';
        let finalStock = '—';
        
        // Extraction (ex: "... — Ajout de 5 (Préc: 10, Total: 15)")
        const matchPrec = l.details.match(/Préc:\s*(.*?),/i) || l.details.match(/Prev:\s*(.*?),/i);
        if (matchPrec) prevStock = matchPrec[1].trim();
        
        const matchTotal = l.details.match(/\(?Total:\s*(.*?)\)/i);
        if (matchTotal) finalStock = matchTotal[1].trim();
        
        const ajoutMatch = l.details.match(/Ajout de\s*(\d+)/i);
        if (ajoutMatch) {
            qty = '+' + ajoutMatch[1];
        } else if (l.details.includes('delta ')) {
            const oldDeltaQty = l.details.split(' (')[0].replace('delta ', '');
            qty = '+' + oldDeltaQty;
        } else if (l.action === 'STOCK_SET' || l.details.includes('fixé à') || l.details.includes('Inventaire')) {
            const setMatch = l.details.match(/fixé à\s*(\d+)/i);
            qty = setMatch ? 'Ajusté à ' + setMatch[1] : 'Ajustement';
        } else if (l.action === 'CREATE' && finalStock !== '—') {
            qty = '+' + finalStock;
            prevStock = '0';
        }

        const typeStr = l.action === 'CREATE' ? 'Création' : (l.action === 'STOCK_SET' ? 'Ajustement' : 'Ajout');
        const pName = p ? p.name : (l.details.split(' — ')[0] || 'Produit inconnu/supprimé');
        
        return `<tr><td><strong>${pName}</strong></td><td>${typeStr}</td><td class="font-mono">${prevStock}</td><td class="font-mono" style="color:var(--success);font-weight:700;">${qty}</td><td class="font-mono">${finalStock}</td><td>${fmtDateTime(l.createdAt)}</td></tr>`;
      }).join('');
    } else {
      html += `<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px;">Aucun ajout de stock sur cette période.</td></tr>`;
    }
    html += `</tbody></table></div>`;
  }

  document.getElementById('reportOutput').innerHTML = html;
  
  // Boutons Actions (WhatsApp & Excel) après tout rapport généré
  const wa = document.getElementById('reportWaActions');
  if (wa) {
    wa.style.display = 'flex';
    // S'assurer que le bouton Excel contextuel est présent
    let excelBtn = document.getElementById('contextualExcelBtn');
    if (!excelBtn && IS_ELECTRON) {
      excelBtn = document.createElement('button');
      excelBtn.id = 'contextualExcelBtn';
      excelBtn.className = 'btn btn-sm btn-outline';
      excelBtn.style.color = '#27ae60';
      excelBtn.style.borderColor = '#27ae60';
      excelBtn.innerHTML = '<i class="fas fa-table"></i> Prévisualiser → Excel';
      excelBtn.onclick = previewAccountingExcel;
      wa.appendChild(excelBtn);
    }
  }
}

// ─── ENVOI RAPPORT VIA WHATSAPP ───────────────────────────────
let _reportWaMode = 'text';

function sendReportWhatsApp(mode) {
  const content = document.getElementById('reportOutput')?.innerText || '';
  if (!content.trim()) return toast("Générez d'abord un rapport", 'warning');
  _reportWaMode = mode;
  const input = document.getElementById('reportWaPhone');
  const err = document.getElementById('reportWaError');
  if (input) input.value = '';
  if (err) err.style.display = 'none';
  openModal('reportWaSendModal');
  setTimeout(() => document.getElementById('reportWaPhone')?.focus(), 120);
}

async function _doSendReportWa() {
  const input = document.getElementById('reportWaPhone');
  const err = document.getElementById('reportWaError');
  const raw = (input?.value || '').trim();
  const phoneNum = raw.replace(/\D/g, '');
  if (phoneNum.length < 7) {
    if (err) err.style.display = '';
    input?.focus();
    return;
  }
  if (err) err.style.display = 'none';
  closeModal('reportWaSendModal');

  const finalPhone = (phoneNum.length === 9) ? '221' + phoneNum : phoneNum;
  const contentEl = document.getElementById('reportOutput');
  const reportTitle = contentEl?.querySelector('.report-title')?.textContent || 'Rapport';
  const appName = getAppName();

  if (_reportWaMode === 'text') {
    let extractedText = `*${reportTitle} — ${appName}*\n\n`;
    
    // Période (si présente)
    const period = contentEl.querySelector('.report-subtitle')?.textContent?.trim();
    if (period) {
      extractedText += `${period}\n`;
    }
    extractedText += `---------------------------\n`;

    // Cartes de résumé
    const cards = contentEl.querySelectorAll('.report-summary-card');
    if (cards.length > 0) {
      cards.forEach(c => {
        const val = c.querySelector('.rsv')?.textContent?.trim() || '';
        const lbl = c.querySelector('.rsl')?.textContent?.trim() || '';
        // Nettoyage au cas où il y a des icônes dans le label (ex: "fa-arrow-up Total Ventes")
        const lblClean = lbl.replace(/^[^\wÀ-ÿ]+/, '').trim();
        if (val || lblClean) extractedText += `* ${lblClean} : ${val}\n`;
      });
      extractedText += `---------------------------\n`;
    }
    
    // Titres de section et Tableaux (dans l'ordre d'apparition)
    const elements = contentEl.querySelectorAll('h3, h4, .table-wrapper');
    elements.forEach(el => {
      if (el.tagName === 'H3' || el.tagName === 'H4') {
        extractedText += `*${el.textContent.trim()}*\n`;
      } else if (el.classList.contains('table-wrapper')) {
        const table = el.querySelector('table');
        if (table) {
          const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => 
            Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim())
          ).filter(cells => cells.length > 0);

          const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
          const allRows = headers.length > 0 ? [headers, ...rows] : rows;

          if (allRows.length > 0) {
            const colWidths = [];
            allRows.forEach(row => {
              row.forEach((cell, i) => {
                const len = (cell || '').length;
                if (!colWidths[i] || len > colWidths[i]) colWidths[i] = len;
              });
            });

            extractedText += "```\n";
            allRows.forEach((row, rowIndex) => {
              const paddedRow = row.map((cell, i) => (cell || '').padEnd(colWidths[i], ' ')).join(' | ');
              extractedText += `${paddedRow}\n`;
              if (rowIndex === 0 && headers.length > 0) {
                extractedText += row.map((_, i) => '-'.repeat(colWidths[i])).join('-+-') + '\n';
              }
            });
            extractedText += "```\n";
          }
        }
        extractedText += `---------------------------\n`;
      }
    });

    if (!extractedText.includes('---------------------------')) {
      // Fallback si l'extraction a échoué
      extractedText = contentEl.innerText.substring(0, 900);
    }
    const msgText = `${extractedText.substring(0, 900)}${extractedText.length > 900 ? '\n[...]' : ''}`;
    
    await checkWhatsAppStatus();
    if (IS_ELECTRON && window.electronAPI?.whatsappSend && isWhatsAppConnected) {
      window.electronAPI.whatsappSend({ phone: finalPhone, message: msgText });
      navigate('whatsapp');
    } else {
      const externalUrl = `https://wa.me/${finalPhone}?text=${encodeURIComponent(msgText)}`;
      window.open(externalUrl, '_blank');
    }
    toast('Message WhatsApp préparé ✓');

  } else {
    // Mode PDF : Génération masquée puis envoi WhatsApp
    toast('Génération du PDF...', 'info');
    const msgPdf = `Bonjour,\nVoici le ${reportTitle} en pièce jointe.\n— ${appName}`;
    
    if (IS_ELECTRON && window.electronAPI && window.electronAPI.exportPdfHidden) {
      const logo = getAppLogo();
      const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';
      const filename = `Rapport_${reportTitle.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      
      // On prépare EXACTEMENT la zone d'impression comme le fait le bouton Imprimer (printReport)
      document.getElementById('printArea').innerHTML = `
        <div style="padding:20px; font-family:sans-serif; background:white !important; color:black !important;">
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:20px; border-bottom:2px solid #2d5a27; padding-bottom:15px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${logoHtml}
              <div style="font-size:24px; font-weight:800; color:#1a1a1a;">${appName}</div>
            </div>
            <div></div> <!-- Espace vide pour remplacer le titre/contacts -->
          </div>
          <div style="margin:20px 0;">${contentEl.innerHTML}</div>
        </div>`;
      
      // On n'envoie PAS de chaîne htmlContent, ce qui oblige le process backend
      // à utiliser silencieusement mainWindow.webContents.printToPDF({ printBackground: true })
      // avec nos superbes styles CSS @media print activés automatiquement !
      const res = await window.electronAPI.exportPdfHidden(filename);
      if (res.ok) {
        await checkWhatsAppStatus();
        if (window.electronAPI.whatsappSend && isWhatsAppConnected) {
          window.electronAPI.whatsappSend({ phone: finalPhone, message: msgPdf });
          navigate('whatsapp');
        } else {
          window.open(`https://wa.me/${finalPhone}?text=${encodeURIComponent(msgPdf)}`, '_blank');
        }
        if (res.filePath) window.electronAPI.showInFolder(res.filePath);
        toast('PDF généré et WhatsApp ouvert ✓', 'success');
      } else {
        toast('Erreur PDF : ' + res.error, 'error');
      }
    } else {
      // Fallback navigateur classique
      printReport();
      setTimeout(() => {
        window.open(`https://wa.me/${finalPhone}?text=${encodeURIComponent(msgPdf)}`, '_blank');
      }, 800);
    }
  }
}

function printReport(){
  const content=document.getElementById('reportOutput').innerHTML;
  if(!content.trim()) return toast("Générez d'abord un rapport",'warning');
  
  const logo = getAppLogo();
  const appName = getAppName();
  const logoHtml = logo ? `<img src="${logo}" style="max-height:55px;max-width:150px;object-fit:contain;display:block;margin-bottom:6px;">` : '';

  document.getElementById('printArea').innerHTML=`
    <div style="padding:20px; font-family:sans-serif; background:white !important; color:black !important;">
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:20px; border-bottom:2px solid #2d5a27; padding-bottom:15px;">
        <div style="display:flex; align-items:center; gap:12px;">
          ${logoHtml}
          <div style="font-size:24px; font-weight:800; color:#1a1a1a;">${appName}</div>
        </div>
        <div></div> <!-- Espace vide -->
      </div>
      <div style="margin:20px 0;">${content}</div>
    </div>`;
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.printPreview) {
    window.electronAPI.printPreview();
  } else {
    window.print();
  }
}

async function previewAccountingExcel() {
  const period = document.getElementById('reportPeriod').value;
  const type = document.getElementById('reportType').value;
  const { from, to } = getDateRange(period);
  
  if (IS_ELECTRON && window.electronAPI && window.electronAPI.previewAccounting) {
    toast("Génération de l'aperçu Excel...", "info");
    try {
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      const res = await window.electronAPI.previewAccounting(from.toISOString(), to.toISOString(), type, theme);
      if (!res.ok) {
        toast("Erreur aperçu : " + res.error, "error");
      }
    } catch (err) {
      toast("Erreur système : " + err.message, "error");
    }
  } else {
    toast("L'aperçu Excel est uniquement disponible dans la version installée (Electron)", "warning");
  }
}

function updateEvolutionProductFilter() {
  const selects = ['saleEvolutionProductFilter', 'stockEvolutionProductFilter'];
  const sortedProds = [...store.products].sort((a,b) => a.name.localeCompare(b.name));
  
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const currentVal = el.value || 'all';
    let html = id === 'saleEvolutionProductFilter' 
      ? '<option value="all">Tous les produits (Chiffre d\'affaires)</option>'
      : '<option value="all">Tous les produits (Entrées totales)</option>';
      
    sortedProds.forEach(p => {
      html += `<option value="${p.id}">${p.name}</option>`;
    });
    el.innerHTML = html;
    el.value = currentVal;
  });
}

function renderSaleEvolutionChart() {
  const chart = ecInit('statEvolution');
  if (!chart) return;
  
  const tc = ecTextColor(), gc = ecGridColor();
  const productId = document.getElementById('saleEvolutionProductFilter')?.value || 'all';
  
  const labels = [];
  const values = [];
  const now = new Date();
  
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dStr = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    labels.push(dStr);
    
    let dailyTotal = 0;
    const dateQuery = d.toISOString().split('T')[0];
    const daySales = store.sales.filter(s => s.date.startsWith(dateQuery));
    
    if (productId === 'all') {
      dailyTotal = daySales.reduce((sum, s) => sum + (Number(s.total)||0), 0);
    } else {
      daySales.forEach(s => {
        if(s.items) {
          s.items.forEach(item => {
            if (item.productId === productId) {
              dailyTotal += (Number(item.qty)||0);
            }
          });
        }
      });
    }
    values.push(dailyTotal);
  }

  const seriesName = productId === 'all' ? 'Chiffre d\'affaires (FCFA)' : 'Quantité vendue';
  const color = productId === 'all' ? '#2d5a27' : '#d4780a';
  
  // Mise à jour du badge de stock actuel / total
  const badge = document.getElementById('saleEvolutionStockBadge');
  if (badge) {
    badge.style.display = 'inline-block';
    if (productId === 'all') {
      const totalStock = store.products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
      badge.innerHTML = `Stock total : <strong style="color:var(--primary)">${totalStock}</strong>`;
    } else {
      const p = store.products.find(x => x.id === productId);
      if (p) {
        badge.innerHTML = `Stock actuel : <strong style="color:var(--primary)">${p.stock}</strong>`;
      }
    }
  }

  chart.setOption({
    animationDuration: 1500,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', textStyle: { color: '#333' } },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { 
      type: 'category', 
      data: labels,
      axisLabel: { color: tc, rotate: 45, fontSize: 10 },
      axisLine: { lineStyle: { color: gc } }
    },
    yAxis: { 
      type: 'value',
      axisLabel: { color: tc },
      splitLine: { lineStyle: { color: gc, type: 'dashed' } }
    },
    series: [{
      name: seriesName,
      type: 'line',
      smooth: true,
      data: values,
      symbolSize: 6,
      lineStyle: { width: 4, color: color },
      itemStyle: { color: color },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: color + '66' },
            { offset: 1, color: color + '00' }
          ]
        }
      }
    }]
  });
}

function renderStockEvolutionChart() {
  const chart = ecInit('statStockEvolution');
  if (!chart) return;
  
  const tc = ecTextColor(), gc = ecGridColor();
  const productId = document.getElementById('stockEvolutionProductFilter')?.value || 'all';
  
  const labels = [];
  const values = [];
  const now = new Date();
  
  for (let i = 59; i >= 0; i--) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    const dateQuery = d.toISOString().split('T')[0];
    labels.push(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }));
    
    let dailyTotal = 0;
    const dayLogs = store.auditLog.filter(l => 
        l.createdAt.startsWith(dateQuery) && 
        l.entity === 'product' &&
        (productId === 'all' || l.entityId === productId)
    );
    
    dayLogs.forEach(l => {
      let delta = 0;
      if (l.action === 'STOCK_UPDATE') {
        const match = l.details.match(/delta (-?\d+)/);
        if (match) delta = parseInt(match[1]);
      } else if (l.action === 'STOCK_SET' || l.action === 'CREATE') {
        const matchPrev = l.details.match(/Prev: (\d+),/);
        const matchTotal = l.details.match(/Total: (\d+)\)/);
        if (matchPrev && matchTotal) {
          const dValue = parseInt(matchTotal[1]) - parseInt(matchPrev[1]);
          if (dValue > 0) delta = dValue;
        } else if (l.action === 'CREATE') {
          const matchTotalOnly = l.details.match(/Total: (\d+)\)/);
          if (matchTotalOnly) delta = parseInt(matchTotalOnly[1]);
        }
      }
      if (delta > 0) dailyTotal += delta;
    });
    values.push(dailyTotal);
  }

  const color = '#3498db';

  // Mise à jour du badge de stock actuel / total
  const badge = document.getElementById('stockEvolutionStockBadge');
  if (badge) {
    badge.style.display = 'inline-block';
    if (productId === 'all') {
      const totalStock = store.products.reduce((s, p) => s + (Number(p.stock) || 0), 0);
      badge.innerHTML = `Stock total : <strong style="color:var(--info)">${totalStock}</strong>`;
    } else {
      const p = store.products.find(x => x.id === productId);
      if (p) {
        badge.innerHTML = `Stock actuel : <strong style="color:var(--info)">${p.stock}</strong>`;
      }
    }
  }

  chart.setOption({
    animationDuration: 1500,
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.9)', textStyle: { color: '#333' } },
    grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { color: tc, rotate: 45, fontSize: 10 }, axisLine: { lineStyle: { color: gc } } },
    yAxis: { type: 'value', axisLabel: { color: tc }, splitLine: { lineStyle: { color: gc, type: 'dashed' } } },
    series: [{
      name: 'Entrées de stock',
      type: 'bar',
      data: values,
      itemStyle: { 
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#3498db' },
          { offset: 1, color: '#2980b9' }
        ]),
        borderRadius: [4, 4, 0, 0] 
      }
    }]
  });
}

// ─── AUDIT LOG ────────────────────────────────────────────────
const auditTranslations = {
  // Actions
  'SALE': 'Vente',
  'DELETE': 'Suppression',
  'UPDATE': 'Modification',
  'CREATE': 'Création',
  'STOCK_UPDATE': 'Stock +',
  'STOCK_SET': 'Stock Fixé',
  'CAISSE': 'Caisse',
  'CAISSE_ENTREE': 'Entrée Caisse',
  'CAISSE_SORTIE': 'Sortie Caisse',
  'RETURN': 'Retour',
  'LOGIN': 'Connexion',
  'TRASH_RESTORE': 'Restauration',
  'TRASH_EMPTY': 'Vidage Corbeille',
  'TRASH_DELETE': 'Suppression Déf.',
  'SETTINGS_UPDATE': 'Configuration',
  // Entities
  'product': 'Produit',
  'sale': 'Vente',
  'expense': 'Dépense',
  'category': 'Catégorie',
  'quote': 'Devis',
  'return': 'Retour',
  'app_settings': 'Paramètres App',
  'setting': 'Réglage',
  'user': 'Utilisateur',
  'customer_debt': 'Dette'
};

async function renderAuditLog() {
  const tbody = document.getElementById('auditLogBody');
  if (!tbody) return;

  const res = await window.electronAPI.getAuditLog();
  if (!res.ok) return toast('Erreur chargement audit', 'error');

  let logs = res.data || [];
  const search = document.getElementById('auditSearch')?.value.toLowerCase() || '';
  const actionFilter = document.getElementById('auditActionFilter')?.value || '';
  const userFilter = document.getElementById('auditUserFilter')?.value || '';

  // Population dynamique du filtre utilisateur (si vide)
  const userSelect = document.getElementById('auditUserFilter');
  if (userSelect && userSelect.options.length <= 1 && logs.length > 0) {
    const usernames = [...new Set(logs.map(l => l.username))].sort();
    usernames.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      userSelect.appendChild(opt);
    });
  }

  if (search) {
    logs = logs.filter(l => 
      (l.details||'').toLowerCase().includes(search) || 
      (l.username||'').toLowerCase().includes(search) || 
      (l.action||'').toLowerCase().includes(search) ||
      (l.entity||'').toLowerCase().includes(search)
    );
  }

  if (actionFilter) {
    logs = logs.filter(l => (l.action||'').includes(actionFilter));
  }
  if (userFilter) {
    logs = logs.filter(l => l.username === userFilter);
  }

  if (!logs.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text3)">Aucune activité trouvée pour ces critères.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    let details = l.details || '';
    // Traduction à la volée plus naturelle
    details = details.replace(/Prev:/gi, 'Préc:')
                     .replace(/Total:/gi, 'Total:')
                     .replace(/stock=/g, 'Fixé à ')
                     .replace(/(?:Écart|delta) (-?\d+)/gi, (m, n) => {
                       const v = parseInt(n);
                       return v >= 0 ? `Ajout de ${v}` : `Retrait de ${Math.abs(v)}`;
                     });
    
    // Si c'est un produit et qu'il n'y a pas encore de nom dans les détails (vieux logs)
    if (l.entity === 'product' && !details.includes(' — ')) {
      const p = (store.products||[]).find(prod => prod.id === l.entityId);
      if (p) details = `${p.name} — ${details}`;
    }

    const entityLabel = auditTranslations[l.entity] || l.entity;

    return `
      <tr>
        <td class="text-muted" style="white-space:nowrap">${fmtDateTime(l.createdAt)}</td>
        <td><span class="badge ${l.username === 'admin' ? 'success' : 'info'}">${l.username}</span></td>
        <td><span class="badge" style="background:var(--bg-alt); color:var(--text); border:1px solid var(--border)">${auditTranslations[l.action] || l.action}</span></td>
        <td>${entityLabel}</td>
        <td style="font-size:13px">${details}</td>
      </tr>`;
  }).join('');
}

// ─── STATISTICS ───────────────────────────────────────────────
function renderStatistics(){
  updateEvolutionProductFilter();
  renderSaleEvolutionChart();
  renderStockEvolutionChart();
  const tc=ecTextColor(), gc=ecGridColor();
  const pSales={};
  store.sales.forEach(s=>s.items.forEach(i=>{pSales[i.productId]=(pSales[i.productId]||0)+i.qty;}));
  const sorted=Object.entries(pSales).sort((a,b)=>b[1]-a[1]);
  const top5=sorted.slice(0,5), least5=sorted.slice(-5);
  const getName=id=>store.products.find(p=>p.id===id)?.name||'Inconnu';
  const axisOpt=(tc,gc)=>({axisLabel:{color:tc},splitLine:{lineStyle:{color:gc}}});
  const c1=ecInit('statTopSold');
  if(c1&&top5.length) c1.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:top5.map(([id])=>getName(id)),...axisOpt(tc,gc)},yAxis:{type:'value',...axisOpt(tc,gc)},series:[{name:'Qté vendue',type:'bar',data:top5.map(([,v])=>v),itemStyle:{color:'rgba(45,90,39,0.85)'}}]});
  const c2=ecInit('statLeastSold');
  if(c2&&least5.length) c2.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:least5.map(([id])=>getName(id)),...axisOpt(tc,gc)},yAxis:{type:'value',...axisOpt(tc,gc)},series:[{name:'Qté vendue',type:'bar',data:least5.map(([,v])=>v),itemStyle:{color:'rgba(212,120,10,0.85)'}}]});
  const monthly=getLast12MonthsData();
  const c3=ecInit('statRevenue');
  if(c3) c3.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:monthly.labels,...axisOpt(tc,gc)},yAxis:{type:'value',...axisOpt(tc,gc)},series:[{name:'Revenus',type:'line',data:monthly.sales,smooth:true,lineStyle:{color:'#2d5a27'},itemStyle:{color:'#2d5a27'}}]});
  const expCats={};
  store.expenses.forEach(e=>{const c=e.category||'Autre';expCats[c]=(expCats[c]||0)+e.amount;});
  const c4=ecInit('statExpenses');
  if(c4&&Object.keys(expCats).length) c4.setOption({tooltip:{trigger:'item'},legend:{bottom:0,textStyle:{color:tc}},series:[{name:'Dépenses',type:'pie',radius:'55%',center:['50%','45%'],data:Object.entries(expCats).map(([name,value])=>({name,value})),color:['#2d5a27','#5ab04e','#d4780a','#e8961a','#c0392b','#0d6efd']}]});
  const profit=monthly.sales.map((v,i)=>v-monthly.expenses[i]);
  const c5=ecInit('statProfit');
  if(c5) c5.setOption({tooltip:{trigger:'axis'},xAxis:{type:'category',data:monthly.labels,...axisOpt(tc,gc)},yAxis:{type:'value',...axisOpt(tc,gc)},series:[{name:'Profit',type:'bar',data:profit.map((v,i)=>({value:v,itemStyle:{color:v>=0?'rgba(45,90,39,0.85)':'rgba(192,57,43,0.85)'}})),itemStyle:{color:'#2d5a27'}}]});
}

// ─── MODULE VISIBILITY ────────────────────────────────────────
const ALL_MODULES = [
  'dashboard','caisse','products','categories','stock','sales',
  'quotes','returns','expenses','reports','whatsapp','audit'
];

function getModuleSettings() {
  try { return JSON.parse(localStorage.getItem('PHARMACIE_MODULES_VISIBILITY')) || {}; }
  catch(e) { return {}; }
}

function applyModuleVisibility() {
  const settings = getModuleSettings();
  ALL_MODULES.forEach(m => {
    const el = document.querySelector(`.nav-item[data-section="${m}"]`);
    if (!el) return;
    el.style.display = settings[m] === false ? 'none' : '';
  });
  // Redirect si la section courante est masquee
  if (getModuleSettings()[currentSection] === false) {
    const firstVisible = ALL_MODULES.find(m => getModuleSettings()[m] !== false);
    if (firstVisible) navigate(firstVisible);
  }
}

// ─── VÉRIFICATION MOT DE PASSE POUR ACTIONS SENSIBLES ─────────
let _passwordConfirmCallback = null;

function passwordConfirm(callback) {
  const loginPass = store.settings['PHARMACIE_LOGIN_PASSWORD'] || '';
  if (!loginPass || loginPass.trim() === '') {
    callback(); // Pas de mot de passe → exécuter directement
    return;
  }
  _passwordConfirmCallback = callback;
  const input = document.getElementById('passwordConfirmInput');
  const errMsg = document.getElementById('passwordConfirmError');
  if (input) input.value = '';
  if (errMsg) errMsg.style.display = 'none';
  openModal('passwordConfirmModal');
  setTimeout(() => input?.focus(), 100);
}

function _submitPasswordConfirm() {
  const input = document.getElementById('passwordConfirmInput');
  const errMsg = document.getElementById('passwordConfirmError');
  const typed = input?.value || '';
  const actual = store.settings['PHARMACIE_LOGIN_PASSWORD'] || '';
  if (typed === actual) {
    closeModal('passwordConfirmModal');
    if (_passwordConfirmCallback) _passwordConfirmCallback();
    _passwordConfirmCallback = null;
  } else {
    if (errMsg) errMsg.style.display = '';
    if (input) { input.value = ''; input.focus(); }
  }
}

function saveModuleSettings() {
  passwordConfirm(() => {
    const settings = {};
    ALL_MODULES.forEach(m => {
      const chk = document.getElementById(`mod-${m}`);
      settings[m] = chk ? chk.checked : true;
    });
    const anyVisible = ALL_MODULES.some(m => settings[m] === true);
    if (!anyVisible) return toast('Laissez au moins un module visible !', 'error');
    localStorage.setItem('PHARMACIE_MODULES_VISIBILITY', JSON.stringify(settings));
    applyModuleVisibility();
    toast('Visibilité des modules enregistrée ✓');
  });
}

function loadModuleCheckboxes() {
  const settings = getModuleSettings();
  ALL_MODULES.forEach(m => {
    const chk = document.getElementById(`mod-${m}`);
    if (chk) chk.checked = settings[m] !== false;
  });
}

// ─── SETTINGS ─────────────────────────────────────────────────
async function renderSettings(){
  if (currentUser?.role === 'admin') {
    document.getElementById('adminUsersCard').style.display = 'block';
    renderUsers(); 
  } else {
    document.getElementById('adminUsersCard').style.display = 'none';
  }
  const theme=document.documentElement.getAttribute('data-theme')||'light';
  document.getElementById('themeLight')?.classList.toggle('active',theme==='light');
  document.getElementById('themeDark')?.classList.toggle('active',theme==='dark');
  document.getElementById('settingsCaisseBalance').textContent=fmt(caisseBalance);
  applyAppName(); // charge nom, téléphone, adresse, description, logo
  loadModuleCheckboxes();
  await refreshDbInfo();
  await renderTrashList();
}
async function refreshDbInfo(){
  const panel=document.getElementById('dbInfoPanel'); if(!panel) return;
  if(!IS_ELECTRON){ panel.innerHTML=`<div style="padding:16px"><span class="db-status-badge fail"><span class="db-status-dot"></span> Mode navigateur</span><p style="padding:8px 14px;font-size:13px;color:var(--text3)">SQLite disponible uniquement dans l'app Electron.</p></div>`; return; }
  panel.innerHTML=`<div class="db-info-loading">Connexion…</div>`;
  try{
    const res=await window.electronAPI.dbGetInfo(); if(!res.ok) throw new Error(res.error);
    const info=res.data;
    const sizeKb=(info.size/1024).toFixed(1);
    const labels={categories:'Catégories',products:'Produits',sales:'Ventes',sale_items:'Lignes ventes',quotes:'Devis',quote_items:'Lignes devis',returns:'Retours',expenses:'Dépenses',caisse_transactions:'Transactions caisse',trash:'Corbeille',audit_log:'Journal audit'};
    const now = new Date().toLocaleTimeString();
    panel.innerHTML=`
      <div class="db-info-path"><strong>Chemin du fichier</strong>${info.path}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span class="db-status-badge ok"><span class="db-status-dot"></span> Base de données connectée</span>
        <button class="btn btn-sm btn-outline" onclick="refreshDbInfo()" title="Rafraîchir les stats">
          <i class="fas fa-sync-alt"></i> ${now}
        </button>
      </div>
      <div class="db-counts-grid">
        ${Object.entries(info.counts).map(([t,c])=>`
          <div class="db-count-cell">
            <span>${labels[t]||t}</span>
            <strong>${c}</strong>
          </div>
        `).join('')}
      </div>
      <div class="db-size-row">Taille actuelle sur disque : <strong>${sizeKb} Ko</strong></div>
      <p style="font-size:11px; color:var(--text3); margin-top:8px;">
        Note: La taille sur disque augmente par paliers (pages de 4Ko). 
        Elle ne change pas forcément à chaque petite ligne ajoutée.
      </p>
    `;
  }catch(err){panel.innerHTML=`<div style="padding:12px"><span class="db-status-badge fail"><span class="db-status-dot"></span> Erreur</span><p style="font-size:12px;color:var(--danger);padding:8px 14px">${err.message}</p></div>`;}
}
// ─── CORBEILLE (SECTION DÉDIÉE) ──────────────────────────────
const TRASH_ENTITY_LABELS = {
  product: 'Produit', category: 'Catégorie', sale: 'Vente',
  expense: 'Dépense', quote: 'Devis', return: 'Retour',
  caisse_transaction: 'Caisse', app_logo: 'Logo'
};
const TRASH_ENTITY_ICONS = {
  product: 'fa-box', category: 'fa-tags', sale: 'fa-shopping-cart',
  expense: 'fa-wallet', quote: 'fa-file-invoice', return: 'fa-undo-alt',
  caisse_transaction: 'fa-cash-register', app_logo: 'fa-image'
};
const TRASH_ENTITY_COLORS = {
  product: 'var(--info)', category: 'var(--warning)', sale: 'var(--success)',
  expense: 'var(--danger)', quote: 'var(--primary)', return: '#e67e22',
  caisse_transaction: '#8e44ad', app_logo: '#16a085'
};

function updateCorbeilleNavBadge() {
  const badge = document.getElementById('corbeilleNavBadge');
  if (!badge) return;
  const count = store.trash.length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

async function renderCorbeilleSection() {
  const container = document.getElementById('corbeilleListSection');
  if (!container) return;

  const search = (document.getElementById('corbeilleSearch')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('corbeilleTypeFilter')?.value || '';
  const btnVider = document.getElementById('btnViderCorbeille');

  let items = [...store.trash];
  if (typeFilter) items = items.filter(i => i.entity === typeFilter);
  if (search) items = items.filter(i =>
    i.label.toLowerCase().includes(search) ||
    (i.entity || '').toLowerCase().includes(search)
  );
  items.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  updateCorbeilleNavBadge();
  if (btnVider) btnVider.disabled = store.trash.length === 0;

  if (!items.length) {
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;color:var(--text3);">
        <div style="width:80px;height:80px;border-radius:50%;background:var(--bg2);display:flex;align-items:center;justify-content:center;">
          <i class="fas fa-trash-alt" style="font-size:36px;opacity:0.3;"></i>
        </div>
        <div style="font-size:18px;font-weight:600;">Corbeille vide</div>
        <div style="font-size:13px;text-align:center;max-width:320px;">
          ${search || typeFilter ? 'Aucun élément ne correspond à vos filtres.' : 'Les éléments supprimés apparaissent ici et peuvent être restaurés.'}
        </div>
      </div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const color = TRASH_ENTITY_COLORS[item.entity] || 'var(--text3)';
    const icon = TRASH_ENTITY_ICONS[item.entity] || 'fa-file';
    const label = TRASH_ENTITY_LABELS[item.entity] || item.entity;
    return `
    <div class="trash-item" style="
      display:flex; align-items:center; gap:14px;
      background:var(--surface); border:1px solid var(--border);
      border-radius:12px; padding:14px 18px; margin-bottom:10px;
      transition:box-shadow 0.2s;
    " onmouseenter="this.style.boxShadow='var(--shadow-md)'" onmouseleave="this.style.boxShadow='none'">
      <div style="
        width:42px; height:42px; border-radius:10px; flex-shrink:0;
        background:${color}22; display:flex; align-items:center; justify-content:center;
      ">
        <i class="fas ${icon}" style="font-size:18px; color:${color};"></i>
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; font-size:14px; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${escHtml(item.label)}
        </div>
        <div style="font-size:12px; color:var(--text3); margin-top:2px;">
          <span style="
            background:${color}22; color:${color}; padding:2px 8px;
            border-radius:20px; font-size:11px; font-weight:600;
          ">${label}</span>
          &nbsp;· Supprimé le ${fmtDateTime(item.deletedAt)}
        </div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
        <button class="btn btn-sm btn-outline" onclick="restoreItem('${item.id}')" title="Restaurer" style="border-color:var(--success);color:var(--success);">
          <i class="fas fa-undo"></i> Restaurer
        </button>
        <button class="btn-icon danger" onclick="deleteFromTrashAction('${item.id}')" title="Supprimer définitivement" style="color:var(--danger);">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function renderTrashList(){
  const list=document.getElementById('trashList'); if(!list) return;
  let items=store.trash;
  if(!items.length){list.innerHTML=`<div class="trash-empty-state"><i class="fas fa-trash"></i> Corbeille vide</div>`;return;}
  list.innerHTML=items.map(item=>`
    <div class="trash-item">
      <div class="trash-item-info">
        <div class="trash-item-label">${item.label}</div>
        <div class="trash-item-meta">${fmtDateTime(item.deletedAt)}</div>
      </div>
      <span class="trash-entity-badge">${item.entity}</span>
      <div class="actions-cell">
        <button class="btn btn-sm btn-outline" onclick="restoreItem('${item.id}')" title="Restaurer">↩ Restaurer</button>
        <button class="btn-icon danger" onclick="deleteFromTrashAction('${item.id}')" title="Supprimer définitivement"><i class="fas fa-trash-alt"></i></button>
      </div>
    </div>`).join('');
}

async function deleteFromTrashAction(trashId) {
  confirmDelete('Supprimer définitivement cet élément ? Cette action est irréversible <i class="fas fa-exclamation-triangle"></i>.', async() => {
    if(IS_ELECTRON) {
      const res = await window.electronAPI.deleteFromTrash(trashId, currentUser?.username);
      if(!res.ok) return toast('Erreur: '+res.error, 'error');
      await loadFromDB();
    } else {
      store.trash = store.trash.filter(t => t.id !== trashId);
      saveStore();
    }
    toast('Élément supprimé définitivement', 'warning');
    renderTrashList();
  });
}
async function restoreItem(trashId){
  if(IS_ELECTRON){ 
    const res = await window.electronAPI.restoreFromTrash(trashId, currentUser?.username); 
    if(!res.ok) return toast('Erreur: '+res.error,'error'); 
    const restored = res.data; // Le backend retourne {ok, entity, data}
    if(restored && restored.ok && restored.entity === 'app_logo' && restored.data) {
       localStorage.setItem('PHARMACIE_APP_LOGO', restored.data);
       applyAppName();
    }
    await loadFromDB(); 
  }
  else { store.trash=store.trash.filter(t=>t.id!==trashId); saveStore(); }
  toast('Élément restauré ✓'); renderTrashList(); updateCaisseBadge();
}
async function emptyTrashAction(){
  confirmDelete('Vider définitivement la corbeille ? Cette action est irréversible.', async()=>{
    if(IS_ELECTRON){ await window.electronAPI.emptyTrash(currentUser?.username); await loadFromDB(); }
    else { store.trash=[]; saveStore(); }
    renderTrashList(); toast('Corbeille vidée','warning');
  });
}
function openDbFolder(){ if(!IS_ELECTRON) return toast('Disponible uniquement dans Electron','warning'); window.electronAPI.dbOpenFolder(); }
function setTheme(theme){
  document.documentElement.setAttribute('data-theme',theme);
  localStorage.setItem('gp_theme',theme);
  document.getElementById('themeLight')?.classList.toggle('active',theme==='light');
  document.getElementById('themeDark')?.classList.toggle('active',theme==='dark');
  if(currentSection==='dashboard') renderDashboard();
  toast(`Thème ${theme==='dark'?'sombre':'clair'} activé`);
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────
function exportJSON(){
  const data={exportedAt:new Date().toISOString(),version:'1.0.0',categories:store.categories,products:store.products,sales:store.sales,quotes:store.quotes,returns:store.returns,expenses:store.expenses};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`Pharmacie-export-${new Date().toISOString().split('T')[0]}.json`; a.click();
  URL.revokeObjectURL(url); toast('Export JSON téléchargé ✓');
}
function exportCSV(){
  let csv='=== PRODUITS ===\r\nID,Nom,Catégorie,Prix,Stock,Code-barre\r\n';
  store.products.forEach(p=>{const cat=store.categories.find(c=>c.id===p.categoryId)?.name||''; csv+=[p.id,esc(p.name),esc(cat),p.price,p.stock,esc(p.barcode||'')].join(',')+'\r\n';});
  csv+='\r\n=== VENTES ===\r\nID,Client,Total,Date\r\n';
  store.sales.forEach(s=>{csv+=[s.id,esc(s.client),s.total,s.date].join(',')+'\r\n';});
  csv+='\r\n=== DÉPENSES ===\r\nID,Description,Montant,Catégorie,Date\r\n';
  store.expenses.forEach(e=>{csv+=[e.id,esc(e.description),e.amount,esc(e.category||''),e.date].join(',')+'\r\n';});
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=`Pharmacie-export-${new Date().toISOString().split('T')[0]}.csv`; a.click();
  URL.revokeObjectURL(url); toast('Export CSV téléchargé ✓');
}
function esc(v){if(!v) return '';const s=String(v);return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:s;}
async function importJSON(input){
  const file=input.files[0]; if(!file) return;
  const resultEl=document.getElementById('importResult');
  try{
    const text=await file.text(); const data=JSON.parse(text);
    if(!data.products&&!data.categories&&!data.sales) throw new Error('Fichier JSON invalide.');
    resultEl.style.display=''; resultEl.className='migrate-result'; resultEl.textContent='Importation en cours…';
    if(IS_ELECTRON){
      const res=await window.electronAPI.dbMigrateFromLocalStorage(data);
      if(!res.ok) throw new Error(res.error);
      await loadFromDB();
      const info=res.data;
      resultEl.className='migrate-result success';
      resultEl.innerHTML=`✓ Import réussi depuis <strong>${file.name}</strong><br>Produits:${info.counts.products} | Ventes:${info.counts.sales} | Dépenses:${info.counts.expenses}`;
      await refreshDbInfo();
    } else {
      let added=0;
      ['categories','products','sales','quotes','returns','expenses'].forEach(key=>{
        const incoming=data[key]||[]; const existing=new Set(store[key].map(x=>x.id));
        incoming.forEach(item=>{if(!existing.has(item.id)){store[key].push(item);added++;}});
      });
      saveStore();
      resultEl.className='migrate-result success';
      resultEl.innerHTML=`✓ Import réussi — ${added} enregistrement(s) ajouté(s).`;
    }
    toast(`Import de ${file.name} terminé ✓`);
  }catch(err){
    resultEl.style.display=''; resultEl.className='migrate-result error'; resultEl.textContent='✗ Erreur : '+err.message;
    toast("Erreur lors de l'import",'error');
  }
  input.value='';
}
async function migrateLocalStorage(){
  const result=document.getElementById('migrateResult'); if(!result) return;
  if(!IS_ELECTRON){result.className='migrate-result error';result.style.display='';result.textContent='<i class="fas fa-exclamation-triangle"></i> Migration disponible uniquement dans Electron.';return;}
  const data={};
  ['products','categories','sales','quotes','returns','expenses'].forEach(k=>{try{data[k]=JSON.parse(localStorage.getItem('gp_'+k)||'[]');}catch{data[k]=[];}});
  const total=Object.values(data).reduce((s,arr)=>s+arr.length,0);
  if(total===0){result.className='migrate-result error';result.style.display='';result.textContent='<i class="fas fa-exclamation-triangle"></i> Aucune donnée dans le LocalStorage.';return;}
  result.style.display=''; result.className='migrate-result'; result.textContent=`<i class="fas fa-spinner fa-spin"></i> Migration de ${total} enregistrements…`;
  try{
    const res=await window.electronAPI.dbMigrateFromLocalStorage(data);
    if(!res.ok) throw new Error(res.error);
    await loadFromDB();
    result.className='migrate-result success';
    result.innerHTML=`<i class="fas fa-check-circle"></i> Migration réussie ! Produits:${res.data.counts.products} | Ventes:${res.data.counts.sales}`;
    await refreshDbInfo(); toast('Migration terminée');
  }catch(err){result.className='migrate-result error';result.innerHTML='<i class="fas fa-times-circle"></i> Erreur : '+err.message;}
}

// ─── INIT ─────────────────────────────────────────────────────
async function init(){
  const savedTheme=localStorage.getItem('gp_theme');
  if(savedTheme) document.documentElement.setAttribute('data-theme',savedTheme);

  if(window.electronAPI){
    const TITLEBAR_H=38;
    document.body.classList.add('is-electron');
    document.documentElement.style.setProperty('--titlebar-h',TITLEBAR_H+'px');
    if(navigator.userAgent.includes('Mac')) document.body.classList.add('is-mac');
    document.getElementById('tbMinimize')?.addEventListener('click',()=>window.electronAPI.minimize());
    document.getElementById('tbMaximize')?.addEventListener('click',()=>window.electronAPI.maximize());
    document.getElementById('tbClose')?.addEventListener('click',()=>window.electronAPI.close());
    const syncMaxBtn=(isMax)=>{
      const btn=document.getElementById('tbMaximize'); if(!btn) return;
      btn.title=isMax?'Restaurer':'Agrandir';
      btn.innerHTML=isMax?`<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="0" width="8" height="8" stroke="currentColor"/><rect x="0" y="2" width="8" height="8" stroke="currentColor" fill="var(--surface)"/></svg>`:`<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>`;
    };
    syncMaxBtn(window.electronAPI.isMaximized());
    window.electronAPI.onMaximized(syncMaxBtn);
    window.electronAPI.onFullscreen(fs=>{ document.getElementById('titlebar').style.display=fs?'none':''; });
  } else {
    const tb=document.getElementById('titlebar'); if(tb) tb.style.display='none';
  }

  if(IS_ELECTRON) await loadFromDB(); else loadStore();

  applyAppName();
  applyModuleVisibility();

  document.getElementById('currentDate').textContent=new Date().toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});

  document.querySelectorAll('.nav-item').forEach(item=>{ item.addEventListener('click',e=>{ e.preventDefault(); navigate(item.dataset.section); }); });
  document.getElementById('sidebarToggle')?.addEventListener('click',() => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    // Recalculer les bounds de WhatsApp après la fin de la transition CSS
    if (currentSection === 'whatsapp') setTimeout(updateWhatsAppView, 320);
  });
  document.getElementById('mobileMenuBtn')?.addEventListener('click',() => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    if (currentSection === 'whatsapp') setTimeout(updateWhatsAppView, 320);
  });
  document.getElementById('themeToggle')?.addEventListener('click',()=>setTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark'));
  document.querySelectorAll('.modal-overlay').forEach(overlay=>{ overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.classList.remove('open'); }); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); });

  // Bloquer la soumission de formulaire en appuyant sur Entrée dans les inputs des modaux
  // (évite que la page soit rechargée et que le login s'affiche à nouveau)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return;
    
    // IDs d'inputs qui ont besoin d'Entrée pour leur fonction spéciale
    const allowEnter = ['saleBarcodeInput', 'loginCodeInput', 'loginCodeConfirm', 'activationCodeInput'];
    if (allowEnter.includes(e.target.id)) return;
    
    // Bloquer la soumission naturelle
    e.preventDefault();
  });

  updateCategorySelects();
  updateTicketModeUI();
  // Démarrer sur le premier module visible
  const mods = getModuleSettings();
  const startSection = ALL_MODULES.find(m => mods[m] !== false) || 'dashboard';
  navigate(startSection);
}

document.addEventListener('DOMContentLoaded',init);

// ══════════════════════════════════════════════════════════════
// ═══ PATIENTS MODULE ══════════════════════════════════════════
// ══════════════════════════════════════════════════════════════

function renderPatients() {
  const tbody = document.getElementById('patientsBody');
  if (!tbody) return;
  const search = document.getElementById('patientSearch')?.value.toLowerCase() || '';
  const patients = store.patients.filter(p => p.name.toLowerCase().includes(search));

  if (!patients.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-user-injured"></i></div><p>Aucun patient enregistré.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = patients.map(p => {
    const age = p.birthDate ? Math.floor((Date.now() - new Date(p.birthDate)) / (365.25 * 24 * 3600 * 1000)) + ' ans' : '—';
    const photo = p.image
      ? `<img src="${p.image}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--border);" alt="${p.name}">`
      : `<div style="width:40px;height:40px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;">${p.name.charAt(0).toUpperCase()}</div>`;
    const allergyBadge = p.allergies
      ? `<span class="badge badge-warning" title="${p.allergies}"><i class="fas fa-exclamation-triangle"></i> ${p.allergies.substring(0,25)}${p.allergies.length>25?'...':''}</span>`
      : '<span class="text-muted">—</span>';
    const biometrics = (p.weight || p.height) ? `${p.weight||'?'}kg / ${p.height||'?'}cm` : '—';
    return `<tr>
      <td>${photo}</td>
      <td><strong>${p.name}</strong>${p.gender ? `<br><small class="text-muted">${p.gender === 'M' ? '♂ Masculin' : '♀ Féminin'}</small>` : ''}</td>
      <td>${age}</td>
      <td>${p.phone ? `<a href="tel:${p.phone}">${p.phone}</a>` : '—'}</td>
      <td>${allergyBadge}</td>
      <td class="font-mono">${biometrics}</td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" onclick="openPatientModal('${p.id}')" title="Modifier"><i class="fas fa-edit"></i></button>
          <button class="btn-icon danger" onclick="deletePatientConfirm('${p.id}')" title="Supprimer"><i class="fas fa-trash-alt"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

let _currentPatientPhoto = null;

function openPatientModal(id) {
  _currentPatientPhoto = null;
  ['patientId','patientName','patientPhone'].forEach(f => document.getElementById(f).value = '');
  ['patientAllergies','patientHistory'].forEach(f => document.getElementById(f).value = '');
  ['patientWeight','patientHeight'].forEach(f => document.getElementById(f).value = '');
  document.getElementById('patientBirthDate').value = '';
  document.getElementById('patientGender').value = '';
  // Reset photo preview
  const preview = document.getElementById('patientPhotoPreview');
  preview.innerHTML = '<i class="fas fa-user-injured" style="font-size:50px; color:var(--text3);"></i>';

  if (id) {
    const p = store.patients.find(x => x.id === id);
    if (p) {
      document.getElementById('patientId').value = p.id;
      document.getElementById('patientName').value = p.name || '';
      document.getElementById('patientBirthDate').value = p.birthDate || '';
      document.getElementById('patientGender').value = p.gender || '';
      document.getElementById('patientPhone').value = p.phone || '';
      document.getElementById('patientWeight').value = p.weight || '';
      document.getElementById('patientHeight').value = p.height || '';
      document.getElementById('patientAllergies').value = p.allergies || '';
      document.getElementById('patientHistory').value = p.history || '';
      if (p.image) {
        _currentPatientPhoto = p.image;
        preview.innerHTML = `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;">`;
      }
    }
    document.getElementById('patientModalTitle').textContent = 'Modifier le patient';
  } else {
    document.getElementById('patientModalTitle').textContent = 'Ajouter un patient';
  }
  openModal('patientModal');
}

function onPatientPhotoChange(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _currentPatientPhoto = e.target.result;
    document.getElementById('patientPhotoPreview').innerHTML = `<img src="${_currentPatientPhoto}" style="width:100%;height:100%;object-fit:cover;">`;
  };
  reader.readAsDataURL(file);
}

async function savePatient() {
  const name = document.getElementById('patientName').value.trim();
  if (!name) return toast('Le nom du patient est requis', 'error');

  const patient = {
    id: document.getElementById('patientId').value || undefined,
    name,
    birthDate: document.getElementById('patientBirthDate').value,
    gender: document.getElementById('patientGender').value,
    phone: document.getElementById('patientPhone').value.trim(),
    weight: parseFloat(document.getElementById('patientWeight').value) || 0,
    height: parseFloat(document.getElementById('patientHeight').value) || 0,
    allergies: document.getElementById('patientAllergies').value.trim(),
    history: document.getElementById('patientHistory').value.trim(),
    image: _currentPatientPhoto || ''
  };

  if (IS_ELECTRON) {
    const res = await window.electronAPI.upsertPatient(patient, currentUser?.username);
    if (!res.ok) return toast('Erreur: ' + res.error, 'error');
    await loadFromDB();
  } else {
    if (patient.id) {
      const i = store.patients.findIndex(p => p.id === patient.id);
      store.patients[i] = { ...store.patients[i], ...patient };
    } else {
      store.patients.push({ ...patient, id: 'pat_' + Date.now(), createdAt: new Date().toISOString() });
    }
  }
  closeModal('patientModal');
  renderPatients();
  populateSalePatientSelect();
  toast(patient.id ? 'Patient mis à jour' : 'Patient ajouté');
}

async function deletePatientConfirm(id) {
  const p = store.patients.find(x => x.id === id);
  confirmDelete(`Supprimer le dossier de ${p?.name || 'ce patient'} ?`, async () => {
    if (IS_ELECTRON) {
      await window.electronAPI.deletePatient(id, currentUser?.username);
      await loadFromDB();
    } else {
      store.patients = store.patients.filter(x => x.id !== id);
    }
    renderPatients();
    populateSalePatientSelect();
    toast('Patient supprimé', 'warning');
  });
}

// Rempli le select patient dans le modal vente
function populateSalePatientSelect() {
  const sel = document.getElementById('salePatientSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Lier à un dossier patient (optionnel) --</option>' +
    store.patients.map(p => `<option value="${p.id}">${p.name}${p.phone ? ' — ' + p.phone : ''}</option>`).join('');
}

function onSalePatientChange() {
  const sel = document.getElementById('salePatientSelect');
  const patId = sel.value;
  if (!patId) return;
  const p = store.patients.find(x => x.id === patId);
  if (!p) return;
  // Pré-remplir le nom client si vide
  const clientInput = document.getElementById('saleClient');
  if (!clientInput.value) clientInput.value = p.name;
  const phoneInput = document.getElementById('saleClientPhone');
  if (!phoneInput.value && p.phone) phoneInput.value = p.phone;
}

// ══════════════════════════════════════════════════════════════
// ═══ INVENTAIRE TOURNANT (STOCK) ══════════════════════════════
// ══════════════════════════════════════════════════════════════

let inventoryModeActive = false;

function toggleInventoryMode() {
  inventoryModeActive = !inventoryModeActive;
  const btn = document.getElementById('inventoryModeBtn');
  if (inventoryModeActive) {
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-outline');
    btn.innerHTML = '<i class="fas fa-times-circle"></i> Quitter l\'inventaire';
    toast('Mode Inventaire activé — Modifiez les stocks directement dans le tableau', 'info');
  } else {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-outline');
    btn.innerHTML = '<i class="fas fa-clipboard-check"></i> Mode Inventaire';
    toast('Mode Inventaire désactivé', 'info');
  }
  renderStock();
}

// Override renderStock to support inventory mode and shelf filter
// (applied via DOMContentLoaded hook below)
// Populate shelf filter from products
function populateShelfFilter() {
  const sel = document.getElementById('stockShelfFilter');
  if (!sel) return;
  const shelves = [...new Set(store.products.map(p => p.shelfLocation).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Tous les rayons</option>' +
    shelves.map(s => `<option value="${s}" ${current===s?'selected':''}>${s}</option>`).join('');
}

async function applyInventoryStockChange(productId, newQty) {
  if (isNaN(newQty) || newQty < 0) return toast('Quantité invalide', 'error');
  if (IS_ELECTRON) {
    await window.electronAPI.setStock(productId, newQty, currentUser?.username);
    // Update store locally for instant feedback
    const p = store.products.find(x => x.id === productId);
    if (p) p.stock = newQty;
  } else {
    const p = store.products.find(x => x.id === productId);
    if (p) p.stock = newQty;
  }
  checkLowStock();
  toast('Stock mis à jour', 'success');
}

// ══════════════════════════════════════════════════════════════
// ═══ RECHERCHE BDPM / ANSM ════════════════════════════════════
// ══════════════════════════════════════════════════════════════

function openBdpmSearch() {
  const name = document.getElementById('productName')?.value?.trim();
  if (!name) {
    toast('Saisissez d\'abord le nom du médicament', 'warning');
    return;
  }
  const searchUrl = `https://base-donnees-publique.medicaments.gouv.fr/recherche.php?speciaLength=20&typRecherche=nom&valRecherche=${encodeURIComponent(name)}&rordonnance=0&pdf=0`;
  if (IS_ELECTRON && window.electronAPI) {
    // Open in default browser
    require && require('electron')?.shell?.openExternal(searchUrl);
    // Fallback via IPC if shell not available in renderer
    window.open(searchUrl, '_blank');
  } else {
    window.open(searchUrl, '_blank');
  }
  toast('Ouverture de la base BDPM (ANSM) pour : ' + name, 'info');
}

// ══════════════════════════════════════════════════════════════
// ═══ INIT HOOKS FOR NEW FEATURES ══════════════════════════════
// ══════════════════════════════════════════════════════════════

// Hook into openSaleModal to populate patients
document.addEventListener('DOMContentLoaded', () => {
  // Patch populateSalePatientSelect into openSaleModal
  const origOpen = window.openSaleModal;
  if (origOpen) {
    window.openSaleModal = function(...args) {
      origOpen.apply(this, args);
      populateSalePatientSelect();
      document.getElementById('salePatientSelect').value = '';
    };
  }
  // Patch renderStock to add shelf filter population
  const origRenderStock = window.renderStock;
  if (origRenderStock) {
    window.renderStock = function() {
      populateShelfFilter();
      const shelfFilter = document.getElementById('stockShelfFilter')?.value || '';
      // Temporarily filter products by shelf if needed
      if (shelfFilter || inventoryModeActive) {
        _renderStockWithExtras(shelfFilter, origRenderStock);
      } else {
        origRenderStock();
      }
    };
  }
});

function _renderStockWithExtras(shelfFilter, origFn) {
  // If no shelf filter and not in inventory mode, just call original
  if (!shelfFilter && !inventoryModeActive) { origFn(); return; }

  const tbody = document.getElementById('stockBody');
  if (!tbody) { origFn(); return; }

  const search = document.getElementById('stockSearch')?.value.toLowerCase() || '';
  const catFilter = document.getElementById('stockCatFilter')?.value || '';

  let prods = store.products.filter(p =>
    p.name.toLowerCase().includes(search) &&
    (!catFilter || p.categoryId === catFilter) &&
    (!shelfFilter || p.shelfLocation === shelfFilter)
  );

  const low = prods.filter(p => p.stock <= 5);
  const alertBanner = document.getElementById('stockAlertBanner');
  if (alertBanner) alertBanner.style.display = low.length ? '' : 'none';

  if (!prods.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon"><i class="fas fa-warehouse"></i></div><p>Aucun produit trouvé.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = prods.map(p => {
    const cat = store.categories.find(c => c.id === p.categoryId);
    let stockCell;
    if (inventoryModeActive) {
      stockCell = `<input type="number" value="${p.stock}" min="0" class="form-input" style="width:80px;padding:4px 8px;text-align:center;"
        onchange="applyInventoryStockChange('${p.id}', parseInt(this.value))"
        title="Modifier le stock directement">`;
    } else {
      stockCell = p.stock === 0
        ? `<span class="badge badge-danger">Rupture</span>`
        : p.stock <= 5
          ? `<span class="badge badge-warning">${p.stock}</span>`
          : `<span class="badge badge-success">${p.stock}</span>`;
    }
    return `<tr>
      <td><strong>${p.name}</strong>${p.shelfLocation ? `<br><small class="text-muted"><i class="fas fa-map-marker-alt"></i> ${p.shelfLocation}</small>` : ''}</td>
      <td>${cat ? `<span class="badge badge-info">${cat.name}</span>` : '<span class="text-muted">—</span>'}</td>
      <td>${stockCell}</td>
      <td>${p.stock === 0 ? '<span class="badge badge-danger">Rupture</span>' : p.stock <= 5 ? '<span class="badge badge-warning">Stock faible</span>' : '<span class="badge badge-success">OK</span>'}</td>
      <td>
        <div class="actions-cell">
          <button class="btn-icon" onclick="openStockModal('${p.id}')" title="Ajuster"><i class="fas fa-edit"></i></button>
          <button class="btn-icon" onclick="openProductModal('${p.id}')" title="Fiche produit"><i class="fas fa-box"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}
