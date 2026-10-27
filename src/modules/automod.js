'use strict';
/**
 * AutoMod: watches messages and removes the usual trouble (spam, repeats, mention floods, invites, links, shouting, emoji walls, banned words),
 * and watches joins (a sudden wave of new members, accounts that are too new).
 *  - A removed message becomes a warning from the bot, so the warn ladder applies (3 warnings: timeout, and so on).
 *  - Mods (anyone who can manage messages or time people out) are never touched.
 *  - While "Dry run" is on, nothing is removed or warned: #mod-log only says what the bot would have done.
 * evaluate() is pure (a message in, a verdict out) so each rule is tested without Discord.
 */
const { Events, PermissionFlagsBits: F } = require('discord.js');
const { COLOR } = require('../theme');
const { hosts } = require('../links');

const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-z0-9-]+/i;
const CUSTOM_EMOJI = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();

module.exports = function createAutomod(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, cfg = () => ctx.config.get(), A = () => cfg().automod;
  const recent = new Map();     // user id -> [{ t, text }] for the spam and repeat rules
  const joins = []; let lastRaidAlert = 0;

  /** the verdict for one message: { rule, text } or null. `m` = { userId, content, mentionCount } */
  function evaluate(m, a) {
    a = a || A(); const text = String(m.content || '');
    if (a.invites.on && INVITE.test(text)) return { rule: 'invites', text: 'invite links are not allowed here' };
    if (a.links.on) {
      for (const host of hosts(text)) {   // addresses with or without "https://", so "evil.gg/x" does not slip through
        if (!a.links.allow.some((d) => host === d || host.endsWith('.' + d))) return { rule: 'links', text: 'links to ' + host + ' are not allowed here' };
      }
    }
    if (a.words.on && a.words.list.length) {
      const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + a.words.list.map(esc).join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
      if (re.test(text)) return { rule: 'words', text: 'that word is not allowed here' };
    }
    if (a.mentions.on && (m.mentionCount || 0) > a.mentions.max) return { rule: 'mentions', text: 'too many mentions in one message' };
    if (a.emoji.on && ((text.match(CUSTOM_EMOJI) || []).length + (text.match(UNICODE_EMOJI) || []).length) > a.emoji.max) return { rule: 'emoji', text: 'too many emoji' };
    if (a.caps.on) {
      const letters = text.replace(/[^\p{L}]/gu, '');
      if (letters.length >= a.caps.minLength && letters.replace(/[^\p{Lu}]/gu, '').length * 100 / letters.length >= a.caps.percent) return { rule: 'caps', text: 'please do not shout' };
    }
    // the repeat rules look at this person's last messages
    const t = now(), list = (recent.get(m.userId) || []).filter((x) => t - x.t < 60000);
    list.push({ t, text: norm(text) }); recent.set(m.userId, list); if (recent.size > 5000) recent.delete(recent.keys().next().value);   // the oldest person's history goes first, so memory stays bounded
    if (a.duplicate.on && text.trim() && list.filter((x) => t - x.t < a.duplicate.seconds * 1000 && x.text === norm(text)).length >= a.duplicate.count) { recent.delete(m.userId); return { rule: 'duplicate', text: 'please do not repeat yourself' }; }
    if (a.spam.on && list.filter((x) => t - x.t < a.spam.seconds * 1000).length >= a.spam.count) { recent.delete(m.userId); return { rule: 'spam', text: 'you are sending messages too fast' }; }
    return null;
  }

  const exempt = (member) => !member || member.permissions.has(F.ManageMessages) || member.permissions.has(F.ModerateMembers) || member.permissions.has(F.Administrator);
  const logLine = async (title, body, color) => {
    const id = cfg().channels.modLog; if (!id) return;
    try { const ch = await ctx.fetchChannel(id); if (ch) await ch.send({ embeds: [{ title, description: cut(body, 1500), color: color || COLOR.cream }], allowedMentions: { parse: [] } }); } catch (e) { log('mod log failed:', e.message); }
  };

  /** a new message, or (edited = true) a message that was edited: the content rules apply again, the speed rules (spam, repeats) do not */
  async function onMessage(m, edited) {
    if (!m.guild || !m.author || m.author.bot || m.webhookId || m.system) return;
    const a = A(); if (!a.on || exempt(m.member) || (a.exemptChannels || []).includes(m.channelId)) return;
    const mc = m.mentions ? (m.mentions.users ? m.mentions.users.size : 0) + (m.mentions.roles ? m.mentions.roles.size : 0) + (m.mentions.everyone ? 1 : 0) : 0;
    const v = evaluate({ userId: m.author.id, content: m.content, mentionCount: mc }, edited ? Object.assign({}, a, { spam: Object.assign({}, a.spam, { on: false }), duplicate: Object.assign({}, a.duplicate, { on: false }) }) : a); if (!v) return;
    const snippet = cut(m.content || '', 200), where = '<@' + m.author.id + '> in <#' + m.channelId + '>';
    if (cfg().dryRun) return logLine('Dry run: AutoMod would remove a message (' + v.rule + ')', where + '\n> ' + snippet, COLOR.cream);
    await m.delete().catch(() => {});
    try { const n = await m.channel.send({ content: '<@' + m.author.id + '> your message was removed: ' + v.text + '.', allowedMentions: { users: [m.author.id] } }); const tm = setTimeout(() => n.delete().catch(() => {}), 8000); if (tm.unref) tm.unref(); } catch (e) { /* no permission to talk here */ }
    if (a.warn && ctx.moderation) {
      try {
        await ctx.moderation.perform(m.guild, { type: 'warn', user: m.author, member: m.member, reason: 'AutoMod (' + v.rule + '): ' + snippet, mod: ctx.botId(), modTag: 'IMC-Bot', source: 'automod' });
        await ctx.moderation.ladder(m.guild, m.author, m.member);
      } catch (e) { log('automod warn failed:', e.message); await logLine('AutoMod removed a message (' + v.rule + ')', where + '\n> ' + snippet, COLOR.heat); }
    } else await logLine('AutoMod removed a message (' + v.rule + ')', where + '\n> ' + snippet, COLOR.heat);
  }

  /** a new member: count the wave of joins, and check how old the account is */
  async function onJoin(member) {
    const a = A(); if (!a.on || member.user.bot) return;
    const t = now(); joins.push(t); while (joins.length && t - joins[0] > a.raid.seconds * 1000) joins.shift();
    if (a.raid.on && joins.length >= a.raid.joins && t - lastRaidAlert > 5 * 60000) {
      lastRaidAlert = t;
      await logLine('Possible raid: ' + joins.length + ' joins in ' + a.raid.seconds + ' s', 'Many accounts joined at once. Check the member list, and consider pausing invites (Server Settings, Invites). Newest: <@' + member.id + '>', COLOR.rust);
    }
    if (a.accountAge.on && member.user.createdTimestamp != null) {
      const days = (t - member.user.createdTimestamp) / 86400000;
      if (days < a.accountAge.days) {
        const why = 'Account is ' + days.toFixed(1) + ' days old (the minimum is ' + a.accountAge.days + ')';
        if (cfg().dryRun) return logLine('Dry run: AutoMod would kick a new account', '<@' + member.id + '>: ' + why, COLOR.cream);
        try { await ctx.moderation.perform(member.guild, { type: 'kick', user: member.user, member, reason: why, mod: ctx.botId(), modTag: 'IMC-Bot', source: 'automod' }); } catch (e) { await logLine('AutoMod could not kick a new account', '<@' + member.id + '>: ' + e.message, COLOR.rust); }
      }
    }
    return undefined;
  }
  const attach = (client) => { client.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => log('automod failed:', e.message))); client.on(Events.MessageUpdate, (a, b) => (b && b.content != null && !b.partial && a.content !== b.content ? onMessage(b, true).catch((e) => log('automod failed:', e.message)) : undefined)); /* an edit must not be a way round the rules */ client.on(Events.GuildMemberAdd, (m) => onJoin(m).catch((e) => log('automod join failed:', e.message))); };
  return { evaluate, onMessage, onJoin, attach, _recent: recent };
};
