'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createLocalBridge = require('../src/bridge/local');
const createGoLive = require('../src/modules/golive');

const memKv = () => { const m = new Map(); return { get: (k) => m.get(k) || '', set: (k, v) => m.set(k, String(v)), m }; };
const cfg = (over) => ({ get: () => Object.assign({ bridge: { url: 'http://x:1/' }, channels: { goLive: 'G', announcements: 'A' }, goLive: { on: true, ping: '' } }, over) });

/** a fake IMC-Stream: answers /api/bridge/events?since=N from a list */
function fakeStream() {
  const s = { boot: 'b1', events: [], down: false, status: 200, calls: [] };
  s.add = (type, data) => s.events.push({ id: s.events.length + 1, ts: 0, type, data: data || {} });
  s.fetch = async (u) => {
    s.calls.push(u); if (s.down) throw new TypeError('fetch failed');
    if (s.status !== 200) return { ok: false, status: s.status, json: async () => ({}) };
    const since = Number(new URL(u).searchParams.get('since')) || 0;
    return { ok: true, status: 200, json: async () => ({ boot: s.boot, cursor: s.events.length, events: s.events.filter((e) => e.id > since) }) };
  };
  return s;
}

test('first start skips old events; later ones arrive once, in order', async () => {
  const s = fakeStream(), kv = memKv(), got = [];
  s.add('stream.online', { old: true });
  const b = createLocalBridge({ config: cfg(), kv, fetch: s.fetch, log() {} }); b.on((e) => got.push(e.type + e.id));
  assert.equal(await b.poll(), 0); assert.deepEqual(got, [], 'nothing old is replayed'); assert.equal(b.status().state, 'connected');
  s.add('stream.update'); s.add('recap');
  assert.equal(await b.poll(), 2); assert.deepEqual(got, ['stream.update2', 'recap3']);
  assert.equal(await b.poll(), 0, 'not delivered twice');
  const b2 = createLocalBridge({ config: cfg(), kv, fetch: s.fetch, log() {} }), got2 = []; b2.on((e) => got2.push(e.id));
  s.add('stream.offline'); await b2.poll(); assert.deepEqual(got2, [4], 'a restarted bot continues where it stopped');
  assert.ok(s.calls[0].startsWith('http://x:1/api/bridge/events'), 'trailing slash in the address is fine');
});

test('bridge reports a stopped IMC-Stream, an old version, and recovers', async () => {
  const s = fakeStream(), b = createLocalBridge({ config: cfg(), kv: memKv(), fetch: s.fetch, log() {} });
  s.down = true; await b.poll(); assert.deepEqual([b.status().state, b.status().error], ['offline', 'IMC-Stream is not reachable at that address']);
  const here = createLocalBridge({ config: cfg({ bridge: { url: 'http://127.0.0.1:8420' } }), kv: memKv(), fetch: s.fetch, log() {} }); await here.poll(); assert.equal(here.status().error, 'IMC-Stream is not running', 'on the same PC the plain wording is used');
  s.down = false; s.status = 404; await b.poll(); assert.match(b.status().error, /update IMC-Stream/);
  s.status = 200; await b.poll(); assert.equal(b.status().state, 'connected');
});

test('a restarted IMC-Stream (new boot id) is followed from its start; a failing listener does not stop the rest', async () => {
  const s = fakeStream(), kv = memKv(), got = [], b = createLocalBridge({ config: cfg(), kv, fetch: s.fetch, log() {} });
  b.on((e) => { if (e.type === 'recap') throw new Error('boom'); got.push(e.type); });
  await b.poll(); s.add('stream.online'); s.add('recap'); s.add('stream.update'); await b.poll();
  assert.deepEqual(got, ['stream.online', 'stream.update']);
  s.boot = 'b2'; s.events = []; s.add('stream.offline'); await b.poll();
  assert.deepEqual(got, ['stream.online', 'stream.update', 'stream.offline'], 'ids started over but nothing is lost');
});

function rig(over, snap) {
  const posts = [], edits = [], kv = memKv(); let n = 0, t = 1e12;
  const mk = (id) => ({ send: async (m) => { posts.push([id, m]); return { id: 'm' + ++n }; }, messages: { edit: async (mid, m) => { edits.push([id, mid, m]); } } });
  const chans = { G: mk('G'), A: mk('A') };
  const g = createGoLive({ config: cfg(over), kv, delayMs: 0, now: () => t, channel: async (id) => chans[id] || null, snapshot: async () => Object.assign({ live: true, title: 'Tetris night', game: 'Tetris', login: 'itmecasey', name: 'ItMeCasey', startedAt: 'S1' }, snap), log() {} });
  return { g, posts, edits, kv, tick: (ms) => { t += ms; } };
}

