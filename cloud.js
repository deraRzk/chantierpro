/* ============================================================
   ChantierPro Cloud (couche frontend)
   Offline-first : l'app fonctionne à 100 % sans cette couche.
   Quand le réseau est là : comptes, synchro, partage, PDF cloud.
   ============================================================ */
'use strict';
(function () {
  if (typeof Store === 'undefined' || typeof PhotoStore === 'undefined') return; /* sécurité */

  const API = location.protocol.startsWith('http') ? '/api' : null;
  const cpGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const cpSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let token = cpGet('cp-token') || null;
  let user = JSON.parse(cpGet('cp-user') || 'null');
  let base = +cpGet('cp-sync-base') || 0;
  let dirty = cpGet('cp-dirty') === '1';
  let syncing = false;
  let conflictPause = false;
  let cloudSuspend = false;
  let autoTimer = null;
  let deferredPrompt = null;

  const online = () => !!API && navigator.onLine;
  const fmtT = ts => ts ? new Date(ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';

  /* ---------------- Styles injectés ---------------- */
  function injectStyles() {
    const st = document.createElement('style');
    st.textContent = `
      .cloud-pill{border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:.72rem;font-weight:700;cursor:pointer;background:#fff;font-family:inherit;white-space:nowrap}
      .cloud-pill.on{background:#dcfce7;border-color:#86efac;color:#15803d}
      .cloud-pill.wait{background:#fef3c7;border-color:#fcd34d;color:#92400e}
      .cloud-pill.off{background:#f1f5f9;color:#64748b}
      .cloud-acc{padding:6px 12px 12px;border-bottom:1px dashed rgba(255,255,255,.12);margin-bottom:6px}
      .cloud-acc .who{display:flex;align-items:center;gap:9px;margin-bottom:8px}
      .cloud-acc .ci{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#38bdf8,#2563eb);color:#fff;font-weight:800;font-size:.7rem;display:flex;align-items:center;justify-content:center;flex:none}
      .cloud-acc b{color:#fff;font-size:.82rem;display:block;line-height:1.2;overflow:hidden;text-overflow:ellipsis}
      .cloud-acc small{color:#7c8aa5;font-size:.68rem;display:block;overflow:hidden;text-overflow:ellipsis}
      .cloud-status{font-size:.7rem;margin:2px 0 8px;display:block}
      .cloud-btn-row{display:flex;gap:6px;flex-wrap:wrap}
      .cloud-mini{flex:1;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#e2e8f0;border-radius:8px;padding:7px 8px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:inherit}
      .cloud-mini:hover{background:rgba(255,255,255,.14)}
      .cloud-pdf{border-top:1px dashed var(--line);margin-top:12px;padding-top:12px}
      .cloud-pdf b{font-size:.88rem}
      .cloud-pdf small{display:block;color:var(--muted);margin:4px 0 8px}
      .cloud-toast{position:fixed;bottom:18px;right:18px;z-index:200;background:#0f172a;color:#fff;padding:11px 18px;border-radius:11px;font-size:.85rem;font-weight:600;box-shadow:0 8px 24px rgba(15,23,42,.35);animation:cpop .18s ease}
      @keyframes cpop{from{transform:translateY(10px);opacity:0}}
      .cloud-kv{display:grid;grid-template-columns:150px 1fr;gap:5px 12px;font-size:.86rem;margin:10px 0}
      .cloud-kv dt{color:var(--muted)}
      .cloud-kv dd{margin:0}
      .share-url{width:100%;font-family:inherit;font-size:.85rem;padding:9px 11px;border:1px solid var(--line);border-radius:9px;margin:8px 0 4px}
    `;
    document.head.appendChild(st);
  }

  /* ---------------- Toast ---------------- */
  function toast(msg, ms = 3200) {
    $$('.cloud-toast').forEach(t => t.remove());
    const d = document.createElement('div');
    d.className = 'cloud-toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), ms);
  }

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = await fetch(API + path, Object.assign({}, opts, { headers }));
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && token) doLogout(!opts.silent401);
    if (!r.ok) { const e = new Error(body.error || ('Erreur ' + r.status)); e.status = r.status; e.body = body; throw e; }
    return body;
  }

  /* ---------------- Statut cloud ---------------- */
  function status() {
    if (!API) return { cls: 'off', txt: '📴 Version fichier' };
    if (!online()) return { cls: 'wait', txt: '📴 Hors-ligne' };
    if (!user) return { cls: 'off', txt: '☁️ Mode local' };
    if (syncing) return { cls: 'wait', txt: '🔄 Synchro…' };
    if (conflictPause) return { cls: 'wait', txt: '⚠ Conflit à régler' };
    if (dirty) return { cls: 'wait', txt: '☁️ À synchroniser' };
    return { cls: 'on', txt: '🌐 Synchronisé ✓' };
  }

  function updateCloudUI() {
    const s = status();
    const pill = $('#cloud-pill');
    if (pill) { pill.className = 'cloud-pill ' + s.cls; pill.textContent = s.txt; }
    const accSt = $('#cloud-acc-status');
    if (accSt) { accSt.textContent = user ? s.txt + ' · dernière synchro : ' + fmtT(base) : 'Compte local uniquement'; }
  }

  /* ---------------- Injection dans sidebar + topbar ---------------- */
  function ensureCloudUI() {
    /* Pilule dans la topbar */
    const acts = $('#tb-actions');
    if (acts && !$('#cloud-pill')) {
      const pill = document.createElement('button');
      pill.id = 'cloud-pill';
      pill.className = 'cloud-pill off';
      pill.addEventListener('click', () => (user ? openCloudPanel() : openAuthModal('login')));
      acts.prepend(pill);
    }
    /* Bloc compte dans la sidebar */
    const side = $('#sidebar');
    if (side && !$('#cloud-side')) {
      const foot = side.querySelector('.side-foot');
      const block = document.createElement('div');
      block.id = 'cloud-side';
      block.innerHTML = `<div class="side-sec">Compte &amp; cloud</div><div class="cloud-acc" id="cloud-acc"></div>`;
      side.insertBefore(block, foot || null);
    }
    const acc = $('#cloud-acc');
    if (acc) {
      if (user) {
        const ini = (user.name || user.email || '?').trim().slice(0, 2).toUpperCase();
        acc.innerHTML = `
          <div class="who"><span class="ci">${escH(ini)}</span>
            <div style="min-width:0"><b>${escH(user.name)}</b><small>${escH(user.email)}</small></div>
          </div>
          <span class="cloud-status" id="cloud-acc-status"></span>
          <div class="cloud-btn-row">
            <button class="cloud-mini" id="cloud-btn-sync">🔄 Synchroniser</button>
            <button class="cloud-mini" id="cloud-btn-panel">☁️ Cloud & partage</button>
          </div>
          ${deferredPrompt ? '<div class="cloud-btn-row" style="margin-top:6px"><button class="cloud-mini" id="cloud-btn-install">📲 Installer l\'app</button></div>' : ''}`;
        $('#cloud-btn-sync').addEventListener('click', () => pushNow(true));
        $('#cloud-btn-panel').addEventListener('click', openCloudPanel);
        const inst = $('#cloud-btn-install');
        if (inst) inst.addEventListener('click', async () => { deferredPrompt.prompt(); deferredPrompt = null; updateCloudUI(); });
      } else {
        acc.innerHTML = `
          <span class="cloud-status" id="cloud-acc-status">Compte local uniquement</span>
          <div class="cloud-btn-row">
            <button class="cloud-mini" id="cloud-btn-login">👤 Se connecter / Créer un compte</button>
          </div>
          ${deferredPrompt ? '<div class="cloud-btn-row" style="margin-top:6px"><button class="cloud-mini" id="cloud-btn-install2">📲 Installer l\'app</button></div>' : ''}`;
        $('#cloud-btn-login').addEventListener('click', () => openAuthModal('login'));
        const inst = $('#cloud-btn-install2');
        if (inst) inst.addEventListener('click', async () => { deferredPrompt.prompt(); deferredPrompt = null; updateCloudUI(); });
      }
    }
    updateCloudUI();
  }

  function patchChrome() {
    if (typeof window.renderChrome === 'function' && !window.renderChrome.__cloudWrapped) {
      const orig = window.renderChrome;
      const wrapped = function () { orig.apply(this, arguments); ensureCloudUI(); };
      wrapped.__cloudWrapped = true;
      window.renderChrome = wrapped;
    }
    ensureCloudUI();
  }

  /* ---------------- Store.save : marquage + synchro auto ---------------- */
  function patchStoreSave() {
    const orig = Store.save.bind(Store);
    Store.save = function () {
      orig();
      if (cloudSuspend) return;
      dirty = true; cpSet('cp-dirty', '1');
      scheduleAuto();
      updateCloudUI();
    };
  }
  function scheduleAuto() {
    if (!user || conflictPause || syncing) return;
    if (!online()) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => pushNow(false), 20000); /* synchro auto discrète après 20 s */
  }

  /* ---------------- Synchro ---------------- */
  async function pushNow(manual) {
    if (!user) { if (manual) openAuthModal('register'); return; }
    if (!online()) { if (manual) toast('📴 Hors-ligne — la synchro reprendra au retour du réseau'); return; }
    if (syncing) return;
    syncing = true; updateCloudUI();
    try {
      const photos = await PhotoStore.getAll();
      const res = await api('/sync/push', { method: 'POST', body: JSON.stringify({ data: Store.data, photos, base }) });
      base = res.updatedAt; cpSet('cp-sync-base', String(base));
      dirty = false; cpSet('cp-dirty', '0');
      conflictPause = false;
      if (manual) toast('🌐 Synchronisé avec le cloud ✓');
    } catch (e) {
      if (e.status === 409 && e.body && e.body.serverUpdatedAt) {
        conflictPause = true;
        openConflictModal(e.body.serverUpdatedAt);
      } else if (manual) alert('⚠️ Synchro impossible : ' + e.message);
    } finally { syncing = false; updateCloudUI(); }
  }

  async function pullNow(force) {
    if (!user) { openAuthModal('login'); return; }
    if (!online()) { alert('📴 Hors-ligne — restauration impossible pour le moment.'); return; }
    try {
      if (dirty && !force) {
        if (!confirm('Remplacer les données de CET appareil par la version cloud ?\n(Vos modifications non synchronisées seront perdues — pensez à Exporter d\'abord.)')) return;
      }
      const res = await api('/sync/pull');
      cloudSuspend = true;
      Store.data = res.data;
      Store.save();
      await PhotoStore.importAll(res.photos || {});
      cloudSuspend = false;
      base = res.updatedAt; cpSet('cp-sync-base', String(base));
      dirty = false; cpSet('cp-dirty', '0');
      conflictPause = false;
      toast('⬇ Données restaurées depuis le cloud');
      if (typeof window.render === 'function') window.render();
    } catch (e) {
      if (e.status === 404) alert('☁️ Aucune donnée sur le cloud pour ce compte.');
      else alert('⚠️ ' + e.message);
    }
    updateCloudUI();
  }

  function openConflictModal(serverAt) {
    openCloudModal(`
      <h2>⚠️ Version cloud plus récente</h2>
      <p class="muted">Le cloud contient une version synchronisée le <b>${fmtT(serverAt)}</b> (depuis un autre appareil ?), différente de celle-ci.</p>
      <div class="form-actions" style="justify-content:flex-start;flex-direction:column;align-items:stretch;gap:8px">
        <button class="btn btn-primary" id="cf-pull">⬇ Charger la version cloud (remplace l'appareil)</button>
        <button class="btn btn-ghost" id="cf-push">⬆ Envoyer quand même MA version (écrase le cloud)</button>
        <button class="btn btn-ghost" data-action="close-modal">Décider plus tard</button>
      </div>`);
    $('#cf-pull').addEventListener('click', async () => { closeConflict(); await pullNow(true); });
    $('#cf-push').addEventListener('click', async () => { base = serverAt; cpSet('cp-sync-base', String(base)); conflictPause = false; closeConflict(); await pushNow(false); toast('⬆ Version locale envoyée sur le cloud'); });
  }
  function closeConflict() { conflictPause = false; const r = $('#modal-root'); if (r) r.innerHTML = ''; updateCloudUI(); }

  /* ---------------- Panneau Cloud & partage ---------------- */
  function currentProjectId() {
    const m = location.hash.match(/#\/projet\/([a-z0-9]+)/i);
    return m ? m[1] : null;
  }

  function openCloudPanel() {
    if (!user) { openAuthModal('login'); return; }
    const pid = currentProjectId();
    const p = pid ? Store.project(pid) : null;
    openCloudModal(`
      <h2>☁️ Cloud & partage</h2>
      <dl class="cloud-kv">
        <dt>Compte</dt><dd><b>${escH(user.name)}</b> (${escH(user.email)})</dd>
        <dt>Statut</dt><dd>${escH(status().txt)}</dd>
        <dt>Dernière synchro</dt><dd>${fmtT(base)}</dd>
        <dt>Chantiers locaux</dt><dd>${Store.data.projects.length}</dd>
      </dl>
      <div class="toolbar" style="margin-bottom:6px">
        <button class="btn btn-primary btn-sm" id="cp-sync">🔄 Synchroniser maintenant</button>
        <button class="btn btn-ghost btn-sm" id="cp-pull">⬇ Restaurer depuis le cloud</button>
      </div>
      ${p ? `
      <div style="border-top:1px dashed var(--line);margin:12px 0 10px;padding-top:12px">
        <b>🔗 Partage client — « ${escH(p.name)} »</b>
        <p class="muted" style="font-size:.82rem">Génère un <b>lien public en lecture seule</b> (avancement, planning, budget, journal + photos). Idéal pour le maître d'ouvrage ou la diaspora. ⚠️ Synchronisez d'abord : le lien montre les données au moment de la synchro.</p>
        <div class="toolbar">
          <button class="btn btn-primary btn-sm" id="cp-share">Créer le lien de partage</button>
          <span id="cp-share-out" style="flex:1;min-width:0"></span>
        </div>
        <div id="cp-share-zone"></div>
      </div>` : `<p class="muted" style="font-size:.82rem;border-top:1px dashed var(--line);padding-top:10px">💡 Ouvrez un chantier pour créer un <b>lien de partage client</b> (lecture seule).</p>`}
      <div style="border-top:1px dashed var(--line);margin-top:12px;padding-top:10px" class="toolbar">
        <button class="btn btn-ghost btn-sm" id="cp-logout">Se déconnecter</button>
        <span class="grow"></span>
        <button class="btn btn-ghost btn-sm" data-action="close-modal">Fermer</button>
      </div>
      <p class="muted" style="font-size:.78rem;margin-top:8px">🛡️ <b>Offline-first</b> : tout fonctionne sans réseau ; la synchro envoie vos données quand la connexion revient.</p>`);

    $('#cp-sync').addEventListener('click', () => pushNow(true));
    $('#cp-pull').addEventListener('click', () => pullNow(false));
    $('#cp-logout').addEventListener('click', () => { doLogout(); const r = $('#modal-root'); if (r) r.innerHTML = ''; toast('👋 Déconnecté — vos données restent sur l\'appareil'); });
    const sh = $('#cp-share');
    if (sh) sh.addEventListener('click', async () => {
      sh.disabled = true; sh.textContent = 'Création…';
      try {
        const res = await api('/share', { method: 'POST', body: JSON.stringify({ projectId: pid }) });
        const url = location.origin + '/share/' + res.token;
        $('#cp-share-zone').innerHTML = `
          <input class="share-url" id="share-url" value="${escH(url)}" readonly>
          <div class="toolbar"><button class="btn btn-ghost btn-sm" id="cp-copy">📋 Copier le lien</button>
          <a class="btn btn-ghost btn-sm" href="${escH(url)}" target="_blank" rel="noopener">👁 Voir la page</a></div>`;
        $('#cp-copy').addEventListener('click', async () => {
          const inp = $('#share-url');
          try { await navigator.clipboard.writeText(url); }
          catch (e) { inp.select(); document.execCommand('copy'); }
          toast('📋 Lien copié !');
        });
      } catch (e) { alert('⚠️ ' + e.message); }
      sh.disabled = false; sh.textContent = 'Créer le lien de partage';
    });
  }

  /* ---------------- Modales utilitaires ---------------- */
  function openCloudModal(html) {
    $('#modal-root').innerHTML = `<div class="modal-overlay"><div class="modal" role="dialog">${html}</div></div>`;
  }

  /* ---------------- Auth ---------------- */
  function openAuthModal(mode) {
    const isReg = mode === 'register';
    openCloudModal(`
      <h2>${isReg ? '👤 Créer un compte' : '👤 Connexion'}</h2>
      <p class="muted" style="font-size:.85rem">Le compte active la <b>synchro multi-appareils</b>, le <b>partage client</b> et l'<b>analyse PDF cloud</b>. Sans compte, tout reste fonctionnel en local. 🛡️</p>
      <form id="cloud-auth-form">
        ${isReg ? `<label class="field"><span>Nom / société</span><input name="name" placeholder="Ex : BTP Rakoto SARL"></label>` : ''}
        <label class="field"><span>E-mail *</span><input type="email" name="email" required placeholder="vous@exemple.com"></label>
        <label class="field"><span>Mot de passe * (6 min.)</span><input type="password" name="password" required minlength="6" placeholder="••••••••"></label>
        <div class="form-actions">
          <button type="button" class="link" id="cloud-switch">${isReg ? 'J\'ai déjà un compte → Connexion' : 'Pas de compte → Créer un compte'}</button>
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-action="close-modal">Plus tard</button>
          <button class="btn btn-primary" type="submit">${isReg ? 'Créer et connecter' : 'Connexion'}</button>
        </div>
      </form>`);
    $('#cloud-switch').addEventListener('click', () => openAuthModal(isReg ? 'login' : 'register'));
    $('#cloud-auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Connexion…';
      try {
        const res = await api(isReg ? '/auth/register' : '/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: fd.get('email'), password: fd.get('password'), name: fd.get('name') })
        });
        token = res.token; user = res.user;
        cpSet('cp-token', token); cpSet('cp-user', JSON.stringify(user));
        const r = $('#modal-root'); if (r) r.innerHTML = '';
        toast('👋 Bienvenue ' + (user.name || '') + ' !');
        await afterLogin();
      } catch (err) {
        alert('⚠️ ' + err.message);
        btn.disabled = false; btn.textContent = isReg ? 'Créer et connecter' : 'Connexion';
      }
      updateCloudUI();
    });
  }

  async function afterLogin() {
    if (!user || !token || !online()) return;
    try {
      const st = await api('/sync/status', { silent401: true });
      if (st.hasSnapshot && !Store.data.projects.length) await pullNow(true);         /* nouvel appareil vide → restaure */
      else if (st.hasSnapshot && st.updatedAt > base && dirty) { conflictPause = true; openConflictModal(st.updatedAt); }
      else await pushNow(false);                                                      /* sinon on envoie le local */
    } catch (e) { /* silencieux */ }
    ensureCloudUI();
  }

  function doLogout(expired) {
    token = null; user = null;
    cpSet('cp-token', ''); cpSet('cp-user', '');
    if (expired === true) toast('⌛ Session expirée — reconnectez-vous');
    ensureCloudUI();
  }

  /* ---------------- Import PDF cloud ---------------- */
  function patchImportModal() {
    if (typeof window.openImportTasksModal !== 'function') return;
    const orig = window.openImportTasksModal;
    window.openImportTasksModal = function (pid, rows) {
      orig(pid, rows);
      if (!Array.isArray(rows)) injectPdfCloud(pid, orig);
    };
  }

  function injectPdfCloud(pid, origOpen) {
    const modal = $('#modal-root .modal');
    if (!modal || $('#cloud-pdf-block')) return;
    const actions = modal.querySelector('.form-actions');
    if (!actions) return;
    const div = document.createElement('div');
    div.id = 'cloud-pdf-block';
    div.className = 'cloud-pdf';
    const usable = user && online();
    div.innerHTML = `
      <b>📄 Importer directement un PDF <span class="badge ${usable ? 'green' : 'slate'}">cloud</span></b>
      <small>${usable
        ? 'Le serveur extrait le texte du PDF et détecte les tâches automatiquement. (Plannings scannés/purement graphiques non pris en charge hors IA.)'
        : 'Nécessite une connexion Internet et un compte cloud.'}</small>
      <div class="toolbar">
        <button class="btn ${usable ? 'btn-primary' : 'btn-ghost'} btn-sm" id="btn-pdf-cloud">${usable ? '☁️ Choisir un PDF à analyser' : '👤 Se connecter pour activer'}</button>
        <input type="file" id="pdf-cloud-input" accept="application/pdf" hidden>
        <span id="pdf-cloud-status" class="muted" style="font-size:.8rem"></span>
      </div>`;
    modal.insertBefore(div, actions);
    $('#btn-pdf-cloud').addEventListener('click', () => {
      if (!usable) { openAuthModal('login'); return; }
      $('#pdf-cloud-input').click();
    });
    $('#pdf-cloud-input').addEventListener('change', async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const st = $('#pdf-cloud-status');
      st.textContent = '⏳ Analyse du PDF en cours…';
      try {
        const fd = new FormData();
        fd.append('file', f);
        const res = await api('/planning/pdf', { method: 'POST', body: fd });
        toast('📄 ' + (res.tasksFound || 0) + ' tâche(s) détectée(s) dans le PDF');
        origOpen(pid, res.rows); /* réutilise la prévisualisation existante */
      } catch (err) {
        st.innerHTML = '<span style="color:var(--red)">⚠️ ' + escH(err.message) + '</span>';
      }
    });
  }

  /* ---------------- PWA ---------------- */
  function registerSW() {
    if ('serviceWorker' in navigator && API) {
      navigator.serviceWorker.register('/sw.js?v=313').catch(() => {});
      /* auto-mise à jour : recharge quand un nouveau SW prend le relais */
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) { refreshing = true; location.reload(); }
      });
    }
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      ensureCloudUI();
    });
  }

  /* ---------------- Réseau ---------------- */
  function bindNet() {
    window.addEventListener('online', () => {
      toast('🌐 Connexion rétablie');
      if (user && !conflictPause) pushNow(false);
      updateCloudUI();
    });
    window.addEventListener('offline', () => {
      toast('📴 Hors-ligne — toutes les fonctions locales restent disponibles');
      updateCloudUI();
    });
  }

  /* ---------------- Démarrage ---------------- */
  injectStyles();
  patchChrome();
  patchStoreSave();
  patchImportModal();
  registerSW();
  bindNet();
  ensureCloudUI();   /* affichage immédiat au 1er chargement */
  updateCloudUI();
  afterLogin().then(updateCloudUI);
})();
