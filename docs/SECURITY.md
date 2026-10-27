# Security

## Reporting a problem
Please open a private security advisory on the GitHub repository (Security, Report a vulnerability) rather than a public issue. Include what you did, what you expected and what happened.

## What the bot protects, and from whom
| Asset | Where it lives | Who must not get it |
|---|---|---|
| Discord bot token | `data/secrets.json` | web pages, other people on the network, logs, Discord messages |
| IMC-Stream remote-access password (only if used) | `data/secrets.json` | the same |
| Moderator powers | the bot's role and its slash commands | ordinary members, other web pages |
| Your server | the bot's permissions | a hijacked mod account, an abusive member |

**Trust boundaries**
- The dashboard is for the person at the PC. It listens on `127.0.0.1` only and refuses other hosts, other origins and non-local addresses.
- Discord users, Twitch chat and the text of every message are untrusted. They are never turned into pings, never evaluated, and only reach the database through bound parameters.
- IMC-Stream is trusted as far as its own login is. Its answers are treated as text and numbers, never as markup, addresses or code.

## Design choices that matter
- **Secrets** are stored in their own file, never in `config.json`, never returned by the API (the page only learns *whether* a token is set), and never logged. The token is accepted by `POST /api/settings` and goes nowhere else.
- **Least privilege:** the invite link asks only for the permissions the bot uses. Slash commands carry Discord default permissions so they are hidden from people who cannot use them; button actions (Undo, Close ticket, role and verify buttons) check the permission again when pressed.
- **Role hierarchy:** moderation refuses the owner, the bot, yourself and anyone whose top role is not below both the moderator's and the bot's. Self-assign, Verified and level roles are only handed out when the role is a plain one: not managed, below the bot, and without administrator, manage, kick, ban, time-out or mention-everyone powers. This is checked each time, not only when a panel is made.
- **Mentions:** everything the bot posts from untrusted text uses `allowedMentions: { parse: [] }` (or only the one person meant), and Twitch chat has `@everyone`, `@here` and mention syntax broken up as well.
- **Dry run** (on by default) turns every automatic action on people (AutoMod, the warn ladder, the Regulars limits, anti-nuke, the account-age kick) into a line in `#mod-log`.
- **One server only:** the bot belongs to the server chosen in the dashboard. Events from any other server it is added to are ignored, and it leaves a server it is newly added to. (Also switch off "Public Bot" in the Developer Portal, so nobody else can add it.)
- **The dashboard** only runs its own script (a strict Content-Security-Policy with no inline script), cannot be framed, escapes everything that comes from Discord, IMC-Stream or error texts, and accepts changes only from its own page (the exact scheme, host and port), so another page on another local port cannot use it. A saved IMC-Stream password is dropped when the IMC-Stream address is changed.
- **Everything optional is off by default.**
- **SQL:** prepared statements only; the table definitions are constants.
- **Denial of service:** request bodies, lists, names, queues, caches and per-user histories all have limits; the chat mirror slows a flood to a few lines per second.
- **The desktop app** keeps Node integration off and the window sandboxed, opens only `https` links in the browser, and never loads anything but the local dashboard.
- **Supply chain:** one runtime dependency (`discord.js`); the lockfile is committed; releases are built by GitHub Actions from a tag and come with SHA-256 checksums.

## Known limits (be aware)
- The token is stored as plain text in your user profile (`%APPDATA%\IMC-Bot\data\secrets.json`), protected by Windows file permissions only. Anyone who can read your profile can read it. If it leaks, press **Reset Token** in the Discord Developer Portal.
- The installer is **not code-signed**, so Windows SmartScreen warns. Compare the file with `SHA256SUMS.txt` from the release.
- IMC-Stream remote access is plain HTTP. Use it only on a network you trust, or through a VPN; never expose IMC-Stream to the internet.
- Another program running as the same Windows user can read the data folder and call the dashboard. The dashboard defends against web pages and other computers, not against software that already runs as you.
- Discord slash command permissions can be changed by a server owner in Integrations; that is their call. The bot's own role-hierarchy checks still apply.

## Audit history

### 2026-10-27: independent review and our own pass
An independent reviewer read the whole code base (without being told what we had found) and we reviewed it ourselves. No critical or high finding. Everything below was fixed and has tests unless marked.

| Finding | Result |
|---|---|
| A request with `Origin: null` crashed the dashboard process | Fixed: every handler is guarded, bad origins are refused, and unexpected errors are logged, not fatal |
| Dashboard accepted any local origin (any port), and the saved IMC-Stream password followed a changed address | Fixed: the origin must be exactly the dashboard; changing the address clears the password. *Accepted:* another program running as you can still call the API (documented) |
| HTML injection in the dashboard through error text | Fixed: everything is escaped, no inline script, strict CSP, no framing |
| Undo skipped the permission and hierarchy checks; `/untimeout` and `/unwarn` too; commands relied on Discord's default permissions alone | Fixed: Undo needs the permission of the original action and obeys the role rules (not on yourself, not above you, not a higher-ranked mod's case); every privileged command checks the real permission when it runs |
| Events from other servers the bot was added to were handled with this server's settings | Fixed: other servers are ignored and left |
| Self-assign and Verified roles: no check against the maker's own rank; short list of powers | Fixed: you cannot offer a role above your own top role (the owner can); the power list now includes threads, mute, deafen, move, expressions and insights. *Accepted:* a plain role that only opens channels through channel permissions is the streamer's choice to offer |
| Ticket button could be raced into many channels and past the cap | Fixed: one ticket being made per person, the cap counts tickets in progress |
| Anti-nuke could not see bans and kicks made through the bot | Fixed: `/ban` and `/kick` feed it |
| Electron 39 shipped with 12 advisories | Fixed: Electron 45; `npm audit` is clean |
| Release workflow ran the build with a write token; actions pinned by tag | Fixed: build job read-only, separate publish job, actions pinned to commits, weekly update PRs |
| `/unlock` could open a channel that was read-only on purpose | Fixed: `/lock` remembers the channel's state and `/unlock` restores it, and only for channels it locked |
| Edited messages escaped AutoMod and the Regulars limits; addresses without `https://` were missed | Fixed |
| The starboard copied messages from private channels; two stars at once could post twice | Fixed |
| Viewer commands unthrottled; Twitch schedule asked on every use; mod-only commands listed | Fixed: a 5 second cooldown, a one-minute schedule cache, only commands for everyone are listed |
| Bridge requests had no timeout; a changing run id could loop | Fixed |
| Twitch chat and recaps could carry Discord invites or phishing links | Fixed: invites are always replaced, links are replaced by default |
| The invite link lacked Ban Members | Fixed |
| A failed giveaway draw stayed closed; `/suggest` had no cooldown | Fixed: the draw is retried (up to five times); 30 second cooldown |
| Internal error text shown to users | Fixed: only plain messages and Discord's own error texts are shown |
| Remote IMC-Stream login is plain HTTP | *Documented:* the dashboard warns, README and this page say to use a trusted network or VPN |
| Warn ladder can skip a step if two warnings are counted between steps; go-live pings again for a new stream; no per-launch dashboard token | *Accepted* (low impact) |
