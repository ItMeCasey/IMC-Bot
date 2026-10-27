'use strict';
/**
 * Writes docs/COMMANDS.md from the slash commands the bot really registers (names, descriptions, options and who may use them),
 * so the reference can never drift from the code. Run:  node tools/gen-commands-doc.js
 * test/docs.test.js runs build() and fails when the file in docs/ is out of date.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionsBitField } = require('discord.js');

const OPTION_TYPE = { 3: 'text', 4: 'whole number', 5: 'yes/no', 6: 'person', 7: 'channel', 8: 'role', 10: 'number', 11: 'file' };
// which part of the bot a command belongs to (only for the headings)
const GROUPS = [
  ['Moderation', ['warn', 'timeout', 'untimeout', 'kick', 'ban', 'unban', 'unwarn', 'note', 'case', 'history', 'purge', 'slowmode', 'lock', 'unlock']],
  ['Regulars', ['progress', 'regular']],
  ['Community', ['giveaway', 'poll', 'suggest', 'suggestion', 'rank', 'leaderboard', 'xp']],
  ['Panels with buttons', ['rolepanel', 'ticketpanel', 'verifypanel']],
  ['Stream information', ['commands', 'games', 'tts', 'top', 'live', 'website', 'schedule']],
  ['Other', ['ping']],
];

const who = (c) => (c.default_member_permissions ? 'People with **' + new PermissionsBitField(BigInt(c.default_member_permissions)).toArray().join(', ') + '**' : 'Everyone');
const optLine = (o) => '`' + o.name + '` (' + (OPTION_TYPE[o.type] || 'value') + (o.required ? ', required' : ', optional') + '): ' + o.description;

/** the whole document, as text, for the commands the running bot has registered */
async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imc-bot-docs-'));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 0 }));
  process.env.IMC_BOT_DATA = dir;
  const app = await require('../src/index').main();
  let list;
  try { list = app.ctx.discord.commandList(); } finally { await app.quit(); }
  const byName = new Map(list.map((c) => [c.name, c])), seen = new Set(), out = [];
  out.push('# Slash commands', '', 'Generated from the code by `node tools/gen-commands-doc.js`; do not edit by hand.',
    'Discord decides who sees each command from its default permission. A server owner can change that in **Server Settings, Integrations, IMC-Bot**.', '');
  for (const [title, names] of GROUPS) {
    const cmds = names.map((n) => byName.get(n)).filter(Boolean); if (!cmds.length) continue;
    out.push('## ' + title, '');
    for (const c of cmds) {
      seen.add(c.name);
      out.push('### `/' + c.name + '`', '', c.description + '  ', 'Who: ' + who(c) + '.', '');
      const subs = (c.options || []).filter((o) => o.type === 1);
      if (subs.length) for (const s of subs) { out.push('- `/' + c.name + ' ' + s.name + '`: ' + s.description); for (const o of s.options || []) out.push('  - ' + optLine(o)); }
      else for (const o of c.options || []) out.push('- ' + optLine(o));
      out.push('');
    }
  }
  const missing = list.filter((c) => !seen.has(c.name)).map((c) => c.name);
  if (missing.length) throw new Error('Commands missing from a group in tools/gen-commands-doc.js: ' + missing.join(', '));
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
module.exports = { build };

if (require.main === module) build().then((t) => { fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '..', 'docs', 'COMMANDS.md'), t); console.log('docs/COMMANDS.md written (' + t.split('\n').length + ' lines)'); process.exit(0); }).catch((e) => { console.error(e.message); process.exit(1); });
