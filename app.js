'use strict';
/* ============================================================
   ChantierPro — Suivi de chantiers BTP (v2)
   Modules : Journal de chantier · Dépenses & budget ·
   Matériaux & stocks · Réserves qualité (punch list)
   100% local : aucune installation, aucune connexion requise.
   ============================================================ */

/* ---------------- Utilitaires ---------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtAr = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n) || 0) + ' Ar';
const fmtQty = (q, u) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(+q || 0) + (u ? ' ' + u : '');
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso, long = false) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('fr-FR', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const monthShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { month: 'short' });
const nl2br = s => esc(s).replace(/\n/g, '<br>');
const oneLine = s => (s || '').split('\n')[0];
const totWorkforce = r => (+r.workers || 0) + (+r.techs || 0) + (+r.engrs || 0);
const parseNum = v => parseFloat(String(v ?? '').replace(',', '.')) || 0;
const parseD = iso => new Date(iso + 'T00:00:00');
const pad2 = n => String(n).padStart(2, '0');
const fmtISO = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const addDays = (iso, n) => { const x = parseD(iso); x.setDate(x.getDate() + n); return fmtISO(x); };
const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / 864e5);

const WEATHERS = ['☀️ Ensoleillé', '⛅ Nuageux', '🌦️ Pluie légère', '🌧️ Forte pluie', '💨 Vent fort', '🌫️ Brume'];
const EXPENSE_CATS = ["Main-d'œuvre", 'Matériaux', 'Transport', 'Location matériel', 'Sous-traitance', 'Administratif', 'Divers'];
const STATUS = {
  actif:   { label: 'En cours',  cls: 'green' },
  pause:   { label: 'En pause',  cls: 'amber' },
  termine: { label: 'Terminé',   cls: 'slate' }
};
const TRADES = ['Maçonnerie', 'Ferraillage', 'Électricité', 'Plomberie', 'Menuiserie', 'Peinture', 'Étanchéité', 'Carrelage', 'Plâtrerie', 'Charpente', 'Autre'];
const DEFECT_STATUS = {
  ouvert:   { label: 'Ouverte',  cls: 'orange' },
  en_cours: { label: 'En cours', cls: 'amber' },
  leve:     { label: 'Levée',    cls: 'green' }
};
const DEF_ORDER = { ouvert: 0, en_cours: 1, leve: 2 };
const DELIVERY_STATUS = {
  conforme:     { label: 'Conforme',     cls: 'green' },
  endommage:    { label: 'Endommagé',    cls: 'amber' },
  non_conforme: { label: 'Non conforme', cls: 'red' }
};
const MATERIAL_PRESETS = ['Ciment (sacs)', 'Acier HA (t)', 'Sable (m³)', 'Gravier (m³)', 'Blocs (u)', 'Briques (u)', 'Peinture (L)', 'Câble (m)', 'Tuiles (u)'];
const UNITS = ['sacs', 't', 'kg', 'm³', 'm', 'u', 'L', 'blocs', 'barres'];

const isOverdue = d => d.status !== 'leve' && d.deadline && d.deadline < todayISO();
const subsLabel = r => (r.subs && r.subs.length) ? r.subs.map(s => `${esc(s.name)} (${+s.count || 0})`).join(' · ') : '';

/* ---------------- Stockage local (secours mémoire) ---------------- */
const LS = {
  _m: {},
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return LS._m[k] ?? null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { LS._m[k] = v; } }
};

const EMPTY_DATA = { projects: [], reports: [], expenses: [], materials: [], deliveries: [], uses: [], plans: [], defects: [], workers: [], attendance: [], tasks: [] };

const Store = {
  KEY: 'chantierpro-v1',
  data: JSON.parse(JSON.stringify(EMPTY_DATA)),
  load() {
    try {
      const raw = LS.get(this.KEY);
      if (raw) this.data = { ...JSON.parse(JSON.stringify(EMPTY_DATA)), ...JSON.parse(raw) };
    } catch (e) { console.warn('Chargement impossible', e); }
  },
  save() { LS.set(this.KEY, JSON.stringify(this.data)); },
  project(id) { return this.data.projects.find(p => p.id === id); },
  report(id) { return this.data.reports.find(r => r.id === id); },
  reportsOf(pid) {
    return this.data.reports.filter(r => r.projectId === pid)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));
  },
  expensesOf(pid) {
    return this.data.expenses.filter(e => e.projectId === pid)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));
  },
  spentOf(pid) { return this.expensesOf(pid).reduce((t, e) => t + (+e.amount || 0), 0); },
  materialsOf(pid) { return this.data.materials.filter(m => m.projectId === pid); },
  material(id) { return this.data.materials.find(m => m.id === id); },
  deliveriesOf(pid) {
    return this.data.deliveries.filter(d => d.projectId === pid)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));
  },
  usesOf(pid) {
    return this.data.uses.filter(u => u.projectId === pid)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt - a.createdAt));
  },
  plansOf(pid) { return this.data.plans.filter(p => p.projectId === pid); },
  plan(id) { return this.data.plans.find(p => p.id === id); },
  defectsOf(pid) { return this.data.defects.filter(d => d.projectId === pid); },
  defect(id) { return this.data.defects.find(d => d.id === id); },
  workersOf(pid) { return this.data.workers.filter(w => w.projectId === pid).sort((a, b) => (a.name || '').localeCompare(b.name || '')); },
  tasksOf(pid) {
    return this.data.tasks.filter(t => t.projectId === pid)
      .sort((a, b) => a.start.localeCompare(b.start) || (a.createdAt - b.createdAt));
  },
  stockOf(mid) {
    const inQty = this.data.deliveries
      .filter(d => d.materialId === mid && d.status === 'conforme')
      .reduce((t, d) => t + (+d.qty || 0), 0);
    const outQty = this.data.uses
      .filter(u => u.materialId === mid)
      .reduce((t, u) => t + (+u.qty || 0), 0);
    return inQty - outQty;
  }
};

function sortDefects(arr) {
  return [...arr].sort((a, b) =>
    (DEF_ORDER[a.status] - DEF_ORDER[b.status]) ||
    (a.deadline || '9999').localeCompare(b.deadline || '9999') ||
    (a.createdAt - b.createdAt));
}

