'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const openDb = require('../src/db');
const createXp = require('../src/modules/xp');

test('the level curve: 100 XP for the first level, then more each time', () => {
  const l = createXp.levelFor;
  assert.deepEqual(l(0), { level: 0, into: 0, next: 100 }); assert.deepEqual(l(99), { level: 0, into: 99, next: 100 }); assert.deepEqual(l(100), { level: 1, into: 0, next: 155 });
  assert.equal(l(100 + 155).level, 2); assert.equal(l(100 + 155 + 220).level, 3); assert.equal(createXp.need(10), 1100);
});

function rig(over, cfgOver) {
  let t = 1e12; const db = openDb(':memory:'), cmds = new Map(), added = [];
  const cfg = Object.assign({ xp: Object.assign({ on: true, min: 100, max: 100, cooldown: 60, announce: true, levelRoles: ['1:111111', '2:222222', 'junk', '3:333333'] }, over) }, cfgOver);
  const power = { id: '333333', position: 1, managed: false, permissions: { has: (p) => p === F.Administrator } };
  const roles = new Map([['111111', { id: '111111', name: 'Chatty', position: 2, managed: false, permissions: { has: () => false } }], ['222222', { id: '222222', name: 'Talker', position: 20, managed: false, permissions: { has: () => false } }], ['333333', power]]);
  const guild = { id: 'G', members: { me: { roles: { highest: { position: 10 } } } }, roles: { cache: roles } };
  const xp = createXp({ db, log() {}, now: () => t, rand: (lo) => lo, config: { get: () => cfg }, discord: { register: (c) => cmds.set(c.data.name, c) } });
  const msg = (uid, text, o) => { o = o || {}; const sent = [], roleSet = new Set(o.roles || []); return { sent, guild, author: { id: uid, bot: !!o.bot }, webhookId: o.webhook, system: false, content: text, channel: { send: async (m) => sent.push(m) },
    member: { roles: { cache: roleSet, add: async (r, why) => { roleSet.add(r); added.push([uid, r, why]); } } } }; };
  const run = async (name, o, sub) => { const out = []; await cmds.get(name).run({ memberPermissions: { has: () => true }, guild, user: { id: 'ME', username: 'me' }, options: { getUser: (n) => o && o[n] || null, getSubcommand: () => sub }, reply: async (m) => out.push(m) }); return out[0]; };
  return { xp, db, cmds, added, msg, run, cfg, tick: (ms) => { t += ms; } };
}

test('a chat message earns XP once a minute; levels announce and hand out safe roles only', async () => {
  const r = rig(), m1 = r.msg('U', 'hello there'); assert.equal(await r.xp.onMessage(m1), 1); assert.match(m1.sent[0].content, /^🎉 <@U> reached \*\*level 1\*\*!/); assert.deepEqual(m1.sent[0].allowedMentions, { users: ['U'] });
  assert.deepEqual(r.added, [['U', '111111', 'Level 1']]);
  const again = r.msg('U', 'another one'); r.tick(30000); assert.equal(await r.xp.onMessage(again), 0); assert.equal(r.db.prepare('SELECT xp FROM xp').get().xp, 100, 'inside the cooldown, nothing is added');
  r.tick(31000); assert.equal(await r.xp.onMessage(r.msg('U', 'after a minute')), 0); assert.equal(r.db.prepare('SELECT xp FROM xp').get().xp, 200);
  r.tick(61000); await r.xp.onMessage(r.msg('U', 'more xp here')); assert.equal(r.db.prepare('SELECT level FROM xp').get().level, 2, '300 XP is level 2');
  assert.equal(r.added.some((a) => a[1] === '222222'), false, 'a role above the bot is not given'); assert.equal(r.added.some((a) => a[1] === '333333'), false, 'a role with power is not given');
});

test('bots, webhooks, short messages and a switched-off system earn nothing; the range can be given backwards', async () => {
  const r = rig();
  for (const m of [r.msg('B', 'hello there', { bot: true }), r.msg('W', 'hello there', { webhook: 'x' }), r.msg('S', 'hi')]) assert.equal(await r.xp.onMessage(m), 0);
  assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM xp').get().n, 0);
  const off = rig({ on: false }); await off.xp.onMessage(off.msg('U', 'hello there')); assert.equal(off.db.prepare('SELECT COUNT(*) AS n FROM xp').get().n, 0);
  const back = rig({ min: 50, max: 10, announce: false }), m = back.msg('U', 'hello there'); await back.xp.onMessage(m); assert.equal(back.db.prepare('SELECT xp FROM xp').get().xp, 10, 'min and max swapped'); assert.equal(m.sent.length, 0, 'announcements can be switched off');
});

test('/rank, /leaderboard and /xp reset', async () => {
  const r = rig({ announce: false }); for (const [u, n] of [['A', 3], ['B', 1]]) for (let k = 0; k < n; k++) { await r.xp.onMessage(r.msg(u, 'hello there')); r.tick(61000); }
  const mine = await r.run('rank', { user: { id: 'A', username: 'Ann' } }); assert.match(mine.embeds[0].title, /Ann · level 2/); assert.match(mine.embeds[0].description, /Total XP: \*\*300\*\*[\s\S]*Place: \*\*#1\*\*/);
  assert.match((await r.run('rank', { user: { id: 'B', username: 'Bob' } })).embeds[0].description, /Place: \*\*#2\*\*/); assert.match((await r.run('rank', null)).embeds[0].description, /Total XP: \*\*0\*\*/);
  assert.equal((await r.run('leaderboard')).embeds[0].description, '1. <@A> level **2** · 300 XP\n2. <@B> level **1** · 100 XP');
  assert.match((await r.run('xp', { user: { id: 'A' } }, 'reset')).content, /Reset <@A>/); assert.equal(r.db.prepare("SELECT COUNT(*) AS n FROM xp WHERE user_id = 'A'").get().n, 0);
  r.cfg.xp.on = false; assert.match((await r.run('rank', null)).content, /not switched on/); assert.equal(r.cmds.get('xp').data.toJSON().default_member_permissions, F.ManageGuild.toString());
});
