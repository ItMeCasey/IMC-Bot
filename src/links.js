'use strict';
/**
 * Finding web addresses in chat text, for AutoMod and the Regulars limits: "https://site.com/x", "www.site.com" and also the common
 * way people dodge a link filter, an address without the scheme ("site.com/x", "site.gg"). Returns just the host names, lower case,
 * without "www." and ports, so a caller can compare them with an allowed-sites list.
 */
// Top-level domains worth catching when written without "https://". A short list keeps ordinary text out.
// STRONG ones count on their own ("evil.gg"); AMBIGUOUS ones are also ordinary words or country codes ("done.in", "check.it"), so they only count with a path ("evil.me/x").
const STRONG = 'com|net|org|io|gg|tv|xyz|ru|cn|info|app|dev|link|ly|tk|ml|ga|cf|gq|site|online|shop|club|icu|cc|ws|biz|vip|fun|pro|click|cloud|download|bet|casino|porn|sex|xxx|adult|webcam';
const AMBIGUOUS = 'me|co|to|it|in|es|us|uk|de|fr|nl|jp|kr|br|au|ca';
const WITH_SCHEME = /\b(?:https?:\/\/|www\.)([^\s/?#<>"'()[\]]+)/gi;
// a host: labels separated by dots, not glued to a word, an e-mail address (@) or another label before it
const LABELS = String.raw`(?<![@\w.-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+`;
const BARE_STRONG = new RegExp(LABELS + '(?:' + STRONG + '))(?![a-z0-9-])', 'gi');
const BARE_PATH = new RegExp(LABELS + '(?:' + STRONG + '|' + AMBIGUOUS + '))(?=' + String.raw`\/[^\s/]` + ')', 'gi');

const clean = (h) => h.toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '').replace(/[.,;:!?]+$/, '');

/** every host name that appears as an address in the text */
function hosts(text) {
  const t = String(text || ''), out = [];
  for (const m of t.matchAll(WITH_SCHEME)) out.push(clean(m[1]));
  for (const m of t.matchAll(BARE_STRONG)) out.push(clean(m[1]));
  for (const m of t.matchAll(BARE_PATH)) out.push(clean(m[1]));
  return [...new Set(out.filter(Boolean))];
}
module.exports = { hosts };