/* ---------------- Photos (IndexedDB, secours mémoire) ---------------- */
const PhotoStore = (() => {
  let db = null, broken = false;
  const mem = new Map();
  function open() {
    return new Promise(resolve => {
      if (db) return resolve(db);
      if (broken || !window.indexedDB) return resolve(null);
      try {
        const req = indexedDB.open('chantierpro-photos', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos');
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror = () => { broken = true; resolve(null); };
      } catch (e) { broken = true; resolve(null); }
    });
  }
  async function put(id, dataUrl) {
    const d = await open();
    if (!d) { mem.set(id, dataUrl); return; }
    return new Promise(res => {
      try {
        const tx = d.transaction('photos', 'readwrite');
        tx.objectStore('photos').put(dataUrl, id);
        tx.oncomplete = res;
        tx.onerror = () => { mem.set(id, dataUrl); res(); };
      } catch (e) { mem.set(id, dataUrl); res(); }
    });
  }
  async function get(id) {
    if (mem.has(id)) return mem.get(id);
    const d = await open();
    if (!d) return null;
    return new Promise(res => {
      try {
        const rq = d.transaction('photos').objectStore('photos').get(id);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  }
  async function getAll() {
    const out = {};
    mem.forEach((v, k) => { out[k] = v; });
    const d = await open();
    if (!d) return out;
    return new Promise(res => {
      try {
        const tx = d.transaction('photos');
        const st = tx.objectStore('photos');
        const rq = st.getAll(), rk = st.getAllKeys();
        tx.oncomplete = () => { (rk.result || []).forEach((k, i) => { out[k] = rq.result[i]; }); res(out); };
        tx.onerror = () => res(out);
      } catch (e) { res(out); }
    });
  }
  async function del(id) {
    mem.delete(id);
    const d = await open();
    if (!d) return;
    return new Promise(res => {
      try {
        const tx = d.transaction('photos', 'readwrite');
        tx.objectStore('photos').delete(id);
        tx.oncomplete = res; tx.onerror = () => res();
      } catch (e) { res(); }
    });
  }
  async function importAll(obj) {
    for (const [k, v] of Object.entries(obj || {})) await put(k, v);
  }
  return { put, get, getAll, del, importAll };
})();

async function hydratePhotos(root = document) {
  const imgs = $$('img[data-photo-id]', root);
  await Promise.all(imgs.map(async img => {
    const url = await PhotoStore.get(img.dataset.photoId);
    if (url) img.src = url;
    else { img.alt = 'photo indisponible'; img.style.background = '#e2e8f0'; }
  }));
}

/* ---------------- Compression d'images ---------------- */
function readFileAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
async function compressImage(file, maxW = 1280, quality = 0.72) {
  try {
    const dataUrl = await readFileAsDataURL(file);
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxW / (img.width || maxW));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } catch (e) { console.warn('Image ignorée :', e); return null; }
}

/* ---------------- Photos temporaires des formulaires ---------------- */
const PENDS = {}; // { cle: [{id,dataUrl}] }
const pend = key => (PENDS[key] = PENDS[key] || []);
async function filesToPend(files, key) {
  for (const f of files) {
    const d = await compressImage(f);
    if (d) pend(key).push({ id: uid(), dataUrl: d });
  }
}
function thumbsHtml(key) {
  return pend(key).map(p => `
    <div class="thumb"><img src="${p.dataUrl}" alt="photo">
      <button type="button" class="thumb-x" data-action="remove-photo" data-key="${key}" data-pid="${p.id}" title="Retirer">×</button>
    </div>`).join('');
}
function renderThumbs(key) {
  const c = $('#thumbs-' + key);
  if (c) c.innerHTML = thumbsHtml(key);
}
function filePicker(key, multiple = true) {
  return `<input type="file" id="file-${key}" accept="image/*" ${multiple ? 'multiple' : ''} hidden>`;
}
function bindFilePicker(key) {
  const i = $('#file-' + key);
  if (i) i.addEventListener('change', async e => {
    await filesToPend([...e.target.files], key);
    e.target.value = '';
    renderThumbs(key);
  });
}
async function storePendPhotos(key, existing = []) {
  const ids = [...existing];
  for (const ph of pend(key)) { await PhotoStore.put(ph.id, ph.dataUrl); ids.push(ph.id); }
  PENDS[key] = [];
  return ids;
}

/* ---------------- Modales ---------------- */
let scannerStream = null, scanTimer = null;
function openModal(html, cls = '') {
  $('#modal-root').innerHTML = `<div class="modal-overlay"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
}
function closeModal() {
  if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const r = $('#modal-root');
  if (r) r.innerHTML = '';
}

/* ---------------- Routeur ---------------- */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = h.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  return { parts, q: new URLSearchParams(queryPart || '') };
}
function render() {
  document.body.classList.remove('side-open');
  const { parts, q } = parseHash();
  closeModal();
  const app = $('#app');
  window.scrollTo(0, 0);
  if (parts[0] === 'projet' && parts[1] && parts[2] === 'nouveau-rapport') viewReportForm(app, parts[1]);
  else if (parts[0] === 'projet' && parts[1] && parts[2] === 'pdf') viewPrintable(app, parts[1], q);
  else if (parts[0] === 'projet' && parts[1] && parts[2] === 'plan') viewPlan(app, parts[1], parts[3]);
  else if (parts[0] === 'projet' && parts[1]) viewProject(app, parts[1], q);
  else if (parts[0] === 'rapport' && parts[1]) viewReportDetail(app, parts[1]);
  else viewDashboard(app);
  renderChrome();
  hydratePhotos();
}
window.addEventListener('hashchange', render);

/* ---------------- Barre latérale & barre supérieure ---------------- */
const TAB_NAMES = {
  rapports: 'Journal de chantier', pointage: 'Pointage du personnel', planning: 'Planning',
  depenses: 'Dépenses & budget', materiaux: 'Matériaux & stocks',
  reserves: 'Réserves & contrôle qualité', infos: 'Paramètres du chantier'
};
const sideItem = (href, icon, label, on, badge, badgeCls) => `
  <a class="side-link ${on ? 'on' : ''}" href="${href}">
    <span class="si">${icon}</span><span class="sl">${label}</span>
    ${badge != null ? `<span class="side-badge ${badgeCls || ''}">${badge}</span>` : ''}
  </a>`;
const sideAction = (icon, label, action) => `
  <button class="side-link" data-action="${action}">
    <span class="si">${icon}</span><span class="sl">${label}</span>
  </button>`;

function renderChrome() {
  const { parts, q } = parseHash();
  const side = $('#sidebar');
  const sub = parts[2] || null;
  const tab = q.get('tab') || 'rapports';
  let topTitle = 'ChantierPro', topSub = '', topActions = '';

  const tools = `
    <div class="side-sec">Outils</div>
    ${sideAction('⬇️', 'Exporter (sauvegarde)', 'export-data')}
    ${sideAction('⬆️', 'Importer des données', 'open-import')}
    ${sideAction('✨', 'Charger la démo', 'load-demo')}
    ${sideAction('❓', 'Aide', 'help')}`;

  let nav;
  if (parts[0] === 'projet' && parts[1] && Store.project(parts[1])) {
    const pid = parts[1];
    const p = Store.project(pid);
    const st = STATUS[p.status] || STATUS.actif;
    const openDef = Store.defectsOf(pid).filter(d => d.status !== 'leve').length;
    const lateDef = Store.defectsOf(pid).filter(isOverdue).length;
    const lowStock = Store.materialsOf(pid).filter(m => Store.stockOf(m.id) <= (m.threshold || 0)).length;
    const lateTask = Store.tasksOf(pid).filter(t => (+t.progress || 0) < 100 && t.end && t.end < todayISO()).length;

    nav = `
    <div class="side-sec">Navigation</div>
    ${sideItem('#/', '📊', 'Tableau de bord', false)}
    <div class="side-sec">Chantier en cours</div>
    <div class="side-proj"><b>${esc(p.name)}</b><span>${esc(p.client || '')}${p.location ? ' · 📍 ' + esc(p.location) : ''}</span></div>
    ${sideItem(`#/projet/${pid}?tab=rapports`, '📝', 'Journal', (tab === 'rapports' && !sub) || sub === 'nouveau-rapport', Store.reportsOf(pid).length)}
    ${sideItem(`#/projet/${pid}?tab=pointage`, '👷', 'Pointage', tab === 'pointage', Store.workersOf(pid).length)}
    ${sideItem(`#/projet/${pid}?tab=planning`, '📅', 'Planning', tab === 'planning', Store.tasksOf(pid).length, lateTask ? 'warn' : '')}
    ${sideItem(`#/projet/${pid}?tab=depenses`, '💰', 'Dépenses', tab === 'depenses', Store.expensesOf(pid).length)}
    ${sideItem(`#/projet/${pid}?tab=materiaux`, '🧱', 'Matériaux', tab === 'materiaux', Store.materialsOf(pid).length, lowStock ? 'warn' : '')}
    ${sideItem(`#/projet/${pid}?tab=reserves`, '✅', 'Réserves', tab === 'reserves' || sub === 'plan', openDef, lateDef ? 'warn' : '')}
    ${sideItem(`#/projet/${pid}?tab=infos`, '⚙️', 'Paramètres', tab === 'infos')}
    <div class="side-sec">Actions</div>
    <button class="side-btn" data-action="go-new-report" data-id="${pid}">＋ Rapport du jour</button>
    <button class="side-btn ghost" data-action="open-pdf-modal" data-id="${pid}">📄 Rapport PDF</button>
    ${tools}`;

    if (sub === 'pdf') { topTitle = 'Rapport PDF'; topSub = p.name; }
    else if (sub === 'plan') { const pl = Store.plan(parts[3]); topTitle = '🗺️ ' + (pl ? pl.name : 'Plan'); topSub = p.name + ' · Réserves'; }
    else if (sub === 'nouveau-rapport') { topTitle = 'Rapport journalier'; topSub = p.name; }
    else {
      topTitle = p.name;
      topSub = (TAB_NAMES[tab] || '') + (p.location ? ' · 📍 ' + p.location : '');
      topActions = `<span class="badge ${st.cls}">${st.label}</span><button class="btn btn-primary btn-sm" data-action="go-new-report" data-id="${pid}">＋ Rapport</button>`;
    }
  } else if (parts[0] === 'rapport' && parts[1]) {
    const r = Store.report(parts[1]);
    const p = r ? Store.project(r.projectId) : null;
    nav = `
    <div class="side-sec">Navigation</div>
    ${sideItem('#/', '📊', 'Tableau de bord', false)}
    ${p ? sideItem('#/projet/' + p.id, '🏗️', esc(p.name), false) : ''}
    ${tools}`;
    topTitle = r ? 'Rapport du ' + fmtDate(r.date) : 'Rapport';
    topSub = p ? p.name : '';
  } else {
    nav = `
    <div class="side-sec">Navigation</div>
    ${sideItem('#/', '📊', 'Tableau de bord', true, Store.data.projects.length)}
    <div class="side-hint">Sélectionnez un chantier pour accéder à ses modules : journal, pointage, planning, dépenses, matériaux, réserves…</div>
    ${tools}`;
    topTitle = 'Tableau de bord';
    topSub = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    topActions = `<button class="btn btn-primary btn-sm" data-action="open-project-modal">＋ Nouveau chantier</button>`;
  }

  side.innerHTML = `
    <div class="side-brand"><span class="logo-badge">🏗️</span><span class="sb-name">Chantier<b>Pro</b></span></div>
    <nav class="side-nav">${nav}</nav>
    <div class="side-foot">ChantierPro v3.0 · Local d'abord, cloud en option ☁️<br>Pensez à exporter vos sauvegardes ⬇️</div>`;

  $('#tb-title').textContent = topTitle;
  const sub2 = $('#tb-sub');
  sub2.textContent = topSub;
  sub2.style.display = topSub ? '' : 'none';
  $('#tb-actions').innerHTML = topActions;
}

/* ---------------- Composants ---------------- */
const kpiCard = (icon, num, lbl, color = 'c-s') => `
  <div class="kpi"><span class="kpi-ico ${color}">${icon}</span>
    <div><b>${num}</b><small>${lbl}</small></div>
  </div>`;
const tabBtn = (id, key, label, cur) =>
  `<a class="tab ${cur === key ? 'on' : ''}" href="#/projet/${id}?tab=${key}">${label}</a>`;
const notFound = () => `
  <div class="empty small">
    <h2>Introuvable</h2>
    <p class="muted">Cet élément n'existe pas (ou a été supprimé).</p>
    <a class="btn btn-primary" href="#/">Retour au tableau de bord</a>
  </div>`;
const defDot = st => `<span class="dot ${st}"></span>`;
const defBadge = d => {
  const st = DEFECT_STATUS[d.status] || DEFECT_STATUS.ouvert;
  return `<span class="badge ${st.cls}">${st.label}</span>`;
};

/* ============================================================
   VUE : Tableau de bord
   ============================================================ */
function collectAlerts() {
  const alerts = [];
  for (const p of Store.data.projects) {
    if (p.status === 'termine') continue;
    for (const m of Store.materialsOf(p.id)) {
      const s = Store.stockOf(m.id);
      if (s <= (m.threshold || 0)) {
        alerts.push({ icon: '🧱', cls: s <= 0 ? 'red' : '', pid: p.id, tab: 'materiaux',
          text: `<b>${s <= 0 ? 'Rupture' : 'Stock bas'}</b> : ${esc(m.name)} — ${fmtQty(s, m.unit)} restant(s) · <span class="muted">${esc(p.name)}</span>` });
      }
    }
    for (const d of Store.defectsOf(p.id)) {
      if (isOverdue(d)) {
        alerts.push({ icon: '🔴', cls: 'red', pid: p.id, tab: 'reserves',
          text: `<b>Réserve en retard</b> : ${esc(d.title)} — échéance ${fmtDate(d.deadline)} · <span class="muted">${esc(p.name)}</span>` });
      }
    }
    for (const t of Store.tasksOf(p.id)) {
      if ((+t.progress || 0) < 100 && t.end && t.end < todayISO()) {
        alerts.push({ icon: '📅', cls: 'red', pid: p.id, tab: 'planning',
          text: `<b>Tâche en retard</b> : ${esc(t.name)} — fin prévue le ${fmtDate(t.end)} · <span class="muted">${esc(p.name)}</span>` });
      }
    }
  }
  return alerts;
}

function viewDashboard(app) {
  const projects = Store.data.projects;
  if (!projects.length) { app.innerHTML = emptyDash(); return; }

  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const tdy = todayISO();
  const actifs = projects.filter(p => p.status === 'actif').length;
  const rapportsSemaine = Store.data.reports.filter(r => r.date >= weekAgo && r.date <= tdy).length;
  const depMois = Store.data.expenses.filter(e => (e.date || '').startsWith(monthKey)).reduce((t, e) => t + (+e.amount || 0), 0);
  const ouvertes = Store.data.defects.filter(d => d.status !== 'leve').length;
  const alerts = collectAlerts();

  app.innerHTML = `
  ${alerts.length ? `
  <section class="alert-list">
    ${alerts.slice(0, 8).map(a => `<a class="alert-item ${a.cls}" href="#/projet/${a.pid}?tab=${a.tab}"><span>${a.icon}</span><span>${a.text}</span><span class="chev">›</span></a>`).join('')}
  </section>` : ''}
  <section class="kpi-grid">
    ${kpiCard('🏗️', projects.length, 'Chantiers au total', 'c-s')}
    ${kpiCard('🚧', actifs, 'En cours', 'c-g')}
    ${kpiCard('📝', rapportsSemaine, 'Rapports · 7 derniers jours', 'c-b')}
    ${kpiCard('✅', ouvertes, 'Réserves ouvertes', 'c-o')}
    ${kpiCard('💸', fmtAr(depMois), 'Dépensé · ' + new Date().toLocaleDateString('fr-FR', { month: 'long' }), 'c-r')}
  </section>
  <h2 class="section-title">Mes chantiers</h2>
  <section class="grid">${projects.map(projectCard).join('')}</section>`;
}

function projectCard(p) {
  const spent = Store.spentOf(p.id);
  const pct = p.budget ? Math.min(100, Math.round(spent / p.budget * 100)) : 0;
  const over = p.budget && spent > p.budget;
  const nb = Store.reportsOf(p.id).length;
  const nbDef = Store.defectsOf(p.id).filter(d => d.status !== 'leve').length;
  const st = STATUS[p.status] || STATUS.actif;
  return `
  <a class="card project-card st-${p.status || 'actif'}" href="#/projet/${p.id}">
    <div class="card-top"><h3>${esc(p.name)}</h3><span class="badge ${st.cls}">${st.label}</span></div>
    <p class="muted">${esc(p.client || 'Client non renseigné')} · ${esc(p.location || '—')}</p>
    <div class="card-meta">
      <span>📝 ${nb} rapport${nb > 1 ? 's' : ''}</span>
      <span>✅ ${nbDef} réserve${nbDef > 1 ? 's' : ''}</span>
      <span>📅 ${fmtDate(p.startDate)}</span>
    </div>
    ${p.budget ? `<div class="progress ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div>` : ''}
    <div class="card-budget"><b>${fmtAr(spent)}</b> ${p.budget ? '/ ' + fmtAr(p.budget) + ` <span class="muted">(${pct} %)</span>` : '<span class="muted">dépensés</span>'}</div>
  </a>`;
}

function emptyDash() {
  return `
  <section class="empty">
    <div class="empty-icon">🏗️</div>
    <h1>Bienvenue sur ChantierPro</h1>
    <p>Le suivi de chantier simple et 100 % hors-ligne : journal quotidien, photos,
       dépenses, stocks de matériaux, réserves qualité sur plans et rapports PDF professionnels.</p>
    <div class="toolbar center">
      <button class="btn btn-primary btn-lg" data-action="open-project-modal">＋ Créer mon premier chantier</button>
      <button class="btn btn-ghost btn-lg" data-action="load-demo">Voir la démo</button>
    </div>
  </section>`;
}

/* ============================================================
   VUE : Fiche chantier (onglets)
   ============================================================ */
function viewProject(app, id, q) {
  const p = Store.project(id);
  if (!p) { app.innerHTML = notFound(); return; }
  const tab = q.get('tab') || 'rapports';
  const reports = Store.reportsOf(id);
  const expenses = Store.expensesOf(id);
  const nDef = Store.defectsOf(id).filter(d => d.status !== 'leve').length;
  const nbWorkers = Store.workersOf(id).length;
  const nbTasks = Store.tasksOf(id).length;
  const spent = expenses.reduce((t, e) => t + (+e.amount || 0), 0);
  const pct = p.budget ? Math.round(spent / p.budget * 100) : 0;
  const st = STATUS[p.status] || STATUS.actif;

  app.innerHTML = `
  <div class="proj-summary">
    <div class="kpi-grid">
      ${kpiCard('💰', p.budget ? fmtAr(p.budget) : '—', 'Budget prévu', 'c-b')}
      ${kpiCard('🧾', fmtAr(spent), 'Dépensé', 'c-o')}
      ${kpiCard('✅', fmtAr((p.budget || 0) - spent), 'Restant', 'c-g')}
      ${kpiCard('📊', p.budget ? pct + ' %' : '—', 'Budget consommé', spent > (p.budget || 0) ? 'c-r' : 'c-s')}
    </div>
    ${p.budget ? `<div class="progress big ${spent > p.budget ? 'over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
    ${p.budget && spent > p.budget
        ? `<div class="alert danger">⚠️ Dépassement de budget de <b>${fmtAr(spent - p.budget)}</b>.</div>`
        : (p.budget && pct >= 80 ? `<div class="alert warn">⚠️ Attention : ${pct} % du budget déjà consommé.</div>` : '')}
  </div>
  <section class="tab-body">
    ${tab === 'depenses' ? tabExpenses(p, expenses)
      : tab === 'pointage' ? tabPointage(p)
      : tab === 'planning' ? tabPlanning(p)
      : tab === 'materiaux' ? tabMaterials(p)
      : tab === 'reserves' ? tabReserves(p, q.get('f') || 'all')
      : tab === 'infos' ? tabInfos(p)
      : tabReports(p, reports)}
  </section>`;

  if (tab === 'reserves') {
    const pi = $('#plan-input');
    if (pi) pi.addEventListener('change', e => onPlansPicked(e, p.id));
  }
  if (tab === 'pointage') attachPointageWatcher(p.id);
}

/* ---------------- Onglet Rapports ---------------- */
function tabReports(p, reports) {
  if (!reports.length) {
    return `<div class="empty small">
      <h2>Aucun rapport pour l'instant</h2>
      <p class="muted">Chaque jour, documentez l'avancement en 1 minute : photos, effectifs, sous-traitants, travaux réalisés.</p>
      <button class="btn btn-primary" data-action="go-new-report" data-id="${p.id}">＋ Créer le premier rapport</button>
    </div>`;
  }
  return `
  <div class="toolbar end">
    <button class="btn btn-ghost" data-action="open-pdf-modal" data-id="${p.id}">📄 Générer un rapport PDF</button>
    <button class="btn btn-primary" data-action="go-new-report" data-id="${p.id}">＋ Nouveau rapport journalier</button>
  </div>
  <div class="list">
    ${reports.map(r => `
    <a class="list-row" href="#/rapport/${r.id}">
      <div class="date-badge"><b>${(+r.date.slice(8, 10))}</b><span>${monthShort(r.date)}</span></div>
      <div class="grow">
        <b>${esc(r.weather || 'Rapport journalier')}</b><br>
        <span class="muted">${esc(oneLine(r.tasks)).slice(0, 90) || '—'}</span>
      </div>
      <div class="muted nowrap">👷 ${totWorkforce(r)}${r.subs && r.subs.length ? ' · 👥 ' + r.subs.length : ''} · 📷 ${(r.photos || []).length}</div>
      <span class="chev">›</span>
    </a>`).join('')}
  </div>`;
}

/* ---------------- Onglet Planning (Gantt) ---------------- */
function taskState(t) {
  return (+t.progress || 0) >= 100 ? 'terminee' : (+t.progress || 0) > 0 ? 'encours' : 'afaire';
}
const TASK_LABELS = { afaire: 'À faire', encours: 'En cours', terminee: 'Terminée' };

function tabPlanning(p) {
  const tasks = Store.tasksOf(p.id);
  const today = todayISO();
  const nDone = tasks.filter(t => (+t.progress || 0) >= 100).length;
  const nLate = tasks.filter(t => (+t.progress || 0) < 100 && t.end && t.end < today).length;
  const avg = tasks.length ? Math.round(tasks.reduce((s, t) => s + (+t.progress || 0), 0) / tasks.length) : 0;

  if (!tasks.length) {
    return `<div class="toolbar end">
      <button class="btn btn-ghost" data-action="open-import-tasks" data-id="${p.id}">⬆ Importer (Excel / CSV)</button>
      <button class="btn btn-primary" data-action="open-task-modal" data-id="${p.id}">＋ Nouvelle tâche</button>
    </div>
    <div class="empty small">
      <h2>📅 Planning du chantier</h2>
      <p class="muted">Créez vos tâches (fondations, dalles, élévations, toiture…), ou <b>importez votre planning existant</b> en le copiant depuis Excel ou en CSV — ChantierPro le transforme automatiquement en diagramme de Gantt. Les tâches en retard remontent aussi sur le tableau de bord.</p>
      <div class="toolbar center">
        <button class="btn btn-ghost" data-action="open-import-tasks" data-id="${p.id}">⬆ Importer mon planning</button>
        <button class="btn btn-primary" data-action="open-task-modal" data-id="${p.id}">＋ Créer la première tâche</button>
      </div>
    </div>`;
  }
  return `
  <div class="toolbar end">
    <button class="btn btn-ghost" data-action="open-import-tasks" data-id="${p.id}">⬆ Importer</button>
    <button class="btn btn-ghost" data-action="export-tasks-csv" data-id="${p.id}">⬇ CSV</button>
    <button class="btn btn-primary" data-action="open-task-modal" data-id="${p.id}">＋ Nouvelle tâche</button>
  </div>
  <div class="chips">
    <span class="chip">✅ Terminées : <b>${nDone}/${tasks.length}</b></span>
    <span class="chip">📊 Avancement moyen : <b>${avg} %</b></span>
    ${nLate ? `<span class="chip" style="border-color:var(--red);color:var(--red)">🔴 En retard : <b>${nLate}</b></span>` : '<span class="chip">⏱ Aucun retard</span>'}
  </div>
  ${ganttHtml(tasks)}
  <p class="muted"><small>💡 Touchez une tâche (nom ou barre) pour la modifier. Une tâche avec début = fin s'affiche en jalon ◆. La ligne rouge = aujourd'hui.</small></p>`;
}

/* ============================================================
   IMPORT DE PLANNING (collage Excel / fichier CSV)
   ============================================================ */
function parseDateFlexible(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return null;
}

function parsePlanningText(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\r/g, '')).filter(l => l.trim());
  if (!lines.length) return { rows: [], error: 'Aucune ligne détectée.' };
  const delims = ['\t', ';', ','];
  let delim = delims[0], best = 0;
  for (const d of delims) {
    const c = Math.max(...lines.slice(0, 10).map(l => l.split(d).length));
    if (c > best) { best = c; delim = d; }
  }
  if (best < 2) return { rows: [], error: 'Format non reconnu — utilisez des colonnes séparées par des tabulations (collage Excel), des points-virgules ou des virgules.' };

  let rows = lines.map(l => l.split(delim).map(c => c.trim()));
  const head = (rows[0] || []).join(' ').toLowerCase();
  if (/t[aâ]che|task|d[eé]but|start|fin|avancement|progress/.test(head) && !parseDateFlexible(rows[0][0])) rows = rows.slice(1);

  const parsed = rows.map(cols => {
    const dateIdx = [];
    cols.forEach((c, i) => { if (parseDateFlexible(c)) dateIdx.push(i); });
    const name = (cols[0] || '').trim();
    let start = null, end = null, trade = '', progress = 0;
    if (dateIdx.length >= 2) {
      start = parseDateFlexible(cols[dateIdx[0]]);
      end = parseDateFlexible(cols[dateIdx[1]]);
      trade = cols.slice(1, dateIdx[0]).join(' ').trim();
    } else if (dateIdx.length === 1) {
      start = parseDateFlexible(cols[dateIdx[0]]);
      end = start;
      trade = cols.slice(1, dateIdx[0]).join(' ').trim();
    }
    for (let i = cols.length - 1; i > 0; i--) {
      const pm = (cols[i] || '').match(/^(\d{1,3})\s*%?$/);
      if (pm && !parseDateFlexible(cols[i])) { progress = Math.min(100, +pm[1]); break; }
    }
    if (start && end && end < start) { const tmp = start; start = end; end = tmp; }
    const err = !name ? '' : (!start ? 'Dates introuvables' : '');
    return { name, trade, start, end, progress, ok: !!name && !!start, err };
  }).filter(r => r.name || r.err);
  return { rows: parsed };
}

const CSV_MODEL = '\ufeffTâche;Corps de métier;Début;Fin;Avancement (%)\nTerrassement & implantation;Terrassement;01/09/2026;05/09/2026;0\nFouilles & fondations;Maçonnerie;06/09/2026;15/09/2026;0\nDalle RDC;Maçonnerie;16/09/2026;22/09/2026;0\nLivraison acier étage;Approvisionnement;25/09/2026;25/09/2026;0\nCharpente & toiture;Charpente;01/10/2026;12/10/2026;0\n';

function openImportTasksModal(pid, parsed) {
  if (!Array.isArray(parsed)) {
    openModal(`
    <h2>⬆ Importer un planning</h2>
    <p class="muted">Deux méthodes : <b>① copiez votre planning dans Excel</b> (zone avec les colonnes) puis collez-le ci-dessous, ou <b>② importez un fichier .csv</b>. Ordre des colonnes attendu : <i>Tâche · Corps de métier · Début · Fin · Avancement %</i> (dates jj/mm/aaaa ou aaaa-mm-jj).</p>
    <div class="toolbar" style="margin-bottom:10px">
      <a class="btn btn-ghost btn-sm" download="modele-planning.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent(CSV_MODEL)}">⬇ Télécharger le modèle CSV</a>
      <button class="btn btn-ghost btn-sm" id="btn-pick-csv">📂 Choisir un fichier .csv</button>
      <input type="file" id="import-csv-input" accept=".csv,text/csv,text/plain" hidden>
    </div>
    <textarea id="import-text" class="field" rows="8" style="width:100%;font-family:inherit;font-size:.9rem;border:1px solid var(--line);border-radius:10px;padding:10px 12px" placeholder="Collez ici votre planning (Ctrl+V)…&#10;Ex : Terrassement&#9;Terrassement&#9;01/09/2026&#9;05/09/2026&#9;0"></textarea>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" id="btn-analyze" type="button">Analyser → Prévisualiser</button>
    </div>`);
    $('#btn-pick-csv').addEventListener('click', () => $('#import-csv-input').click());
    $('#import-csv-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) $('#import-text').value = await f.text();
    });
    $('#btn-analyze').addEventListener('click', () => {
      const txt = $('#import-text').value;
      const res = parsePlanningText(txt);
      if (res.error) { alert('⚠️ ' + res.error); return; }
      if (!res.rows.length) { alert('⚠️ Aucune tâche détectée dans ce texte.'); return; }
      openImportTasksModal(pid, res.rows);
    });
    return;
  }

  const okRows = parsed.filter(r => r.ok);
  openModal(`
  <h2>🔍 Prévisualisation de l'import</h2>
  <p class="muted">${okRows.length} tâche(s) valide(s) détectée(s)${parsed.length - okRows.length ? ` · <b style="color:var(--red)">${parsed.length - okRows.length} ligne(s) ignorée(s)</b> (dates introuvables)` : ''}. Décochez celles à exclure.</p>
  <div class="table-wrap" style="max-height:340px;overflow-y:auto"><table class="table">
    <thead><tr><th></th><th>Tâche</th><th>Corps de métier</th><th>Début</th><th>Fin</th><th class="r">Av.</th></tr></thead>
    <tbody>
      ${parsed.map((r, i) => r.ok ? `
      <tr>
        <td><input type="checkbox" class="imp-check" data-i="${i}" checked></td>
        <td><b>${esc(r.name)}</b></td>
        <td>${esc(r.trade || '—')}</td>
        <td class="nowrap">${fmtDate(r.start)}</td>
        <td class="nowrap">${fmtDate(r.end)}</td>
        <td class="r">${r.progress} %</td>
      </tr>` : `
      <tr style="opacity:.55">
        <td><input type="checkbox" disabled></td>
        <td>${esc(r.name || '(ligne vide)')}</td>
        <td colspan="4"><span class="badge red">${esc(r.err || 'illisible')}</span></td>
      </tr>`).join('')}
    </tbody>
  </table></div>
  <div class="form-actions">
    <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
    <button class="btn btn-primary" id="btn-do-import" type="button">✅ Importer les tâches cochées</button>
  </div>`, 'wide');

  $('#btn-do-import').addEventListener('click', () => {
    const idx = $$('.imp-check:checked').map(c => +c.dataset.i);
    let n = 0;
    idx.forEach(i => {
      const r = parsed[i];
      if (!r || !r.ok) return;
      Store.data.tasks.push({
        id: uid(), projectId: pid, createdAt: Date.now(),
        name: r.name, trade: r.trade, start: r.start, end: r.end, progress: r.progress
      });
      n++;
    });
    Store.save();
    closeModal();
    render();
    alert(`✅ ${n} tâche(s) importée(s) — le diagramme de Gantt est généré automatiquement.`);
  });
}

function exportTasksCsv(pid) {
  const p = Store.project(pid);
  const tasks = Store.tasksOf(pid);
  if (!tasks.length) { alert('Aucune tâche à exporter.'); return; }
  const q2 = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Tâche', 'Corps de métier', 'Début', 'Fin', 'Avancement (%)'].map(q2).join(';')];
  tasks.forEach(t => lines.push([
    t.name, t.trade || '',
    t.start ? t.start.split('-').reverse().join('/') : '',
    t.end ? t.end.split('-').reverse().join('/') : '',
    t.progress || 0
  ].map(q2).join(';')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'planning-' + (p ? p.name : 'chantier').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 6000);
}

function ganttHtml(tasks) {
  const DAY_W = 28, LABEL_W = 230;
  const today = todayISO();
  let minD = tasks.map(t => t.start).reduce((a, b) => (a < b ? a : b));
  let maxD = tasks.map(t => t.end).reduce((a, b) => (a > b ? a : b));
  if (today < minD) minD = today;
  if (today > maxD) maxD = today;
  minD = addDays(minD, -2);
  maxD = addDays(maxD, 3);
  const N = daysBetween(minD, maxD) + 1;

  let cells = '';
  for (let i = 0; i < N; i++) {
    const d = addDays(minD, i);
    const sun = parseD(d).getDay() === 0;
    const dm = d.slice(8, 10);
    cells += `<div class="g-day ${sun ? 'sun' : ''}">${+dm}${(dm === '01' || i === 0) ? `<span>${monthShort(d)}</span>` : ''}</div>`;
  }

  const rowHtml = (t, inner) => `
    <div class="g-row">
      <div class="g-label" data-action="edit-task" data-id="${t.id}">
        <b>${esc(t.name)}</b>
        <span>${esc(t.trade || '—')} · ${fmtDate(t.start)} → ${fmtDate(t.end)}${(+t.progress || 0) < 100 && t.end < today ? ' · <b style="color:var(--red)">en retard</b>' : ''}</span>
      </div>
      <div class="g-track" style="width:${N * DAY_W}px">${inner}</div>
    </div>`;

  const rows = tasks.map(t => {
    const st = taskState(t);
    const late = (+t.progress || 0) < 100 && t.end < today;
    const off = daysBetween(minD, t.start) * DAY_W;
    if (t.start === t.end) {
      return rowHtml(t, `
        <span class="g-ms ${st} ${late ? 'delayed' : ''}" style="left:${off + DAY_W / 2}px" data-action="edit-task" data-id="${t.id}" title="Jalon : ${esc(t.name)} — ${fmtDate(t.start)}"></span>
        <span class="g-ms-lbl" style="left:${off + DAY_W + 4}px">◆ ${esc(t.name)}</span>`);
    }
    const w = (daysBetween(t.start, t.end) + 1) * DAY_W;
    return rowHtml(t, `
      <div class="g-bar ${st} ${late ? 'delayed' : ''}" style="left:${off}px;width:${w}px" data-action="edit-task" data-id="${t.id}" title="${esc(t.name)} · ${fmtDate(t.start)} → ${fmtDate(t.end)} · ${t.progress}%">
        <i style="width:${t.progress}%"></i><span>${t.progress}%</span>
      </div>`);
  }).join('');

  const todayOff = (today >= minD && today <= maxD) ? LABEL_W + daysBetween(minD, today) * DAY_W + DAY_W / 2 : null;

  return `<div class="gantt-scroll"><div class="gantt" style="min-width:${LABEL_W + N * DAY_W}px">
    <div class="g-header">
      <div class="g-corner">Tâches (${tasks.length})</div>
      <div class="g-days">${cells}</div>
    </div>
    ${rows}
    ${todayOff != null ? `<div class="g-today" style="left:${todayOff}px"><b>Aujourd'hui</b></div>` : ''}
  </div></div>`;
}

function openTaskModal(pid, task) {
  const t = task || null;
  const ds = t && t.start ? t.start : todayISO();
  const de = t && t.end ? t.end : addDays(todayISO(), 7);
  openModal(`
  <h2>${t ? '✏️ Modifier la tâche' : '📅 Nouvelle tâche'}</h2>
  <form id="form-task">
    <label class="field"><span>Nom de la tâche *</span>
      <input name="name" required value="${esc(t ? t.name : '')}" placeholder="Ex : Coulage dalle étage"></label>
    <label class="field"><span>Corps de métier</span>
      <input name="trade" list="dl-trades" value="${esc(t ? (t.trade || '') : '')}" placeholder="Ex : Maçonnerie">
      <datalist id="dl-trades">${TRADES.map(x => `<option value="${x}">`).join('')}</datalist></label>
    <div class="form-row">
      <label class="field"><span>Début *</span><input type="date" name="start" value="${ds}" required></label>
      <label class="field"><span>Fin prévue *</span><input type="date" name="end" value="${de}" required></label>
    </div>
    <label class="field"><span>Avancement : <b id="task-p-out">${t ? (t.progress || 0) : 0} %</b></span>
      <input type="range" id="task-progress" name="progress" min="0" max="100" step="5" value="${t ? (t.progress || 0) : 0}" style="width:100%"></label>
    <p class="muted"><small>💡 100 % = tâche terminée. Début = fin → jalon ◆ sur le planning. Une tâche non terminée après sa fin prévue est marquée <b style="color:var(--red)">en retard</b>.</small></p>
    <div class="form-actions">
      ${t ? `<button type="button" class="btn btn-danger" data-action="delete-task" data-id="${t.id}">🗑 Supprimer</button><span class="grow"></span>`
          : `<button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>`}
      <button class="btn btn-primary" type="submit">${t ? 'Enregistrer' : 'Créer la tâche'}</button>
    </div>
  </form>`);

  const rg = $('#task-progress');
  if (rg) rg.addEventListener('input', e => { $('#task-p-out').textContent = e.target.value + ' %'; });
  $('#form-task').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let s = fd.get('start'), e2 = fd.get('end');
    if (e2 < s) { const tmp = s; s = e2; e2 = tmp; }
    const vals = {
      name: (fd.get('name') || '').trim(),
      trade: (fd.get('trade') || '').trim(),
      start: s, end: e2,
      progress: Math.max(0, Math.min(100, Math.round(+fd.get('progress') || 0)))
    };
    if (!vals.name) return;
    if (t) Object.assign(t, vals);
    else Store.data.tasks.push({ id: uid(), projectId: pid, createdAt: Date.now(), ...vals });
    Store.save(); closeModal(); render();
  });
}

function deleteTask(id) {
  const t = Store.data.tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Supprimer la tâche « ${t.name} » ?`)) return;
  Store.data.tasks = Store.data.tasks.filter(x => x.id !== id);
  Store.save(); closeModal(); render();
}

