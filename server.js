/* ============================================================
   ChantierPro Cloud — serveur API + hébergement statique
   Offline-first : le client fonctionne sans ce serveur ; ici :
   comptes, synchronisation, partage client, analyse PDF (cloud).
   ============================================================ */
'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const dbm = require('./db');
const { parsePlanningText } = require('./parser');

dbm.init();
const app = express();
const PORT = process.env.PORT || 8000;
const ROOT = __dirname;

app.use(express.json({ limit: '150mb' }));

/* CORS permissif (utile si le frontend est hébergé ailleurs un jour) */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const secret = () => dbm.load().settings.jwtSecret;
const newId = () => crypto.randomUUID();
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '');

function publicUser(u) { return u ? { id: u.id, email: u.email, name: u.name } : null; }

function signToken(u) {
  return jwt.sign({ uid: u.id }, secret(), { expiresIn: '30d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Non authentifié.' });
  try {
    const p = jwt.verify(t, secret());
    const db = dbm.load();
    const u = db.users.find(x => x.id === p.uid);
    if (!u) return res.status(401).json({ error: 'Compte introuvable.' });
    req.user = u;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
  }
}

/* ===================== AUTH ===================== */
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!emailOk(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  const db = dbm.load();
  const mail = String(email).trim().toLowerCase();
  if (db.users.some(u => u.email === mail)) return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail.' });
  const u = {
    id: newId(), email: mail,
    name: String(name || '').trim() || mail.split('@')[0],
    passHash: bcrypt.hashSync(String(password), 10),
    createdAt: Date.now()
  };
  db.users.push(u);
  dbm.save(db);
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = dbm.load();
  const u = db.users.find(x => x.email === String(email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.passHash))
    return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  res.json({ token: signToken(u), user: publicUser(u) });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'ChantierPro Cloud', version: '3.0' }));

/* ===================== SYNCHRO (snapshot, conflit = horodatage) ===================== */
app.get('/api/sync/status', auth, (req, res) => {
  const db = dbm.load();
  const snap = db.snapshots[req.user.id];
  res.json({ hasSnapshot: !!snap, updatedAt: snap ? snap.updatedAt : null });
});

app.post('/api/sync/push', auth, (req, res) => {
  const { data, photos, base } = req.body || {};
  if (!data || !Array.isArray(data.projects)) return res.status(400).json({ error: 'Données invalides.' });
  const db = dbm.load();
  const existing = db.snapshots[req.user.id];
  const now = Date.now();
  if (existing && existing.updatedAt > 0 && (base == null || +base < existing.updatedAt)) {
    return res.status(409).json({ error: 'La version cloud est plus récente.', serverUpdatedAt: existing.updatedAt });
  }
  db.snapshots[req.user.id] = { data, photos: photos || {}, updatedAt: now };
  dbm.save(db);
  res.json({ ok: true, updatedAt: now });
});

app.get('/api/sync/pull', auth, (req, res) => {
  const db = dbm.load();
  const snap = db.snapshots[req.user.id];
  if (!snap) return res.status(404).json({ error: 'Aucune donnée sur le cloud pour ce compte.' });
  res.json({ data: snap.data, photos: snap.photos || {}, updatedAt: snap.updatedAt });
});

/* ===================== ANALYSE PDF (cloud) ===================== */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/planning/pdf', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier PDF manquant.' });
  let parser = null;
  try {
    parser = new PDFParse({ data: req.file.buffer });
    const r = await parser.getText();
    const cleanText = String(r.text || '').split(/\r?\n/).filter(l => !/^--\s*\d+\s*of\s*\d+\s*--/.test(l.trim())).join('\n');
    const parsed = parsePlanningText(cleanText);
    const ok = (parsed.rows || []).filter(x => x.ok);
    if (!ok.length) {
      return res.status(422).json({
        error: "Aucune tâche détectable : ce planning est probablement graphique ou scanné. Exportez-le en Excel/CSV puis utilisez l'import hors-ligne."
      });
    }
    res.json({ rows: parsed.rows, pages: r.total || 1, tasksFound: ok.length });
  } catch (e) {
    res.status(422).json({ error: 'PDF illisible : ' + (e.message || e) });
  } finally {
    if (parser) parser.destroy().catch(() => {});
  }
});

/* ===================== PARTAGE CLIENT (lecture seule, figé) ===================== */
const EMPTY = { projects: [], reports: [], expenses: [], materials: [], deliveries: [], uses: [], plans: [], defects: [], workers: [], attendance: [], tasks: [] };

