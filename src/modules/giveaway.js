'use strict';
/**
 * Giveaways: /giveaway start posts a message with an Enter button; when the time is up the bot draws the winners and announces them.
 *  - Press the button to enter, press it again to leave. A giveaway can need a role (for example your Tier 1 Sub role).
 *  - Everything is in the database, so a restart in the middle of a giveaway loses nothing: the timer picks it up again.
 *  - Winners are drawn at random (a real random source) from people who are still in the server and are not bots.
 *  - /giveaway reroll draws replacements; people who already won are never drawn again for the same giveaway.
 */
const crypto = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { parseDuration, fmtDuration } = require('./cases');
const { requirePerm } = require('../perms');

const EPHEMERAL = MessageFlags.Ephemeral;
const MIN_MS = 10000, MAX_MS = 30 * 86400000, TICK_MS = 15000;
const unix = (ms) => Math.floor(ms / 1000);

/** n different items picked at random (a Fisher-Yates shuffle with crypto.randomInt) */
function pick(list, n, rand) {
  const a = list.slice(), r = rand || ((max) => crypto.randomInt(max));
  for (let i = a.length - 1; i > 0; i--) { const j = r(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.max(0, n));
}

module.exports = function createGiveaway(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db;
  const q = {
    ins: db.prepare('INSERT INTO giveaways (guild_id, channel_id, prize, host, winners, required_role, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    setMsg: db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?'),
    get: db.prepare('SELECT * FROM giveaways WHERE id = ? AND guild_id = ?'),
    byId: db.prepare('SELECT * FROM giveaways WHERE id = ?'),
    due: db.prepare("SELECT * FROM giveaways WHERE status = 'open' AND ends_at <= ?"),
    open: db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND status = 'open' ORDER BY ends_at"),
    status: db.prepare('UPDATE giveaways SET status = ? WHERE id = ? AND status = ?'),
    enter: db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)'),
    leave: db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?'),
    entries: db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?'),
    won: db.prepare('INSERT OR IGNORE INTO giveaway_winners (giveaway_id, user_id) VALUES (?, ?)'),
    winners: db.prepare('SELECT user_id FROM giveaway_winners WHERE giveaway_id = ?'),
  };
  const entryRow = (id, disabled) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('gw:' + id).setLabel('Enter giveaway').setStyle(ButtonStyle.Success).setDisabled(!!disabled));

  function openEmbed(g) {
    const need = g.required_role ? '\n**Needs the role:** <@&' + g.required_role + '>' : '';
    return embed('🎉 ' + g.prize, 'Press the button to enter. Press it again to leave.\n**Winners:** ' + g.winners + '\n**Ends:** <t:' + unix(g.ends_at) + ':R> (<t:' + unix(g.ends_at) + ':f>)\n**Hosted by:** <@' + g.host + '>' + need, COLOR.heat);
  }
  function endedEmbed(g, winners, entries, cancelled) {
    const text = cancelled ? 'This giveaway was cancelled.' : winners.length ? '**Winner' + (winners.length > 1 ? 's' : '') + ':** ' + winners.map((w) => '<@' + w + '>').join(' ') : 'Nobody entered, so there is no winner.';
    return embed('🎉 ' + g.prize + ' (ended)', text + '\n**Entries:** ' + entries + '\n**Hosted by:** <@' + g.host + '>', cancelled ? COLOR.rust : COLOR.cream);
  }
  const messageOf = async (g) => { const ch = await ctx.fetchChannel(g.channel_id); return ch ? { ch, id: g.message_id } : null; };

  /** the people who may win: still in the server, not bots, and (if needed) still holding the role */
  async function eligible(guild, g, exclude) {
    const out = [];
    for (const { user_id } of q.entries.all(g.id)) {
      if (exclude.has(user_id)) continue;
      const m = await guild.members.fetch(user_id).catch(() => null);
      if (!m || (m.user && m.user.bot)) continue;
      if (g.required_role && !(m.roles && m.roles.cache && m.roles.cache.has(g.required_role))) continue;
      out.push(user_id);
    }
    return out;
  }

  /** draws `n` winners for giveaway g, records them, and returns the list */
  async function draw(g, n, exclude) {
    const guild = await ctx.fetchGuild(g.guild_id); if (!guild) throw new Error('I am not in that server any more.');
    const winners = pick(await eligible(guild, g, exclude || new Set()), n, ctx.rand);
    for (const w of winners) q.won.run(g.id, w);
    return winners;
  }

  /** time is up (or a mod pressed end): close it, draw, announce */
  const tries = new Map();   // giveaway id -> failed draws, so a draw that can never work is given up after a few tries
  /** closes the giveaway ("ending" while drawing, so nobody ends it twice), draws and announces; a failed draw is tried again on the next tick */
  async function finish(g) {
    if (q.status.run('ending', g.id, 'open').changes === 0) return null;   // someone else is already ending it
    try { const w = await finishInner(g); q.status.run('ended', g.id, 'ending'); tries.delete(g.id); return w; }
    catch (e) { const n = (tries.get(g.id) || 0) + 1; tries.set(g.id, n); q.status.run(n >= 5 ? 'ended' : 'open', g.id, 'ending'); throw e; }
  }
  async function finishInner(g) {
    const winners = await draw(g, g.winners), entries = q.count.get(g.id).n, m = await messageOf(g);
    if (m && m.id) {
      await m.ch.messages.edit(m.id, { embeds: [endedEmbed(g, winners, entries)], components: [entryRow(g.id, true)], allowedMentions: { parse: [] } }).catch((e) => log('giveaway edit failed:', e.message));
      await m.ch.send({ content: winners.length ? '🎉 Congratulations ' + winners.map((w) => '<@' + w + '>').join(' ') + '! You won **' + g.prize + '**.' : 'Nobody entered the giveaway for **' + g.prize + '**.', allowedMentions: { users: winners }, reply: { messageReference: m.id, failIfNotExists: false } }).catch((e) => log('giveaway announce failed:', e.message));
    }
    return winners;
  }
  /** called every few seconds: ends whatever is due */
  async function tick() { for (const g of q.due.all(now())) await finish(g).catch((e) => log('giveaway', g.id, 'failed:', e.message)); }
  let timer = null;
  const start = () => { if (!timer) { timer = setInterval(() => tick().catch(() => {}), TICK_MS); if (timer.unref) timer.unref(); tick().catch(() => {}); } };
  const stop = () => { clearInterval(timer); timer = null; };

  // ------------------------------------------------------------------ the command
  const b = new SlashCommandBuilder().setName('giveaway').setDescription('Run giveaways').setDMPermission(false).setDefaultMemberPermissions(F.ManageMessages)
    .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway in this channel')
      .addStringOption((o) => o.setName('prize').setDescription('What is given away').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('duration').setDescription('Like 30m, 2h, 7d (10 seconds up to 30 days)').setRequired(true))
      .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(20))
      .addRoleOption((o) => o.setName('role').setDescription('Only people with this role can enter')))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and draw').addIntegerOption((o) => o.setName('id').setDescription('The giveaway number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway without drawing').addIntegerOption((o) => o.setName('id').setDescription('The giveaway number').setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName('reroll').setDescription('Draw new winners for an ended giveaway').addIntegerOption((o) => o.setName('id').setDescription('The giveaway number').setRequired(true).setMinValue(1)).addIntegerOption((o) => o.setName('count').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)))
    .addSubcommand((s) => s.setName('list').setDescription('The giveaways that are running'));

  async function run(i) {
    requirePerm(i, F.ManageMessages);
    const sub = i.options.getSubcommand(), gid = i.guild.id;
    if (sub === 'start') {
      const ms = parseDuration(i.options.getString('duration', true));
      if (!ms || ms < MIN_MS || ms > MAX_MS) throw new Error('Give a time like 30m, 2h or 7d (10 seconds up to 30 days).');
      const role = i.options.getRole('role'), r = q.ins.run(gid, i.channelId, i.options.getString('prize', true).trim(), i.user.id, i.options.getInteger('winners') || 1, role ? role.id : null, now() + ms, now());
      const g = q.byId.get(Number(r.lastInsertRowid));
      try { const msg = await i.channel.send({ embeds: [openEmbed(g)], components: [entryRow(g.id)], allowedMentions: { parse: [] } }); q.setMsg.run(msg.id, g.id); } catch (e) { q.status.run('cancelled', g.id, 'open'); throw new Error('I could not post in this channel: ' + e.message); }
      return i.reply({ content: 'Giveaway #' + g.id + ' started. It ends in ' + fmtDuration(ms) + '.', flags: EPHEMERAL });
    }
    if (sub === 'list') {
      const list = q.open.all(gid);
      return i.reply({ embeds: [embed('Running giveaways', list.map((g) => '`#' + g.id + '` **' + g.prize + '** in <#' + g.channel_id + '>, ends <t:' + unix(g.ends_at) + ':R>, ' + q.count.get(g.id).n + ' entries').join('\n') || 'None running.', COLOR.aqua)], flags: EPHEMERAL });
    }
    const g = q.get.get(i.options.getInteger('id', true), gid); if (!g) throw new Error('No such giveaway here.');
    if (sub === 'end') {
      if (g.status !== 'open') throw new Error('That giveaway is already over.');
      await i.deferReply({ flags: EPHEMERAL }); const w = await finish(g); return i.editReply({ content: 'Ended giveaway #' + g.id + '. ' + (w && w.length ? 'Winners: ' + w.map((x) => '<@' + x + '>').join(' ') : 'No winner.'), allowedMentions: { parse: [] } });
    }
    if (sub === 'cancel') {
      if (q.status.run('cancelled', g.id, 'open').changes === 0) throw new Error('That giveaway is already over.');
      const m = await messageOf(g); if (m && m.id) await m.ch.messages.edit(m.id, { embeds: [endedEmbed(g, [], q.count.get(g.id).n, true)], components: [entryRow(g.id, true)] }).catch(() => {});
      return i.reply({ content: 'Cancelled giveaway #' + g.id + '.', flags: EPHEMERAL });
    }
    if (sub === 'reroll') {
      if (g.status !== 'ended') throw new Error('Only an ended giveaway can be rerolled.');
      await i.deferReply({ flags: EPHEMERAL });
      const before = new Set(q.winners.all(g.id).map((w) => w.user_id)), w = await draw(g, i.options.getInteger('count') || 1, before);
      if (!w.length) return i.editReply({ content: 'There is nobody left to draw.' });
      const m = await messageOf(g); if (m) await m.ch.send({ content: '🎉 New winner' + (w.length > 1 ? 's' : '') + ' for **' + g.prize + '**: ' + w.map((x) => '<@' + x + '>').join(' ') + '! Congratulations.', allowedMentions: { users: w } }).catch(() => {});
      return i.editReply({ content: 'Drew ' + w.map((x) => '<@' + x + '>').join(' ') + '.', allowedMentions: { parse: [] } });
    }
    return undefined;
  }
  ctx.discord.register({ data: b, run });

  /** the Enter button */
  async function onPress(i) {
    const g = q.byId.get(Number(String(i.customId).split(':')[1]));
    if (!g || g.guild_id !== i.guild.id) return i.reply({ content: 'That giveaway is gone.', flags: EPHEMERAL });
    if (g.status !== 'open' || g.ends_at <= now()) return i.reply({ content: 'This giveaway is over.', flags: EPHEMERAL });
    if (g.required_role && !(i.member.roles.cache && i.member.roles.cache.has(g.required_role))) return i.reply({ content: 'You need the <@&' + g.required_role + '> role to enter.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
    const was = q.entries.all(g.id).some((e) => e.user_id === i.user.id);
    if (was) q.leave.run(g.id, i.user.id); else q.enter.run(g.id, i.user.id);
    return i.reply({ content: was ? 'You left the giveaway.' : 'You are in! Good luck. (' + q.count.get(g.id).n + ' entries)', flags: EPHEMERAL });
  }
  ctx.discord.registerButton('gw', onPress);
  return { start, stop, tick, finish, onPress, pick, run };
};
module.exports.pick = pick;
