'use strict';
/**
 * The bot's settings. Two files in data/:
 *  - config.json: everything the dashboard shows (guild, channels, switches),
 *  - secrets.json: the bot token and the IMC-Stream bridge secret. These are never given to a page.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { guildId: '', channels: {}, port: 8440, bridge: { url: 'http://127.0.0.1:8420' }, welcome: { on: true, joinRole: '' }, goLive: { on: true, ping: '' }, dryRun: true,
  moderation: { dmUser: true, decayDays: 30, ladder: { timeoutAt: 3, timeoutMinutes: 60, banAt: 5 } },
  automod: { on: false, warn: true, spam: { on: true, count: 5, seconds: 6 }, duplicate: { on: true, count: 3, seconds: 30 }, mentions: { on: true, max: 5 }, invites: { on: true },
    links: { on: false, allow: ['twitch.tv', 'youtube.com', 'youtu.be'] }, caps: { on: true, minLength: 15, percent: 70 }, emoji: { on: true, max: 10 }, words: { on: false, list: [] },
    raid: { on: true, joins: 8, seconds: 30 }, accountAge: { on: false, days: 3 }, exemptChannels: [] },
  xp: { on: false, min: 15, max: 25, cooldown: 60, announce: true, levelRoles: [] },
  starboard: { on: false, threshold: 3, emoji: '⭐' },
  antinuke: { on: false, maxActions: 3, seconds: 10 },
  verify: { roleName: 'Verified' },
  streamAlerts: { on: false, boosts: true, joins: false, milestones: true, milestoneEvery: 100 },
  announce: { on: false, raids: true, minRaid: 3, milestones: true, milestoneEvery: 100 },
  regulars: { on: false, minDays: 7, minConversations: 10, gapMinutes: 30, restrict: { links: true, attachments: true, invites: true, mentions: true, maxMentions: 2 }, exemptRoles: [], exemptChannels: [], notice: true },
  logging: { on: false, messages: true, members: true, roles: true, voice: false },
  mirror: { on: false, avatars: true, minRole: 'all', hideCommands: true, commandPrefixes: ['!'], showBadges: true, stripLinks: false, hideBots: ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot'], ignore: [] } };
// allowed values for the text settings
const ENUMS = { 'mirror.minRole': ['all', 'subs', 'vip'] };
// allowed ranges for the numbers in automod ('rule.field': [min, max])
const RANGES = { 'spam.count': [2, 30], 'spam.seconds': [2, 60], 'duplicate.count': [2, 20], 'duplicate.seconds': [5, 60], 'mentions.max': [1, 50], 'caps.minLength': [5, 200], 'caps.percent': [30, 100],
  'emoji.max': [1, 100], 'xp.min': [1, 500], 'xp.max': [1, 1000], 'xp.cooldown': [5, 3600], 'starboard.threshold': [1, 50], 'antinuke.maxActions': [2, 50], 'antinuke.seconds': [3, 120], 'streamAlerts.milestoneEvery': [10, 1000000], 'announce.minRaid': [1, 100000], 'announce.milestoneEvery': [10, 1000000], 'regulars.minDays': [0, 365], 'regulars.minConversations': [0, 500], 'regulars.gapMinutes': [5, 240], 'regulars.restrict.maxMentions': [0, 20], 'raid.joins': [2, 100], 'raid.seconds': [5, 600], 'accountAge.days': [1, 365] };
/** takes only the settings that exist, with the right kind of value and inside their range; anything else is dropped */
function cleanAutomod(def, inp, path) {
  const out = {};
  for (const k of Object.keys(def)) {
    const d = def[k], v = inp && inp[k], p = path ? path + '.' + k : k;
    if (v === undefined) { out[k] = d; continue; }
    if (typeof d === 'boolean') out[k] = !!v;
    else if (typeof d === 'number') { const r = RANGES[p] || [0, 1e6], n = Math.round(Number(v)); out[k] = Number.isFinite(n) ? Math.min(r[1], Math.max(r[0], n)) : d; }
    else if (typeof d === 'string') out[k] = (ENUMS[p] || []).includes(v) ? v : d;
    else if (Array.isArray(d)) out[k] = [...new Set((Array.isArray(v) ? v : String(v).split(/[\r\n,]+/)).map((x) => String(x).trim().toLowerCase()).filter((x) => x && x.length <= 60))].slice(0, 300);
    else out[k] = cleanAutomod(d, v, p);
  }
  return out;
}
const SECRET_KEYS = ['token', 'bridgeSecret', 'bridgePassword'];

