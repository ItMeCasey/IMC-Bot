'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageType } = require('discord.js');
const createStreamAlerts = require('../src/modules/streamalerts');
const createFake = require('../tools/fake-stream');
const createLocalBridge = require('../src/bridge/local');

function rig(over, cfgOver) {
  let t = 1e12; const sent = [], kv = new Map(); let down = false;
  const cfg = Object.assign({ streamAlerts: Object.assign({ on: true, boosts: true, joins: false, milestones: true, milestoneEvery: 100 }, over) }, cfgOver);
  const sa = createStreamAlerts({ config: { get: () => cfg }, log() {}, now: () => t, kv: { get: (k) => kv.get(k) || '', set: (k, v) => kv.set(k, v) },
    bridge: { alert: async (event, vars) => { if (down) throw new Error('IMC-Stream is not running'); sent.push([event, vars]); return { ok: true, shown: true }; } } });
  const guild = { premiumSubscriptionCount: 7, premiumTier: 2, memberCount: 99 };
  const member = (id, name, o) => Object.assign({ id, displayName: name, user: { id, bot: false, username: name }, guild }, o);
  return { sa, sent, cfg, guild, member, tick: (ms) => { t += ms; }, down: (v) => { down = v; } };
}

test('a boost message from Discord becomes a stream alert with the booster, the boost count and the server level', async () => {
  const r = rig(); const m = r.member('U1', 'Sam');
  assert.equal(await r.sa.onMessage({ guild: r.guild, system: true, type: MessageType.GuildBoostTier2, member: m, author: m.user }), true);
  assert.deepEqual(r.sent, [['discord_boost', { name: 'Sam', boosts: 7, level: 2 }]]);
  for (const t of [MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier3]) { r.tick(60000); assert.equal(await r.sa.onMessage({ guild: r.guild, system: true, type: t, member: m }), true, String(t)); }
  assert.equal(await r.sa.onMessage({ guild: r.guild, system: false, type: MessageType.Default, member: m }), false, 'an ordinary message is not a boost'); assert.equal(await r.sa.onMessage({ guild: r.guild, system: true, type: MessageType.UserJoin, member: m }), false, 'nor is a join message');
  assert.equal(await r.sa.onMessage({ guild: null, system: true, type: MessageType.GuildBoost, member: m }), false);
});

test('the badge change and the message for one boost give one alert; a later boost by the same person does too', async () => {
  const r = rig(); const m = r.member('U1', 'Sam');
  assert.equal(await r.sa.onMemberUpdate({ premiumSince: null }, Object.assign(m, { premiumSince: new Date() })), true);
  assert.equal(await r.sa.onMessage({ guild: r.guild, system: true, type: MessageType.GuildBoost, member: m }), false, 'the same boost seen twice'); assert.equal(r.sent.length, 1);
  r.tick(40000); assert.equal(await r.sa.onMessage({ guild: r.guild, system: true, type: MessageType.GuildBoost, member: m }), true, 'a second boost later is a new alert'); assert.equal(r.sent.length, 2);
  assert.equal(await r.sa.onMemberUpdate({ premiumSince: new Date() }, { premiumSince: new Date(), guild: r.guild }), false, 'an already boosting member changing a nickname is not a boost');
  assert.equal(await r.sa.onMemberUpdate({ premiumSince: new Date() }, { premiumSince: null, guild: r.guild }), false, 'ending a boost is not an alert');
});

test('joins and member milestones: each can be switched off, a milestone is sent once, bots are ignored', async () => {
  const r = rig({ joins: true }); r.guild.memberCount = 50; await r.sa.onJoin(r.member('U2', 'Pat')); assert.deepEqual(r.sent, [['discord_join', { name: 'Pat' }]]);
  r.guild.memberCount = 100; await r.sa.onJoin(r.member('U3', 'Kim')); assert.deepEqual(r.sent.slice(1), [['discord_join', { name: 'Kim' }], ['discord_milestone', { members: 100 }]]);
  await r.sa.onJoin(r.member('U4', 'Lee')); assert.equal(r.sent.filter((x) => x[0] === 'discord_milestone').length, 1, 'the same count is not announced twice (someone left and another joined)');
  r.guild.memberCount = 200; const bot = r.member('B', 'Bot'); bot.user.bot = true; await r.sa.onJoin(bot); assert.equal(r.sent.length, 4, 'a bot joining sends nothing (Pat, Kim, the milestone and Lee were the four)');
  const quiet = rig({ joins: false, milestones: false }); quiet.guild.memberCount = 100; await quiet.sa.onJoin(quiet.member('U5', 'Zed')); assert.equal(quiet.sent.length, 0);
  const off = rig({ on: false }); await off.sa.boost(off.member('U1', 'Sam'), off.guild); off.guild.memberCount = 100; await off.sa.onJoin(off.member('U6', 'Y')); assert.equal(off.sent.length, 0, 'everything is off when the switch is off');
  const noBoost = rig({ boosts: false }); assert.equal(await noBoost.sa.boost(noBoost.member('U1', 'Sam'), noBoost.guild), false);
});

test('when IMC-Stream is not running nothing breaks: the alert is simply not shown', async () => {
  const r = rig(); r.down(true); assert.equal(await r.sa.boost(r.member('U1', 'Sam'), r.guild), true); assert.equal(r.sent.length, 0);
  r.guild.memberCount = 100; await r.sa.onJoin(r.member('U2', 'Pat'));
});

test('names are cut to a sane length and have a fallback', async () => {
  const r = rig(); await r.sa.boost({ id: 'U9', user: { id: 'U9' } }, r.guild); await r.sa.boost({ id: 'U10', displayName: 'x'.repeat(200), user: { id: 'U10' } }, r.guild);
  assert.equal(r.sent[0][1].name, 'Someone'); assert.equal(r.sent[1][1].name.length, 60);
});

test('against the fake IMC-Stream over HTTP: the bot sends a boost and the fake receives it; a refused event is an error', async () => {
  const fake = createFake(), port = await fake.listen(0), kv = new Map();
  const config = { get: () => ({ bridge: { url: 'http://127.0.0.1:' + port }, streamAlerts: { on: true, boosts: true, joins: true, milestones: true, milestoneEvery: 100 } }), secret: () => '' };
  const bridge = createLocalBridge({ config, kv: { get: (k) => kv.get(k) || '', set: (k, v) => kv.set(k, v) }, log() {} });
  const sa = createStreamAlerts({ config, log() {}, kv: { get: (k) => kv.get(k) || '', set: (k, v) => kv.set(k, v) }, bridge });
  try {
    const m = { id: 'U1', displayName: 'Sam', user: { id: 'U1' } }; await sa.boost(m, { premiumSubscriptionCount: 3, premiumTier: 1 });
    const got = await fetch('http://127.0.0.1:' + port + '/fake/alerts').then((r) => r.json()); assert.deepEqual(got, [{ event: 'discord_boost', vars: { name: 'Sam', boosts: 3, level: 1 } }]);
    assert.deepEqual(await bridge.alert('discord_join', { name: 'Pat' }), { ok: true, shown: true });
    await assert.rejects(bridge.alert('follow', { name: 'Fake' }), /Unknown Discord event/);
  } finally { await fake.close(); }
});