/* ---------------- Onglet Dépenses ---------------- */
function tabExpenses(p, expenses) {
  const totals = {};
  expenses.forEach(e => { totals[e.category] = (totals[e.category] || 0) + (+e.amount || 0); });
  const cats = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const total = expenses.reduce((t, e) => t + (+e.amount || 0), 0);

  if (!expenses.length) {
    return `<div class="empty small">
      <h2>Aucune dépense</h2>
      <p class="muted">Enregistrez chaque dépense (avec photo du reçu) pour suivre le budget en temps réel.</p>
      <button class="btn btn-primary" data-action="open-expense-modal" data-id="${p.id}">＋ Ajouter la première dépense</button>
    </div>`;
  }
  return `
  <div class="toolbar end">
    <button class="btn btn-primary" data-action="open-expense-modal" data-id="${p.id}">＋ Ajouter une dépense</button>
  </div>
  <div class="chips">${cats.map(([c, v]) => `<span class="chip">${esc(c)} : <b>${fmtAr(v)}</b></span>`).join('')}</div>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th class="r">Montant</th><th></th></tr></thead>
    <tbody>
      ${expenses.map(e => `
      <tr>
        <td class="nowrap">${fmtDate(e.date)}</td>
        <td><span class="chip">${esc(e.category)}</span></td>
        <td>${esc(e.description)} ${e.receipt ? `<button class="link" data-action="view-photo" data-pid="${e.receipt}" title="Voir le reçu">🧾 reçu</button>` : ''}</td>
        <td class="r nowrap"><b>${fmtAr(e.amount)}</b></td>
        <td class="r"><button class="btn btn-danger btn-xs" data-action="delete-expense" data-id="${e.id}" title="Supprimer">🗑</button></td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr><td colspan="3"><b>Total</b></td><td class="r"><b>${fmtAr(total)}</b></td><td></td></tr></tfoot>
  </table></div>`;
}

/* ---------------- Onglet Matériaux & stocks ---------------- */
function stockBadge(m) {
  const s = Store.stockOf(m.id);
  if (s <= 0) return `<span class="badge red">Rupture</span>`;
  if (s <= (m.threshold || 0)) return `<span class="badge amber">Stock bas</span>`;
  return `<span class="badge green">OK</span>`;
}

function tabMaterials(p) {
  const mats = Store.materialsOf(p.id);
  const dels = Store.deliveriesOf(p.id);
  const uses = Store.usesOf(p.id);
  const toolbar = `
  <div class="toolbar end">
    <button class="btn btn-ghost" data-action="open-material-modal" data-id="${p.id}">＋ Matériau</button>
    <button class="btn btn-ghost" data-action="open-use-modal" data-id="${p.id}" ${mats.length ? '' : 'disabled'}>− Consommation</button>
    <button class="btn btn-primary" data-action="open-delivery-modal" data-id="${p.id}" ${mats.length ? '' : 'disabled'}>📦 Livraison</button>
  </div>`;

  if (!mats.length) {
    return `<div class="empty small">
      <h2>Suivi des matériaux</h2>
      <p class="muted">Créez vos matériaux suivis (ciment, acier, sable…), enregistrez les livraisons (avec photo du bon et signalement des non-conformités) et les consommations. ChantierPro calcule le stock en temps réel et vous alerte avant la rupture.</p>
      <button class="btn btn-primary" data-action="open-material-modal" data-id="${p.id}">＋ Créer le premier matériau</button>
    </div>`;
  }

  const stockRows = mats.map(m => `
    <tr>
      <td><b>${esc(m.name)}</b></td>
      <td class="r nowrap"><span class="${Store.stockOf(m.id) <= (m.threshold || 0) ? 'stock-bas' : 'stock-ok'}">${fmtQty(Store.stockOf(m.id), m.unit)}</span></td>
      <td class="r nowrap muted">${fmtQty(m.threshold, m.unit)}</td>
      <td>${stockBadge(m)}</td>
      <td class="r"><button class="btn btn-danger btn-xs" data-action="delete-material" data-id="${m.id}" title="Supprimer">🗑</button></td>
    </tr>`).join('');

  const delRows = dels.slice(0, 25).map(d => {
    const m = Store.material(d.materialId);
    const st = DELIVERY_STATUS[d.status] || DELIVERY_STATUS.conforme;
    return `<tr>
      <td class="nowrap">${fmtDate(d.date)}</td>
      <td>${esc(m ? m.name : '—')}</td>
      <td class="r nowrap qty-pos">+${fmtQty(d.qty, m ? m.unit : '')}</td>
      <td>${esc(d.supplier || '—')}${d.code ? `<br><small class="muted">Réf : ${esc(d.code)}</small>` : ''}</td>
      <td><span class="badge ${st.cls}">${st.label}</span>${d.note ? `<br><small class="muted">${esc(oneLine(d.note))}</small>` : ''}</td>
      <td class="nowrap">${(d.photos || []).length ? `<button class="link" data-action="view-photo" data-pid="${d.photos[0]}">📷 ${d.photos.length}</button>` : ''}</td>
      <td class="r"><button class="btn btn-danger btn-xs" data-action="delete-delivery" data-id="${d.id}" title="Supprimer">🗑</button></td>
    </tr>`;
  }).join('');

  const useRows = uses.slice(0, 25).map(u => {
    const m = Store.material(u.materialId);
    return `<tr>
      <td class="nowrap">${fmtDate(u.date)}</td>
      <td>${esc(m ? m.name : '—')}</td>
      <td class="r nowrap qty-neg">−${fmtQty(u.qty, m ? m.unit : '')}</td>
      <td>${esc(u.note || '—')}</td>
      <td class="r"><button class="btn btn-danger btn-xs" data-action="delete-use" data-id="${u.id}" title="Supprimer">🗑</button></td>
    </tr>`;
  }).join('');

  return `
  ${toolbar}
  <h3>📊 Stocks en temps réel</h3>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Matériau</th><th class="r">En stock</th><th class="r">Seuil d'alerte</th><th>État</th><th></th></tr></thead>
    <tbody>${stockRows}</tbody>
  </table></div>
  <p class="muted"><small>Stock = livraisons conformes − consommations. Les livraisons endommagées ou non conformes sont tracées mais ne rentrent pas dans le stock.</small></p>

  <h3>📦 Livraisons récentes</h3>
  ${dels.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Date</th><th>Matériau</th><th class="r">Quantité</th><th>Fournisseur</th><th>Conformité</th><th></th><th></th></tr></thead>
    <tbody>${delRows}</tbody>
  </table></div>` : '<p class="muted">Aucune livraison enregistrée.</p>'}

  <h3>⛏️ Consommations récentes</h3>
  ${uses.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th>Date</th><th>Matériau</th><th class="r">Quantité</th><th>Utilisation</th><th></th></tr></thead>
    <tbody>${useRows}</tbody>
  </table></div>` : '<p class="muted">Aucune consommation enregistrée.</p>'}`;
}

/* ---------------- Onglet Réserves (punch list) ---------------- */
function tabReserves(p, filter) {
  const all = Store.defectsOf(p.id);
  const plans = Store.plansOf(p.id);
  const nOuv = all.filter(d => d.status === 'ouvert').length;
  const nEnc = all.filter(d => d.status === 'en_cours').length;
  const nLev = all.filter(d => d.status === 'leve').length;
  const nLate = all.filter(isOverdue).length;

  let list = sortDefects(all);
  if (filter !== 'all') list = list.filter(d => d.status === filter);

  const fchip = (key, label, count) =>
    `<a class="chip ${filter === key ? 'on' : ''}" href="#/projet/${p.id}?tab=reserves&f=${key}">${label} (${count})</a>`;

  return `
  <div class="toolbar end">
    <button class="btn btn-ghost" data-action="open-defect-modal" data-id="${p.id}">＋ Réserve (sans plan)</button>
    <button class="btn btn-primary" data-action="add-plan">🗺️ Ajouter un plan</button>
    <input type="file" id="plan-input" accept="image/*" multiple hidden>
  </div>

  <div class="chips">
    <span class="chip">🟠 Ouvertes : <b>${nOuv}</b></span>
    <span class="chip">🟡 En cours : <b>${nEnc}</b></span>
    <span class="chip">🟢 Levées : <b>${nLev}</b></span>
    ${nLate ? `<span class="chip" style="border-color:var(--red);color:var(--red)">🔴 En retard : <b>${nLate}</b></span>` : ''}
  </div>

  ${plans.length ? `<h3>🗺️ Plans du chantier</h3>
  <div class="plan-grid">
    ${plans.map(pl => {
      const n = Store.defectsOf(p.id).filter(d => d.planId === pl.id && d.status !== 'leve').length;
      return `<a class="card plan-card" href="#/projet/${p.id}/plan/${pl.id}">
        <img data-photo-id="${pl.photoId}" alt="${esc(pl.name)}">
        <div class="plan-card-body"><b>${esc(pl.name)}</b><span class="muted">${n ? n + ' réserve(s) ouverte(s)' : 'Aucune réserve'}</span></div>
      </a>`;
    }).join('')}
  </div>
  <p class="muted"><small>💡 Ouvrez un plan puis cliquez directement sur un emplacement pour y pointer une réserve (fissure, défaut d'étanchéité…).</small></p>`
  : `<p class="muted">💡 Ajoutez un plan (photo ou scan) pour pointer les défauts directement dessus.</p>`}

  <h3>📋 Réserves</h3>
  <div class="mini-filter">
    ${fchip('all', 'Toutes', all.length)}
    ${fchip('ouvert', '🟠 Ouvertes', nOuv)}
    ${fchip('en_cours', '🟡 En cours', nEnc)}
    ${fchip('leve', '🟢 Levées', nLev)}
  </div>
  ${list.length ? `<div class="list">
    ${list.map(d => {
      const pl = d.planId ? Store.plan(d.planId) : null;
      return `<button class="list-row asbtn" data-action="open-defect" data-id="${d.id}">
        ${defDot(d.status)}
        <div class="grow" style="text-align:left">
          <b>${esc(d.title)}</b> ${isOverdue(d) ? '<span class="badge red">en retard</span>' : ''}<br>
          <span class="muted">${esc(d.trade || '—')}${pl ? ' · ' + esc(pl.name) : ''}${d.deadline ? ' · échéance ' + fmtDate(d.deadline) : ''}</span>
        </div>
        ${defBadge(d)}
        <span class="chev">›</span>
      </button>`;
    }).join('')}
  </div>` : '<p class="muted">Aucune réserve' + (filter !== 'all' ? ' dans ce filtre' : '') + '.</p>'}`;
}

/* ---------------- Onglet Infos ---------------- */
function tabInfos(p) {
  const st = STATUS[p.status] || STATUS.actif;
  const nbReports = Store.reportsOf(p.id).length;
  const statusBtns = p.status === 'actif'
    ? `<button class="btn btn-ghost" data-action="toggle-status" data-id="${p.id}" data-status="pause">⏸ Mettre en pause</button>
       <button class="btn btn-ghost" data-action="toggle-status" data-id="${p.id}" data-status="termine">✔ Marquer terminé</button>`
    : p.status === 'pause'
      ? `<button class="btn btn-ghost" data-action="toggle-status" data-id="${p.id}" data-status="actif">▶ Reprendre le chantier</button>
         <button class="btn btn-ghost" data-action="toggle-status" data-id="${p.id}" data-status="termine">✔ Marquer terminé</button>`
      : `<button class="btn btn-ghost" data-action="toggle-status" data-id="${p.id}" data-status="actif">↩ Rouvrir le chantier</button>`;

  return `
  <div class="cols">
    <div class="card pad">
      <h3 style="margin-top:0">Informations</h3>
      <dl class="dl">
        <dt>Statut</dt><dd><span class="badge ${st.cls}">${st.label}</span></dd>
        <dt>Client</dt><dd>${esc(p.client || '—')}</dd>
        <dt>Lieu</dt><dd>${esc(p.location || '—')}</dd>
        <dt>Date de début</dt><dd>${fmtDate(p.startDate, true)}</dd>
        <dt>Budget prévu</dt><dd>${p.budget ? fmtAr(p.budget) : '—'}</dd>
        <dt>Notes</dt><dd>${nl2br(p.notes) || '—'}</dd>
      </dl>
      <div class="toolbar">
        <button class="btn btn-primary" data-action="edit-project" data-id="${p.id}">✏️ Modifier</button>
        ${statusBtns}
      </div>
    </div>
    <div class="card pad">
      <h3 style="margin-top:0">Zone dangereuse</h3>
      <p class="muted">La suppression efface le chantier et tout son contenu : ${nbReports} rapport(s), dépenses, stocks, plans, réserves et photos associées.</p>
      <button class="btn btn-danger" data-action="delete-project" data-id="${p.id}">🗑 Supprimer ce chantier</button>
    </div>
  </div>`;
}

/* ============================================================
   MODULE : Pointage du personnel
   ============================================================ */
let pointageDate = todayISO();

function attachPointageWatcher(pid) {
  const di = $('#pointage-date');
  if (di) di.addEventListener('change', e => {
    pointageDate = e.target.value || todayISO();
    refreshPointage(pid);
  });
}
function refreshPointage(pid) {
  const body = $('.tab-body');
  const p = Store.project(pid);
  if (!body || !p) return;
  body.innerHTML = tabPointage(p);
  attachPointageWatcher(pid);
}

function tabPointage(p) {
  const date = pointageDate > todayISO() ? todayISO() : pointageDate;
  const workers = Store.workersOf(p.id);
  const todays = Store.data.attendance.filter(a => a.projectId === p.id && a.date === date);
  const nP = todays.filter(a => a.status === 'present').length;
  const nD = todays.filter(a => a.status === 'demi').length;
  const nA = todays.filter(a => a.status === 'absent').length;
  const monthKey = date.slice(0, 7);
  const monthLbl = new Date(monthKey + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const recap = workers.map(w => {
    const wa = Store.data.attendance.filter(a => a.workerId === w.id && a.date.startsWith(monthKey));
    const rP = wa.filter(a => a.status === 'present').length;
    const rD = wa.filter(a => a.status === 'demi').length;
    const j = rP + 0.5 * rD;
    return { w, nP: rP, nD: rD, j, cost: j * (w.dailyRate || 0) };
  });
  const totalJ = recap.reduce((t, r) => t + r.j, 0);
  const totalCost = recap.reduce((t, r) => t + r.cost, 0);

  return `
  <div class="toolbar" style="justify-content:space-between">
    <label class="inline-date"><span>📅 Date du pointage</span>
      <input type="date" id="pointage-date" value="${date}" max="${todayISO()}"></label>
    <button class="btn btn-primary" data-action="open-worker-modal" data-id="${p.id}">＋ Ouvrier</button>
  </div>
  ${workers.length ? `
  <div class="chips">
    <span class="chip">✅ Présents : <b>${nP}</b></span>
    <span class="chip">½ Demi-journées : <b>${nD}</b></span>
    <span class="chip">⛔ Absents : <b>${nA}</b></span>
    <span class="chip">Non pointés : <b>${workers.length - nP - nD - nA}</b></span>
  </div>
  <div class="att-wrap">
    ${workers.map(w => {
      const st = (todays.find(a => a.workerId === w.id) || {}).status || null;
      return `
    <div class="att-row">
      <div class="grow"><b>${esc(w.name)}</b><br>
        <span class="muted">${esc(w.trade || '—')}${w.dailyRate ? ' · ' + fmtAr(w.dailyRate) + '/j' : ''}</span></div>
      <div class="seg">
        <button class="seg-p ${st === 'present' ? 'on' : ''}" data-action="set-att" data-id="${w.id}" data-status="present">✅ Présent</button>
        <button class="seg-d ${st === 'demi' ? 'on' : ''}" data-action="set-att" data-id="${w.id}" data-status="demi" title="Demi-journée">½</button>
        <button class="seg-a ${st === 'absent' ? 'on' : ''}" data-action="set-att" data-id="${w.id}" data-status="absent">⛔ Absent</button>
      </div>
      <button class="btn btn-danger btn-xs" data-action="delete-worker" data-id="${w.id}" title="Retirer du registre">🗑</button>
    </div>`;
    }).join('')}
  </div>
  <p class="muted"><small>💡 Touchez un statut pour pointer ; retouchez-le pour annuler. Enregistrement immédiat, hors-ligne.</small></p>
  <h3>📊 Récapitulatif — ${monthLbl}</h3>
  <div class="table-wrap"><table class="table">
    <thead><tr><th>Ouvrier</th><th>Métier</th><th class="r">Présences</th><th class="r">½ j.</th><th class="r">Total jours</th><th class="r">Taux/j</th><th class="r">Coût estimé</th></tr></thead>
    <tbody>${recap.map(r => `<tr>
      <td><b>${esc(r.w.name)}</b></td><td>${esc(r.w.trade || '—')}</td>
      <td class="r">${r.nP}</td><td class="r">${r.nD}</td><td class="r"><b>${fmtQty(r.j, 'j')}</b></td>
      <td class="r">${r.w.dailyRate ? fmtAr(r.w.dailyRate) : '—'}</td>
      <td class="r"><b>${r.w.dailyRate ? fmtAr(r.cost) : '—'}</b></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr><td colspan="4"><b>Total main-d'œuvre</b></td><td class="r"><b>${fmtQty(totalJ, 'j')}</b></td><td></td><td class="r"><b>${fmtAr(totalCost)}</b></td></tr></tfoot>
  </table></div>
  <p class="muted"><small>Le récapitulatif aide à préparer les paies. Il est aussi inclus dans le rapport PDF (« Pointage du personnel »).</small></p>`
  : `<div class="empty small">
      <h2>Registre du personnel</h2>
      <p class="muted">Ajoutez vos ouvriers une seule fois, puis pointez chaque jour : présent, demi-journée ou absent. ChantierPro calcule automatiquement les jours travaillés et le coût de la main-d'œuvre.</p>
      <button class="btn btn-primary" data-action="open-worker-modal" data-id="${p.id}">＋ Ajouter le premier ouvrier</button>
    </div>`}`;
}

function setAttendance(workerId, status) {
  const w = Store.data.workers.find(x => x.id === workerId);
  if (!w) return;
  const date = pointageDate > todayISO() ? todayISO() : pointageDate;
  const rec = Store.data.attendance.find(a => a.workerId === workerId && a.date === date);
  if (rec && rec.status === status) {
    Store.data.attendance = Store.data.attendance.filter(a => a.id !== rec.id);
  } else if (rec) {
    rec.status = status;
  } else {
    Store.data.attendance.push({ id: uid(), projectId: w.projectId, workerId, date, status, createdAt: Date.now() });
  }
  Store.save();
  refreshPointage(w.projectId);
}

function openWorkerModal(pid) {
  openModal(`
  <h2>👷 Ajouter un ouvrier au registre</h2>
  <form id="form-worker">
    <label class="field"><span>Nom complet *</span><input name="name" required placeholder="Ex : Jean Randria"></label>
    <div class="form-row">
      <label class="field"><span>Métier</span>
        <input name="trade" list="dl-metiers" placeholder="Ex : Maçon">
        <datalist id="dl-metiers">${['Maçon', 'Ferrailleur', 'Électricien', 'Plombier', 'Menuisier', 'Peintre', 'Carreleur', 'Coffreur', 'Manœuvre', 'Autre'].map(x => `<option value="${x}">`).join('')}</datalist></label>
      <label class="field"><span>Taux journalier (Ar/j)</span><input type="number" name="dailyRate" min="0" step="any" placeholder="Ex : 25000"></label>
    </div>
    <p class="muted"><small>Le taux journalier permet d'estimer le coût de la main-d'œuvre dans le récapitulatif mensuel et le rapport PDF.</small></p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Ajouter au registre</button>
    </div>
  </form>`);

  $('#form-worker').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Store.data.workers.push({
      id: uid(), projectId: pid, createdAt: Date.now(), active: true,
      name: (fd.get('name') || '').trim(),
      trade: (fd.get('trade') || '').trim(),
      dailyRate: parseNum(fd.get('dailyRate'))
    });
    Store.save(); closeModal(); render();
  });
}

