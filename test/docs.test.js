'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('../tools/gen-commands-doc');

const ROOT = path.join(__dirname, '..');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

test('every source file starts with a comment that says what it does', () => {
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'tools')), path.join(ROOT, 'desktop', 'main.js')];
  assert.ok(files.length > 25, 'found the source files');
  for (const f of files) {
    const head = fs.readFileSync(f, 'utf8').slice(0, 3000);   // the comment may run over several lines
    assert.match(head, /^'use strict';\s*\n\/\*\*[\s\S]*?\*\//, path.relative(ROOT, f) + ' needs a /** ... */ comment right after use strict');
    const text = head.match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/[\s*]+/g, ' ').trim();
    assert.ok(text.length >= 25, path.relative(ROOT, f) + ': the header comment is too short to explain anything');
  }
});

test('docs/COMMANDS.md matches the commands the bot registers (run: node tools/gen-commands-doc.js)', async () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'docs', 'COMMANDS.md'), 'utf8').replace(/\r\n/g, '\n'), await build());
});

test('the other documents exist and the README links to them', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const d of ['ARCHITECTURE.md', 'BRIDGE.md', 'COMMANDS.md', 'SECURITY.md']) { assert.ok(fs.existsSync(path.join(ROOT, 'docs', d)), d + ' exists'); assert.match(readme, new RegExp('docs/' + d.replace('.', '\.')), 'README links to ' + d); }
});
