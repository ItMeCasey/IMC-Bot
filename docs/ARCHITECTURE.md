# How IMC-Bot is built

IMC-Bot is a Node program (Node 22.13 or newer, CommonJS) with one dependency, `discord.js`. The database is Node's built-in SQLite (`node:sqlite`). It runs in one of two ways: `node src/index.js`, or as the tray app in `desktop/` (Electron), which starts the same program as a child process.

```
src/
  index.js            start-up: builds every module and wires them together
  config.js           settings (config.json) and secrets (secrets.json)
  db.js               the database and its numbered upgrade steps
  kv.js               small named values in the database
  theme.js            the colours and the embed helper
  perms.js            the second permission check privileged commands make when they run
  links.js            finding web addresses in chat text (with or without https://)
  discord/client.js   the Discord connection, slash command and button routing
  web/server.js       the dashboard server (127.0.0.1 only) and its API
  bridge/local.js     the link to IMC-Stream (events, state, alerts)
  modules/            one file per feature (below)
public/               the dashboard page (one HTML file with its script) and ui-theme.js
desktop/              the Electron tray app and its icons
tools/                fake-stream.js (a stand-in for IMC-Stream), gen-commands-doc.js
test/                 node:test tests; nothing touches the network or a real Discord
docs/                 this folder
```

## Start-up (`src/index.js`)

`main()` loads the config, opens the database, builds the Discord client wrapper, then builds each feature module with the shared **context** (`ctx`), starts the dashboard, and, if a token is saved, connects to Discord. When Discord is ready (`ctx.onReady`) it attaches the event listeners and starts the timers (bridge polling, giveaway/poll/Regulars timers, the chat mirror). `main()` returns `{ ctx, late, web, port, quit }` so tests can run the whole program without a token.

### The context

Every module is a factory `createX(ctx)` and takes what it needs from `ctx`, so tests can hand it fakes.

| Name | What it is |
|---|---|
| `ctx.config` | `get()` the settings, `secret(name)`, `set(changes)`, `setChannels(map)`, `view()` (the page-safe copy) |
| `ctx.db`, `ctx.kv` | the SQLite database; `get(key)` / `set(key, value)` named values |
| `ctx.log` | logging function |
| `ctx.now` | the clock (tests replace it) |
| `ctx.discord` | the client wrapper: `register(command)`, `registerButton(prefix, fn)`, `client()`, `guild()`, `commandList()` |
| `ctx.fetchChannel(id)`, `ctx.fetchGuild(id)`, `ctx.guilds()`, `ctx.botId()`, `ctx.getWebhook(channelId)` | helpers that look things up through the live client |
| `ctx.bridge` | the IMC-Stream link: `snapshot()`, `info()`, `schedule()`, `avatars(ids)`, `alert(event, vars)`, `on(fn)`, `status()` |
| `ctx.moderation` | set once the moderation module exists (`perform`, `ladder`), used by AutoMod and Regulars |
| `ctx.onModAction(guild, modId, kind)` | called when a moderator bans or kicks with the bot, so anti-nuke can count it |

## Modules (`src/modules/`)

| File | Does | Listens to |
|---|---|---|
| `setup.js` | adds missing roles and channels, welcome and rules (never edits) | dashboard buttons |
| `basic.js` | `/ping`, greeting for new members | member join |
| `moderation.js`, `cases.js` | slash commands, numbered cases, warn ladder, `#mod-log` with Undo; the case store | commands, Undo button |
| `automod.js` | spam, repeats, mentions, invites, links, caps, emoji, words, raid alert, account age | messages, joins |
| `regulars.js` | limits for new members until the Regular role is earned | messages, joins |
| `logging.js` | the server log in `#audit-log` | message edit/delete, member and voice events |
| `golive.js` | one go-live message per stream, edited as it changes; recap posts | bridge events |
| `announce.js` | raid and follower milestone posts | bridge events |
| `streamalerts.js` | Discord boosts, joins and milestones shown as alerts on stream | boost messages, member events |
| `mirror.js` | Twitch chat in `#twitch-chat` through a webhook | bridge chat events |
| `viewer.js` | `/commands /games /tts /top /live /website /schedule` | commands |
| `giveaway.js`, `polls.js` | timed giveaways and polls, kept in the database | commands, buttons, timers |
| `suggestions.js`, `xp.js`, `starboard.js` | suggestions with votes, XP and levels, the starboard | commands, buttons, messages, reactions |
| `selfroles.js`, `verify.js`, `tickets.js` | role panels, the Verify button, private tickets | commands, buttons |
| `antinuke.js` | strips the powers of an account that deletes or bans in a burst | channel, role and ban events |

