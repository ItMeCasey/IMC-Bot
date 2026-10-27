'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const openDb = require('../src/db');
const createRegulars = require('../src/modules/regulars');

const DAY = 86400000, T0 = 1e12;
const DEF = () => ({ on: true, minDays: 7, minConversations: 3, gapMinutes: 30, restrict: { links: true, attachments: true, invites: true, mentions: true, maxMentions: 2 }, exemptRoles: ['SUB'], notice: true });

function rig(over, cfgOver) {
  let t = T0; const db = openDb(':memory:'), kv = new Map(), cmds = new Map(), posts = [], roleAdds = [], roleRemoves = [], created = [];
  const regRole = { id: 'REG', name: 'Regular' }; let roleExists = true;
  const members = new Map();
  const guild = { id: 'G', roles: { cache: { get: (id) => (roleExists && id === 'REG' ? regRole : undefined), find: (fn) => (roleExists ? [regRole].find(fn) : undefined) }, fetch: async () => null,
    create: async (o) => { created.push(o); roleExists = true; return regRole; } }, members: { fetch: async (id) => members.get(id) || null } };
  const cfg = Object.assign({ channels: { modLog: 'L' }, dryRun: false, regulars: Object.assign(DEF(), over) }, cfgOver);
  const mk = (id, o) => { o = o || {}; const roles = new Set(o.roles || []); const m = { id, user: { id, bot: false, tag: id + '#1' }, joinedTimestamp: o.joined == null ? T0 - 30 * DAY : o.joined, permissions: { has: (p) => (o.perms || []).includes(p) },
    roles: { cache: roles, add: async (r, why) => { roles.add(r); roleAdds.push([id, r, why]); }, remove: async (r) => { roles.delete(r); roleRemoves.push([id, r]); } } }; members.set(id, m); return m; };
  const reg = createRegulars({ db, kv: { get: (k) => kv.get(k) || '', set: (k, v) => kv.set(k, v) }, log() {}, now: () => t, config: { get: () => cfg }, fetchChannel: async (id) => (id === 'L' ? { send: async (m) => posts.push(m.embeds[0]) } : null), guilds: () => [guild], discord: { register: (c) => cmds.set(c.data.name, c) } });
  const msg = (member, content, o) => { o = o || {}; const sent = []; return { sent, guild, member, author: member.user, content: content || 'hello', channelId: o.ch || 'C1', webhookId: o.webhook, system: false, attachments: { size: o.files || 0 }, mentions: { users: { size: o.mentions || 0 }, roles: { size: 0 }, everyone: false },
    deleted: 0, delete: async function () { this.deleted++; }, channel: { send: async (x) => { sent.push(x); return { delete: async () => {} }; } } }; };
  return { reg, db, cfg, guild, mk, msg, posts, roleAdds, roleRemoves, created, cmds, tick: (ms) => { t += ms; }, setRoleExists: (v) => { roleExists = v; } };
}
const conv = async (r, a, b, ch) => { await r.reg.onMessage(r.msg(a, 'hi', { ch })); r.tick(1000); await r.reg.onMessage(r.msg(b, 'hey', { ch })); r.tick(31 * 60000); };   // two people talk, then a quiet gap

test('a conversation needs two people; a quiet gap starts a new one; talking alone never counts', async () => {
  const r = rig(), a = r.mk('A'), b = r.mk('B');
  for (let n = 0; n < 5; n++) { await r.reg.onMessage(r.msg(a, 'alone ' + n)); r.tick(1000); }
  const stat = (id) => r.db.prepare('SELECT conversations FROM member_stats WHERE user_id = ?').get(id).conversations;
  assert.equal(stat('A'), 0, 'five messages by one person are no conversation');
  await r.reg.onMessage(r.msg(b, 'hello A')); assert.deepEqual([stat('A'), stat('B')], [1, 1], 'it counts for both when the second person joins in');
  for (let n = 0; n < 4; n++) { await r.reg.onMessage(r.msg(a, 'more')); await r.reg.onMessage(r.msg(b, 'more')); r.tick(1000); } assert.deepEqual([stat('A'), stat('B')], [1, 1], 'a long chat is still one conversation');
  r.tick(31 * 60000); await r.reg.onMessage(r.msg(a, 'new topic')); await r.reg.onMessage(r.msg(b, 'ok')); assert.deepEqual([stat('A'), stat('B')], [2, 2], 'after a quiet gap the next chat is a second conversation');
  await r.reg.onMessage(r.msg(r.mk('C'), 'butting in')); assert.equal(stat('C'), 1, 'someone joining a running conversation gets it counted'); assert.equal(stat('A'), 2, 'and nobody is counted twice');
  r.tick(31 * 60000); await r.reg.onMessage(r.msg(a, 'x', { ch: 'C2' })); await r.reg.onMessage(r.msg(b, 'y', { ch: 'C2' })); assert.equal(stat('A'), 3, 'channels are separate conversations');
});

