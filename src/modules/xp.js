'use strict';
/**
 * XP and levels: people earn a little XP for chatting (at most once a minute), level up, and can be given roles at certain levels.
 *  - /rank shows your level, progress and place; /leaderboard shows the top ten; mods can reset someone with /xp reset.
 *  - Level roles are set in the dashboard as "level:role id" lines (for example 5:123456789012345678). Only plain roles are handed out
 *    (never a role above the bot or one that carries power).
 *  - Off until switched on. Bots and very short messages earn nothing.
 */
const crypto = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, Events } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { requirePerm } = require('../perms');
const { whyNot } = require('./selfroles');

const EPHEMERAL = MessageFlags.Ephemeral, MIN_LENGTH = 5;
/** XP needed to go from level n to n+1 (the same curve many bots use) */
const need = (n) => 5 * n * n + 50 * n + 100;
/** the level for a total of XP, and how far into the next one: { level, into, next } */
function levelFor(xp) { let level = 0, left = xp; while (left >= need(level)) { left -= need(level); level++; } return { level, into: left, next: need(level) }; }
const bar = (a, b) => { const n = Math.max(0, Math.min(10, Math.round(a * 10 / b))); return '█'.repeat(n) + '░'.repeat(10 - n); };

module.exports = function createXp(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, db = ctx.db, cfg = () => ctx.config.get(), X = () => cfg().xp, rand = ctx.rand || ((lo, hi) => crypto.randomInt(lo, hi + 1));
  const q = {
    get: db.prepare('SELECT * FROM xp WHERE guild_id = ? AND user_id = ?'),
    put: db.prepare('INSERT INTO xp (guild_id, user_id, xp, level, last_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, last_at = excluded.last_at'),
    place: db.prepare('SELECT COUNT(*) + 1 AS n FROM xp WHERE guild_id = ? AND xp > ?'),
    top: db.prepare('SELECT user_id, xp, level FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT 10'),
    del: db.prepare('DELETE FROM xp WHERE guild_id = ? AND user_id = ?'),
  };
  /** the "5:123456" lines of the settings as [{ level, role }] */
  const roleRules = () => X().levelRoles.map((l) => /^(\d{1,3}):(\d{5,25})$/.exec(String(l).trim())).filter(Boolean).map((m) => ({ level: Number(m[1]), role: m[2] })).sort((a, b) => a.level - b.level);

  async function giveRoles(guild, member, level) {
    const me = guild.members.me || await guild.members.fetchMe();
    for (const r of roleRules()) {
      if (r.level > level || member.roles.cache.has(r.role)) continue;
      const role = guild.roles.cache.get(r.role); if (!role || whyNot(role, me.roles.highest.position, guild.id)) continue;
      await member.roles.add(r.role, 'Level ' + r.level).catch((e) => log('level role failed:', e.message));
    }
  }

  /** a human message: maybe earns XP. Returns the new level when it went up, otherwise 0 */
  async function onMessage(m) {
    const x = X(); if (!x.on || !m.guild || !m.author || m.author.bot || m.webhookId || m.system) return 0;
    if (String(m.content || '').trim().length < MIN_LENGTH) return 0;
    const t = now(), row = q.get.get(m.guild.id, m.author.id) || { xp: 0, level: 0, last_at: 0 };
    if (t - row.last_at < x.cooldown * 1000) return 0;
    const lo = Math.min(x.min, x.max), hi = Math.max(x.min, x.max), total = row.xp + rand(lo, hi), lv = levelFor(total).level;
    q.put.run(m.guild.id, m.author.id, total, lv, t);
    if (lv > row.level) {
      if (m.member) await giveRoles(m.guild, m.member, lv);
      if (x.announce) await m.channel.send({ content: '🎉 <@' + m.author.id + '> reached **level ' + lv + '**!', allowedMentions: { users: [m.author.id] } }).catch(() => {});
      return lv;
    }
    return 0;
  }

  const rank = new SlashCommandBuilder().setName('rank').setDescription('Your level and XP (or someone else\'s)').setDMPermission(false).addUserOption((o) => o.setName('user').setDescription('Another person'));
  ctx.discord.register({ data: rank, run: async (i) => {
    if (!X().on) return i.reply({ content: 'Levels are not switched on in this server.', flags: EPHEMERAL });
    const u = i.options.getUser('user') || i.user, row = q.get.get(i.guild.id, u.id) || { xp: 0 }, l = levelFor(row.xp);
    return i.reply({ embeds: [embed((u.username || u.tag || 'Rank') + ' · level ' + l.level, bar(l.into, l.next) + ' ' + l.into + ' / ' + l.next + ' XP\nTotal XP: **' + row.xp + '**\nPlace: **#' + q.place.get(i.guild.id, row.xp).n + '**', COLOR.aqua)] });
  } });
  ctx.discord.register({ data: new SlashCommandBuilder().setName('leaderboard').setDescription('The most active people (XP)').setDMPermission(false), run: async (i) => {
    if (!X().on) return i.reply({ content: 'Levels are not switched on in this server.', flags: EPHEMERAL });
    const rows = q.top.all(i.guild.id);
    return i.reply({ embeds: [embed('XP leaderboard', rows.map((r, n) => (n + 1) + '. <@' + r.user_id + '> level **' + r.level + '** · ' + r.xp + ' XP').join('\n') || 'Nobody has XP yet.', COLOR.cream)], allowedMentions: { parse: [] } });
  } });
  const adm = new SlashCommandBuilder().setName('xp').setDescription('Mods: manage XP').setDMPermission(false).setDefaultMemberPermissions(F.ManageGuild)
    .addSubcommand((s) => s.setName('reset').setDescription('Reset someone to zero XP').addUserOption((o) => o.setName('user').setDescription('The person').setRequired(true)));
  ctx.discord.register({ data: adm, run: async (i) => {
    requirePerm(i, F.ManageGuild); const u = i.options.getUser('user', true); q.del.run(i.guild.id, u.id); return i.reply({ content: 'Reset <@' + u.id + '> to zero XP.', flags: EPHEMERAL, allowedMentions: { parse: [] } }); } });

  const attach = (c) => c.on(Events.MessageCreate, (m) => onMessage(m).catch((e) => log('xp failed:', e.message)));
  return { attach, onMessage, levelFor, need, roleRules };
};
module.exports.levelFor = levelFor;
module.exports.need = need;