async function deleteWorker(id) {
  const w = Store.data.workers.find(x => x.id === id);
  if (!w) return;
  if (!confirm(`Retirer ${w.name} du registre ? Son historique de pointage sera supprimé.`)) return;
  Store.data.workers = Store.data.workers.filter(x => x.id !== id);
  Store.data.attendance = Store.data.attendance.filter(a => a.workerId !== id);
  Store.save();
  render();
}

/* ============================================================
   VUE : Formulaire de rapport journalier
   ============================================================ */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;

function micBtn(target) {
  return SR ? `<button type="button" class="mic-btn" data-action="voice-toggle" data-target="${target}" title="Dicter au micro">🎤</button>` : '';
}
function subsRowHtml(s = { name: '', count: '' }) {
  return `<div class="subs-row">
    <input type="text" class="subs-name" list="dl-trades" placeholder="Corps de métier / entreprise" value="${esc(s.name)}">
    <input type="number" class="subs-count" min="1" placeholder="Nb pers." value="${s.count || ''}">
    <button type="button" class="btn btn-danger btn-xs" data-action="remove-subs-row" title="Retirer">✕</button>
  </div>`;
}

function viewReportForm(app, pid) {
  const p = Store.project(pid);
  if (!p) { app.innerHTML = notFound(); return; }
  PENDS.report = [];
  const t = todayISO();
  const ptToday = Store.data.attendance.filter(a => a.projectId === pid && a.date === t);
  const ptPres = ptToday.filter(a => a.status === 'present').length + 0.5 * ptToday.filter(a => a.status === 'demi').length;

  app.innerHTML = `
  <a class="back-link" href="#/projet/${pid}">← ${esc(p.name)}</a>
  <section class="page-head"><div><h1>Rapport journalier</h1><p class="muted">${esc(p.name)} — remplace le carnet papier</p></div></section>
  <form id="form-report" class="card form-card">
    <datalist id="dl-trades">${TRADES.map(x => `<option value="${x}">`).join('')}</datalist>
    <div class="form-row">
      <label class="field"><span>Date *</span><input type="date" name="date" value="${t}" max="${t}" required></label>
      <label class="field"><span>Météo du jour</span><select name="weather">${WEATHERS.map(w => `<option>${w}</option>`).join('')}</select></label>
    </div>
    <fieldset class="field-set"><legend>Effectifs propres présents</legend>
      <div class="form-row three">
        <label class="field"><span>Ouvriers</span><input type="number" name="workers" min="0" value="0"></label>
        <label class="field"><span>Techniciens</span><input type="number" name="techs" min="0" value="0"></label>
        <label class="field"><span>Ingénieurs</span><input type="number" name="engrs" min="0" value="0"></label>
      </div>
      ${ptPres ? `<p class="muted" style="margin:2px 0 0"><small>👷 Pointage du jour : <b>${ptPres}</b> présent(s) — <button type="button" class="link" data-action="prefill-workers" data-n="${ptPres}">préremplir les effectifs</button></small></p>` : ''}
    </fieldset>
    <fieldset class="field-set"><legend>👥 Sous-traitants présents sur site</legend>
      <div id="subs-rows"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="add-subs-row">＋ Ajouter un corps de métier</button>
    </fieldset>
    <label class="field">
      <span class="voice-line">Travaux réalisés aujourd'hui * ${micBtn('tasks')}</span>
      <textarea name="tasks" rows="4" required placeholder="Ex : Coulage de la dalle RDC — zone B&#10;Ferraillage des poteaux axe 3 à 6 ${SR ? '\n💡 Astuce : cliquez sur 🎤 pour dicter' : ''}"></textarea></label>
    <label class="field"><span>Matériaux (livraisons / utilisation)</span>
      <textarea name="materials" rows="2" placeholder="Ex : Livraison 10 t de ciment CPJ 45 · 3 m³ de sable utilisés"></textarea></label>
    <label class="field">
      <span class="voice-line">Problèmes / incidents / retards ${micBtn('issues')}</span>
      <textarea name="issues" rows="2" placeholder="Ex : Pluie de 14h à 16h — arrêt du coulage"></textarea></label>
    <div class="field"><span>Photos d'avancement (malfaçons → onglet Réserves)</span>
      <div class="thumb-row" id="thumbs-report"></div>
      <div class="toolbar">
        <button type="button" class="btn btn-ghost" data-action="pick-files" data-key="report">📷 Ajouter des photos horodatées</button>
        ${filePicker('report')}
      </div>
      <small class="muted">Compressées automatiquement. Heure et date enregistrées avec le rapport.</small>
    </div>
    <div class="field"><span>Position GPS (optionnel)</span>
      <div class="toolbar">
        <button type="button" class="btn btn-ghost" data-action="get-gps">📍 Ma position</button>
        <span id="gps-out" class="muted">Aucune position</span>
      </div>
    </div>
    <div class="form-actions">
      <a class="btn btn-ghost" href="#/projet/${pid}">Annuler</a>
      <button class="btn btn-primary btn-lg" type="submit">💾 Enregistrer le rapport</button>
    </div>
  </form>`;

  let pendingGPS = null;
  window.__pendingGPS = null;
  $('#subs-rows').innerHTML = subsRowHtml();
  bindFilePicker('report');
  $('#form-report').addEventListener('submit', e => saveReport(e, pid));
}

