'use strict';
/** Starts IMC-Bot: settings, database, the Discord connection, the feature modules and the dashboard. */
const path = require('node:path');
const createConfig = require('./config');
const openDb = require('./db');
const createDiscord = require('./discord/client');
const createSetup = require('./modules/setup');
const createBasic = require('./modules/basic');
const createWeb = require('./web/server');
const createKv = require('./kv');
const createBridge = require('./bridge/local');
const createGoLive = require('./modules/golive');
const createModeration = require('./modules/moderation');
const createAutomod = require('./modules/automod');
const createMirror = require('./modules/mirror');
const createLogging = require('./modules/logging');
const createSelfRoles = require('./modules/selfroles');
const createViewer = require('./modules/viewer');
const createGiveaway = require('./modules/giveaway');
const createTickets = require('./modules/tickets');
const createRegulars = require('./modules/regulars');
const createAnnounce = require('./modules/announce');
const createStreamAlerts = require('./modules/streamalerts');
const createSuggestions = require('./modules/suggestions');
const createPolls = require('./modules/polls');
const createXp = require('./modules/xp');
const createStarboard = require('./modules/starboard');
const createAntiNuke = require('./modules/antinuke');
const createVerify = require('./modules/verify');

const ROOT = path.join(__dirname, '..'), DATA = process.env.IMC_BOT_DATA || path.join(ROOT, 'data');
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function main() {
  const config = createConfig(DATA, log), db = openDb(path.join(DATA, 'bot.db'));
  const ctx = { config, db, log, version: require('../package.json').version };
  ctx.kv = createKv(db);
  const late = {};   // modules that need the Discord connection, which is made just below
  ctx.onReady = (client) => { late.basic.attach(client); late.automod.attach(client); late.streamAlerts.attach(client); late.xp.attach(client); late.starboard.attach(client); late.antinuke.attach(client); late.regulars.attach(client); late.regulars.start(); late.logging.attach(client); late.mirror.start(); late.giveaway.start(); late.polls.start(); late.bridge.start(); late.golive.catchUp().catch((e) => log('go-live catch-up:', e.message)); };   // the bridge starts once Discord is online, so no event is handled before it can be posted
  ctx.discord = createDiscord(ctx);
  ctx.botId = () => { const c = ctx.discord.client(); return c && c.user ? c.user.id : ''; };
  const hooks = new Map();   // channel id -> the mirror's webhook
  ctx.forgetWebhook = (id) => hooks.delete(id);
  ctx.getWebhook = async (channelId) => {
    if (hooks.has(channelId)) return hooks.get(channelId);
    const ch = await ctx.fetchChannel(channelId); if (!ch || !ch.fetchWebhooks) return null;
    let w = [...(await ch.fetchWebhooks()).values()].find((x) => x.name === 'IMC-Bot mirror' && x.owner && x.owner.id === ctx.botId());
    if (!w) w = await ch.createWebhook({ name: 'IMC-Bot mirror', reason: 'Twitch chat mirror' });
    hooks.set(channelId, w); return w;
  };
  ctx.fetchGuild = async (id) => { const c = ctx.discord.client(); return c ? c.guilds.fetch(id).catch(() => null) : null; };
  ctx.guilds = () => { const c = ctx.discord.client(); return c ? [...c.guilds.cache.values()] : []; };
  ctx.avatars = (ids) => late.bridge.avatars(ids);
  ctx.wantChat = () => !!config.get().mirror.on;
  ctx.fetchChannel = async (id) => { const c = ctx.discord.client(); return c ? c.channels.fetch(id).catch(() => null) : null; };
  late.basic = createBasic(ctx);
  ctx.onModAction = (guild, modId, kind) => { if (late.antinuke) late.antinuke.record(guild, modId, kind).catch((e) => log('anti-nuke failed:', e.message)); };   // bans and kicks made with /ban and /kick
  late.moderation = ctx.moderation = createModeration(ctx);
  late.automod = createAutomod(ctx);
  late.mirror = createMirror(ctx);
  late.logging = createLogging(ctx);
  late.selfroles = createSelfRoles(ctx);
  late.viewer = createViewer(ctx);
  late.giveaway = createGiveaway(ctx);
  late.tickets = createTickets(ctx);
  late.regulars = createRegulars(ctx);
  late.announce = createAnnounce(ctx);
  late.streamAlerts = createStreamAlerts(ctx);
  late.suggestions = createSuggestions(ctx);
  late.polls = createPolls(ctx);
  late.xp = createXp(ctx);
  late.starboard = createStarboard(ctx);
  late.antinuke = createAntiNuke(ctx);
  late.verify = createVerify(ctx);
  late.bridge = ctx.bridge = createBridge(ctx);
  late.golive = createGoLive({ ...ctx, channel: async (id) => { const c = ctx.discord.client(); return c ? c.channels.fetch(id).catch(() => null) : null; }, snapshot: () => late.bridge.snapshot() });
  late.bridge.on((ev) => (ev.type.startsWith('chat.') ? late.mirror.onEvent(ev) : (late.announce.onEvent(ev), late.golive.onEvent(ev))));
  ctx.setup = createSetup(ctx);
  const web = createWeb({ ...ctx, publicDir: path.join(ROOT, 'public') });
  const port = await web.listen(config.get().port);
  log('IMC-Bot dashboard: http://localhost:' + port);
  if (config.secret('token')) await ctx.discord.start().then((s) => log('Discord: online as', s.bot), (e) => log('Discord:', e.message));
  const quit = async (exit) => { late.bridge.stop(); late.mirror.stop(); late.giveaway.stop(); late.polls.stop(); late.regulars.stop(); await ctx.discord.stop(); await web.close(); db.close(); if (exit !== false) process.exit(0); };
  if (require.main === module) { process.on('SIGINT', quit); process.on('SIGTERM', quit); }
  return { ctx, late, web, port, quit: () => quit(false) };
}
if (require.main === module) {
  // a bug in one handler must never silently stop the bot: log it and carry on
  process.on('uncaughtException', (e) => log('unexpected error:', e && e.stack || e));
  process.on('unhandledRejection', (e) => log('unexpected error:', e && e.stack || e));
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { main };
