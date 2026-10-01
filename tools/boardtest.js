// The score board and what it says in Discord, checked without a network.
//
//   node tools/boardtest.js

import { announcement, GAME_URL, newRows } from '../worker/announce.js';
import { merge, since, without, qualifies, placeOf, cleanEntry, Highscores, TABLE_SIZE } from '../src/highscores.js';

let failures = 0;
function ok(what, passed) {
  if (!passed) failures++;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what}`);
}

const row = (id, name, scored, conceded, extra = {}) => ({
  id, name, scored, conceded, dunks: 2, assists: 5, at: 1000 + scored, ...extra,
});

// --- What a result is ---------------------------------------------------------------------

ok('a win is a result', cleanEntry(row('a', 'MJC', 21, 15)) !== null);
ok('a defeat is not', cleanEntry(row('a', 'MJC', 15, 21)) === null);
ok('nor a tie, which basketball does not have', cleanEntry(row('a', 'MJC', 15, 15)) === null);
ok('nor sixty-one points', cleanEntry(row('a', 'MJC', 61, 3)) === null);
ok('names are three letters of the alphabet', cleanEntry(row('a', 'm!x9zz', 21, 3)).name === 'MX9');

// --- Ordering -----------------------------------------------------------------------------------

{
  const board = merge({}, { 'fiba:pro': [row('a', 'AAA', 21, 18), row('b', 'BBB', 21, 9), row('c', 'CCC', 22, 10)] });
  const ids = board['fiba:pro'].map((r) => r.id).join('');
  ok('the biggest win is on top, and more points breaks a tie', ids === 'cba');
}

{
  const full = Array.from({ length: TABLE_SIZE }, (_, i) => row(`x${i}`, 'AAA', 21, 10 + i));
  ok('a full board turns away a worse win', !qualifies(full, row('n', 'NEW', 21, 20)));
  ok('and lets in a better one', qualifies(full, row('n', 'NEW', 21, 5)));
  ok('at the right place', placeOf(full, row('n', 'NEW', 21, 5)) === 1);
}

// --- Merging -------------------------------------------------------------------------------------

{
  const a = { 'quick:pro': [row('a', 'AAA', 11, 4)] };
  const b = { 'quick:pro': [row('a', 'AAA', 11, 4), row('b', 'BBB', 11, 7, { at: 2000 })] };
  const m = merge(a, b);
  ok('merging keeps one copy of the same result', m['quick:pro'].length === 2);
  ok('and drops lists it does not know', !('quick:nope' in merge({}, { 'quick:nope': [row('z', 'ZZZ', 11, 1)] })));
  ok('a cleared board refuses older rows', since(b, 1500)['quick:pro'].length === 1);
  ok('a removed row stays removed', without(b, ['a'])['quick:pro'].length === 1);
}

{
  const store = new Map();
  const mem = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const h = new Highscores(mem);
  const place = h.add('fiba', 'legend', row('q', 'MJC', 21, 19));
  ok('the board keeps what it is given', place === 1 && new Highscores(mem).best('fiba', 'legend').name === 'MJC');
}

// --- The announcement ---------------------------------------------------------------------------

{
  const before = merge({}, { 'fiba:pro': [row('a', 'AAA', 21, 10)] });
  const after = merge({}, { 'fiba:pro': [row('b', 'BBB', 21, 3, { ot: true }), row('a', 'AAA', 21, 10)] });
  const news = newRows(before, after);
  ok('a new result is news', news.length === 1 && news[0].place === 1);
  ok('the same result twice is not', newRows(after, after).length === 0);
  const msg = announcement(news);
  const text = msg.embeds[0].description;
  ok('it says which game it is', msg.username === 'WebFIBA' && msg.embeds[0].title.includes('WebFIBA'));
  ok('and the score, and that it went to overtime', text.includes('21-3') && text.includes('overtime'));
  ok('and links to the game', msg.embeds[0].url === GAME_URL);
  ok('and cannot ping anybody', Array.isArray(msg.allowed_mentions.parse) && msg.allowed_mentions.parse.length === 0);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
