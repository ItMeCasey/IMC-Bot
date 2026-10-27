'use strict';
/**
 * Sets up the streamer's server in IMC-Stream's style: roles, channels, a welcome and a rules message.
 * It only ever adds what is missing (never edits or removes anything), so it is safe to press twice.
 * diff() is pure (plain lists in, a to-do list out) so it can be tested without Discord.
 */
const { PermissionFlagsBits: F, ChannelType: T } = require('discord.js');
const { COLOR, embed } = require('../theme');

const MOD_PERMS = F.KickMembers | F.ManageMessages | F.ModerateMembers | F.ViewAuditLog | F.MuteMembers;
// [category, [ [name, type, kind] ]]   kind: 'readonly' = only the bot and mods post, 'private' = mods only
const LAYOUT = [
  ['INFO', [['welcome', T.GuildText, 'readonly'], ['rules', T.GuildText, 'readonly'], ['announcements', T.GuildText, 'readonly'], ['go-live', T.GuildText, 'readonly']]],
  ['COMMUNITY', [['general', T.GuildText, ''], ['clips', T.GuildText, ''], ['game-chat', T.GuildText, ''], ['twitch-chat', T.GuildText, 'readonly'], ['bot-commands', T.GuildText, ''], ['suggestions', T.GuildText, ''], ['starboard', T.GuildText, 'readonly']]],
  ['VOICE', [['Lounge', T.GuildVoice, ''], ['Gaming 1', T.GuildVoice, ''], ['Gaming 2', T.GuildVoice, '']]],
  ['MODS', [['mod-chat', T.GuildText, 'private'], ['mod-log', T.GuildText, 'private'], ['audit-log', T.GuildText, 'private']]],
];
const ROLES = [['Mods', COLOR.aqua, true, MOD_PERMS], ['Tier 3 Sub', COLOR.rust, true, 0n], ['Tier 2 Sub', COLOR.heat, true, 0n], ['Tier 1 Sub', COLOR.cream, true, 0n]];
const TOPICS = { welcome: 'Start here', rules: 'The rules of the server', announcements: 'News from the stream', 'go-live': 'Posted by the bot when the stream starts', general: 'Chat about anything', clips: 'Share your best clips', 'game-chat': 'Talk about the games', 'twitch-chat': 'The Twitch chat, mirrored by the bot', 'bot-commands': 'Try the bot here: /ping', 'suggestions': 'Suggest something with /suggest and vote with the buttons', 'starboard': 'The best messages, picked by reactions', 'mod-chat': 'Mods only', 'mod-log': 'Mods only', 'audit-log': 'Mods only: deleted messages, joins and leaves' };
// which dashboard setting each channel fills
const KEYS = { welcome: 'welcome', rules: 'rules', announcements: 'announcements', 'go-live': 'goLive', 'twitch-chat': 'mirror', 'bot-commands': 'botCommands', 'mod-log': 'modLog', 'audit-log': 'auditLog', suggestions: 'suggestions', starboard: 'starboard', general: 'general' };

// what the bot needs to build the server (and for the Mods role: a bot can only give permissions it has itself)
const NEEDED = ['ManageRoles', 'ManageChannels', 'ViewChannel', 'SendMessages', 'EmbedLinks', 'ManageWebhooks', 'KickMembers', 'ManageMessages', 'ModerateMembers', 'ViewAuditLog', 'MuteMembers'];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** what the layout would add, given the roles ([{name}]) and channels ([{id, name, type, parentId}]) already there */
function diff(roles, channels) {
  const todo = [];
  for (const [name] of ROLES) if (!roles.some((r) => same(r.name, name))) todo.push({ kind: 'role', name });
  for (const [cat, list] of LAYOUT) {
    const c = channels.find((x) => x.type === T.GuildCategory && same(x.name, cat));
    if (!c) todo.push({ kind: 'category', name: cat });
    for (const [name, type] of list) if (!c || !channels.some((x) => x.type === type && same(x.name, name) && x.parentId === c.id)) todo.push({ kind: type === T.GuildVoice ? 'voice' : 'text', name, in: cat });
  }
  return todo;
}

