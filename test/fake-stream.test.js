'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createFake = require('../tools/fake-stream');
const createLocalBridge = require('../src/bridge/local');
const createGoLive = require('../src/modules/golive');
const createMirror = require('../src/modules/mirror');

const memKv = () => { const m = new Map(); return { get: (k) => m.get(k) || '', set: (k, v) => m.set(k, String(v)) }; };

test('the real bridge client, go-live and mirror work against the fake IMC-Stream over HTTP', async () => {
  const fake = createFake(), port = await fake.listen(0), posts = [], edits = [], hookSends = [];
  const cfg = { bridge: { url: 'http://127.0.0.1:' + port }, channels: { goLive: 'G', announcements: 'A', mirror: 'M' }, goLive: { on: true, ping: '' },
    mirror: { on: true, minRole: 'all', hideCommands: true, commandPrefixes: ['!'], showBadges: true, stripLinks: false, hideBots: [], ignore: [] } };
  const config = { get: () => cfg }, kv = memKv(); let n = 0;
  const chans = { G: { send: async (m) => { posts.push(['G', m]); return { id: 'g1' }; }, messages: { edit: async (id, m) => edits.push([id, m]) } }, A: { send: async (m) => { posts.push(['A', m]); return { id: 'a1' }; } } };
  const hook = { send: async (m) => { hookSends.push(m); return { id: 'h' + ++n }; }, deleteMessage: async () => {} };
  const bridge = createLocalBridge({ config, kv, log() {}, wantChat: () => true });
  const golive = createGoLive({ config, kv, delayMs: 0, channel: async (id) => chans[id], snapshot: () => bridge.snapshot(), log() {} });
  const mirror = createMirror({ config, log() {}, getWebhook: async () => hook });
  bridge.on((ev) => (ev.type.startsWith('chat.') ? mirror.onEvent(ev) : golive.onEvent(ev)));
  try {
    await bridge.poll(); assert.equal(bridge.status().state, 'connected');
    fake.actions.online(); await bridge.poll();
    assert.equal(posts[0][0], 'G'); assert.match(posts[0][1].embeds[0].title, /Tetris/);
    fake.actions.update({ title: 'Chess time', game: 'Chess' }); await bridge.poll(); assert.equal(edits[0][1].embeds[0].title, 'Chess time');
    fake.actions.chat({ name: 'Sam', text: 'hi there', badges: 'subscriber' }); fake.actions.chat({ name: 'Pat', text: '!points' }); await bridge.poll(); await mirror.flush();
    assert.equal(hookSends.length, 1, 'only the real chat line, not the command'); assert.deepEqual([hookSends[0].username, hookSends[0].content], ['Sam', '⭐ hi there']);
    fake.actions.recap(); fake.actions.offline(); await bridge.poll();
    assert.equal(posts.find((p) => p[0] === 'A')[1].embeds[0].title, 'Stream recap'); assert.match(edits.at(-1)[1].embeds[0].description, /Streamed for/);
    cfg.mirror.on = false; fake.actions.chat({ name: 'Late', text: 'x' }); await bridge.poll(); assert.equal((await mirror.flush()), 0);
  } finally { await fake.close(); }
});

test('the fake keeps chat only while the bot asks for it', async () => {
  const fake = createFake(), port = await fake.listen(0), get = (p) => fetch('http://127.0.0.1:' + port + p).then((r) => r.json());
  try {
    fake.actions.chat({ name: 'A' }); assert.deepEqual((await get('/api/bridge/events?since=0')).events, []);
    await get('/api/bridge/events?since=0&chat=1'); fake.actions.chat({ name: 'B' }); assert.equal((await get('/api/bridge/events?since=0')).events.length, 1);
    assert.equal((await fetch('http://127.0.0.1:' + port + '/')).status, 200);
  } finally { await fake.close(); }
});
