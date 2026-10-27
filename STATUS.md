# IMC-Bot status (written overnight, 2026-10-26)

Nothing is committed or pushed, in either project. Run the tests with `npm test` (70 pass).

## What exists now
| Area | What it does | Default |
|---|---|---|
| Dashboard `http://localhost:8440` | Token, server, setup, every setting below | |
| Server setup | Roles, channels (now also `#audit-log`), welcome, rules. Only adds what is missing | press the button once more to get `#audit-log` |
| Moderation | `/warn /timeout /untimeout /kick /ban /unban /unwarn /note /case /history /purge /slowmode /lock /unlock`, cases, warn ladder, `#mod-log` with Undo | on |
| AutoMod | Spam, repeats, mentions, invites, links, caps, emoji, banned words, raid alert, account-age kick | **off**, Dry run on |
| Twitch chat mirror | Chat into `#twitch-chat` through a webhook, deletes follow Twitch, floods slowed | **off** |
| Server log | Deleted/edited messages, joins/leaves, nicknames, roles, voice into `#audit-log` | **off** |
| Self-assign roles | `/rolepanel` posts buttons that toggle roles (refuses roles with powers) | on (mods with Manage Roles) |
| Viewer commands | `/commands /games /tts /top /live /website`, answered from IMC-Stream (they were lost when the built-in bot was removed, now back) | on, needs the bridge |
| Giveaways | `/giveaway start prize duration [winners] [role]`, `end`, `cancel`, `reroll`, `list`; Enter button; random draw; survives restarts | on (mods with Manage Messages) |
| Tickets | `/ticketpanel` posts an "Open a ticket" button; private channel for the person + Mods; Close saves a transcript to `#mod-log`. Good for ban appeals | on (needs Manage Channels) |
| Regulars | New members can't post links/images/invites/mention floods until N days in the server + N separate conversations, then get the `Regular` role. `/progress` (everyone), `/regular status/grant/revoke` (mods) | **off** |
| Go-live + recap | One message per stream, edited as it changes and ends; recaps to `#announcements` | on, needs the bridge |

Dry run (dashboard, Switches) is still **on**: AutoMod and the warn ladder only report in `#mod-log`, they change nothing.

## Try it without streaming (the fake IMC-Stream)
1. Make sure the real IMC-Stream is **not** running (same port 8420).
2. `node tools/fake-stream.js` in the IMC-Bot folder, open http://localhost:8420.
3. In the dashboard: set a ping if you want, switch on **Mirror Twitch chat**, press **Set up my server** (adds `#audit-log`).
4. Press the buttons: *Stream starts* (post in `#go-live` after ~20 s), *Title and game change* (edits it), *Chat: Sam (sub)* (line in `#twitch-chat`), *Stream ends*, *Recap appears* (`#announcements`).

## Try the real thing
The installed IMC-Stream (2026.10.17) has **no bridge**. Run IMC-Stream from source (`C:\Users\casey\dev\ItMeCasey-Stream`, the working tree has it) or wait for a release.

## Not tested live (only by tests with pretend Discord/IMC-Stream)
Everything after `/ping`: the moderation commands, AutoMod, the mirror's webhook, the log, `/rolepanel`, go-live in your server.
Things to look at first: do the 16 slash commands show up, does `/warn` + Undo work on an alt account, does the webhook get created in `#twitch-chat`.

## IMC-Stream working tree (uncommitted)
My changes there: deleted the built-in Discord bot (`server/discord.js`, `discord-test.js`, `public/discord.html`), the recap Discord option, new `server/bridge.js` + `bridge-test.js`, bridge routes (`events`, `state`, `info`) and events in `server/server.js`, and the two CI test lists.
**The working tree also holds other changes that are not mine** (browser extension, alert builder/design/import, `app/package.json`, `public/index.html`, `overlays/alerts.html`, `vm-config.ps1`, `assets/stock`). Commit selectively; `server/server.js` mixes both.

## Not built yet
Twitch ↔ Discord account linking and ban sync (parked, per your call), sub-tier/follower roles (needs linking), relay mode for hosting the bot elsewhere, XP/giveaways/tickets, a shared secret for the bridge (it is this-PC-only for now).

## Things I changed my mind about while building
- Dashboard port is **8440** (8430 is used by IMC-Chat).
- The database is Node's built-in SQLite (needs Node 22.13+), not `better-sqlite3`.
