# IMC-Bot: build plan

A Discord bot that moderates and runs a streamer's Discord server, and works hand in hand with IMC-Stream: shared bans, chat mirror, go-live posts, sub roles.

## 0. What IMC-Stream already gives us (from its installed `resources/`)

| Fact | Why it matters |
|---|---|
| Electron app + local Node server on `127.0.0.1:8420`; non-loopback access only with LAN switch + password (`server/access.js`) | The bot cannot reach it from a VPS without a tunnel or relay. Drives the bridge design (§3). |
| Twitch via Device Code login + EventSub WebSocket (~35 subscriptions), `helix()` wrapper with single-flight token refresh | The bot should NOT log into Twitch itself. It asks IMC-Stream for events and actions. One Twitch login, one set of scopes. |
| Moderation actions already exist (`delete / clear / timeout / ban / unban`, Helix, scope `moderator:manage:banned_users`) | Discord→Twitch actions reuse these. No new Twitch code for sending bans. |
| Server-Sent Events at `/events` (`broadcast(event, data)`) | Ready-made event feed for a local bot. |
| Cloudflare Worker relay (`relay/src`, Durable Object, WebSocket with `RELAY_TOKEN`) for tips | Proven pattern for a 24/7 bridge when the bot is hosted off the PC. |
| **A built-in Discord bot already exists** (`server/discord.js`, zero-dependency REST + gateway): server setup (roles/channels/rules), go-live embed, slash commands `/commands /games /tts /top /live /website`, token in `data/discord.json` | IMC-Bot supersedes it. Two bots on one token fight over the gateway and double-post go-live. Needs a hand-off switch (§9). Its `LAYOUT`/`ROLES`/embed helpers are ported, not rewritten. |
| No account linking exists anywhere | Linking is new work on both sides. |

Style facts (for the dashboard and embeds):
- Palette: iron `#222A2A`, iron-dark `#1A2020`, aqua `#4FBBBC`, heat `#F39120`, rust `#EC4624`, dark-rust `#B13A22`, cream `#E2DAC2`, line `#2f3938`, input border `#46504f`, muted `#9aa39f`.
- Font: Bahnschrift, fallback Segoe UI. Square corners everywhere (no border radius). Headings uppercase with wide letter-spacing (3–5px). Buttons uppercase, bold, heat-orange fill, `filter: brightness(1.12)` on hover, ghost variant with a 2px `#46504f` outline.
- Header bar: dark-iron strip with a 5px gradient underline (aqua 30 / heat 25 / rust 20 / dark-rust 15 / cream 10). Sections: dark-iron panels with a 1px top line. Category cards get a 4px left border cycling aqua → heat → rust. Toast at bottom centre.
- Reuse IMC-Stream's `ui-theme.js` (form controls, accordions, light theme and density) directly by copying it. It keeps the two UIs in lockstep.
- Code style: `'use strict'` CommonJS, a doc comment at the top of each file saying what it does, factory `createX(ctx)` with `ctx.fetch / ctx.WebSocket / ctx.sleep / ctx.log` injected so tests run with fakes, JSON files for config, terse comments explaining *why*.
- Discord embeds use the same four colours (aqua info, heat notice, rust live/alert, cream neutral), as `discord.js` in IMC-Stream does now.

## 1. Goals and non-goals

Goals
1. Full moderation of one streamer's Discord server (manual tools, automod, logging, case history).
2. Verified Twitch ↔ Discord account linking through the Twitch account already connected in Discord, with ban/timeout/unban sync for linked users only.
3. Twitch chat mirrored into a chosen channel (and optionally back).
4. Go-live, offline, clip, raid, schedule and milestone announcements.
5. Role automation from Twitch status (sub tiers, follower, VIP, mod).
6. A dashboard in IMC-Stream's look.

Non-goals (v1): multi-server hosting/sharding, music, public bot listing, anything needing Discord bot verification. Design for a single guild, with `guild_id` kept in tables so multi-guild is not a rewrite.

## 2. Tech choices

