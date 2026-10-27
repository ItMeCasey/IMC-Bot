'use strict';
/**
 * The dashboard server (http://localhost:8440). It only answers this PC:
 *  - a Host header that is not this machine is refused (DNS-rebinding tricks from web pages),
 *  - a request from a non-local address is refused,
 *  - a request that changes anything must come from the dashboard's own page: its Origin has to be exactly this server (scheme, host AND port),
 *    so a page on another local port or another site cannot use the API.
 * Every answer carries strict security headers (the page may only run its own script, and cannot be put in a frame).
 * The bot token is accepted here but never sent back: the page only learns whether one is set.
 * A bug in one request can never stop the bot: the handler catches everything.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// the page runs only its own scripts (no inline script, nothing from other sites) and may not be framed
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
};
const isLoopback = (ip) => !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
const hostOk = (h) => ['localhost', '127.0.0.1', '::1', ''].includes(String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));

/** may this request change anything? An Origin (every browser sends one on a POST) must be exactly this server; "null" and other sites fail. A browser that says the request is cross-site fails too. Programs that send neither header are let in (they are already on this PC). */
function postAllowed(headers) {
  const o = headers.origin;
  if (o !== undefined) { try { const u = new URL(o); return u.protocol === 'http:' && u.host.toLowerCase() === String(headers.host || '').toLowerCase(); } catch (e) { return false; } }
  const site = String(headers['sec-fetch-site'] || '').toLowerCase();
  return site === '' || site === 'same-origin' || site === 'none';
}

module.exports = function createWeb(ctx) {
  const log = ctx.log || (() => {}), PUB = path.resolve(ctx.publicDir);
  const send = (res, code, body, type, extra) => { res.writeHead(code, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, SECURITY_HEADERS, extra)); res.end(body); };
  const json = (res, code, o) => send(res, code, JSON.stringify(o), 'application/json');

  const status = () => ({ bot: ctx.discord.status(), bridge: ctx.bridge ? ctx.bridge.status() : { state: 'offline', error: '', lastOk: 0 }, settings: ctx.config.view(), guilds: ctx.discord.guilds() });

  const routes = {
    'GET status': async () => status(),
    'POST settings': async (b) => {
      const tokenChanged = typeof b.token === 'string' && b.token.trim() || b.clearToken;
      ctx.config.set(b);
      if (b.clearToken) await ctx.discord.stop();
      else if (tokenChanged) await ctx.discord.start();
      else if (b.guildId !== undefined) await ctx.discord.registerCommands().catch((e) => log('slash commands:', e.message));
      return status();
    },
    /** the dashboard's test button: shows a pretend server boost on stream, so the whole way (bot, IMC-Stream, overlay) can be checked */
    'POST test-stream-alert': async () => {
      if (!ctx.bridge) throw new Error('The link to IMC-Stream is not running yet');
      const r = await ctx.bridge.alert('discord_boost', { name: 'TestBooster', boosts: 1, level: 1 });
      return { ok: true, shown: !!(r && r.shown) };
    },
    'POST connect': async () => { await ctx.discord.start(); return status(); },
    'POST plan': async () => ctx.setup.plan(await ctx.discord.guild()),
    'POST setup': async () => { const r = await ctx.setup.apply(await ctx.discord.guild()); await ctx.discord.registerCommands().catch((e) => log('slash commands:', e.message)); return r; },
  };

  function handle(req, res) {
    if (!hostOk(req.headers.host) || !isLoopback(req.socket.remoteAddress)) return send(res, 403, 'Blocked', 'text/plain');
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
    if (p.startsWith('/api/')) {
      if (req.method !== 'GET' && !postAllowed(req.headers)) return json(res, 403, { error: 'Blocked: this request did not come from the dashboard page' });
      const route = routes[req.method + ' ' + p.slice(5)];
      if (!route) return json(res, 404, { error: 'Unknown action' });
      let raw = '', tooBig = false;
      req.on('data', (c) => { raw += c; if (raw.length > 1e5) { tooBig = true; req.destroy(); } });
      req.on('error', () => { /* the client went away */ });
      req.on('end', async () => {
        if (tooBig) return;
        try { json(res, 200, await route(raw ? JSON.parse(raw) : {})); } catch (e) { try { json(res, e.status || 400, { error: e.message }); } catch (x) { /* already answered */ } }
      });
      return undefined;
    }
    if (p.includes('\0')) return send(res, 400, 'Bad request', 'text/plain');
    const file = path.resolve(PUB, '.' + (p === '/' ? '/index.html' : p));
    if (!(file === PUB || file.startsWith(PUB + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }, SECURITY_HEADERS));
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return undefined;
  }
  const handler = (req, res) => { try { handle(req, res); } catch (e) { log('dashboard request failed:', e.message); try { send(res, 500, 'Error', 'text/plain'); } catch (x) { res.destroy(); } } };

  const server = http.createServer(handler);
  server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* gone */ } });
  return { server, listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
};
module.exports.hostOk = hostOk;
module.exports.postAllowed = postAllowed;