function toggleVoice(el) {
  const target = el.dataset.target;
  const ta = document.querySelector(`[name="${target}"]`);
  if (!ta) return;
  if (recog) { try { recog.stop(); } catch (e) {} return; }
  try {
    recog = new SR();
    recog.lang = 'fr-FR';
    recog.continuous = true;
    recog.interimResults = false;
    recog.onresult = ev => {
      const txt = [...ev.results].slice(ev.resultIndex).map(r => r[0].transcript).join(' ');
      ta.value = (ta.value ? ta.value.trimEnd() + ' ' : '') + txt;
    };
    const stop = () => { recog = null; $$('.mic-btn').forEach(b => b.classList.remove('rec')); };
    recog.onend = stop;
    recog.onerror = stop;
    recog.start();
    el.classList.add('rec');
    el.title = 'Enregistrement… cliquez pour arrêter';
  } catch (e) { recog = null; }
}

function getGPS() {
  const out = $('#gps-out');
  if (!navigator.geolocation) { if (out) out.textContent = 'GPS non supporté par cet appareil'; return; }
  if (out) out.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      window.__pendingGPS = { lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) };
      if (out) out.textContent = '✅ ' + window.__pendingGPS.lat + ', ' + window.__pendingGPS.lng;
    },
    err => { if (out) out.textContent = '⚠️ Position impossible (' + err.message + ')'; },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

async function saveReport(e, pid) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Enregistrement…';
  try {
    const subs = $$('#subs-rows .subs-row').map(row => ({
      name: row.querySelector('.subs-name').value.trim(),
      count: +row.querySelector('.subs-count').value || 0
    })).filter(s => s.name);
    Store.data.reports.push({
      id: uid(), projectId: pid, createdAt: Date.now(),
      date: fd.get('date') || todayISO(),
      weather: fd.get('weather'),
      workers: +fd.get('workers') || 0, techs: +fd.get('techs') || 0, engrs: +fd.get('engrs') || 0,
      subs,
      tasks: (fd.get('tasks') || '').trim(),
      materials: (fd.get('materials') || '').trim(),
      issues: (fd.get('issues') || '').trim(),
      photos: await storePendPhotos('report'),
      gps: window.__pendingGPS || null
    });
    Store.save();
    window.__pendingGPS = null;
    location.hash = '#/projet/' + pid;
  } finally {
    btn.disabled = false; btn.textContent = '💾 Enregistrer le rapport';
  }
}

/* ============================================================
   VUE : Détail d'un rapport
   ============================================================ */
