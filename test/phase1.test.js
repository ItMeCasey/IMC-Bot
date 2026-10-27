'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ChannelType: T } = require('discord.js');
const createConfig = require('../src/config');
const openDb = require('../src/db');
const setup = require('../src/modules/setup');
const createBasic = require('../src/modules/basic');
const createWeb = require('../src/web/server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'imc-bot-'));

test('setup.diff lists everything on an empty server and nothing on a complete one', () => {
  const todo = setup.diff([], []);
  assert.ok(todo.some((t) => t.kind === 'role' && t.name === 'Mods'));
  assert.ok(todo.some((t) => t.kind === 'text' && t.name === 'go-live' && t.in === 'INFO'));
  assert.ok(todo.some((t) => t.kind === 'voice' && t.name === 'Lounge'));
  const roles = setup.ROLES.map(([name]) => ({ name }));
  const channels = []; let id = 1;
  for (const [cat, list] of setup.LAYOUT) {
    const c = { id: String(id++), name: cat.toLowerCase(), type: T.GuildCategory }; channels.push(c);   // names match without case
    for (const [name, type] of list) channels.push({ id: String(id++), name, type, parentId: c.id });
  }
  assert.deepEqual(setup.diff(roles, channels), []);
  assert.equal(setup.diff(roles, channels.filter((c) => c.name !== 'rules')).length, 1, 'only the missing channel');
});

test('config keeps the token out of the page view and in its own file', () => {
  const dir = tmp(), c = createConfig(dir);
  const v = c.set({ token: ' abc.def ', guildId: '123456789012345678', dryRun: false });
  assert.equal(v.hasToken, true); assert.ok(!JSON.stringify(v).includes('abc.def'));
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('abc.def'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).token, 'abc.def');
  assert.equal(createConfig(dir).get().guildId, '123456789012345678', 'survives a restart');
  assert.equal(c.set({ guildId: 'not-an-id' }).guildId, '', 'bad ids are dropped');
  assert.equal(c.set({ clearToken: true }).hasToken, false);
});

test('database creates its tables and reopens without migrating twice', () => {
  const file = path.join(tmp(), 'sub', 'bot.db');
  let db = openDb(file); db.prepare("INSERT INTO cases (guild_id, type, created_at) VALUES ('g', 'warn', 1)").run(); db.close();
  db = openDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cases').get().n, 1);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  db.close();
});

test('new members are greeted and given the join role only when switched on', async () => {
  const sent = [], roles = [], cfg = { welcome: { on: true, joinRole: '777' }, channels: { welcome: 'c1', rules: 'c2' } };
  const ctx = { config: { get: () => cfg }, log() {}, discord: { register() {} } };
  const member = { id: '1', displayName: 'Sam', user: { bot: false }, roles: { add: async (r) => roles.push(r) }, guild: { channels: { cache: new Map([['c1', { send: async (m) => sent.push(m) }]]) } } };
  const b = createBasic(ctx);
  await b.onJoin(member);
  assert.deepEqual(roles, ['777']); assert.equal(sent.length, 1); assert.deepEqual(sent[0].allowedMentions, { users: ['1'] }, 'only the new member is pinged');
  cfg.welcome.on = false; await b.onJoin(member); assert.equal(sent.length, 1);
  cfg.welcome.on = true; await b.onJoin(Object.assign({}, member, { user: { bot: true } })); assert.equal(sent.length, 1, 'bots are not greeted');
});

test('dashboard answers only this PC and never returns the token', async () => {
  const dir = tmp(), config = createConfig(dir), calls = [];
  const discord = { status: () => ({ state: 'offline', bot: '', error: '' }), guilds: () => [], start: async () => { calls.push('start'); }, stop: async () => {}, registerCommands: async () => {}, guild: async () => ({}) };
  const web = createWeb({ config, discord, setup: {}, publicDir: path.join(__dirname, '..', 'public'), log() {} });
  const port = await web.listen(0);
  const req = (method, p, body, headers) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ code: res.statusCode, body: d })); });
    r.on('error', reject); r.end(body && JSON.stringify(body));
  });
  try {
    assert.equal((await req('GET', '/')).code, 200);
    assert.equal((await req('GET', '/../package.json')).code, 404, 'cannot read files outside public');
    assert.equal((await req('GET', '/api/status', null, { Host: 'evil.example.com' })).code, 403, 'rebinding blocked');
    assert.equal((await req('POST', '/api/settings', { token: 'x' }, { Origin: 'https://evil.example.com' })).code, 403, 'other sites blocked');
    const r = await req('POST', '/api/settings', { token: 'secret-token' });
    assert.equal(r.code, 200); assert.ok(!r.body.includes('secret-token')); assert.equal(JSON.parse(r.body).settings.hasToken, true);
    assert.deepEqual(calls, ['start'], 'saving a token connects');
    assert.equal((await req('POST', '/api/nope', {})).code, 404);
  } finally { await web.close(); }
});

