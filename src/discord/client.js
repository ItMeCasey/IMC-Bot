'use strict';
/**
 * The Discord connection (discord.js). It only does plumbing: log in, register slash commands in the one server,
 * hand each command to its module, and report the state to the dashboard. The features live in src/modules.
 */
const { Client, GatewayIntentBits: I, Partials, Events, REST, Routes, MessageFlags, PermissionsBitField } = require('discord.js');
const { NEEDED } = require('../modules/setup');

/** the link that adds the bot to a server (a server install, with just the permissions it uses) */
const inviteUrl = (appId) => 'https://discord.com/oauth2/authorize?client_id=' + appId + '&scope=bot%20applications.commands&integration_type=0&permissions=' + new PermissionsBitField(NEEDED).bitfield;

module.exports = function createDiscord(ctx) {
  const log = ctx.log || (() => {});
  let client = null, status = { state: 'offline', bot: '', error: '' };
  const commands = new Map();   // name -> { data (builder), run(interaction) }
  const buttons = new Map();    // customId prefix (the part before ':') -> handler(interaction)

  /** a module calls this to add a slash command */
  const register = (cmd) => commands.set(cmd.data.name, cmd);
  const registerButton = (prefix, fn) => buttons.set(prefix, fn);

  async function start() {
    const token = ctx.config.secret('token');
    if (!token) { status = { state: 'offline', bot: '', error: 'Paste the bot token first' }; return status; }
    await stop();
    status = { state: 'connecting', bot: '', error: '' };
    const c = new Client({ intents: [I.Guilds, I.GuildMembers, I.GuildMessages, I.MessageContent, I.GuildVoiceStates, I.GuildMessageReactions, I.GuildModeration], partials: [Partials.Message, Partials.Channel, Partials.Reaction] });
    c.on(Events.InteractionCreate, async (i) => {
      if (i.isButton()) {
        const fn = buttons.get(String(i.customId).split(':')[0]);
        if (fn) try { await fn(i); } catch (e) { log('button', i.customId, 'failed:', e.message); try { await i.reply({ content: 'That did not work: ' + e.message, flags: MessageFlags.Ephemeral }); } catch (x) { /* expired */ } }
        return;
      }
      if (!i.isChatInputCommand()) return;
      const cmd = commands.get(i.commandName); if (!cmd) return;
      try { await cmd.run(i); } catch (e) {
        log('command', i.commandName, 'failed:', e.message);
        const m = { content: 'That did not work: ' + e.message, flags: MessageFlags.Ephemeral };
        try { await (i.deferred || i.replied ? i.followUp(m) : i.reply(m)); } catch (x) { /* the interaction expired */ }
      }
    });
    c.on(Events.Error, (e) => log('discord error:', e.message));
    client = c;
    try { await new Promise((resolve, reject) => { c.once(Events.ClientReady, resolve); c.login(token).catch(reject); }); } catch (e) {
      client = null; try { await c.destroy(); } catch (x) { /* never opened */ }
      status = { state: 'error', bot: '', error: /token/i.test(e.message) ? 'Discord did not accept that token' : e.message }; throw new Error(status.error);
    }
    status = { state: 'online', bot: c.user.tag, error: '', invite: inviteUrl(c.user.id) };
    if (ctx.onReady) ctx.onReady(c);
    if (ctx.config.get().guildId) await registerCommands().catch((e) => log('slash commands:', e.message));
    return status;
  }
  async function stop() { if (client) { try { await client.destroy(); } catch (e) { /* closing */ } client = null; } status = { state: 'offline', bot: '', error: '' }; }

  /** pushes the slash commands to the server (instant there, unlike global ones) */
  async function registerCommands() {
    const gid = ctx.config.get().guildId; if (!gid || !client) return;
    const rest = new REST({ version: '10' }).setToken(ctx.config.secret('token'));
    await rest.put(Routes.applicationGuildCommands(client.user.id, gid), { body: [...commands.values()].map((c) => c.data.toJSON()) });
  }
  const guilds = () => (client ? [...client.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name })) : []);
  const guild = async () => { const id = ctx.config.get().guildId; if (!client || !id) throw new Error('Choose a server first'); return client.guilds.fetch(id); };
  return { start, stop, register, registerButton, commandList: () => [...commands.values()].map((c) => c.data.toJSON()), registerCommands, guilds, guild, status: () => status, client: () => client };
};
