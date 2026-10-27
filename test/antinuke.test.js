'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const createAntiNuke = require('../src/modules/antinuke');
const createVerify = require('../src/modules/verify');

const role = (id, name, o) => Object.assign({ id, name, position: 3, managed: false, permissions: { has: () => false } }, o);

function rig(over, cfgOver) {
  let t = 1e12; const posts = [], removed = [];
  const admin = role('ADMIN', 'Admin', { permissions: { has: (p) => p === F.ManageChannels } }), plain = role('PLAIN', 'Gamer'), high = role('HIGH', 'Boss', { position: 50, permissions: { has: (p) => p === F.Administrator } }), bot = role('BOTROLE', 'Bot', { managed: true, permissions: { has: (p) => p === F.Administrator } });
  const members = { ROGUE: { roles: { cache: new Map([['ADMIN', admin], ['PLAIN', plain], ['HIGH', high], ['G', role('G', '@everyone')]]), remove: async (ids, why) => removed.push([ids, why]) } }, RBOT: { roles: { cache: new Map([['BOTROLE', bot]]), remove: async (ids) => removed.push([ids]) } } };
  const guild = { id: 'G', ownerId: 'OWNER', members: { me: { roles: { highest: { position: 10 } } }, fetch: async (id) => { if (!members[id]) throw new Error('Unknown Member'); return members[id]; } } };
  const cfg = Object.assign({ channels: { modLog: 'L' }, dryRun: false, antinuke: Object.assign({ on: true, maxActions: 3, seconds: 10 }, over) }, cfgOver);
  const an = createAntiNuke({ config: { get: () => cfg }, log() {}, now: () => t, botId: () => 'BOT', fetchChannel: async (id) => (id === 'L' ? { send: async (m) => posts.push(m.embeds[0]) } : null), audit: async (g, kind) => (kind === 'role' ? 'RBOT' : 'ROGUE') });
  return { an, guild, posts, removed, cfg, tick: (ms) => { t += ms; } };
}

test('a burst of destructive actions strips the powerful roles of that account, once, and tells the mods', async () => {
  const r = rig();
  assert.equal(await r.an.record(r.guild, 'ROGUE', 'channel'), false); r.tick(1000); assert.equal(await r.an.record(r.guild, 'ROGUE', 'channel'), false); r.tick(1000);
  assert.equal(await r.an.record(r.guild, 'ROGUE', 'ban'), true);
  assert.deepEqual(r.removed[0][0], ['ADMIN'], 'only the role with power that is below the bot: not the plain role, not @everyone, not the role above the bot'); assert.match(r.removed[0][1], /Anti-nuke: 3 destructive actions in 10 seconds/);
  assert.match(r.posts[0].title, /Anti-nuke acted/); assert.match(r.posts[0].description, /<@ROGUE> did 3 destructive actions[\s\S]*Removed the roles: Admin/);
  r.tick(1000); await r.an.record(r.guild, 'ROGUE', 'ban'); await r.an.record(r.guild, 'ROGUE', 'ban'); await r.an.record(r.guild, 'ROGUE', 'ban'); assert.equal(r.removed.length, 1, 'not again within ten minutes');
});

test('slow actions, the owner, the bot itself and a switched-off module are never touched', async () => {
  const r = rig(); for (let n = 0; n < 6; n++) { assert.equal(await r.an.record(r.guild, 'ROGUE', 'channel'), false); r.tick(6000); } assert.equal(r.removed.length, 0, 'three in 10 seconds needed; this is slower');
  const o = rig(); for (let n = 0; n < 5; n++) { await o.an.record(o.guild, 'OWNER', 'ban'); await o.an.record(o.guild, 'BOT', 'ban'); } assert.equal(o.posts.length, 0);
  const off = rig({ on: false }); for (let n = 0; n < 5; n++) await off.an.record(off.guild, 'ROGUE', 'ban'); assert.equal(off.removed.length, 0);
  assert.equal(await off.an.onDelete('channel', { guild: off.guild, id: 'c' }), false); assert.equal(await off.an.onBan({ guild: off.guild, user: { id: 'u' } }), false);
});

