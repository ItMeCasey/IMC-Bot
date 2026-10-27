'use strict';
/**
 * Starboard: when a message gets enough ⭐ reactions it is copied to #starboard (with a link back, the picture if there is one),
 * and the star count there follows the reactions. Nobody can star their own message into the board (their own ⭐ is not counted).
 * Off until switched on. Messages already in the board channel and bot messages are ignored, and so is everything in a channel that
 * @everyone cannot see or that is age-restricted (private channels never reach the board).
 */
const { Events, PermissionFlagsBits } = require('discord.js');
const { COLOR } = require('../theme');

const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

module.exports = function createStarboard(ctx) {
  const log = ctx.log || (() => {}), db = ctx.db, cfg = () => ctx.config.get(), S = () => cfg().starboard;
  const q = {
    get: db.prepare('SELECT * FROM starred WHERE message_id = ?'),
    put: db.prepare('INSERT INTO starred (message_id, guild_id, board_message_id, stars) VALUES (?, ?, ?, ?) ON CONFLICT(message_id) DO UPDATE SET board_message_id = excluded.board_message_id, stars = excluded.stars'),
    del: db.prepare('DELETE FROM starred WHERE message_id = ?'),
  };
  const payload = (m, stars) => {
    const img = m.attachments && [...m.attachments.values()].find((a) => /^image\//.test(a.contentType || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.url || ''));
    return { content: '⭐ **' + stars + '** <#' + m.channelId + '>', embeds: [{ description: cut(m.content || '', 3500) + '\n\n[Jump to the message](' + m.url + ')', color: COLOR.heat, author: { name: (m.author && (m.author.tag || m.author.username)) || 'Unknown' }, image: img ? { url: img.url } : undefined, timestamp: new Date(m.createdTimestamp || Date.now()).toISOString() }], allowedMentions: { parse: [] } };
  };

  const busy = new Set();   // messages being handled right now (two stars at once must not post twice)
  /** a ⭐ was added or removed on a message */
  async function onReaction(reaction, added) {
    const key = reaction.message && reaction.message.id; if (key && busy.has(key)) return false;
    if (key) busy.add(key);
    try { return await handle(reaction, added); } finally { if (key) busy.delete(key); }
  }
  async function handle(reaction, added) {
    const s = S(), boardId = cfg().channels.starboard; if (!s.on || !boardId) return false;
    if (reaction.partial) await reaction.fetch().catch(() => {});
    if (reaction.emoji.name !== s.emoji) return false;
    const m = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
    if (!m || !m.guild || m.channelId === boardId || (m.author && m.author.bot)) return false;
    // never copy a message out of a channel that everyone cannot see (mod, ticket and private channels) or an age-restricted one
    const ch = m.channel, seen = ch && ch.permissionsFor && m.guild.roles && m.guild.roles.everyone ? ch.permissionsFor(m.guild.roles.everyone) : null;
    if (ch && (ch.nsfw || (seen && !seen.has(PermissionFlagsBits.ViewChannel)))) return false;
    let stars = reaction.count || 0;
    if (m.author && stars) { const users = await reaction.users.fetch().catch(() => null); if (users && users.has(m.author.id)) stars--; }   // their own star does not count
    const had = q.get.get(m.id), board = await ctx.fetchChannel(boardId); if (!board) return false;
    if (!had) {
      if (!added || stars < s.threshold) return false;
      const posted = await board.send(payload(m, stars)); q.put.run(m.id, m.guild.id, posted.id, stars); return true;
    }
    if (stars <= 0) { await board.messages.delete(had.board_message_id).catch(() => {}); q.del.run(m.id); return true; }
    if (stars !== had.stars) { await board.messages.edit(had.board_message_id, payload(m, stars)).catch((e) => log('starboard edit failed:', e.message)); q.put.run(m.id, m.guild.id, had.board_message_id, stars); }
    return true;
  }
  const attach = (c) => { c.on(Events.MessageReactionAdd, (r) => onReaction(r, true).catch((e) => log('starboard failed:', e.message))); c.on(Events.MessageReactionRemove, (r) => onReaction(r, false).catch((e) => log('starboard failed:', e.message))); };
  return { attach, onReaction };
};
