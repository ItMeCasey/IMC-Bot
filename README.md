# IMC-Bot

A Discord bot that moderates and runs a streamer's server, and works with [IMC-Stream](https://github.com/ItMeCasey/IMC-Stream): go-live posts, Twitch chat in Discord, recaps, raids and milestones. It runs on your PC, has a dashboard in IMC-Stream's look, and keeps its token and data on your PC.

## Install
1. Run **`IMC-Bot Setup <version>.exe`** (from the Releases page). It makes a Start menu and desktop shortcut and lives in the tray.
2. In the window that opens, follow **Connect**: make a bot on https://discord.com/developers/applications (New Application, Bot, Reset Token), switch on **Server Members Intent** and **Message Content Intent**, paste the token, and use the **invite link** the page shows to add the bot to your server.
3. Pick your server and press **Set up my server**. It only adds what is missing (roles, channels, welcome and rules); it never changes or deletes what you have.

From source instead: Node 22.13 or newer, then `npm install` and `npm start` (or `start-bot.bat`), and open http://localhost:8440. `npm run desktop` runs the tray app from source.

Your settings, the bot token (`secrets.json`) and the database are in the data folder: `%APPDATA%\IMC-Bot\data` for the installed app, `data/` when run from source. Tray menu, *Open the data folder*. To move an existing setup into the installed app, copy that folder.

## What it does
Everything has a switch in the dashboard. Things that act on people start **off**, and the **Dry run** switch (on by default) makes AutoMod, the warn ladder, anti-nuke and the Regulars limits only say in `#mod-log` what they would have done.

| Area | What it does |
|---|---|
| **Moderation** | `/warn /timeout /untimeout /kick /ban /unban /unwarn /note /case /history /purge /slowmode /lock /unlock`. Every action is a numbered case in `#mod-log` with an **Undo** button. Nobody can act on themselves, the bot, the owner or someone with an equal or higher role. A warn ladder (timeout at 3 active warnings, ban at 5 by default) with warnings that expire. |
| **AutoMod** | Spam, repeated messages, mention floods, invite links, links (with an allowed-sites list), caps, emoji walls, banned words, a raid alert and an optional account-age kick. Mods are never touched, and chosen channels can be left alone. |
| **Regulars** | New members can't post links, images or invites until they have been in the server a set time and taken part in a set number of real conversations (default 7 days and 10); then the bot gives the **Regular** role. `/progress` shows where you are; `/regular` lets mods grant or hold back. |
| **Twitch chat mirror** | Your Twitch chat in `#twitch-chat` under each chatter's name and Twitch picture. Leaves out commands and bots, can show only subs or VIPs, cannot ping anyone, and follows Twitch deletes and timeouts. |
| **Go-live and recaps** | One message per stream in `#go-live` (title, game, thumbnail, optional ping), edited when it changes and when the stream ends. IMC-Stream's recaps go to `#announcements`. |
| **Discord alerts on stream** | Server boosts, new members and member milestones show as alerts on your stream, like a follow or a sub. Their look and sound are set in IMC-Stream (Alerts and the Alert Builder). The dashboard has a test button. |
| **Stream announcements** | Raids and follower milestones in `#announcements`. `/schedule` shows the next streams. |
| **Viewer commands** | `/commands /games /tts /top /live /website`, answered from IMC-Stream's own lists. |
| **Server log** | Deleted and edited messages, joins and leaves, nicknames, roles and voice moves in `#audit-log`. |
| **Community** | `/giveaway`, `/poll`, `/suggest` and `/suggestion`, XP levels with `/rank` and `/leaderboard` and level roles, a starboard, `/rolepanel` self-assign buttons, `/ticketpanel` private tickets (good for ban appeals, with a transcript saved to `#mod-log`), `/verifypanel` and anti-nuke protection. |

## Working with IMC-Stream
The bot talks to IMC-Stream over a small bridge (`http://127.0.0.1:8420/api/bridge/...`). It needs an IMC-Stream version that has the bridge. The dashboard shows whether it is connected. IMC-Stream no longer has a Discord bot of its own.

**IMC-Bot on another computer** (for example one that is always on): in IMC-Stream's Setup page switch on remote access and set a password, then in the bot's dashboard enter IMC-Stream's address (for example `http://192.168.1.20:8420`) and that password. The bot logs in like a phone or tablet would. Use a trusted network or a VPN; do not put IMC-Stream on the open internet.

To try the bot without streaming, run `node tools/fake-stream.js` (with IMC-Stream closed) and open http://localhost:8420: buttons start and end a stream, change the title, send chat lines, raids and follows, and make a recap.

## Permissions and privacy
- The invite link asks only for the permissions the bot uses (manage roles and channels, kick, ban, manage messages, moderate members, view the audit log, manage webhooks, embed links).
- The bot needs the **Server Members** and **Message Content** intents. In the Developer Portal also switch **Public Bot** off, so nobody else can add your bot to another server (the bot ignores other servers anyway).
- The token is saved only on your PC and never sent to the dashboard page. The dashboard and the bridge answer only this PC.
- The bot stores IDs, counts and the text of moderation reasons. Message text is kept only for a moment in Discord's own cache (for the log); tickets keep a transcript only in `#mod-log`.

## Develop
`npm test` runs the tests (Node's built-in test runner, no network, no real Discord). `npm run pack` builds an unpacked app and `npm run dist` the installer into `dist/`. Pushing a tag like `v2026.10.27` (matching `package.json`) builds the installer in GitHub Actions and attaches it to a draft release.

## Documentation
- [How it is built](docs/ARCHITECTURE.md): the layout, the modules, the settings, the database, how to add a feature.
- [Slash commands](docs/COMMANDS.md): every command, who can use it and its options (generated from the code).
- [The IMC-Stream bridge](docs/BRIDGE.md): the routes and events between the two programs.
- [Security](docs/SECURITY.md): what is protected from whom, the design choices, the known limits and the audit history.
