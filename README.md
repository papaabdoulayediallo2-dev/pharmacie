# Pharmacie — Application de Gestion Commerciale

> Application desktop complète pour la gestion de produits, ventes, devis, dépenses et rapports.  
> Construite avec **Electron**, **Better-SQLite3** et du **Vanilla JS** pur.

---

## Table des matières

- [Aperçu](#aperçu)
- [Fonctionnalités](#fonctionnalités)
- [Structure du projet](#structure-du-projet)
- [Installation](#installation)
- [Commandes disponibles](#commandes-disponibles)
- [Base de données](#base-de-données)
- [Paramètres & Migration](#paramètres--migration)


- [Historique des modifications](#historique-des-modifications)
- [Technologies utilisées](#technologies-utilisées)

---

## Aperçu

Pharmacie est une application de bureau pensée pour les petits commerces et boutiques. Elle fonctionne entièrement hors ligne, sans serveur ni connexion internet requise. Toutes les données sont stockées localement dans une base de données SQLite sur la machine du client.

---

## Fonctionnalités

| Module | Fonctionnalités |
|---|---|
| **Tableau de bord** | Statistiques clés, 3 graphiques Chart.js |
| **Produits** | CRUD complet, recherche, filtre, tri, image, code-barre |
| **Catégories** | CRUD, compteur de produits associés |
| **Stock** | Alertes stock faible/rupture, ajustement +/− |
| **Ventes** | Multi-produits, calcul auto, mise à jour stock, historique |
| **Factures** | Impression via `window.print()` après chaque vente |
| **Devis** | CRUD + conversion en vente + impression |
| **Retours clients** | Stock restauré automatiquement |
| **Dépenses** | CRUD avec catégories |
| **Rapports** | Filtres par jour/semaine/mois/plage + impression |
| **Statistiques** | 5 graphiques analytiques |
| **Paramètres** | État de la DB, migration, thème, infos application |

---

## Structure du projet

```
Pharmacie/
│
├── index.html        → Interface principale (HTML + sections)
├── style.css         → Styles, thème clair/sombre, responsive
├── script.js         → Logique applicative (CRUD, graphiques, navigation)
│
├── main.js           → Processus principal Electron (fenêtre, IPC, menu)
├── preload.js        → Pont sécurisé entre Electron et le renderer
├── database.js       → Couche d'accès Better-SQLite3 (toutes les requêtes SQL)
│
├── package.json      → Dépendances et configuration electron-builder
├── README.md         → Ce fichier
│
└── assets/           → (optionnel) Icônes de l'application
    ├── icon.ico          Windows
    ├── icon.icns         macOS
    └── icon.png          Linux
```

---

## Installation

### Prérequis

- **Node.js** version 18 ou supérieure → [nodejs.org](https://nodejs.org)
- **npm** (inclus avec Node.js)
- **Git** (optionnel)

Vérifiez votre installation :

```bash
node --version   # doit afficher v18.x.x ou supérieur
npm --version
```

---

### Étape 1 — Cloner ou télécharger le projet

**Option A — Avec Git :**
```bash
git clone https://github.com/votre-utilisateur/Pharmacie.git
cd Pharmacie
```

**Option B — Téléchargement manuel :**  
Téléchargez et décompressez l'archive ZIP, puis ouvrez un terminal dans le dossier.

---

### Étape 2 — Installer les dépendances

```bash
npm install
```

> `sql.js` est une version de SQLite compilée en **WebAssembly** — aucun compilateur C++, aucun Visual Studio, aucun Python requis. Fonctionne avec **toutes les versions de Node.js**.  
> Durée estimée : 30 secondes à 1 minute.

---

### Étape 3 — Lancer l'application

```bash
npm run electron
```

L'application s'ouvre directement en mode fenêtre native.

---

## Commandes disponibles

| Commande | Description |
|---|---|
| `npm install` | Installe toutes les dépendances |
| `npm run electron` | Lance l'application en mode production |
| `npm run dist` | Génère un exécutable pour votre OS actuel |
| `npm run dist:win` | Génère un installeur `.exe` pour Windows |
| `npm run dist:mac` | Génère un fichier `.dmg` pour macOS |
| `npm run dist:linux` | Génère `.AppImage` et `.deb` pour Linux |

Les fichiers générés par `dist` se trouvent dans le dossier **`dist/`**.

---

### Générer un exécutable Windows (.exe)

```bash
npm run dist:win
```

Cela crée un installeur NSIS dans `dist/` :

```
dist/
└── Pharmacie Setup 1.0.0.exe
```

L'installeur permet de :
- Choisir le dossier d'installation
- Créer un raccourci sur le bureau
- Créer un raccourci dans le menu Démarrer

---

### Générer un exécutable macOS (.dmg)

```bash
npm run dist:mac
```

> Sur macOS Apple Silicon (M1/M2), le build produit une version universelle `x64 + arm64`.

---

### Générer un exécutable Linux (.AppImage / .deb)

```bash
npm run dist:linux
```

**AppImage** : exécutable portable, aucune installation requise.  
**Deb** : paquet pour Ubuntu, Debian et dérivés.

---

## Base de données

### Moteur de base de données : sql.js (WebAssembly)

Pharmacie utilise **sql.js**, une version de SQLite compilée en WebAssembly. Contrairement à `better-sqlite3`, il ne nécessite **aucun module natif C++**, ce qui signifie :

- ✅ Compatible avec **toutes les versions de Node.js** (y compris v25+)
- ✅ Aucun besoin de Visual Studio, Windows SDK ou Python
- ✅ `npm install` fonctionne immédiatement sur Windows, macOS et Linux
- ✅ Le fichier `.db` généré est un fichier SQLite standard, lisible avec DB Browser for SQLite

La base de données est chargée en mémoire au démarrage, et sauvegardée sur disque après chaque opération d'écriture.

### Emplacement du fichier

La base de données SQLite est automatiquement créée au premier lancement dans le dossier `userData` d'Electron, qui varie selon l'OS :

| OS | Chemin |
|---|---|
| **Windows** | `C:\Users\<utilisateur>\AppData\Roaming\Pharmacie\Pharmacie.db` |
| **macOS** | `~/Library/Application Support/Pharmacie/Pharmacie.db` |
| **Linux** | `~/.config/Pharmacie/Pharmacie.db` |

> 💡 Pour retrouver ce chemin rapidement, allez dans **Paramètres → Base de données → Ouvrir le dossier**.

---

### Tables créées automatiquement

```
categories     → id, name, description, createdAt
products       → id, name, description, categoryId, price, stock, image, barcode, createdAt
sales          → id, client, total, date
sale_items     → id, saleId, productId, qty, price
quotes         → id, client, total, date
quote_items    → id, quoteId, productId, qty, price
returns        → id, client, productId, qty, reason, date
expenses       → id, description, amount, category, date
```

Les tables sont créées automatiquement avec `CREATE TABLE IF NOT EXISTS` — aucune action manuelle n'est requise.

---

### Sauvegarder les données

Pour sauvegarder toutes les données d'un client, il suffit de copier le fichier `Pharmacie.db`. Il contient l'intégralité des données.

```bash
# Exemple de sauvegarde manuelle
cp ~/.config/Pharmacie/Pharmacie.db ~/Bureau/sauvegarde-Pharmacie-$(date +%Y%m%d).db
```

---

## Paramètres & Migration

### Page Paramètres

Accessible depuis le menu latéral → **Paramètres (⚙)**.

Elle contient 4 sections :

1. **Base de données SQLite**  
   Affiche le chemin du fichier, le statut de connexion (badge vert/rouge), le nombre d'enregistrements par table, et la taille du fichier. Bouton pour ouvrir le dossier dans l'explorateur.

2. **Migration des données**  
   Permet d'importer les données de l'ancienne version (LocalStorage du navigateur) vers SQLite. Les données existantes dans SQLite ne sont pas écrasées.

3. **À propos de Pharmacie**  
   Affiche la version, les versions d'Electron et Node.js utilisées.

4. **Apparence**  
   Sélecteur visuel entre le thème **Clair** et le thème **Sombre**.

---

### Migration depuis l'ancienne version (LocalStorage)

Si vous utilisiez Pharmacie dans un navigateur web (version sans Electron), vos données sont stockées dans le LocalStorage du navigateur. Pour les récupérer :

1. Ouvrez Pharmacie dans le **même navigateur** qu'avant
2. Allez dans **Paramètres → Migration des données**
3. Cliquez sur **Migrer depuis LocalStorage**
4. Les données sont importées dans SQLite sans écraser l'existant

---

## Historique des modifications

### Version 1.0.0

#### Ajout — Base de données SQLite (`database.js`)
- Nouveau fichier `database.js` contenant toute la couche d'accès SQLite via `better-sqlite3`
- Création automatique des 8 tables au premier lancement
- Utilisation de transactions atomiques pour les ventes (déduction du stock + insertion en une seule opération)
- Fonction `migrateFromLocalStorage()` pour l'import des données existantes
- Fonction `getDbInfo()` pour les statistiques et le diagnostic de la base

#### Ajout — IPC Database dans `main.js`
- Tous les canaux CRUD exposés via `ipcMain.handle()` (async)
- Wrapper `dbHandle()` avec gestion d'erreurs centralisée
- Commande `db:openFolder` pour ouvrir le dossier userData dans l'explorateur
- Fenêtre sans bordure native (`frame: false`) avec titlebar personnalisée

#### Ajout — Pont sécurisé dans `preload.js`
- Exposition de `window.electronAPI` via `contextBridge`
- Tous les canaux DB accessibles depuis le renderer sans `nodeIntegration`
- Canaux : catégories, produits, ventes, devis, retours, dépenses, infos DB, migration

#### Ajout — Page Paramètres dans `index.html` et `style.css`
- Nouvelle entrée **Paramètres (⚙)** dans la navigation latérale
- Carte **Base de données** : chemin, badge connecté/erreur animé, compteurs par table, taille
- Carte **Migration** : import LocalStorage → SQLite avec rapport de résultat
- Carte **À propos** : versions Electron, Node.js, description
- Carte **Apparence** : sélecteur visuel thème clair/sombre
- Styles dédiés : `.settings-grid`, `.settings-card`, `.db-info-panel`, `.db-counts-grid`, `.migrate-result`, `.theme-option-btn`

#### Modification — `script.js` (dual-mode DB/LocalStorage)
- Détection automatique de l'environnement : `const IS_ELECTRON = !!window.electronAPI`
- En mode Electron → toutes les opérations passent par SQLite via IPC
- En mode navigateur → fallback sur LocalStorage (comportement identique à avant)
- Fonction `loadFromDB()` pour charger toutes les données depuis SQLite au démarrage
- `init()` devient `async` pour attendre le chargement initial de la DB
- Toutes les fonctions CRUD mises à jour : `saveCategory`, `deleteCategory`, `saveProduct`, `deleteProduct`, `applyStockAdjustment`, `saveSale`, `deleteSale`, `saveQuote`, `convertQuoteToSale`, `deleteQuote`, `saveReturn`, `deleteReturn`, `saveExpense`, `deleteExpense`
- Nouvelles fonctions : `renderSettings()`, `refreshDbInfo()`, `openDbFolder()`, `migrateLocalStorage()`, `setTheme()`

#### Modification — Titlebar personnalisée (style VSCode)
- `frame: false` dans BrowserWindow — suppression de la barre de titre native
- Titlebar HTML/CSS intégrée à la page avec zone draggable
- Boutons Minimiser / Agrandir / Fermer en SVG pur
- Le bouton Fermer devient rouge au survol
- Synchronisation dynamique de l'icône Maximiser ↔ Restaurer
- Plein écran → titlebar masquée automatiquement
- macOS : `titleBarStyle: 'hiddenInset'` conserve les feux tricolores natifs

#### Modification — Hamburger buttons (`index.html` + `style.css`)
- Remplacement du caractère Unicode `☰` par 3 barres `<span>` CSS
- Rendu cohérent sur tous les OS et toutes les polices
- Classe partagée `.hamburger-icon` entre sidebar toggle et bouton mobile

#### Modification — `package.json`
- Remplacement de `better-sqlite3` par **`sql.js`** dans `dependencies`
- Suppression du script `postinstall` (plus besoin de compiler un module natif)
- Suppression de `asarUnpack` (sql.js est du JavaScript pur, compatible avec asar)
- `database.js` et `preload.js` ajoutés dans la liste `files` du build

---

## Technologies utilisées

| Technologie | Rôle |
|---|---|
| [Electron 30](https://electronjs.org) | Framework desktop cross-platform |
| [sql.js 1.12](https://github.com/sql-js/sql.js) | SQLite compilé en WebAssembly — aucun module natif, compatible toutes versions de Node.js |
| [Chart.js](https://chartjs.org) | Graphiques (dashboard + statistiques) |
| [electron-builder](https://electron.build) | Génération des exécutables (.exe, .dmg, .AppImage) |
| Vanilla JS | Logique applicative, aucun framework front-end |
| CSS Variables | Thème clair/sombre, responsive |

---
mon code supabase
Laye@@281005

## Licence & Sécurité

- **Code d'activation (Premier lancement)** : `laye2810`
- **Licence** : MIT — ce logiciel n'est pas libre d'utilisation, de modification et de distribution.
