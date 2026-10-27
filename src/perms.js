'use strict';
/**
 * A second permission check at the moment a privileged command runs. Discord hides a command from people without its default
 * permission, but a server owner can change that in Server Settings, Integrations, so the bot also checks the person's real permissions
 * itself (the check cannot be switched off from the Discord side).
 */
const { PermissionsBitField } = require('discord.js');

/** throws a plain sentence when the person who ran the interaction lacks the permission */
function requirePerm(i, perm) {
  if (i.memberPermissions && i.memberPermissions.has(perm)) return;
  throw new Error('You need the "' + new PermissionsBitField(perm).toArray().join(', ') + '" permission for that.');
}
module.exports = { requirePerm };
