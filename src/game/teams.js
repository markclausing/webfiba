/**
 * Who is playing.
 *
 * 3x3 is played by cities rather than countries on the tour, so these are
 * cities. Three a side, and three kinds of player, because three is what a 3x3
 * roster wants: somebody who can shoot from deep and handle it, somebody who
 * can do a bit of everything, and somebody big who lives at the rim. Ratings run
 * from 0 to 1 and are multipliers on the same physics for everybody - nobody
 * gets a different ball.
 */

const GUARD = { speed: 0.92, shoot: 0.84, three: 0.82, finish: 0.72, dunk: 0.45, pass: 0.9, def: 0.72, steal: 0.8, block: 0.35, reb: 0.45 };
const WING = { speed: 0.86, shoot: 0.76, three: 0.68, finish: 0.82, dunk: 0.8, pass: 0.74, def: 0.78, steal: 0.62, block: 0.6, reb: 0.66 };
const BIG = { speed: 0.76, shoot: 0.6, three: 0.42, finish: 0.88, dunk: 0.95, pass: 0.6, def: 0.8, steal: 0.45, block: 0.9, reb: 0.92 };

const ROLES = { guard: GUARD, wing: WING, big: BIG };

/**
 * Colours are linear-ish sRGB hex. `main` is the jersey, `trim` the numbers and
 * piping, `court` the stain painted inside the arc when this side is at home.
 */
export const TEAMS = {
  amsterdam: {
    key: 'amsterdam', city: 'AMSTERDAM', short: 'AMS',
    main: 0xff6a13, trim: 0x141414, alt: 0xffffff,
    players: [
      { name: 'DE VRIES', num: 7, role: 'guard', height: 1.88, skin: 0 },
      { name: 'BAKKER', num: 23, role: 'wing', height: 1.98, skin: 3 },
      { name: 'JANSEN', num: 11, role: 'big', height: 2.07, skin: 1 },
    ],
  },
  riga: {
    key: 'riga', city: 'RIGA', short: 'RIG',
    main: 0x8c1d2e, trim: 0xffffff, alt: 0xe8d7b0,
    players: [
      { name: 'OZOLS', num: 4, role: 'guard', height: 1.9, skin: 0 },
      { name: 'KALNINS', num: 13, role: 'wing', height: 1.97, skin: 1 },
      { name: 'BERZINS', num: 21, role: 'big', height: 2.05, skin: 0 },
    ],
  },
  novisad: {
    key: 'novisad', city: 'NOVI SAD', short: 'NSD',
    main: 0x1f4fd1, trim: 0xffffff, alt: 0xff3b3b,
    players: [
      { name: 'PETROVIC', num: 3, role: 'guard', height: 1.91, skin: 1 },
      { name: 'JOVIC', num: 9, role: 'wing', height: 1.99, skin: 0 },
      { name: 'MARKOVIC', num: 32, role: 'big', height: 2.08, skin: 1 },
    ],
  },
  tokyo: {
    key: 'tokyo', city: 'TOKYO', short: 'TYO',
    main: 0xf2f2f2, trim: 0xd0102b, alt: 0x111111,
    players: [
      { name: 'SATO', num: 1, role: 'guard', height: 1.84, skin: 2 },
      { name: 'TANAKA', num: 8, role: 'wing', height: 1.95, skin: 2 },
      { name: 'OKAFOR', num: 33, role: 'big', height: 2.04, skin: 4 },
    ],
  },
  montreal: {
    key: 'montreal', city: 'MONTREAL', short: 'MTL',
    main: 0x10203f, trim: 0x37d6ff, alt: 0xffffff,
    players: [
      { name: 'TREMBLAY', num: 5, role: 'guard', height: 1.89, skin: 0 },
      { name: 'BEAUCHAMP', num: 24, role: 'wing', height: 1.98, skin: 3 },
      { name: 'DIALLO', num: 15, role: 'big', height: 2.06, skin: 5 },
    ],
  },
  ljubljana: {
    key: 'ljubljana', city: 'LJUBLJANA', short: 'LJU',
    main: 0x0d7a4a, trim: 0xf6e36b, alt: 0xffffff,
    players: [
      { name: 'NOVAK', num: 77, role: 'guard', height: 1.93, skin: 0 },
      { name: 'HORVAT', num: 10, role: 'wing', height: 2.0, skin: 1 },
      { name: 'KRAJNC', num: 41, role: 'big', height: 2.09, skin: 0 },
    ],
  },
};

export const HOME = 'amsterdam';
export const AWAY_KEYS = Object.keys(TEAMS).filter((k) => k !== HOME);

/** A player as the simulation wants one: physical numbers and ratings. */
export function makeRoster(teamKey) {
  const team = TEAMS[teamKey] || TEAMS[HOME];
  return team.players.map((p, slot) => ({
    ...p,
    slot,
    // Standing reach with an arm up is about 1.33 times height.
    reach: p.height * 1.33,
    r: { ...ROLES[p.role] },
  }));
}
