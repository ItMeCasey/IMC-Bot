'use strict';
/**
 * The Twitch chat mirror: every chat message of the stream appears in #twitch-chat, under the chatter's name (through a webhook).
 *  - Off until switched on in the dashboard. Reads chat from IMC-Stream through the bridge.
 *  - Leaves out commands, known bots, people on the ignore list, and (if asked) everyone who is not a sub / VIP.
 *  - Nothing in a chat message can ping anybody on Discord (@everyone and @someone are made harmless).
 *  - When Twitch deletes a message, times someone out or clears chat, the mirrored lines disappear too.
 *  - A flood is slowed down: at most a few lines per second go out, and the rest are counted ("12 messages skipped").
 */
const { escapeMarkdown } = require('discord.js');

const KEEP_TYPES = new Set(['text', 'channel_points_highlighted', 'user_intro']);
const BADGE_ICON = { broadcaster: '📺', moderator: '🗡️', vip: '💎', subscriber: '⭐', founder: '⭐' };
const ROLE_NEEDS = { subs: ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder'], vip: ['broadcaster', 'moderator', 'vip'] };
const MAX_QUEUE = 40, PER_FLUSH = 4, REMEMBER = 600;

const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
/** a webhook name may not contain "discord" or "clyde" and needs 1 to 80 characters */
const safeName = (n) => (String(n || 'viewer').replace(/discord/gi, 'D1scord').replace(/clyde/gi, 'Cl_de').replace(/[@#:`]/g, '').trim() || 'viewer').slice(0, 80);

module.exports = function createMirror(ctx) {
  const log = ctx.log || (() => {}), cfg = () => ctx.config.get(), M = () => cfg().mirror;
  let queue = [], skipped = 0, timer = null;
  const pics = new Map();   // twitch user id -> { at, url } (a missing picture is remembered for a few minutes so it is not asked for again and again)
  const sent = new Map();   // twitch message id -> { uid, discordId, channelId }, the last few, so a delete can follow

  const link = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
  const invite = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg)\/[a-z0-9-]+/gi;   // a Discord invite is never passed on, whatever the link setting
  /** the line for Discord, or null when this message should not be mirrored */
  function render(d) {
    const m = M();
    if (!KEEP_TYPES.has(d.type || 'text')) return null;
    const login = String(d.login || '').toLowerCase(), text = String(d.text || '').trim(); if (!text) return null;
    if (m.hideBots.includes(login) || m.ignore.includes(login)) return null;
    if (m.hideCommands && m.commandPrefixes.some((p) => text.startsWith(p))) return null;
    const badges = d.badges || [];
    if (m.minRole !== 'all' && !ROLE_NEEDS[m.minRole].some((b) => badges.includes(b))) return null;
    let body = escapeMarkdown(cut((m.stripLinks ? text.replace(link, '[link]') : text).replace(invite, '[invite]'), 1500));
    body = body.replace(/@(everyone|here)/gi, '@​$1').replace(/<(@[!&]?|#)(\d+)>/g, '<​$1$2>');   // no pings, whatever Twitch users type
    const icons = m.showBadges ? [...new Set(badges.map((b) => BADGE_ICON[b]).filter(Boolean))].join('') : '';
    const reply = d.reply ? '↪ **' + escapeMarkdown(cut(d.reply.name || '', 40)) + '**: ' + escapeMarkdown(cut(d.reply.text || '', 80)) + '\n' : '';
    return { username: safeName(d.name || d.login), content: cut(reply + (icons ? icons + ' ' : '') + body, 2000), uid: d.uid, id: d.id };
  }

  /** from the bridge: a chat event */
  function onEvent(ev) {
    const m = M(); if (!m.on || !cfg().channels.mirror) return;
    if (ev.type === 'chat.message') {
      const r = render(ev.data); if (!r) return;
      queue.push(r); if (queue.length > MAX_QUEUE) { queue.shift(); skipped++; }
    } else if (ev.type === 'chat.delete') drop((e) => e.id === ev.data.id);
    else if (ev.type === 'chat.clearUser') { queue = queue.filter((q) => q.uid !== ev.data.uid); drop((e) => e.uid === ev.data.uid); }
    else if (ev.type === 'chat.clear') { queue = []; drop(() => true); }
  }
  /** take back lines that were already sent (and forget those still waiting that match) */
  function drop(match) {
    queue = queue.filter((q) => !match({ id: q.id, uid: q.uid }));
    for (const [id, e] of [...sent]) if (match({ id, uid: e.uid })) { sent.delete(id); ctx.getWebhook(e.channelId).then((w) => w && w.deleteMessage(e.discordId)).catch((err) => log('mirror delete failed:', err.message)); }
  }

  /** profile pictures for the people in this batch: { userId: url }. Asked from IMC-Stream in one request; a failure just means no pictures */
  async function avatarsFor(batch) {
    if (!M().avatars || !ctx.avatars) return {};
    const t = Date.now(), need = [...new Set(batch.map((r) => r.uid).filter((u) => u && !(pics.get(u) && t - pics.get(u).at < (pics.get(u).url ? 6 * 3600000 : 300000))))];
    if (need.length) {
      let got = {}; try { got = (await ctx.avatars(need)) || {}; } catch (e) { log('mirror avatars failed:', e.message); }
      for (const u of need) pics.set(u, { at: t, url: /^https:\/\//.test(got[u] || '') ? got[u] : '' });
      if (pics.size > 2000) for (const k of [...pics.keys()].slice(0, 500)) pics.delete(k);
    }
    const out = {}; for (const r of batch) if (pics.get(r.uid) && pics.get(r.uid).url) out[r.uid] = pics.get(r.uid).url;
    return out;
  }

  /** send the next few lines (called every second) */
  async function flush() {
    const chId = cfg().channels.mirror; if (!M().on || !chId || (!queue.length && !skipped)) return 0;
    const hook = await ctx.getWebhook(chId); if (!hook) return 0;
    if (skipped) { const n = skipped; skipped = 0; await hook.send({ username: 'IMC-Bot', content: '*' + n + ' messages skipped (chat is moving fast)*', allowedMentions: { parse: [] } }).catch(() => {}); }
    const batch = queue.splice(0, PER_FLUSH), pic = await avatarsFor(batch);
    for (const r of batch) {
      try {
        const msg = await hook.send({ username: r.username, avatarURL: pic[r.uid] || undefined, content: r.content, allowedMentions: { parse: [] } });
        if (r.id && msg) { sent.set(r.id, { uid: r.uid, discordId: msg.id, channelId: chId }); if (sent.size > REMEMBER) sent.delete(sent.keys().next().value); }
      } catch (e) { log('mirror send failed:', e.message); if (ctx.forgetWebhook) ctx.forgetWebhook(chId); }
    }
    return batch.length;
  }
  const start = () => { if (!timer) { timer = setInterval(() => flush().catch((e) => log('mirror failed:', e.message)), 1000); if (timer.unref) timer.unref(); } };
  const stop = () => { clearInterval(timer); timer = null; queue = []; };
  return { onEvent, flush, start, stop, render, _queue: () => queue, _sent: sent };
};
module.exports.safeName = safeName;
