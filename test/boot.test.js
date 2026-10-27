'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('the whole bot starts without a token: every module is wired and the dashboard answers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-bot-boot-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 0 }));
  process.env.IMC_BOT_DATA = dir;
  const { main } = require('../src/index');
  const app = await main();
  try {
    for (const k of ['basic', 'moderation', 'automod', 'bridge', 'golive', 'mirror', 'logging', 'selfroles', 'viewer', 'giveaway', 'tickets', 'regulars', 'announce']) assert.ok(app.late[k], k + ' is created');
    const r = await fetch('http://127.0.0.1:' + app.port + '/api/status'); const j = await r.json();
    assert.equal(j.bot.state, 'offline'); assert.equal(j.settings.hasToken, false); assert.ok(j.settings.automod && j.settings.mirror && j.settings.logging && j.settings.moderation);
    const names = [...app.ctx.discord ? ['ping', 'warn', 'ban', 'rolepanel'] : []];
    assert.ok(app.ctx.discord.registerButton && names.length, 'commands register');
  } finally { await app.quit(); }
});

test('every slash command is valid for Discord: required options first, names and descriptions in range, no more than 25 options', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-bot-boot-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 0 }));
  process.env.IMC_BOT_DATA = dir;
  const app = await require('../src/index').main();
  try {
    const list = app.ctx.discord.commandList(); assert.ok(list.length >= 16, 'all commands are registered: ' + list.length);
    const names = new Set();
    for (const c of list) {
      assert.ok(!names.has(c.name), 'duplicate command ' + c.name); names.add(c.name);
      assert.match(c.name, /^[a-z0-9_-]{1,32}$/); assert.ok(c.description.length >= 1 && c.description.length <= 100, c.name + ' description');
      const o = c.options || []; assert.ok(o.length <= 25, c.name + ' options');
      let optional = false; for (const x of o) { assert.match(x.name, /^[a-z0-9_-]{1,32}$/, c.name + '.' + x.name); assert.ok(x.description.length >= 1 && x.description.length <= 100, c.name + '.' + x.name + ' description'); if (!x.required) optional = true; else assert.ok(!optional, c.name + ': required option "' + x.name + '" comes after an optional one'); }
    }
  } finally { await app.quit(); }
});
