'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const createSelfRoles = require('../src/modules/selfroles');

const role = (id, name, o) => Object.assign({ id, name, position: 3, managed: false, permissions: { has: () => false } }, o);
function rig(rolesById) {
  const cmds = new Map(), btns = {}, sent = [], added = [], removed = [];
  const guild = { id: 'G', members: { me: { roles: { highest: { position: 10 } } } }, roles: { cache: new Map(Object.entries(rolesById)), fetch: async () => null } };
  const sr = createSelfRoles({ log() {}, discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } });
  const slash = (opts, who) => { const out = []; return { out, memberPermissions: { has: () => true }, user: { id: (who && who.id) || 'U1' }, member: { roles: { highest: { position: (who && who.pos) || 10 } } }, guild, options: { getRole: (n) => opts[n] || null, getString: (n) => opts[n] || null }, deferReply: async () => {}, editReply: async (m) => out.push(m), channel: { send: async (m) => sent.push(m) } }; };
  const press = (id, has) => { const out = []; return { out, customId: 'role:' + id, guild, member: { roles: { cache: new Map(has ? [[id, {}]] : []), add: async (r, why) => added.push([r, why]), remove: async (r) => removed.push(r) } }, reply: async (m) => out.push(m.content) }; };
  return { sr, cmds, btns, sent, added, removed, slash, press, guild };
}

test('roles with powers, managed roles, @everyone and roles above the bot cannot be offered', () => {
  const w = createSelfRoles.whyNot;
  assert.equal(w(role('1', 'Gamer'), 10, 'G'), null);
  assert.match(w(role('2', 'Boss', { permissions: { has: (p) => p === F.BanMembers } }), 10, 'G'), /has powers \(BanMembers\)/);
  assert.match(w(role('3', 'Admin', { permissions: { has: (p) => p === F.Administrator } }), 10, 'G'), /Administrator/);
  assert.match(w(role('4', 'Bot', { managed: true }), 10, 'G'), /bot or integration/); assert.match(w(role('G', '@everyone'), 10, 'G'), /@everyone/);
  assert.match(w(role('5', 'High', { position: 10 }), 10, 'G'), /not above High/); assert.match(w(null, 10, 'G'), /does not exist/);
});

test('/rolepanel posts one button per role (5 to a row, no duplicates) and refuses unsafe roles before posting', async () => {
  const roles = {}; for (let n = 1; n <= 7; n++) roles['r' + n] = role('r' + n, 'Role ' + n);
  roles.bad = role('bad', 'Bad', { permissions: { has: (p) => p === F.KickMembers } });
  const r = rig(roles), opts = { title: 'Pick', role1: roles.r1, role2: roles.r2, role3: roles.r1, role4: roles.r3, role5: roles.r4, role6: roles.r5, role7: roles.r6 };
  const i = r.slash(opts); await r.cmds.get('rolepanel').run(i);
  const panel = r.sent[0]; assert.equal(panel.embeds[0].title, 'Pick'); assert.deepEqual(panel.components.map((c) => c.components.length), [5, 1]);
  assert.deepEqual(panel.components.flatMap((c) => c.components.map((b) => b.data.custom_id)), ['role:r1', 'role:r2', 'role:r3', 'role:r4', 'role:r5', 'role:r6']); assert.deepEqual(panel.allowedMentions, { parse: [] });
  assert.match(i.out[0].content, /6 roles/);
  const bad = r.slash({ title: 'x', role1: roles.r1, role2: roles.bad }); await assert.rejects(r.cmds.get('rolepanel').run(bad), /Bad has powers/); assert.equal(r.sent.length, 1, 'nothing posted');
  const j = r.cmds.get('rolepanel').data.toJSON(); assert.equal(j.default_member_permissions, F.ManageRoles.toString()); assert.equal(j.options.filter((o) => o.type === 8).length, 10);
});

test('pressing a button gives the role, pressing again removes it, and a role that became powerful is refused', async () => {
  const roles = { r1: role('r1', 'Gamer') }, r = rig(roles);
  const a = r.press('r1', false); await r.btns.role(a); assert.deepEqual(a.out, ['You now have **Gamer**.']); assert.deepEqual(r.added, [['r1', 'Self-assign panel']]);
  const b = r.press('r1', true); await r.btns.role(b); assert.deepEqual(b.out, ['Removed **Gamer**.']); assert.deepEqual(r.removed, ['r1']);
  roles.r1.permissions = { has: (p) => p === F.ManageMessages }; const c = r.press('r1', false); await r.btns.role(c); assert.match(c.out[0], /has powers/); assert.equal(r.added.length, 1, 'not given');
  const gone = r.press('nope', false); await r.btns.role(gone); assert.match(gone.out[0], /does not exist/);
});

test('you cannot offer a role above your own top role (the server owner can), and more powers are refused', async () => {
  const roles = { r1: role('r1', 'Low', { position: 3 }), r2: role('r2', 'Same', { position: 10 }), r3: role('r3', 'Above', { position: 12 }), r4: role('r4', 'Mid', { position: 9 }) }, r = rig(roles);
  await r.cmds.get('rolepanel').run(r.slash({ title: 'x', role1: roles.r1 })); assert.equal(r.sent.length, 1, 'a role below you is fine');
  await assert.rejects(r.cmds.get('rolepanel').run(r.slash({ title: 'x', role1: roles.r2 })), /Your own top role is not above Same/); await assert.rejects(r.cmds.get('rolepanel').run(r.slash({ title: 'x', role1: roles.r3 })), /Your own top role is not above Above/);
  assert.equal(r.sent.length, 1, 'nothing posted for those');
  const owner = rig(roles); owner.guild.ownerId = 'BOSS'; await owner.cmds.get('rolepanel').run(owner.slash({ title: 'x', role1: roles.r4 }, { id: 'BOSS', pos: 1 })); assert.equal(owner.sent.length, 1, 'the owner may offer a role above their own top role, if the bot can give it');
  for (const p of ['ManageThreads', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageGuildExpressions', 'ViewGuildInsights']) assert.match(createSelfRoles.whyNot(role('x', 'X', { permissions: { has: (f) => f === F[p] } }), 10, 'G'), /has powers/, p);
});
