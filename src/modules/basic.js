'use strict';
/** The first slash commands: /ping, and the welcome message for new members. More come with each phase. */
const { SlashCommandBuilder, Events, MessageFlags } = require('discord.js');
const { COLOR, embed } = require('../theme');

module.exports = function createBasic(ctx) {
  ctx.discord.register({ data: new SlashCommandBuilder().setName('ping').setDescription('Is the bot alive?'), run: (i) => i.reply({ embeds: [embed('Pong', 'IMC-Bot is running.', COLOR.aqua)], flags: MessageFlags.Ephemeral }) });
  /** greets a new member in #welcome and gives the join role when one is set */
  async function onJoin(member) {
    const cfg = ctx.config.get(); if (!cfg.welcome.on || member.user.bot) return;
    if (cfg.welcome.joinRole) await member.roles.add(cfg.welcome.joinRole).catch((e) => ctx.log('join role failed:', e.message));
    const ch = cfg.channels.welcome && member.guild.channels.cache.get(cfg.channels.welcome);
    if (ch) await ch.send({ content: '<@' + member.id + '>', embeds: [embed('Welcome!', 'Glad you are here, ' + member.displayName + '. Read the rules in <#' + (cfg.channels.rules || '') + '>.', COLOR.heat)], allowedMentions: { users: [member.id] } }).catch((e) => ctx.log('welcome failed:', e.message));
  }
  return { attach: (client) => client.on(Events.GuildMemberAdd, onJoin), onJoin };
};
