'use strict';
/**
 * Verification gate: /verifypanel posts a message with a "Verify" button; pressing it gives the Verified role.
 * The role does nothing by itself. To make it a gate, hide your channels from @everyone and show them to Verified
 * (leave #welcome and #rules visible to everyone), so newcomers can only see the rules until they press the button.
 * The role is created if it does not exist. A role that carries power is never handed out.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');
const { whyNot } = require('./selfroles');

const EPHEMERAL = MessageFlags.Ephemeral;

module.exports = function createVerify(ctx) {
  const log = ctx.log || (() => {}), cfg = () => ctx.config.get();
  async function roleOf(guild) {
    const name = cfg().verify.roleName, id = ctx.kv.get('verify.role.' + guild.id);
    let role = id && (guild.roles.cache.get(id) || await guild.roles.fetch(id).catch(() => null));
    if (!role) role = guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!role) role = await guild.roles.create({ name, color: COLOR.aqua, mentionable: false, permissions: 0n, reason: 'Verification gate' });
    ctx.kv.set('verify.role.' + guild.id, role.id); return role;
  }
  ctx.discord.register({ data: new SlashCommandBuilder().setName('verifypanel').setDescription('Post a message with a Verify button').setDMPermission(false).setDefaultMemberPermissions(F.ManageRoles)
    .addStringOption((o) => o.setName('title').setDescription('Heading (default: Verify)').setMaxLength(100))
    .addStringOption((o) => o.setName('text').setDescription('What to tell newcomers').setMaxLength(500)), run: async (i) => {
    await i.deferReply({ flags: EPHEMERAL });
    const me = i.guild.members.me || await i.guild.members.fetchMe(), role = await roleOf(i.guild), why = whyNot(role, me.roles.highest.position, i.guild.id); if (why) throw new Error(why);
    await i.channel.send({ embeds: [embed(i.options.getString('title') || 'Verify', i.options.getString('text') || 'Read the rules, then press the button to get access to the server.', COLOR.aqua)], allowedMentions: { parse: [] },
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('verify:go').setLabel('Verify').setStyle(ButtonStyle.Success))] });
    return i.editReply({ content: 'Posted the verification panel. The role is **' + role.name + '**. Remember to hide your channels from @everyone and show them to that role.' });
  } });
  async function onPress(i) {
    const me = i.guild.members.me || await i.guild.members.fetchMe(), role = await roleOf(i.guild), why = whyNot(role, me.roles.highest.position, i.guild.id);
    if (why) return i.reply({ content: why, flags: EPHEMERAL });
    if (i.member.roles.cache.has(role.id)) return i.reply({ content: 'You are already verified.', flags: EPHEMERAL });
    try { await i.member.roles.add(role.id, 'Verified by button'); } catch (e) { log('verify failed:', e.message); return i.reply({ content: 'I could not give you the role: ' + e.message, flags: EPHEMERAL }); }
    return i.reply({ content: 'You are verified. Welcome!', flags: EPHEMERAL });
  }
  ctx.discord.registerButton('verify', onPress);
  return { onPress, roleOf };
};