module.exports = function createConfig(dir, log) {
  const say = log || (() => {}), CF = path.join(dir, 'config.json'), SF = path.join(dir, 'secrets.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
  const write = (f, o) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) { say('config save failed:', e.message); } };
  const C = Object.assign({}, JSON.parse(JSON.stringify(DEFAULTS)), read(CF, {})), S = Object.assign({ token: '', bridgeSecret: '', bridgePassword: '' }, read(SF, {}));
  C.automod = cleanAutomod(DEFAULTS.automod, C.automod, '');
  C.mirror = cleanAutomod(DEFAULTS.mirror, C.mirror, 'mirror');
  C.logging = cleanAutomod(DEFAULTS.logging, C.logging, 'logging');
  C.regulars = cleanAutomod(DEFAULTS.regulars, C.regulars, 'regulars');
  C.announce = cleanAutomod(DEFAULTS.announce, C.announce, 'announce');
  C.streamAlerts = cleanAutomod(DEFAULTS.streamAlerts, C.streamAlerts, 'streamAlerts');
  for (const k of ['xp', 'starboard', 'antinuke']) C[k] = cleanAutomod(DEFAULTS[k], C[k], k);
  C.moderation = Object.assign({}, DEFAULTS.moderation, C.moderation, { ladder: Object.assign({}, DEFAULTS.moderation.ladder, (C.moderation || {}).ladder) });   // an older file gets the new settings

  /** change settings; secrets go to their own file. Returns the page-safe view */
  function set(b) {
    b = b || {};
    for (const k of SECRET_KEYS) if (typeof b[k] === 'string') S[k] = b[k].trim();
    if (b.clearToken) S.token = '';
    if (b.bridge && typeof b.bridge.url === 'string') { try { const u = new URL(b.bridge.url.trim()); if (/^https?:$/.test(u.protocol)) C.bridge = Object.assign({}, C.bridge, { url: u.origin }); } catch (e) { /* not an address: keep the old one */ } }
    if (b.clearBridgePassword) S.bridgePassword = '';
    if (typeof b.guildId === 'string') C.guildId = /^\d{5,25}$/.test(b.guildId) ? b.guildId : '';
    if (b.dryRun !== undefined) C.dryRun = !!b.dryRun;
    if (b.welcome) C.welcome = Object.assign({}, C.welcome, { on: b.welcome.on !== undefined ? !!b.welcome.on : C.welcome.on });
    if (b.goLive) C.goLive = Object.assign({}, C.goLive, { on: b.goLive.on !== undefined ? !!b.goLive.on : C.goLive.on, ping: b.goLive.ping !== undefined ? String(b.goLive.ping).slice(0, 30) : C.goLive.ping });
    if (b.moderation) {
      const m = b.moderation, M = C.moderation, int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
      if (m.dmUser !== undefined) M.dmUser = !!m.dmUser;
      if (m.decayDays !== undefined) M.decayDays = int(m.decayDays, 0, 3650, M.decayDays);
      if (m.ladder) M.ladder = { timeoutAt: int(m.ladder.timeoutAt, 0, 50, M.ladder.timeoutAt), timeoutMinutes: int(m.ladder.timeoutMinutes, 1, 40320, M.ladder.timeoutMinutes), banAt: int(m.ladder.banAt, 0, 50, M.ladder.banAt) };
    }
    if (b.automod) C.automod = cleanAutomod(C.automod, b.automod, '');
    for (const k of ['xp', 'starboard', 'antinuke']) if (b[k]) C[k] = cleanAutomod(C[k], b[k], k);
    if (b.streamAlerts) C.streamAlerts = cleanAutomod(C.streamAlerts, b.streamAlerts, 'streamAlerts');
    if (b.announce) C.announce = cleanAutomod(C.announce, b.announce, 'announce');
    if (b.regulars) C.regulars = cleanAutomod(C.regulars, b.regulars, 'regulars');
    if (b.logging) C.logging = cleanAutomod(C.logging, b.logging, 'logging');
    if (b.mirror) C.mirror = cleanAutomod(C.mirror, b.mirror, 'mirror');
    write(CF, C); write(SF, S); return view();
  }
  function setChannels(map) { C.channels = Object.assign({}, C.channels, map); write(CF, C); }
  const view = () => Object.assign({}, C, { hasToken: !!S.token, hasBridgeSecret: !!S.bridgeSecret, hasBridgePassword: !!S.bridgePassword });
  return { get: () => C, secret: (k) => S[k] || '', set, setChannels, view };
};
