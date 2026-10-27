'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const openDb = require('../src/db');
const createGiveaway = require('../src/modules/giveaway');

const MEMBERS = { A: {}, B: {}, C: {}, D: { bot: true }, E: { roles: ['R'] }, F: { roles: ['R'] } };   // G has left the server
function rig(over) {
  let t = 1e12; const db = openDb(':memory:'), cmds = new Map(), btns = {}, sent = [], edits = [];
  const ch = { send: async (m) => { if (over && over.failSend) throw new Error('Missing Access'); sent.push(m); return { id: 'msg' + sent.length }; }, messages: { edit: async (id, m) => edits.push([id, m]) } };
  const guild = { id: 'G1', members: { fetch: async (id) => { if (!MEMBERS[id]) throw new Error('Unknown Member'); return { user: { bot: !!MEMBERS[id].bot }, roles: { cache: new Set(MEMBERS[id].roles || []) } }; } } };
  const ctx = Object.assign({ db, log() {}, now: () => t, rand: (max) => max - 1, fetchChannel: async (id) => (id === 'C1' ? ch : null), fetchGuild: async (id) => (id === 'G1' ? guild : null), discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } }, over);
  const g = createGiveaway(ctx);
  const slash = (sub, o) => { o = o || {}; const out = []; return { out, guild, channelId: 'C1', channel: ch, user: { id: o.by || 'HOST' }, options: { getSubcommand: () => sub, getString: (n) => o[n] ?? null, getInteger: (n) => o[n] ?? null, getRole: (n) => o[n] ?? null },
    reply: async (m) => out.push(m), deferReply: async () => {}, editReply: async (m) => out.push(m) }; };
  const press = (id, uid, roles) => { const out = []; return { out, customId: 'gw:' + id, guild, user: { id: uid }, member: { roles: { cache: new Set(roles || []) } }, reply: async (m) => out.push(m.content) }; };
  return { g, db, cmds, btns, sent, edits, slash, press, run: async (sub, o) => { const i = slash(sub, o); await cmds.get('giveaway').run(i); return i.out.at(-1); }, tick: (ms) => { t += ms; } };
}

test('pick draws different people, at most as many as exist, and uses the random source it is given', () => {
  assert.deepEqual(createGiveaway.pick(['a', 'b', 'c', 'd'], 2, () => 0).length, 2);
  const p = createGiveaway.pick(['a', 'b', 'c'], 10); assert.deepEqual(p.sort(), ['a', 'b', 'c']);
  assert.deepEqual(createGiveaway.pick([], 3), []); assert.deepEqual(createGiveaway.pick(['a'], 0), []);
  const seen = new Set(); for (let n = 0; n < 200; n++) seen.add(createGiveaway.pick(['a', 'b', 'c', 'd'], 1)[0]); assert.equal(seen.size, 4, 'everyone can win');
});

