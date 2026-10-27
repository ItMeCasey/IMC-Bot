'use strict';
/**
 * The commands every viewer can use, answered from IMC-Stream (the same lists as the viewers' website):
 * /commands (chat commands, without the mod ones), /games, /tts, /top (points), /live and /website.
 */
const { SlashCommandBuilder } = require('discord.js');
const { COLOR, embed } = require('../theme');

const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));
const LIST = [['commands', 'The chat commands of the stream'], ['games', 'The games you can play in chat'], ['tts', 'How to get your message read out loud on stream'], ['top', 'The points leaderboard'], ['live', 'Is the stream live right now?'], ['website', 'The stream website']];

/** the reply for one command, from IMC-Stream's snapshot (live, title, game, login, website) and info (commands, games, top, tts) */
function answer(name, snap, info) {
  const twitch = snap.login ? 'https://twitch.tv/' + snap.login : '', site = snap.website || '';
  if (name === 'commands') {
    const ex = info.commands || { custom: [], groups: {} }, rows = [];
    for (const r of ex.custom || []) rows.push('`' + r[0] + '` ' + r[2]);
    for (const g of Object.keys(ex.groups || {})) if (!/^Mods/.test(g)) for (const r of ex.groups[g]) rows.push('`' + r[0] + '` ' + r[2]);
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
  if (name === 'website') return { content: site || 'The website is not published yet.' };
  return { content: 'I do not know that command.' };
}

module.exports = function createViewer(ctx) {
  for (const [name, desc] of LIST) {
    ctx.discord.register({ data: new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false), run: async (i) => {
      await i.deferReply();
      let snap, info;
      try { [snap, info] = await Promise.all([ctx.bridge.snapshot(), name === 'live' || name === 'website' ? {} : ctx.bridge.info()]); } catch (e) {
        return i.editReply({ content: 'I cannot reach the stream app right now. Try again in a moment.' });
      }
      return i.editReply(Object.assign(answer(name, snap, info), { allowedMentions: { parse: [] } }));
    } });
  }
  return { answer };
};
module.exports.answer = answer;
