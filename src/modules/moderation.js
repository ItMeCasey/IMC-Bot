'use strict';
/**
 * Manual moderation for mods: /warn /timeout /untimeout /kick /ban /unban /unwarn /note /case /history /purge /slowmode /lock /unlock.
 *  - Every action on a person is a numbered case, posted in #mod-log with an Undo button where it can be undone.
 *  - Safety: nobody can act on themselves, the bot or the owner, or on someone whose top role is as high as theirs (or the bot's).
 *  - The warn ladder: when a person's active warnings reach the set numbers the bot times them out, then bans them
 *    (only for real when "Dry run" is off; otherwise it just says in #mod-log what it would have done).
 * Mods use these commands themselves, so dry run never blocks them.
 */
const { SlashCommandBuilder, PermissionFlagsBits: F, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLOR, embed } = require('../theme');
const createCases = require('./cases');
const { parseDuration, fmtDuration } = createCases;

const MAX_TIMEOUT = 28 * 86400000;
const EPHEMERAL = MessageFlags.Ephemeral;
const COLORS = { warn: COLOR.heat, timeout: COLOR.heat, kick: COLOR.rust, ban: COLOR.rust, unban: COLOR.aqua, untimeout: COLOR.aqua, note: COLOR.cream };
const TITLES = { warn: 'Warning', timeout: 'Timeout', kick: 'Kick', ban: 'Ban', unban: 'Unban', untimeout: 'Timeout lifted', note: 'Note' };
const cut = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

