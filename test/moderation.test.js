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
  const members = { pos: {}, gone: new Set(),
    me: { id: 'BOT', roles: { highest: { position: 20 } } }, fetchMe: async () => members.me,
    fetch: async (id) => (members.gone && members.gone.has(id) ? Promise.reject(new Error('Unknown Member')) : { roles: { highest: { position: members.pos[id] == null ? 5 : members.pos[id] } }, timeout: async (ms, w) => { if (fail.timeout) throw fail.timeout; calls.push(['timeout', id, ms, w]); } }),
    kick: async (id, w) => calls.push(['kick', id, w]), unban: async (id, w) => { if (fail.unban) throw fail.unban; calls.push(['unban', id, w]); },
    ban: async (id, o) => { if (fail.ban) throw fail.ban; calls.push(['ban', id, o]); },
  };
  const guild = { id: 'G', name: 'Test server', ownerId: 'OWNER', members };
  const logCh = { send: async (m) => { posts.push(m); } };
  const lockMemory = new Map(), ctx = { kv: { get: (k) => lockMemory.get(k) || '', set: (k, v) => lockMemory.set(k, v) }, db, config: { get: () => cfg }, log() {}, botId: () => 'BOT', fetchChannel: async (id) => (id === 'L' ? logCh : null), now: () => 1e12,
    discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } };
  const mod = createModeration(ctx);
  const target = (id) => ({ id, tag: id + '#1', send: async (m) => { dms.push([id, m]); } });
  /** an interaction by a moderator (position 10) on a target whose top role is at `pos` */
  const ix = (opts, o) => { o = o || {}; const replies = []; return { replies, memberPermissions: { has: () => true }, guild, user: { id: o.by || 'MOD', tag: 'mod#1' }, member: { roles: { highest: { position: o.myPos || 10 } } },
    options: { getUser: (n) => (opts[n] ? target(opts[n]) : null), getMember: (n) => (opts[n] && !opts.absent ? { roles: { highest: { position: o.pos == null ? 5 : o.pos } } } : null),
      getString: (n) => (opts[n] == null ? null : opts[n]), getInteger: (n) => (opts[n] == null ? null : opts[n]) },
    deferReply: async () => {}, editReply: async (m) => { replies.push(m); } }; };
  const run = async (name, opts, o) => { const i = ix(opts, o); await cmds.get(name).run(i); return i.replies.at(-1); };
  return { mod, cmds, btns, calls, posts, dms, db, fail, run, ix, cfg, guild, members, ctx };
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

/** a press of the Undo button by `uid` who has these permissions and whose top role is at `pos` */
function undoPress(r, uid, perms, pos) {
  const i = { customId: 'undo:1', guild: r.guild, user: { id: uid, tag: uid + '#1' }, member: { roles: { highest: { position: pos == null ? 10 : pos } } }, memberPermissions: { has: (p) => perms.includes(p) }, out: [],
    reply: async (m) => i.out.push(['reply', m.content]), update: async (m) => i.out.push(['update', m.components]) };
  return i;
}

