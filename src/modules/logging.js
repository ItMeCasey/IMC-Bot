'use strict';
/**
 * Server log: what happened in the server, written to #audit-log (mods only): deleted and edited messages, people joining and leaving,
 * nickname and role changes, voice channel moves. Each group can be switched off. Bots are left out, and nothing here can ping anybody.
 * (Moderation actions have their own log, #mod-log.)
 */
const { Events } = require('discord.js');
const { COLOR } = require('../theme');

const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const who = (u) => '<@' + u.id + '> (' + (u.tag || u.username || u.id) + ')';
const ago = (ms) => { const d = Math.floor(ms / 86400000); return d >= 1 ? d + ' d' : Math.max(1, Math.round(ms / 60000)) + ' min'; };

module.exports = function createLogging(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, cfg = () => ctx.config.get(), L = () => cfg().logging;

  async function send(group, title, description, color, fields) {
    const l = L(); if (!l.on || !l[group]) return;
    const id = cfg().channels.auditLog; if (!id) return;
    try { const ch = await ctx.fetchChannel(id); if (ch) await ch.send({ embeds: [{ title, description: cut(description, 3000), color: color || COLOR.cream, fields: fields || [], timestamp: new Date(now()).toISOString() }], allowedMentions: { parse: [] } }); } catch (e) { log('audit log failed:', e.message); }
  }

  const onDelete = async (m) => {
    if (!m.guild || (m.author && m.author.bot)) return;
    const body = m.content ? cut(m.content, 1500) : '*(the text was not saved: an older message)*', att = m.attachments && m.attachments.size ? '\n+ ' + m.attachments.size + ' attachment(s)' : '';
    await send('messages', 'Message deleted', (m.author ? 'By ' + who(m.author) : 'Author unknown') + ' in <#' + m.channelId + '>\n> ' + body.split('\n').join('\n> ') + att, COLOR.heat);
  };
  const onEdit = async (a, b) => {
    if (!b.guild || (b.author && b.author.bot) || a.content === b.content || a.content == null || b.content == null) return;
    await send('messages', 'Message edited', who(b.author) + ' in <#' + b.channelId + '> ([jump](' + b.url + '))', COLOR.cream, [{ name: 'Before', value: cut(a.content || '(empty)', 1000) }, { name: 'After', value: cut(b.content || '(empty)', 1000) }]);
  };
  const onJoin = (m) => (m.user.bot ? undefined : send('members', 'Member joined', who(m.user) + '\nAccount made ' + ago(now() - m.user.createdTimestamp) + ' ago', COLOR.aqua));
  const onLeave = (m) => (m.user.bot ? undefined : send('members', 'Member left', who(m.user) + (m.joinedTimestamp ? '\nWas here for ' + ago(now() - m.joinedTimestamp) : ''), COLOR.cream));
  async function onMemberUpdate(a, b) {
    if (b.user.bot) return;
    if (a.nickname !== b.nickname) await send('members', 'Nickname changed', who(b.user) + '\n' + (a.nickname || '(none)') + ' → ' + (b.nickname || '(none)'), COLOR.cream);
    const before = new Set(a.roles.cache.keys()), after = new Set(b.roles.cache.keys());
    const add = [...after].filter((r) => !before.has(r)), del = [...before].filter((r) => !after.has(r));
    if (add.length || del.length) await send('roles', 'Roles changed', who(b.user) + (add.length ? '\n+ ' + add.map((r) => '<@&' + r + '>').join(' ') : '') + (del.length ? '\n− ' + del.map((r) => '<@&' + r + '>').join(' ') : ''), COLOR.cream);
  }
  async function onVoice(a, b) {
    const u = (b.member || a.member); if (!u || u.user.bot || a.channelId === b.channelId) return;
    const text = !a.channelId ? 'joined <#' + b.channelId + '>' : !b.channelId ? 'left <#' + a.channelId + '>' : 'moved <#' + a.channelId + '> → <#' + b.channelId + '>';
    await send('voice', 'Voice', who(u.user) + ' ' + text, COLOR.cream);
  }
  const safe = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => log('audit log failed:', e.message));
  const attach = (c) => { c.on(Events.MessageDelete, safe(onDelete)); c.on(Events.MessageUpdate, safe(onEdit)); c.on(Events.GuildMemberAdd, safe(onJoin)); c.on(Events.GuildMemberRemove, safe(onLeave)); c.on(Events.GuildMemberUpdate, safe(onMemberUpdate)); c.on(Events.VoiceStateUpdate, safe(onVoice)); };
  return { attach, onDelete, onEdit, onJoin, onLeave, onMemberUpdate, onVoice };
};
