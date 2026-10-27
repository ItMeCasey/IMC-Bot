'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const openDb = require('../src/db');
const createTickets = require('../src/modules/tickets');

function rig(over) {
  let t = 1e12, n = 0; const db = openDb(':memory:'), cmds = new Map(), btns = {}, created = [], logPosts = [], deleted = [], channels = new Map();
  const mods = { id: 'MODS', name: 'Mods' };
  const guild = { id: 'G', roles: { everyone: { id: 'G' }, cache: { find: (fn) => [mods].find(fn) } }, members: { me: { id: 'BOT' } },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null, create: async (o) => { const ch = { id: 'T' + ++n, opts: o, sent: [], send: async (m) => { ch.sent.push(m); }, delete: async (why) => { deleted.push([ch.id, why]); channels.delete(ch.id); } }; channels.set(ch.id, ch); created.push(ch); return ch; } } };
  const cfg = { channels: { modLog: 'L' } };
  const ctx = Object.assign({ db, log() {}, now: () => t, config: { get: () => cfg }, deleteAfterMs: 0, fetchChannel: async (id) => (id === 'L' ? { send: async (m) => logPosts.push(m) } : null), discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } }, over);
  const tk = createTickets(ctx);
  const press = (id, o) => { o = o || {}; const out = []; return { out, customId: id, guild, user: { id: o.uid || 'U1', username: o.name || 'Sam Smith', tag: 'sam#1' }, channelId: o.channelId, channel: o.channel || { parentId: 'CAT' },
    memberPermissions: { has: (p) => (o.perms || []).includes(p) }, reply: async (m) => out.push(m.content || m), deferReply: async () => {}, editReply: async (m) => out.push(m.content) }; };
  return { tk, db, cmds, btns, created, logPosts, deleted, channels, press, cfg, guild };
}

test('/ticketpanel posts a message with one button, for people who can manage channels', async () => {
  const r = rig(), sent = [], out = [];
  await r.cmds.get('ticketpanel').run({ memberPermissions: { has: () => true }, options: { getString: (n) => ({ title: 'Appeals', button: 'Appeal a ban' })[n] || null }, channel: { send: async (m) => sent.push(m) }, reply: async (m) => out.push(m.content) });
  assert.equal(sent[0].embeds[0].title, 'Appeals'); assert.equal(sent[0].components[0].components[0].data.custom_id, 'ticket:open'); assert.equal(sent[0].components[0].components[0].data.label, 'Appeal a ban');
  const j = r.cmds.get('ticketpanel').data.toJSON(); assert.equal(j.default_member_permissions, F.ManageChannels.toString()); assert.equal(j.dm_permission, false);
});

