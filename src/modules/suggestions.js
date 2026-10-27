'use strict';
/**
 * Suggestions: anyone types /suggest and the idea appears in #suggestions with 👍 and 👎 buttons (one vote each, changeable).
 * Mods answer with /suggestion approve, deny or done (with a reason); the message changes colour and shows the answer.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { requirePerm } = require('../perms');

const EPHEMERAL = MessageFlags.Ephemeral;
const STATUS = { open: ['Open', COLOR.heat], approved: ['Approved', COLOR.aqua], denied: ['Denied', COLOR.rust], done: ['Done', COLOR.aqua] };
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

module.exports = function createSuggestions(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db, cfg = () => ctx.config.get();
  const q = {
    ins: db.prepare('INSERT INTO suggestions (guild_id, channel_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)'),
    msg: db.prepare('UPDATE suggestions SET message_id = ? WHERE id = ?'),
    get: db.prepare('SELECT * FROM suggestions WHERE id = ?'),
    set: db.prepare('UPDATE suggestions SET status = ?, note = ? WHERE id = ?'),
    vote: db.prepare('INSERT INTO suggestion_votes (suggestion_id, user_id, vote) VALUES (?, ?, ?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote'),
    unvote: db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?'),
    mine: db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?'),
    tally: db.prepare('SELECT SUM(vote = 1) AS up, SUM(vote = -1) AS down FROM suggestion_votes WHERE suggestion_id = ?'),
  };
  const counts = (id) => { const t = q.tally.get(id); return { up: t.up || 0, down: t.down || 0 }; };
  const row = (s, off) => { const c = counts(s.id); return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sg:up:' + s.id).setLabel(String(c.up)).setEmoji('👍').setStyle(ButtonStyle.Success).setDisabled(!!off),
    new ButtonBuilder().setCustomId('sg:down:' + s.id).setLabel(String(c.down)).setEmoji('👎').setStyle(ButtonStyle.Danger).setDisabled(!!off)); };
  function card(s) {
    const [label, color] = STATUS[s.status] || STATUS.open;
    return embed('Suggestion #' + s.id + ' (' + label + ')', cut(s.text, 3500) + (s.note ? '\n\n**Answer:** ' + cut(s.note, 500) : ''), color, { footer: { text: 'By ' + (s.author_name || s.user_id) } });
  }
  async function refresh(s, off) {
    const ch = await ctx.fetchChannel(s.channel_id); if (!ch || !s.message_id) return;
    await ch.messages.edit(s.message_id, { embeds: [card(s)], components: [row(s, off)], allowedMentions: { parse: [] } }).catch((e) => log('suggestion edit failed:', e.message));
  }

  const cooling = new Map();   // user id -> when they last suggested (one every 30 seconds)
  ctx.discord.register({ data: new SlashCommandBuilder().setName('suggest').setDescription('Suggest something for the stream or the server').setDMPermission(false)
    .addStringOption((o) => o.setName('idea').setDescription('Your suggestion').setRequired(true).setMaxLength(1000)), run: async (i) => {
    if (now() - (cooling.get(i.user.id) || 0) < 30000) throw new Error('Please wait a little before the next suggestion.');
    cooling.set(i.user.id, now()); if (cooling.size > 500) cooling.delete(cooling.keys().next().value);
    const id = cfg().channels.suggestions, ch = id ? await ctx.fetchChannel(id) : null;
    if (!ch) throw new Error('There is no #suggestions channel yet. A mod needs to press "Set up my server" in the dashboard.');
    const r = q.ins.run(i.guild.id, ch.id, i.user.id, i.options.getString('idea', true).trim(), now()), s = q.get.get(Number(r.lastInsertRowid));
    s.author_name = i.user.tag || i.user.username;
    const m = await ch.send({ embeds: [card(s)], components: [row(s)], allowedMentions: { parse: [] } }); q.msg.run(m.id, s.id);
    return i.reply({ content: 'Thanks! Your suggestion is #' + s.id + ' in <#' + ch.id + '>.', flags: EPHEMERAL });
  } });

  const sub = (b, name, desc) => b.addSubcommand((s) => s.setName(name).setDescription(desc).addIntegerOption((o) => o.setName('id').setDescription('The suggestion number').setRequired(true).setMinValue(1)).addStringOption((o) => o.setName('reason').setDescription('A short answer for everyone').setMaxLength(500)));
  const mod = new SlashCommandBuilder().setName('suggestion').setDescription('Mods: answer a suggestion').setDMPermission(false).setDefaultMemberPermissions(F.ManageMessages);
  sub(mod, 'approve', 'Mark it approved'); sub(mod, 'deny', 'Mark it denied'); sub(mod, 'done', 'Mark it as done');
  ctx.discord.register({ data: mod, run: async (i) => {
    requirePerm(i, F.ManageMessages);
    const s = q.get.get(i.options.getInteger('id', true)); if (!s || s.guild_id !== i.guild.id) throw new Error('No such suggestion.');
    const status = { approve: 'approved', deny: 'denied', done: 'done' }[i.options.getSubcommand()];
    q.set.run(status, i.options.getString('reason') || null, s.id); const next = q.get.get(s.id); next.author_name = s.user_id;
    await refresh(next, status === 'denied' || status === 'done');
    return i.reply({ content: 'Suggestion #' + s.id + ' is now ' + STATUS[status][0].toLowerCase() + '.', flags: EPHEMERAL });
  } });

  /** the 👍 / 👎 buttons: pressing the same one again takes the vote back */
  async function onVote(i) {
    const [, dir, id] = String(i.customId).split(':'), s = q.get.get(Number(id));
    if (!s || s.guild_id !== i.guild.id) return i.reply({ content: 'That suggestion is gone.', flags: EPHEMERAL });
    if (s.status === 'denied' || s.status === 'done') return i.reply({ content: 'Voting on this suggestion is closed.', flags: EPHEMERAL });
    const want = dir === 'up' ? 1 : -1, had = q.mine.get(s.id, i.user.id);
    if (had && had.vote === want) q.unvote.run(s.id, i.user.id); else q.vote.run(s.id, i.user.id, want);
    await i.update({ components: [row(s)] });
    return undefined;
  }
  ctx.discord.registerButton('sg', onVote);
  return { onVote, counts };
};