test('a dry run only reports; an account whose powers cannot be removed gets a plain warning', async () => {
  const d = rig({}, { dryRun: true }); for (let n = 0; n < 3; n++) await d.an.record(d.guild, 'ROGUE', 'channel'); assert.equal(d.removed.length, 0); assert.match(d.posts[0].title, /Dry run: anti-nuke would act/);
  const b = rig(); for (let n = 0; n < 3; n++) await b.an.onDelete('role', { guild: b.guild, id: 'r' + n });
  assert.equal(b.removed.length, 0); assert.match(b.posts[0].description, /Nothing to strip[\s\S]*Remove them by hand/);
  const gone = rig(); gone.guild.members.fetch = async () => { throw new Error('Unknown Member'); }; for (let n = 0; n < 3; n++) await gone.an.record(gone.guild, 'ROGUE', 'ban'); assert.match(gone.posts[0].description, /could not act: Unknown Member/);
});

test('the delete and ban events feed the counter through the audit log', async () => {
  const r = rig(); await r.an.onDelete('channel', { guild: r.guild, id: 'c1' }); await r.an.onDelete('channel', { guild: r.guild, id: 'c2' }); assert.equal(r.removed.length, 0);
  await r.an.onBan({ guild: r.guild, user: { id: 'victim' } }); assert.equal(r.removed.length, 1);
  assert.equal(await r.an.onDelete('channel', { id: 'x' }), false, 'a channel without a guild is ignored');
});

// ---------------------------------------------------------------- the verification gate
function vrig(roleOver) {
  const cmds = new Map(), btns = {}, sent = [], created = [], kv = new Map(); const rolesById = new Map();
  const guild = { id: 'G', members: { me: { roles: { highest: { position: 10 } } } }, roles: { cache: { get: (id) => rolesById.get(id), find: (fn) => [...rolesById.values()].find(fn) }, fetch: async () => null,
    create: async (o) => { created.push(o); const r = role('V1', o.name, roleOver); rolesById.set('V1', r); return r; } } };
  const v = createVerify({ log() {}, config: { get: () => ({ verify: { roleName: 'Verified' } }) }, kv: { get: (k) => kv.get(k) || '', set: (k, x) => kv.set(k, x) }, discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } });
  const slash = (o) => { const out = []; return { out, guild, channel: { send: async (m) => sent.push(m) }, options: { getString: (n) => (o || {})[n] ?? null }, deferReply: async () => {}, editReply: async (m) => out.push(m.content) }; };
  const press = (has) => { const out = [], added = []; return { out, added, guild, member: { roles: { cache: new Set(has ? ['V1'] : []), add: async (r, why) => added.push([r, why]) } }, reply: async (m) => out.push(m.content) }; };
  return { v, cmds, btns, sent, created, slash, press, rolesById };
}

test('/verifypanel posts a Verify button and makes the role; pressing it gives the role once', async () => {
  const r = vrig(), i = r.slash({ title: 'Welcome' }); await r.cmds.get('verifypanel').run(i);
  assert.equal(r.created.length, 1); assert.equal(r.created[0].name, 'Verified'); assert.equal(r.created[0].permissions, 0n, 'the role has no permissions of its own');
  assert.equal(r.sent[0].embeds[0].title, 'Welcome'); assert.equal(r.sent[0].components[0].components[0].data.custom_id, 'verify:go'); assert.match(i.out[0], /hide your channels from @everyone/);
  const p = r.press(false); await r.btns.verify(p); assert.deepEqual(p.out, ['You are verified. Welcome!']); assert.deepEqual(p.added, [['V1', 'Verified by button']]);
  const again = r.press(true); await r.btns.verify(again); assert.deepEqual(again.out, ['You are already verified.']); assert.equal(again.added.length, 0); assert.equal(r.created.length, 1, 'the role is made only once');
  assert.equal(r.cmds.get('verifypanel').data.toJSON().default_member_permissions, F.ManageRoles.toString());
});

test('a verified role that has gained power is never handed out', async () => {
  const r = vrig({ permissions: { has: (p) => p === F.BanMembers } }); await assert.rejects(r.cmds.get('verifypanel').run(r.slash()), /has powers/); const p = r.press(false); await r.btns.verify(p); assert.match(p.out[0], /has powers/); assert.equal(p.added.length, 0);
});