test('go-live posts once per stream with the title, game, link and the chosen ping', async () => {
  const r = rig({ goLive: { on: true, ping: 'everyone' } });
  await r.g.onEvent({ type: 'stream.online', data: { startedAt: 'S1' } });
  assert.equal(r.posts.length, 1); const [ch, m] = r.posts[0];
  assert.equal(ch, 'G'); assert.match(m.content, /^@everyone ItMeCasey is live!/); assert.deepEqual(m.allowedMentions.parse, ['everyone']);
  assert.equal(m.embeds[0].title, 'Tetris night'); assert.match(m.embeds[0].description, /Tetris[\s\S]*twitch\.tv\/itmecasey/); assert.match(m.embeds[0].image.url, /live_user_itmecasey/);
  await r.g.onEvent({ type: 'stream.online', data: { startedAt: 'S1' } }); assert.equal(r.posts.length, 1, 'a repeat or a bot restart does not post again');
  await r.g.catchUp(); assert.equal(r.posts.length, 1, 'catch-up knows it was announced');
});

test('role pings only allow that role; switched off or no channel posts nothing', async () => {
  const r = rig({ goLive: { on: true, ping: '123456789012345678' } });
  await r.g.started({ live: true, title: 't', login: 'a', startedAt: 'X' });
  assert.match(r.posts[0][1].content, /^<@&123456789012345678> /); assert.deepEqual(r.posts[0][1].allowedMentions, { parse: [], roles: ['123456789012345678'] });
  const off = rig({ goLive: { on: false, ping: '' } }); await off.g.started({ title: 't', startedAt: 'X' }); assert.equal(off.posts.length, 0);
  const none = rig({ channels: {} }); await none.g.started({ title: 't', startedAt: 'X' }); assert.equal(none.posts.length, 0);
});

test('update edits the message; offline edits it again with duration and peak, and drops the ping', async () => {
  const r = rig({ goLive: { on: true, ping: 'here' } });
  await r.g.onEvent({ type: 'stream.online', data: { startedAt: 'S1' } });
  await r.g.onEvent({ type: 'stream.update', data: { title: 'New title', game: 'Chess' } });
  assert.equal(r.edits.length, 1); assert.equal(r.edits[0][1], 'm1'); assert.equal(r.edits[0][2].embeds[0].title, 'New title'); assert.match(r.edits[0][2].embeds[0].description, /Chess/);
  await r.g.onEvent({ type: 'stream.offline', data: { startedAt: new Date(1e12 - 95 * 60000).toISOString(), endedAt: new Date(1e12).toISOString(), peakViewers: 42 } });
  const last = r.edits[1][2];
  assert.doesNotMatch(last.content, /@here/); assert.match(last.embeds[0].description, /1 h 35 min/); assert.match(last.embeds[0].description, /Peak viewers:\*\* 42/);
  await r.g.onEvent({ type: 'stream.update', data: { title: 'late' } }); assert.equal(r.edits.length, 2, 'no edits after the stream ended');
});

test('a stream that drops and returns within 5 minutes reuses the message; a later one posts a new one', async () => {
  const r = rig({});
  await r.g.onEvent({ type: 'stream.online', data: { startedAt: 'S1' } });
  await r.g.onEvent({ type: 'stream.offline', data: { endedAt: new Date(1e12).toISOString(), peakViewers: 5 } });
  r.tick(2 * 60000); await r.g.started({ live: true, title: 'back', login: 'itmecasey', startedAt: 'S2' });
  assert.equal(r.posts.length, 1, 'same message'); assert.equal(r.edits.at(-1)[2].embeds[0].title, 'back');
  await r.g.onEvent({ type: 'stream.offline', data: { endedAt: new Date(1e12 + 2 * 60000).toISOString() } });
  r.tick(10 * 60000); await r.g.started({ live: true, title: 'next', login: 'itmecasey', startedAt: 'S3' });
  assert.equal(r.posts.length, 2, 'a new stream');
});

test('recaps go to #announcements without pinging anyone', async () => {
  const r = rig({});
  await r.g.onEvent({ type: 'recap', data: { text: 'Chat talked about @everyone and Tetris.' } });
  assert.equal(r.posts[0][0], 'A'); assert.deepEqual(r.posts[0][1].allowedMentions, { parse: [] }); assert.equal(r.posts[0][1].embeds[0].title, 'Stream recap');
  await r.g.onEvent({ type: 'recap', data: { text: '' } }); assert.equal(r.posts.length, 1, 'empty recaps are ignored');
  const none = rig({ channels: {} }); await none.g.onEvent({ type: 'recap', data: { text: 'x' } }); assert.equal(none.posts.length, 0);
});

