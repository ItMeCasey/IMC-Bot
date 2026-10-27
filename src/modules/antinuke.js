'use strict';
/**
 * Anti-nuke: if one account deletes channels or roles, or bans people, in a burst (3 within 10 seconds by default), it is probably a
 * hijacked mod account or a rogue bot. The bot then takes away that account's roles that carry power, and tells the mods.
 *  - Never acts on the server owner or on itself.
 *  - While "Dry run" is on it only says in #mod-log what it would have done.
 *  - Off until switched on. It needs the "View Audit Log" permission (the bot has it) to see who did it.
 */
const { Events, AuditLogEvent, PermissionFlagsBits: F } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { POWER } = require('./selfroles');

const KINDS = { channel: AuditLogEvent.ChannelDelete, role: AuditLogEvent.RoleDelete, ban: AuditLogEvent.MemberBanAdd };
const LABEL = { channel: 'deleted a channel', role: 'deleted a role', ban: 'banned someone' };
const COOLDOWN_MS = 10 * 60000;

module.exports = function createAntiNuke(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, cfg = () => ctx.config.get(), A = () => cfg().antinuke;
  const recent = new Map();   // executor id -> [timestamps]
  const handled = new Map();  // executor id -> when it was last acted on

  /** who did it, from the audit log (a few seconds old at most); null when unknown */
  async function whoDid(guild, kind, targetId) {
    if (ctx.audit) return ctx.audit(guild, kind, targetId);
    try {
      const logs = await guild.fetchAuditLogs({ type: KINDS[kind], limit: 5 });
      const e = [...logs.entries.values()].find((x) => (!targetId || (x.target && x.target.id === targetId)) && now() - x.createdTimestamp < 10000);
      return e && e.executor ? e.executor.id : null;
    } catch (err) { log('audit log unavailable:', err.message); return null; }
  }
  const logLine = async (title, text, color) => { const id = cfg().channels.modLog; if (!id) return; try { const ch = await ctx.fetchChannel(id); if (ch) await ch.send({ embeds: [embed(title, text, color)], allowedMentions: { parse: [] } }); } catch (e) { log('mod log failed:', e.message); } };

  /** one destructive action by `executorId`; returns true when it tipped the burst and was handled */
  async function record(guild, executorId, kind) {
    const a = A(); if (!a.on || !executorId || executorId === guild.ownerId || executorId === ctx.botId()) return false;
    const t = now(), list = (recent.get(executorId) || []).filter((x) => t - x < a.seconds * 1000); list.push(t); recent.set(executorId, list);
    if (list.length < a.maxActions || t - (handled.get(executorId) || 0) < COOLDOWN_MS) return false;
    handled.set(executorId, t);
    const what = list.length + ' destructive actions in ' + a.seconds + ' seconds (the last: ' + LABEL[kind] + ')';
    if (cfg().dryRun) { await logLine('Dry run: anti-nuke would act on a mod account', '<@' + executorId + '>: ' + what + '. Switch off "Dry run" to let the bot remove their powerful roles.', COLOR.cream); return true; }
    let stripped = [], note = '';
    try {
      const m = await guild.members.fetch(executorId), me = guild.members.me || await guild.members.fetchMe();
      const strip = [...m.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed && r.position < me.roles.highest.position && POWER.some((p) => r.permissions.has(F[p])));
      if (strip.length) { await m.roles.remove(strip.map((r) => r.id), 'Anti-nuke: ' + what); stripped = strip.map((r) => r.name); }
      else note = ' Nothing to strip: their powers come from roles the bot cannot change (or a managed bot role). Remove them by hand now.';
    } catch (e) { note = ' The bot could not act: ' + e.message + '. Remove their roles by hand now.'; }
    await logLine('🚨 Anti-nuke acted', '<@' + executorId + '> did ' + what + '.' + (stripped.length ? ' Removed the roles: ' + stripped.join(', ') + '.' : '') + note, COLOR.rust);
    return true;
  }

  async function onDelete(kind, thing) { if (!A().on || !thing.guild) return false; return record(thing.guild, await whoDid(thing.guild, kind, thing.id), kind); }
  async function onBan(ban) { if (!A().on) return false; return record(ban.guild, await whoDid(ban.guild, 'ban', ban.user && ban.user.id), 'ban'); }
  const attach = (c) => {
    c.on(Events.ChannelDelete, (ch) => onDelete('channel', ch).catch((e) => log('anti-nuke failed:', e.message)));
    c.on(Events.GuildRoleDelete, (r) => onDelete('role', r).catch((e) => log('anti-nuke failed:', e.message)));
    c.on(Events.GuildBanAdd, (b) => onBan(b).catch((e) => log('anti-nuke failed:', e.message)));
  };
  return { attach, record, onDelete, onBan };
};
