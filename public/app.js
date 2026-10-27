const $ = (id) => document.getElementById(id);
// every value that came from outside this page (Discord, IMC-Stream, error texts) goes through esc() before it is put into HTML
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u, prefix) => (String(u).startsWith(prefix) ? esc(u) : '');
const toast = (m, bad) => { const t = $('toast'); t.textContent = m; t.className = bad ? 'bad' : ''; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3500); };
async function api(path, body) {
  const r = await fetch('/api/' + path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Failed'); return j;
}
const run = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, true); } };
function draw(v) {
  const b = v.bot, s = v.settings; $('ver').textContent = v.version ? 'v' + v.version : '';
  $('state').textContent = b.state; $('state').className = 'pill ' + (b.state === 'online' ? 'ok' : b.state === 'error' ? 'bad' : '');
  $('botline').innerHTML = b.state === 'online' ? 'Connected as <b class="ok">' + esc(b.bot) + '</b>' : b.error ? '<span class="bad">' + esc(b.error) + '</span>' : s.hasToken ? 'Token saved.' : 'No token yet.';
  $('inviteline').innerHTML = safeUrl(b.invite, 'https://discord.com/oauth2/authorize?') ? 'Bot missing permissions, or not in your server yet? <a href="' + safeUrl(b.invite, 'https://discord.com/oauth2/authorize?') + '" target="_blank" rel="noopener" style="color:var(--aqua)">Open the invite link</a> (adds it with the permissions it needs).' : '';
  const sel = $('guild'); if (document.activeElement !== sel) sel.innerHTML = '<option value="">Choose a server</option>' + v.guilds.map((g) => '<option value="' + esc(g.id) + '">' + esc(g.name) + '</option>').join(''); if (document.activeElement !== sel) sel.value = s.guildId;
  if (document.activeElement !== $('br_url')) $('br_url').value = s.bridge.url; $('brline').textContent = (s.hasBridgePassword ? 'A password is saved on this PC.' : 'No password saved (not needed when IMC-Stream runs on this PC).') + (/^http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])/.test(s.bridge.url) ? ' This address is plain http: use it only on a network you trust, or through a VPN.' : '');
  drawAm(s.automod); drawMi(s.mirror); drawRg(s.regulars); drawAn(s.announce); drawSa(s.streamAlerts); drawCm(s.xp, s.starboard, s.antinuke); for (const k of LG) $('lg_' + k).checked = s.logging[k];
  const mo = s.moderation, setIf = (id, val) => { if (document.activeElement !== $(id)) $(id).value = val; };
  $('dmUser').checked = mo.dmUser; setIf('decayDays', mo.decayDays); setIf('timeoutAt', mo.ladder.timeoutAt); setIf('timeoutMinutes', mo.ladder.timeoutMinutes); setIf('banAt', mo.ladder.banAt);
  $('welcome').checked = s.welcome.on; $('dryRun').checked = s.dryRun; $('goLive').checked = s.goLive.on;
  if (document.activeElement !== $('pingRole') && document.activeElement !== $('ping')) { const p = s.goLive.ping; $('ping').value = ['here', 'everyone'].includes(p) ? p : ''; $('pingRole').value = /^\d+$/.test(p) ? p : ''; }
  const br = v.bridge; $('bridgeline').innerHTML = br.state === 'connected' ? 'IMC-Stream: <b class="ok">connected</b>' : 'IMC-Stream: <b class="bad">not connected</b>' + (br.error ? ' (' + esc(br.error) + ')' : ' (starts once the bot is online)');
}

