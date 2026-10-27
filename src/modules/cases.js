'use strict';
/**
 * Moderation cases: every warning, timeout, kick, ban, unban and note gets a number and stays on record.
 * A warning also has a date when it stops counting (so one old slip does not climb the warn ladder forever).
 */
const DAY = 86400000;

/** "10m", "2h", "7d", "45s", "1w"; a plain number means minutes. Returns milliseconds, or null when it makes no sense */
function parseDuration(text) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?\s*$/i.exec(String(text || ''));
  if (!m) return null;
  const ms = Number(m[1]) * { s: 1000, m: 60000, h: 3600000, d: DAY, w: 7 * DAY }[(m[2] || 'm').toLowerCase()];
  return ms >= 1000 ? Math.round(ms) : null;
}
/** 90000 -> "1 min 30 s" style, short */
function fmtDuration(ms) {
  const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000);
  const parts = [d && d + ' d', h && h + ' h', m && m + ' min', !d && !h && !m && s && s + ' s'].filter(Boolean);
  return parts.join(' ') || '0 s';
}

module.exports = function createCases(db, nowFn) {
  const now = nowFn || Date.now;
  const ins = db.prepare('INSERT INTO cases (guild_id, type, target_discord_id, target_twitch_id, moderator, reason, source, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insWarn = db.prepare('INSERT INTO warnings (case_id, decays_at) VALUES (?, ?)');
  const byId = db.prepare('SELECT * FROM cases WHERE id = ? AND guild_id = ?');
  const byTarget = db.prepare('SELECT * FROM cases WHERE guild_id = ? AND target_discord_id = ? ORDER BY id DESC LIMIT ?');
  const active = db.prepare("SELECT COUNT(*) AS n FROM cases c JOIN warnings w ON w.case_id = c.id WHERE c.guild_id = ? AND c.target_discord_id = ? AND c.type = 'warn' AND c.undone_at IS NULL AND w.decays_at > ?");
  const undoStmt = db.prepare('UPDATE cases SET undone_at = ? WHERE id = ? AND guild_id = ? AND undone_at IS NULL');
  const counts = db.prepare('SELECT type, COUNT(*) AS n FROM cases WHERE guild_id = ? AND target_discord_id = ? AND undone_at IS NULL GROUP BY type');

  /** a new case; returns its row. decayDays is only for warnings */
  function create(f) {
    const at = now(), r = ins.run(f.guildId, f.type, f.target, f.twitchId || null, f.moderator || '', String(f.reason || '').slice(0, 1000), f.source || 'discord', at, f.expiresAt || null);
    const id = Number(r.lastInsertRowid);
    if (f.type === 'warn') insWarn.run(id, at + (f.decayDays > 0 ? f.decayDays : 36500) * DAY);
    return get(f.guildId, id);
  }
  const get = (guildId, id) => byId.get(Number(id), guildId) || null;
  const history = (guildId, target, limit) => byTarget.all(guildId, target, limit || 10);
  const activeWarnings = (guildId, target) => active.get(guildId, target, now()).n;
  /** marks a case as undone (a lifted ban, a removed warning). false when it was not found or already undone */
  const undo = (guildId, id) => undoStmt.run(now(), Number(id), guildId).changes > 0;
  const summary = (guildId, target) => Object.fromEntries(counts.all(guildId, target).map((r) => [r.type, r.n]));
  return { create, get, history, activeWarnings, undo, summary };
};
module.exports.parseDuration = parseDuration;
module.exports.fmtDuration = fmtDuration;
