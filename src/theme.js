'use strict';
/** The colours of IMC-Stream, shared by the embeds the bot posts and the dashboard. */
const COLOR = { aqua: 0x4FBBBC, heat: 0xF39120, rust: 0xEC4624, cream: 0xE2DAC2 };
const embed = (title, description, color, extra) => Object.assign({ title, description, color: color || COLOR.heat }, extra || {});
module.exports = { COLOR, embed };