// AutoMod: one row per rule, built from this list ([rule, label, [[field, label, min, max], ...]])
const AM = [['spam', 'Too many messages too fast', [['count', 'messages', 2, 30], ['seconds', 'within seconds', 2, 60]]], ['duplicate', 'Repeating the same message', [['count', 'times', 2, 20], ['seconds', 'within seconds', 5, 60]]],
  ['mentions', 'Too many mentions in one message', [['max', 'more than', 1, 50]]], ['invites', 'Discord invite links', []], ['links', 'Links (only the allowed sites below)', []], ['caps', 'SHOUTING', [['minLength', 'letters at least', 5, 200], ['percent', '% capitals', 30, 100]]],
  ['emoji', 'Emoji walls', [['max', 'more than', 1, 100]]], ['words', 'Banned words (the list below)', []], ['raid', 'Raid alert: many joins at once', [['joins', 'joins', 2, 100], ['seconds', 'within seconds', 5, 600]]], ['accountAge', 'Kick accounts newer than', [['days', 'days', 1, 365]]]];
$('amRules').innerHTML = AM.map(([r, label, f]) => '<div class="row" style="align-items:center"><label class="chk" style="min-width:300px"><input id="am_' + r + '_on" type="checkbox"> ' + label + '</label>' + f.map(([k, l, lo, hi]) => '<label class="fld" style="flex:none;min-width:0;width:120px">' + l + '<input id="am_' + r + '_' + k + '" type="number" min="' + lo + '" max="' + hi + '"></label>').join('') + '</div>').join('');
function drawAm(a) {
  const keep = (id) => document.activeElement === $(id);
  $('am_on').checked = a.on; $('am_warn').checked = a.warn;
  for (const [r, , f] of AM) { $('am_' + r + '_on').checked = a[r].on; for (const [k] of f) if (!keep('am_' + r + '_' + k)) $('am_' + r + '_' + k).value = a[r][k]; }
  if (!keep('am_words')) $('am_words').value = a.words.list.join('\n'); if (!keep('am_allow')) $('am_allow').value = a.links.allow.join('\n'); if (!keep('am_exemptChannels')) $('am_exemptChannels').value = (a.exemptChannels || []).join(NL);
}
const amBody = () => { const a = { on: $('am_on').checked, warn: $('am_warn').checked, words: { on: $('am_words_on').checked, list: $('am_words').value }, links: { on: $('am_links_on').checked, allow: $('am_allow').value }, exemptChannels: $('am_exemptChannels').value };
  for (const [r, , f] of AM) { a[r] = Object.assign(a[r] || {}, { on: $('am_' + r + '_on').checked }); for (const [k] of f) a[r][k] = $('am_' + r + '_' + k).value; } return a; };
$('saveAm').onclick = run(async () => { draw(await api('settings', { automod: amBody() })); toast('Saved'); });
$('am_on').onchange = $('am_warn').onchange = run(async () => draw(await api('settings', { automod: { on: $('am_on').checked, warn: $('am_warn').checked } })));

const NL = String.fromCharCode(10);
function drawMi(m) {
  const keep = (id) => document.activeElement === $(id);
  for (const k of ['on', 'hideCommands', 'showBadges', 'stripLinks', 'avatars']) $('mi_' + k).checked = m[k];
  if (!keep('mi_minRole')) $('mi_minRole').value = m.minRole;
  if (!keep('mi_hideBots')) $('mi_hideBots').value = m.hideBots.join(NL); if (!keep('mi_ignore')) $('mi_ignore').value = m.ignore.join(NL);
}
const miBody = () => ({ on: $('mi_on').checked, hideCommands: $('mi_hideCommands').checked, showBadges: $('mi_showBadges').checked, avatars: $('mi_avatars').checked, stripLinks: $('mi_stripLinks').checked, minRole: $('mi_minRole').value, hideBots: $('mi_hideBots').value, ignore: $('mi_ignore').value });
$('saveMi').onclick = run(async () => { draw(await api('settings', { mirror: miBody() })); toast('Saved'); });
$('mi_on').onchange = run(async () => draw(await api('settings', { mirror: { on: $('mi_on').checked } })));

const LG = ['on', 'messages', 'members', 'roles', 'voice'];
for (const k of LG) $('lg_' + k).onchange = run(async () => draw(await api('settings', { logging: { [k]: $('lg_' + k).checked } })));

