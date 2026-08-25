/* ChantierPro Cloud — extraction de tâches depuis du texte (mêmes règles que le client) */
'use strict';

const pad2 = n => String(n).padStart(2, '0');

function parseDateFlexible(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
  return null;
}

function parsePlanningText(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { rows: [], error: 'Aucune ligne détectée.' };

  const delims = ['\t', ';', ',', '  ']; // ajout : doubles espaces (fréquent dans les PDF)
  let delim = delims[0], best = 0;
  for (const d of delims) {
    const c = Math.max(...lines.slice(0, 12).map(l => l.split(d).length));
    if (c > best) { best = c; delim = d; }
  }
  if (best < 2) return { rows: [], error: 'Format non reconnu.' };

  let rows = lines.map(l => l.split(delim).map(c => c.trim()).filter((c, i, a) => !(c === '' && i !== 0)));
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
    if (start && end && end < start) { const t = start; start = end; end = t; }
    const err = !name ? '' : (!start ? 'Dates introuvables' : '');
    return { name, trade, start, end, progress, ok: !!name && !!start, err };
  }).filter(r => r.name || r.err);

  return { rows: parsed };
}

module.exports = { parsePlanningText };
