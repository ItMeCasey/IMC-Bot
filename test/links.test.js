'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hosts } = require('../src/links');

test('addresses are found with or without https://, and ordinary text is left alone', () => {
  const cases = [
    ['see https://Sub.Evil.COM:8080/p?q=1 now', ['sub.evil.com']], ['www.evil.org', ['evil.org']], ['EVIL.GG is great', ['evil.gg']], ['twitch.tv/itmecasey', ['twitch.tv']], ['(evil.net)', ['evil.net']], ['visit example.com.', ['example.com']],
    ['evil.me/free', ['evil.me']], ['sub.domain.co.uk/x', ['sub.domain.co.uk']], ['a https://one.com and two.org/x', ['one.com', 'two.org']],
    ['evil.me', []], ['done.in the end', []], ['check.it out', []], ['hello.World no', []], ['e.g. this and i.e. that', []], ['node.js and file.zip', []], ['price is 3.99 usd', []], ['mail a@b.com please', []], ['', []], [null, []],
  ];
  for (const [text, want] of cases) assert.deepEqual(hosts(text), want, JSON.stringify(text));
});

test('long or odd input is handled quickly (no runaway matching)', () => {
  const t = Date.now(); for (const s of ['a.'.repeat(20000) + 'x', 'a'.repeat(200000), 'a-'.repeat(50000) + '.com', '.'.repeat(100000), 'http://'.repeat(20000), ('x.' + 'y'.repeat(70) + '.').repeat(2000)]) hosts(s);
  assert.ok(Date.now() - t < 1500, 'took ' + (Date.now() - t) + ' ms');
});
