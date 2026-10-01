/**
 * What gets said in Discord when somebody puts a win on the board.
 *
 * Kept apart from the Worker so both servers can use it and so the wording can
 * be tested without a network anywhere near it. It says which game is talking,
 * because every game in the family can post into the same channel.
 */

import { LEVELS, partsOf } from '../src/highscores.js';

/** How many results one post will mention before it just counts the rest. */
const MAX_LINES = 3;

const LENGTHS = {
  quick: 'a quick game',
  fiba: 'a full FIBA game',
};

const AGAINST = {
  rookie: 'the rookies',
  pro: 'the pros',
  legend: 'the legends',
};

/**
 * Which rows are new, and where they landed. Worked out from the board before
 * and after rather than from what was sent: a result that did not make the top
 * ten is not news, and the same result arriving from a second device is not
 * news either, because merging matches it by id.
 */
export function newRows(before, after) {
  const rows = [];
  for (const level of LEVELS) {
    const had = new Set((before?.[level] || []).map((r) => r.id));
    const now = after?.[level] || [];
    for (let i = 0; i < now.length; i++) {
      if (!had.has(now[i].id)) rows.push({ entry: now[i], level, place: i + 1 });
    }
  }
  return rows.sort((a, b) => a.place - b.place);
}

function ordinal(n) {
  if (n === 1) return '**top of the board**';
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  return `number ${n}`;
}

function line({ entry, level, place }) {
  const parts = partsOf(level);
  const dunks = entry.dunks ? `, ${entry.dunks} dunk${entry.dunks > 1 ? 's' : ''}` : '';
  const ot = entry.ot ? ' in overtime' : '';
  return `🏀 **${entry.name}** beat ${AGAINST[parts.tier] || 'the CPU'} `
    + `**${entry.scored}-${entry.conceded}**${ot} in ${LENGTHS[parts.length] || 'a game'}${dunks} — ${ordinal(place)}`;
}

/** Where the game lives. Overridden with a GAME_URL variable. */
export const GAME_URL = 'https://markclausing.github.io/webfiba/';

/** The orange of the ball. */
const COLOUR = 0xff7a1a;

export function announcement(rows, gameUrl = GAME_URL) {
  const shown = rows.slice(0, MAX_LINES).map(line);
  if (rows.length > MAX_LINES) shown.push(`…and ${rows.length - MAX_LINES} more.`);
  const url = gameUrl || GAME_URL;
  const plural = rows.length > 1 ? 'New wins' : 'A new win';
  return {
    username: 'WebFIBA',
    embeds: [{
      title: `🏀 ${plural} in WebFIBA 3×3`,
      url,
      description: shown.join('\n'),
      color: COLOUR,
      footer: { text: `Play at ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}` },
    }],
    // Names are three characters of A-Z, 0-9 and a dash and cannot spell a
    // mention, but a board this open should not be one webhook from pinging a
    // whole server, whatever anybody changes later.
    allowed_mentions: { parse: [] },
  };
}
