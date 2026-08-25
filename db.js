/* ChantierPro Cloud — mini base de données JSON (persistance fichier, atomique) */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let cache = null;

function fresh() {
  return {
    /* JWT_SECRET en variable d'environnement = sessions stables même si la base régénère */
    settings: { jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex') },
    users: [],        // { id, email, name, passHash, createdAt }
    snapshots: {},    // userId -> { data, photos, updatedAt }
    shares: []        // { token, userId, projectId, projectName, data, photos, createdAt }
  };
}

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) save(fresh());
}

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { cache = fresh(); }
  return cache;
}

function save(db) {
  cache = db;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

module.exports = { init, load, save };
