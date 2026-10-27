'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: F } = require('discord.js');
const createAutomod = require('../src/modules/automod');

const DEF = () => ({ on: true, warn: true, spam: { on: true, count: 5, seconds: 6 }, duplicate: { on: true, count: 3, seconds: 30 }, mentions: { on: true, max: 5 }, invites: { on: true },
  links: { on: false, allow: ['twitch.tv', 'youtube.com'] }, caps: { on: true, minLength: 15, percent: 70 }, emoji: { on: true, max: 10 }, words: { on: false, list: [] },
  raid: { on: true, joins: 3, seconds: 30 }, accountAge: { on: false, days: 3 } });

function rig(over, cfgOver) {
  let t = 1e12; const posts = [], performed = [], ladders = [], cfg = Object.assign({ channels: { modLog: 'L' }, dryRun: false, automod: Object.assign(DEF(), over) }, cfgOver);
  const am = createAutomod({ config: { get: () => cfg }, log() {}, now: () => t, botId: () => 'BOT', fetchChannel: async (id) => (id === 'L' ? { send: async (m) => posts.push(m) } : null),
    moderation: { perform: async (g, f) => { performed.push(f); }, ladder: async (g, u) => { ladders.push(u.id); } } });
  const msg = (content, o) => { o = o || {}; const sent = [], m = { guild: { id: 'G' }, author: { id: o.id || 'U', bot: !!o.bot }, member: { permissions: { has: (p) => (o.perms || []).includes(p) } }, content, channelId: 'C', webhookId: o.webhook, system: false,
    mentions: { users: { size: o.mentions || 0 }, roles: { size: 0 }, everyone: false }, deleted: 0, sent, delete: async () => { m.deleted++; }, channel: { send: async (x) => { sent.push(x); return { delete: async () => {} }; } } }; return m; };
  return { am, cfg, posts, performed, ladders, msg, tick: (ms) => { t += ms; }, at: () => t };
}
const verdict = (r, text, o) => r.am.evaluate({ userId: (o && o.id) || 'U', content: text, mentionCount: (o && o.mentions) || 0 }, r.cfg.automod);

test('each rule catches what it should and leaves normal chat alone', () => {
  const r = rig();
  r.cfg.automod.spam.on = false; r.cfg.automod.duplicate.on = false;   // these get their own test; here all messages arrive at the same instant
  for (const ok of ['hello everyone', 'GG', 'Check out twitch.tv/itmecasey', 'I really love THIS game so much', 'lol 😀😀']) assert.equal(verdict(r, ok), null, ok);
  assert.equal(verdict(r, 'join discord.gg/abc123').rule, 'invites'); assert.equal(verdict(r, 'https://discord.com/invite/xyz').rule, 'invites');
  assert.equal(verdict(r, 'hi', { mentions: 6 }).rule, 'mentions'); assert.equal(verdict(r, 'hi', { mentions: 5 }), null, 'at the limit is fine');
  assert.equal(verdict(r, 'THIS IS COMPLETELY OUT OF CONTROL').rule, 'caps'); assert.equal(verdict(r, 'OMG WOW'), null, 'short shouting is fine');
  assert.equal(verdict(r, '😀'.repeat(11)).rule, 'emoji'); assert.equal(verdict(r, '<:a:123456789012345678>'.repeat(11)).rule, 'emoji');
  r.cfg.automod.links.on = true;
  assert.equal(verdict(r, 'see https://evil.example.com/x').rule, 'links'); assert.equal(verdict(r, 'see https://clips.twitch.tv/abc'), null, 'subdomains of an allowed site are fine');
  assert.equal(verdict(r, 'https://nottwitch.tv').rule, 'links', 'ends-with must be a real subdomain'); assert.equal(verdict(r, 'www.evil.org').rule, 'links');
  assert.equal(verdict(r, 'http://twitch.tv.evil.com').rule, 'links', 'a lookalike address is not allowed');
  r.cfg.automod.words.on = true; r.cfg.automod.words.list = ['badword', 'c++'];
  assert.equal(verdict(r, 'you BadWord!').rule, 'words'); assert.equal(verdict(r, 'badwords are fine here'), null, 'whole words only'); assert.equal(verdict(r, 'I like c++ a lot').rule, 'words', 'odd characters in a word are safe');
});

