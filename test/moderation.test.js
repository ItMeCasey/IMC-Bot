'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const openDb = require('../src/db');
const createCases = require('../src/modules/cases');
const createModeration = require('../src/modules/moderation');
const createConfig = require('../src/config');
const { parseDuration, fmtDuration } = createCases;

test('durations: 10m, 2h, 7d, plain numbers are minutes, nonsense is refused', () => {
  assert.equal(parseDuration('10m'), 600000); assert.equal(parseDuration('2h'), 7200000); assert.equal(parseDuration('7d'), 604800000);
  assert.equal(parseDuration('1w'), 604800000); assert.equal(parseDuration('45'), 2700000); assert.equal(parseDuration('30s'), 30000);
  for (const bad of ['', 'abc', '-5m', '0m', '10x', '0.0001s']) assert.equal(parseDuration(bad), null, bad);
  assert.equal(fmtDuration(90061000), '1 d 1 h 1 min'); assert.equal(fmtDuration(30000), '30 s');
});

test('cases: numbering, history, warnings that decay or are removed, summary, undo once', () => {
  let t = 1e12; const c = createCases(openDb(':memory:'), () => t);
  const w1 = c.create({ guildId: 'G', type: 'warn', target: 'U', moderator: 'M', reason: 'a', decayDays: 30 });
  c.create({ guildId: 'G', type: 'warn', target: 'U', moderator: 'M', reason: 'b', decayDays: 30 });
  c.create({ guildId: 'G', type: 'note', target: 'U', moderator: 'M', reason: 'n' }); c.create({ guildId: 'G', type: 'warn', target: 'OTHER', moderator: 'M', reason: 'x', decayDays: 30 });
  assert.equal(w1.id, 1); assert.equal(c.activeWarnings('G', 'U'), 2); assert.deepEqual(c.history('G', 'U').map((x) => x.id), [3, 2, 1], 'newest first, only that person');
  assert.equal(c.get('OTHERGUILD', 1), null, 'cases belong to a server');
  assert.equal(c.undo('G', 1), true); assert.equal(c.undo('G', 1), false); assert.equal(c.activeWarnings('G', 'U'), 1, 'a removed warning does not count');
  assert.deepEqual(c.summary('G', 'U'), { warn: 1, note: 1 });
  t += 31 * 86400000; assert.equal(c.activeWarnings('G', 'U'), 0, 'old warnings stop counting');
  c.create({ guildId: 'G', type: 'warn', target: 'U', moderator: 'M', reason: 'forever', decayDays: 0 }); t += 5000 * 86400000; assert.equal(c.activeWarnings('G', 'U'), 1, '0 days = never decays');
});

test('config: moderation settings are clamped and old files get the new defaults', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-bot-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ guildId: '', dryRun: false }));
  const c = createConfig(dir); assert.equal(c.get().moderation.ladder.banAt, 5, 'defaults for a file from before');
  const v = c.set({ moderation: { decayDays: 99999, dmUser: false, ladder: { timeoutAt: -4, timeoutMinutes: 'x', banAt: 7 } } });
  assert.deepEqual(v.moderation, { dmUser: false, decayDays: 3650, ladder: { timeoutAt: 0, timeoutMinutes: 60, banAt: 7 } });
});

/** a pretend Discord server and an interaction builder */
function rig(over) {
  const db = openDb(':memory:'), calls = [], posts = [], dms = [], cmds = new Map(), btns = {}, fail = {};
  const cfg = Object.assign({ channels: { modLog: 'L' }, dryRun: false, moderation: { dmUser: true, decayDays: 30, ladder: { timeoutAt: 2, timeoutMinutes: 60, banAt: 3 } } }, over);
  const members = {
    me: { id: 'BOT', roles: { highest: { position: 20 } } }, fetchMe: async () => members.me,
    fetch: async (id) => ({ timeout: async (ms, w) => { if (fail.timeout) throw fail.timeout; calls.push(['timeout', id, ms, w]); } }),
    kick: async (id, w) => calls.push(['kick', id, w]), unban: async (id, w) => { if (fail.unban) throw fail.unban; calls.push(['unban', id, w]); },
    ban: async (id, o) => { if (fail.ban) throw fail.ban; calls.push(['ban', id, o]); },
  };
  const guild = { id: 'G', name: 'Test server', ownerId: 'OWNER', members };
  const logCh = { send: async (m) => { posts.push(m); } };
  const ctx = { db, config: { get: () => cfg }, log() {}, botId: () => 'BOT', fetchChannel: async (id) => (id === 'L' ? logCh : null), now: () => 1e12,
    discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } };
  const mod = createModeration(ctx);
  const target = (id) => ({ id, tag: id + '#1', send: async (m) => { dms.push([id, m]); } });
  /** an interaction by a moderator (position 10) on a target whose top role is at `pos` */
  const ix = (opts, o) => { o = o || {}; const replies = []; return { replies, guild, user: { id: o.by || 'MOD', tag: 'mod#1' }, member: { roles: { highest: { position: o.myPos || 10 } } },
    options: { getUser: (n) => (opts[n] ? target(opts[n]) : null), getMember: (n) => (opts[n] && !opts.absent ? { roles: { highest: { position: o.pos == null ? 5 : o.pos } } } : null),
      getString: (n) => (opts[n] == null ? null : opts[n]), getInteger: (n) => (opts[n] == null ? null : opts[n]) },
    deferReply: async () => {}, editReply: async (m) => { replies.push(m); } }; };
  const run = async (name, opts, o) => { const i = ix(opts, o); await cmds.get(name).run(i); return i.replies.at(-1); };
  return { mod, cmds, btns, calls, posts, dms, db, fail, run, ix, cfg };
}