function welcomeMessage(channelName, ids) {
  return { embeds: [embed('Welcome to the ' + (channelName || 'stream') + ' server', 'Glad you are here! Say hi in <#' + (ids.general || 'general') + '>.\n\nType `/ping` in <#' + (ids.botCommands || 'bot-commands') + '> to see the bot is alive.', COLOR.heat)] };
}
function rulesMessage() {
  return { embeds: [embed('Rules', ['**1. Be kind.** No harassment, hate or bullying.', '**2. No spam** or self-promotion without asking a mod.', '**3. Keep it safe for work.** Nothing sexual, graphic or illegal.', '**4. No spoilers** without a warning.', '**5. Listen to the mods.** If you are unsure, ask.'].join('\n'), COLOR.rust)] };
}

module.exports = function createSetup(ctx) {
  const log = ctx.log || (() => {});
  const snapshot = async (guild) => {
    const [roles, chans] = await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);
    return { roles: [...roles.values()], channels: [...chans.values()].filter(Boolean) };
  };
  async function plan(guild) { const s = await snapshot(guild); return { roles: s.roles.length, channels: s.channels.length, todo: diff(s.roles, s.channels) }; }

  async function apply(guild) {
    const me = guild.members.me || await guild.members.fetchMe();
    const lacking = NEEDED.filter((n) => !me.permissions.has(F[n]));
    if (lacking.length) throw new Error('The bot is missing these permissions in "' + guild.name + '": ' + lacking.map((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ') + '. Give its role Administrator (Server Settings, Roles) or invite it again with them.');
    const s = await snapshot(guild), added = [], byName = {}, made = [];
    const everyone = guild.roles.everyone;
    for (const [name, color, hoist, perms] of ROLES) {
      let r = s.roles.find((x) => same(x.name, name));
      if (!r) { r = await guild.roles.create({ name, color, hoist, mentionable: false, permissions: perms }); added.push('role ' + name); }
      byName[name] = r;
    }
    const mods = byName.Mods, SEND = F.SendMessages, SEE = F.ViewChannel | F.ReadMessageHistory;
    const overwrites = (kind) => kind === 'readonly'
      ? [{ id: everyone.id, allow: SEE | F.AddReactions, deny: SEND }, { id: me.id, allow: SEE | SEND | F.EmbedLinks | F.ManageWebhooks }, { id: mods.id, allow: SEND }]
      : kind === 'private'
        ? [{ id: everyone.id, deny: F.ViewChannel }, { id: mods.id, allow: SEE | SEND | F.Connect | F.Speak }, { id: me.id, allow: SEE | SEND | F.EmbedLinks }]
        : [];
    let pos = 0;
    for (const [cat, list] of LAYOUT) {
      let c = s.channels.find((x) => x.type === T.GuildCategory && same(x.name, cat));
      if (!c) { c = await guild.channels.create({ name: cat, type: T.GuildCategory, position: pos }); added.push('category ' + cat); }
      pos++;
      for (const [name, type, kind] of list) {
        let ch = s.channels.find((x) => x.type === type && same(x.name, name) && x.parentId === c.id);
        if (!ch) {
          ch = await guild.channels.create(Object.assign({ name, type, parent: c.id, permissionOverwrites: overwrites(kind) }, type === T.GuildText && TOPICS[name] ? { topic: TOPICS[name] } : {}));
          added.push((type === T.GuildVoice ? 'voice ' : '#') + name); made.push(name);
        }
        byName[name] = ch;
      }
    }
    const ids = {};
    for (const [name, key] of Object.entries(KEYS)) if (byName[name]) ids[key] = byName[name].id;
    ctx.config.setChannels(ids);
    if (made.includes('welcome')) await byName.welcome.send(welcomeMessage(ctx.channelName && ctx.channelName(), ids));
    if (made.includes('rules')) await byName.rules.send(rulesMessage());
    if (made.includes('bot-commands')) await byName['bot-commands'].send({ embeds: [embed('Try the bot here', 'Type `/ping` in this channel. More commands arrive with each update.', COLOR.aqua)] });
    log('server setup added', added.length, 'things');
    return { added, count: added.length };
  }
  return { plan, apply };
};
module.exports.NEEDED = NEEDED; module.exports.diff = diff; module.exports.LAYOUT = LAYOUT; module.exports.ROLES = ROLES;
