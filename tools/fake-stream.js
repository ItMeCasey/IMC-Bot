'use strict';
/**
 * A stand-in for IMC-Stream, to try the bot without streaming:  node tools/fake-stream.js   (then open http://localhost:8420)
 * It answers the same bridge routes as IMC-Stream and has buttons that make a stream start, change, end, a recap appear, and chat lines arrive.
 * Do not run it while the real IMC-Stream is running (they would use the same port).
 */
const http = require('node:http');

function createFake(opts) {
  const now = (opts && opts.now) || Date.now, boot = 'fake' + Math.random().toString(36).slice(2, 6);
  const S = { live: false, title: 'Playing some Tetris', game: 'Tetris', viewers: 0, startedAt: '', peakViewers: 0, login: (opts && opts.login) || 'itmecasey', name: (opts && opts.name) || 'ItMeCasey', website: '' };
  let seq = 0, events = [], chatUntil = 0, n = 0; const alerts = [];
  const pub = (type, data) => { if (type.startsWith('chat.') && now() > chatUntil) return; events.push({ id: ++seq, ts: now(), type, data }); events = events.slice(-500); };
  const actions = {
    online: () => { Object.assign(S, { live: true, startedAt: new Date(now()).toISOString(), viewers: 12, peakViewers: 12 }); pub('stream.online', { startedAt: S.startedAt }); },
    update: (q) => { if (q.title) S.title = q.title; if (q.game) S.game = q.game; pub('stream.update', { title: S.title, game: S.game }); },
    offline: () => { const startedAt = S.startedAt; S.live = false; S.viewers = 0; pub('stream.offline', { startedAt, endedAt: new Date(now()).toISOString(), peakViewers: S.peakViewers }); S.startedAt = ''; },
    recap: () => pub('recap', { id: 'fake', text: 'Chat talked about Tetris, a very close game, and who has the best snacks. Shout-out to everyone who stopped by!', messages: 120 }),
    chat: (q) => pub('chat.message', { id: q.id || 'f' + ++n, uid: 'u-' + (q.name || 'Viewer'), login: String(q.name || 'viewer').toLowerCase(), name: q.name || 'Viewer', color: '', badges: String(q.badges || '').split(',').filter(Boolean), text: q.text || 'Hello from the fake chat!', type: 'text', reply: null }),
    delete: (q) => pub('chat.delete', { type: 'delete', id: q.id }),
    clearUser: (q) => pub('chat.clearUser', { type: 'clearUser', uid: 'u-' + q.name }),
    clear: () => pub('chat.clear', { type: 'clear' }),
    raid: (q) => pub('raid', { name: q.name || 'FriendlyStreamer', viewers: Number(q.viewers) || 25, uid: 'r1' }),
    follow: (q) => pub('follow', { name: q.name || 'NewFan', uid: 'f1', total: Number(q.total) || 100 }),
  };
  const INFO = { commands: { custom: [['!discord', 'Everyone', 'Join our Discord']], groups: { Games: [['!duel <name>', 'Everyone', 'Challenge someone'], ['!gamble <amount>', 'Everyone', 'Bet your coins']], 'Mods only': [['!ban <name>', 'Mods', 'Ban someone']] } },
    top: [{ name: 'Sam', pts: 1200 }, { name: 'Pat', pts: 800 }], games: [{ name: 'Duel', how: '!duel <name>' }, { name: 'Boss raid', how: '!boss' }], tts: { reward: true, command: true, prefix: '!', sfx: ['airhorn', 'ding'] } };
  const PAGE = '<!doctype html><meta charset=utf-8><title>Fake IMC-Stream</title><body style="background:#222A2A;color:#E2DAC2;font-family:Bahnschrift,Segoe UI,sans-serif;padding:24px;max-width:760px"><h2 style="color:#F39120;letter-spacing:4px">FAKE IMC-STREAM</h2><p>Stand-in for the bridge. Press a button, then look in Discord.</p>' +
    [['online', 'Stream starts'], ['update?title=New+title+now&game=Chess', 'Title and game change'], ['offline', 'Stream ends'], ['recap', 'Recap appears'], ['chat?name=Sam&text=Hello+from+Twitch!&badges=subscriber', 'Chat: Sam (sub)'], ['chat?name=ModMike&text=Be+nice+everyone&badges=moderator', 'Chat: ModMike (mod)'], ['chat?name=Pat&text=!points', 'Chat: a command'], ['chat?name=Spam&text=%40everyone+free+stuff', 'Chat: @everyone'], ['raid?name=FriendlyStreamer&viewers=25', 'Raid arrives'], ['follow?total=100', 'Follower number 100'], ['alerts', 'Show alerts received from the bot'], ['clearUser?name=Sam', 'Time out Sam'], ['clear', 'Clear chat']]
      .map(([p, t]) => '<button style="font:inherit;font-weight:700;margin:4px;padding:10px 14px;background:#F39120;border:0;cursor:pointer" onclick="fetch(\'/fake/' + p + '\').then(r=>r.text()).then(t=>s.textContent=t)">' + t + '</button>').join('') + '<pre id=s style="color:#4FBBBC"></pre>';

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost'), p = u.pathname, q = Object.fromEntries(u.searchParams), send = (code, o, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
    if (p === '/') return send(200, PAGE, 'text/html; charset=utf-8');
    if (p === '/api/bridge/info') return send(200, INFO);
    if (p === '/api/bridge/schedule') return send(200, { segments: [{ start: new Date(now() + 86400000).toISOString(), end: '', title: 'Tetris night', category: 'Tetris', canceled: false }, { start: new Date(now() + 3 * 86400000).toISOString(), end: '', title: 'Chill stream', category: 'Just Chatting', canceled: true }] });
    if (p === '/api/bridge/state') return send(200, Object.assign({ boot, cursor: seq }, S));
    if (p === '/api/bridge/events') { if (q.chat === '1') chatUntil = now() + 60000; const from = Number(q.since) || 0; return send(200, { boot, cursor: seq, events: events.filter((e) => e.id > from) }); }
    if (p === '/fake/alerts') return send(200, alerts);
    if (p === '/api/bridge/alert' && req.method === 'POST') { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { let b = {}; try { b = JSON.parse(raw); } catch (e) { /* ignore */ } if (!/^discord_(boost|join|milestone)$/.test(b.event || '')) return send(400, { error: 'Unknown Discord event' }); alerts.push({ event: b.event, vars: b.vars }); return send(200, { ok: true, shown: true }); }); return undefined; }
    const m = /^\/fake\/(\w+)$/.exec(p);
    if (m && actions[m[1]]) { actions[m[1]](q); return send(200, 'ok: ' + m[1] + (q.name ? ' ' + q.name : ''), 'text/plain'); }
    return send(404, { error: 'not found' });
  });
  return { server, S, actions, listen: (port) => new Promise((r) => server.listen(port, '127.0.0.1', () => r(server.address().port))), close: () => new Promise((r) => server.close(r)) };
}
module.exports = createFake;

if (require.main === module) createFake().listen(Number(process.argv[2]) || 8420).then((p) => console.log('Fake IMC-Stream on http://localhost:' + p + '  (leave this window open)'));
