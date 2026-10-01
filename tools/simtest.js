// Plays whole games CPU against CPU, with no screen, and checks they look like
// basketball: they end, the scores are plausible, the ball goes in from the
// places it should, and the rules that make 3x3 what it is actually fire.
//
//   node tools/simtest.js            # the checks
//   node tools/simtest.js --report   # and the numbers behind them

import { createGame, step, blankInput } from '../src/game/sim.js';
import { launch, aimPoint, stepBall } from '../src/game/ball.js';
import { COURT, RIM, beyondArc } from '../src/game/court.js';

const report = process.argv.includes('--report');
let failures = 0;
function ok(what, passed, detail = '') {
  if (!passed) failures++;
  console.log(`  ${passed ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
}

// --- The ball on its own --------------------------------------------------------------

function fly(from, miss, dir, angle = 50) {
  const target = aimPoint(from, miss, dir);
  const v = launch(from, target, (angle * Math.PI) / 180);
  const ball = { pos: { ...from }, vel: { x: v.x, y: v.y, z: v.z } };
  let through = false;
  let rim = false;
  for (let i = 0; i < 600; i++) {
    const hits = stepBall(ball, 1 / 60);
    if (hits.includes('through')) through = true;
    if (hits.includes('rim')) rim = true;
    if (ball.pos.y <= COURT.BALL_R + 0.001 && i > 30) break;
  }
  return { through, rim };
}

{
  let clean = 0;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI;
    const from = { x: Math.cos(a) * 5.5, y: 2.4, z: Math.max(0.5, Math.sin(a) * 5.5) };
    if (fly(from, 0.02, 0).through) clean++;
  }
  ok('a shot aimed at the middle goes in from all round the arc', clean === 20, `${clean}/20`);

  let iron = 0;
  let out = 0;
  for (let i = 0; i < 20; i++) {
    const from = { x: -4 + i * 0.4, y: 2.4, z: 6 };
    const r = fly(from, 0.28, i % 2 ? 0 : Math.PI);
    if (r.rim) iron++;
    if (!r.through) out++;
  }
  ok('a shot aimed at the iron hits the iron', iron >= 18, `${iron}/20`);
  ok('and mostly stays out', out >= 14, `${out}/20 missed`);
}

// --- Whole games --------------------------------------------------------------------------

function play(seed, opts = {}) {
  const s = createGame({ seed, humanTeam: -1, length: 'quick', tier: 'pro', ...opts });
  const counts = {};
  const input = blankInput();
  let ticks = 0;
  while (s.phase !== 'over' && ticks < 60 * 60 * 25) {
    step(s, input);
    for (const e of s.events) counts[e.type] = (counts[e.type] || 0) + 1;
    ticks++;
  }
  return { s, counts, minutes: ticks / 3600 };
}

const games = [];
for (let seed = 1; seed <= 24; seed++) games.push(play(seed));

const finished = games.filter((g) => g.s.phase === 'over').length;
ok('every game finishes', finished === games.length, `${finished}/${games.length}`);

const sum = (f) => games.reduce((a, g) => a + f(g), 0);
const avg = (f) => sum(f) / games.length;
const pts = avg((g) => g.s.score[0] + g.s.score[1]);
const fga = avg((g) => g.s.stats[0].fga + g.s.stats[1].fga);
const fgm = avg((g) => g.s.stats[0].fgm + g.s.stats[1].fgm);
const dunks = avg((g) => g.s.stats[0].dunks + g.s.stats[1].dunks);
const twoA = avg((g) => g.s.stats[0].twoA + g.s.stats[1].twoA);
const twoM = avg((g) => g.s.stats[0].twoM + g.s.stats[1].twoM);
const ast = avg((g) => g.s.stats[0].assists + g.s.stats[1].assists);
const tov = avg((g) => g.s.stats[0].tov + g.s.stats[1].tov);
const passes = avg((g) => g.counts.pass || 0);
const fouls = avg((g) => g.counts.foul || 0);
const sc = avg((g) => g.counts.shotclock || 0);
const outs = sum((g) => g.counts.whistle || 0) / games.length;
const knockouts = games.filter((g) => Math.max(...g.s.score) >= g.s.target).length;
const clears = avg((g) => g.counts.cleared || 0);
const blocks = avg((g) => g.counts.block || 0);
const steals = avg((g) => g.counts.steal || 0);
const alley = avg((g) => g.counts.alleycatch || 0);
const wins0 = games.filter((g) => g.s.winner === 0).length;

ok('there is scoring', pts > 10, `${pts.toFixed(1)} points a game`);
ok('shots go in at a basketball rate', fgm / fga > 0.33 && fgm / fga < 0.65, `${((100 * fgm) / fga).toFixed(0)}% FG`);
ok('somebody shoots from behind the arc', twoA > 1.5, `${twoA.toFixed(1)} a game, ${twoM.toFixed(1)} in`);
ok('somebody dunks', dunks > 0.4, `${dunks.toFixed(1)} a game`);
ok('the ball moves', passes > 6, `${passes.toFixed(1)} passes a game`);
ok('passes become assists', ast > 0.8, `${ast.toFixed(1)} a game`);
ok('the ball has to be cleared after a change of hands', clears > 2, `${clears.toFixed(1)} a game`);
ok('the shot clock is not the whole game', sc < 4, `${sc.toFixed(1)} violations a game`);
ok('neither side always wins', wins0 > 3 && wins0 < 21, `${wins0}/${games.length} for the home side`);

if (report) {
  console.log('\n  per game:');
  console.log(`    minutes ${avg((g) => g.minutes).toFixed(1)}  knockouts ${knockouts}/${games.length}`);
  console.log(`    turnovers ${tov.toFixed(1)}  steals ${steals.toFixed(1)}  blocks ${blocks.toFixed(1)}  fouls ${fouls.toFixed(1)}  whistles ${outs.toFixed(1)}`);
  console.log(`    alley-oops ${alley.toFixed(1)}  shot clock ${sc.toFixed(1)}`);
  for (const g of games.slice(0, 8)) {
    console.log(`    ${g.s.teams[0].short} ${g.s.score[0]} - ${g.s.score[1]} ${g.s.teams[1].short}${g.s.overtime ? ' OT' : ''}`);
  }
}

// --- A human pressing things at random ------------------------------------------------------

{
  // Not a strategy, just every control path: moving, sprinting, shooting with
  // every kind of release, passing, lobbing, switching, reaching, jumping.
  const s = createGame({ seed: 5, humanTeam: 0, length: 'quick', tier: 'rookie' });
  const rng = (() => { let a = 7; return () => ((a = (a * 1103515245 + 12345) >>> 0) / 4294967296); })();
  let input = blankInput();
  let ticks = 0;
  let threw = null;
  try {
    while (s.phase !== 'over' && ticks < 60 * 60 * 20) {
      if (ticks % 9 === 0) {
        const a = rng() * Math.PI * 2;
        input = {
          mx: Math.cos(a) * (rng() < 0.8 ? 1 : 0), mz: Math.sin(a), sprint: rng() < 0.4,
          shoot: rng() < 0.18, pass: rng() < 0.12, lob: rng() < 0.06,
        };
      }
      step(s, input);
      ticks++;
    }
  } catch (err) {
    threw = err;
  }
  ok('a game with a human mashing buttons runs to the end', !threw && s.phase === 'over', threw ? threw.stack.split('\n').slice(0, 3).join(' | ') : `${s.score.join('-')}`);
}

// --- Determinism ------------------------------------------------------------------------------

{
  const a = play(99);
  const b = play(99);
  ok('the same seed plays the same game', a.s.score.join() === b.s.score.join() && a.s.tick === b.s.tick);
}

// --- The rules one at a time -------------------------------------------------------------------

{
  // A shot from the corner is a two.
  ok('the corner is behind the arc', beyondArc(6.8, 0.5) && !beyondArc(6.4, 0.5));
  ok('the top of the key is not', !beyondArc(0, 6.5) && beyondArc(0, 7));
  ok('the ring is where the court says', RIM.y === 3.05);
}

console.log(failures ? `\n${failures} failed` : '\nall good');
process.exit(failures ? 1 : 0);