function viewReportDetail(app, rid) {
  const r = Store.report(rid);
  if (!r) { app.innerHTML = notFound(); return; }
  const p = Store.project(r.projectId);

  app.innerHTML = `
  <a class="back-link" href="#/projet/${r.projectId}">← ${esc(p ? p.name : 'Chantier')}</a>
  <section class="page-head">
    <div>
      <h1>${fmtDate(r.date, true)}</h1>
      <p class="muted">${esc(r.weather || '')} · rapport saisi le ${new Date(r.createdAt).toLocaleDateString('fr-FR')} à ${new Date(r.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${r.gps
        ? ` · 📍 ${r.gps.lat}, ${r.gps.lng} — <a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${r.gps.lat}&mlon=${r.gps.lng}#map=16/${r.gps.lat}/${r.gps.lng}">voir la carte</a>`
        : ''}</p>
    </div>
    <div class="toolbar">
      <button class="btn btn-ghost" data-action="email-report" data-id="${r.id}">✉️ Envoyer par e-mail</button>
      <button class="btn btn-ghost" data-action="print">🖨️ Imprimer</button>
      <button class="btn btn-danger" data-action="delete-report" data-id="${r.id}">🗑 Supprimer</button>
    </div>
  </section>
  <div class="cols">
    <div class="card pad">
      <h3 style="margin-top:0">👷 Effectifs : ${totWorkforce(r)} personne(s)</h3>
      <p class="muted">${r.workers || 0} ouvriers · ${r.techs || 0} techniciens · ${r.engrs || 0} ingénieurs</p>
      ${r.subs && r.subs.length ? `<h3>👥 Sous-traitants présents</h3><p>${r.subs.map(s => `<span class="chip">${esc(s.name)} : <b>${+s.count || 0}</b></span>`).join(' ')}</p>` : ''}
      <h3>✅ Travaux réalisés</h3>
      <p>${nl2br(r.tasks) || '—'}</p>
      ${r.materials ? `<h3>🧱 Matériaux</h3><p>${nl2br(r.materials)}</p>` : ''}
      ${r.issues ? `<div class="alert warn"><b>Problèmes / incidents</b><br>${nl2br(r.issues)}</div>` : ''}
    </div>
    <div class="card pad">
      <h3 style="margin-top:0">📷 Photos (${(r.photos || []).length})</h3>
      ${(r.photos || []).length
        ? `<div class="photo-grid">${r.photos.map(id => `<img data-photo-id="${id}" alt="photo chantier" data-action="view-photo" data-pid="${id}">`).join('')}</div>`
        : '<p class="muted">Aucune photo jointe.</p>'}
    </div>
  </div>`;
}

function emailReport(id) {
  const r = Store.report(id);
  if (!r) return;
  const p = Store.project(r.projectId);
  const body = [
    `Rapport journalier — ${p ? p.name : ''}`,
    `Date : ${fmtDate(r.date, true)}`,
    `Météo : ${r.weather || '—'}`,
    `Effectifs : ${totWorkforce(r)} (${r.workers || 0} ouvriers, ${r.techs || 0} techniciens, ${r.engrs || 0} ingénieurs)`,
    `Sous-traitants : ${(r.subs || []).map(s => `${s.name} (${s.count})`).join(', ') || '—'}`,
    '',
    'Travaux réalisés :', r.tasks || '—', '',
    r.materials ? `Matériaux :\n${r.materials}\n` : '',
    r.issues ? `Incidents :\n${r.issues}\n` : '',
    r.gps ? `Position GPS : ${r.gps.lat}, ${r.gps.lng}` : '',
    `(Photos : ${(r.photos || []).length} — disponibles dans ChantierPro)`,
    '', '— Généré par ChantierPro'
  ].filter(x => x !== '').join('\n');
  location.href = 'mailto:?subject=' + encodeURIComponent('Rapport chantier ' + (p ? p.name : '') + ' — ' + fmtDate(r.date))
    + '&body=' + encodeURIComponent(body);
}

/* ============================================================
   VUE : Rapport périodique imprimable (PDF)
   ============================================================ */
function viewPrintable(app, pid, q) {
  const p = Store.project(pid);
  if (!p) { app.innerHTML = notFound(); return; }
  const from = q.get('du') || '0000-01-01';
  const to = q.get('ju') || '9999-12-31';
  const fromLbl = from === '0000-01-01' ? null : from;
  const toLbl = to === '9999-12-31' ? todayISO() : to;

  const reports = Store.reportsOf(pid).filter(r => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const expenses = Store.expensesOf(pid).filter(e => e.date >= from && e.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const deliveries = Store.deliveriesOf(pid).filter(d => d.date >= from && d.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const defects = Store.defectsOf(pid);
  const totalPer = expenses.reduce((t, e) => t + (+e.amount || 0), 0);
  const spentAll = Store.spentOf(pid);
  const pct = p.budget ? Math.round(spentAll / p.budget * 100) : null;
  const nbPhotos = reports.reduce((t, r) => t + (r.photos || []).length, 0);

  app.innerHTML = `
  <div class="print-actions no-print">
    <a class="btn btn-ghost" href="#/projet/${pid}">← Retour au chantier</a>
    <span class="muted">Vérifiez l'aperçu, puis cliquez sur Imprimer → « Enregistrer au format PDF ».</span>
    <button class="btn btn-primary" data-action="print">🖨️ Imprimer / Enregistrer en PDF</button>
  </div>
  <article class="sheet">
    <header class="sheet-head">
      <div class="sheet-brand">
        <span class="logo-badge big">🏗️</span>
        <div><b>ChantierPro</b><span>Rapport d'avancement de chantier</span></div>
      </div>
      <div class="sheet-meta">Généré le ${new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </header>

    <h1 class="sheet-title">${esc(p.name)}</h1>
    <p class="sheet-sub">
      ${p.client ? `Client : <b>${esc(p.client)}</b> · ` : ''}${p.location ? `Lieu : ${esc(p.location)} · ` : ''}
      Période : <b>${fmtDate(fromLbl)} → ${fmtDate(toLbl)}</b>
    </p>

    <div class="sheet-stats">
      <div><b>${reports.length}</b><span>jour(s) rapporté(s)</span></div>
      <div><b>${nbPhotos}</b><span>photo(s)</span></div>
      <div><b>${fmtAr(totalPer)}</b><span>dépenses période</span></div>
      <div><b>${p.budget ? fmtAr(spentAll) + ' / ' + fmtAr(p.budget) : fmtAr(spentAll)}</b><span>budget consommé${pct !== null ? ' (' + pct + ' %)' : ''}</span></div>
    </div>

    <h2 class="sheet-h2">Journal de chantier</h2>
    ${reports.length ? reports.map(r => `
      <section class="sheet-day">
        <h3>${fmtDate(r.date, true)} <span class="sheet-weather">${esc(r.weather || '')}</span></h3>
        ${r.gps ? `<p class="sheet-gps">Position : ${r.gps.lat}, ${r.gps.lng}</p>` : ''}
        <p><b>Effectifs :</b> ${totWorkforce(r)} personne(s) — ${r.workers || 0} ouvriers · ${r.techs || 0} techniciens · ${r.engrs || 0} ingénieurs</p>
        ${r.subs && r.subs.length ? `<p><b>Sous-traitants présents :</b> ${subsLabel(r)}</p>` : ''}
        <p><b>Travaux réalisés :</b><br>${nl2br(r.tasks) || '—'}</p>
        ${r.materials ? `<p><b>Matériaux :</b><br>${nl2br(r.materials)}</p>` : ''}
        ${r.issues ? `<p class="sheet-issues"><b>⚠ Problèmes / incidents :</b><br>${nl2br(r.issues)}</p>` : ''}
        ${(r.photos || []).length ? `<div class="sheet-photos">${r.photos.map(id => `<img data-photo-id="${id}" alt="photo chantier">`).join('')}</div>` : ''}
      </section>`).join('') : '<p>Aucun rapport sur cette période.</p>'}

    <h2 class="sheet-h2">Dépenses de la période</h2>
    ${expenses.length ? `
    <table class="sheet-table">
      <thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th style="text-align:right">Montant</th></tr></thead>
      <tbody>${expenses.map(e => `<tr><td>${fmtDate(e.date)}</td><td>${esc(e.category)}</td><td>${esc(e.description)}</td><td style="text-align:right">${fmtAr(e.amount)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3"><b>Total période</b></td><td style="text-align:right"><b>${fmtAr(totalPer)}</b></td></tr></tfoot>
    </table>` : '<p>Aucune dépense sur cette période.</p>'}

    ${(() => {
      const workers = Store.workersOf(pid);
      const att = Store.data.attendance.filter(a => a.projectId === pid && a.date >= from && a.date <= to);
      if (!workers.length || !att.length) return '';
      const rows = workers.map(w => {
        const wa = att.filter(a => a.workerId === w.id);
        const nP = wa.filter(a => a.status === 'present').length;
        const nD = wa.filter(a => a.status === 'demi').length;
        if (!nP && !nD) return '';
        const j = nP + 0.5 * nD;
        return `<tr><td>${esc(w.name)}</td><td>${esc(w.trade || '—')}</td><td>${nP}</td><td>${nD}</td><td>${fmtQty(j, 'j')}</td><td style="text-align:right">${w.dailyRate ? fmtAr(w.dailyRate) : '—'}</td><td style="text-align:right">${w.dailyRate ? fmtAr(j * w.dailyRate) : '—'}</td></tr>`;
      }).filter(Boolean).join('');
      if (!rows) return '';
      const total = workers.reduce((t2, w) => {
        const wa = att.filter(a => a.workerId === w.id);
        const j = wa.filter(a => a.status === 'present').length + 0.5 * wa.filter(a => a.status === 'demi').length;
        return t2 + (w.dailyRate ? j * w.dailyRate : 0);
      }, 0);
      return `<h2 class="sheet-h2">Pointage du personnel (période)</h2>
    <table class="sheet-table">
      <thead><tr><th>Ouvrier</th><th>Métier</th><th>Présences</th><th>½ j.</th><th>Total jours</th><th style="text-align:right">Taux/jour</th><th style="text-align:right">Coût estimé</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="6"><b>Total main-d'œuvre estimé (période)</b></td><td style="text-align:right"><b>${fmtAr(total)}</b></td></tr></tfoot>
    </table>`;
    })()}

    ${(() => {
      const tasks = Store.tasksOf(pid);
      if (!tasks.length) return '';
      const rows = tasks.map(t => {
        const late = (+t.progress || 0) < 100 && t.end && t.end < todayISO();
        return `<tr><td>${esc(t.name)}</td><td>${esc(t.trade || '—')}</td><td>${fmtDate(t.start)}</td><td>${fmtDate(t.end)}${late ? ' (en retard)' : ''}</td><td>${t.progress || 0} %</td><td>${TASK_LABELS[taskState(t)]}</td></tr>`;
      }).join('');
      return `<h2 class="sheet-h2">Planning — avancement des tâches</h2>
    <table class="sheet-table">
      <thead><tr><th>Tâche</th><th>Corps de métier</th><th>Début</th><th>Fin prévue</th><th>Avancement</th><th>Statut</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
    })()}

    ${deliveries.length ? `
    <h2 class="sheet-h2">Livraisons de matériaux (période)</h2>
    <table class="sheet-table">
      <thead><tr><th>Date</th><th>Matériau</th><th>Quantité</th><th>Fournisseur</th><th>Conformité</th></tr></thead>
      <tbody>${deliveries.map(d => {
        const m = Store.material(d.materialId);
        const st = DELIVERY_STATUS[d.status] || DELIVERY_STATUS.conforme;
        return `<tr><td>${fmtDate(d.date)}</td><td>${esc(m ? m.name : '—')}</td><td>${fmtQty(d.qty, m ? m.unit : '')}</td><td>${esc(d.supplier || '—')}</td><td>${st.label}${d.note ? ' — ' + esc(oneLine(d.note)) : ''}</td></tr>`;
      }).join('')}</tbody>
    </table>` : ''}

    ${defects.length ? `
    <h2 class="sheet-h2">Contrôle qualité — Réserves</h2>
    <p><b>${defects.filter(d => d.status !== 'leve').length}</b> réserve(s) en cours · <b>${defects.filter(d => d.status === 'leve').length}</b> levée(s)</p>
    ${sortDefects(defects.filter(d => d.status !== 'leve')).length ? `
    <table class="sheet-table">
      <thead><tr><th>Réserve</th><th>Corps de métier</th><th>Échéance</th><th>Statut</th></tr></thead>
      <tbody>${sortDefects(defects.filter(d => d.status !== 'leve')).map(d =>
        `<tr><td>${esc(d.title)}</td><td>${esc(d.trade || '—')}</td><td>${fmtDate(d.deadline)}${isOverdue(d) ? ' (en retard)' : ''}</td><td>${(DEFECT_STATUS[d.status] || {}).label || d.status}</td></tr>`).join('')}
      </tbody>
    </table>` : '<p>Toutes les réserves sont levées. ✔</p>'}` : ''}

    <div class="sheet-sign">
      <div><b>Le chef de chantier</b><span>Nom, date et signature</span><i></i></div>
      <div><b>Le maître d'ouvrage</b><span>Nom, date et signature</span><i></i></div>
    </div>
    <footer class="sheet-foot">Document généré avec ChantierPro — suivi de chantiers BTP</footer>
  </article>`;
}

/* ============================================================
   VUE : Plan avec réserves pointées
   ============================================================ */
function viewPlan(app, pid, planId) {
  const p = Store.project(pid);
  const plan = Store.plan(planId);
  if (!p || !plan) { app.innerHTML = notFound(); return; }
  const defs = Store.defectsOf(pid).filter(d => d.planId === planId && d.x != null);
  const sorted = [...defs].sort((a, b) => a.createdAt - b.createdAt);

  app.innerHTML = `
  <a class="back-link" href="#/projet/${pid}?tab=reserves">← Réserves — ${esc(p.name)}</a>
  <section class="page-head">
    <div><h1>🗺️ ${esc(plan.name)}</h1>
    <p class="muted">${defs.filter(d => d.status !== 'leve').length} réserve(s) ouverte(s) — cliquez sur le plan pour pointer un nouveau défaut</p></div>
    <div class="toolbar">
      <button class="btn btn-danger" data-action="delete-plan" data-id="${plan.id}" data-pid="${p.id}">🗑 Supprimer le plan</button>
    </div>
  </section>
  <div class="plan-wrap" data-action="plan-click" data-pid="${p.id}" data-plan="${plan.id}">
    <img data-photo-id="${plan.photoId}" alt="${esc(plan.name)}" draggable="false">
    ${sorted.map((d, i) => `
      <button class="pin st-${d.status} ${isOverdue(d) ? 'overdue' : ''}" style="left:${d.x}%;top:${d.y}%" data-action="open-defect" data-id="${d.id}" title="${esc(d.title)}">${i + 1}</button>`).join('')}
  </div>
  <div class="legend">
    <span><span class="dot ouvert"></span>Ouverte</span>
    <span><span class="dot en_cours"></span>En cours</span>
    <span><span class="dot leve"></span>Levée</span>
    <span class="muted">· 📍 cliquez sur le plan pour ajouter une réserve à cet endroit</span>
  </div>
  <h3>Réserves pointées sur ce plan</h3>
  ${sorted.length ? `<div class="list">
    ${sortDefects(sorted).map(d => `
      <button class="list-row asbtn" data-action="open-defect" data-id="${d.id}">
        ${defDot(d.status)}
        <div class="grow" style="text-align:left">
          <b>#${sorted.indexOf(d) + 1} — ${esc(d.title)}</b> ${isOverdue(d) ? '<span class="badge red">en retard</span>' : ''}<br>
          <span class="muted">${esc(d.trade || '—')}${d.deadline ? ' · échéance ' + fmtDate(d.deadline) : ''}</span>
        </div>
        ${defBadge(d)}
        <span class="chev">›</span>
      </button>`).join('')}
  </div>` : '<p class="muted">Aucune réserve pointée. Cliquez sur le plan pour en ajouter une.</p>'}`;
}

/* ============================================================
   MODALES — Chantier, Dépense, PDF, Aide
   ============================================================ */
function openProjectModal(id) {
  const p = id ? Store.project(id) : null;
  openModal(`
  <h2>${p ? 'Modifier le chantier' : '🏗️ Nouveau chantier'}</h2>
  <form id="form-project">
    <label class="field"><span>Nom du chantier *</span>
      <input name="name" required value="${esc(p ? p.name : '')}" placeholder="Ex : Construction Villa R+1 — Ambatobe"></label>
    <div class="form-row">
      <label class="field"><span>Client / Maître d'ouvrage</span><input name="client" value="${esc(p ? (p.client || '') : '')}"></label>
      <label class="field"><span>Lieu</span><input name="location" value="${esc(p ? (p.location || '') : '')}" placeholder="Ex : Antananarivo"></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Budget prévu (Ar)</span><input type="number" min="0" step="any" name="budget" value="${p && p.budget ? p.budget : ''}" placeholder="Ex : 180000000"></label>
      <label class="field"><span>Date de début</span><input type="date" name="startDate" value="${p && p.startDate ? p.startDate : todayISO()}"></label>
    </div>
    <label class="field"><span>Description / notes</span><textarea name="notes" rows="2" placeholder="Ex : Villa R+1 de 220 m², gros œuvre + second œuvre">${esc(p ? (p.notes || '') : '')}</textarea></label>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">${p ? 'Enregistrer' : 'Créer le chantier'}</button>
    </div>
  </form>`);

  $('#form-project').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const vals = {
      name: (fd.get('name') || '').trim(),
      client: (fd.get('client') || '').trim(),
      location: (fd.get('location') || '').trim(),
      budget: parseNum(fd.get('budget')),
      startDate: fd.get('startDate') || todayISO(),
      notes: (fd.get('notes') || '').trim()
    };
    if (!vals.name) return;
    if (p) {
      Object.assign(p, vals);
      Store.save(); closeModal(); render();
    } else {
      const nid = uid();
      Store.data.projects.push({ id: nid, status: 'actif', createdAt: Date.now(), ...vals });
      Store.save(); closeModal();
      location.hash = '#/projet/' + nid;
    }
  });
}

function openExpenseModal(pid) {
  PENDS.expense = [];
  openModal(`
  <h2>💰 Ajouter une dépense</h2>
  <form id="form-expense">
    <div class="form-row">
      <label class="field"><span>Date *</span><input type="date" name="date" value="${todayISO()}" required></label>
      <label class="field"><span>Catégorie *</span><select name="category">${EXPENSE_CATS.map(c => `<option>${c}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Description *</span><input name="description" required placeholder="Ex : Achat 50 sacs de ciment CPJ 45"></label>
    <label class="field"><span>Montant (Ar) *</span><input type="number" name="amount" min="1" step="any" required placeholder="Ex : 2500000"></label>
    <div class="field"><span>Reçu / facture (photo, optionnel)</span>
      <div class="thumb-row" id="thumbs-expense"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pick-files" data-key="expense">📷 Ajouter une photo du reçu</button>
      ${filePicker('expense', false)}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Enregistrer</button>
    </div>
  </form>`);

  bindFilePicker('expense');
  $('#form-expense').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ids = await storePendPhotos('expense');
    Store.data.expenses.push({
      id: uid(), projectId: pid, createdAt: Date.now(),
      date: fd.get('date') || todayISO(),
      category: fd.get('category'),
      description: (fd.get('description') || '').trim(),
      amount: parseNum(fd.get('amount')),
      receipt: ids[0] || null
    });
    Store.save(); closeModal(); render();
  });
}

function openPdfModal(pid) {
  const t = todayISO();
  const first = t.slice(0, 8) + '01';
  openModal(`
  <h2>📄 Générer un rapport PDF</h2>
  <p class="muted">Rapport d'avancement complet : journal (avec photos), dépenses, livraisons de matériaux et état des réserves.</p>
  <form id="form-pdf">
    <div class="form-row">
      <label class="field"><span>Du</span><input type="date" name="from" value="${first}" required></label>
      <label class="field"><span>Au</span><input type="date" name="to" value="${t}" required></label>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Générer l'aperçu</button>
    </div>
  </form>`);

  $('#form-pdf').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    closeModal();
    location.hash = `#/projet/${pid}/pdf?du=${fd.get('from')}&ju=${fd.get('to')}`;
  });
}

function openHelp() {
  openModal(`
  <h2>❓ Comment ça marche ?</h2>
  <ul class="help-list">
    <li><b>100 % hors-ligne</b> : vos données et photos restent sur cet appareil. Exportez régulièrement (bouton « Exporter ») comme sauvegarde.</li>
    <li><b>📝 Journal</b> : rapport quotidien avec météo, effectifs, sous-traitants présents, dictée vocale 🎤 (Chrome), photos horodatées/géolocalisées, envoi par e-mail ✉️.</li>
    <li><b>🧱 Matériaux</b> : livraisons (photo du bon + code scannable 📷 sous Chrome), signaler « endommagé / non conforme » avec photo ; le stock se calcule tout seul et alerte avant rupture.</li>
    <li><b>✅ Réserves</b> : importez un plan, cliquez dessus pour pointer un défaut, assignez corps de métier + échéance, levez avec photo de la correction.</li>
    <li><b>📄 PDF</b> : « Rapport PDF » → période → Imprimer → « Enregistrer au format PDF ».</li>
  </ul>
  <p class="muted"><small>🎤 Dictée vocale et 📷 scan de codes : nécessitent Chrome/Edge à jour (API du navigateur). Le reste fonctionne partout, hors-ligne.</small></p>
  <div class="form-actions"><button class="btn btn-primary" data-action="close-modal">Compris</button></div>`);
}

/* ============================================================
   MODALES — Matériaux & stocks
   ============================================================ */
function openMaterialModal(pid) {
  openModal(`
  <h2>🧱 Nouveau matériau suivi</h2>
  <form id="form-material">
    <label class="field"><span>Nom du matériau *</span>
      <input name="name" list="dl-materials" required placeholder="Ex : Ciment CPJ 45">
      <datalist id="dl-materials">${MATERIAL_PRESETS.map(x => `<option value="${x}">`).join('')}</datalist></label>
    <div class="form-row">
      <label class="field"><span>Unité *</span><select name="unit">${UNITS.map(u => `<option>${u}</option>`).join('')}</select></label>
      <label class="field"><span>Seuil d'alerte *</span><input type="number" name="threshold" min="0" step="any" value="5" required></label>
    </div>
    <p class="muted"><small>Quand le stock passera sous ce seuil, une alerte s'affichera sur le tableau de bord.</small></p>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Créer</button>
    </div>
  </form>`);

  $('#form-material').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Store.data.materials.push({
      id: uid(), projectId: pid, createdAt: Date.now(),
      name: (fd.get('name') || '').trim(),
      unit: fd.get('unit'),
      threshold: parseNum(fd.get('threshold'))
    });
    Store.save(); closeModal(); render();
  });
}

function materialOptions(pid) {
  return Store.materialsOf(pid).map(m => `<option value="${m.id}">${esc(m.name)} (stock : ${fmtQty(Store.stockOf(m.id), m.unit)})</option>`).join('');
}

function openDeliveryModal(pid) {
  PENDS.delivery = [];
  const canScan = ('BarcodeDetector' in window) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  openModal(`
  <h2>📦 Enregistrer une livraison</h2>
  <form id="form-delivery">
    <label class="field"><span>Matériau *</span><select name="materialId" required>${materialOptions(pid)}</select></label>
    <div class="form-row">
      <label class="field"><span>Quantité livrée *</span><input type="number" name="qty" min="0" step="any" required placeholder="Ex : 40"></label>
      <label class="field"><span>Date *</span><input type="date" name="date" value="${todayISO()}" required></label>
    </div>
    <div class="form-row">
      <label class="field"><span>Fournisseur</span><input name="supplier" placeholder="Ex : SCOMA Anosy"></label>
      <label class="field"><span>Réf. / code du bon</span>
        <div class="input-btn">
          <input name="code" id="delivery-code" placeholder="Ex : BL-2026-114">
          ${canScan ? `<button type="button" class="btn btn-ghost btn-sm" data-action="scan-code" data-input="delivery-code" title="Scanner un QR / code-barres">📷 Scan</button>` : ''}
        </div></label>
    </div>
    <label class="field"><span>Conformité de la livraison *</span>
      <select name="status">
        <option value="conforme">✅ Conforme — rentre dans le stock</option>
        <option value="endommage">⚠️ Endommagé — tracé, hors stock</option>
        <option value="non_conforme">❌ Non conforme — refusé, hors stock</option>
      </select></label>
    <label class="field"><span>Observations</span><textarea name="note" rows="2" placeholder="Ex : Sable trop argileux — refusé, relivraison demandée"></textarea></label>
    <div class="field"><span>Photo du bon de livraison / du défaut</span>
      <div class="thumb-row" id="thumbs-delivery"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pick-files" data-key="delivery">📷 Ajouter une photo</button>
      ${filePicker('delivery')}
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Enregistrer</button>
    </div>
  </form>`);

  bindFilePicker('delivery');
  $('#form-delivery').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const photos = await storePendPhotos('delivery');
    Store.data.deliveries.push({
      id: uid(), projectId: pid, createdAt: Date.now(),
      materialId: fd.get('materialId'),
      qty: parseNum(fd.get('qty')),
      date: fd.get('date') || todayISO(),
      supplier: (fd.get('supplier') || '').trim(),
      code: (fd.get('code') || '').trim(),
      status: fd.get('status'),
      note: (fd.get('note') || '').trim(),
      photos
    });
    Store.save(); closeModal(); render();
  });
}