test('opening makes a private channel for the person, the Mods role and the bot, once per person', async () => {
  const r = rig(), p = r.press('ticket:open'); await r.btns.ticket(p);
  const ch = r.created[0]; assert.equal(ch.opts.name, 'ticket-sam-smith'); assert.equal(ch.opts.parent, 'CAT');
  const ov = Object.fromEntries(ch.opts.permissionOverwrites.map((o) => [o.id, o]));
  assert.equal(ov.G.deny, F.ViewChannel, 'nobody else can see it'); assert.ok(ov.U1.allow & F.ViewChannel); assert.ok(ov.MODS.allow & F.ViewChannel); assert.ok(ov.BOT.allow & F.ManageChannels);
  assert.deepEqual(p.out, ['Your ticket is open: <#T1>']); assert.match(ch.sent[0].content, /<@U1> <@&MODS>/); assert.equal(ch.sent[0].components[0].components[0].data.custom_id, 'ticket:close');
  assert.deepEqual(ch.sent[0].allowedMentions, { users: ['U1'], roles: ['MODS'] });
  const again = r.press('ticket:open'); await r.btns.ticket(again); assert.match(again.out[0], /already have an open ticket: <#T1>/); assert.equal(r.created.length, 1);
  const other = r.press('ticket:open', { uid: 'U2', name: 'Pat' }); await r.btns.ticket(other); assert.equal(r.created.length, 2);
});

test('a ticket channel deleted by hand is forgotten, the number of open tickets is capped, and no Mods role is fine', async () => {
  const r = rig(); await r.btns.ticket(r.press('ticket:open')); r.channels.delete('T1');
  await r.btns.ticket(r.press('ticket:open')); assert.equal(r.created.length, 2, 'a new ticket after the old channel vanished');
  const full = rig(); for (let n = 0; n < 50; n++) full.db.prepare("INSERT INTO tickets (guild_id, channel_id, user_id, created_at) VALUES ('G', ?, ?, 1)").run('c' + n, 'u' + n);
  const p = full.press('ticket:open'); await full.btns.ticket(p); assert.match(p.out[0], /too many open tickets/); assert.equal(full.created.length, 0);
  const nomods = rig(); nomods.guild.roles.cache.find = () => undefined; await nomods.btns.ticket(nomods.press('ticket:open'));
  assert.equal(nomods.created[0].opts.permissionOverwrites.some((o) => o.id === 'MODS'), false);
});

test('closing saves a transcript in #mod-log, then deletes the channel; only the person or a mod may close, and only once', async () => {
  const r = rig(); await r.btns.ticket(r.press('ticket:open')); const ch = r.created[0];
  ch.messages = { fetch: async () => new Map([['2', { createdTimestamp: 1e12 + 2000, author: { tag: 'mod#1' }, content: 'How can I help?', attachments: { size: 0 }, embeds: [] }], ['1', { createdTimestamp: 1e12 + 1000, author: { tag: 'sam#1' }, content: 'I was banned unfairly', attachments: { size: 1 }, embeds: [] }]]) };
  const stranger = r.press('ticket:close', { uid: 'U9', channelId: 'T1', channel: ch }); await r.btns.ticket(stranger);
  assert.match(stranger.out[0], /Only the person who opened it or a mod/); assert.equal(r.logPosts.length, 0);
  const mod = r.press('ticket:close', { uid: 'M1', channelId: 'T1', channel: ch, perms: [F.ManageMessages] }); await r.btns.ticket(mod); await new Promise((x) => setTimeout(x, 10));
  assert.match(mod.out[0], /Closing this ticket/); const post = r.logPosts[0]; assert.match(post.embeds[0].description, /Opened by <@U1>, closed by <@M1>/); assert.deepEqual(post.allowedMentions, { parse: [] });
  const text = post.files[0].attachment.toString('utf8'); assert.match(text, /sam#1: I was banned unfairly \[1 attachment\(s\)\]\n\[[\d: -]+\] mod#1: How can I help\?$/); assert.equal(post.files[0].name, 'ticket-1.txt');
  assert.deepEqual(r.deleted.map((d) => d[0]), ['T1']);
  const twice = r.press('ticket:close', { uid: 'M1', channelId: 'T1', channel: ch, perms: [F.ManageMessages] }); await r.btns.ticket(twice); assert.match(twice.out[0], /already closed/);
  await r.btns.ticket(r.press('ticket:open')); assert.equal(r.created.length, 2, 'the person can open a new ticket afterwards');
  const own = rig(); await own.btns.ticket(own.press('ticket:open')); const c2 = own.created[0]; c2.messages = { fetch: async () => new Map() };
  const self = own.press('ticket:close', { uid: 'U1', channelId: 'T1', channel: c2 }); await own.btns.ticket(self);
  assert.match(self.out[0], /Closing/); assert.match(own.logPosts[0].files[0].attachment.toString(), /\(empty\)/, 'the opener can close their own ticket');
});

test('closing still works when there is no #mod-log', async () => {
  const r = rig(); r.cfg.channels = {}; await r.btns.ticket(r.press('ticket:open')); const ch = r.created[0]; ch.messages = { fetch: async () => new Map() };
  await r.btns.ticket(r.press('ticket:close', { channelId: 'T1', channel: ch })); await new Promise((x) => setTimeout(x, 10)); assert.deepEqual(r.deleted.map((d) => d[0]), ['T1']);
});

test('channel names are made safe', () => { assert.equal(createTickets.slug('Sam Smith!!'), 'sam-smith'); assert.equal(createTickets.slug('日本語'), 'user'); assert.equal(createTickets.slug('x'.repeat(50)).length, 20); });

test('pressing the button many times at once makes one channel, and the ticket cap counts the ones still being made', async () => {
  const r = rig(), orig = r.guild.channels.create; r.guild.channels.create = async (o) => { await new Promise((x) => setImmediate(x)); return orig(o); };
  const presses = [r.press('ticket:open'), r.press('ticket:open'), r.press('ticket:open')]; await Promise.all(presses.map((p) => r.btns.ticket(p)));
  assert.equal(r.created.length, 1, 'one channel for three quick presses'); assert.equal(presses.filter((p) => p.out.some((x) => /being made/.test(x))).length, 2);
  const full = rig(), orig2 = full.guild.channels.create; full.guild.channels.create = async (o) => { await new Promise((x) => setImmediate(x)); return orig2(o); };
  for (let n = 0; n < 49; n++) full.db.prepare("INSERT INTO tickets (guild_id, channel_id, user_id, created_at) VALUES ('G', ?, ?, 1)").run('c' + n, 'u' + n);
  const a = full.press('ticket:open', { uid: 'A' }), b = full.press('ticket:open', { uid: 'B' }); await Promise.all([full.btns.ticket(a), full.btns.ticket(b)]);
  assert.equal(full.created.length, 1, 'only one of two simultaneous tickets fits under the cap of 50'); assert.ok([a, b].some((p) => p.out.some((x) => /too many open tickets/.test(x))));
});
