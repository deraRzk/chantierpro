/* ChantierPro Cloud — base de données
   Double mode :
   1) Fichier JSON (par défaut / développement) — persistance locale atomique.
   2) PostgreSQL en ligne (production) — activé automatiquement si DATABASE_URL
      est défini (ex. Neon gratuit). Les données survivent alors aux
      redémarrages/effacements du disque de l'hébergeur.
   API synchrone (cache en mémoire) + écritures PG débrayées en arrière-plan. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const DATABASE_URL = process.env.DATABASE_URL || null;

let cache = null;
let pool = null;          /* Pool pg actif (null = mode fichier) */
let initPromise = null;
let saveTimer = null;

function fresh() {
  return {
    /* JWT_SECRET en variable d'environnement = sessions stables même si la base régénère */
    settings: { jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex') },
    users: [],        // { id, email, name, passHash, createdAt }
    snapshots: {},    // userId -> { data, photos, updatedAt }
    shares: []        // { token, userId, projectId, projectName, data, photos, createdAt }
  };
}

/* ---------------- Stockage fichier (toujours actif en secours) ---------------- */
function initFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) saveFile(fresh());
}
function loadFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return fresh(); }
}
function saveFile(db) {
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  } catch (e) { /* disque plein/indispo : on continue quand même (cache vivant) */ }
}

/* ---------------- PostgreSQL en ligne (si DATABASE_URL) ---------------- */
async function initPg() {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1|^pgmem:/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 10000
  });
  await pool.query('CREATE TABLE IF NOT EXISTS chantierpro_kv (k TEXT, v TEXT)');
  const r = await pool.query("SELECT v FROM chantierpro_kv WHERE k = 'db'");
  if (r.rows.length && r.rows[0].v) {
    cache = JSON.parse(r.rows[0].v);
    saveFile(cache); /* synchronise le secours local */
    console.log('🐘 Base PostgreSQL connectée — données restaurées (' + cache.users.length + ' compte(s))');
  } else {
    cache = loadFile();          /* 1re fois : on migre les données fichier vers PG */
    await persistNow();
    console.log('🐘 Base PostgreSQL initialisée (migration fichier → PG)');
  }
}
async function persistNow() {
  if (!pool || !cache) return;
  const v = JSON.stringify(cache);
  /* DELETE + INSERT transactionnel (compatible partout, sans ON CONFLICT) */
  await pool.query('BEGIN');
  try {
    await pool.query("DELETE FROM chantierpro_kv WHERE k = 'db'");
    await pool.query("INSERT INTO chantierpro_kv (k, v) VALUES ('db', $1)", [v]);
    await pool.query('COMMIT');
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
function schedulePersist() {
  if (!pool) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistNow().catch(e => console.error('⚠ sauvegarde PG :', e.message));
  }, 700);
}

/* ---------------- API publique (inchangée pour le reste du code) ---------------- */
function init() { initFile(); }

function load() {
  if (!cache) cache = loadFile();
  return cache;
}

function save(db) {
  cache = db;
  saveFile(db);      /* secours local immédiat */
  schedulePersist(); /* + Postgres en arrière-plan si activé */
}

/* À attendre AVANT d'ouvrir le port : branche PG si DATABASE_URL, sinon mode fichier */
function ready() {
  if (!DATABASE_URL) return Promise.resolve();
  if (!initPromise) {
    initPromise = initPg().catch(e => {
      console.error('⚠ PostgreSQL indisponible (' + e.message + ') — repli sur le fichier local');
      pool = null;
    });
  }
  return initPromise;
}

module.exports = { init, load, save, ready };
