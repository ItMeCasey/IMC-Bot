'use strict';
/**
 * Polls: /poll asks a question with 2 to 5 answers as buttons. One vote each, changeable until the time is up.
 * When time is up (or a mod ends it) the message shows the result as bars. Everything is in the database, so a restart loses nothing.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { parseDuration } = require('./cases');
const { requirePerm } = require('../perms');

const EPHEMERAL = MessageFlags.Ephemeral, MIN_MS = 30000, MAX_MS = 7 * 86400000, TICK_MS = 15000;
const unix = (ms) => Math.floor(ms / 1000);
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

module.exports = function createPolls(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db;
  const q = {
    ins: db.prepare('INSERT INTO polls (guild_id, channel_id, question, options, host, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    msg: db.prepare('UPDATE polls SET message_id = ? WHERE id = ?'), get: db.prepare('SELECT * FROM polls WHERE id = ?'),
    due: db.prepare("SELECT * FROM polls WHERE status = 'open' AND ends_at <= ?"), status: db.prepare('UPDATE polls SET status = ? WHERE id = ? AND status = ?'),
    vote: db.prepare('INSERT INTO poll_votes (poll_id, user_id, choice) VALUES (?, ?, ?) ON CONFLICT(poll_id, user_id) DO UPDATE SET choice = excluded.choice'),
    tally: db.prepare('SELECT choice, COUNT(*) AS n FROM poll_votes WHERE poll_id = ? GROUP BY choice'),
  };
  const opts = (p) => JSON.parse(p.options);
  const tally = (p) => { const t = opts(p).map(() => 0); for (const r of q.tally.all(p.id)) if (t[r.choice] !== undefined) t[r.choice] = r.n; return t; };
  const bar = (n, total) => '█'.repeat(total ? Math.round(n * 10 / total) : 0) + '░'.repeat(10 - (total ? Math.round(n * 10 / total) : 0));
  function card(p, final) {
    const o = opts(p), t = tally(p), total = t.reduce((a, b) => a + b, 0), top = Math.max(...t);
    const lines = o.map((x, i) => (final && total && t[i] === top ? '🏆 ' : '') + '**' + cut(x, 80) + '**\n' + bar(t[i], total) + ' ' + t[i] + (total ? ' (' + Math.round(t[i] * 100 / total) + '%)' : ''));
    return embed('📊 ' + cut(p.question, 250) + (final ? ' (ended)' : ''), lines.join('\n\n') + '\n\n' + (final ? 'Total votes: ' + total : 'Ends <t:' + unix(p.ends_at) + ':R>. Press a button to vote (you can change your vote). Votes so far: ' + total), final ? COLOR.cream : COLOR.aqua);
  }
  const rows = (p, off) => [new ActionRowBuilder().addComponents(opts(p).map((x, i) => new ButtonBuilder().setCustomId('poll:' + p.id + ':' + i).setLabel(cut(x, 80)).setStyle(ButtonStyle.Primary).setDisabled(!!off)))];
  async function edit(p, final) { const ch = await ctx.fetchChannel(p.channel_id); if (ch && p.message_id) await ch.messages.edit(p.message_id, { embeds: [card(p, final)], components: rows(p, final), allowedMentions: { parse: [] } }).catch((e) => log('poll edit failed:', e.message)); }
  async function finish(p) { if (q.status.run('ended', p.id, 'open').changes === 0) return false; await edit(p, true); return true; }
  async function tick() { for (const p of q.due.all(now())) await finish(p).catch((e) => log('poll', p.id, 'failed:', e.message)); }
  let timer = null;
  const start = () => { if (!timer) { timer = setInterval(() => tick().catch(() => {}), TICK_MS); if (timer.unref) timer.unref(); tick().catch(() => {}); } };
  const stop = () => { clearInterval(timer); timer = null; };

  const b = new SlashCommandBuilder().setName('poll').setDescription('Ask a question with buttons as answers').setDMPermission(false).setDefaultMemberPermissions(F.ManageMessages)
    .addSubcommand((s) => s.setName('start').setDescription('Start a poll in this channel')
      .addStringOption((o) => o.setName('question').setDescription('The question').setRequired(true).setMaxLength(250))
      .addStringOption((o) => o.setName('answers').setDescription('2 to 5 answers, separated by | (for example: Yes | No | Maybe)').setRequired(true).setMaxLength(400))
      .addStringOption((o) => o.setName('duration').setDescription('Like 10m, 2h, 1d (30 seconds up to 7 days). Default 1h')))
    .addSubcommand((s) => s.setName('end').setDescription('End a poll now').addIntegerOption((o) => o.setName('id').setDescription('The poll number').setRequired(true).setMinValue(1)));
  ctx.discord.register({ data: b, run: async (i) => {
    requirePerm(i, F.ManageMessages);
    if (i.options.getSubcommand() === 'end') {
      const p = q.get.get(i.options.getInteger('id', true)); if (!p || p.guild_id !== i.guild.id) throw new Error('No such poll here.');
      if (!(await finish(p))) throw new Error('That poll is already over.'); return i.reply({ content: 'Ended poll #' + p.id + '.', flags: EPHEMERAL });
    }
    const answers = i.options.getString('answers', true).split('|').map((x) => x.trim()).filter(Boolean);
    if (answers.length < 2 || answers.length > 5) throw new Error('Give 2 to 5 answers separated by | (for example: Yes | No).');
    if (new Set(answers.map((x) => x.toLowerCase())).size !== answers.length) throw new Error('Every answer must be different.');
    const ms = i.options.getString('duration') ? parseDuration(i.options.getString('duration')) : 3600000;
    if (!ms || ms < MIN_MS || ms > MAX_MS) throw new Error('Give a time like 10m, 2h or 1d (30 seconds up to 7 days).');
    const r = q.ins.run(i.guild.id, i.channelId, i.options.getString('question', true).trim(), JSON.stringify(answers), i.user.id, now() + ms, now()), p = q.get.get(Number(r.lastInsertRowid));
    try { const m = await i.channel.send({ embeds: [card(p)], components: rows(p), allowedMentions: { parse: [] } }); q.msg.run(m.id, p.id); } catch (e) { q.status.run('cancelled', p.id, 'open'); throw new Error('I could not post in this channel: ' + e.message); }
    return i.reply({ content: 'Poll #' + p.id + ' started.', flags: EPHEMERAL });
  } });

  async function onVote(i) {
    const [, id, choice] = String(i.customId).split(':'), p = q.get.get(Number(id));
    if (!p || p.guild_id !== i.guild.id) return i.reply({ content: 'That poll is gone.', flags: EPHEMERAL });
    if (p.status !== 'open' || p.ends_at <= now()) return i.reply({ content: 'This poll is over.', flags: EPHEMERAL });
    const c = Number(choice); if (!(c >= 0 && c < opts(p).length)) return i.reply({ content: 'That answer does not exist.', flags: EPHEMERAL });
    q.vote.run(p.id, i.user.id, c);
    await i.update({ embeds: [card(p)] });
    return undefined;
  }
  ctx.discord.registerButton('poll', onVote);
  return { start, stop, tick, onVote, finish };
};