app.post('/api/share', auth, (req, res) => {
  const { projectId } = req.body || {};
  const db = dbm.load();
  const snap = db.snapshots[req.user.id];
  if (!snap) return res.status(404).json({ error: 'Aucune donnée synchronisée. Lancez une synchronisation d\'abord.' });
  const D = { ...EMPTY, ...snap.data };
  const p = D.projects.find(x => x.id === projectId);
  if (!p) return res.status(404).json({ error: 'Chantier introuvable dans les données synchronisées.' });

  const f = c => (D[c] || []).filter(x => x.projectId === projectId);
  const data = {
    ...EMPTY, projects: [p],
    reports: f('reports'), expenses: f('expenses'), materials: f('materials'),
    deliveries: f('deliveries'), uses: f('uses'), defects: f('defects'),
    tasks: f('tasks'), plans: [], workers: [], attendance: []
  };
  const photoIds = new Set();
  data.reports.forEach(r => (r.photos || []).forEach(id => photoIds.add(id)));
  data.expenses.forEach(e => e.receipt && photoIds.add(e.receipt));
  const photos = {};
  for (const id of photoIds) if (snap.photos && snap.photos[id]) photos[id] = snap.photos[id];

  const token = crypto.randomBytes(18).toString('hex');
  db.shares.push({ token, userId: req.user.id, projectId, projectName: p.name, data, photos, createdAt: Date.now() });
  dbm.save(db);
  res.json({ token });
});

