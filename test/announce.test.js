'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createAnnounce = require('../src/modules/announce');

function rig(over, cfgOver) {
  const kv = new Map(), posts = [];
  const cfg = Object.assign({ channels: { announcements: 'A' }, announce: Object.assign({ on: true, raids: true, minRaid: 3, milestones: true, milestoneEvery: 100 }, over) }, cfgOver);
  const an = createAnnounce({ config: { get: () => cfg }, log() {}, kv: { get: (k) => kv.get(k) || '', set: (k, v) => kv.set(k, v) }, fetchChannel: async (id) => (id === 'A' ? { send: async (m) => posts.push(m) } : null) });
  return { an, posts, kv, cfg };
}

test('a raid is announced above the minimum size, without pinging anyone', async () => {
  const r = rig(); await r.an.onEvent({ type: 'raid', data: { name: 'Sam', viewers: 25 } });
  assert.match(r.posts[0].embeds[0].title, /Raid from Sam/); assert.match(r.posts[0].embeds[0].description, /raided the stream with \*\*25\*\* viewers/); assert.deepEqual(r.posts[0].allowedMentions, { parse: [] });
  await r.an.onEvent({ type: 'raid', data: { name: 'Tiny', viewers: 2 } }); assert.equal(r.posts.length, 1, 'too small');
  r.cfg.announce.raids = false; await r.an.onEvent({ type: 'raid', data: { name: 'Sam', viewers: 99 } }); assert.equal(r.posts.length, 1, 'raids switched off');
});

test('a follower milestone is posted once, on the round numbers only', async () => {
  const r = rig();
  for (const total of [99, 101, 150]) await r.an.onEvent({ type: 'follow', data: { name: 'Fan', total } }); assert.equal(r.posts.length, 0);
  await r.an.onEvent({ type: 'follow', data: { name: 'Fan', total: 100 } }); assert.match(r.posts[0].embeds[0].title, /100 followers/); assert.match(r.posts[0].embeds[0].description, /Latest follower: \*\*Fan\*\*/);
  await r.an.onEvent({ type: 'follow', data: { name: 'Again', total: 100 } }); assert.equal(r.posts.length, 1, 'not twice for the same number (replay, or someone who unfollowed and came back)');
  await r.an.onEvent({ type: 'follow', data: { name: 'Fan2', total: 200 } }); assert.equal(r.posts.length, 2);
  await r.an.onEvent({ type: 'follow', data: { name: 'x' } }); assert.equal(r.posts.length, 2, 'no total, no milestone');
});

test('everything is off when the switch is off, and nothing breaks without a channel or on other events', async () => {
  const off = rig({ on: false }); await off.an.onEvent({ type: 'raid', data: { viewers: 50 } }); await off.an.onEvent({ type: 'follow', data: { total: 100 } }); assert.equal(off.posts.length, 0);
  const none = rig({}, { channels: {} }); await none.an.onEvent({ type: 'raid', data: { name: 'S', viewers: 50 } }); assert.equal(none.posts.length, 0);
  const gone = rig({}, { channels: { announcements: 'GONE' } }); await gone.an.onEvent({ type: 'raid', data: { name: 'S', viewers: 50 } }); await gone.an.onEvent({ type: 'stream.online', data: {} }); assert.equal(gone.posts.length, 0);
  const off2 = rig({ milestones: false }); await off2.an.onEvent({ type: 'follow', data: { total: 100 } }); assert.equal(off2.posts.length, 0);
});
