'use strict';
/**
 * Regulars: new people are limited (no links, images, invites or mention floods) until they have been in the server a while
 * and have really taken part in conversations. Then the bot gives them the "Regular" role and the limits go away.
 *  - What counts as a conversation: a stretch of chat in one channel where the person AND at least one other person have both talked.
 *    After a quiet gap (default 30 minutes) the next exchange is a new conversation. So 10 conversations means 10 separate chats,
 *    not 10 messages in one afternoon.
 *  - The days count from when the person joined the server (Discord knows this even for people who joined before the bot arrived).
 *  - Mods, people with an exempt role (for example your sub roles), anyone with the Regular role, and chat in exempt channels are never limited.
 *  - A mod can promote or demote by hand (/regular). Everything here is off until switched on, and follows "Dry run".
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, Events } = require('discord.js');
const { COLOR, embed } = require('../theme');

const DAY = 86400000, EPHEMERAL = MessageFlags.Ephemeral, SWEEP_MS = 3600000;
const LINK = /\b(?:https?:\/\/|www\.)\S+/i;
const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-z0-9-]+/i;
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

module.exports = function createRegulars(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db, cfg = () => ctx.config.get(), R = () => cfg().regulars;
  const q = {
    seen: db.prepare('INSERT OR IGNORE INTO member_stats (guild_id, user_id, joined_at) VALUES (?, ?, ?)'),
    get: db.prepare('SELECT * FROM member_stats WHERE guild_id = ? AND user_id = ?'),
    bump: db.prepare('UPDATE member_stats SET conversations = conversations + 1 WHERE guild_id = ? AND user_id = ?'),
    promote: db.prepare('UPDATE member_stats SET regular_since = ? WHERE guild_id = ? AND user_id = ?'),
    manual: db.prepare('UPDATE member_stats SET manual = ?, regular_since = ? WHERE guild_id = ? AND user_id = ?'),
    waiting: db.prepare('SELECT * FROM member_stats WHERE guild_id = ? AND regular_since IS NULL AND manual >= 0'),
  };
  const kvKey = (g) => 'regular.role.' + g;
  const convs = new Map();   // channel id -> { lastAt, people: Map(user id -> counted) }

  /** how far along a person is: { days, conversations, enough } */
  function progress(stat, t) {
    const r = R(), days = Math.floor((t - stat.joined_at) / DAY);
    return { days, conversations: stat.conversations, needDays: r.minDays, needConversations: r.minConversations, enough: days >= r.minDays && stat.conversations >= r.minConversations };
  }
  const stat = (guildId, userId, joinedAt) => { q.seen.run(guildId, userId, joinedAt || now()); return q.get.get(guildId, userId); };

  /** a human message in a channel: returns the user ids that just had a conversation counted */
  function track(guildId, channelId, userId, joinedAt) {
    stat(guildId, userId, joinedAt);
    const t = now(), gap = R().gapMinutes * 60000;
    let c = convs.get(channelId);
    if (!c || t - c.lastAt > gap) { c = { lastAt: t, people: new Map() }; convs.set(channelId, c); }
    c.lastAt = t; if (!c.people.has(userId)) c.people.set(userId, false);
    const counted = [];
    if (c.people.size >= 2) for (const [u, done] of c.people) if (!done) { c.people.set(u, true); q.bump.run(guildId, u); counted.push(u); }
    return counted;
  }

  // ------------------------------------------------------------------ the role
  async function roleOf(guild, create) {
    const id = ctx.kv.get(kvKey(guild.id));
    let role = id && (guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null));
    if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === 'regular') || null;
    if (!role && create) role = await guild.roles.create({ name: 'Regular', color: COLOR.cream, mentionable: false, reason: 'Regulars system' });
    if (role) ctx.kv.set(kvKey(guild.id), role.id);
    return role;
  }
  const isRegular = (member, role) => !!role && member.roles.cache.has(role.id);

  /** gives the role if the person has earned it (or when asked by hand) */
  async function promote(guild, member, why) {
    const role = await roleOf(guild, true); if (isRegular(member, role)) return false;
    if (cfg().dryRun && why !== 'manual') return false;   // in a dry run nothing changes for people
    await member.roles.add(role.id, 'Regular: ' + why); q.promote.run(now(), guild.id, member.id); return true;
  }
  async function maybePromote(guild, member) {
    const s = q.get.get(guild.id, member.id); if (!s || s.regular_since || s.manual < 0) return false;
    return progress(s, now()).enough ? promote(guild, member, 'earned') : false;
  }
  /** every so often: promote people who became eligible just by waiting (the days passed) */
  async function sweep() {
    if (!R().on) return 0; let n = 0;
    for (const guild of ctx.guilds()) for (const s of q.waiting.all(guild.id)) {
      if (!progress(s, now()).enough) continue;
      const m = await guild.members.fetch(s.user_id).catch(() => null); if (!m || m.user.bot) continue;
      try { if (await promote(guild, m, 'earned')) n++; } catch (e) { log('regular promote failed:', e.message); }
    }
    return n;
  }

  // ------------------------------------------------------------------ the limits
  const exempt = (member, role) => !member || member.permissions.has(F.ManageMessages) || member.permissions.has(F.ModerateMembers) || member.permissions.has(F.Administrator)
    || isRegular(member, role) || R().exemptRoles.some((r) => member.roles.cache.has(r));
  /** what a message does that a new person may not: a short text, or null */
  function broken(m, mentionCount) {
    const r = R().restrict, text = String(m.content || '');
    if (r.invites && INVITE.test(text)) return 'invite links';
    if (r.links && LINK.test(text)) return 'links';
    if (r.attachments && m.attachments && m.attachments.size > 0) return 'images and files';
    if (r.mentions && mentionCount > r.maxMentions) return 'mentioning that many people';
    return null;
  }
  const logLine = async (title, body) => { const id = cfg().channels.modLog; if (!id) return; try { const ch = await ctx.fetchChannel(id); if (ch) await ch.send({ embeds: [embed(title, cut(body, 1500), COLOR.cream)], allowedMentions: { parse: [] } }); } catch (e) { log('mod log failed:', e.message); } };

  async function onMessage(m) {
    if (!m.guild || !m.author || m.author.bot || m.webhookId || m.system || !R().on) return;
    const guild = m.guild, member = m.member; if (!member) return;
    track(guild.id, m.channelId, m.author.id, member.joinedTimestamp);
    const role = await roleOf(guild, false);
    if (!exempt(member, role) && !(R().exemptChannels || []).includes(m.channelId)) {
      const mc = m.mentions ? (m.mentions.users ? m.mentions.users.size : 0) + (m.mentions.roles ? m.mentions.roles.size : 0) + (m.mentions.everyone ? 1 : 0) : 0, what = broken(m, mc);
      if (what) {
        if (cfg().dryRun) await logLine('Dry run: would remove a message from a new member (' + what + ')', '<@' + m.author.id + '> in <#' + m.channelId + '>\n> ' + cut(m.content || '(attachment)', 200));
        else {
          await m.delete().catch(() => {});
          if (R().notice) {
            const p = progress(q.get.get(guild.id, m.author.id), now());
            try { const n = await m.channel.send({ content: '<@' + m.author.id + '> ' + what + ' unlock after ' + p.needDays + ' days in the server and ' + p.needConversations + ' conversations (you are at ' + Math.min(p.days, p.needDays) + '/' + p.needDays + ' days and ' + Math.min(p.conversations, p.needConversations) + '/' + p.needConversations + ' conversations). Keep chatting!', allowedMentions: { users: [m.author.id] } }); const tm = setTimeout(() => n.delete().catch(() => {}), 12000); if (tm.unref) tm.unref(); } catch (e) { /* cannot talk here */ }
          }
        }
      }
    }
    await maybePromote(guild, member).catch((e) => log('regular promote failed:', e.message));
  }
  const onJoin = (member) => { if (R().on && !member.user.bot) stat(member.guild.id, member.id, member.joinedTimestamp); };

  // ------------------------------------------------------------------ commands
  const viewLine = (s, role, member) => {
    const p = progress(s, now()), done = s.regular_since || (member && isRegular(member, role));
    return done ? '✅ **Regular**' + (s.regular_since ? ' since <t:' + Math.floor(s.regular_since / 1000) + ':D>' : '') : (s.manual < 0 ? '⛔ Held back by a mod' : (p.enough ? '⏳ Eligible: the role is given shortly' : 'Days in the server: **' + Math.min(p.days, p.needDays) + '/' + p.needDays + '**, conversations: **' + Math.min(p.conversations, p.needConversations) + '/' + p.needConversations + '**'));
  };
  ctx.discord.register({ data: new SlashCommandBuilder().setName('progress').setDescription('How close you are to becoming a Regular').setDMPermission(false), run: async (i) => {
    if (!R().on) return i.reply({ content: 'The Regular system is not switched on in this server.', flags: EPHEMERAL });
    const s = stat(i.guild.id, i.user.id, i.member && i.member.joinedTimestamp), role = await roleOf(i.guild, false);
    return i.reply({ embeds: [embed('Your progress', viewLine(s, role, i.member) + '\n\nA conversation is a chat where you and someone else both talk. Links and images unlock when you are a Regular.', COLOR.aqua)], flags: EPHEMERAL });
  } });
  const sub = (b, name, desc) => b.addSubcommand((s) => s.setName(name).setDescription(desc).addUserOption((o) => o.setName('user').setDescription('The person').setRequired(true)));
  const reg = new SlashCommandBuilder().setName('regular').setDescription('Mods: look at, grant or remove the Regular role').setDMPermission(false).setDefaultMemberPermissions(F.ModerateMembers);
  sub(reg, 'status', 'Someone\'s progress'); sub(reg, 'grant', 'Make someone a Regular now'); sub(reg, 'revoke', 'Remove the role and hold them back');
  ctx.discord.register({ data: reg, run: async (i) => {
    const user = i.options.getUser('user', true), member = i.options.getMember('user'), g = i.guild, which = i.options.getSubcommand();
    if (!member) throw new Error('That person is not in this server.'); if (user.bot) throw new Error('Bots are not tracked.');
    const s = stat(g.id, user.id, member.joinedTimestamp), role = await roleOf(g, which === 'grant');
    if (which === 'status') return i.reply({ embeds: [embed('Progress of ' + (user.tag || user.username), viewLine(s, role, member), COLOR.aqua)], flags: EPHEMERAL, allowedMentions: { parse: [] } });
    if (which === 'grant') { await promote(g, member, 'manual'); q.manual.run(1, s.regular_since || now(), g.id, user.id); return i.reply({ content: '<@' + user.id + '> is a Regular now.', flags: EPHEMERAL, allowedMentions: { parse: [] } }); }
    if (role && isRegular(member, role)) await member.roles.remove(role.id, 'Regular removed by ' + i.user.id);
    q.manual.run(-1, null, g.id, user.id); return i.reply({ content: '<@' + user.id + '> is not a Regular and will not become one on their own.', flags: EPHEMERAL, allowedMentions: { parse: [] } });
  } });

  let timer = null;
  const start = () => { if (!timer) { timer = setInterval(() => sweep().catch((e) => log('regular sweep failed:', e.message)), SWEEP_MS); if (timer.unref) timer.unref(); } };
  const stop = () => { clearInterval(timer); timer = null; };
  const attach = (c) => { c.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => log('regulars failed:', e.message))); c.on(Events.GuildMemberAdd, onJoin); };
  return { attach, start, stop, onMessage, onJoin, track, sweep, progress, maybePromote, _convs: convs };
};
