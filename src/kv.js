'use strict';
/** Small named values kept in the database (cursors, the last go-live message). */
module.exports = function createKv(db) {
  const g = db.prepare('SELECT value FROM kv WHERE key = ?'), s = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  return { get: (k) => { const r = g.get(k); return r ? r.value : ''; }, set: (k, v) => { s.run(k, String(v)); } };
};
