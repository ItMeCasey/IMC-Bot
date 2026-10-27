'use strict';
/**
 * The dashboard server (http://localhost:8430). It only answers this PC: a Host header that is not this machine is refused
 * (DNS-rebinding tricks from web pages), and so is any request that comes from another web page (Origin check).
 * The bot token is accepted here but never sent back: the page only learns whether one is set.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const isLoopback = (ip) => !ip || ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
const hostOk = (h) => ['localhost', '127.0.0.1', '::1', ''].includes(String(h || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));

module.exports = function createWeb(ctx) {
  const log = ctx.log || (() => {}), PUB = ctx.publicDir;
  const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

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
    'POST connect': async () => { await ctx.discord.start(); return status(); },
    'POST plan': async () => ctx.setup.plan(await ctx.discord.guild()),
    'POST setup': async () => { const r = await ctx.setup.apply(await ctx.discord.guild()); await ctx.discord.registerCommands().catch((e) => log('slash commands:', e.message)); return r; },
  };

  function handler(req, res) {
    if (!hostOk(req.headers.host) || !isLoopback(req.socket.remoteAddress)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('Blocked'); }
    const u = new URL(req.url, 'http://localhost'), p = u.pathname;
    if (p.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (req.method !== 'GET' && origin && !hostOk(new URL(origin).host)) return json(res, 403, { error: 'Blocked: request from another site' });
      const route = routes[req.method + ' ' + p.slice(5)];
      if (!route) return json(res, 404, { error: 'Unknown action' });
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
      req.on('end', async () => {
        try { json(res, 200, await route(raw ? JSON.parse(raw) : {})); } catch (e) { json(res, e.status || 400, { error: e.message }); }
      });
      return undefined;
    }
    const file = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
    if (!file.startsWith(PUB) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return undefined;
  }

  const server = http.createServer(handler);
  return { server, listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
};
module.exports.hostOk = hostOk;