function drawRg(r) {
  const keep = (id) => document.activeElement === $(id);
  $('rg_on').checked = r.on; $('rg_notice').checked = r.notice;
  for (const k of ['links', 'attachments', 'invites', 'mentions']) $('rg_' + k).checked = r.restrict[k];
  for (const [id, v] of [['rg_minDays', r.minDays], ['rg_minConversations', r.minConversations], ['rg_gapMinutes', r.gapMinutes], ['rg_maxMentions', r.restrict.maxMentions]]) if (!keep(id)) $(id).value = v;
  if (!keep('rg_exempt')) $('rg_exempt').value = r.exemptRoles.join(NL); if (!keep('rg_exemptChannels')) $('rg_exemptChannels').value = (r.exemptChannels || []).join(NL);
}
const rgBody = () => ({ on: $('rg_on').checked, notice: $('rg_notice').checked, minDays: $('rg_minDays').value, minConversations: $('rg_minConversations').value, gapMinutes: $('rg_gapMinutes').value, exemptRoles: $('rg_exempt').value, exemptChannels: $('rg_exemptChannels').value,
  restrict: { links: $('rg_links').checked, attachments: $('rg_attachments').checked, invites: $('rg_invites').checked, mentions: $('rg_mentions').checked, maxMentions: $('rg_maxMentions').value } });
$('saveRg').onclick = run(async () => { draw(await api('settings', { regulars: rgBody() })); toast('Saved'); });
$('rg_on').onchange = run(async () => draw(await api('settings', { regulars: { on: $('rg_on').checked } })));

function drawAn(a) {
  for (const k of ['on', 'raids', 'milestones']) $('an_' + k).checked = a[k];
  for (const k of ['minRaid', 'milestoneEvery']) if (document.activeElement !== $('an_' + k)) $('an_' + k).value = a[k];
}
const anBody = () => ({ on: $('an_on').checked, raids: $('an_raids').checked, milestones: $('an_milestones').checked, minRaid: $('an_minRaid').value, milestoneEvery: $('an_milestoneEvery').value });
$('saveAn').onclick = run(async () => { draw(await api('settings', { announce: anBody() })); toast('Saved'); });
$('an_on').onchange = run(async () => draw(await api('settings', { announce: { on: $('an_on').checked } })));

function drawCm(x, sb, nk) {
  const keep = (id) => document.activeElement === $(id);
  $('xp_on').checked = x.on; $('xp_announce').checked = x.announce; $('sb_on').checked = sb.on; $('nk_on').checked = nk.on;
  for (const [id, v] of [['xp_min', x.min], ['xp_max', x.max], ['xp_cooldown', x.cooldown], ['sb_threshold', sb.threshold], ['nk_maxActions', nk.maxActions], ['nk_seconds', nk.seconds]]) if (!keep(id)) $(id).value = v;
  if (!keep('xp_levelRoles')) $('xp_levelRoles').value = x.levelRoles.join(NL);
}
const cmBody = () => ({ xp: { on: $('xp_on').checked, announce: $('xp_announce').checked, min: $('xp_min').value, max: $('xp_max').value, cooldown: $('xp_cooldown').value, levelRoles: $('xp_levelRoles').value },
  starboard: { on: $('sb_on').checked, threshold: $('sb_threshold').value }, antinuke: { on: $('nk_on').checked, maxActions: $('nk_maxActions').value, seconds: $('nk_seconds').value } });
$('saveCm').onclick = run(async () => { draw(await api('settings', cmBody())); toast('Saved'); });
for (const id of ['xp_on', 'sb_on', 'nk_on']) $(id).onchange = run(async () => draw(await api('settings', { [id.startsWith('xp') ? 'xp' : id.startsWith('sb') ? 'starboard' : 'antinuke']: { on: $(id).checked } })));