test('spam and repeats are counted per person within the window, and start over after a hit', () => {
  const r = rig();
  for (let n = 0; n < 4; n++) { assert.equal(verdict(r, 'msg ' + n), null); r.tick(500); }
  assert.equal(verdict(r, 'msg 5').rule, 'spam', '5 messages in 6 seconds'); assert.equal(verdict(r, 'msg 6'), null, 'the count starts over');
  const slow = rig(); for (let n = 0; n < 8; n++) { assert.equal(verdict(slow, 'slow ' + n), null); slow.tick(3000); }
  const other = rig(); for (let n = 0; n < 4; n++) { verdict(other, 'a' + n, { id: 'A' }); other.tick(100); } assert.equal(verdict(other, 'b', { id: 'B' }), null, 'another person is counted separately');
  const dup = rig(); assert.equal(verdict(dup, 'buy now'), null); dup.tick(2000); assert.equal(verdict(dup, 'BUY   now'), null); dup.tick(2000); assert.equal(verdict(dup, 'buy now').rule, 'duplicate', 'case and spacing do not hide a repeat');
  const dup2 = rig(); verdict(dup2, 'same'); dup2.tick(20000); verdict(dup2, 'same'); dup2.tick(20000); assert.equal(verdict(dup2, 'same'), null, 'repeats spread out over time are fine');
});

test('a hit removes the message, tells the person, warns from the bot and runs the ladder', async () => {
  const r = rig(), m = r.msg('join discord.gg/abc123');
  await r.am.onMessage(m);
  assert.equal(m.deleted, 1); assert.match(m.sent[0].content, /^<@U> your message was removed: invite links/); assert.deepEqual(m.sent[0].allowedMentions, { users: ['U'] });
  assert.equal(r.performed.length, 1); const f = r.performed[0]; assert.deepEqual([f.type, f.source, f.mod, f.user.id], ['warn', 'automod', 'BOT', 'U']); assert.match(f.reason, /AutoMod \(invites\): join discord\.gg/);
  assert.deepEqual(r.ladders, ['U']);
  const nowarn = rig({ warn: false }), m2 = nowarn.msg('discord.gg/zzz'); await nowarn.am.onMessage(m2);
  assert.equal(m2.deleted, 1); assert.equal(nowarn.performed.length, 0); assert.match(nowarn.posts[0].embeds[0].title, /AutoMod removed a message \(invites\)/);
});

test('dry run only reports; mods, bots, webhooks and a switched-off AutoMod are never touched', async () => {
  const dry = rig({}, { dryRun: true }), m = dry.msg('discord.gg/abc123'); await dry.am.onMessage(m);
  assert.equal(m.deleted, 0); assert.equal(m.sent.length, 0); assert.equal(dry.performed.length, 0); assert.match(dry.posts[0].embeds[0].title, /Dry run: AutoMod would remove a message \(invites\)/);
  const r = rig();
  for (const [name, mm] of [['mod', r.msg('discord.gg/x', { perms: [F.ManageMessages] })], ['timeout mod', r.msg('discord.gg/x', { perms: [F.ModerateMembers] })], ['admin', r.msg('discord.gg/x', { perms: [F.Administrator] })], ['bot', r.msg('discord.gg/x', { bot: true })], ['webhook', r.msg('discord.gg/x', { webhook: 'W' })]]) { await r.am.onMessage(mm); assert.equal(mm.deleted, 0, name); }
  const off = rig({ on: false }), mo = off.msg('discord.gg/x'); await off.am.onMessage(mo); assert.equal(mo.deleted, 0);
  const dm = r.msg('discord.gg/x'); dm.guild = null; await r.am.onMessage(dm); assert.equal(dm.deleted, 0, 'direct messages are ignored');
  assert.equal(r.performed.length, 0);
});

test('a failing warn still leaves a trace in #mod-log', async () => {
  const r = rig(); r.am = createAutomod({ config: { get: () => r.cfg }, log() {}, botId: () => 'BOT', fetchChannel: async () => ({ send: async (m) => r.posts.push(m) }), moderation: { perform: async () => { throw new Error('boom'); }, ladder: async () => {} } });
  const m = r.msg('discord.gg/x'); await r.am.onMessage(m); assert.equal(m.deleted, 1); assert.match(r.posts[0].embeds[0].title, /AutoMod removed a message/);
});