module.exports = function createModeration(ctx) {
  const log = ctx.log || (() => {}), now = ctx.now || Date.now, cases = createCases(ctx.db, now);
  const cfg = () => ctx.config.get(), mcfg = () => cfg().moderation;

  // ------------------------------------------------------------------ what the bot does to a person (one place, so commands, the ladder and Undo agree)
  const act = {
    timeout: async (g, id, ms, why) => (await g.members.fetch(id)).timeout(ms, why),
    untimeout: async (g, id, why) => (await g.members.fetch(id)).timeout(null, why),
    kick: (g, id, why) => g.members.kick(id, why),
    ban: (g, id, why, days) => g.members.ban(id, { reason: why, deleteMessageSeconds: Math.min(7, Math.max(0, days || 0)) * 86400 }),
    unban: (g, id, why) => g.members.unban(id, why),
  };
  const why = (id, mod, reason) => 'Case ' + id + ' by ' + mod + (reason ? ': ' + reason : '');

  /** may this person (a Discord user, and the member if still in the server) be acted on by this moderator? Throws a plain sentence when not */
  async function guard(i, user, member) {
    const g = i.guild, me = g.members.me || await g.members.fetchMe();
    if (user.id === i.user.id) throw new Error('You cannot do that to yourself.');
    if (user.id === me.id) throw new Error('I cannot do that to myself.');
    if (user.id === g.ownerId) throw new Error('Nobody can act on the server owner.');
    if (!member) return;
    if (member.roles.highest.position >= me.roles.highest.position) throw new Error('My role is not above theirs. Move my role up in Server Settings, Roles.');
    if (i.user.id !== g.ownerId && member.roles.highest.position >= i.member.roles.highest.position) throw new Error('Their top role is as high as yours.');
  }

  // ------------------------------------------------------------------ the mod log
  const logChannel = async () => { const id = cfg().channels.modLog; return id ? ctx.fetchChannel(id) : null; };
  const undoable = (c) => !c.undone_at && ['warn', 'timeout', 'ban'].includes(c.type);
  const row = (c) => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('undo:' + c.id).setLabel('Undo').setStyle(ButtonStyle.Secondary));

  function caseEmbed(c, extra) {
    const f = [{ name: 'Person', value: '<@' + c.target_discord_id + '> (' + c.target_discord_id + ')', inline: true }, { name: 'By', value: c.moderator === ctx.botId() ? 'IMC-Bot (' + (c.source || 'auto') + ')' : '<@' + c.moderator + '>', inline: true }];
    if (c.expires_at) f.push({ name: 'Lasts', value: fmtDuration(c.expires_at - c.created_at), inline: true });
    f.push({ name: 'Reason', value: cut(c.reason || 'No reason given', 1000) });
    return Object.assign(embed('Case #' + c.id + ': ' + TITLES[c.type], '', COLORS[c.type] || COLOR.cream, { fields: f, timestamp: new Date(c.created_at).toISOString() }), extra || {});
  }
  async function postCase(c) {
    try { const ch = await logChannel(); if (ch) await ch.send({ embeds: [caseEmbed(c)], components: undoable(c) ? [row(c)] : [], allowedMentions: { parse: [] } }); } catch (e) { log('mod log failed:', e.message); }
  }
  async function postLine(title, text, color) {
    try { const ch = await logChannel(); if (ch) await ch.send({ embeds: [embed(title, cut(text, 3000), color || COLOR.cream)], allowedMentions: { parse: [] } }); } catch (e) { log('mod log failed:', e.message); }
  }
  async function tell(user, g, c, extra) {
    if (!mcfg().dmUser || !user || !user.send) return false;
    const text = { warn: 'You were warned', timeout: 'You were timed out', kick: 'You were removed', ban: 'You were banned' }[c.type];
    if (!text) return false;
    try { await user.send({ embeds: [embed(text + ' in ' + g.name, cut(c.reason || 'No reason given', 1000) + (extra ? '\n' + extra : ''), COLORS[c.type])] }); return true; } catch (e) { return false; }   // their DMs may be closed
  }

  /** records the case, does the action, tells the person, and posts the log line. fields: type, user, member, reason, mod, source, ms, days */
  async function perform(g, f) {
    const id0 = f.user.id, reason = f.reason || '';
    const c = cases.create({ guildId: g.id, type: f.type, target: id0, moderator: f.mod, reason, source: f.source || 'discord', expiresAt: f.ms ? now() + f.ms : null, decayDays: mcfg().decayDays });
    const w = why(c.id, f.modTag || f.mod, reason);
    try {
      if (f.type === 'timeout') await act.timeout(g, id0, f.ms, w);
      else if (f.type === 'kick') { await tell(f.user, g, c); await act.kick(g, id0, w); }
      else if (f.type === 'ban') { await tell(f.user, g, c); await act.ban(g, id0, w, f.days); }
      else if (f.type === 'unban') await act.unban(g, id0, w);
      else if (f.type === 'untimeout') await act.untimeout(g, id0, w);
    } catch (e) { cases.undo(g.id, c.id); throw new Error(describe(e)); }   // it did not happen, so the case must not stand
    if (f.type === 'warn' || f.type === 'timeout') await tell(f.user, g, c, f.type === 'warn' ? 'Active warnings: ' + cases.activeWarnings(g.id, id0) : '');
    await postCase(c);
    return c;
  }
  const describe = (e) => (e && e.code === 50013 ? 'Discord refused: the bot lacks the permission, or their role is above the bot\'s.' : e && e.code === 10007 ? 'That person is not in this server.' : e && e.code === 10026 ? 'That person is not banned.' : e.message);

  // ------------------------------------------------------------------ the warn ladder
  async function ladder(g, user, member) {
    const L = mcfg().ladder, n = cases.activeWarnings(g.id, user.id), step = n === L.banAt && L.banAt > 0 ? 'ban' : n === L.timeoutAt && L.timeoutAt > 0 ? 'timeout' : '';
    if (!step) return '';
    const reason = 'Warn ladder: ' + n + ' active warnings';
    if (cfg().dryRun) { await postLine('Dry run: would ' + step + ' ' + (user.tag || user.id), '<@' + user.id + '> has ' + n + ' active warnings. Switch off "Dry run" in the dashboard to let the bot do this.', COLOR.cream); return ' (dry run: the bot would ' + step + ' them)'; }
    try {
      if (member) await guard({ guild: g, user: { id: ctx.botId() }, member: g.members.me }, user, member);
      await perform(g, { type: step, user, member, reason, mod: ctx.botId(), modTag: 'IMC-Bot', source: 'warn-ladder', ms: step === 'timeout' ? Math.min(MAX_TIMEOUT, L.timeoutMinutes * 60000) : 0 });
      return ' The ladder ' + (step === 'ban' ? 'banned' : 'timed them out') + '.';
    } catch (e) { await postLine('Warn ladder could not act', '<@' + user.id + '>: ' + e.message, COLOR.rust); return ' (the ladder could not act: ' + e.message + ')'; }
  }

  // ------------------------------------------------------------------ commands
  const cmd = (name, desc, perm, build, run) => {
    const b = new SlashCommandBuilder().setName(name).setDescription(desc).setDMPermission(false);
    if (perm) b.setDefaultMemberPermissions(perm);
    if (build) build(b);
    ctx.discord.register({ data: b, run: async (i) => { await i.deferReply({ flags: EPHEMERAL }); await run(i); } });
  };
  const userOpt = (b, desc) => b.addUserOption((o) => o.setName('user').setDescription(desc || 'The person').setRequired(true));
  const reasonOpt = (b, req) => b.addStringOption((o) => o.setName('reason').setDescription('Why').setMaxLength(500).setRequired(!!req));
  const done = (i, text) => i.editReply({ content: text, allowedMentions: { parse: [] } });
  const modInfo = (i) => ({ mod: i.user.id, modTag: i.user.tag || i.user.username });

  cmd('warn', 'Warn someone (it goes on their record)', F.ModerateMembers, (b) => { userOpt(b); reasonOpt(b, true); }, async (i) => {
    const user = i.options.getUser('user', true), member = i.options.getMember('user'); await guard(i, user, member);
    const c = await perform(i.guild, { type: 'warn', user, member, reason: i.options.getString('reason', true), ...modInfo(i) });
    await done(i, 'Warned <@' + user.id + '> (case #' + c.id + '). Active warnings: ' + cases.activeWarnings(i.guild.id, user.id) + '.' + await ladder(i.guild, user, member));
  });
  cmd('timeout', 'Time someone out (they cannot talk or join voice)', F.ModerateMembers, (b) => { userOpt(b); b.addStringOption((o) => o.setName('duration').setDescription('Like 10m, 2h, 7d (max 28d)').setRequired(true)); reasonOpt(b); }, async (i) => {
    const user = i.options.getUser('user', true), member = i.options.getMember('user'), ms = parseDuration(i.options.getString('duration', true));
    if (!ms || ms > MAX_TIMEOUT) throw new Error('Give a duration like 10m, 2h or 7d, up to 28d.');
    if (!member) throw new Error('That person is not in this server.');
    await guard(i, user, member);
    const c = await perform(i.guild, { type: 'timeout', user, member, reason: i.options.getString('reason') || '', ms, ...modInfo(i) });
    await done(i, 'Timed out <@' + user.id + '> for ' + fmtDuration(ms) + ' (case #' + c.id + ').');
  });
  cmd('untimeout', 'Lift a timeout', F.ModerateMembers, (b) => { userOpt(b); reasonOpt(b); }, async (i) => {
    const user = i.options.getUser('user', true); if (!i.options.getMember('user')) throw new Error('That person is not in this server.');
    const c = await perform(i.guild, { type: 'untimeout', user, reason: i.options.getString('reason') || '', ...modInfo(i) });
    await done(i, 'Lifted the timeout on <@' + user.id + '> (case #' + c.id + ').');
  });
  cmd('kick', 'Remove someone from the server (they can come back)', F.KickMembers, (b) => { userOpt(b); reasonOpt(b); }, async (i) => {
    const user = i.options.getUser('user', true), member = i.options.getMember('user'); if (!member) throw new Error('That person is not in this server.');
    await guard(i, user, member);
    const c = await perform(i.guild, { type: 'kick', user, member, reason: i.options.getString('reason') || '', ...modInfo(i) });
    await done(i, 'Kicked <@' + user.id + '> (case #' + c.id + ').');
  });
  cmd('ban', 'Ban someone (also works for people who already left)', F.BanMembers, (b) => { userOpt(b); reasonOpt(b); b.addIntegerOption((o) => o.setName('delete_days').setDescription('Also delete their messages from the last N days (0 to 7)').setMinValue(0).setMaxValue(7)); }, async (i) => {
    const user = i.options.getUser('user', true), member = i.options.getMember('user'); await guard(i, user, member);
    const c = await perform(i.guild, { type: 'ban', user, member, reason: i.options.getString('reason') || '', days: i.options.getInteger('delete_days') || 0, ...modInfo(i) });
    await done(i, 'Banned <@' + user.id + '> (case #' + c.id + ').');
  });
  cmd('unban', 'Unban someone by their user ID', F.BanMembers, (b) => { b.addStringOption((o) => o.setName('user_id').setDescription('Their Discord user ID').setRequired(true)); reasonOpt(b); }, async (i) => {
    const id = i.options.getString('user_id', true).trim(); if (!/^\d{5,25}$/.test(id)) throw new Error('A user ID is only digits (turn on Developer Mode in Discord, right click the person, Copy User ID).');
    const c = await perform(i.guild, { type: 'unban', user: { id }, reason: i.options.getString('reason') || '', ...modInfo(i) });
    await done(i, 'Unbanned <@' + id + '> (case #' + c.id + ').');
  });
  cmd('unwarn', 'Remove a warning (so it stops counting)', F.ModerateMembers, (b) => b.addIntegerOption((o) => o.setName('case').setDescription('The case number').setRequired(true).setMinValue(1)), async (i) => {
    const c = cases.get(i.guild.id, i.options.getInteger('case', true));
    if (!c || c.type !== 'warn') throw new Error('That is not a warning case.');
    if (!cases.undo(i.guild.id, c.id)) throw new Error('That warning was already removed.');
    await postLine('Warning #' + c.id + ' removed', '<@' + c.target_discord_id + '> by <@' + i.user.id + '>');
    await done(i, 'Removed warning #' + c.id + '. <@' + c.target_discord_id + '> now has ' + cases.activeWarnings(i.guild.id, c.target_discord_id) + ' active.');
  });
  cmd('note', 'Write a private note about someone (only mods see it)', F.ModerateMembers, (b) => { userOpt(b); b.addStringOption((o) => o.setName('text').setDescription('The note').setMaxLength(500).setRequired(true)); }, async (i) => {
    const user = i.options.getUser('user', true), c = await perform(i.guild, { type: 'note', user, reason: i.options.getString('text', true), ...modInfo(i) });
    await done(i, 'Saved note #' + c.id + ' about <@' + user.id + '>.');
  });
  cmd('case', 'Look up a case', F.ModerateMembers, (b) => b.addIntegerOption((o) => o.setName('number').setDescription('The case number').setRequired(true).setMinValue(1)), async (i) => {
    const c = cases.get(i.guild.id, i.options.getInteger('number', true)); if (!c) throw new Error('No such case.');
    await i.editReply({ embeds: [caseEmbed(c, c.undone_at ? { footer: { text: 'Undone ' + new Date(c.undone_at).toISOString().slice(0, 10) } } : {})], allowedMentions: { parse: [] } });
  });
  cmd('history', 'A person\'s record: warnings, timeouts, bans, notes', F.ModerateMembers, (b) => userOpt(b), async (i) => {
    const user = i.options.getUser('user', true), list = cases.history(i.guild.id, user.id, 10), s = cases.summary(i.guild.id, user.id);
    const head = Object.entries(s).map(([k, n]) => n + ' ' + k + (n > 1 ? 's' : '')).join(', ') || 'Clean record';
    await i.editReply({ embeds: [embed('Record of ' + (user.tag || user.username || user.id), head + '\nActive warnings: **' + cases.activeWarnings(i.guild.id, user.id) + '**\n\n' + (list.map((c) => '`#' + c.id + '` ' + new Date(c.created_at).toISOString().slice(0, 10) + ' **' + TITLES[c.type] + '**' + (c.undone_at ? ' (undone)' : '') + ': ' + cut(c.reason || 'no reason', 80)).join('\n') || 'Nothing on record.'), COLOR.aqua)], allowedMentions: { parse: [] } });
  });

  cmd('purge', 'Delete recent messages in this channel', F.ManageMessages, (b) => { b.addIntegerOption((o) => o.setName('count').setDescription('How many (1 to 100)').setRequired(true).setMinValue(1).setMaxValue(100)); b.addUserOption((o) => o.setName('user').setDescription('Only this person\'s messages')); }, async (i) => {
    const n = i.options.getInteger('count', true), only = i.options.getUser('user'), ch = i.channel;
    let batch = await ch.messages.fetch({ limit: 100 }); batch = [...batch.values()].filter((m) => !only || m.author.id === only.id).slice(0, n);
    const gone = batch.length ? await ch.bulkDelete(batch, true) : { size: 0 };   // messages older than 14 days cannot be bulk deleted
    await postLine('Purged ' + gone.size + ' messages', 'In <#' + ch.id + '> by <@' + i.user.id + '>' + (only ? ', only from <@' + only.id + '>' : ''));
    await done(i, 'Deleted ' + gone.size + ' messages' + (gone.size < n ? ' (older ones cannot be deleted in bulk)' : '') + '.');
  });
  cmd('slowmode', 'Set slowmode for this channel', F.ManageChannels, (b) => b.addIntegerOption((o) => o.setName('seconds').setDescription('0 turns it off (max 21600)').setRequired(true).setMinValue(0).setMaxValue(21600)), async (i) => {
    const s = i.options.getInteger('seconds', true); await i.channel.setRateLimitPerUser(s, 'By ' + i.user.tag);
    await postLine('Slowmode ' + (s ? s + ' s' : 'off'), '<#' + i.channel.id + '> by <@' + i.user.id + '>'); await done(i, s ? 'Slowmode is ' + s + ' s.' : 'Slowmode is off.');
  });
  for (const [name, lock] of [['lock', true], ['unlock', false]]) {
    cmd(name, lock ? 'Stop everyone from talking in this channel' : 'Let everyone talk in this channel again', F.ManageChannels, null, async (i) => {
      await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: lock ? false : null }, { reason: 'By ' + i.user.tag });
      await postLine('Channel ' + (lock ? 'locked' : 'unlocked'), '<#' + i.channel.id + '> by <@' + i.user.id + '>', lock ? COLOR.rust : COLOR.aqua); await done(i, lock ? 'Locked.' : 'Unlocked.');
    });
  }

  // ------------------------------------------------------------------ the Undo button in #mod-log
  async function onUndo(i) {
    if (!i.memberPermissions || !i.memberPermissions.has(F.ModerateMembers)) return i.reply({ content: 'Only mods can undo.', flags: EPHEMERAL });
    const g = i.guild, c = cases.get(g.id, String(i.customId).split(':')[1]);
    if (!c) return i.reply({ content: 'That case is gone.', flags: EPHEMERAL });
    if (c.undone_at) return i.update({ components: [] });
    const w = 'Undo of case ' + c.id + ' by ' + (i.user.tag || i.user.id);
    try {
      if (c.type === 'ban') await act.unban(g, c.target_discord_id, w);
      else if (c.type === 'timeout') await act.untimeout(g, c.target_discord_id, w);
      else if (c.type !== 'warn') return i.reply({ content: 'That cannot be undone.', flags: EPHEMERAL });
    } catch (e) { return i.reply({ content: describe(e), flags: EPHEMERAL }); }
    cases.undo(g.id, c.id);
    await i.update({ components: [] });
    await postLine('Case #' + c.id + ' undone', TITLES[c.type] + ' of <@' + c.target_discord_id + '> undone by <@' + i.user.id + '>', COLOR.aqua);
    return undefined;
  }
  ctx.discord.registerButton('undo', onUndo);

  return { cases, perform, ladder, onUndo, guard, caseEmbed };
};
