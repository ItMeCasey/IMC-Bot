'use strict';
/**
 * The commands every viewer can use, answered from IMC-Stream (the same lists as the viewers' website):
 * /commands (chat commands, without the mod ones), /games, /tts, /top (points), /live, /website and /schedule.
 */
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { COLOR, embed } = require('../theme');

const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const LIST = [['commands', 'The chat commands of the stream'], ['games', 'The games you can play in chat'], ['tts', 'How to get your message read out loud on stream'], ['top', 'The points leaderboard'], ['live', 'Is the stream live right now?'], ['website', 'The stream website'], ['schedule', 'When the next streams are']];

/** the reply for one command, from IMC-Stream's snapshot (live, title, game, login, website) and info (commands, games, top, tts) */
function answer(name, snap, info) {
  const twitch = snap.login ? 'https://twitch.tv/' + snap.login : '', site = snap.website || '';
  if (name === 'commands') {
    const ex = info.commands || { custom: [], groups: {} }, rows = [];
    const open = (r) => !r[1] || /^everyone$/i.test(String(r[1]));   // the list also holds commands for subs, VIPs, mods and the streamer: those are not shown here
    for (const r of ex.custom || []) if (open(r)) rows.push('`' + r[0] + '` ' + r[2]);
    for (const g of Object.keys(ex.groups || {})) if (!/^Mods/.test(g)) for (const r of ex.groups[g]) if (open(r)) rows.push('`' + r[0] + '` ' + r[2]);
    return { embeds: [embed('Chat commands', cut(rows.join('\n') || 'No commands yet.', 4000) + (site ? '\n\nAll of them: ' + site + '/commands.html' : ''), COLOR.aqua)] };
  }
  if (name === 'games') { const g = info.games || []; return { embeds: [embed('Games', cut(g.map((x) => '**' + x.name + '**: `' + x.how + '`').join('\n') || 'No games are on right now.', 4000) + (site ? '\n\nHow they work: ' + site + '/games.html' : ''), COLOR.heat)] }; }
  if (name === 'tts') {
    const t = info.tts || {}, P = t.prefix || '!';
    const text = 'Redeem the text-to-speech reward and type your message' + (t.command ? ', or type `' + P + 'tts your message`' : '') + '. Add sound effects with their name in square brackets, like `good luck [airhorn] you will need it`. ' + (t.sfx || []).map((x) => '`[' + x + ']`').join(' ');
    return { embeds: [embed('Text-to-speech', cut(text, 4000) + (site ? '\n\nAll the sounds: ' + site + '/tts.html' : ''), COLOR.rust)] };
  }
  if (name === 'top') { const top = info.top || []; return { embeds: [embed('Points leaderboard', top.length ? top.map((p, i) => (i + 1) + '. **' + p.name + '** ' + p.pts).join('\n') : 'Nobody has points yet.', COLOR.cream)] }; }
  if (name === 'live') return { embeds: [embed(snap.live ? 'The stream is live!' : 'The stream is offline', snap.live ? (snap.title || '') + (snap.game ? '\n**Playing:** ' + snap.game : '') + (twitch ? '\n' + twitch : '') : (twitch ? 'Follow to get notified: ' + twitch : 'Not live right now.'), snap.live ? COLOR.rust : COLOR.cream)] };
  if (name === 'schedule') {
    const list = (info.segments || []).filter((x) => x.start).slice(0, 7);
    const rows = list.map((x) => { const t = Math.floor(Date.parse(x.start) / 1000), line = '<t:' + t + ':F> (<t:' + t + ':R>)' + (x.title ? ' **' + x.title + '**' : '') + (x.category ? ' (' + x.category + ')' : ''); return x.canceled ? '~~' + line + '~~ canceled' : line; });
    return { embeds: [embed('Stream schedule', rows.join('\n') || 'No streams are scheduled right now.' + (twitch ? '\n' + twitch : ''), COLOR.aqua)] };
  }
  if (name === 'website') return { content: site || 'The website is not published yet.' };
  return { content: 'I do not know that command.' };
}

module.exports = function createViewer(ctx) {
  const cooling = new Map();   // user id -> when they last used a viewer command (one every 5 seconds: each one asks IMC-Stream, which may ask Twitch)
  const now = ctx.now || Date.now;
  for (const [name, desc] of LIST) {
    ctx.discord.register({ data: new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false), run: async (i) => {
      if (now() - (cooling.get(i.user.id) || 0) < 5000) return i.reply({ content: 'Slow down a little: try again in a few seconds.', flags: MessageFlags.Ephemeral });
      cooling.set(i.user.id, now()); if (cooling.size > 500) cooling.delete(cooling.keys().next().value);
      await i.deferReply();
      let snap, info;
      try { [snap, info] = await Promise.all([ctx.bridge.snapshot(), name === 'live' || name === 'website' ? {} : name === 'schedule' ? ctx.bridge.schedule() : ctx.bridge.info()]); } catch (e) {
        return i.editReply({ content: 'I cannot reach the stream app right now. Try again in a moment.' });
      }
      return i.editReply(Object.assign(answer(name, snap, info), { allowedMentions: { parse: [] } }));
    } });
  }
  return { answer };
};
module.exports.answer = answer;