/* ---------- Page publique de partage ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escAttr = esc;
const fmtAr = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n) || 0) + ' Ar';
const fmtDate = iso => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);

app.get('/share/:token', (req, res) => {
  const db = dbm.load();
  const share = db.shares.find(s => s.token === req.params.token);
  if (!share) return res.status(404).send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>🏗️ ChantierPro</h1><p>Ce lien de partage n'existe pas ou a expiré.</p></body>`);

  const D = share.data;
  const p = D.projects[0];
  const expenses = D.expenses || [];
  const spent = expenses.reduce((t, e) => t + (+e.amount || 0), 0);
  const pct = p.budget ? Math.round(spent / p.budget * 100) : null;
  const tasks = (D.tasks || []).slice().sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const avg = tasks.length ? Math.round(tasks.reduce((t, x) => t + (+x.progress || 0), 0) / tasks.length) : 0;
  const todayISO = new Date().toISOString().slice(0, 10);
  const lateTasks = tasks.filter(t => (+t.progress || 0) < 100 && t.end && t.end < todayISO).length;
  const reports = (D.reports || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const openDef = (D.defects || []).filter(d => d.status !== 'leve').length;

  /* Mini-Gantt */
  let gantt = '<p style="color:#64748b">Pas de planning synchronisé.</p>';
  if (tasks.length) {
    let minD = tasks.map(t => t.start).reduce((a, b) => a < b ? a : b);
    let maxD = tasks.map(t => t.end).reduce((a, b) => a > b ? a : b);
    const total = Math.max(1, daysBetween(minD, maxD) + 1);
    const rows = tasks.map(t => {
      const st = (+t.progress || 0) >= 100 ? '#16a34a' : (+t.progress || 0) > 0 ? '#ea580c' : '#94a3b8';
      const late = (+t.progress || 0) < 100 && t.end && t.end < todayISO;
      const left = Math.max(0, daysBetween(minD, t.start) / total * 100);
      const width = Math.max(1.5, (daysBetween(t.start, t.end) + 1) / total * 100);
      return `<tr>
        <td>${esc(t.name)}${late ? ' <span class="pill red">retard</span>' : ''}</td>
        <td class="nowrap">${fmtDate(t.start)} → ${fmtDate(t.end)}</td>
        <td style="width:38%"><div class="track"><div class="bar" style="left:${left}%;width:${width}%;background:${st}"><i style="width:${t.progress || 0}%"></i></div></div></td>
        <td class="nowrap r"><b>${t.progress || 0} %</b></td>
      </tr>`;
    }).join('');
    gantt = `<table class="tbl">${rows}</table><p class="muted">Début ${fmtDate(minD)} → fin ${fmtDate(maxD)}</p>`;
  }

  /* Journal récent */
  const journal = reports.slice(0, 8).map(r => {
    const photos = (r.photos || []).slice(0, 3).map(id => share.photos[id] ? `<img src="${escAttr(share.photos[id])}" alt="photo chantier">` : '').join('');
    const wf = (+r.workers || 0) + (+r.techs || 0) + (+r.engrs || 0);
    return `<div class="day">
      <b>${new Date(r.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</b>
      <span class="muted">${esc(r.weather || '')} · 👷 ${wf} pers.</span>
      <p>${esc(r.tasks || '').replace(/\n/g, '<br>')}</p>
      ${r.issues ? `<p class="issue">⚠ ${esc(r.issues)}</p>` : ''}
      ${photos ? `<div class="photos">${photos}</div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Aucun rapport synchronisé pour l\'instant.</p>';

  res.send(`<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>ChantierPro — ${esc(p.name)} (suivi partagé)</title>
<style>
  body{margin:0;font-family:"Segoe UI",system-ui,Arial,sans-serif;background:#f2f4f7;color:#0f172a;line-height:1.55}
  .wrap{max-width:860px;margin:0 auto;padding:0 16px 50px}
  header{background:#0e1526;color:#fff;padding:18px 0}
  header .wrap{display:flex;align-items:center;gap:12px;padding-bottom:0}
  .logo{background:#ea580c;width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:22px}
  .muted{color:#64748b}.nowrap{white-space:nowrap}.r{text-align:right}
  h1{font-size:1.5rem;margin:20px 0 4px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}
  .kpi{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
  .kpi b{font-size:1.2rem;display:block}
  .kpi small{color:#64748b}
  h2{font-size:1.05rem;color:#c2410c;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:28px 0 12px}
  .tbl{width:100%;border-collapse:collapse;font-size:.88rem;background:#fff;border-radius:10px;overflow:hidden}
  .tbl td{padding:9px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
  .track{position:relative;height:20px;background:#eef2f6;border-radius:6px}
  .bar{position:absolute;top:2px;bottom:2px;border-radius:5px;overflow:hidden}
  .bar i{position:absolute;inset:0;background:rgba(15,23,42,.3)}
  .day{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:10px}
  .issue{background:#fff7ed;border-left:4px solid #d97706;padding:8px 12px;border-radius:6px}
  .photos{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
  .photos img{width:110px;height:82px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0}
  .pill{background:#fef3c7;color:#d97706;font-size:.68rem;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:uppercase}
  .pill.red{background:#fee2e2;color:#dc2626}
  .prog{height:10px;background:#e9edf2;border-radius:99px;overflow:hidden;margin:8px 0}
  .prog i{display:block;height:100%;background:#16a34a}
  footer{text-align:center;color:#64748b;font-size:.78rem;margin-top:36px;border-top:1px solid #e2e8f0;padding-top:14px}
</style></head><body>
<header><div class="wrap"><span class="logo">🏗️</span><div><b>ChantierPro</b><div style="font-size:.8rem;opacity:.75">Suivi d'avancement partagé — lecture seule</div></div></div></header>
<div class="wrap">
  <h1>${esc(p.name)}</h1>
  <p class="muted">${p.client ? 'Maître d\'ouvrage : <b>' + esc(p.client) + '</b> · ' : ''}${p.location ? '📍 ' + esc(p.location) + ' · ' : ''}mis à jour le ${new Date(share.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <div class="kpis">
    <div class="kpi"><b>${avg} %</b><small>avancement moyen</small></div>
    <div class="kpi"><b>${p.budget ? pct + ' %' : '—'}</b><small>budget consommé</small></div>
    <div class="kpi"><b>${lateTasks}</b><small>tâche(s) en retard</small></div>
    <div class="kpi"><b>${openDef}</b><small>réserve(s) ouverte(s)</small></div>
    <div class="kpi"><b>${reports.length}</b><small>rapport(s) journaliers</small></div>
  </div>
  ${p.budget ? `<p class="muted">Budget : <b>${fmtAr(spent)}</b> engagés sur ${fmtAr(p.budget)}</p><div class="prog"><i style="width:${Math.min(100, pct || 0)}%"></i></div>` : ''}
  <h2>Planning & avancement</h2>
  ${gantt}
  <h2>Journal de chantier récent</h2>
  ${journal}
  <footer>Page générée par <b>ChantierPro</b> — les données affichées sont celles synchronisées au moment du partage.<br>🏗️ Suivi de chantiers BTP, hors-ligne + cloud.</footer>
</div>
</body></html>`);
});

/* ===================== STATIQUE (après l'API) ===================== */
app.use((req, res, next) => {
  const p = req.path;
  if (p.startsWith('/data') || p.startsWith('/node_modules') || p === '/server.js' || p === '/db.js' || p === '/parser.js' || p === '/package.json' || p === '/package-lock.json' || p === '/render.yaml' || p === '/.gitignore' || p === '/test-ui.js') return res.status(404).end();
  next();
});
app.use(express.static(ROOT, { index: 'index.html' }));
app.use((req, res) => res.status(404).send('404 — ChantierPro'));

app.listen(PORT, '0.0.0.0', () => console.log(`ChantierPro Cloud prêt → http://0.0.0.0:${PORT}`));