/** a pretend IMC-Stream that wants the remote-access login */
function lockedStream(password) {
  const s = { sessions: new Set(), logins: 0, calls: [] };
  s.fetch = async (u, o) => {
    o = o || {}; const url = new URL(u); s.calls.push(url.pathname + url.search);
    if (url.pathname === '/api/login') { const ok = JSON.parse(o.body).password === password; if (!ok) return { ok: false, status: 401, headers: new Map(), json: async () => ({}) };
      s.logins++; const id = 's'.repeat(0) + (s.logins + '').padStart(64, 'a'); s.sessions.add(id); return { ok: true, status: 200, headers: { getSetCookie: () => ['icm_session=' + id + '; HttpOnly; Path=/'] }, json: async () => ({ ok: true }) }; }
    const c = /icm_session=([a-f0-9]+)/.exec((o.headers || {}).Cookie || '');
    if (!c || !s.sessions.has(c[1])) return { ok: false, status: s.refuse ? 403 : 401, headers: new Map(), json: async () => ({ error: 'Not logged in' }) };
    return { ok: true, status: 200, headers: new Map(), json: async () => (url.pathname === '/api/bridge/avatars' ? { 7: 'https://cdn/7.png' } : { boot: 'b', cursor: 0, events: [] }) };
  };
  return s;
}
const remoteCfg = (pw) => ({ get: () => ({ bridge: { url: 'http://192.168.1.9:8420/' } }), secret: (k) => (k === 'bridgePassword' ? pw.v : '') });

test('another computer: the bot logs in with the remote-access password once, keeps the session and logs in again when it ends', async () => {
  const s = lockedStream('hunter22'), pw = { v: 'hunter22' }, b = createLocalBridge({ config: remoteCfg(pw), kv: memKv(), fetch: s.fetch, log() {} });
  await b.poll(); await b.poll(); await b.snapshot(); assert.equal(s.logins, 1, 'one login serves every request'); assert.equal(b.status().state, 'connected');
  s.sessions.clear(); await b.poll(); assert.equal(s.logins, 2, 'the session ended on the other side: logged in again without an error'); assert.equal(b.status().state, 'connected');
  assert.deepEqual(await b.avatars(['7', '8 9']), { 7: 'https://cdn/7.png' }); assert.ok(s.calls.includes('/api/bridge/avatars?ids=7,8%209'), 'ids are encoded');
  pw.v = 'other'; await b.poll(); assert.equal(b.status().state, 'offline'); assert.match(b.status().error, /did not accept that password/, 'a changed password is used at once, and a wrong one is reported');
});

test('without the password the bot says what to do, in plain words', async () => {
  const s = lockedStream('hunter22'), b = createLocalBridge({ config: remoteCfg({ v: '' }), kv: memKv(), fetch: s.fetch, log() {} });
  await b.poll(); assert.match(b.status().error, /asks for its remote-access password: enter it in the dashboard/);
  s.refuse = true; await b.poll(); assert.match(b.status().error, /switch on remote access in its Setup page/);
});

test('a request that hangs is given up after the timeout, and a run id that keeps changing does not loop', async () => {
  const seen = []; let n = 0;
  const hang = createLocalBridge({ config: cfg(), kv: memKv(), log() {}, fetch: async (u, o) => { seen.push(!!(o && o.signal)); throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); } });
  await hang.poll(); assert.ok(seen.every(Boolean), 'every request carries a timeout'); assert.equal(hang.status().state, 'offline'); assert.match(hang.status().error, /not reachable at that address/);
  const flip = createLocalBridge({ config: cfg(), kv: memKv(), log() {}, fetch: async () => ({ ok: true, status: 200, json: async () => ({ boot: 'b' + ++n, cursor: 5, events: [] }) }) });
  await flip.poll(); const before = n; await flip.poll(); assert.ok(n - before <= 2, 'a changing run id causes at most one extra request per round, not a loop (' + (n - before) + ')');
});

test('a recap cannot carry a Discord invite into #announcements', async () => {
  const posts = [], cfgx = { get: () => ({ bridge: { url: 'x' }, channels: { announcements: 'A' }, goLive: { on: true, ping: '' } }) };
  const g = createGoLive({ config: cfgx, kv: memKv(), delayMs: 0, channel: async () => ({ send: async (m) => posts.push(m) }), snapshot: async () => ({}), log() {} });
  await g.onEvent({ type: 'recap', data: { text: 'Chat said join https://discord.gg/evil123 and discord.com/invite/zzz, also @everyone' } });
  assert.doesNotMatch(posts[0].embeds[0].description, /discord\.gg|\/invite\//); assert.match(posts[0].embeds[0].description, /\[invite\]/); assert.deepEqual(posts[0].allowedMentions, { parse: [] });
});