function openUseModal(pid) {
  openModal(`
  <h2>⛏️ Enregistrer une consommation</h2>
  <form id="form-use">
    <label class="field"><span>Matériau *</span><select name="materialId" required>${materialOptions(pid)}</select></label>
    <div class="form-row">
      <label class="field"><span>Quantité utilisée *</span><input type="number" name="qty" min="0" step="any" required placeholder="Ex : 12"></label>
      <label class="field"><span>Date *</span><input type="date" name="date" value="${todayISO()}" required></label>
    </div>
    <label class="field"><span>Utilisation</span><input name="note" placeholder="Ex : Coulage dalle zone B"></label>
    <div class="form-actions">
      <button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>
      <button class="btn btn-primary" type="submit">Enregistrer</button>
    </div>
  </form>`);

  $('#form-use').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mid = fd.get('materialId');
    const qty = parseNum(fd.get('qty'));
    const m = Store.material(mid);
    const stock = Store.stockOf(mid);
    if (qty > stock && !confirm(`Quantité supérieure au stock (${fmtQty(stock, m ? m.unit : '')}). Enregistrer quand même ?`)) return;
    Store.data.uses.push({
      id: uid(), projectId: pid, createdAt: Date.now(),
      materialId: mid, qty, date: fd.get('date') || todayISO(),
      note: (fd.get('note') || '').trim()
    });
    Store.save(); closeModal(); render();
  });
}

async function openScanner(inputId) {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Scanner indisponible sur ce navigateur.\nSaisissez le code manuellement.');
    return;
  }
  openModal(`
  <h2>📷 Scanner un code</h2>
  <p class="muted">Présentez le QR code ou code-barres du bon de livraison devant la caméra.</p>
  <div class="video-wrap"><video id="scan-video" playsinline muted autoplay></video></div>
  <div class="form-actions"><button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button></div>`);
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#scan-video');
    if (!v) return;
    v.srcObject = scannerStream;
    await v.play().catch(() => {});
    const bd = new BarcodeDetector();
    scanTimer = setInterval(async () => {
      try {
        if (!v.srcObject) return;
        const codes = await bd.detect(v);
        if (codes && codes.length) {
          const val = codes[0].rawValue;
          const inp = document.getElementById(inputId);
          if (inp) inp.value = val;
          const out = $('#modal-root');
          closeModal();
          // réaffiche un petit retour visuel
          const filed = document.getElementById(inputId);
          if (filed) filed.focus();
        }
      } catch (e) { /* frame non lisible */ }
    }, 600);
  } catch (e) {
    alert('Caméra inaccessible : ' + (e && e.message ? e.message : e));
    closeModal();
  }
}

/* ============================================================
   MODALES — Réserves (punch list)
   ============================================================ */
async function onPlansPicked(e, pid) {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    const d = await compressImage(f, 1600, 0.8);
    if (d) {
      const photoId = uid();
      await PhotoStore.put(photoId, d);
      Store.data.plans.push({
        id: uid(), projectId: pid, createdAt: Date.now(),
        name: f.name.replace(/\.[^.]+$/, '') || 'Plan',
        photoId
      });
    }
  }
  Store.save();
  render();
}

function openDefectModal(pid, planId, d, x, y) {
  PENDS.defect = d ? [] : [];
  PENDS.fix = [];
  const isNew = !d;
  PENDS.defect = [];

  openModal(`
  <h2>${isNew ? '📍 Nouvelle réserve' : '✅ Réserve'}</h2>
  ${!isNew ? `<div class="toolbar" style="margin-bottom:12px">
    ${defBadge(d)}
    ${isOverdue(d) ? '<span class="badge red">échéance dépassée</span>' : ''}
    ${d.planId ? `<a class="link" href="#/projet/${pid}/plan/${d.planId}" data-action="close-modal-link">voir sur le plan →</a>` : ''}
  </div>` : (x != null ? `<p class="muted">Position sur le plan : ${x} %, ${y} %</p>` : '<p class="muted">Réserve sans localisation sur plan.</p>')}
  <form id="form-defect">
    <label class="field"><span>Défaut constaté *</span>
      <input name="title" required value="${esc(d ? d.title : '')}" placeholder="Ex : Fissure dalle RDC — angle B3"></label>
    <div class="form-row">
      <label class="field"><span>Corps de métier assigné *</span>
        <input name="trade" list="dl-trades" required value="${esc(d ? (d.trade || '') : '')}" placeholder="Ex : Maçonnerie">
        <datalist id="dl-trades">${TRADES.map(t => `<option value="${t}">`).join('')}</datalist></label>
      <label class="field"><span>Date limite de correction</span>
        <input type="date" name="deadline" value="${d && d.deadline ? d.deadline : ''}"></label>
    </div>
    <label class="field"><span>Description</span>
      <textarea name="description" rows="2" placeholder="Ex : Fissure de retrait sur 40 cm, pas de reprise de béton visible">${esc(d ? (d.description || '') : '')}</textarea></label>
    <div class="field"><span>Photos du constat</span>
      <div class="thumb-row" id="thumbs-defect">${isNew ? '' : ''}</div>
      ${!isNew && d.photos && d.photos.length ? `<div class="photo-grid" style="margin-bottom:8px">${d.photos.map(id => `<img data-photo-id="${id}" alt="constat" data-action="view-photo" data-pid="${id}">`).join('')}</div>` : ''}
      <button type="button" class="btn btn-ghost btn-sm" data-action="pick-files" data-key="defect">📷 Ajouter une photo</button>
      ${filePicker('defect')}
    </div>
    ${!isNew ? `
    <div class="field"><span>Photos de la correction</span>
      ${d.fixPhotos && d.fixPhotos.length ? `<div class="photo-grid" style="margin-bottom:8px">${d.fixPhotos.map(id => `<img data-photo-id="${id}" alt="correction" data-action="view-photo" data-pid="${id}">`).join('')}</div>` : ''}
      <div class="thumb-row" id="thumbs-fix"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-action="pick-files" data-key="fix">📷 Ajouter la preuve de correction</button>
      ${filePicker('fix')}
    </div>` : ''}
    <div class="form-actions">
      ${!isNew ? `<button type="button" class="btn btn-danger" data-action="delete-defect" data-id="${d.id}" data-pid="${pid}">🗑 Supprimer</button>
      <span class="grow"></span>` : `<button type="button" class="btn btn-ghost" data-action="close-modal">Annuler</button>`}
      <button class="btn btn-primary" type="submit">${isNew ? 'Créer la réserve' : 'Enregistrer'}</button>
    </div>
  </form>
  ${!isNew ? `
  <hr style="border:none;border-top:1px solid var(--line);margin:16px 0">
  <div class="toolbar">
    <span class="muted">Statut :</span>
    ${d.status === 'ouvert' ? `<button class="btn btn-ghost" data-action="set-defect-status" data-id="${d.id}" data-status="en_cours">▶ Passer « en cours »</button>` : ''}
    ${d.status !== 'leve' ? `<button class="btn btn-primary" data-action="set-defect-status" data-id="${d.id}" data-status="leve">✔ Lever la réserve</button>` : `<span class="badge green">Levée le ${fmtDate(d.closedAt)}</span>`}
    ${d.status === 'leve' ? `<button class="btn btn-ghost" data-action="set-defect-status" data-id="${d.id}" data-status="ouvert">↩ Rouvrir</button>` : ''}
  </div>` : ''}`, 'wide');

  bindFilePicker('defect');
  if (!isNew) bindFilePicker('fix');

  $('#form-defect').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (isNew) {
      const photos = await storePendPhotos('defect');
      Store.data.defects.push({
        id: uid(), projectId: pid, planId: planId || null,
        x: x != null ? x : null, y: y != null ? y : null,
        createdAt: Date.now(),
        title: (fd.get('title') || '').trim(),
        trade: (fd.get('trade') || '').trim(),
        description: (fd.get('description') || '').trim(),
        deadline: fd.get('deadline') || null,
        status: 'ouvert', closedAt: null,
        photos, fixPhotos: []
      });
    } else {
      d.title = (fd.get('title') || '').trim();
      d.trade = (fd.get('trade') || '').trim();
      d.description = (fd.get('description') || '').trim();
      d.deadline = fd.get('deadline') || null;
      d.photos = await storePendPhotos('defect', d.photos || []);
      d.fixPhotos = await storePendPhotos('fix', d.fixPhotos || []);
    }
    Store.save(); closeModal(); render();
  });
}

function setDefectStatus(id, status) {
  const d = Store.defect(id);
  if (!d) return;
  d.status = status;
  d.closedAt = status === 'leve' ? todayISO() : null;
  Store.save();
  closeModal();
  render();
}

/* ============================================================
   ACTIONS CRUD divers
   ============================================================ */
function toggleStatus(id, status) {
  const p = Store.project(id);
  if (!p) return;
  p.status = status;
  Store.save();
  render();
}

async function deleteReport(id) {
  const r = Store.report(id);
  if (!r) return;
  if (!confirm('Supprimer définitivement ce rapport et ses photos ?')) return;
  for (const ph of (r.photos || [])) await PhotoStore.del(ph);
  Store.data.reports = Store.data.reports.filter(x => x.id !== id);
  Store.save();
  location.hash = '#/projet/' + r.projectId;
}

async function deleteExpense(id) {
  const ex = Store.data.expenses.find(x => x.id === id);
  if (!ex) return;
  if (!confirm('Supprimer cette dépense ?')) return;
  if (ex.receipt) await PhotoStore.del(ex.receipt);
  Store.data.expenses = Store.data.expenses.filter(x => x.id !== id);
  Store.save();
  render();
}

async function deleteMaterial(id) {
  const m = Store.material(id);
  if (!m) return;
  if (!confirm(`Supprimer « ${m.name} » avec tout son historique (livraisons et consommations) ?`)) return;
  for (const d of Store.data.deliveries.filter(d => d.materialId === id))
    for (const ph of (d.photos || [])) await PhotoStore.del(ph);
  Store.data.deliveries = Store.data.deliveries.filter(d => d.materialId !== id);
  Store.data.uses = Store.data.uses.filter(u => u.materialId !== id);
  Store.data.materials = Store.data.materials.filter(x => x.id !== id);
  Store.save();
  render();
}

async function deleteDelivery(id) {
  const d = Store.data.deliveries.find(x => x.id === id);
  if (!d) return;
  if (!confirm('Supprimer cette livraison ?')) return;
  for (const ph of (d.photos || [])) await PhotoStore.del(ph);
  Store.data.deliveries = Store.data.deliveries.filter(x => x.id !== id);
  Store.save();
  render();
}

async function deleteUse(id) {
  if (!confirm('Supprimer cette consommation ?')) return;
  Store.data.uses = Store.data.uses.filter(x => x.id !== id);
  Store.save();
  render();
}

async function deletePlan(id, pid) {
  const plan = Store.plan(id);
  if (!plan) return;
  const n = Store.defectsOf(pid).filter(d => d.planId === id).length;
  if (!confirm(`Supprimer le plan « ${plan.name} » et ses ${n} réserve(s) pointées ?`)) return;
  await PhotoStore.del(plan.photoId);
  for (const d of Store.data.defects.filter(d => d.planId === id)) {
    for (const ph of (d.photos || []).concat(d.fixPhotos || [])) await PhotoStore.del(ph);
  }
  Store.data.defects = Store.data.defects.filter(d => d.planId !== id);
  Store.data.plans = Store.data.plans.filter(x => x.id !== id);
  Store.save();
  location.hash = '#/projet/' + pid + '?tab=reserves';
  render();
}

async function deleteDefect(id) {
  const d = Store.defect(id);
  if (!d) return;
  if (!confirm('Supprimer cette réserve ?')) return;
  for (const ph of (d.photos || []).concat(d.fixPhotos || [])) await PhotoStore.del(ph);
  Store.data.defects = Store.data.defects.filter(x => x.id !== id);
  Store.save();
  closeModal();
  render();
}

async function deleteProject(id) {
  const p = Store.project(id);
  if (!p) return;
  const nb = Store.reportsOf(id).length;
  if (!confirm(`Supprimer le chantier « ${p.name} » avec TOUT son contenu (${nb} rapport(s), dépenses, stocks, plans, réserves) ? Cette action est définitive.`)) return;
  const photoIds = [
    ...Store.data.reports.filter(r => r.projectId === id).flatMap(r => r.photos || []),
    ...Store.data.expenses.filter(e => e.projectId === id).map(e => e.receipt).filter(Boolean),
    ...Store.data.deliveries.filter(d => d.projectId === id).flatMap(d => d.photos || []),
    ...Store.data.defects.filter(d => d.projectId === id).flatMap(d => (d.photos || []).concat(d.fixPhotos || [])),
    ...Store.data.plans.filter(pl => pl.projectId === id).map(pl => pl.photoId)
  ];
  for (const ph of photoIds) await PhotoStore.del(ph);
  Store.data.projects = Store.data.projects.filter(x => x.id !== id);
  Store.data.reports = Store.data.reports.filter(r => r.projectId !== id);
  Store.data.expenses = Store.data.expenses.filter(e => e.projectId !== id);
  Store.data.materials = Store.data.materials.filter(m => m.projectId !== id);
  Store.data.deliveries = Store.data.deliveries.filter(d => d.projectId !== id);
  Store.data.uses = Store.data.uses.filter(u => u.projectId !== id);
  Store.data.defects = Store.data.defects.filter(d => d.projectId !== id);
  Store.data.plans = Store.data.plans.filter(pl => pl.projectId !== id);
  Store.data.workers = Store.data.workers.filter(w => w.projectId !== id);
  Store.data.attendance = Store.data.attendance.filter(a => a.projectId !== id);
  Store.data.tasks = Store.data.tasks.filter(t => t.projectId !== id);
  Store.save();
  location.hash = '#/';
}

async function viewPhoto(pid) {
  const url = await PhotoStore.get(pid);
  if (url) openModal(`<img class="full-photo" src="${url}" alt="photo">`);
}

/* ============================================================
   EXPORT / IMPORT
   ============================================================ */
async function exportData() {
  const btn = document.querySelector('[data-action="export-data"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Export…'; }
  try {
    const photos = await PhotoStore.getAll();
    const payload = { app: 'ChantierPro', version: 2, exportedAt: new Date().toISOString(), data: Store.data, photos };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chantierpro-export-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Exporter'; }
  }
}

async function onImportFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const payload = JSON.parse(await f.text());
    if (!payload || !payload.data || !Array.isArray(payload.data.projects)) throw new Error('format invalide');
    if (!confirm('Importer remplacera TOUTES les données actuelles de cet appareil. Continuer ?')) return;
    Store.data = { ...JSON.parse(JSON.stringify(EMPTY_DATA)), ...payload.data };
    Store.save();
    await PhotoStore.importAll(payload.photos || {});
    alert('✅ Import réussi : ' + Store.data.projects.length + ' chantier(s) restauré(s).');
    location.hash = '#/';
    render();
  } catch (err) {
    alert('❌ Fichier invalide : ' + err.message);
  }
}

/* ============================================================
   DONNÉES DE DÉMONSTRATION
   ============================================================ */
