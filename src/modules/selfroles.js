'use strict';
/**
 * Self-assign roles with buttons: a mod runs /rolepanel in a channel and the bot posts a message with one button per role;
 * pressing a button gives the role, pressing it again takes it away (game pings, "notify me", pronouns...).
 * Safety: only plain roles can be offered. Never a bot's own role, a role above the bot, or one that carries power
 * (administrator, manage anything, kick, ban, time out, mention everyone). It is checked when the panel is made and again at every press,
 * because a role's permissions can be changed later. The button knows its role from its own id, so panels keep working after a restart.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');

const POWER = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ManageWebhooks', 'ManageNicknames', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone', 'ManageEvents', 'ViewAuditLog'];
const MAX_ROLES = 10, EPHEMERAL = MessageFlags.Ephemeral;

/** null when the role may be offered, otherwise the reason it may not */
function whyNot(role, botTop, guildId) {
  if (!role) return 'That role does not exist any more.';
  if (role.id === guildId) return '@everyone cannot be offered.';
  if (role.managed) return role.name + ' belongs to a bot or integration.';
  if (role.position >= botTop) return 'My role is not above ' + role.name + '. Move my role up in Server Settings, Roles.';
  const bad = POWER.filter((p) => role.permissions.has(F[p]));
  return bad.length ? role.name + ' has powers (' + bad.slice(0, 3).join(', ') + '), so it cannot be a self-assign role.' : null;
}

module.exports = function createSelfRoles(ctx) {
  const log = ctx.log || (() => {});
  const b = new SlashCommandBuilder().setName('rolepanel').setDescription('Post a message with buttons that give or remove roles').setDMPermission(false).setDefaultMemberPermissions(F.ManageRoles)
    .addStringOption((o) => o.setName('title').setDescription('Heading of the message').setRequired(true).setMaxLength(100))
    ;
  b.addRoleOption((o) => o.setName('role1').setDescription('Role 1').setRequired(true));   // Discord wants every required option before the optional ones
  b.addStringOption((o) => o.setName('text').setDescription('What the buttons are for').setMaxLength(500));
  for (let n = 2; n <= MAX_ROLES; n++) b.addRoleOption((o) => o.setName('role' + n).setDescription('Role ' + n));
  ctx.discord.register({ data: b, run: async (i) => {
    await i.deferReply({ flags: EPHEMERAL });
    const g = i.guild, me = g.members.me || await g.members.fetchMe(), top = me.roles.highest.position;
    const roles = [...new Map([...Array(MAX_ROLES).keys()].map((n) => i.options.getRole('role' + (n + 1))).filter(Boolean).map((r) => [r.id, r])).values()];
    for (const r of roles) { const w = whyNot(r, top, g.id); if (w) throw new Error(w); }
    const rows = [];
    for (let n = 0; n < roles.length; n += 5) rows.push(new ActionRowBuilder().addComponents(roles.slice(n, n + 5).map((r) => new ButtonBuilder().setCustomId('role:' + r.id).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
    await i.channel.send({ embeds: [embed(i.options.getString('title', true), (i.options.getString('text') || 'Press a button to get a role. Press it again to remove it.'), COLOR.aqua)], components: rows, allowedMentions: { parse: [] } });
    await i.editReply({ content: 'Posted the panel with ' + roles.length + ' role' + (roles.length > 1 ? 's' : '') + '.' });
  } });

  /** a button press: toggle that role for that member */
  async function onPress(i) {
    const id = String(i.customId).split(':')[1], g = i.guild, me = g.members.me || await g.members.fetchMe();
    const role = g.roles.cache.get(id) || await g.roles.fetch(id).catch(() => null), why = whyNot(role, me.roles.highest.position, g.id);
    if (why) return i.reply({ content: why, flags: EPHEMERAL });
    const has = i.member.roles.cache.has(id);
    try { await (has ? i.member.roles.remove(id, 'Self-assign panel') : i.member.roles.add(id, 'Self-assign panel')); } catch (e) { log('self role failed:', e.message); return i.reply({ content: 'I could not change that role: ' + e.message, flags: EPHEMERAL }); }
    return i.reply({ content: has ? 'Removed **' + role.name + '**.' : 'You now have **' + role.name + '**.', flags: EPHEMERAL });
  }
  ctx.discord.registerButton('role', onPress);
  return { onPress, whyNot };
};
module.exports.whyNot = whyNot;
module.exports.POWER = POWER;