$('saveBr').onclick = run(async () => { const b = { bridge: { url: $('br_url').value } }; if ($('br_password').value) b.bridgePassword = $('br_password').value; draw(await api('settings', b)); $('br_password').value = ''; toast('Saved'); });
$('clearBr').onclick = run(async () => { draw(await api('settings', { clearBridgePassword: true })); toast('Password removed'); });

function drawSa(a) { for (const k of ['on', 'boosts', 'joins', 'milestones']) $('sa_' + k).checked = a[k]; if (document.activeElement !== $('sa_milestoneEvery')) $('sa_milestoneEvery').value = a.milestoneEvery; }
const saBody = () => ({ on: $('sa_on').checked, boosts: $('sa_boosts').checked, joins: $('sa_joins').checked, milestones: $('sa_milestones').checked, milestoneEvery: $('sa_milestoneEvery').value });
$('saveSa').onclick = run(async () => { draw(await api('settings', { streamAlerts: saBody() })); toast('Saved'); });
$('sa_on').onchange = run(async () => draw(await api('settings', { streamAlerts: { on: $('sa_on').checked } })));
$('testSa').onclick = run(async () => { const r = await api('test-stream-alert', {}); toast(r.shown ? 'The alert is on your stream' : 'IMC-Stream got it but has no alert for it: switch on "Discord server boost" in its Alerts page', !r.shown); });
const load = async () => draw(await api('status'));
$('saveToken').onclick = run(async () => {
  if ($('token').value.trim()) { draw(await api('settings', { token: $('token').value })); $('token').value = ''; toast('Saved'); }
  else { draw(await api('connect', {})); toast('Connected'); }   // no new token: connect again with the saved one
});
$('clearToken').onclick = run(async () => { draw(await api('settings', { clearToken: true })); toast('Token removed'); });
$('guild').onchange = run(async () => { draw(await api('settings', { guildId: $('guild').value })); });
$('welcome').onchange = run(async () => draw(await api('settings', { welcome: { on: $('welcome').checked } })));
$('dryRun').onchange = run(async () => draw(await api('settings', { dryRun: $('dryRun').checked })));
$('goLive').onchange = run(async () => draw(await api('settings', { goLive: { on: $('goLive').checked } })));
$('ping').onchange = run(async () => { $('pingRole').value = ''; draw(await api('settings', { goLive: { ping: $('ping').value } })); });
$('pingRole').onchange = run(async () => draw(await api('settings', { goLive: { ping: $('pingRole').value.trim() } })));
$('dmUser').onchange = run(async () => draw(await api('settings', { moderation: { dmUser: $('dmUser').checked } })));
$('saveMod').onclick = run(async () => { draw(await api('settings', { moderation: { decayDays: $('decayDays').value, ladder: { timeoutAt: $('timeoutAt').value, timeoutMinutes: $('timeoutMinutes').value, banAt: $('banAt').value } } })); toast('Saved'); });
$('plan').onclick = run(async () => {
  const p = await api('plan', {}), by = {};
  for (const t of p.todo) (by[t.in || (t.kind === 'role' ? 'ROLES' : 'NEW')] = by[t.in || (t.kind === 'role' ? 'ROLES' : 'NEW')] || []).push(t);
  $('planOut').innerHTML = p.todo.length ? Object.keys(by).map((k) => '<div class="cat"><b>' + esc(k) + '</b>' + by[k].map((t) => '<div class="new">+ ' + esc(t.name) + '</div>').join('') + '</div>').join('') : '<div class="cat"><b>ALL THERE</b>Nothing to add.</div>';
});
$('setup').onclick = run(async () => { const r = await api('setup', {}); toast(r.count ? 'Added ' + r.count + (r.count === 1 ? ' thing: ' : ' things: ') + r.added.join(', ') : 'Nothing to add'); $('planOut').innerHTML = ''; });
load().catch((e) => toast(e.message, true)); setInterval(() => load().catch(() => {}), 5000);