test('warn records a case, tells the person, posts to #mod-log with Undo and counts active warnings', async () => {
  const r = rig(), reply = await r.run('warn', { user: 'U1', reason: 'spam' });
  assert.match(reply.content, /Warned <@U1> \(case #1\)\. Active warnings: 1\./);
  assert.equal(r.dms.length, 1); assert.match(r.dms[0][1].embeds[0].title, /warned in Test server/); assert.match(r.dms[0][1].embeds[0].description, /spam/);
  const post = r.posts[0]; assert.match(post.embeds[0].title, /Case #1: Warning/); assert.equal(post.components.length, 1); assert.deepEqual(post.allowedMentions, { parse: [] });
  assert.equal(r.mod.cases.get('G', 1).reason, 'spam');
  r.cfg.moderation.dmUser = false; await r.run('warn', { user: 'U2', reason: 'x' }); assert.equal(r.dms.length, 1, 'DMs can be switched off');
});

test('the warn ladder times out at 2 and bans at 3, and only says so in a dry run', async () => {
  const r = rig();
  await r.run('warn', { user: 'U1', reason: '1' }); assert.equal(r.calls.length, 0);
  const second = await r.run('warn', { user: 'U1', reason: '2' });
  assert.deepEqual(r.calls[0].slice(0, 3), ['timeout', 'U1', 3600000]); assert.match(second.content, /timed them out/);
  assert.equal(r.mod.cases.get('G', 3).source, 'warn-ladder', 'the ladder action is its own case');
  await r.run('warn', { user: 'U1', reason: '3' }); assert.equal(r.calls.at(-1)[0], 'ban');
  const dry = rig({ dryRun: true }); await dry.run('warn', { user: 'U1', reason: '1' }); const d = await dry.run('warn', { user: 'U1', reason: '2' });
  assert.equal(dry.calls.length, 0, 'nothing happens in a dry run'); assert.match(d.content, /dry run/); assert.ok(dry.posts.some((p) => /Dry run: would timeout/.test(p.embeds[0].title)));
});

test('nobody can act on themselves, the bot, the owner or someone at their own level; refused actions leave no case', async () => {
  const r = rig();
  await assert.rejects(r.run('warn', { user: 'MOD', reason: 'x' }), /yourself/);
  await assert.rejects(r.run('warn', { user: 'BOT', reason: 'x' }), /myself/);
  await assert.rejects(r.run('ban', { user: 'OWNER' }), /owner/);
  await assert.rejects(r.run('warn', { user: 'U', reason: 'x' }, { pos: 10 }), /as high as yours/);
  await assert.rejects(r.run('warn', { user: 'U', reason: 'x' }, { pos: 25, myPos: 30 }), /not above theirs/);
  assert.equal(r.mod.cases.history('G', 'U').length, 0); assert.equal(r.calls.length, 0);
  assert.equal((await r.run('warn', { user: 'U', reason: 'x' }, { by: 'OWNER', myPos: 99, pos: 15 })).content.startsWith('Warned'), true, 'the owner may act on anyone below the bot');
});

test('timeout checks the length, kick/ban/unban act, and a failure by Discord voids the case with a plain message', async () => {
  const r = rig();
  await assert.rejects(r.run('timeout', { user: 'U', duration: 'soon' }), /duration like 10m/);
  await assert.rejects(r.run('timeout', { user: 'U', duration: '29d' }), /up to 28d/);
  await assert.rejects(r.run('timeout', { user: 'U', duration: '10m', absent: true }), /not in this server/);
  const t = await r.run('timeout', { user: 'U', duration: '2h', reason: 'cool off' }); assert.match(t.content, /2 h/); assert.equal(r.calls[0][2], 7200000); assert.match(r.calls[0][3], /Case 1 by mod#1: cool off/, 'the audit log says who and why');
  await r.run('kick', { user: 'U', reason: 'k' }); assert.equal(r.calls[1][0], 'kick');
  await r.run('ban', { user: 'U', reason: 'b', delete_days: 3 }); assert.deepEqual(r.calls[2][2], { reason: 'Case 3 by mod#1: b', deleteMessageSeconds: 3 * 86400 });
  await assert.rejects(r.run('unban', { user_id: 'abc' }), /only digits/); await r.run('unban', { user_id: '123456789' }); assert.equal(r.calls[3][1], '123456789');
  r.fail.ban = Object.assign(new Error('x'), { code: 50013 });
  await assert.rejects(r.run('ban', { user: 'U2', reason: 'b' }), /lacks the permission/);
  assert.equal(r.mod.cases.get('G', 5).undone_at, 1e12, 'the failed ban is not on record as done');
});

test('unwarn, note, case and history', async () => {
  const r = rig({ moderation: { dmUser: false, decayDays: 30, ladder: { timeoutAt: 0, timeoutMinutes: 60, banAt: 0 } } });
  await r.run('warn', { user: 'U', reason: 'a' }); await r.run('note', { user: 'U', text: 'seems new' });
  await assert.rejects(r.run('unwarn', { case: 2 }), /not a warning/); await assert.rejects(r.run('unwarn', { case: 99 }), /not a warning/);
  assert.match((await r.run('unwarn', { case: 1 })).content, /0 active/); await assert.rejects(r.run('unwarn', { case: 1 }), /already removed/);
  assert.match((await r.run('case', { number: 2 })).embeds[0].fields.at(-1).value, /seems new/); await assert.rejects(r.run('case', { number: 9 }), /No such case/);
  const h = (await r.run('history', { user: 'U' })).embeds[0]; assert.match(h.description, /1 note/); assert.match(h.description, /\(undone\)/); assert.match(h.description, /Active warnings: \*\*0\*\*/);
  assert.match((await r.run('history', { user: 'NEW' })).embeds[0].description, /Clean record/);
});

test('Undo button lifts a ban or timeout once, only for mods, and removes itself', async () => {
  const r = rig(); await r.run('ban', { user: 'U', reason: 'b' });
  const press = (perm) => { const i = { customId: 'undo:1', guild: { id: 'G', members: { unban: async (id, w) => r.calls.push(['unban', id, w]) } }, user: { id: 'M2', tag: 'm2#1' }, memberPermissions: { has: (p) => perm && p === F.ModerateMembers }, out: [], reply: async (m) => i.out.push(['reply', m.content]), update: async (m) => i.out.push(['update', m.components]) }; return i; };
  const no = press(false); await r.btns.undo(no); assert.deepEqual(no.out, [['reply', 'Only mods can undo.']]); assert.equal(r.mod.cases.get('G', 1).undone_at, null);
  const yes = press(true); await r.btns.undo(yes); assert.deepEqual(yes.out, [['update', []]]); assert.equal(r.calls.at(-1)[0], 'unban'); assert.match(r.calls.at(-1)[2], /Undo of case 1 by m2#1/);
  assert.ok(r.mod.cases.get('G', 1).undone_at); assert.ok(r.posts.some((p) => /Case #1 undone/.test(p.embeds[0].title)));
  const again = press(true); await r.btns.undo(again); assert.deepEqual(again.out, [['update', []]]); assert.equal(r.calls.filter((c) => c[0] === 'unban').length, 1, 'not twice');
});

test('purge, slowmode, lock and unlock do their job and are logged', async () => {
  const r = rig(), deleted = []; let slow = null; const edits = [];
  const msgs = new Map([...Array(5).keys()].map((n) => [String(n), { id: String(n), author: { id: n % 2 ? 'A' : 'B' } }]));
  const i0 = r.ix({ count: 3, user: 'A' }); i0.channel = { id: 'C', messages: { fetch: async () => msgs }, bulkDelete: async (list) => { deleted.push(...list.map((m) => m.id)); return { size: list.length }; }, setRateLimitPerUser: async (s) => { slow = s; }, permissionOverwrites: { edit: async (role, o) => edits.push(o) } };
  i0.guild = Object.assign({}, i0.guild, { roles: { everyone: { id: 'G' } } });
  await r.cmds.get('purge').run(i0); assert.deepEqual(deleted, ['1', '3'], 'only that person, newest requested'); assert.match(i0.replies.at(-1).content, /Deleted 2/);
  const i1 = r.ix({ seconds: 30 }); i1.channel = i0.channel; await r.cmds.get('slowmode').run(i1); assert.equal(slow, 30);
  const i2 = r.ix({}); i2.channel = i0.channel; i2.guild = i0.guild; await r.cmds.get('lock').run(i2); await r.cmds.get('unlock').run(i2); assert.deepEqual(edits, [{ SendMessages: false }, { SendMessages: null }]);
  assert.ok(r.posts.length >= 4, 'each one is in #mod-log');
});

test('slash commands are hidden from people without the matching permission, and cannot be used in DMs', () => {
  const r = rig(), need = { warn: F.ModerateMembers, kick: F.KickMembers, ban: F.BanMembers, purge: F.ManageMessages, lock: F.ManageChannels };
  for (const [n, p] of Object.entries(need)) { const j = r.cmds.get(n).data.toJSON(); assert.equal(j.default_member_permissions, p.toString(), n); assert.equal(j.dm_permission, false, n); }
  assert.equal(r.cmds.size, 14);
});