function svgPhoto(text, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="${bg}"/><rect x="20" y="20" width="860" height="520" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="4" stroke-dasharray="16 12"/><text x="450" y="270" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="#ffffff" text-anchor="middle">${text}</text><text x="450" y="330" font-family="Arial, sans-serif" font-size="26" fill="rgba(255,255,255,.85)" text-anchor="middle">ChantierPro — photo de demonstration</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function svgPlan(title) {
  let grid = '';
  for (let x = 0; x <= 1000; x += 50) grid += `<line x1="${x}" y1="0" x2="${x}" y2="640" stroke="#0f172a" stroke-opacity="0.05"/>`;
  for (let y = 0; y <= 640; y += 50) grid += `<line x1="0" y1="${y}" x2="1000" y2="${y}" stroke="#0f172a" stroke-opacity="0.05"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="640" font-family="Arial, sans-serif">
  <rect width="1000" height="640" fill="#f8fafc"/>${grid}
  <rect x="40" y="60" width="920" height="520" fill="#ffffff" stroke="#0f172a" stroke-width="10"/>
  <line x1="500" y1="60" x2="500" y2="580" stroke="#0f172a" stroke-width="8"/>
  <line x1="40" y1="330" x2="500" y2="330" stroke="#0f172a" stroke-width="8"/>
  <line x1="500" y1="330" x2="960" y2="330" stroke="#0f172a" stroke-width="8"/>
  <line x1="730" y1="60" x2="730" y2="330" stroke="#0f172a" stroke-width="8"/>
  <line x1="730" y1="200" x2="960" y2="200" stroke="#0f172a" stroke-width="8"/>
  <text x="270" y="200" font-size="34" fill="#334155" text-anchor="middle">SÉJOUR</text>
  <text x="270" y="470" font-size="34" fill="#334155" text-anchor="middle">CHAMBRE 1</text>
  <text x="615" y="200" font-size="28" fill="#334155" text-anchor="middle">CUISINE</text>
  <text x="845" y="140" font-size="24" fill="#334155" text-anchor="middle">SDB</text>
  <text x="845" y="270" font-size="24" fill="#334155" text-anchor="middle">CH. 2</text>
  <text x="730" y="470" font-size="34" fill="#334155" text-anchor="middle">TERRASSE</text>
  <rect x="700" y="592" width="290" height="42" fill="#ffffff" stroke="#0f172a" stroke-width="2"/>
  <text x="845" y="620" font-size="20" fill="#0f172a" text-anchor="middle">${title}</text>
  <text x="70" y="40" font-size="22" font-weight="bold" fill="#0f172a">↑ N</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

async function loadDemo() {
  const pid = uid();
  const now = Date.now();
  const d = off => { const x = new Date(); x.setDate(x.getDate() - off); return x.toISOString().slice(0, 10); };

  /* Photos de démo */
  const ph = {};
  const defs = [
    ['p1', 'Ferraillage des semelles', '#b45309'], ['p2', 'Coulage dalle RDC', '#9a3412'],
    ['p3', 'Elevation des murs RDC', '#7c2d12'], ['pr', 'Recu — Ciment 40 sacs', '#334155'],
    ['bl', 'Bon de livraison BL-114', '#0f766e'], ['def1', 'Fissure constatee', '#991b1b'],
    ['fix1', 'Etancheite corrigee', '#166534'], ['nc', 'Sable non conforme', '#78350f']
  ];
  for (const [k, t, c] of defs) { ph[k] = uid(); await PhotoStore.put(ph[k], svgPhoto(t, c)); }
  const planPhoto = uid();
  await PhotoStore.put(planPhoto, svgPlan('PLAN RDC — VILLA AMBATOBE'));

  /* Chantier */
  Store.data.projects.push({
    id: pid, status: 'actif', createdAt: now,
    name: 'Construction Villa R+1 — Ambatobe',
    client: 'M. Rakotondraibe', location: 'Ambatobe, Antananarivo',
    budget: 180000000, startDate: d(21),
    notes: 'Villa R+1 de 220 m². Gros œuvre + second œuvre.'
  });

  /* Rapports journaliers */
  Store.data.reports.push(
    { id: uid(), projectId: pid, createdAt: now - 36e5, date: d(2), weather: WEATHERS[0],
      workers: 12, techs: 2, engrs: 1,
      subs: [{ name: 'Ferraillage', count: 4 }, { name: 'Maçonnerie', count: 8 }],
      tasks: 'Coulage de la dalle du RDC — zones A et B\nVibration et lissage terminés à 15h',
      materials: '12 m³ de béton (centrale) · 2 t acier HA10 utilisées', issues: '',
      photos: [ph.p1, ph.p2], gps: { lat: -18.9100, lng: 47.5350 } },
    { id: uid(), projectId: pid, createdAt: now, date: d(1), weather: WEATHERS[1],
      workers: 10, techs: 2, engrs: 1,
      subs: [{ name: 'Maçonnerie', count: 8 }],
      tasks: 'Élévation des murs du RDC — 42 blocs de 15 posés\nCoffrage des linteaux axe C',
      materials: 'Livraison : 40 sacs ciment CPJ 45 · 600 blocs', issues: 'Retard livraison sable (prévu demain matin)',
      photos: [ph.p3], gps: { lat: -18.9100, lng: 47.5350 } }
  );

  /* Dépenses */
  Store.data.expenses.push(
    { id: uid(), projectId: pid, createdAt: now - 8 * 36e5, date: d(10), category: 'Matériaux', description: 'Achat 40 sacs de ciment CPJ 45', amount: 1520000, receipt: ph.pr },
    { id: uid(), projectId: pid, createdAt: now - 6 * 36e5, date: d(8), category: "Main-d'œuvre", description: 'Paiement semaine 2 — équipe maçonnerie (12 pers.)', amount: 4200000, receipt: null },
    { id: uid(), projectId: pid, createdAt: now - 4 * 36e5, date: d(4), category: 'Transport', description: 'Location camion — livraison agrégats', amount: 650000, receipt: null },
    { id: uid(), projectId: pid, createdAt: now - 2 * 36e5, date: d(2), category: 'Location matériel', description: 'Location bétonnière + vibreur (2 jours)', amount: 380000, receipt: null }
  );

  /* Matériaux, livraisons, consommations */
  const mCiment = uid(), mAcier = uid(), mBlocs = uid(), mSable = uid();
  Store.data.materials.push(
    { id: mCiment, projectId: pid, createdAt: now, name: 'Ciment CPJ 45', unit: 'sacs', threshold: 10 },
    { id: mAcier, projectId: pid, createdAt: now, name: 'Acier HA10', unit: 't', threshold: 0.5 },
    { id: mBlocs, projectId: pid, createdAt: now, name: 'Blocs de 15', unit: 'blocs', threshold: 200 },
    { id: mSable, projectId: pid, createdAt: now, name: 'Sable de rivière', unit: 'm³', threshold: 3 }
  );
  Store.data.deliveries.push(
    { id: uid(), projectId: pid, createdAt: now - 10 * 36e5, materialId: mAcier, qty: 2, date: d(12), supplier: 'MétalPlus Tana', code: 'BL-2026-098', status: 'conforme', note: '', photos: [] },
    { id: uid(), projectId: pid, createdAt: now - 9 * 36e5, materialId: mCiment, qty: 40, date: d(10), supplier: 'SCOMA Anosy', code: 'BL-2026-114', status: 'conforme', note: '', photos: [ph.bl] },
    { id: uid(), projectId: pid, createdAt: now - 8 * 36e5, materialId: mBlocs, qty: 1000, date: d(9), supplier: 'Parpaing Imerina', code: '', status: 'conforme', note: '', photos: [] },
    { id: uid(), projectId: pid, createdAt: now - 3 * 36e5, materialId: mSable, qty: 6, date: d(3), supplier: 'Transport Rabe', code: '', status: 'non_conforme', note: 'Sable trop argileux — refusé, relivraison demandée', photos: [ph.nc] }
  );
  Store.data.uses.push(
    { id: uid(), projectId: pid, createdAt: now - 5 * 36e5, materialId: mCiment, qty: 12, date: d(5), note: 'Maçonnerie fondations' },
    { id: uid(), projectId: pid, createdAt: now - 3 * 36e5, materialId: mCiment, qty: 6, date: d(2), note: 'Lissage dalle RDC' },
    { id: uid(), projectId: pid, createdAt: now - 2 * 36e5, materialId: mBlocs, qty: 600, date: d(2), note: 'Élévation murs RDC' },
    { id: uid(), projectId: pid, createdAt: now - 6 * 36e5, materialId: mAcier, qty: 0.8, date: d(4), note: 'Poteaux et chaînages' }
  );

  /* Registre des ouvriers + pointage */
  const wIds = [];
  [
    ['Jean Randria', 'Maçon', 25000], ['Hery Rakoto', 'Maçon', 25000],
    ['Lala Rabe', 'Ferrailleur', 22000], ['Tojo Ratsimba', 'Électricien', 30000],
    ['Mamy Andria', 'Manœuvre', 15000], ['Nirina Rasoa', 'Manœuvre', 15000]
  ].forEach(([nm, tr, rate]) => {
    const wid = uid();
    wIds.push(wid);
    Store.data.workers.push({ id: wid, projectId: pid, createdAt: now, name: nm, trade: tr, dailyRate: rate, active: true });
  });
  const pointageDemo = defs2 => defs2.forEach(([i, st, day]) =>
    Store.data.attendance.push({ id: uid(), projectId: pid, workerId: wIds[i], date: d(day), status: st, createdAt: now }));
  pointageDemo([[0, 'present', 3], [1, 'present', 3], [2, 'present', 3], [3, 'demi', 3], [4, 'present', 3], [5, 'present', 3]]);
  pointageDemo([[0, 'present', 1], [1, 'present', 1], [2, 'present', 1], [3, 'demi', 1], [4, 'present', 1], [5, 'absent', 1]]);
  pointageDemo([[0, 'present', 0], [1, 'present', 0], [2, 'present', 0], [3, 'present', 0], [4, 'demi', 0], [5, 'present', 0]]);

  /* Planning (Gantt) */
  const tk = (name, trade, s, e, prog) =>
    Store.data.tasks.push({ id: uid(), projectId: pid, name, trade, start: s, end: e, progress: prog, createdAt: now });
  tk('Terrassement & implantation', 'Terrassement', d(21), d(17), 100);
  tk('Fouilles & fondations', 'Maçonnerie', d(16), d(10), 100);
  tk('Dalle RDC (coulage)', 'Maçonnerie', d(9), d(2), 100);
  tk('Second chaînage RDC', 'Ferraillage', d(7), d(1), 40);
  tk('Élévation murs RDC', 'Maçonnerie', d(5), d(-1), 60);
  tk('Livraison acier étage', 'Approvisionnement', d(-2), d(-2), 0);
  tk('Dalle étage (coulage)', 'Maçonnerie', d(-3), d(-7), 0);
  tk('Charpente & toiture', 'Charpente', d(-9), d(-17), 0);
  tk('Électricité & plomberie', 'Électricité', d(-18), d(-26), 0);

  /* Plan + réserves */
  const planId = uid();
  Store.data.plans.push({ id: planId, projectId: pid, createdAt: now, name: 'Plan RDC', photoId: planPhoto });
  Store.data.defects.push(
    { id: uid(), projectId: pid, planId, x: 30, y: 52, createdAt: now - 5 * 36e5,
      title: 'Fissure dalle RDC — angle séjour', trade: 'Maçonnerie',
      description: 'Fissure de retrait sur ~40 cm, à surveiller et reprendre au mortier.',
      deadline: d(2), status: 'ouvert', closedAt: null, photos: [ph.def1], fixPhotos: [] },
    { id: uid(), projectId: pid, planId, x: 66, y: 28, createdAt: now - 3 * 36e5,
      title: 'Prise électrique mal positionnée (cuisine)', trade: 'Électricité',
      description: 'Prise à 15 cm du plan de travail au lieu de 1,10 m — à déplacer.',
      deadline: d(-5), status: 'en_cours', closedAt: null, photos: [], fixPhotos: [] },
    { id: uid(), projectId: pid, planId, x: 78, y: 76, createdAt: now - 7 * 36e5,
      title: 'Étanchéité terrasse — remontées d\'eau', trade: 'Étanchéité',
      description: 'Relevé d\'étanchéité insuffisant angle nord-est.',
      deadline: d(1), status: 'leve', closedAt: d(1), photos: [], fixPhotos: [ph.fix1] }
  );

  Store.save();
  location.hash = '#/projet/' + pid;
  render();
}

/* ============================================================
   DÉLÉGATION D'ÉVÉNEMENTS
   ============================================================ */
const actions = {
  'open-project-modal': () => openProjectModal(),
  'edit-project': el => openProjectModal(el.dataset.id),
  'delete-project': el => deleteProject(el.dataset.id),
  'toggle-status': el => toggleStatus(el.dataset.id, el.dataset.status),
  'open-expense-modal': el => openExpenseModal(el.dataset.id),
  'delete-expense': el => deleteExpense(el.dataset.id),
  'open-pdf-modal': el => openPdfModal(el.dataset.id),
  'go-new-report': el => { location.hash = '#/projet/' + el.dataset.id + '/nouveau-rapport'; },
  'delete-report': el => deleteReport(el.dataset.id),
  'email-report': el => emailReport(el.dataset.id),
  'open-worker-modal': el => openWorkerModal(el.dataset.id),
  'delete-worker': el => deleteWorker(el.dataset.id),
  'set-att': el => setAttendance(el.dataset.id, el.dataset.status),
  'prefill-workers': el => { const inp = document.querySelector('input[name=workers]'); if (inp) { inp.value = Math.round(+el.dataset.n || 0); inp.focus(); } },
  'open-task-modal': el => openTaskModal(el.dataset.id, null),
  'edit-task': el => { const t = Store.data.tasks.find(x => x.id === el.dataset.id); if (t) openTaskModal(t.projectId, t); },
  'delete-task': el => deleteTask(el.dataset.id),
  'open-import-tasks': el => openImportTasksModal(el.dataset.id),
  'export-tasks-csv': el => exportTasksCsv(el.dataset.id),
  'pick-files': el => { const i = $('#file-' + el.dataset.key); if (i) i.click(); },
  'remove-photo': el => {
    const key = el.dataset.key;
    PENDS[key] = pend(key).filter(p => p.id !== el.dataset.pid);
    renderThumbs(key);
  },
  'add-subs-row': () => { const c = $('#subs-rows'); if (c) c.insertAdjacentHTML('beforeend', subsRowHtml()); },
  'remove-subs-row': el => { const row = el.closest('.subs-row'); if (row) row.remove(); },
  'voice-toggle': el => toggleVoice(el),
  'get-gps': getGPS,
  'open-material-modal': el => openMaterialModal(el.dataset.id),
  'delete-material': el => deleteMaterial(el.dataset.id),
  'open-delivery-modal': el => openDeliveryModal(el.dataset.id),
  'delete-delivery': el => deleteDelivery(el.dataset.id),
  'open-use-modal': el => openUseModal(el.dataset.id),
  'delete-use': el => deleteUse(el.dataset.id),
  'scan-code': el => openScanner(el.dataset.input),
  'add-plan': () => { const i = $('#plan-input'); if (i) i.click(); },
  'delete-plan': el => deletePlan(el.dataset.id, el.dataset.pid),
  'plan-click': (el, e) => {
    if (e.target.closest('.pin')) return;
    const rect = el.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    if (x < 0 || x > 100 || y < 0 || y > 100) return;
    openDefectModal(el.dataset.pid, el.dataset.plan, null, x, y);
  },
  'open-defect': el => { const d = Store.defect(el.dataset.id); if (d) openDefectModal(d.projectId, d.planId, d, d.x, d.y); },
  'open-defect-modal': el => openDefectModal(el.dataset.id, null, null, null, null),
  'set-defect-status': el => setDefectStatus(el.dataset.id, el.dataset.status),
  'delete-defect': el => deleteDefect(el.dataset.id),
  'export-data': exportData,
  'open-import': () => $('#import-file').click(),
  'load-demo': loadDemo,
  'view-photo': el => viewPhoto(el.dataset.pid),
  'print': () => window.print(),
  'open-side': () => document.body.classList.add('side-open'),
  'close-side': () => document.body.classList.remove('side-open'),
  'close-modal': closeModal,
  'close-modal-link': () => closeModal(),
  'help': openHelp
};

document.addEventListener('click', e => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) { closeModal(); return; }
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const fn = actions[t.dataset.action];
  if (fn) fn(t, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); document.body.classList.remove('side-open'); }
});

/* ---------------- Démarrage ---------------- */
window.Store = Store;           /* exposé pour la couche cloud */
window.PhotoStore = PhotoStore; /* idem */
Store.load();
$('#import-file').addEventListener('change', onImportFile);
render();
