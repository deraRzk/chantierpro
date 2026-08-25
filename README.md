# 🏗️ ChantierPro — Suivi de chantiers BTP (v3 · Local + Cloud)

Application **offline-first** qui digitalise le quotidien du chef de chantier :
journal, pointage, planning Gantt, dépenses, stocks, réserves sur plans + **cloud optionnel**
(comptes, synchro multi-appareils, partage client, analyse PDF, PWA installable).

**Sans connexion : 100 % des fonctions locales marchent. Avec connexion : la synchro s'ajoute.**

---

## ☁️ La version Cloud (dossier `server/`)

```bash
cd server
npm install        # express, bcryptjs, jsonwebtoken, multer, pdf-parse
node server.js     # → http://localhost:8000 (app + API sur le même port)
```

| Endpoint | Rôle |
|---|---|
| `POST /api/auth/register` · `/api/auth/login` | Comptes (JWT 30 j, bcrypt) |
| `POST /api/sync/push` · `GET /api/sync/pull` · `GET /api/sync/status` | Synchro snapshot + détection de conflit (409) |
| `POST /api/planning/pdf` | Upload PDF → tâches extraites automatiquement |
| `POST /api/share` → `GET /share/:token` | Page publique **lecture seule** du chantier (client/diaspora) |

**Offline-first côté client** (`cloud.js`) : pilule de statut (🌐 sync ✓ / 📴 hors-ligne / ☁️ à synchroniser),
envoi auto 20 s après chaque modification, reprise au retour réseau, gestion de conflit,
bloc compte dans la barre latérale, bouton « 📲 Installer l'app » (PWA + service worker `sw.js`).

⚠️ **Production** : hébergez `server/` (Railway, Render, VPS…) et mettez un vrai SGBD si beaucoup d'utilisateurs.
L'IA de vision pour PDF scannés/graphiques nécessitera une clé API (branchement prévu plus tard).

---

## 🚀 Lancement (3 options)

### Option 1 — Fichier unique (le plus simple)
Double-cliquez sur **`ChantierPro.html`** → s'ouvre dans Chrome, Firefox, Edge ou Safari.

### Option 2 — Dossier sources
Ouvrez `index.html` (gardez `styles.css` + `app.js` à côté).

### Option 3 — Sur votre téléphone (recommandé pour le terrain)
Déposez le dossier sur un hébergement statique gratuit (**Netlify Drop**, GitHub Pages, Vercel…)
→ vous saisissez vos rapports directement depuis le chantier, photos à l'appui.

---

## ✨ Modules

### 📝 A. Journal de chantier numérique
- Météo du jour en 1 clic (impactante sur le BTP)
- **Pointage des présences** : effectifs propres + **sous-traitants présents** (corps de métier + nombre)
- **Dictée vocale 🎤** des travaux et incidents (Chrome/Edge)
- **Photos d'avancement horodatées** + position GPS du rapport
- **Envoi du rapport quotidien par e-mail ✉️** en 1 clic (au conducteur de travaux)
- Rapport PDF périodique automatique

### 🧱 B. Matériaux & stocks sur site
- Matériaux suivis avec **seuil d'alerte** (ciment, acier, sable, blocs…)
- Livraisons : fournisseur, **référence du bon scannable 📷** (QR/code-barres, Chrome), photo du bon
- **Signalement des livraisons endommagées / non conformes** avec photo — tracées mais hors stock
- Consommations enregistrées → **stock calculé en temps réel**
- **Alertes rupture / stock bas** automatiques sur le tableau de bord

### ✅ C. Réserves & contrôle qualité (punch list)
- Import des **plans 2D** (photo/scan) consultables sur smartphone/tablette
- **Pointage des défauts directement sur le plan** (cliquez à l'emplacement : fissure, étanchéité, élément mal positionné…)
- **Attribution par corps de métier** + date limite de correction
- Statuts : 🟠 ouverte → 🟡 en cours → 🟢 levée (avec **photo de la correction**)
- Réserves **en retard** mises en évidence (pastille qui pulse sur le plan + alerte tableau de bord)

### 👷 Pointage du personnel
- Registre des ouvriers (métier + taux journalier en Ar)
- Pointage quotidien en 1 toucher : présent / ½ journée / absent
- Récapitulatif mensuel : jours travaillés + coût main-d'œuvre estimé (prépare la paie)
- Préremplissage des effectifs du rapport depuis le pointage

### 📅 Planning Gantt simplifié
- Diagramme de Gantt : barres de tâches sur frise calendaire, ligne « Aujourd'hui », jalons ◆
- Avancement au % par tâche (couleurs automatiques), tâches en retard signalées (barre qui pulse + alerte tableau de bord)
- Étiquettes de tâches fixes au défilement horizontal (mobile-friendly)
- Tableau « avancement des tâches » inclus dans le rapport PDF

### 💰 D. Dépenses & budget
- Dépenses par catégorie avec photo des reçus
- Barre de progression du budget, alertes 80 % / dépassement, en Ariary (Ar)

### 📊 E. Pilotage
- Tableau de bord : chantiers, rapports de la semaine, réserves ouvertes, **centre d'alertes** (stocks bas + réserves en retard)
- **Rapport PDF client** : journal complet + photos, dépenses, livraisons de matériaux, état des réserves, bloc signatures
- Export / import JSON complet (données + photos)
- ⬇ Exporter régulièrement = votre sauvegarde !

---

## 🖨️ Générer un PDF

1. Chantier → **« 📄 Rapport PDF »** → choisir la période → *Générer l'aperçu*
2. **Imprimer** → destination **« Enregistrer au format PDF »**

## ⚠️ Données & compatibilité

- Tout est stocké **localement dans le navigateur** (localStorage + IndexedDB). Pensez à **Exporter**.
- 🎤 Dictée vocale et 📷 scan de codes : requièrent **Chrome/Edge à jour** (API du navigateur). Tout le reste fonctionne partout, hors-ligne.

## 🛠️ Pistes v3

Multi-utilisateurs (comptes), synchro cloud, PWA installable, envoi automatique du rapport au client (espace lecture seule) — idéal pour le suivi à distance par la diaspora.

---

*Fichiers : `index.html`, `styles.css`, `app.js` (sources) · `ChantierPro.html` (version autonome à distribuer)*
