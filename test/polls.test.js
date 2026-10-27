'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const openDb = require('../src/db');
const createPolls = require('../src/modules/polls');

function rig(over) {
  let t = 1e12; const db = openDb(':memory:'), cmds = new Map(), btns = {}, sent = [], edits = [];
  const ch = { send: async (m) => { if (over && over.failSend) throw new Error('Missing Access'); sent.push(m); return { id: 'msg' + sent.length }; }, messages: { edit: async (id, m) => edits.push([id, m]) } };
  const p = createPolls({ db, log() {}, now: () => t, fetchChannel: async (id) => (id === 'C1' ? ch : null), discord: { register: (c) => cmds.set(c.data.name, c), registerButton: (pr, f) => { btns[pr] = f; } } });
  const guild = { id: 'G' };
  const run = async (sub, o) => { const out = []; await cmds.get('poll').run({ guild, channelId: 'C1', channel: ch, user: { id: 'HOST' }, options: { getSubcommand: () => sub, getString: (n) => o[n] ?? null, getInteger: (n) => o[n] ?? null }, reply: async (m) => out.push(m.content) }); return out[0]; };
  const vote = async (id, c, uid) => { const out = []; await btns.poll({ customId: 'poll:' + id + ':' + c, guild, user: { id: uid }, reply: async (m) => out.push(m.content), update: async (m) => out.push(m) }); return out[0]; };
  return { p, db, cmds, sent, edits, run, vote, tick: (ms) => { t += ms; } };
}

test('start checks the answers and the time, and posts one button per answer', async () => {
  const r = rig();
  await assert.rejects(r.run('start', { question: 'Q', answers: 'Only one' }), /2 to 5 answers/); await assert.rejects(r.run('start', { question: 'Q', answers: 'a|b|c|d|e|f' }), /2 to 5/); await assert.rejects(r.run('start', { question: 'Q', answers: 'Yes | yes' }), /different/);
  await assert.rejects(r.run('start', { question: 'Q', answers: 'a|b', duration: '5s' }), /30 seconds/); await assert.rejects(r.run('start', { question: 'Q', answers: 'a|b', duration: '9d' }), /7 days/);
  assert.equal(await r.run('start', { question: 'Best game?', answers: 'Tetris | Chess | Go' }), 'Poll #1 started.');
  const m = r.sent[0]; assert.match(m.embeds[0].title, /Best game\?/); assert.deepEqual(m.components[0].components.map((c) => c.data.label), ['Tetris', 'Chess', 'Go']); assert.deepEqual(m.components[0].components.map((c) => c.data.custom_id), ['poll:1:0', 'poll:1:1', 'poll:1:2']);
  assert.match(m.embeds[0].description, /Ends <t:\d+:R>/); assert.deepEqual(m.allowedMentions, { parse: [] });
  await assert.rejects(rig({ failSend: true }).run('start', { question: 'Q', answers: 'a|b' }), /could not post/);
});

test('one vote each that can be changed, shown as bars', async () => {
  const r = rig(); await r.run('start', { question: 'Q', answers: 'A | B' });
  await r.vote(1, 0, 'U1'); await r.vote(1, 0, 'U2'); let o = await r.vote(1, 1, 'U3'); assert.match(o.embeds[0].description, /\*\*A\*\*\n███████░░░ 2 \(67%\)[\s\S]*\*\*B\*\*\n███░░░░░░░ 1 \(33%\)/);
  o = await r.vote(1, 1, 'U1'); assert.match(o.embeds[0].description, /\*\*A\*\*\n███░░░░░░░ 1 \(33%\)[\s\S]*\*\*B\*\*\n███████░░░ 2 \(67%\)/, 'U1 changed their vote'); assert.match(o.embeds[0].description, /Votes so far: 3/, 'nobody is counted twice');
  assert.equal(await r.vote(1, 7, 'U9'), 'That answer does not exist.'); assert.equal(await r.vote(99, 0, 'U9'), 'That poll is gone.');
});

test('the poll ends on time (and on /poll end), shows the winner and refuses late votes; a restart does not lose it', async () => {
  const r = rig(); await r.run('start', { question: 'Q', answers: 'A | B', duration: '10m' }); await r.vote(1, 1, 'U1'); await r.vote(1, 1, 'U2'); await r.vote(1, 0, 'U3');
  await r.p.tick(); assert.equal(r.edits.length, 0, 'not yet'); r.tick(11 * 60000); await r.p.tick();
  const e = r.edits[0][1]; assert.match(e.embeds[0].title, /ended/); assert.match(e.embeds[0].description, /\*\*A\*\*[\s\S]*🏆 \*\*B\*\*[\s\S]*Total votes: 3/); assert.equal(e.components[0].components[0].data.disabled, true);
  assert.equal(await r.vote(1, 0, 'U4'), 'This poll is over.'); await r.p.tick(); assert.equal(r.edits.length, 1, 'ended once');
  await assert.rejects(r.run('end', { id: 1 }), /already over/); await assert.rejects(r.run('end', { id: 9 }), /No such poll/);
  await r.run('start', { question: 'Q2', answers: 'X | Y' }); assert.equal(await r.run('end', { id: 2 }), 'Ended poll #2.'); assert.match(r.edits[1][1].embeds[0].description, /Total votes: 0/); assert.doesNotMatch(r.edits[1][1].embeds[0].description, /🏆/, 'no trophy when nobody voted');
  const r2 = rig(); await r2.run('start', { question: 'Q', answers: 'A | B', duration: '1m' }); r2.tick(120000);
  const again = createPolls({ db: r2.db, log() {}, now: () => 1e12 + 120000, fetchChannel: async () => ({ messages: { edit: async (id, m) => r2.edits.push([id, m]) } }), discord: { register() {}, registerButton() {} } }); await again.tick(); assert.equal(r2.edits.length, 1);
});
