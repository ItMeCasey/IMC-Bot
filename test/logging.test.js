'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createLogging = require('../src/modules/logging');

function rig(over, cfgOver) {
  const posts = [], cfg = Object.assign({ channels: { auditLog: 'A' }, logging: Object.assign({ on: true, messages: true, members: true, roles: true, voice: true }, over) }, cfgOver);
  const lg = createLogging({ config: { get: () => cfg }, log() {}, now: () => 1e12, fetchChannel: async (id) => (id === 'A' ? { send: async (m) => posts.push(m.embeds[0]) } : null) });
  return { lg, posts, cfg };
}
const user = (id, bot) => ({ id, tag: id + '#1', bot: !!bot, createdTimestamp: 1e12 - 3 * 86400000 });
const roles = (...ids) => ({ cache: new Map(ids.map((i) => [i, {}])) });

test('deleted and edited messages are logged with their text; bots, DMs and unchanged edits are not', async () => {
  const r = rig();
  await r.lg.onDelete({ guild: {}, author: user('U'), channelId: 'C', content: 'secret\nline two', attachments: { size: 2 } });
  assert.equal(r.posts[0].title, 'Message deleted'); assert.match(r.posts[0].description, /<@U> \(U#1\) in <#C>\n> secret\n> line two\n\+ 2 attachment/);
  await r.lg.onDelete({ guild: {}, author: null, channelId: 'C', content: null }); assert.match(r.posts[1].description, /Author unknown[\s\S]*not saved/);
  await r.lg.onDelete({ guild: {}, author: user('B', true), channelId: 'C', content: 'x' }); await r.lg.onDelete({ guild: null, author: user('U'), content: 'dm' }); assert.equal(r.posts.length, 2);
  await r.lg.onEdit({ content: 'old' }, { guild: {}, author: user('U'), channelId: 'C', content: 'new', url: 'http://x' });
  assert.deepEqual(r.posts[2].fields.map((f) => f.value), ['old', 'new']);
  await r.lg.onEdit({ content: 'same' }, { guild: {}, author: user('U'), content: 'same' }); await r.lg.onEdit({ content: null }, { guild: {}, author: user('U'), content: 'x' }); assert.equal(r.posts.length, 3, 'link previews and uncached edits are skipped');
});

test('joins, leaves, nicknames, role changes and voice moves', async () => {
  const r = rig();
  await r.lg.onJoin({ user: user('U') }); assert.match(r.posts[0].description, /Account made 3 d ago/);
  await r.lg.onLeave({ user: user('U'), joinedTimestamp: 1e12 - 2 * 3600000 }); assert.match(r.posts[1].description, /Was here for 120 min/);
  await r.lg.onMemberUpdate({ user: user('U'), nickname: null, roles: roles('1', '2') }, { user: user('U'), nickname: 'Sam', roles: roles('2', '3') });
  assert.equal(r.posts[2].title, 'Nickname changed'); assert.match(r.posts[2].description, /\(none\) → Sam/); assert.match(r.posts[3].description, /\+ <@&3>\n− <@&1>/);
  await r.lg.onVoice({ channelId: null }, { channelId: 'V1', member: { user: user('U') } }); await r.lg.onVoice({ channelId: 'V1', member: { user: user('U') } }, { channelId: 'V2', member: { user: user('U') } });
  await r.lg.onVoice({ channelId: 'V2', member: { user: user('U') } }, { channelId: null, member: { user: user('U') } }); await r.lg.onVoice({ channelId: 'V2', member: { user: user('U') } }, { channelId: 'V2', member: { user: user('U') } });
  assert.deepEqual(r.posts.slice(4).map((p) => p.description.replace(/^.*\) /, '')), ['joined <#V1>', 'moved <#V1> → <#V2>', 'left <#V2>'], 'mute changes are not moves');
  await r.lg.onJoin({ user: user('B', true) }); await r.lg.onMemberUpdate({ user: user('B', true), nickname: 'a', roles: roles() }, { user: user('B', true), nickname: 'b', roles: roles() }); assert.equal(r.posts.length, 7);
});

test('each group can be switched off, the whole log can be off, and a missing channel is harmless', async () => {
  const r = rig({ voice: false, roles: false }); await r.lg.onVoice({ channelId: null }, { channelId: 'V', member: { user: user('U') } });
  await r.lg.onMemberUpdate({ user: user('U'), nickname: 'a', roles: roles('1') }, { user: user('U'), nickname: 'a', roles: roles('2') }); assert.equal(r.posts.length, 0);
  const off = rig({ on: false }); await off.lg.onJoin({ user: user('U') }); assert.equal(off.posts.length, 0);
  const none = rig({}, { channels: {} }); await none.lg.onJoin({ user: user('U') }); const gone = rig({}, { channels: { auditLog: 'GONE' } }); await gone.lg.onJoin({ user: user('U') }); assert.equal(gone.posts.length, 0);
});

test('a log line never pings, even for text full of mentions', async () => {
  const sent = []; const lg = createLogging({ config: { get: () => ({ channels: { auditLog: 'A' }, logging: { on: true, messages: true } }) }, log() {}, fetchChannel: async () => ({ send: async (m) => sent.push(m) }) });
  await lg.onDelete({ guild: {}, author: user('U'), channelId: 'C', content: '@everyone <@&99>' }); assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});
