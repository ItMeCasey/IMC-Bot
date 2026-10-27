'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createMirror = require('../src/modules/mirror');

const MIRROR = () => ({ on: true, minRole: 'all', hideCommands: true, commandPrefixes: ['!'], showBadges: true, stripLinks: false, hideBots: ['nightbot'], ignore: ['spammer'] });
function rig(over, cfgOver) {
  const sends = [], deletes = []; let n = 0;
  const cfg = Object.assign({ channels: { mirror: 'M' }, mirror: Object.assign(MIRROR(), over) }, cfgOver);
  const hook = { send: async (m) => { sends.push(m); return { id: 'd' + ++n }; }, deleteMessage: async (id) => { deletes.push(id); } };
  const mir = createMirror({ config: { get: () => cfg }, log() {}, getWebhook: async (id) => (id === 'M' ? hook : null) });
  const chat = (text, o) => mir.onEvent({ type: 'chat.message', data: Object.assign({ id: 'm' + Math.random(), uid: 'u1', login: 'sam', name: 'Sam', badges: [], type: 'text', text }, o) });
  return { mir, sends, deletes, cfg, chat };
}

test('a chat line appears under the chatter\'s name, with badges, and cannot ping anybody', async () => {
  const r = rig(); r.chat('hello *world* @everyone <@123456789012345678> @here', { badges: ['moderator', 'subscriber'] });
  assert.equal(await r.mir.flush(), 1); const m = r.sends[0];
  assert.equal(m.username, 'Sam'); assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.match(m.content, /^🗡️⭐ hello \\\*world\\\* @​everyone <​@123456789012345678> @​here$/);
  const off = rig({ showBadges: false }); off.chat('hi', { badges: ['moderator'] }); await off.mir.flush(); assert.equal(off.sends[0].content, 'hi');
});

test('replies show who was answered; links can be hidden; names Discord would refuse are made safe', async () => {
  const r = rig({ stripLinks: true }); r.chat('see https://evil.example.com/x and www.a.b', { reply: { name: 'Pat', text: 'what is that?' }, name: 'Discord_Clyde @me' });
  await r.mir.flush(); const m = r.sends[0];
  assert.match(m.content, /^↪ \*\*Pat\*\*: what is that\?\nsee \[link\] and \[link\]$/); assert.equal(m.username, 'D1scord_Cl_de me');
  assert.equal(createMirror.safeName(''), 'viewer'); assert.equal(createMirror.safeName('x'.repeat(200)).length, 80);
});

test('commands, bots, the ignore list, odd message types, empty text and minimum role are filtered', async () => {
  const r = rig({ minRole: 'subs' });
  r.chat('!points'); r.chat('hello', { login: 'nightbot', badges: ['subscriber'] }); r.chat('hello', { login: 'spammer', badges: ['subscriber'] }); r.chat('hello', { type: 'power_ups_gigantified_emote', badges: ['subscriber'] });
  r.chat('   ', { badges: ['subscriber'] }); r.chat('plain viewer'); r.chat('a sub', { badges: ['subscriber'] }); r.chat('the vip', { badges: ['vip'] }); r.chat('!cmd from a sub', { badges: ['subscriber'] });
  await r.mir.flush(); assert.deepEqual(r.sends.map((s) => s.content.replace(/^\S+ /, '')), ['a sub', 'the vip']);
  const vips = rig({ minRole: 'vip' }); vips.chat('a sub', { badges: ['subscriber'] }); vips.chat('mod', { badges: ['moderator'] }); await vips.mir.flush(); assert.equal(vips.sends.length, 1);
  const cmds = rig({ hideCommands: false }); cmds.chat('!points'); await cmds.mir.flush(); assert.equal(cmds.sends.length, 1, 'commands can be shown');
});

test('nothing is sent while off or without a channel; the line is not kept for later', async () => {
  const off = rig({ on: false }); off.chat('hi'); assert.equal(await off.mir.flush(), 0); off.cfg.mirror.on = true; assert.equal(await off.mir.flush(), 0, 'dropped, not queued');
  const none = rig({}, { channels: {} }); none.chat('hi'); assert.equal(await none.mir.flush(), 0);
  const gone = rig({}, { channels: { mirror: 'GONE' } }); gone.cfg.channels.mirror = 'M'; gone.chat('x'); gone.cfg.channels.mirror = 'GONE'; assert.equal(await gone.mir.flush(), 0, 'a missing channel does not crash');
});

