/**
 * The court, in metres, as FIBA draws it for 3x3.
 *
 * One half court, 15 wide and 11 deep. The origin is the floor directly under
 * the centre of the ring, +z runs out from the basket towards the top of the
 * court and +y is up. Everything that knows where a line is reads it from here,
 * the simulation and the painted floor alike, so the two cannot disagree about
 * whether a foot was behind the arc.
 */

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const GRAVITY = 9.81;

export const COURT = {
  WIDTH: 15,
  DEPTH: 11,
  HALF_W: 7.5,
  /** Inner edge of the endline. The ring centre is 1.575 m in from it. */
  END_Z: -1.575,
  TOP_Z: 9.425,

  RIM_Y: 3.05,
  /** Inner radius of the ring, 450 mm across. */
  RIM_R: 0.225,
  /** Radius of the steel the ring is bent from. */
  RIM_TUBE: 0.009,

  /** Front face of the board, 1.2 m in from the endline. */
  BOARD_Z: -0.375,
  BOARD_HALF_W: 0.9,
  BOARD_BOTTOM: 2.9,
  BOARD_TOP: 3.95,
  BOARD_THICK: 0.03,

  /** The two point line: 6.75 m from the ring, straight down the sides at 0.9 m in. */
  ARC_R: 6.75,
  CORNER_X: 6.6,

  /** Free throw line, 5.8 m from the endline. */
  FT_Z: 5.8 - 1.575,
  LANE_HALF: 2.45,
  FT_CIRCLE_R: 1.8,
  /** The no-charge semicircle under the ring. */
  NO_CHARGE_R: 1.25,

  /** A size six ball: smaller than the five-a-side one, the weight of a seven. */
  BALL_R: 0.116,
};

/** Where the corner straights meet the arc. */
export const CORNER_Z = Math.sqrt(COURT.ARC_R ** 2 - COURT.CORNER_X ** 2);

/** Where the ball is checked from: top of the court, a step behind the arc. */
export const CHECK_SPOT = { x: 0, z: 7.7 };

/** Ring centre, which most of the game measures from. */
export const RIM = { x: 0, y: COURT.RIM_Y, z: 0 };

/**
 * Is this point behind the two point line?
 *
 * In 3x3 "behind the arc" matters twice: a shot from there is worth two, and a
 * team that has just won the ball has to take it out there before it may score.
 * A small margin keeps a foot on the line on the inside, as the rules have it.
 */
export function beyondArc(x, z, margin = 0.05) {
  if (z < CORNER_Z) return Math.abs(x) > COURT.CORNER_X + margin;
  return Math.hypot(x, z) > COURT.ARC_R + margin;
}

export function inBounds(x, z, margin = 0) {
  return Math.abs(x) <= COURT.HALF_W - margin
    && z >= COURT.END_Z + margin
    && z <= COURT.TOP_Z - margin;
}

export function distToRim(x, z) {
  return Math.hypot(x, z);
}
