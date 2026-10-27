'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const openDb = require('../src/db');
const createStarboard = require('../src/modules/starboard');

function rig(over, cfgOver) {
  const db = openDb(':memory:'), posts = [], edits = [], deletes = []; let n = 0;
  const board = { send: async (m) => { posts.push(m); return { id: 'b' + ++n }; }, messages: { edit: async (id, m) => edits.push([id, m]), delete: async (id) => deletes.push(id) } };
  const cfg = Object.assign({ channels: { starboard: 'BOARD' }, starboard: Object.assign({ on: true, threshold: 3, emoji: '⭐' }, over) }, cfgOver);
  const sb = createStarboard({ db, log() {}, config: { get: () => cfg }, fetchChannel: async (id) => (id === 'BOARD' ? board : null) });
  const msg = (o) => Object.assign({ id: 'M1', channelId: 'C1', guild: { id: 'G' }, author: { id: 'AUTHOR', tag: 'ann#1', bot: false }, content: 'a great joke', url: 'https://discord.com/channels/G/C1/M1', createdTimestamp: 1e12, attachments: new Map(), partial: false }, o);
  const reaction = (count, o) => { o = o || {}; const m = o.message || msg(); return { partial: false, emoji: { name: o.emoji || '⭐' }, count, message: m, users: { fetch: async () => new Map((o.users || []).map((u) => [u, {}])) } }; };
  return { sb, db, posts, edits, deletes, cfg, msg, reaction };
}

test('a message that reaches the threshold is posted once, with its text and a link back', async () => {
  const r = rig();
  assert.equal(await r.sb.onReaction(r.reaction(2), true), false); assert.equal(r.posts.length, 0);
  assert.equal(await r.sb.onReaction(r.reaction(3), true), true); const p = r.posts[0];
  assert.equal(p.content, '⭐ **3** <#C1>'); assert.match(p.embeds[0].description, /a great joke[\s\S]*\[Jump to the message\]\(https:\/\/discord\.com\/channels\/G\/C1\/M1\)/); assert.equal(p.embeds[0].author.name, 'ann#1'); assert.deepEqual(p.allowedMentions, { parse: [] });
});

test('the star count follows the reactions; at zero the post is removed', async () => {
  const r = rig(); await r.sb.onReaction(r.reaction(3), true); await r.sb.onReaction(r.reaction(5), true);
  assert.equal(r.edits[0][0], 'b1'); assert.equal(r.edits[0][1].content, '⭐ **5** <#C1>'); assert.equal(r.posts.length, 1, 'edited, not posted again');
  await r.sb.onReaction(r.reaction(5), true); assert.equal(r.edits.length, 1, 'no change, no edit'); await r.sb.onReaction(r.reaction(2), false); assert.equal(r.edits[1][1].content, '⭐ **2** <#C1>', 'it stays on the board when it drops, with the new count');
  await r.sb.onReaction(r.reaction(0), false); assert.deepEqual(r.deletes, ['b1']); assert.equal(r.db.prepare('SELECT COUNT(*) AS n FROM starred').get().n, 0);
});

test('the author\'s own star does not count; other emoji, bots, the board itself and a switched-off board are ignored', async () => {
  const r = rig(); assert.equal(await r.sb.onReaction(r.reaction(3, { users: ['AUTHOR', 'A', 'B'] }), true), false, 'three reactions, one of them the author\'s: only two count');
  assert.equal(await r.sb.onReaction(r.reaction(4, { users: ['AUTHOR', 'A', 'B', 'C'] }), true), true); assert.match(r.posts[0].content, /\*\*3\*\*/);
  const o = rig(); assert.equal(await o.sb.onReaction(o.reaction(9, { emoji: '👍' }), true), false);
  assert.equal(await o.sb.onReaction(o.reaction(9, { message: o.msg({ author: { id: 'X', bot: true } }) }), true), false); assert.equal(await o.sb.onReaction(o.reaction(9, { message: o.msg({ channelId: 'BOARD' }) }), true), false);
  o.cfg.starboard.on = false; assert.equal(await o.sb.onReaction(o.reaction(9), true), false); const none = rig({}, { channels: {} }); assert.equal(await none.sb.onReaction(none.reaction(9), true), false); assert.equal(o.posts.length + none.posts.length, 0);
});

test('the first picture is shown, and partial messages are fetched', async () => {
  const r = rig(), att = new Map([['1', { url: 'https://cdn.example/pic.png', contentType: 'image/png' }]]);
  await r.sb.onReaction(r.reaction(3, { message: r.msg({ attachments: att }) }), true); assert.deepEqual(r.posts[0].embeds[0].image, { url: 'https://cdn.example/pic.png' });
  const p = rig(), full = p.msg({ id: 'M2' }), part = { partial: true, id: 'M2', fetch: async () => full }; await p.sb.onReaction(p.reaction(3, { message: part }), true); assert.equal(p.posts.length, 1);
});