- Node 20+, CommonJS, **discord.js v14** (this is far too large to hand-roll on the raw gateway like IMC-Stream's small bot; components, modals, webhooks, AutoMod events, scheduled events all come built in). Keep the `ctx`-injection pattern so logic modules never import discord.js directly except in thin adapters. Alternative: keep zero-dependency like IMC-Stream. Costs weeks. See open question 2.
- SQLite via `better-sqlite3` (cases, links, mirror map, xp). Config in `data/config.json`, secrets in `data/secrets.json` (never sent to a page, same rule as `data/discord.json`).
- Dashboard: plain HTML pages + small vanilla JS, served by the bot on `127.0.0.1:8440`, same `access.js` gate pattern (loopback only, Host-header check, optional LAN + password).
- Tests: `node:test`, fake Discord client and fake bridge. Same approach IMC-Stream's modules are built for.
- Repo: `github.com/ItMeCasey/IMC-Bot` (new username, not `Drakma`). Commits carry no AI attribution lines.

## 3. Bridge: how IMC-Bot talks to IMC-Stream

Two transports, one message format, so the bot code never cares which is in use.

**Mode A (v1): local.** Bot and IMC-Stream on the same PC.
- Events in: bot opens `GET http://127.0.0.1:8420/events` (existing SSE) or a new filtered `GET /api/bridge/events?since=<cursor>`.
- Actions out: `POST /api/bridge/<action>` on IMC-Stream.
- Auth: loopback is already trusted, plus a shared `bridgeSecret` header so a random local process cannot drive bans.

**Mode B (v2): relay, for a bot hosted 24/7 on a VPS or free host.** IMC-Stream dials out to a Cloudflare Worker + Durable Object (extend the existing relay, same `RELAY_TOKEN` pattern); the bot dials in to the same room. No inbound port on the streamer's PC.

**IMC-Stream changes needed (small, in its repo, behind a "Bridge" setting that is off by default):**
1. `server/bridge.js`: event fan-out with a monotonic cursor and a ring buffer (last ~2000 events) so the bot can resume after a restart without missing a ban.
2. Subscribe to ban/unban events if not already: `channel.moderate` v2 (covers ban, unban, timeout, untimeout, delete) or `channel.ban` / `channel.unban`. **Verify the exact scopes first** (the app's `SCOPES` list has `moderator:manage:banned_users`; reading the events needs more than managing them). Adding scopes forces a Twitch re-login, which the app already handles via `missingScopes()`.
3. Events published on the bridge: `chat.message`, `chat.delete`, `chat.clear`, `mod.ban`, `mod.timeout`, `mod.unban`, `stream.online`, `stream.offline`, `stream.update` (title/game), `follow`, `sub` (new/gift/end, with tier), `raid`, `clip`, `viewers` (periodic), `hype`, `poll`, `prediction`.
4. Actions accepted: `mod {ban|timeout|unban|delete}`, `say` (send a Twitch chat message), `whois {twitch_login|id}` (id, avatar, follower/sub/VIP/mod status), `banlist` (Helix `GET /moderation/banned`, paged, for reconcile), `subs`, `state` (live, title, game, viewers, points leaderboard, command list, games, TTS text: what the current slash commands read).
5. Fallback link proof only: `POST /api/bridge/link/issue {twitch_user_id}` and chat command `!link` (§4). Not needed for the Connections flow.

Every event carries `id`, `ts`, `origin` (`twitch | discord | bot`), and every action carries an `idempotencyKey`. Together these prevent sync loops (§5).

## 4. Verified account linking

The point: only act across platforms when the same person provably owns both accounts.

**Primary flow: Discord's own linked Twitch account (Connections).** Discord already verified the Twitch account when the user connected it in User Settings → Connections, so no codes are needed.
1. Viewer clicks **Link Twitch** (button in `#verify`/`#welcome`, or `/link`). The bot replies with a Discord OAuth2 URL asking for scopes `identify` + `connections` only.
2. Discord redirects to the bot's callback. The bot exchanges the code, calls `GET /users/@me/connections`, and picks the entry with `type: "twitch"` and `verified: true`. That entry's `id` is the **Twitch user ID** and `name` is the login. The OAuth token is discarded right after; nothing is stored.
3. Stored: `discord_id ↔ twitch_user_id` (+ login, display name, `verified_at`, `method='discord-connection'`). Always key on user ID, since logins can be renamed.
4. Bot gives the "Linked" role, applies sub/follower roles, and checks the Twitch ban list (§5, "late linkers").
5. If the user has no verified Twitch connection, the bot says how to add one (Discord → Settings → Connections → Twitch) and offers a retry button. Multiple Twitch connections: let them pick.

**No lookup API exists (checked against Discord's docs):** the only way to read connections is `GET /users/@me/connections` with that user's own OAuth token. There is no endpoint to find a Discord user by Twitch ID, or to list a member's connections with the bot token. `GET /guilds/{id}/integrations` returns only a subscriber *count* and a role ID, never user IDs. The linking above is therefore one OAuth click per viewer, nothing to type. Two native Discord features reduce the work: (1) **Server Settings → Integrations → Twitch** gives sub roles to members who connected Twitch with no bot code, so the bot's sub-role sync becomes optional (it is still needed for tier detail and for the ban mapping); (2) **Linked Roles** could gate a role on the same OAuth consent.

**Why a callback is needed:** a bot cannot read another user's connections without that user's OAuth consent. The callback must be public HTTPS and registered under OAuth2 → Redirects in the Developer Portal. Hosting options:
- **Cloudflare Worker** (same stack as IMC-Stream's tip relay; free tier). Recommended. The Worker does the code exchange and hands the result to the bot through the bridge/relay, signed with the shared secret. Deploy button in the dashboard, like `relay-deploy.js`.
- Any tunnel to the bot's callback port (cloudflared) if the bot runs on the PC.
- The streamer's own server/VPS if the bot is hosted there.

**Fallback flow (no public callback): chat code.** `!link` in Twitch chat gives a one-time code, `/link code:XXXXXXXX` in Discord redeems it. Kept as a backup for streamers who don't want to deploy a Worker. It needs the IMC-Stream `!link` command and the code endpoint (§3 item 5).

Rules: one Twitch account ↔ one Discord account (Discord does not enforce this, so the bot does; a conflict goes to staff in `#mod-log`); `/unlink`; staff `/link-admin` to fix or force-unlink (logged); links are never inferred from matching names; a periodic re-check (weekly, and on any ban) confirms the Discord connection still points at the same Twitch ID, otherwise the link is suspended.

## 5. Moderation sync (the main feature)

| Twitch event (linked users only) | Discord action (configurable per row) |
|---|---|
| Ban | ban / kick / "Banned" role + strip other roles / log only (default: **timeout 28d + log, with an Escalate-to-ban button** until the streamer trusts it) |
| Timeout N s | Discord timeout for the same duration (cap 28d) |
| Untimeout / unban | undo what the bot did (lift timeout, unban, restore roles) |

| Discord event (linked users only) | Twitch action |
|---|---|
| Ban | **off by default.** Options: ban on Twitch / post an approve-or-ignore card in `#mod-log` |
| Timeout | timeout on Twitch (off by default) |

Safeguards (all required before this ships):
- **Origin tag + idempotency key** on every action; the sync engine ignores events whose `origin` is itself. This kills ban/unban ping-pong.
- **Never touches**: server owner, bot, anyone with a role above the bot, the broadcaster, Twitch mods/VIPs (configurable), staff roles in an allowlist.
- **Dry-run mode**: logs "would have banned X" to `#mod-log` only. Ships on by default for the first week.
- **Late linkers**: at link time, query the Twitch ban list. If the person is banned on Twitch, apply the policy immediately. Closes the "ban evader joins Discord, links later" hole. Also a periodic reconcile (every 10 min, Helix banlist paged) that heals missed events.
- **Offline catch-up**: bridge cursor replay on reconnect; reconcile on boot.
- **Rate limit + circuit breaker**: more than N sync actions in a minute (a Twitch raid ban wave, a stolen mod account) pauses sync and pings the owner.
- **Unlinked users are never touched by sync.** Their Twitch bans are remembered (`pending_bans` table) only so the late-linker check is fast.
- Every action writes a **case** with the Twitch reason, the moderator, and an **Undo** button in `#mod-log`.

## 6. Feature list, grouped and prioritised

**P0 (core)**
- Setup wizard: port the layout/roles/rules/welcome from IMC-Stream's `discord.js`, additive only (never edits or deletes what exists). Adds `#twitch-chat`, `#mod-log`, `#audit`.
- Manual moderation slash commands: `/warn /timeout /kick /ban /unban /purge /slowmode /lock /unlock /note /case /history /mutevc`. Case numbers, reasons required, DM to the user (toggle), context-menu "Report message" and "Warn user".
- Warn ladder: thresholds escalate (3 warns → timeout, 5 → ban), decay after N days.
- Logging: join/leave, message edit/delete (cached content), role/nick changes, voice, bans, plus the case log.
- Linking + Twitch→Discord ban sync (§4, §5).
- Go-live posting (§7), chat mirror (§8).
- Welcome + rules + verification gate (button), join role, minimum account age.

**P1**
- AutoMod: spam/duplicate, mention flood, invite and link allowlist, caps, emoji spam, regex word lists (shared with Twitch's word list if IMC-Stream exposes it), attachment rules. Optionally mirror rules into Discord's native AutoMod. Per-channel and per-role exemptions. Raid protection (join-rate spike → raise verification, lock invites, alert).
- Role automation: Tier 1/2/3 Sub (matching the roles IMC-Stream already creates), Follower, VIP, Twitch Mod → Mods role (opt-in), Live role while streaming. Re-synced on `sub` events, on link, and nightly.
- Button/dropdown self-roles (game pings, pronouns, notify-me).
- Bridge for IMC-Stream's data: `/top` points leaderboard, `/points`, `/commands`, `/games`, `/tts`, `/live`, `/website`, `/clip` (existing six commands keep working).
- Dashboard (§10).
- Scheduled announcements, Discord Scheduled Events from the Twitch schedule.

**P2**
- XP/levels with level roles (separate from stream points, or optionally linked to them).
- Giveaways (sub-weighted option), polls, suggestions with vote buttons, starboard, tickets/appeals (ban appeal form → case thread).
- Raid/follow/sub milestone celebrations, clip of the stream posted automatically, stream recap embed (IMC-Stream already makes recaps via `recap.js`).
- Birthday, counting channel, trivia, small fun commands. Nice, and cheap once the framework exists.
- Anti-nuke (mass channel/role delete detection, auto-strip the offender).

## 7. Go-live and stream announcements

- On `stream.online`: post one embed in `#go-live` (rust colour): title, game, thumbnail (Twitch preview image URL with a cache-busting `?t=`), watch link, optional role ping (`@here`, `@everyone`, role ID, same options as today), and a "Watch" link button.
- **One message per stream, edited not re-posted**: title/game change edits it; every ~5 min the thumbnail and viewer count refresh (rate-limit friendly).
- On `stream.offline`: edit the same message to "Stream ended: duration, peak viewers, games played", drop the ping, then recap in `#announcements` when IMC-Stream has one.
- Debounce flapping streams (Twitch reconnect blips: ignore an offline→online within ~5 min).
- Also: raid in/out, big follows/subs milestones, new clip, schedule changes. Each is a toggle with its own channel.
- Set the bot's presence to "Streaming" with the Twitch URL while live.

## 8. Twitch chat mirror

- Target channel (or several) chosen in the dashboard. **Off until enabled.**
- Rendering: via a channel **webhook** per mirror channel so each line shows the Twitch display name and avatar, or compact embed lines with the user's chat colour and badge letters (sub, mod, VIP) if webhooks are denied.
- Filters: ignore bots/commands (prefix list), minimum role (all / subs / VIP+), skip messages caught by Twitch AutoMod or held, hide first-time messages, ignore users on a list, link stripping, `@everyone` neutralised (`allowed_mentions: {parse: []}` always).
- Throughput: queue and batch lines (webhooks are limited to a few per second); under a flood, collapse to "N messages skipped".
- Emotes: Twitch emote IDs → CDN image URLs; 7TV via IMC-Stream's `seventv.js` mapping where available.
- **Delete sync**: store `twitch_message_id → discord_message_id` (short-lived table); when Twitch deletes or clears, the mirror deletes too. Banned user's mirrored lines are purged.
- **Reverse direction (Discord → Twitch), optional and off by default**: a dedicated channel, linked users only, prefixed `[D] name:`, per-user cooldown, length cap, blocked words checked before sending, goes through IMC-Stream's `say` action (so Twitch rate limits are respected there).
- Never echo mirrored messages back (origin tag).

## 9. Handing over from IMC-Stream's built-in bot

1. IMC-Stream gets a "Use IMC-Bot" switch in `discord.html`. When the bridge is connected and the switch is on, the built-in gateway stops and its go-live post is skipped.
2. IMC-Bot imports the existing `data/discord.json` (token, guild, channel IDs) once, with consent, so there is no second setup.
3. If IMC-Bot is not running, the built-in bot keeps working. Nothing breaks for streamers who never install IMC-Bot.

## 10. Dashboard (IMC-Stream look)

Served at `127.0.0.1:8440`, embeddable in IMC-Stream's shell as a panel (same `if (self!==top) html.embed` trick hides the header). Pages, each a stack of dark-iron sections with letter-spaced headings:

1. **Overview**: bot status, bridge status (Local / Relay / Offline), live state, last sync actions, today's cases.
2. **Link & Sync**: policy table from §5, dry-run toggle, linked-user search, pending late-linkers, circuit breaker state.
3. **Mirror**: channel picker, filters, test line, reverse-direction settings.
4. **Go-Live**: channel, ping role, preview of the embed, test button.
5. **Moderation**: cases table with filters, warn ladder, user lookup (history across Twitch and Discord for linked users).
6. **AutoMod**: rule cards with the aqua/heat/rust left borders, exemptions.
7. **Roles**: sub tier mapping, self-role panels, level roles.
8. **Logs**: log channels and the per-event toggles.
9. **Settings**: token, guild, bridge mode and secret, backup/restore, export cases.

## 11. Data model (SQLite)

`links(discord_id PK, twitch_id UNIQUE, twitch_login, verified_at, method)` ·
`link_codes(code PK  -- fallback flow only, twitch_id, expires_at, used)` ·
`cases(id, guild_id, type, target_discord_id, target_twitch_id, moderator, reason, source('discord'|'twitch'|'automod'|'sync'), created_at, expires_at, undone_at, ref)` ·
`pending_bans(twitch_id PK, reason, until, created_at)` ·
`sync_log(idempotency_key PK, direction, action, result, ts)` ·
`mirror_map(twitch_msg_id PK, discord_msg_id, channel_id, ts)` ·
`golive(stream_id PK, message_id, started_at, peak, last_edit)` ·
`warnings(case_id, decays_at)` · `xp(discord_id, xp, level)` · `bridge_cursor(last_event_id)` · `settings(key, value)`.

## 12. Security and privacy

- Bot token and bridge secret: only in `data/secrets.json`, never returned to a page, never logged. Rotate button.
- Dashboard and bridge accept loopback only unless the LAN switch + password are on (copy `access.js`).
- Least-privilege invite: Manage Roles, Kick, Ban, Moderate Members, Manage Messages, Manage Channels (setup only), View Audit Log, Manage Webhooks. Privileged intents needed: **Server Members** and **Message Content** (document the toggles in the Developer Portal setup steps).
- Mentions are always sanitised on anything mirrored from Twitch.
- Link data is minimal (IDs + login). `/unlink` and a "delete my data" command remove it; cases keep only IDs.
- Audit: every cross-platform action records who/what/why in `sync_log` and `#mod-log`.
- Never bans on a hunch: sync only runs on verified links, respects the safeguards in §5, and starts in dry-run.

## 13. Project layout

```
IMC-Bot/
  package.json, README.md, PLAN.md, start-bot.bat
  src/
    index.js            boot, wires modules with ctx
    bridge/             local.js (SSE+REST), relay.js, events.js (schema), index.js
    discord/            client.js, commands/*.js, interactions.js, webhooks.js
    modules/            linking.js, modsync.js, cases.js, automod.js, mirror.js,
                        golive.js, roles.js, logging.js, welcome.js, setup.js,
                        reactionroles.js, tickets.js, giveaways.js, xp.js ...
    db.js               schema + migrations
    config.js           load/save config and secrets
    web/server.js       dashboard + API (gate from access.js)
  public/               dashboard pages, ui-theme.js (copied), theme.css, assets/
  test/                 node:test with fake Discord + fake bridge
```

## 14. Phases (each ends in something runnable and tested)

1. **Skeleton (3–4 days)**: repo, config/secrets, db, discord.js client, `/ping`, dashboard shell in the IMC-Stream theme, setup wizard ported from the existing bot, welcome/rules/verify gate.
2. **Manual moderation + logging (4–5 days)**: cases, all slash commands and context menus, warn ladder, log events, `#mod-log` with Undo buttons.
3. **Bridge v1 + IMC-Stream changes (4–5 days)**: `bridge.js` in IMC-Stream (events, cursor, actions, `!link`), Local transport in the bot, status on the dashboard. Port the six existing slash commands over the bridge. Go-live + offline edit flow. Hand-off switch (§9).
4. **Linking + ban sync (5–6 days)**: Connections OAuth link (Worker callback, `/link`, Link button), late-linker check, Twitch→Discord sync with dry-run, circuit breaker, reconcile job, Discord→Twitch approval card. *Acceptance:* ban on a test Twitch account that is linked → test Discord account is actioned within 5 s, undo reverses it, no loop, unlinked account untouched, restart mid-ban catches up.
5. **Chat mirror (3–4 days)**: webhook rendering, filters, batching, delete sync, optional reverse direction.
6. **Roles + AutoMod (5–6 days)**: sub-tier/follower/live roles, self-roles, automod rules, raid protection.
7. **Relay mode (3–4 days)**: Worker + Durable Object bridge (the OAuth callback Worker from phase 4 is reused), deploy button in the dashboard (like `relay-deploy.js`).
8. **Community extras (as wanted)**: XP, giveaways, suggestions, tickets/appeals, starboard, milestones, anti-nuke.

Rough total for P0+P1: 4–5 weeks of focused work.

## 15. Testing

- Unit tests per module with injected fakes: sync engine (loop prevention, idempotency, safeguards matrix), link code lifecycle, mirror filters/rate limiting, go-live debounce/edit.
- Contract tests for bridge events (schema + cursor replay) run against both IMC-Stream's real bridge module and the bot's fake.
- Manual checklist on a throwaway Discord server and a Twitch test channel before turning dry-run off.
- Scripted "stress" run: 200 mirror lines/sec, ban wave of 50, bot restart mid-wave.

## 16. Open questions (defaults I'll use unless you say otherwise)

1. **Hosting**: PC alongside IMC-Stream first, relay mode for 24/7 later. *(default)*
2. **Library**: discord.js v14 vs zero-dependency like the built-in bot. *(default: discord.js)*
3. **Scope**: single streamer server. *(default)*
4. **Default sync policy** on a Twitch ban: timeout + escalate button vs real ban immediately. *(default: timeout + button, dry-run on)*
5. **Discord → Twitch bans**: approval-card only. *(default)*
6. **Location of the bridge code**: lives in the IMC-Stream repo as `server/bridge.js` and needs a release of IMC-Stream alongside the bot. *(default; I can't see its source repo from here, only the installed build, so these edits will be made wherever that repo lives)*