test('start checks the time, posts the message with a button, and list shows it', async () => {
  const r = rig();
  await assert.rejects(r.run('start', { prize: 'x', duration: 'soon' }), /Give a time/); await assert.rejects(r.run('start', { prize: 'x', duration: '5s' }), /10 seconds/); await assert.rejects(r.run('start', { prize: 'x', duration: '31d' }), /30 days/);
  assert.match((await r.run('start', { prize: 'Game key', duration: '1h', winners: 2, role: { id: 'R' } })).content, /Giveaway #1 started\. It ends in 1 h/);
  const m = r.sent[0]; assert.match(m.embeds[0].title, /Game key/); assert.match(m.embeds[0].description, /Winners:\*\* 2[\s\S]*Needs the role:\*\* <@&R>/); assert.equal(m.components[0].components[0].data.custom_id, 'gw:1'); assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.match((await r.run('list')).embeds[0].description, /`#1` \*\*Game key\*\* in <#C1>, ends <t:\d+:R>, 0 entries/);
  const broken = rig({ failSend: true }); await assert.rejects(broken.run('start', { prize: 'x', duration: '1h' }), /could not post/);
});

test('the button enters, leaves, needs the role when asked, and stops when the giveaway is over', async () => {
  const r = rig(); await r.run('start', { prize: 'P', duration: '1h' });
  let p = r.press(1, 'A'); await r.btns.gw(p); assert.deepEqual(p.out, ['You are in! Good luck. (1 entries)']); p = r.press(1, 'B'); await r.btns.gw(p); assert.match(p.out[0], /\(2 entries\)/);
  p = r.press(1, 'A'); await r.btns.gw(p); assert.deepEqual(p.out, ['You left the giveaway.']);
  const need = rig(); await need.run('start', { prize: 'P', duration: '1h', role: { id: 'R' } });
  p = need.press(1, 'A', []); await need.btns.gw(p); assert.match(p.out[0], /need the <@&R> role/); p = need.press(1, 'E', ['R']); await need.btns.gw(p); assert.match(p.out[0], /You are in/);
  r.tick(2 * 3600000); p = r.press(1, 'C'); await r.btns.gw(p); assert.deepEqual(p.out, ['This giveaway is over.']); p = r.press(99, 'C'); await r.btns.gw(p); assert.match(p.out[0], /gone/);
});

test('the draw skips bots, people who left and people without the role, edits the message and announces only the winners', async () => {
  const r = rig(); await r.run('start', { prize: 'Prize', duration: '1h', winners: 2 });
  for (const u of ['A', 'B', 'D', 'G']) await r.btns.gw(r.press(1, u));
  r.tick(3600001); await r.g.tick();
  const win = r.edits[0][1]; assert.equal(r.edits[0][0], 'msg1'); assert.match(win.embeds[0].title, /ended/); assert.match(win.embeds[0].description, /Winners:\*\* <@A> <@B>[\s\S]*Entries:\*\* 4/); assert.equal(win.components[0].components[0].data.disabled, true);
  const ann = r.sent[1]; assert.match(ann.content, /Congratulations <@A> <@B>! You won \*\*Prize\*\*/); assert.deepEqual(ann.allowedMentions, { users: ['A', 'B'] }, 'nobody else is pinged');
  await r.g.tick(); assert.equal(r.sent.length, 2, 'a finished giveaway is not drawn twice');
  const req = rig(); await req.run('start', { prize: 'P', duration: '1h', role: { id: 'R' } }); for (const u of ['E', 'F', 'A']) req.db.prepare('INSERT INTO giveaway_entries VALUES (1, ?)').run(u);
  req.tick(3700000); await req.g.tick(); assert.match(req.edits[0][1].embeds[0].description, /<@E>/); assert.doesNotMatch(req.edits[0][1].embeds[0].description, /<@A>/, 'a person without the role cannot win');
  const none = rig(); await none.run('start', { prize: 'Empty', duration: '1h' }); none.tick(3700000); await none.g.tick(); assert.match(none.sent[1].content, /Nobody entered/);
});

test('end now, cancel, and reroll (never the same winner twice)', async () => {
  const r = rig(); await r.run('start', { prize: 'P', duration: '1h' }); for (const u of ['A', 'B', 'C']) await r.btns.gw(r.press(1, u));
  await assert.rejects(r.run('reroll', { id: 1 }), /Only an ended/); await assert.rejects(r.run('end', { id: 99 }), /No such giveaway/);
  assert.match((await r.run('end', { id: 1 })).content, /Ended giveaway #1\. Winners: <@A>/); await assert.rejects(r.run('end', { id: 1 }), /already over/);
  assert.match((await r.run('reroll', { id: 1 })).content, /Drew <@B>/); assert.match((await r.run('reroll', { id: 1, count: 5 })).content, /Drew <@C>/); assert.match((await r.run('reroll', { id: 1 })).content, /nobody left/);
  assert.match(r.sent.at(-1).content, /New winner.* <@C>/);
  const c = rig(); await c.run('start', { prize: 'Oops', duration: '1h' }); assert.match((await c.run('cancel', { id: 1 })).content, /Cancelled/); assert.match(c.edits[0][1].embeds[0].description, /cancelled/); await assert.rejects(c.run('cancel', { id: 1 }), /already over/);
  c.tick(7200000); await c.g.tick(); assert.equal(c.sent.length, 1, 'a cancelled giveaway is never drawn');
});

test('a restart in the middle of a giveaway loses nothing: a new instance ends it on time', async () => {
  const r = rig(); await r.run('start', { prize: 'P', duration: '1h' }); await r.btns.gw(r.press(1, 'B'));
  r.tick(3700000); const again = createGiveaway({ db: r.db, log() {}, now: () => 1e12 + 3700000, rand: () => 0, fetchChannel: async () => ({ send: async (m) => r.sent.push(m), messages: { edit: async (id, m) => r.edits.push([id, m]) } }), fetchGuild: async () => ({ members: { fetch: async (id) => ({ user: { bot: false }, roles: { cache: new Set() } }) } }), discord: { register() {}, registerButton() {} } });
  await again.tick(); assert.match(r.sent.at(-1).content, /Congratulations <@B>/);
});

test('the command is for people who can manage messages (mods) and not usable in DMs', () => {
  const r = rig(), j = r.cmds.get('giveaway').data.toJSON(); assert.equal(j.default_member_permissions, '8192'); assert.equal(j.dm_permission, false); assert.deepEqual(j.options.map((o) => o.name), ['start', 'end', 'cancel', 'reroll', 'list']);
});
