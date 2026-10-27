'use strict';
/**
 * The link to IMC-Stream when both run on the same PC. IMC-Stream keeps a short list of what happened (stream online / offline /
 * update, a new recap) and this asks for everything after the last number it saw, every few seconds. Nothing is lost when the bot
 * restarts, and nothing old is replayed on the very first start.
 * (Later, a relay can carry the same events when the bot runs on another computer.)
 */
module.exports = function createLocalBridge(ctx) {
  const log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a)), sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const kv = ctx.kv, every = ctx.pollMs || 3000, handlers = [];
  let timer = null, running = false, status = { state: 'offline', error: '', lastOk: 0 }, cursor = Number(kv.get('bridge.cursor') || 0), boot = kv.get('bridge.boot') || '';

  const base = () => String(ctx.config.get().bridge.url || '').replace(/\/+$/, '');
  async function get(p) {
    const r = await doFetch(base() + p, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('IMC-Stream answered HTTP ' + r.status + (r.status === 404 ? ' (update IMC-Stream to a version with the bridge)' : ''));
    return r.json();
  }
  /** what is true right now: live, title, game, viewers, startedAt, login, website */
  const snapshot = () => get('/api/bridge/state');
  /** the lists the viewer commands answer from: commands, games, points top, text-to-speech help */
  const info = () => get('/api/bridge/info');
  /** the next streams from the Twitch schedule: { segments: [{ start, end, title, category, canceled }] } */
  const schedule = () => get('/api/bridge/schedule');
  const on = (fn) => handlers.push(fn);

  /** one round: ask for news, hand each event to the listeners. Returns how many were new */
  async function poll() {
    let r;
    try { r = await get('/api/bridge/events?since=' + cursor + (ctx.wantChat && ctx.wantChat() ? '&chat=1' : '')); } catch (e) {
      const was = status.state; status = { state: 'offline', error: /fetch failed|ECONNREFUSED/i.test(e.message) ? 'IMC-Stream is not running' : e.message, lastOk: status.lastOk };
      if (was === 'connected') log('bridge: lost IMC-Stream:', status.error);
      return 0;
    }
    if (status.state !== 'connected') log('bridge: connected to IMC-Stream');
    status = { state: 'connected', error: '', lastOk: Date.now() };
    let events = r.events || [];
    if (r.boot !== boot) {   // IMC-Stream restarted (or this is the first start): the numbers began again; do not replay what came before we looked
      const first = !boot; boot = r.boot; cursor = 0; kv.set('bridge.boot', boot); kv.set('bridge.cursor', '0');
      if (!first) return poll();   // ask again from the start of the new run: the answer above was for the old numbers
      cursor = r.cursor; kv.set('bridge.cursor', String(cursor)); events = []; if (ctx.onConnect) await Promise.resolve(ctx.onConnect()).catch((e) => log('bridge connect hook failed:', e.message)); return 0;
    }
    for (const ev of events) {
      for (const h of handlers) { try { await h(ev); } catch (e) { log('bridge event', ev.type, 'failed:', e.message); } }
      cursor = ev.id; kv.set('bridge.cursor', String(cursor));
    }
    if (!events.length && r.cursor > cursor) { cursor = r.cursor; kv.set('bridge.cursor', String(cursor)); }
    return events.length;
  }

  function start() {
    if (running) return; running = true;
    const loop = async () => { if (!running) return; await poll().catch((e) => log('bridge poll failed:', e.message)); if (running) timer = setTimeout(loop, ctx.wantChat && ctx.wantChat() ? Math.min(every, 1500) : every); };
    loop();
  }
  function stop() { running = false; clearTimeout(timer); }
  return { start, stop, poll, on, snapshot, info, schedule, sleep, status: () => status };
};
