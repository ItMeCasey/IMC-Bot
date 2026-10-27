'use strict';
/**
 * Tickets (support, questions, ban appeals): a mod runs /ticketpanel and the bot posts a message with an "Open a ticket" button.
 *  - Pressing it makes a private channel that only that person, the Mods role and the bot can see. One open ticket per person.
 *  - The Close button (for the person or any mod) saves a text transcript into #mod-log and then deletes the channel.
 *  - Tickets are in the database, so a restart loses nothing.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { requirePerm } = require('../perms');

const EPHEMERAL = MessageFlags.Ephemeral, MAX_OPEN = 50, DELETE_AFTER_MS = 5000;
const slug = (n) => String(n || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'user';

module.exports = function createTickets(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db, cfg = () => ctx.config.get();
  const q = {
    ins: db.prepare('INSERT INTO tickets (guild_id, channel_id, user_id, created_at) VALUES (?, ?, ?, ?)'),
    mine: db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'"),
    byChannel: db.prepare("SELECT * FROM tickets WHERE channel_id = ? AND status = 'open'"),
    openCount: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'"),
    close: db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ? AND status = 'open'"),
    drop: db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = 'gone' WHERE id = ?"),
  };

  const b = new SlashCommandBuilder().setName('ticketpanel').setDescription('Post a message with a button that opens a private ticket channel').setDMPermission(false).setDefaultMemberPermissions(F.ManageChannels)
    .addStringOption((o) => o.setName('title').setDescription('Heading of the message').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('text').setDescription('What tickets are for (questions, ban appeals...)').setMaxLength(500))
    .addStringOption((o) => o.setName('button').setDescription('Button text (default: Open a ticket)').setMaxLength(40));
  ctx.discord.register({ data: b, run: async (i) => {
    requirePerm(i, F.ManageChannels);
    await i.channel.send({ embeds: [embed(i.options.getString('title', true), i.options.getString('text') || 'Press the button to talk to the mods in private.', COLOR.aqua)], allowedMentions: { parse: [] },
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:open').setLabel(i.options.getString('button') || 'Open a ticket').setStyle(ButtonStyle.Primary))] });
    return i.reply({ content: 'Posted the ticket panel.', flags: EPHEMERAL });
  } });

  // one person pressing the button many times at once must not make many channels, and the cap counts tickets still being made
  const opening = new Set(); let inflight = 0;
  const closeRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger));
  const isMod = (i) => !!i.memberPermissions && (i.memberPermissions.has(F.ManageMessages) || i.memberPermissions.has(F.ModerateMembers));

  async function open(i) {
    if (opening.has(i.user.id)) return i.reply({ content: 'Your ticket is being made, one moment.', flags: EPHEMERAL });
    opening.add(i.user.id); inflight++;
    try { return await openTicket(i); } finally { opening.delete(i.user.id); inflight--; }
  }
  async function openTicket(i) {
    const g = i.guild, mine = q.mine.get(g.id, i.user.id);
    if (mine) {
      const still = g.channels.cache && g.channels.cache.get(mine.channel_id) || await g.channels.fetch(mine.channel_id).catch(() => null);
      if (still) return i.reply({ content: 'You already have an open ticket: <#' + mine.channel_id + '>', flags: EPHEMERAL });
      q.drop.run(now(), mine.id);   // the channel was deleted by hand: forget that ticket
    }
    if (q.openCount.get(g.id).n + inflight - 1 >= MAX_OPEN) return i.reply({ content: 'There are too many open tickets right now. Try again later.', flags: EPHEMERAL });
    await i.deferReply({ flags: EPHEMERAL });
    const me = g.members.me || await g.members.fetchMe(), mods = (g.roles.cache.find((r) => r.name.toLowerCase() === 'mods')) || null, SEE = F.ViewChannel | F.SendMessages | F.ReadMessageHistory | F.AttachFiles;
    const overwrites = [{ id: g.roles.everyone.id, deny: F.ViewChannel }, { id: i.user.id, allow: SEE }, { id: me.id, allow: SEE | F.ManageChannels | F.EmbedLinks }];
    if (mods) overwrites.push({ id: mods.id, allow: SEE | F.ManageMessages });
    const ch = await g.channels.create({ name: 'ticket-' + slug(i.user.username), type: ChannelType.GuildText, parent: i.channel && i.channel.parentId || undefined, permissionOverwrites: overwrites, topic: 'Ticket for ' + (i.user.tag || i.user.username) + ' (' + i.user.id + ')', reason: 'Ticket opened by ' + i.user.id });
    const t = q.ins.run(g.id, ch.id, i.user.id, now());
    await ch.send({ content: '<@' + i.user.id + '>' + (mods ? ' <@&' + mods.id + '>' : ''), embeds: [embed('Ticket #' + t.lastInsertRowid, 'Hi <@' + i.user.id + '>, tell us what you need and a mod will answer here. Press **Close ticket** when you are done.', COLOR.aqua)], components: [closeRow()], allowedMentions: { users: [i.user.id], roles: mods ? [mods.id] : [] } });
    return i.editReply({ content: 'Your ticket is open: <#' + ch.id + '>' });
  }

  /** the transcript as plain text: one line per message, oldest first */
  async function transcript(ch) {
    const msgs = [...(await ch.messages.fetch({ limit: 100 })).values()].sort((a, c) => a.createdTimestamp - c.createdTimestamp);
    return msgs.map((m) => '[' + new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19) + '] ' + (m.author ? m.author.tag || m.author.username : '?') + ': ' + (m.content || '') + (m.attachments && m.attachments.size ? ' [' + m.attachments.size + ' attachment(s)]' : '') + (m.embeds && m.embeds.length && !m.content ? ' [embed]' : '')).join('\n') || '(empty)';
  }

  async function closeTicket(i) {
    const t = q.byChannel.get(i.channelId); if (!t) return i.reply({ content: 'This ticket is already closed.', flags: EPHEMERAL });
    if (i.user.id !== t.user_id && !isMod(i)) return i.reply({ content: 'Only the person who opened it or a mod can close this ticket.', flags: EPHEMERAL });
    if (q.close.run(now(), i.user.id, t.id).changes === 0) return i.reply({ content: 'This ticket is already closed.', flags: EPHEMERAL });
    await i.reply({ content: 'Closing this ticket. A transcript is saved for the mods.' });
    try {
      const text = await transcript(i.channel), id = cfg().channels.modLog, out = id ? await ctx.fetchChannel(id) : null;
      if (out) await out.send({ embeds: [embed('Ticket #' + t.id + ' closed', 'Opened by <@' + t.user_id + '>, closed by <@' + i.user.id + '>.', COLOR.cream)], files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: 'ticket-' + t.id + '.txt' })], allowedMentions: { parse: [] } });
    } catch (e) { log('ticket transcript failed:', e.message); }
    const tm = setTimeout(() => i.channel.delete('Ticket #' + t.id + ' closed').catch((e) => log('ticket delete failed:', e.message)), ctx.deleteAfterMs == null ? DELETE_AFTER_MS : ctx.deleteAfterMs); if (tm.unref) tm.unref();
    return undefined;
  }
  ctx.discord.registerButton('ticket', (i) => (String(i.customId).split(':')[1] === 'close' ? closeTicket(i) : open(i)));
  return { open, closeTicket, transcript };
};
module.exports.slug = slug;
