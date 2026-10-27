# IMC-Bot

A Discord bot that moderates and runs a streamer's server and works with IMC-Stream. See [PLAN.md](PLAN.md) for the full plan.

**Status:** phases 1 and 3 (part): dashboard, bot connection, server setup (roles, channels, welcome, rules), `/ping`, greeting for new members, and the IMC-Stream bridge with go-live posts (edited as the stream changes and ends) and recap posts. Moderation: slash commands, numbered cases, a warn ladder, and #mod-log with Undo buttons. AutoMod: spam, repeats, mention floods, invites, links, caps, emoji, banned words, raid alert and an account-age check.

## Run it

```
npm install
npm start
```

Open http://localhost:8440 and follow the Connect steps. Needs Node 22.13 or newer. Settings, the bot token and the database are in `data/` (kept out of git). Tests: `npm test`.

The dashboard uses IMC-Stream's look. IMC-Stream no longer has its own Discord bot. IMC-Stream and the bot talk through `GET /api/bridge/events?since=N` and `/api/bridge/state` on IMC-Stream (this PC only); the bot asks every 3 seconds and remembers the last number, so a restart misses nothing.