test('Undo needs the permission of the action it undoes (Ban Members for a ban), lifts it once, and removes itself', async () => {
  const r = rig(); await r.run('ban', { user: 'U', reason: 'b' });
  const none = undoPress(r, 'M2', []); await r.btns.undo(none); assert.match(none.out[0][1], /Only mods can undo a ban/); assert.equal(r.mod.cases.get('G', 1).undone_at, null);
  const timeoutMod = undoPress(r, 'M2', [F.ModerateMembers]); await r.btns.undo(timeoutMod); assert.match(timeoutMod.out[0][1], /Ban Members/, 'a mod who can only time people out cannot lift a ban');
  assert.equal(r.calls.filter((c) => c[0] === 'unban').length, 0);
  const yes = undoPress(r, 'M2', [F.BanMembers]); await r.btns.undo(yes); assert.deepEqual(yes.out, [['update', []]]); assert.equal(r.calls.at(-1)[0], 'unban'); assert.match(r.calls.at(-1)[2], /Undo of case 1 by M2#1/);
  assert.ok(r.mod.cases.get('G', 1).undone_at); assert.ok(r.posts.some((p) => /Case #1 undone/.test(p.embeds[0].title)));
  const again = undoPress(r, 'M2', [F.BanMembers]); await r.btns.undo(again); assert.deepEqual(again.out, [['update', []]]); assert.equal(r.calls.filter((c) => c[0] === 'unban').length, 1, 'not twice');
  const gone = undoPress(r, 'M2', [F.BanMembers]); gone.customId = 'undo:99'; await r.btns.undo(gone); assert.match(gone.out[0][1], /gone/);
});

test('Undo follows the role rules: not your own case, not someone above you, not a case a higher-ranked mod made; the owner may', async () => {
  const r = rig(); await r.run('timeout', { user: 'U', duration: '1h' }, { by: 'BOSS' }); r.members.pos.BOSS = 50; r.members.pos.U = 5;
  const self = undoPress(r, 'U', [F.ModerateMembers]); await r.btns.undo(self); assert.match(self.out[0][1], /cannot do that to yourself/, 'nobody lifts their own timeout');
  const lower = undoPress(r, 'M2', [F.ModerateMembers], 10); await r.btns.undo(lower); assert.match(lower.out[0][1], /higher role made this case/, 'a lower-ranked mod cannot undo what the boss did'); assert.equal(r.mod.cases.get('G', 1).undone_at, null);
  r.members.pos.U = 15; const above = undoPress(r, 'M2', [F.ModerateMembers], 10); await r.btns.undo(above); assert.match(above.out[0][1], /as high as yours/, 'the target outranks them');
  r.members.pos.U = 5; const peer = undoPress(r, 'BOSS2', [F.ModerateMembers], 60); r.members.pos.BOSS2 = 60; await r.btns.undo(peer); assert.deepEqual(peer.out, [['update', []]], 'a higher-ranked mod may');
  assert.equal(r.calls.at(-1)[0], 'timeout'); assert.equal(r.calls.at(-1)[2], null, 'the timeout was lifted');
  const o = rig(); await o.run('warn', { user: 'U', reason: 'x' }, { by: 'BOSS' }); o.members.pos.BOSS = 50; const owner = undoPress(o, 'OWNER', [F.ModerateMembers], 1); await o.btns.undo(owner); assert.deepEqual(owner.out, [['update', []]], 'the server owner may undo anything');
});

test('every command checks the real permission when it runs, not only the default Discord hides it with', async () => {
  const r = rig(), try1 = async (name, opts, perms) => { const i = r.ix(opts); i.memberPermissions = { has: (p) => perms.includes(p) }; return r.cmds.get(name).run(i); };
  await assert.rejects(try1('ban', { user: 'U' }, [F.ModerateMembers]), /You need the "BanMembers" permission/); await assert.rejects(try1('warn', { user: 'U', reason: 'x' }, []), /ModerateMembers/); await assert.rejects(try1('purge', { count: 1 }, [F.ModerateMembers]), /ManageMessages/);
  await assert.rejects(try1('lock', {}, []), /ManageChannels/); assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM cases').get().n, 0, 'nothing was done');
  await try1('warn', { user: 'U', reason: 'x' }, [F.ModerateMembers]); assert.equal(r.mod.cases.get('G', 1).type, 'warn', 'with the permission it works');
});

test('/untimeout respects the hierarchy and /unwarn cannot clear your own record', async () => {
  const r = rig(); await assert.rejects(r.run('untimeout', { user: 'U' }, { pos: 10 }), /as high as yours/);
  const c = r.mod.cases.create({ guildId: 'G', type: 'warn', target: 'MOD', moderator: 'OTHER', reason: 'mine', decayDays: 30 });
  await assert.rejects(r.run('unwarn', { case: c.id }), /cannot remove your own warnings/); assert.equal(r.mod.cases.get('G', c.id).undone_at, null);
  const o = r.mod.cases.create({ guildId: 'G', type: 'warn', target: 'SOMEONE', moderator: 'OTHER', reason: 'theirs', decayDays: 30 }); assert.match((await r.run('unwarn', { case: o.id })).content, /Removed warning/);
  assert.match((await r.run('unwarn', { case: c.id }, { by: 'OWNER' })).content, /Removed warning/, 'the owner may');
});

test('bans and kicks made with /ban and /kick are reported to anti-nuke, but not the warn ladder itself, not unbans and not warnings', async () => {
  const r = rig(), seen = []; r.ctx.onModAction = (g, mod, kind) => seen.push([mod, kind]);
  await r.run('ban', { user: 'U1', reason: 'x' }, { by: 'M1' }); await r.run('kick', { user: 'U2', reason: 'x' }, { by: 'M1' }); await r.run('unban', { user_id: '123456789' }, { by: 'M1' }); await r.run('warn', { user: 'U3', reason: 'x' }, { by: 'M1' });
  assert.deepEqual(seen, [['M1', 'ban'], ['M1', 'kick']]);
  const l = rig(), seen2 = []; l.ctx.onModAction = (g, mod, kind) => seen2.push([mod, kind]); for (const n of [1, 2, 3]) await l.run('warn', { user: 'W', reason: 'w' + n }, { by: 'M1' });
  assert.equal(l.calls.at(-1)[0], 'ban', 'the ladder banned'); assert.deepEqual(seen2, [], 'the ladder ban is not a moderator going wild');
  const broken = rig(); broken.ctx.onModAction = () => { throw new Error('boom'); }; assert.match((await broken.run('ban', { user: 'U1' }, { by: 'M1' })).content, /Banned/, 'a failing hook never stops the ban');
});

test('purge and slowmode do their job and are logged; lock remembers how the channel was and unlock puts exactly that back', async () => {
  const r = rig(), deleted = []; let slow = null; const edits = [];
  const msgs = new Map([...Array(5).keys()].map((n) => [String(n), { id: String(n), author: { id: n % 2 ? 'A' : 'B' } }]));
  const overwrite = { v: null };   // what @everyone has in the channel right now
  const chan = (id) => ({ id, messages: { fetch: async () => msgs }, bulkDelete: async (list) => { deleted.push(...list.map((m) => m.id)); return { size: list.length }; }, setRateLimitPerUser: async (s) => { slow = s; },
    permissionOverwrites: { cache: { get: () => overwrite.v }, edit: async (role, o) => edits.push(o) } });
  const withChan = (opts, c) => { const i = r.ix(opts); i.channel = c; i.guild = Object.assign({}, i.guild, { roles: { everyone: { id: 'G' } } }); return i; };
  const c1 = chan('C1'); const i0 = withChan({ count: 3, user: 'A' }, c1);
  await r.cmds.get('purge').run(i0); assert.deepEqual(deleted, ['1', '3'], 'only that person, newest requested'); assert.match(i0.replies.at(-1).content, /Deleted 2/);
  await r.cmds.get('slowmode').run(withChan({ seconds: 30 }, c1)); assert.equal(slow, 30);
  // a channel with no setting: locked, then unlocked back to "not set"
  await r.cmds.get('lock').run(withChan({}, c1)); await r.cmds.get('unlock').run(withChan({}, c1)); assert.deepEqual(edits, [{ SendMessages: false }, { SendMessages: null }]);
  // a channel that was read-only on purpose (an explicit deny, like #rules): unlock keeps it read-only
  edits.length = 0; const c2 = chan('C2'); overwrite.v = { deny: { has: (p) => p === F.SendMessages }, allow: { has: () => false } };
  await r.cmds.get('lock').run(withChan({}, c2)); await r.cmds.get('lock').run(withChan({}, c2)); await r.cmds.get('unlock').run(withChan({}, c2)); assert.deepEqual(edits, [{ SendMessages: false }, { SendMessages: false }, { SendMessages: false }], 'locking twice does not forget the original');
  // a channel that explicitly allowed writing
  edits.length = 0; const c3 = chan('C3'); overwrite.v = { deny: { has: () => false }, allow: { has: (p) => p === F.SendMessages } };
  await r.cmds.get('lock').run(withChan({}, c3)); await r.cmds.get('unlock').run(withChan({}, c3)); assert.deepEqual(edits, [{ SendMessages: false }, { SendMessages: true }]);
  // a channel the bot did not lock is not unlocked
  await assert.rejects(r.cmds.get('unlock').run(withChan({}, chan('C4'))), /did not lock this channel/); await assert.rejects(r.cmds.get('unlock').run(withChan({}, c3)), /did not lock this channel/, 'and not twice');
  assert.ok(r.posts.length >= 6, 'each one is in #mod-log');
});

test('slash commands are hidden from people without the matching permission, and cannot be used in DMs', () => {
  const r = rig(), need = { warn: F.ModerateMembers, kick: F.KickMembers, ban: F.BanMembers, purge: F.ManageMessages, lock: F.ManageChannels };
  for (const [n, p] of Object.entries(need)) { const j = r.cmds.get(n).data.toJSON(); assert.equal(j.default_member_permissions, p.toString(), n); assert.equal(j.dm_permission, false, n); }
  assert.equal(r.cmds.size, 14);
});
