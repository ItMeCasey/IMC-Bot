'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const createViewer = require('../src/modules/viewer');

const INFO = { commands: { custom: [['!discord', 'Everyone', 'Join our Discord']], groups: { Games: [['!duel <name>', 'Everyone', 'Challenge']], 'Mods only': [['!ban', 'Mods', 'Ban']] } },
  top: [{ name: 'Sam', pts: 1200 }, { name: 'Pat', pts: 800 }], games: [{ name: 'Duel', how: '!duel <name>' }], tts: { command: true, prefix: '?', sfx: ['airhorn', 'ding'] } };
const LIVE = { live: true, title: 'Tetris night', game: 'Tetris', login: 'itmecasey', website: 'https://site.example' };

test('each answer uses the stream app\'s lists and leaves out the mod commands', () => {
  const a = createViewer.answer, d = (n, s, i) => a(n, s || LIVE, i || INFO).embeds[0].description;
  assert.match(d('commands'), /`!discord` Join our Discord\n`!duel <name>` Challenge/); assert.doesNotMatch(d('commands'), /!ban/); assert.match(d('commands'), /site\.example\/commands\.html$/);
  assert.match(d('games'), /\*\*Duel\*\*: `!duel <name>`/); assert.equal(d('games', LIVE, {}), 'No games are on right now.\n\nHow they work: https://site.example/games.html');
  assert.match(d('tts'), /type `\?tts your message`[\s\S]*`\[airhorn\]` `\[ding\]`/); assert.doesNotMatch(d('tts', LIVE, { tts: { command: false, sfx: [] } }), /tts your message/);
  assert.equal(d('top'), '1. **Sam** 1200\n2. **Pat** 800'); assert.equal(d('top', LIVE, {}), 'Nobody has points yet.');
  const live = a('live', LIVE, {}).embeds[0]; assert.deepEqual([live.title, live.description], ['The stream is live!', 'Tetris night\n**Playing:** Tetris\nhttps://twitch.tv/itmecasey']);
  const off = a('live', { live: false, login: 'itmecasey' }, {}).embeds[0]; assert.deepEqual([off.title, off.description], ['The stream is offline', 'Follow to get notified: https://twitch.tv/itmecasey']);
  assert.equal(a('website', LIVE, {}).content, 'https://site.example'); assert.match(a('website', {}, {}).content, /not published/);
});

test('the seven commands are registered, public, and say so plainly when the stream app is not reachable', async () => {
  const cmds = new Map(); let down = false;
  createViewer({ discord: { register: (c) => cmds.set(c.data.name, c) }, bridge: { snapshot: async () => { if (down) throw new Error('x'); return LIVE; }, info: async () => INFO } });
  assert.deepEqual([...cmds.keys()], ['commands', 'games', 'tts', 'top', 'live', 'website', 'schedule']);
  assert.equal(cmds.get('top').data.toJSON().default_member_permissions, undefined, 'everybody can use them');
  const run = async (n) => { const out = []; await cmds.get(n).run({ deferReply: async () => {}, editReply: async (m) => out.push(m) }); return out[0]; };
  const ok = await run('top'); assert.match(ok.embeds[0].description, /Sam/); assert.deepEqual(ok.allowedMentions, { parse: [] });
  down = true; assert.match((await run('top')).content, /cannot reach the stream app/); assert.match((await run('live')).content, /cannot reach/);
});

test('/schedule lists the next streams with Discord times, strikes out canceled ones, and says so when there are none', () => {
  const a = createViewer.answer, t = Date.UTC(2026, 9, 30, 20, 0, 0), sec = t / 1000;
  const d = a('schedule', LIVE, { segments: [{ start: new Date(t).toISOString(), title: 'Tetris night', category: 'Tetris', canceled: false }, { start: new Date(t + 86400000).toISOString(), title: 'Chill', category: '', canceled: true }] }).embeds[0].description;
  assert.equal(d, '<t:' + sec + ':F> (<t:' + sec + ':R>) **Tetris night** (Tetris)\n~~<t:' + (sec + 86400) + ':F> (<t:' + (sec + 86400) + ':R>) **Chill**~~ canceled');
  assert.equal(a('schedule', LIVE, { segments: [] }).embeds[0].description, 'No streams are scheduled right now.\nhttps://twitch.tv/itmecasey');
});
