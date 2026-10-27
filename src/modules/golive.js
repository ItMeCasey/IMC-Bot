'use strict';
/**
 * Go-live posts and the recap post.
 *  - The stream starts: one message in #go-live (title, game, thumbnail, watch link, optional ping).
 *  - The title or game changes: the same message is edited. The stream ends: it is edited again (how long, peak viewers) and the ping is dropped.
 *  - A stream that drops and comes back within 5 minutes is the same stream: the message is edited, not posted again.
 *  - A recap from IMC-Stream goes to #announcements.
 * It remembers the message in the database, so a restart in the middle of a stream does not post it twice.
 */
const { COLOR, embed } = require('../theme');

const SAME_STREAM_MS = 5 * 60000;
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const fmtDuration = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };

module.exports = function createGoLive(ctx) {
  const log = ctx.log || (() => {}), kv = ctx.kv, now = ctx.now || Date.now, wait = ctx.wait || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const delayMs = ctx.delayMs == null ? 20000 : ctx.delayMs;   // a moment after the start, so IMC-Stream knows the title and game
  const load = () => { try { return JSON.parse(kv.get('golive') || 'null'); } catch (e) { return null; } };
  const save = (s) => kv.set('golive', JSON.stringify(s));

  const channel = (id) => ctx.channel(id);
  const url = (snap) => (snap.login ? 'https://twitch.tv/' + snap.login : '');
  const pingText = (p) => (p === 'everyone' ? '@everyone ' : p === 'here' ? '@here ' : /^\d{5,25}$/.test(p || '') ? '<@&' + p + '> ' : '');
  const mentions = (p) => ({ parse: p === 'everyone' || p === 'here' ? ['everyone'] : [], roles: /^\d{5,25}$/.test(p || '') ? [p] : [] });

  function livePayload(snap, ended) {
    const link = url(snap), name = snap.name || snap.login || 'The stream';
    const lines = [];
    if (snap.game) lines.push('**Playing:** ' + snap.game);
    if (ended) lines.push('**Streamed for:** ' + fmtDuration(ended.endedAt - ended.startedAt), '**Peak viewers:** ' + (ended.peakViewers || 0));
    else if (link) lines.push('**Watch:** ' + link);
    const e = embed(cut(snap.title || (ended ? 'Stream ended' : 'Live now'), 250), lines.join('\n'), ended ? COLOR.cream : COLOR.rust, Object.assign(link ? { url: link } : {},
      snap.login && !ended ? { image: { url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_' + snap.login.toLowerCase() + '-1280x720.jpg?t=' + Math.floor(now() / 60000) } } : {}));
    const p = ctx.config.get().goLive.ping;
    return { content: ended ? name + ' was live' : pingText(p) + name + ' is live!', embeds: [e], allowedMentions: mentions(ended ? '' : p) };
  }

  /** the stream just started (or the bot found it already running) */
  async function started(snap) {
    const cfg = ctx.config.get(), chId = cfg.channels.goLive;
    if (!cfg.goLive.on || !chId) return false;
    const st = load();
    if (st && st.startedAt === snap.startedAt) return false;   // already announced this very stream
    const ch = await channel(chId); if (!ch) return false;
    if (st && st.endedAt && st.messageId && now() - st.endedAt < SAME_STREAM_MS) {   // it dropped and came back
      await ch.messages.edit(st.messageId, livePayload(snap)).catch((e) => log('go-live edit failed:', e.message));
      save({ ...st, startedAt: snap.startedAt || st.startedAt, endedAt: 0, title: snap.title, game: snap.game }); return true;
    }
    const m = await ch.send(livePayload(snap));
    save({ startedAt: snap.startedAt, messageId: m.id, channelId: chId, title: snap.title, game: snap.game, login: snap.login, name: snap.name, endedAt: 0, peakViewers: 0 });
    return true;
  }
  async function updated(d) {
    const st = load(); if (!st || st.endedAt || !st.messageId) return;
    const ch = await channel(st.channelId); if (!ch) return;
    const next = { ...st, title: d.title || st.title, game: d.game || st.game };
    await ch.messages.edit(st.messageId, livePayload(next)); save(next);
  }
  async function ended(d) {
    const st = load(); if (!st || st.endedAt || !st.messageId) return;
    const endedAt = Date.parse(d.endedAt) || now(), startedAt = Date.parse(d.startedAt || st.startedAt) || endedAt;
    const next = { ...st, endedAt, peakViewers: d.peakViewers || 0 };
    const ch = await channel(st.channelId); save(next); if (!ch) return;
    await ch.messages.edit(st.messageId, livePayload(next, { endedAt, startedAt, peakViewers: next.peakViewers }));
  }
  async function recap(d) {
    const id = ctx.config.get().channels.announcements; if (!id || !d.text) return;
    const ch = await channel(id); if (!ch) return;
    await ch.send({ embeds: [embed('Stream recap', cut(d.text, 3900), COLOR.aqua)], allowedMentions: { parse: [] } });
  }

  /** the listener for the bridge */
  async function onEvent(ev) {
    if (ev.type === 'stream.online') { if (delayMs) await wait(delayMs); const snap = await ctx.snapshot(); if (ev.data.startedAt) snap.startedAt = ev.data.startedAt; return started(snap); }
    if (ev.type === 'stream.update') return updated(ev.data);
    if (ev.type === 'stream.offline') return ended(ev.data);
    if (ev.type === 'recap') return recap(ev.data);
    return undefined;
  }
  /** at start-up: a stream that is already running and has not been announced */
  async function catchUp() { const snap = await ctx.snapshot(); if (snap.live) await started(snap); }
  return { onEvent, catchUp, started, updated, ended, recap };
};
module.exports.fmtDuration = fmtDuration;
