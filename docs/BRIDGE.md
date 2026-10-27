# The bridge between IMC-Stream and IMC-Bot

IMC-Bot never talks to Twitch. IMC-Stream already has the Twitch login, so it keeps a short list of what happened and answers a few questions; the bot asks. Nothing is pushed to the bot except what the bot asks for, and the only thing the bot sends back is a Discord event to show as an alert.

The routes live in IMC-Stream (`server/bridge.js`, `server/bridge-twitch.js` and the `/api/bridge/` block in `server/server.js`); the client is `src/bridge/local.js` here.

## Access

- From the same PC (`127.0.0.1`) the routes are open.
- From another computer IMC-Stream only answers after **remote access** is switched on and a password is set (IMC-Stream's Setup page). The bot logs in with `POST /api/login` `{ "password": "..." }`, keeps the `icm_session` cookie, and logs in again when a request answers 401 or 403. The password is saved in `secrets.json` and never sent to the dashboard page.
- IMC-Stream also refuses a request with an unexpected `Host` header and a cross-site `POST`.

## Routes (all JSON)

| Route | Answer |
|---|---|
| `GET /api/bridge/events?since=N[&chat=1]` | `{ boot, cursor, events: [{ id, ts, type, data }] }`: every event after number `N`. `chat=1` asks IMC-Stream to keep chat events for the next minute. |
| `GET /api/bridge/state` | `{ boot, cursor, live, title, game, viewers, startedAt, peakViewers, login, name, website }` |
| `GET /api/bridge/info` | `{ commands, top, games, tts }`: the lists the viewer commands answer from |
| `GET /api/bridge/schedule` | `{ segments: [{ start, end, title, category, canceled }] }` from the Twitch schedule |
| `GET /api/bridge/avatars?ids=1,2,3` | `{ "<twitch id>": "<https picture url>" }`; at most 50 ids, cached six hours |
| `POST /api/bridge/alert` | body `{ event, vars }`; shows an alert on stream. Only `discord_boost` (`name`, `boosts`, `level`), `discord_join` (`name`) and `discord_milestone` (`members`) are accepted. Answer `{ ok, shown }`; `shown` is false when no alert rule is switched on for it. |

Errors are `{ "error": "text" }` with a 4xx or 5xx status.

## Events

| Type | `data` | Sent |
|---|---|---|
| `stream.online` | `{ startedAt }` | always |
| `stream.update` | `{ title, game }` | always |
| `stream.offline` | `{ startedAt, endedAt, peakViewers }` | always |
| `recap` | `{ id, text, messages }` | always |
| `raid` | `{ name, viewers, uid }` | always |
| `follow` | `{ name, uid, total }` | always |
| `chat.message` | `{ id, uid, login, name, color, badges, text, type, reply }` | only while the bot asked for chat in the last minute |
| `chat.delete` / `chat.clearUser` / `chat.clear` | `{ id }` / `{ uid }` / `{}` | same |

## Numbering, restarts and gaps

Every event has a counting number (`id`) from IMC-Stream. The bot stores the last number it handled and asks for everything after it, so a bot restart misses nothing, and an event is never delivered twice. `boot` identifies one run of IMC-Stream; when it changes the numbers started over, and the bot asks again from zero. On the very first start the bot only records the current number and does not replay old events. Stream events and chat events are kept in separate lists (500 and 400 entries), so a busy chat cannot push a go-live event out.

## Versions

IMC-Stream answers 404 to a route it does not know; the bot then reports "update IMC-Stream to a version with the bridge". Routes are only ever added, not changed.
