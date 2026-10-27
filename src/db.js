'use strict';
/** The bot's database (SQLite, built into Node). Tables are added as features arrive; every change here is a new numbered step so old files upgrade. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const STEPS = [
  `CREATE TABLE cases (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, type TEXT NOT NULL, target_discord_id TEXT, target_twitch_id TEXT,
     moderator TEXT, reason TEXT, source TEXT NOT NULL DEFAULT 'discord', created_at INTEGER NOT NULL, expires_at INTEGER, undone_at INTEGER);
   CREATE INDEX cases_target ON cases (guild_id, target_discord_id);
   CREATE TABLE warnings (case_id INTEGER PRIMARY KEY, decays_at INTEGER);
   CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);`,
  `CREATE TABLE giveaways (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, prize TEXT NOT NULL, host TEXT NOT NULL,
     winners INTEGER NOT NULL DEFAULT 1, required_role TEXT, ends_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
   CREATE INDEX giveaways_open ON giveaways (status, ends_at);
   CREATE TABLE giveaway_entries (giveaway_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (giveaway_id, user_id));
   CREATE TABLE giveaway_winners (giveaway_id INTEGER NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (giveaway_id, user_id));`,
  `CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
     created_at INTEGER NOT NULL, closed_at INTEGER, closed_by TEXT);
   CREATE INDEX tickets_user ON tickets (guild_id, user_id, status);`,
];

module.exports = function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get(), have = row ? row.user_version : 0;
  for (let i = have; i < STEPS.length; i++) { db.exec(STEPS[i]); db.exec('PRAGMA user_version = ' + (i + 1)); }
  return db;
};
