'use strict';
/**
 * Announcements from the stream, posted in #announcements:
 *  - a raid coming in ("Sam raided with 25 viewers!"), only above a small size you choose,
 *  - a follower milestone (every 100th follower by default), posted once even if the event is replayed.
 * Both can be switched off. The data comes from IMC-Stream through the bridge.
 */
const { COLOR, embed } = require('../theme');

module.exports = function createAnnounce(ctx) {
  const log = ctx.log || (() => {}), cfg = () => ctx.config.get(), A = () => cfg().announce;
  const post = async (title, text, color) => {
    const id = cfg().channels.announcements; if (!id) return false;
    const ch = await ctx.fetchChannel(id); if (!ch) return false;
    await ch.send({ embeds: [embed(title, text, color)], allowedMentions: { parse: [] } }); return true;
  };

  async function raid(d) {
    const a = A(); if (!a.on || !a.raids || (d.viewers || 0) < a.minRaid) return false;
    const link = d.login ? 'https://twitch.tv/' + d.login : '';
    return post('🚀 Raid from ' + String(d.name || 'someone').slice(0, 60), String(d.name || 'Someone') + ' raided the stream with **' + (d.viewers || 0) + '** viewers! Say hi in chat.' + (link ? '\n' + link : ''), COLOR.rust);
  }
  async function follow(d) {
    const a = A(); if (!a.on || !a.milestones || !a.milestoneEvery || !d.total || d.total % a.milestoneEvery !== 0) return false;
    if (Number(ctx.kv.get('announce.milestone') || 0) >= d.total) return false;   // already said (a replayed event, or a follower who unfollowed and came back)
    ctx.kv.set('announce.milestone', String(d.total));
    return post('🎉 ' + d.total + ' followers!', 'We just reached **' + d.total + '** followers on Twitch. Thank you all! Latest follower: **' + String(d.name || 'someone').slice(0, 60) + '**.', COLOR.aqua);
  }
  async function onEvent(ev) {
    try { if (ev.type === 'raid') return await raid(ev.data); if (ev.type === 'follow') return await follow(ev.data); } catch (e) { log('announcement failed:', e.message); }
    return undefined;
  }
  return { onEvent, raid, follow };
};