test('bots, webhooks and a switched-off system are ignored', async () => {
  const r = rig(), a = r.mk('A'), b = r.mk('B'), bot = r.mk('BOT'); bot.user.bot = true;
  await r.reg.onMessage(r.msg(a, 'hi')); await r.reg.onMessage(r.msg(bot, 'beep')); await r.reg.onMessage(r.msg(b, 'x', { webhook: 'W' }));
  assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM member_stats WHERE conversations > 0").get().n, 0);
  const off = rig({ on: false }); await off.reg.onMessage(off.msg(off.mk('A'), 'hi')); assert.equal(off.db.prepare('SELECT COUNT(*) AS n FROM member_stats').get().n, 0, 'nothing is tracked while off');
});

test('a new member loses links, images, invites and mention floods, with a note that shows their progress; normal chat stays', async () => {
  const r = rig(), n = r.mk('NEW', { joined: T0 - 2 * DAY });
  for (const [text, o, what] of [['see https://example.com', {}, 'links'], ['www.example.com', {}, 'links'], ['pic', { files: 1 }, 'images and files'], ['join discord.gg/abc123', {}, 'invite links'], ['hi', { mentions: 3 }, 'mentioning that many people']]) {
    const m = r.msg(n, text, o); await r.reg.onMessage(m); assert.equal(m.deleted, 1, text); assert.match(m.sent[0].content, new RegExp('^<@NEW> ' + what + ' unlock after 7 days in the server and 3 conversations \\(you are at 2/7 days and 0/3 conversations\\)'), text); assert.deepEqual(m.sent[0].allowedMentions, { users: ['NEW'] });
  }
  const ok = r.msg(n, 'just talking, no links', { mentions: 2 }); await r.reg.onMessage(ok); assert.equal(ok.deleted, 0);
  const quiet = rig({ notice: false }), q = quiet.mk('NEW'); const m2 = quiet.msg(q, 'https://x.com'); await quiet.reg.onMessage(m2); assert.equal(m2.deleted, 1); assert.equal(m2.sent.length, 0, 'the note can be switched off');
  const part = rig({ restrict: { links: false, attachments: true, invites: false, mentions: false, maxMentions: 2 } }), p = part.mk('NEW'); const l = part.msg(p, 'https://x.com'); await part.reg.onMessage(l); assert.equal(l.deleted, 0, 'each limit can be switched off');
});

test('mods, exempt roles and Regulars are never limited; a dry run only reports', async () => {
  const r = rig();
  for (const [name, member] of [['mod', r.mk('M1', { perms: [F.ManageMessages] })], ['timeout mod', r.mk('M2', { perms: [F.ModerateMembers] })], ['sub role', r.mk('S1', { roles: ['SUB'] })], ['regular', r.mk('R1', { roles: ['REG'] })]]) {
    const m = r.msg(member, 'https://example.com'); await r.reg.onMessage(m); assert.equal(m.deleted, 0, name);
  }
  const dry = rig({}, { dryRun: true }), n = dry.mk('NEW'), m = dry.msg(n, 'https://example.com'); await dry.reg.onMessage(m);
  assert.equal(m.deleted, 0); assert.equal(m.sent.length, 0); assert.match(dry.posts[0].title, /Dry run: would remove a message from a new member \(links\)/);
});