test('Twitch deleting, timing out or clearing removes the Discord lines (sent or still waiting)', async () => {
  const r = rig(); r.chat('one', { id: 'a', uid: 'U1' }); r.chat('two', { id: 'b', uid: 'U2' }); r.chat('three', { id: 'c', uid: 'U1' }); r.chat('waiting', { id: 'w', uid: 'U1' });
  r.mir._queue().splice(3, 1); await r.mir.flush(); r.chat('four', { id: 'd4', uid: 'U1' });   // three sent, one still waiting
  r.mir.onEvent({ type: 'chat.delete', data: { id: 'b' } }); await new Promise((x) => setImmediate(x)); assert.deepEqual(r.deletes, ['d2']);
  r.mir.onEvent({ type: 'chat.clearUser', data: { uid: 'U1' } }); await new Promise((x) => setImmediate(x)); assert.deepEqual(r.deletes.sort(), ['d1', 'd2', 'd3']); assert.equal(r.mir._queue().length, 0, 'the waiting line of that person is dropped');
  r.chat('five', { id: 'e', uid: 'U3' }); await r.mir.flush(); r.mir.onEvent({ type: 'chat.clear', data: {} }); await new Promise((x) => setImmediate(x)); assert.equal(r.deletes.length, 4); assert.equal(r.mir._sent.size, 0);
});

test('a flood is slowed to a few lines per flush and the rest are counted, not lost silently', async () => {
  const r = rig(); for (let n = 0; n < 60; n++) r.chat('msg ' + n, { id: 'f' + n });
  assert.equal(r.mir._queue().length, 40, 'the queue is capped'); assert.equal(await r.mir.flush(), 4, 'a few lines per second');
  assert.match(r.sends[0].content, /^\*20 messages skipped/); assert.equal(r.sends[0].username, 'IMC-Bot'); assert.equal(r.sends.length, 5);
  assert.equal(r.sends[1].content, 'msg 20', 'the oldest were skipped, the newest kept in order');
});

test('a failed send does not stop the rest, and asks for a fresh webhook', async () => {
  const forgot = []; let calls = 0; const cfg = { channels: { mirror: 'M' }, mirror: MIRROR() };
  const mir = createMirror({ config: { get: () => cfg }, log() {}, forgetWebhook: (id) => forgot.push(id), getWebhook: async () => ({ send: async (m) => { if (++calls === 1) throw new Error('Unknown Webhook'); return { id: 'x' }; }, deleteMessage: async () => {} }) });
  for (const t of ['a', 'b']) mir.onEvent({ type: 'chat.message', data: { id: t, uid: 'u', login: 'sam', name: 'Sam', badges: [], type: 'text', text: t } });
  assert.equal(await mir.flush(), 2); assert.deepEqual(forgot, ['M']); assert.equal(mir._sent.size, 1);
});

test('chatters show their Twitch picture: one request per new person, remembered, and a failure only means no picture', async () => {
  const sends = [], asked = []; let fail = false;
  const cfg = { channels: { mirror: 'M' }, mirror: Object.assign(MIRROR(), { avatars: true }) };
  const mir = createMirror({ config: { get: () => cfg }, log() {}, getWebhook: async () => ({ send: async (m) => { sends.push(m); return { id: 'x' }; }, deleteMessage: async () => {} }),
    avatars: async (ids) => { asked.push(ids); if (fail) throw new Error('boom'); return Object.fromEntries(ids.map((i) => [i, i === 'u2' ? 'http://insecure/p.png' : 'https://cdn/' + i + '.png'])); } });
  const say = (uid, text) => mir.onEvent({ type: 'chat.message', data: { id: Math.random(), uid, login: 'l' + uid, name: 'N' + uid, badges: [], type: 'text', text } });
  say('u1', 'a'); say('u2', 'b'); say('u1', 'c'); await mir.flush();
  assert.deepEqual(asked, [['u1', 'u2']], 'one request for the whole batch, each person once'); assert.deepEqual(sends.map((s) => s.avatarURL), ['https://cdn/u1.png', undefined, 'https://cdn/u1.png'], 'only https pictures are used');
  say('u1', 'd'); say('u3', 'e'); await mir.flush(); assert.deepEqual(asked[1], ['u3'], 'u1 and u2 are remembered'); assert.equal(sends.at(-2).avatarURL, 'https://cdn/u1.png');
  fail = true; say('u4', 'f'); await mir.flush(); assert.equal(sends.at(-1).avatarURL, undefined); assert.equal(sends.at(-1).content, 'f', 'the line still goes out');
  cfg.mirror.avatars = false; asked.length = 0; say('u5', 'g'); await mir.flush(); assert.equal(asked.length, 0, 'switched off: no requests'); assert.equal(sends.at(-1).avatarURL, undefined);
});

test('Discord invite links in Twitch chat are never passed on, even with the link setting off; links are replaced by default', async () => {
  const r = rig({ stripLinks: false }); r.chat('join discord.gg/abc123 or https://discord.com/invite/xyz or dsc.gg/q and see https://ok.example.com'); await r.mir.flush();
  assert.equal(r.sends[0].content, 'join [invite] or [invite] or [invite] and see https://ok.example.com');
  assert.equal(require('../src/config')(require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'imc-m-'))).get().mirror.stripLinks, true, 'replacing links is the default');
});
