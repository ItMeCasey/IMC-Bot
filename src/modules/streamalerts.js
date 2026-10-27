'use strict';
/**
 * Discord events as alerts on stream: when someone boosts the server, joins it, or the member count passes a round number,
 * the bot tells IMC-Stream, which shows an alert on your stream like a follow or a sub. The look, the sound and the on/off
 * of each alert are set in IMC-Stream (Alerts, and the Alert Builder), where they appear as "Discord server boost",
 * "Discord member joined" and "Discord member milestone". Needs IMC-Stream running with the bridge.
 *  - A boost is seen from Discord's own "boosted the server" message and from the member getting the booster badge; the same
 *    boost is only sent once.
 *  - Off until switched on. Each kind can be switched off.
 */
const { Events, MessageType } = require('discord.js');

const BOOST_TYPES = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);
const SAME_BOOST_MS = 30000;

module.exports = function createStreamAlerts(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, cfg = () => ctx.config.get(), S = () => cfg().streamAlerts;
  const recent = new Map();   // user id -> when their boost was last sent
  const nameOf = (m) => String((m && (m.displayName || (m.user && (m.user.globalName || m.user.username)) || (m.username))) || 'Someone').slice(0, 60);

  /** hands one alert to IMC-Stream; a stream that is not running just means no alert (it is live, so there is nothing to catch up on) */
  async function send(event, vars) {
    try { return await ctx.bridge.alert(event, vars); } catch (e) { log('stream alert failed:', e.message); return null; }
  }

  async function boost(member, guild) {
    const s = S(); if (!s.on || !s.boosts || !member) return false;
    const id = member.id || (member.user && member.user.id), t = now(), last = recent.get(id) || 0;
    if (t - last < SAME_BOOST_MS) return false;   // the message and the badge change both arrive for one boost
    recent.set(id, t); if (recent.size > 200) recent.delete(recent.keys().next().value);
    await send('discord_boost', { name: nameOf(member), boosts: (guild && guild.premiumSubscriptionCount) || 0, level: (guild && guild.premiumTier) || 0 });
    return true;
  }
  const onMessage = (m) => (m.guild && m.system && BOOST_TYPES.has(m.type) ? boost(m.member || m.author, m.guild) : false);
  const onMemberUpdate = (a, b) => (!a.premiumSince && b.premiumSince ? boost(b, b.guild) : false);

  async function onJoin(member) {
    const s = S(); if (!s.on || member.user.bot) return;
    if (s.joins) await send('discord_join', { name: nameOf(member) });
    const n = member.guild.memberCount;
    if (s.milestones && s.milestoneEvery && n && n % s.milestoneEvery === 0 && Number(ctx.kv.get('streamalerts.milestone') || 0) < n) {
      ctx.kv.set('streamalerts.milestone', String(n)); await send('discord_milestone', { members: n });
    }
  }
  const attach = (c) => {
    const safe = (fn) => (...a) => Promise.resolve(fn(...a)).catch((e) => log('stream alerts failed:', e.message));
    c.on(Events.MessageCreate, safe(onMessage)); c.on(Events.GuildMemberUpdate, safe(onMemberUpdate)); c.on(Events.GuildMemberAdd, safe(onJoin));
  };
  return { attach, boost, onMessage, onMemberUpdate, onJoin, send };
};
