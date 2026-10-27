'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const openDb = require('../src/db');
const createSuggestions = require('../src/modules/suggestions');

function rig(cfgOver) {
  const db = openDb(':memory:'), cmds = new Map(), btns = {}, sent = [], edits = [];
  const ch = { id: 'S1', send: async (m) => { sent.push(m); return { id: 'msg' + sent.length }; }, messages: { edit: async (id, m) => edits.push([id, m]) } };
  const cfg = Object.assign({ channels: { suggestions: 'S1' } }, cfgOver);
  const clock = { t: 1e12 }; createSuggestions({ db, log() {}, now: () => clock.t, config: { get: () => cfg }, fetchChannel: async (id) => (id === 'S1' ? ch : null), discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (p, f) => { btns[p] = f; } } });
  const guild = { id: 'G' };
  const run = async (name, o, sub) => { const out = []; await cmds.get(name).run({ memberPermissions: { has: () => true }, guild, user: { id: 'U1', tag: 'sam#1' }, options: { getString: (n) => o[n] ?? null, getInteger: (n) => o[n] ?? null, getSubcommand: () => sub }, reply: async (m) => out.push(m.content) }); return out[0]; };
  const press = async (id, uid) => { const out = []; await btns.sg({ customId: id, guild, user: { id: uid }, reply: async (m) => out.push(m.content), update: async (m) => out.push(m) }); return out[0]; };
  return { cmds, sent, edits, run, press, cfg, clock };
}

test('/suggest posts a card with two vote buttons in #suggestions', async () => {
  const r = rig(); assert.match(await r.run('suggest', { idea: 'More Tetris please' }), /Thanks! Your suggestion is #1 in <#S1>/);
  const m = r.sent[0]; assert.equal(m.embeds[0].title, 'Suggestion #1 (Open)'); assert.match(m.embeds[0].description, /More Tetris please/); assert.deepEqual(m.components[0].components.map((c) => c.data.custom_id), ['sg:up:1', 'sg:down:1']); assert.deepEqual(m.allowedMentions, { parse: [] });
  const none = rig({ channels: {} }); await assert.rejects(none.run('suggest', { idea: 'x' }), /no #suggestions channel/);
});

test('one vote each: change it, take it back, counts shown on the buttons', async () => {
  const r = rig(); await r.run('suggest', { idea: 'Idea' });
  let o = await r.press('sg:up:1', 'A'); assert.deepEqual(o.components[0].components.map((c) => c.data.label), ['1', '0']);
  await r.press('sg:up:1', 'B'); o = await r.press('sg:down:1', 'C'); assert.deepEqual(o.components[0].components.map((c) => c.data.label), ['2', '1']);
  o = await r.press('sg:down:1', 'A'); assert.deepEqual(o.components[0].components.map((c) => c.data.label), ['1', '2'], 'A changed from up to down');
  o = await r.press('sg:down:1', 'A'); assert.deepEqual(o.components[0].components.map((c) => c.data.label), ['1', '1'], 'pressing the same button again takes the vote back');
});

test('mods answer a suggestion: the card changes and voting closes on deny and done', async () => {
  const r = rig(); await r.run('suggest', { idea: 'Idea' });
  assert.match(await r.run('suggestion', { id: 1, reason: 'Good one, next month' }, 'approve'), /now approved/); const e = r.edits[0][1]; assert.equal(e.embeds[0].title, 'Suggestion #1 (Approved)'); assert.match(e.embeds[0].description, /Answer:\*\* Good one, next month/); assert.equal(e.components[0].components[0].data.disabled, false);
  assert.match(await r.run('suggestion', { id: 1 }, 'deny'), /now denied/); assert.equal(r.edits[1][1].components[0].components[0].data.disabled, true);
  assert.equal(await r.press('sg:up:1', 'A'), 'Voting on this suggestion is closed.');
  await assert.rejects(r.run('suggestion', { id: 9 }, 'done'), /No such suggestion/);
  const j = r.cmds.get('suggestion').data.toJSON(); assert.equal(j.default_member_permissions, F.ManageMessages.toString()); assert.equal(r.cmds.get('suggest').data.toJSON().default_member_permissions, undefined);
  assert.equal(await r.press('sg:up:99', 'A'), 'That suggestion is gone.');
});

test('one suggestion every 30 seconds per person', async () => {
  const r = rig(); await r.run('suggest', { idea: 'one' }); await assert.rejects(r.run('suggest', { idea: 'two' }), /wait a little/); assert.equal(r.sent.length, 1);
  r.clock.t += 31000; await r.run('suggest', { idea: 'three' }); assert.equal(r.sent.length, 2);
});