test('the bridge address must be an http(s) address and is cut to its origin; the password is a secret like the token', () => {
  const dir = tmp(), c = createConfig(dir);
  let v = c.set({ bridge: { url: ' http://192.168.1.5:8420/some/path ' }, bridgePassword: 'hunter22' });
  assert.equal(v.bridge.url, 'http://192.168.1.5:8420'); assert.equal(v.hasBridgePassword, true); assert.ok(!JSON.stringify(v).includes('hunter22'));
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes('hunter22')); assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8')).bridgePassword, 'hunter22');
  for (const bad of ['javascript:alert(1)', 'not an address', 'ftp://x/y']) assert.equal(c.set({ bridge: { url: bad } }).bridge.url, 'http://192.168.1.5:8420', bad);
  assert.equal(c.set({ clearBridgePassword: true }).hasBridgePassword, false);
});

test('the dashboard test button sends a pretend boost to IMC-Stream and says whether it was shown', async () => {
  const dir = tmp(), config = createConfig(dir), sent = []; let shown = true;
  const discord = { status: () => ({ state: 'offline', bot: '', error: '' }), guilds: () => [], start: async () => {}, stop: async () => {}, registerCommands: async () => {}, guild: async () => ({}) };
  const web = createWeb({ config, discord, setup: {}, bridge: { status: () => ({ state: 'connected' }), alert: async (e, v) => { sent.push([e, v]); return { ok: true, shown }; } }, publicDir: path.join(__dirname, '..', 'public'), log() {} });
  const port = await web.listen(0), post = (p) => fetch('http://127.0.0.1:' + port + '/api/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
  try {
    assert.deepEqual(await post('test-stream-alert'), { ok: true, shown: true }); assert.deepEqual(sent, [['discord_boost', { name: 'TestBooster', boosts: 1, level: 1 }]]);
    shown = false; assert.deepEqual(await post('test-stream-alert'), { ok: true, shown: false }, 'IMC-Stream had no rule for it');
  } finally { await web.close(); }
});

test('the Discord alert settings are clamped like the others', () => {
  const c = createConfig(tmp()), v = c.set({ streamAlerts: { on: true, joins: true, milestoneEvery: 1, evil: 1 } });
  assert.deepEqual(v.streamAlerts, { on: true, boosts: true, joins: true, milestones: true, milestoneEvery: 10 });
});

test('dashboard: only its own page may change things (scheme, host and port), a bad Origin cannot crash it, files cannot be reached from outside, security headers are on', async () => {
  const dir = tmp(), pub = path.join(dir, 'public'); fs.mkdirSync(pub); fs.mkdirSync(path.join(dir, 'public2')); fs.writeFileSync(path.join(pub, 'index.html'), '<p>hi</p>'); fs.writeFileSync(path.join(pub, 'app.js'), '1'); fs.writeFileSync(path.join(dir, 'public2', 'secret.txt'), 'secret');
  const config = createConfig(path.join(dir, 'data')), discord = { status: () => ({ state: 'offline', bot: '', error: '' }), guilds: () => [], start: async () => {}, stop: async () => {}, registerCommands: async () => {}, guild: async () => ({}) };
  const web = createWeb({ config, discord, setup: {}, publicDir: pub, log() {} }), port = await web.listen(0);
  const req = (method, p, headers, body) => new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ code: res.statusCode, body: d, headers: res.headers })); }); r.on('error', reject); r.end(body); });
  const self = 'http://127.0.0.1:' + port;
  try {
    assert.equal((await req('POST', '/api/settings', { Origin: self }, '{}')).code, 200, 'the dashboard page itself');
    assert.equal((await req('POST', '/api/settings', { Origin: 'http://localhost:' + port }, '{}')).code, 403, 'a different host name is not the same origin');
    assert.equal((await req('POST', '/api/settings', { Origin: 'http://127.0.0.1:' + (port + 1) }, '{}')).code, 403, 'another local port (another page or app) is refused');
    assert.equal((await req('POST', '/api/settings', { Origin: 'https://127.0.0.1:' + port }, '{}')).code, 403, 'another scheme');
    for (const bad of ['null', 'not a url', '', 'file://']) assert.equal((await req('POST', '/api/settings', { Origin: bad }, '{}')).code, 403, 'Origin: ' + JSON.stringify(bad) + ' is refused and does not crash the server');
    assert.equal((await req('POST', '/api/settings', { 'Sec-Fetch-Site': 'cross-site' }, '{}')).code, 403, 'a browser saying cross-site'); assert.equal((await req('POST', '/api/settings', { 'Sec-Fetch-Site': 'same-origin' }, '{}')).code, 200);
    assert.equal((await req('POST', '/api/settings', {}, '{}')).code, 200, 'a program on this PC without an Origin');
    assert.equal((await req('GET', '/api/status', {})).code, 200, 'the server is still alive after all that');
    assert.equal((await req('POST', '/api/settings', { Origin: self }, '{not json')).code, 400, 'bad JSON is an error, not a crash');
    for (const p of ['/../public2/secret.txt', '/%2e%2e/public2/secret.txt', '/..%2fpublic2%2fsecret.txt', '/%2e%2e%5cpublic2%5csecret.txt', '/a%00b', '/%']) assert.ok([400, 404].includes((await req('GET', p, {})).code), p);
    const page = await req('GET', '/', {}); assert.equal(page.code, 200); assert.match(page.headers['content-security-policy'], /script-src 'self'(;|$)/); assert.doesNotMatch(page.headers['content-security-policy'], /script-src[^;]*unsafe/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/); assert.equal(page.headers['x-frame-options'], 'DENY'); assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.ok((await req('GET', '/api/status', {})).headers['content-security-policy'], 'on the API answers too');
  } finally { await web.close(); }
});