Conventions: each file starts with a comment saying what it does; behaviour that changes the server is **off by default**; anything that acts on people honours **Dry run** (`config.dryRun`); logic that needs time or Discord objects is written so a test can pass fakes (`ctx.now`, injected functions) and the pure parts (`diff()` in `setup.js`, `evaluate()` in `automod.js`, `pick()` in `giveaway.js`, `levelFor()` in `xp.js`, `parseDuration()` in `cases.js`) are exported and tested on their own.

## Settings and secrets (`config.js`)

`data/config.json` holds everything the dashboard shows. `data/secrets.json` holds the bot token, the IMC-Stream password and a reserved bridge secret. `config.set(changes)` is the only way in: it copies only known keys, clamps numbers to ranges, restricts text to allowed values and splits lists, so a bad value from the dashboard cannot corrupt the file. `view()` is what the dashboard receives: it never contains a secret, only whether one is set. An older `config.json` is topped up with the defaults for settings added later.

## Database (`db.js`)

`PRAGMA user_version` records how many upgrade steps ran; each release only appends a step, so an old file upgrades itself.

| Step | Tables |
|---|---|
| 1 | `cases`, `warnings`, `kv` |
| 2 | `giveaways`, `giveaway_entries`, `giveaway_winners` |
| 3 | `tickets` |
| 4 | `member_stats` (Regulars) |
| 5 | `suggestions`, `suggestion_votes`, `polls`, `poll_votes`, `xp`, `starred` |

All queries are prepared statements with bound values.

## Discord (`discord/client.js`)

Wraps the `discord.js` client: logs in, makes every listener ignore events from any server but the chosen one (and leaves a server it is newly added to), sets `allowedMentions` to none by default, registers all slash commands in the chosen server (instant there, unlike global commands), routes a slash command to the module that registered it and a button press to the handler registered for the part of its custom id before the first `:` (`undo:12`, `gw:3`, `ticket:open`...), and turns an error inside a handler into a private "That did not work" reply. Intents: Guilds, Server Members, Messages, Message Content, Voice States, Reactions, Moderation. Server Members and Message Content are privileged and must be switched on in the Developer Portal.

## Dashboard (`web/server.js`, `public/index.html`)

A plain HTTP server on `127.0.0.1` (port 8440). It refuses a `Host` header that is not local (DNS rebinding), a non-local remote address, and any non-GET request whose `Origin` is not local. Routes are `GET /api/status`, `POST /api/settings` and a few action routes (`connect`, `plan`, `setup`, `test-stream-alert`). The page polls `/api/status` every few seconds and sends settings back; the token and password are only ever sent *to* the server.

## The link to IMC-Stream (`bridge/local.js`)

Pull-based: the bot asks IMC-Stream for everything after the last event number it saw. See [BRIDGE.md](BRIDGE.md).

## Desktop app (`desktop/main.js`)

Electron main process only: single-instance lock, a tray icon whose colour shows the bot's state, a window that loads the dashboard, and a supervisor that starts `src/index.js` with Electron's runtime in node mode and restarts it if it stops (at most 5 times a minute). Data goes to `%APPDATA%\IMC-Bot\data` (or `IMC_BOT_DATA`). `asar` is off so the bot's own files are plain files.

## Tests

`npm test` runs `node --test`. Tests use fakes for Discord objects and for IMC-Stream (including a real HTTP fake in `tools/fake-stream.js`), a clock they control, and an in-memory database. `test/boot.test.js` starts the whole program without a token and checks that every module is wired, that the dashboard answers, and that every slash command is valid for Discord (names, description lengths, required options first, also inside subcommands). `test/docs.test.js` checks that every source file has a header comment and that `docs/COMMANDS.md` is current.

## Adding a feature

1. Write `src/modules/thing.js` as `createThing(ctx)`, with a header comment; register commands with `ctx.discord.register` and buttons with `registerButton`.
2. New settings: add defaults (and ranges) in `config.js`, so unknown or out-of-range values are cleaned.
3. New stored data: append a step in `db.js`.
4. Wire it in `index.js` (create it, attach listeners in `ctx.onReady`), add it to the list in `test/boot.test.js`.
5. Add a dashboard section if it has settings, off by default.
6. Write tests with fakes, run `node tools/gen-commands-doc.js`, run `npm test`.