const joiner = (id, ageDays, now) => { const log = { sent: [] }; return Object.assign(log, { id, guild: { id: 'G', name: 'S' }, user: { id, bot: false, createdTimestamp: now - ageDays * 86400000, send: async () => {} } }); };

test('a wave of joins raises one alert; young accounts are kicked only when asked and not in a dry run', async () => {
  const r = rig();
  await r.am.onJoin(joiner('1', 400, r.at())); await r.am.onJoin(joiner('2', 400, r.at())); assert.equal(r.posts.length, 0);
  await r.am.onJoin(joiner('3', 400, r.at())); assert.match(r.posts[0].embeds[0].title, /Possible raid: 3 joins in 30 s/);
  await r.am.onJoin(joiner('4', 400, r.at())); assert.equal(r.posts.length, 1, 'one alert, not one per join');
  const slow = rig(); for (const id of ['1', '2', '3', '4']) { await slow.am.onJoin(joiner(id, 400, slow.at())); slow.tick(20000); } assert.equal(slow.posts.length, 0, 'a steady trickle is normal');
  const age = rig({ accountAge: { on: true, days: 3 } }); await age.am.onJoin(joiner('9', 1, age.at())); assert.deepEqual([age.performed[0].type, age.performed[0].source], ['kick', 'automod']); assert.match(age.performed[0].reason, /1\.0 days old/);
  await age.am.onJoin(joiner('8', 10, age.at())); assert.equal(age.performed.length, 1, 'older accounts are welcome');
  const off = rig(); await off.am.onJoin(joiner('9', 1, off.at())); assert.equal(off.performed.length, 0, 'off by default');
  const dry = rig({ accountAge: { on: true, days: 3 } }, { dryRun: true }); await dry.am.onJoin(joiner('9', 1, dry.at())); assert.equal(dry.performed.length, 0); assert.match(dry.posts[0].embeds[0].title, /Dry run/);
});

test('chat in an exempt channel is left alone, other channels are not', async () => {
  const r = rig({ exemptChannels: ['C-FREE'] }), free = r.msg('join discord.gg/abc123'); free.channelId = 'C-FREE'; await r.am.onMessage(free); assert.equal(free.deleted, 0);
  const other = r.msg('join discord.gg/abc123'); await r.am.onMessage(other); assert.equal(other.deleted, 1);
});

test('addresses without https:// are caught by the links rule, and the allowed-sites list still applies to them', () => {
  const r = rig(); r.cfg.automod.spam.on = false; r.cfg.automod.duplicate.on = false; r.cfg.automod.links.on = true;
  assert.equal(verdict(r, 'free stuff at evil.gg/x').rule, 'links'); assert.equal(verdict(r, 'EVIL.com').rule, 'links'); assert.equal(verdict(r, 'evil.me/free').rule, 'links');
  assert.equal(verdict(r, 'see twitch.tv/itmecasey and clips.twitch.tv/abc'), null, 'allowed sites, with or without https://'); assert.equal(verdict(r, 'node.js is fine, so is done.in'), null);
});

test('editing a clean message into a rule break is caught, and an edit is not counted as spam', async () => {
  const r = rig(); const m = r.msg('hello there');
  await r.am.onMessage(m); assert.equal(m.deleted, 0);
  m.content = 'join discord.gg/abc123'; await r.am.onMessage(m, true); assert.equal(m.deleted, 1, 'the edited text is checked again'); assert.equal(r.performed.length, 1);
  const s = rig({ spam: { on: true, count: 2, seconds: 6 } }); const a = s.msg('first'); await s.am.onMessage(a); const b = s.msg('second but edited'); await s.am.onMessage(b, true); assert.equal(b.deleted, 0, 'the speed rules are not applied to an edit');
});

test('the per-person message history stays bounded however many different people write', () => {
  const r = rig(); r.cfg.automod.spam.on = false; r.cfg.automod.duplicate.on = false;
  for (let n = 0; n < 6000; n++) r.am.evaluate({ userId: 'U' + n, content: 'hi', mentionCount: 0 }, r.cfg.automod);
  assert.ok(r.am._recent.size <= 5000, 'kept ' + r.am._recent.size);
});