test('errors shown to people: our own sentences and Discord\'s texts, never internal errors', () => {
  const { userMessage } = require('../src/discord/client'), api = new (class DiscordAPIError extends Error {})('Missing Permissions');
  assert.equal(userMessage(new Error('You cannot do that to yourself.')), 'You cannot do that to yourself.'); assert.equal(userMessage(api), 'Missing Permissions');
  assert.match(userMessage(new TypeError("Cannot read properties of undefined (reading 'secret')")), /Something went wrong/); assert.match(userMessage(new RangeError('x')), /Something went wrong/); assert.match(userMessage(undefined), /Something went wrong/);
});

test('events from a server other than the chosen one are ignored by every listener; DMs and events without a server still pass', () => {
  const { onlyOurServer, guildIdOf } = require('../src/discord/client'), got = []; let mine = 'G1'; const handlers = [];
  const fake = { on(ev, fn) { handlers.push([ev, fn]); return this; } }; onlyOurServer(fake, () => mine);
  fake.on('x', (a) => got.push(a.tag)); const fire = (a, b) => handlers.forEach(([, fn]) => fn(a, b));
  fire({ tag: 'message here', guildId: 'G1' }); fire({ tag: 'message elsewhere', guildId: 'G2' }); fire({ tag: 'member here', guild: { id: 'G1' } }); fire({ tag: 'member elsewhere', guild: { id: 'G2' } });
  fire({ tag: 'reaction elsewhere', message: { guildId: 'G2' } }); fire({ tag: 'old member, new member', guild: { id: 'G2' } }, { guild: { id: 'G2' } }); fire({ tag: 'dm' }); fire({ tag: 'dm channel', guildId: null });
  assert.deepEqual(got, ['message here', 'member here', 'dm', 'dm channel']); mine = ''; got.length = 0; fire({ tag: 'any', guildId: 'G9' }); assert.deepEqual(got, ['any'], 'with no server chosen yet nothing is filtered');
  assert.equal(guildIdOf({ message: { guild: { id: 'G3' } } }), 'G3'); assert.equal(guildIdOf(null), '');
});

test('a saved IMC-Stream password is never sent to a new address: changing the address clears it unless a new one is given with it', () => {
  const c = createConfig(tmp()); c.set({ bridge: { url: 'http://192.168.1.5:8420' }, bridgePassword: 'hunter22' }); assert.equal(c.secret('bridgePassword'), 'hunter22');
  c.set({ bridge: { url: 'http://192.168.1.5:8420/' } }); assert.equal(c.secret('bridgePassword'), 'hunter22', 'the same address keeps it');
  c.set({ bridge: { url: 'http://10.9.9.9:8420' } }); assert.equal(c.secret('bridgePassword'), '', 'a new address clears it'); assert.equal(c.get().bridge.url, 'http://10.9.9.9:8420');
  c.set({ bridge: { url: 'http://10.1.1.1:8420' }, bridgePassword: 'new-pass-1' }); assert.equal(c.secret('bridgePassword'), 'new-pass-1', 'a new address with its own password keeps that password');
  c.set({ bridge: { url: 'not an address' } }); assert.equal(c.secret('bridgePassword'), 'new-pass-1', 'a bad address changes nothing');
});

test('the title bar: the page has the Support Us link and the status carries the version', async () => {
  const dir = tmp(), config = createConfig(dir), discord = { status: () => ({ state: 'offline', bot: '', error: '' }), guilds: () => [], start: async () => {}, stop: async () => {}, registerCommands: async () => {}, guild: async () => ({}) };
  const web = createWeb({ config, discord, setup: {}, version: '2026.1.2', publicDir: path.join(__dirname, '..', 'public'), log() {} }), port = await web.listen(0);
  try {
    assert.equal((await fetch('http://127.0.0.1:' + port + '/api/status').then((r) => r.json())).version, '2026.1.2');
    const html = await fetch('http://127.0.0.1:' + port + '/').then((r) => r.text());
    assert.match(html, /<a id="support" href="https:\/\/itmecasey\.com\/support\/" target="_blank" rel="noopener"[^>]*>[^<]*Support Us<\/a>/); assert.match(html, /<header id="top">/);
    const css = await fetch('http://127.0.0.1:' + port + '/app.css').then((r) => r.text()); assert.match(css, /-webkit-app-region: drag/); assert.match(css, /::-webkit-scrollbar-thumb/); assert.match(css, /titlebar-area-width/);
  } finally { await web.close(); }
});