test('the role is given when both thresholds are met (counting from the join date), once, and only outside a dry run', async () => {
  const r = rig({ minConversations: 2 }), a = r.mk('A', { joined: T0 - 3 * DAY }), b = r.mk('B', { joined: T0 - 30 * DAY });
  await conv(r, a, b); await conv(r, a, b);
  assert.deepEqual(r.roleAdds.map((x) => x[0]), ['B'], 'B has the days and the conversations; A has the conversations but joined 3 days ago');
  r.tick(2 * DAY); await r.reg.onMessage(r.msg(a, 'still here')); assert.equal(r.roleAdds.length, 1, 'about 5 days in: still short for A');
  r.tick(2 * DAY + 3600000); assert.equal(await r.reg.sweep(), 1, 'the hourly sweep gives it once the days have passed'); assert.deepEqual(r.roleAdds.map((x) => x[0]), ['B', 'A']); assert.equal(await r.reg.sweep(), 0, 'not twice'); assert.match(r.roleAdds[1][2], /earned/);
  const dry = rig({ minConversations: 1 }, { dryRun: true }), x = dry.mk('X'), y = dry.mk('Y'); await conv(dry, x, y); assert.equal(dry.roleAdds.length, 0, 'a dry run gives nothing');
  dry.cfg.dryRun = false; assert.equal(await dry.reg.sweep(), 2, 'when the dry run ends, everyone who earned it gets it');
});

test('the role is created when missing, and found again by name', async () => {
  const r = rig({ minConversations: 1 }); r.setRoleExists(false); await conv(r, r.mk('A'), r.mk('B')); assert.equal(r.created.length, 1); assert.equal(r.created[0].name, 'Regular'); assert.equal(r.roleAdds.length, 1, 'the one who just spoke gets it at once'); assert.equal(await r.reg.sweep(), 1, 'the other one at the next sweep'); assert.equal(r.created.length, 1, 'the role is made only once');
  assert.equal(r.guild.roles.cache.find((x) => x.name === 'Regular').id, 'REG');
});

test('/progress shows how far along you are; /regular lets mods look, grant and hold back', async () => {
  const r = rig({ minConversations: 3 }), a = r.mk('A', { joined: T0 - 3 * DAY }), b = r.mk('B'); await conv(r, a, b);
  const run = async (name, opts, user, sub) => { const out = []; await r.cmds.get(name).run({ guild: r.guild, user: { id: user.id, tag: user.id + '#1' }, member: user, options: { getUser: () => opts && { id: opts.id, tag: opts.id + '#1', bot: false }, getMember: () => opts && r.guild.members._get(opts.id), getSubcommand: () => sub }, reply: async (m) => out.push(m) }); return out[0]; };
  r.guild.members._get = (id) => ({ A: a, B: b }[id]);
  const me = await run('progress', null, a); assert.match(me.embeds[0].description, /Days in the server: \*\*3\/7\*\*, conversations: \*\*1\/3\*\*/);
  const st = await run('regular', { id: 'A' }, b, 'status'); assert.match(st.embeds[0].description, /3\/7/);
  assert.match((await run('regular', { id: 'A' }, b, 'grant')).content, /is a Regular now/); assert.deepEqual(r.roleAdds.at(-1).slice(0, 2), ['A', 'REG']); assert.match((await run('progress', null, a)).embeds[0].description, /✅ \*\*Regular\*\*/);
  assert.match((await run('regular', { id: 'A' }, b, 'revoke')).content, /not a Regular/); assert.deepEqual(r.roleRemoves.at(-1), ['A', 'REG']); assert.match((await run('progress', null, a)).embeds[0].description, /Held back/);
  for (let n = 0; n < 5; n++) await conv(r, a, b); assert.equal(r.roleAdds.filter((x) => x[0] === 'A').length, 1, 'a held-back person is not promoted again by the system');
  r.cfg.regulars.on = false; assert.match((await run('progress', null, a)).content, /not switched on/);
  const j = r.cmds.get('regular').data.toJSON(); assert.equal(j.default_member_permissions, F.ModerateMembers.toString()); assert.equal(r.cmds.get('progress').data.toJSON().default_member_permissions, undefined, 'everyone can see their own progress');
});

test('new members may post links and images in an exempt channel, but still not elsewhere', async () => {
  const r = rig({ exemptChannels: ['MEMES'] }), n = r.mk('NEW', { joined: T0 - 2 * DAY });
  const free = r.msg(n, 'https://example.com', { ch: 'MEMES' }); await r.reg.onMessage(free); assert.equal(free.deleted, 0);
  const other = r.msg(n, 'https://example.com', { ch: 'C1' }); await r.reg.onMessage(other); assert.equal(other.deleted, 1);
  const stat = r.db.prepare('SELECT conversations FROM member_stats WHERE user_id = ?').get('NEW'); assert.ok(stat, 'chat there is still counted toward becoming a Regular');
});
