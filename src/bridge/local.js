'use strict';
/**
 * The link to IMC-Stream (on the same PC, or on another computer that IMC-Stream lets in with its remote-access password). IMC-Stream keeps a short list of what happened (stream online / offline /
 * update, a new recap) and this asks for everything after the last number it saw, every few seconds. Nothing is lost when the bot
 * restarts, and nothing old is replayed on the very first start.
 * When IMC-Stream is on another computer, it asks for the remote-access password; the bot logs in with it (saved only on this PC) and keeps the session.
 */
const TIMEOUT_MS = 10000;   // a request to IMC-Stream that takes longer than this is given up (a hung program must not stall the bot)

module.exports = function createLocalBridge(ctx) {
  const log = ctx.log || (() => {}), doFetch = ctx.fetch || ((...a) => fetch(...a)), sleep = ctx.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const kv = ctx.kv, every = ctx.pollMs || 3000, handlers = [];
  let timer = null, running = false, status = { state: 'offline', error: '', lastOk: 0 }, cursor = Number(kv.get('bridge.cursor') || 0), boot = kv.get('bridge.boot') || '';

  const base = () => String(ctx.config.get().bridge.url || '').replace(/\/+$/, '');
  const password = () => (ctx.config.secret ? ctx.config.secret('bridgePassword') : '');
  let cookie = '', cookieFor = '';
  /** log in to IMC-Stream's remote access (the same password as its Setup page) and keep the session cookie */
  async function login() {
    const r = await doFetch(base() + '/api/login', { signal: AbortSignal.timeout(TIMEOUT_MS), method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ password: password() }) });
    if (r.status === 401) throw new Error('IMC-Stream did not accept that password');
    if (r.status === 429) throw new Error('IMC-Stream says too many tries: wait a minute');
    if (!r.ok) throw new Error('IMC-Stream answered HTTP ' + r.status + ' to the login');
    const list = r.headers && (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get && r.headers.get('set-cookie')]), c = (list || []).filter(Boolean).map((x) => /icm_session=[a-f0-9]+/.exec(x)).find(Boolean);
    if (!c) throw new Error('IMC-Stream did not start a session');
    cookie = c[0]; cookieFor = base() + '|' + password();
  }
  /** one request to IMC-Stream, logging in first when a password is set, and again when the session ended */
  async function request(method, p, body, retried) {
    if (cookieFor && cookieFor !== base() + '|' + password()) { cookie = ''; cookieFor = ''; }   // the address or password was changed
    if (!cookie && password()) await login();
    const headers = Object.assign({ Accept: 'application/json' }, cookie ? { Cookie: cookie } : {}, body === undefined ? {} : { 'Content-Type': 'application/json' });
    const r = await doFetch(base() + p, body === undefined ? { method, headers, signal: AbortSignal.timeout(TIMEOUT_MS) } : { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ((r.status === 401 || r.status === 403) && !retried) {   // not (or no longer) logged in
      if (password()) { cookie = ''; await login(); return request(method, p, body, true); }
      throw new Error(r.status === 401 ? 'IMC-Stream asks for its remote-access password: enter it in the dashboard' : 'IMC-Stream refuses this computer: switch on remote access in its Setup page (and set a password)');
    }
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j && j.error) || 'IMC-Stream answered HTTP ' + r.status + (r.status === 404 ? ' (update IMC-Stream to a version with the bridge)' : '')); }
    return r.json();
  }
  const get = (p) => request('GET', p);

  /** what is true right now: live, title, game, viewers, startedAt, login, website */
  const snapshot = () => get('/api/bridge/state');
  /** the lists the viewer commands answer from: commands, games, points top, text-to-speech help */
  const info = () => get('/api/bridge/info');
  /** the next streams from the Twitch schedule: { segments: [{ start, end, title, category, canceled }] } */
  const schedule = () => get('/api/bridge/schedule');
  /** profile pictures of chatters: { userId: https url } */
  const avatars = (ids) => get('/api/bridge/avatars?ids=' + ids.map(encodeURIComponent).join(','));
  /** show a Discord event as an alert on stream: event is discord_boost, discord_join or discord_milestone; returns { ok, shown } */
  const alert = (event, vars) => request('POST', '/api/bridge/alert', { event, vars });
  const on = (fn) => handlers.push(fn);

  /** one round: ask for news, hand each event to the listeners. Returns how many were new */
  async function poll(again) {
    let r;
    try { r = await get('/api/bridge/events?since=' + cursor + (ctx.wantChat && ctx.wantChat() ? '&chat=1' : '')); } catch (e) {
      const was = status.state; status = { state: 'offline', error: /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timed out|aborted/i.test(e.message) ? (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(base()) ? 'IMC-Stream is not running' : 'IMC-Stream is not reachable at that address') : e.message, lastOk: status.lastOk };
      if (was === 'connected') log('bridge: lost IMC-Stream:', status.error);
      return 0;
    }
    if (status.state !== 'connected') log('bridge: connected to IMC-Stream');
    status = { state: 'connected', error: '', lastOk: Date.now() };
    let events = r.events || [];
    if (r.boot !== boot) {   // IMC-Stream restarted (or this is the first start): the numbers began again; do not replay what came before we looked
      const first = !boot; boot = r.boot; cursor = 0; kv.set('bridge.boot', boot); kv.set('bridge.cursor', '0');
      if (!first) return again ? 0 : poll(true);   // asked once more from the start of the new run (not again if the run id keeps changing)   // ask again from the start of the new run: the answer above was for the old numbers
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
  return { start, stop, poll, on, snapshot, info, schedule, avatars, alert, sleep, status: () => status };
};
