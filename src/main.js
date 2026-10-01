/**
 * WebFIBA 3x3: the page.
 *
 * Owns the loop and everything that is not the game or the picture: the menu,
 * the HUD, sound, slow motion, replays, and the score board. The simulation
 * steps at a fixed sixty a second; the picture draws as often as the screen
 * wants, interpolating between the last two ticks, so a 144 Hz monitor sees 144
 * smooth frames of the same sixty-tick game.
 */

import * as THREE from 'three';
import { Renderer, guessQuality, QUALITY_ORDER } from './render/renderer.js';
import { Arena } from './render/arena.js';
import { Hoop } from './render/hoop.js';
import { Character } from './render/player.js';
import { BallView } from './render/ballview.js';
import { CameraRig } from './render/camera.js';
import { Fx } from './render/fx.js';
import { createGame, step, blankInput, pickPassTarget, meter, LENGTHS, TIERS, JUMPER_APEX, alleyPlan } from './game/sim.js';
import { DT, RIM, COURT } from './game/court.js';
import { TEAMS, HOME, AWAY_KEYS } from './game/teams.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { Highscores, makeId, placeOf, NAME_LENGTH } from './highscores.js';
import { NameEntry } from './nameEntry.js';
import { boardFor } from './config.js';
import { BTN } from './constants.js';
import { ACTIONS, PRESETS, keyLabel, padLabel } from './controls.js';

const $ = (id) => document.getElementById(id);

// --- Settings ---------------------------------------------------------------------------------------

const SETTINGS_KEY = 'webfiba.settings.v1';
const settings = {
  away: 'random', tier: 'pro', length: 'quick', quality: 'auto', sound: true,
  ...readSettings(),
};
function readSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* private mode */ }
}

const params = new URLSearchParams(location.search);

// --- The machinery ---------------------------------------------------------------------------------------

const input = new Input();
const audio = new Audio();
audio.enabled = settings.sound;
const highscores = new Highscores();

let renderer;
let arena;
let hoop;
let ballView;
let fx;
let rig;
let chars = [];
let state = null;
let mode = 'loading';
let acc = 0;
let timeScale = 1;
let slowUntil = 0;
let wallTimer = 0;
let hypeBoost = 0;
let lastShot = 12;
let gameOverAt = 0;
let pending = null;
let local = null;
let prev = null;
let replay = null;
let history = [];
let lastReleaseUi = 0;
let hintsShown = 0;

async function boot() {
  $('loadingText').textContent = 'BUILDING THE ARENA';
  // Shirt numbers are drawn in the display font; wait for it, but not forever.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 100px "Archivo Black"'),
        document.fonts.load('700 40px "JetBrains Mono"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch { /* fall back to whatever is there */ }

  const forced = params.get('quality');
  const q = forced || (settings.quality === 'auto' ? guessQuality() : settings.quality);
  renderer = new Renderer($('view'), q);
  renderer.autoAdjust = !forced && settings.quality === 'auto';
  const quality = renderer.q;
  arena = new Arena(renderer.scene, renderer.renderer, quality, {});
  hoop = new Hoop(renderer.scene, TEAMS[HOME].main);
  ballView = new BallView(renderer.scene);
  fx = new Fx(renderer.scene);
  rig = new CameraRig(renderer.camera);
  renderer.mirror.hide = [arena.floor];
  renderer.onQuality = () => {
    if (renderer.mirror) renderer.mirror.hide = [arena.floor];
  };
  addEventListener('resize', () => renderer.resize());

  if (matchMedia('(pointer: coarse)').matches) {
    $('touch').classList.remove('hidden');
    input.attachTouch($('touch'));
  }

  startAttract();
  // Render a couple of frames before lifting the curtain, so shaders compile
  // behind it rather than in front of the player.
  for (let i = 0; i < 3; i++) frameStep(1 / 60);
  renderer.renderer.compile(renderer.scene, renderer.camera);
  $('loading').classList.add('gone');
  setTimeout(() => $('loading').classList.add('hidden'), 700);
  showMenu();
  syncScores();
  requestAnimationFrame(loop);
  window.__ready = true;
}

// --- Games -------------------------------------------------------------------------------------------------

function pickAway() {
  if (settings.away !== 'random' && TEAMS[settings.away]) return settings.away;
  return AWAY_KEYS[Math.floor(Math.random() * AWAY_KEYS.length)];
}

function newState(opts) {
  state = createGame(opts);
  buildCharacters();
  history = [];
  replay = null;
  prev = snapshot(state);
  arena.setColours(state.teams[0]);
  arena.drawWall({ teams: state.teams, score: state.score, text: 'WEBFIBA 3×3', clock: clockText(state.clock) });
  document.documentElement.style.setProperty('--home', hexOf(state.teams[0].main));
  document.documentElement.style.setProperty('--away', hexOf(state.teams[1].main === 0xf2f2f2 ? 0xd0102b : state.teams[1].main));
  fx.trailColour(state.teams[0].main);
}

function buildCharacters() {
  for (const c of chars) {
    renderer.scene.remove(c.root);
    c.dispose();
  }
  chars = state.players.map((p) => {
    const c = new Character(p, state.teams[p.team]);
    renderer.scene.add(c.root);
    return c;
  });
}

function startAttract() {
  newState({
    length: 'fiba', tier: 'pro', home: HOME, away: pickAway(), humanTeam: -1, seed: Math.floor(Math.random() * 1e9),
  });
  rig.mode = 'orbit';
}

function startGame() {
  audio.start();
  const away = pickAway();
  newState({
    length: settings.length, tier: settings.tier, home: HOME, away, humanTeam: 0,
    seed: Math.floor(Math.random() * 1e9),
  });
  rig.mode = 'broadcast';
  mode = 'play';
  acc = 0;
  hypeBoost = 0.4;
  gameOverAt = 0;
  $('menu').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('homeName').textContent = state.teams[0].short;
  $('awayName').textContent = state.teams[1].short;
  $('bugTarget').textContent = `FIRST TO ${state.target} · ${LENGTHS[state.length].label} · ${TIERS[state.tier].label}`;
  $('hints').classList.remove('fade');
  hintsShown = 0;
  renderHints();
  audio.cheer(0.9, 3);
}

// --- The loop ----------------------------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  frameStep(dt);
  requestAnimationFrame(loop);
}

function frameStep(dt) {
  const inp = input.poll();
  handleUi(inp);

  // Slow motion eases in and out rather than snapping.
  const wantScale = state && state.time < slowUntil ? 0.42 : 1;
  timeScale += (wantScale - timeScale) * Math.min(1, dt * 10);

  if (replay) {
    stepReplay(dt, inp);
  } else if (mode === 'play' || mode === 'menu' || mode === 'over' || mode === 'name' || (mode === 'controls' && controlsFrom === 'menu')) {
    const simInput = mode === 'play' ? worldInput(inp) : blankInput();
    acc += dt * timeScale;
    let n = 0;
    while (acc >= DT && n < 8) {
      prev = snapshot(state);
      step(state, simInput);
      record();
      handleEvents(state.events);
      acc -= DT;
      n++;
      if (replay) break;
    }
    if (n === 8) acc = 0;
    // The attract game never ends; start another.
    if (mode === 'menu' && state.phase === 'over' && state.phaseT > 4) startAttract();
  }
  draw(dt, replay ? 1 : acc / DT);
}

/** The stick, turned from the screen into the court by the camera's heading. */
function worldInput(inp) {
  const cam = renderer.camera;
  const f = new THREE.Vector3();
  cam.getWorldDirection(f);
  f.y = 0;
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  return {
    mx: r.x * inp.mx + f.x * inp.my,
    mz: r.z * inp.mx + f.z * inp.my,
    sprint: inp.sprint,
    shoot: inp.shoot,
    pass: inp.pass,
    lob: inp.lob,
  };
}

// --- Interpolation and recording ---------------------------------------------------------------------------------

function snapshot(s) {
  return {
    players: s.players.map((p) => ({ x: p.x, z: p.z, y: p.y, face: p.face })),
    ball: { ...s.ball.pos },
  };
}

const ACT_KEYS = ['kind', 't', 'released', 'style', 'spin', 'alley', 'sub', 'lob', 'side', 'gather', 'flight', 'hang', 'blocked', 'whiff', 'dur', 'top', 'human'];
function copyAct(a) {
  if (!a) return null;
  const o = {};
  for (const k of ACT_KEYS) if (a[k] !== undefined) o[k] = a[k];
  return o;
}

/** The last few seconds, kept for the replay of a dunk. */
function record() {
  if (mode !== 'play') return;
  history.push({
    time: state.time,
    phase: state.phase,
    players: state.players.map((p) => ({
      x: p.x, z: p.z, y: p.y, face: p.face, vx: p.vx, vz: p.vz, stance: p.stance, act: copyAct(p.act),
    })),
    ball: { ...state.ball.pos },
    vel: { ...state.ball.vel },
    holder: state.ball.holder,
    mode: state.ball.mode,
  });
  if (history.length > 60 * 5) history.shift();
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** What the renderer draws this frame, from the live game or from a replay. */
function views(alpha) {
  if (replay) {
    const i = Math.floor(replay.at);
    const f = replay.at - i;
    const a = history[Math.min(i, history.length - 1)];
    const b = history[Math.min(i + 1, history.length - 1)];
    return {
      players: state.players.map((p, k) => {
        const pa = a.players[k];
        const pb = b.players[k];
        return {
          ...p,
          x: pa.x + (pb.x - pa.x) * f,
          z: pa.z + (pb.z - pa.z) * f,
          y: pa.y + (pb.y - pa.y) * f,
          face: lerpAngle(pa.face, pb.face, f),
          vx: pa.vx, vz: pa.vz, stance: pa.stance,
          act: pa.act ? { ...pa.act, t: pa.act.t + (pb.act && pb.act.kind === pa.act.kind ? (pb.act.t - pa.act.t) * f : 0) } : null,
        };
      }),
      ball: new THREE.Vector3(
        a.ball.x + (b.ball.x - a.ball.x) * f,
        a.ball.y + (b.ball.y - a.ball.y) * f,
        a.ball.z + (b.ball.z - a.ball.z) * f,
      ),
      vel: a.vel,
      holder: a.holder,
      mode: a.mode,
      phase: a.phase === 'scored' ? 'live' : a.phase,
    };
  }
  return {
    players: state.players.map((p, k) => {
      const q = prev.players[k];
      return {
        ...p,
        x: q.x + (p.x - q.x) * alpha,
        z: q.z + (p.z - q.z) * alpha,
        y: q.y + (p.y - q.y) * alpha,
        face: lerpAngle(q.face, p.face, alpha),
        act: p.act ? { ...copyAct(p.act), t: p.act.t + alpha * DT } : null,
      };
    }),
    ball: new THREE.Vector3(
      prev.ball.x + (state.ball.pos.x - prev.ball.x) * alpha,
      prev.ball.y + (state.ball.pos.y - prev.ball.y) * alpha,
      prev.ball.z + (state.ball.pos.z - prev.ball.z) * alpha,
    ),
    vel: state.ball.vel,
    holder: state.ball.holder,
    mode: state.ball.mode,
    phase: state.phase,
  };
}

// --- Drawing --------------------------------------------------------------------------------------------------------

function draw(dt, alpha) {
  const v = views(alpha);
  const rdt = dt * (replay ? replay.speed : timeScale);
  const ctx = {
    time: renderer.clock,
    hoop,
    phase: v.phase,
    ball: v.ball,
    holder: false,
    onBounce: (power) => audio.bounce(power * 0.55, v.ball.x / 10),
  };

  // The man with the ball first: he decides where the ball is drawn.
  let drawn = null;
  if (v.holder >= 0) {
    ctx.holder = true;
    drawn = chars[v.holder].update(rdt, v.players[v.holder], ctx);
    ctx.holder = false;
  }
  const ballPos = drawn || v.ball;
  ctx.ball = ballPos;
  let hanging = 0;
  chars.forEach((c, i) => {
    if (i === v.holder) return;
    c.update(rdt, v.players[i], ctx);
    const a = v.players[i].act;
    if (a && a.kind === 'dunk' && a.released && !a.blocked) {
      const h = a.t - (a.gather || 0) - a.flight;
      if (h >= 0 && h < a.hang) hanging = 1;
    }
  });
  if (v.holder >= 0) {
    const a = v.players[v.holder].act;
    if (a && a.kind === 'dunk' && a.released) {
      const h = a.t - (a.gather || 0) - a.flight;
      if (h >= 0 && h < a.hang) hanging = 1;
    }
  }
  ballView.update(rdt, v.ball, v.vel, drawn, v.mode);
  hoop.setHang(hanging);
  hoop.update(rdt, ballView.pos);
  hoop.setClock(state.shotClock, state.overtime ? 'OT' : clockText(state.clock));

  // Floor and crowd.
  const flowTeam = state.flow.team;
  const flow = flowTeam >= 0 && state.ball.holder >= 0 && state.players[state.ball.holder].team === flowTeam
    ? Math.min(1, Math.max(0, (state.flow.count - 1) / 3)) : 0;
  hypeBoost = Math.max(0, hypeBoost - dt * 0.25);
  const close = state.humanTeam >= 0 ? closeness() : 0.2;
  const hype = Math.min(1, 0.12 + close * 0.35 + hypeBoost);
  arena.update(dt, hype, flow, flowTeam >= 0 ? state.teams[flowTeam].main : undefined);
  audio.setHype(hype);
  arena.setMirror(renderer.mirror);

  // Rings and markers.
  const me = state.humanTeam >= 0 && mode === 'play' && !replay ? v.players[state.controlled] : null;
  fx.setRing(me, state.teams[state.humanTeam >= 0 ? state.humanTeam : 0].main, Boolean(me) && state.phase !== 'over');
  let target = null;
  let lobOn = false;
  if (me && state.ball.holder === state.controlled && state.phase === 'live') {
    const w = worldInput(input.poll ? lastInput : { mx: 0, my: 0 });
    const id = pickPassTarget(state, state.players[state.controlled], w.mx, w.mz);
    target = id >= 0 ? v.players[id] : null;
    if (target) lobOn = Boolean(alleyPlan(state, state.players[state.controlled], state.players[id]));
  }
  fx.setTarget(target, lobOn ? 0xffd36b : 0xffffff, 0.75);
  fx.updateBlobs(v.players);
  const passing = (state.ball.mode === 'pass' || state.ball.mode === 'shot') && state.flow.count >= 2;
  fx.updateTrail(rdt, ballView.pos, passing && !replay ? Math.min(1, 0.4 + state.flow.count * 0.2) : 0);
  fx.update(rdt);

  // Camera.
  rig.update(dt, {
    ball: ballView.pos,
    player: me,
    replaySide: replay?.side,
  });

  // Grade: a touch of aberration and flash on the big moments.
  const g = renderer.grade.uniforms;
  g.uAberration.value = Math.max(0, g.uAberration.value - dt * 3);
  g.uFlash.value = Math.max(0, g.uFlash.value - dt * 2.5);
  g.uSaturation.value = replay ? 0.82 : 1.08;

  renderer.render(dt);
  if (mode === 'play' || mode === 'over') hud(v);
}

let lastInput = { mx: 0, my: 0 };
const _poll = input.poll.bind(input);
input.poll = () => {
  lastInput = _poll();
  return lastInput;
};

/** 0..1: how tense the game is. Late, close, or one basket from the end. */
function closeness() {
  const s = state.score;
  const diff = Math.abs(s[0] - s[1]);
  const near = Math.max(s[0], s[1]) / state.target;
  const late = 1 - state.clock / LENGTHS[state.length].clock;
  return Math.min(1, (diff <= 2 ? 0.5 : 0.2) * (near + late) + (state.overtime ? 0.5 : 0));
}

// --- Events: sound, effects, camera -------------------------------------------------------------------------------------

function handleEvents(events) {
  const live = mode === 'play';
  for (const e of events) {
    switch (e.type) {
      case 'bounce':
        if (state.ball.holder < 0) audio.bounce(Math.min(1, e.power / 5), state.ball.pos.x / 10);
        break;
      case 'squeak':
        if (Math.random() < 0.5) audio.squeak((state.players[e.id]?.x || 0) / 10);
        break;
      case 'rim':
        audio.rim(e.power);
        hoop.hitRim(e.power);
        if (e.power > 2) fx.burst({ x: e.pos.x, y: e.pos.y, z: e.pos.z }, 8, 1.5, 0xffc080);
        break;
      case 'board':
        audio.board(1);
        hoop.hitBoard(1.5);
        break;
      case 'net':
        audio.swish(Math.min(1, e.speed / 6));
        break;
      case 'takeoff': {
        const p = state.players[e.id];
        if (live) {
          rig.dunkCam({ x: p.x, z: p.z }, e.alley ? 1.4 : 1.25);
          // Slow it down through the top of the flight.
          slowUntil = state.time + 0.55;
          hypeBoost = Math.min(1, hypeBoost + 0.35);
        }
        audio.squeak(p.x / 10);
        break;
      }
      case 'slam': {
        audio.slam();
        hoop.slam();
        fx.burst({ x: RIM.x, y: RIM.y, z: RIM.z + 0.1 }, 90, 5, 0xffb050);
        rig.shake(0.85);
        input.rumble(1, 0.8, 320);
        arena.flash(1.2);
        hypeBoost = 1;
        slowUntil = state.time + 0.18;
        renderer.grade.uniforms.uAberration.value = 1.6;
        renderer.grade.uniforms.uFlash.value = 0.12;
        if (live) {
          const p = state.players[e.id];
          local = { text: e.alley ? 'ALLEY-OOP' : dunkName(e.style), sub: p.name, until: performance.now() + 1800, team: p.team };
        }
        break;
      }
      case 'land': {
        const p = state.players[e.id];
        fx.shockwave(p.x, p.z, state.teams[p.team].main, 5);
        audio.thud(0.6, 70);
        rig.shake(0.3);
        break;
      }
      case 'score': {
        const big = e.kind === 'dunk' ? 1.4 : (e.pts === 2 ? 1.1 : 0.7);
        audio.cheer(big, 2.5);
        hypeBoost = Math.min(1, hypeBoost + 0.4 * big);
        arena.flash(0.4 * big);
        bumpScore(e.team);
        wallTimer = 0;
        if (e.kind === 'dunk' && live) queueReplay(e);
        if (live && e.pts === 2) local = { text: '2 POINTS', sub: state.players[e.by]?.name || '', until: performance.now() + 1400, team: e.team };
        if (live && e.green) renderer.grade.uniforms.uFlash.value = 0.08;
        break;
      }
      case 'block':
        audio.thud(0.9, 160);
        audio.cheer(1.2, 2);
        rig.shake(0.5);
        input.rumble(0.8, 0.5, 200);
        hypeBoost = Math.min(1, hypeBoost + 0.6);
        if (live) local = { text: 'REJECTED', sub: state.players[e.id].name, until: performance.now() + 1500, team: state.players[e.id].team };
        break;
      case 'steal':
        audio.squeak();
        if (live) local = { text: 'STEAL', sub: state.players[e.id].name, until: performance.now() + 1100, team: state.players[e.id].team };
        break;
      case 'whistle':
      case 'foul':
        if (e.type === 'whistle' || e.andOne) audio.whistle(e.why === 'foul');
        break;
      case 'buzzer':
      case 'shotclock':
        audio.buzzer();
        break;
      case 'airball':
        audio.ooh();
        break;
      case 'release':
        if (live && e.human) releaseUi(e);
        break;
      case 'mustclear':
        if (live) $('clear').animate([{ transform: 'translateX(-50%) scale(1.3)' }, { transform: 'translateX(-50%) scale(1)' }], 300);
        break;
      case 'catch':
        if (live && e.flow >= 3 && state.players[e.id].team === state.humanTeam) {
          audio.cheer(0.35, 1);
        }
        break;
      case 'alleycatch':
        hypeBoost = 1;
        break;
      case 'tip':
        if (live) local = { text: state.teams[e.team].city, sub: 'WIN THE TOSS', until: performance.now() + 1600, team: e.team };
        break;
      case 'possess':
        if (live && hintsShown++ > 6) $('hints').classList.add('fade');
        break;
      case 'over':
        if (live) {
          gameOverAt = performance.now();
          audio.buzzer();
          audio.cheer(1.5, 5);
          arena.flash(1.5);
        }
        break;
      default:
    }
  }
}

function dunkName(style) {
  return {
    tomahawk: 'TOMAHAWK', windmill: 'WINDMILL', reverse: 'REVERSE JAM', three60: '360', two: 'SLAM', one: 'JAM',
  }[style] || 'SLAM DUNK';
}

// --- Replays ---------------------------------------------------------------------------------------------------------------

/** After a dunk: run the last two seconds back, slower, from low on the baseline. */
function queueReplay() {
  if (params.has('noreplay')) return;
  const end = history.length - 1;
  if (end < 90) return;
  replay = {
    at: Math.max(0, end - 100),
    end: Math.min(end + 0, history.length - 1),
    speed: 0.5,
    side: Math.random() < 0.5 ? -1 : 1,
    waitFor: 0.5,
    slammed: false,
  };
  // Hold on the live picture for a beat before cutting.
  replay.delay = 0.9;
}

function stepReplay(dt, inp) {
  if (replay.delay > 0) {
    // Let the live moment breathe, and keep the game running underneath.
    replay.delay -= dt;
    const simInput = blankInput();
    acc += dt;
    while (acc >= DT) {
      prev = snapshot(state);
      step(state, simInput);
      handleEvents(state.events);
      acc -= DT;
    }
    if (replay.delay <= 0) {
      rig.mode = 'replay';
      $('replayTag').classList.remove('hidden');
      replay.started = true;
    }
    return;
  }
  replay.at += (dt / DT) * replay.speed;
  const frame = history[Math.floor(replay.at)];
  if (frame && !replay.slammed && frame.holder < 0 && frame.mode === 'shot' && frame.ball.y < RIM.y + 0.3 && frame.ball.y > RIM.y - 0.3 && Math.hypot(frame.ball.x, frame.ball.z) < 0.3) {
    replay.slammed = true;
    hoop.slam();
    audio.slam();
    fx.burst({ x: RIM.x, y: RIM.y, z: RIM.z + 0.1 }, 70, 4.5, 0xffb050);
    rig.shake(0.6);
  }
  const skip = inp.shoot || inp.pass || inp.lob || inp.pressed.confirm;
  if (replay.at >= replay.end || (skip && replay.at > replay.end - 90 + 20)) {
    replay = null;
    rig.mode = 'broadcast';
    $('replayTag').classList.add('hidden');
    acc = 0;
    prev = snapshot(state);
  }
}

// --- HUD -----------------------------------------------------------------------------------------------------------------------

function clockText(t) {
  const s = Math.max(0, Math.ceil(t));
  if (t < 60 && t > 0) return `${Math.floor(t)}.${Math.floor((t * 10) % 10)}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function hexOf(c) {
  return `#${new THREE.Color(c).getHexString()}`;
}

function bumpScore(team) {
  const el = team === 0 ? $('homePts') : $('awayPts');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  arena.drawWall({ teams: state.teams, score: state.score, text: team >= 0 ? `${state.teams[team].city}!` : '', clock: clockText(state.clock) });
}

let lastMsgKey = '';
function hud(v) {
  $('homePts').textContent = state.score[0];
  $('awayPts').textContent = state.score[1];
  $('gameClock').textContent = state.overtime ? 'OT' : clockText(state.clock);
  const sc = Math.ceil(state.shotClock);
  const shotEl = $('shotClock');
  shotEl.textContent = sc;
  shotEl.classList.toggle('low', sc <= 5 && state.phase === 'live');
  if (sc !== lastShot && sc <= 5 && sc > 0 && state.phase === 'live') audio.beep(sc <= 2);
  lastShot = sc;
  for (const [team, id] of [[0, 'homeFouls'], [1, 'awayFouls']]) {
    const el = $(id);
    if (el.childElementCount !== 10) el.innerHTML = '<i></i>'.repeat(10);
    [...el.children].forEach((c, i) => {
      c.classList.toggle('on', i < state.fouls[team]);
      c.classList.toggle('bonus', i < state.fouls[team] && state.fouls[team] >= 7);
    });
  }

  // Flow chevrons.
  const f = state.flow;
  const flowOn = f.team >= 0 && f.count >= 1 && state.phase === 'live';
  $('flow').classList.toggle('on', flowOn);
  $('flow').style.setProperty('--flow', hexOf(f.team >= 0 ? state.teams[f.team].main : 0xff6a13));
  [...$('flow').querySelectorAll('.chev')].forEach((c, i) => c.classList.toggle('lit', flowOn && i < f.count));

  $('clear').classList.toggle('hidden', !(state.needsClear && state.phase === 'live' && state.possession === state.humanTeam));

  // Messages: the simulation's, or our own, whichever is newer.
  const now = performance.now();
  let msg = null;
  if (state.message && state.time < state.message.until) msg = { ...state.message, key: `s${state.message.at}` };
  if (local && now < local.until && (!msg || local.until - now > (state.message.until - state.time) * 1000 - 200)) msg = { ...local, key: `l${local.until}` };
  const box = $('message');
  if (msg && !replay) {
    if (msg.key !== lastMsgKey) {
      lastMsgKey = msg.key;
      $('msgBig').textContent = msg.text;
      $('msgSub').textContent = msg.sub || '';
      $('msgBig').style.color = msg.team >= 0 ? hexOf(state.teams[msg.team].main === 0x10203f ? 0x37d6ff : state.teams[msg.team].main) : '#fff';
      box.classList.remove('hidden', 'show');
      void box.offsetWidth;
      box.classList.add('show');
    }
  } else {
    box.classList.add('hidden');
    lastMsgKey = '';
  }

  // Shot meter beside the shooter's head.
  const m = meter(state);
  const mEl = $('meter');
  if (m && !replay) {
    const p = v.players[m.id];
    const pos = new THREE.Vector3(p.x, p.y + p.height * 1.05, p.z).project(renderer.camera);
    const x = (pos.x * 0.5 + 0.5) * innerWidth + 46;
    const y = (-pos.y * 0.5 + 0.5) * innerHeight;
    mEl.style.left = `${x}px`;
    mEl.style.top = `${y}px`;
    mEl.classList.remove('hidden');
    const frac = Math.min(1, m.t / m.max);
    $('meterFill').style.height = `${frac * 100}%`;
    const zone = mEl.querySelector('.zone');
    zone.style.bottom = `${((m.apex - 0.035) / m.max) * 100}%`;
    zone.style.height = `${(0.07 / m.max) * 100}%`;
    mEl.classList.toggle('late', m.t > m.apex + 0.14);
  } else if (now - lastReleaseUi > 450) {
    mEl.classList.add('hidden');
    mEl.classList.remove('good', 'late');
  }
  $('release').classList.toggle('hidden', now - lastReleaseUi > 700);

  if (mode === 'play' && state.phase === 'over' && gameOverAt && now - gameOverAt > 2600) {
    showGameOver();
  }
}

function releaseUi(e) {
  const off = Math.abs(e.timing ?? 1);
  const el = $('release');
  el.className = '';
  let text;
  if (off < 0.035) text = 'PERFECT';
  else if (off < 0.08) {
    text = 'GOOD';
    el.className = 'meh';
  } else {
    text = e.timing < 0 ? 'EARLY' : 'LATE';
    el.className = 'bad';
  }
  el.textContent = text;
  const mEl = $('meter');
  el.style.left = mEl.style.left;
  el.style.top = `${parseFloat(mEl.style.top) - 100}px`;
  mEl.classList.toggle('good', off < 0.035);
  lastReleaseUi = performance.now();
  if (off < 0.035) input.rumble(0.2, 0.6, 90);
}

// --- Menus ----------------------------------------------------------------------------------------------------------------------

const OPTIONS = {
  away: ['random', ...AWAY_KEYS],
  tier: Object.keys(TIERS),
  length: Object.keys(LENGTHS),
  quality: ['auto', ...QUALITY_ORDER],
  sound: [true, false],
};

function optLabel(key, value) {
  if (key === 'away') return value === 'random' ? 'RANDOM' : TEAMS[value].city;
  if (key === 'tier') return TIERS[value].label;
  if (key === 'length') {
    const l = LENGTHS[value];
    return `${l.label} · ${Math.floor(l.clock / 60)}:00 · TO ${l.target}`;
  }
  if (key === 'quality') return String(value).toUpperCase();
  if (key === 'sound') return value ? 'ON' : 'OFF';
  return String(value);
}

function renderOptions() {
  $('optAway').textContent = optLabel('away', settings.away);
  $('optTier').textContent = optLabel('tier', settings.tier);
  $('optLength').textContent = optLabel('length', settings.length);
  $('optQuality').textContent = optLabel('quality', settings.quality);
  $('optSound').textContent = optLabel('sound', settings.sound);
  const preset = input.controls.presetName();
  $('optControls').textContent = preset ? PRESETS[preset].label : 'CUSTOM';
  renderScores(settings.length, settings.tier);
}

function cycle(key, by = 1) {
  if (key === 'controls') {
    openControls();
    return;
  }
  const list = OPTIONS[key];
  const at = list.indexOf(settings[key]);
  settings[key] = list[(at + by + list.length) % list.length];
  saveSettings();
  audio.start();
  audio.tick();
  if (key === 'sound') audio.setEnabled(settings.sound);
  if (key === 'quality') {
    const q = settings.quality === 'auto' ? guessQuality() : settings.quality;
    renderer.autoAdjust = settings.quality === 'auto';
    renderer.setQuality(q);
  }
  renderOptions();
}

let menuFocus = 0;
const menuRows = () => [...document.querySelectorAll('#menu .opt'), $('play')];
function setFocus(i) {
  const rows = menuRows();
  menuFocus = (i + rows.length) % rows.length;
  rows.forEach((r, k) => r.classList.toggle('focus', k === menuFocus));
}

for (const row of document.querySelectorAll('#menu .opt')) {
  row.querySelector('.v').addEventListener('click', () => cycle(row.dataset.opt, 1));
  row.querySelector('.v').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cycle(row.dataset.opt, -1);
  });
}
$('play').addEventListener('click', () => startGame());
$('resume').addEventListener('click', () => resume());
$('quit').addEventListener('click', () => quitToMenu());
$('overBack').addEventListener('click', () => afterGame());

function showMenu() {
  mode = 'menu';
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('gameover').classList.add('hidden');
  renderOptions();
  setFocus(menuRows().length - 1);
}

function quitToMenu() {
  replay = null;
  $('replayTag').classList.add('hidden');
  startAttract();
  showMenu();
}

function pauseGame() {
  if (mode !== 'play') return;
  mode = 'paused';
  $('pause').classList.remove('hidden');
}

function resume() {
  if (mode !== 'paused') return;
  mode = 'play';
  $('pause').classList.add('hidden');
  last = performance.now();
}

let prevMask = 0;
function handleUi(inp) {
  const pressed = inp.mask & ~prevMask;
  prevMask = inp.mask;
  if (mode === 'play') {
    if (inp.pressed.pause) pauseGame();
    if (inp.pressed.camera) rig.side = !rig.side;
    return;
  }
  if (mode === 'paused') {
    if (inp.pressed.pause) resume();
    return;
  }
  if (mode === 'controls') {
    if (listening?.kind === 'pad' && input.padEdges.length) {
      input.controls.bindPad(listening.action, listening.slot, input.padEdges[0]);
      listening = null;
      audio.tick();
      renderBinds();
    } else if (!listening && inp.pressed.escape) {
      closeControls();
    }
    return;
  }
  if (mode === 'menu') {
    const rows = menuRows();
    if (pressed & BTN.UP) setFocus(menuFocus - 1);
    if (pressed & BTN.DOWN) setFocus(menuFocus + 1);
    const row = rows[menuFocus];
    if (row?.dataset?.opt) {
      if (pressed & BTN.LEFT) cycle(row.dataset.opt, -1);
      if (pressed & BTN.RIGHT) cycle(row.dataset.opt, 1);
    }
    if (inp.pressed.confirm || (pressed & BTN.FIRE)) {
      if (row === $('play') || inp.pressed.confirm) startGame();
      else cycle(row.dataset.opt, 1);
    }
    return;
  }
  if (mode === 'over') {
    if (inp.pressed.confirm || (pressed & BTN.FIRE)) afterGame();
    return;
  }
  if (mode === 'name') {
    nameEntry.step(inp.mask);
  }
}

// --- Controls ---------------------------------------------------------------------------------------------------------------

let listening = null;
let controlsFrom = 'menu';

function openControls() {
  audio.start();
  controlsFrom = mode;
  mode = 'controls';
  listening = null;
  $('controls').classList.remove('hidden');
  renderBinds();
}

function closeControls() {
  listening = null;
  $('controls').classList.add('hidden');
  mode = controlsFrom;
  renderOptions();
  renderHints();
}

function renderBinds() {
  const c = input.controls;
  const presets = $('presets');
  presets.innerHTML = '';
  const current = c.presetName();
  for (const [name, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.className = name === current ? 'on' : '';
    b.addEventListener('click', () => {
      c.preset(name);
      listening = null;
      audio.tick();
      renderBinds();
    });
    presets.appendChild(b);
  }
  const body = $('bindBody');
  body.innerHTML = '';
  for (const a of ACTIONS) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'act';
    name.textContent = a.label;
    tr.appendChild(name);
    for (let slot = 0; slot < 2; slot++) tr.appendChild(slotCell(a.key, slot, 'key', keyLabel(c.keys[a.key][slot])));
    if (a.pad) {
      for (let slot = 0; slot < 2; slot++) tr.appendChild(slotCell(a.key, slot, 'pad', padLabel(c.pad[a.key][slot])));
    } else {
      const td = document.createElement('td');
      td.colSpan = 2;
      td.className = 'fixed';
      td.textContent = 'STICK · D-PAD';
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  const hint = $('bindHint');
  const missing = c.unbound();
  if (listening) {
    hint.className = 'fine';
    hint.textContent = listening.kind === 'pad'
      ? 'Press a button on the gamepad. Esc cancels, Backspace clears.'
      : 'Press a key. Esc cancels, Backspace clears.';
  } else if (missing.length) {
    hint.className = 'fine warn';
    hint.textContent = `No key for: ${missing.map((k) => ACTIONS.find((a) => a.key === k).label).join(', ')}.`;
  } else {
    hint.className = 'fine';
    hint.textContent = 'Click a box, then press the key or pad button you want. A key already in use moves here. Esc always pauses.';
  }
}

function slotCell(action, slot, kind, text) {
  const td = document.createElement('td');
  const b = document.createElement('button');
  b.className = `slot${text === '—' ? ' empty' : ''}`;
  const on = listening && listening.action === action && listening.slot === slot && listening.kind === kind;
  if (on) {
    b.classList.add('listening');
    b.textContent = kind === 'pad' ? 'PRESS…' : 'PRESS…';
  } else {
    b.textContent = text;
  }
  b.addEventListener('click', () => {
    listening = on ? null : { action, slot, kind };
    b.blur();
    renderBinds();
  });
  td.appendChild(b);
  return td;
}

// Takes the key before the game sees it, while a box is waiting for one.
addEventListener('keydown', (e) => {
  if (mode !== 'controls' || !listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const l = listening;
  if (e.code === 'Escape') {
    listening = null;
  } else if (e.code === 'Backspace' || e.code === 'Delete') {
    if (l.kind === 'pad') input.controls.bindPad(l.action, l.slot, null);
    else input.controls.bindKey(l.action, l.slot, null);
    listening = null;
  } else if (l.kind === 'key') {
    if (!input.controls.canBind(e.code)) return;
    input.controls.bindKey(l.action, l.slot, e.code);
    listening = null;
    audio.tick();
  }
  renderBinds();
}, true);

$('controlsDone').addEventListener('click', () => closeControls());
$('padReset').addEventListener('click', () => {
  input.controls.resetPad();
  listening = null;
  renderBinds();
});
$('pauseControls').addEventListener('click', () => openControls());

/** The strip of hints at the bottom of the HUD, in whatever keys are bound now. */
function renderHints() {
  const k = input.controls.keys;
  const key = (a) => k[a].filter(Boolean).map(keyLabel)[0] || '—';
  const move = ['up', 'left', 'down', 'right'].map(key).join('');
  const items = [
    [move.length <= 4 ? move : `${key('up')} ${key('left')} ${key('down')} ${key('right')}`, 'move'],
    [key('sprint'), 'sprint'],
    [key('shoot'), 'shoot · hold & release at the top'],
    [key('pass'), 'pass'],
    [key('lob'), 'alley-oop / switch'],
    [key('camera'), 'camera'],
    ['ESC', 'pause'],
  ];
  const el = $('hints');
  el.innerHTML = '';
  for (const [b, text] of items) {
    const span = document.createElement('span');
    const bold = document.createElement('b');
    bold.textContent = b;
    span.append(bold, ` ${text}`);
    el.appendChild(span);
  }
}

// --- End of a game, and the board ----------------------------------------------------------------------------------------------

function showGameOver() {
  if (mode !== 'play') return;
  mode = 'over';
  const won = state.winner === state.humanTeam;
  const s = state.stats;
  $('overKicker').textContent = state.overtime ? 'FINAL · OVERTIME' : 'FINAL';
  $('overTitle').textContent = won ? 'YOU WIN' : 'GAME OVER';
  $('overScore').innerHTML = `<span class="${won ? 'w' : ''}">${state.score[0]}</span><span class="c">${state.teams[0].short} – ${state.teams[1].short}</span><span class="${won ? '' : 'w'}">${state.score[1]}</span>`;
  const pct = (m, a) => (a ? `${m}/${a}` : '0/0');
  const rows = [
    ['FIELD GOALS', pct(s[0].fgm, s[0].fga), pct(s[1].fgm, s[1].fga)],
    ['2-POINTERS', pct(s[0].twoM, s[0].twoA), pct(s[1].twoM, s[1].twoA)],
    ['FREE THROWS', pct(s[0].ftM, s[0].ftA), pct(s[1].ftM, s[1].ftA)],
    ['DUNKS', s[0].dunks, s[1].dunks],
    ['ASSISTS', s[0].assists, s[1].assists],
    ['REBOUNDS', s[0].reb, s[1].reb],
    ['STEALS', s[0].steals, s[1].steals],
    ['BLOCKS', s[0].blocks, s[1].blocks],
    ['BEST FLOW', `×${s[0].bestFlow}`, `×${s[1].bestFlow}`],
  ];
  $('overStats').innerHTML = `<tr><th>${state.teams[0].short}</th><th></th><th>${state.teams[1].short}</th></tr>`
    + rows.map(([k, a, b]) => `<tr><td>${a}</td><td class="k">${k}</td><td>${b}</td></tr>`).join('');
  $('gameover').classList.remove('hidden');
  $('hud').classList.add('hidden');
}

function afterGame() {
  if (mode !== 'over') return;
  $('gameover').classList.add('hidden');
  const won = state.winner === state.humanTeam;
  if (won) {
    const entry = {
      id: makeId(),
      name: lastName(),
      scored: state.score[0],
      conceded: state.score[1],
      dunks: state.stats[0].dunks,
      assists: state.stats[0].assists,
      ot: state.overtime,
      at: Date.now(),
    };
    if (highscores.qualifies(state.length, state.tier, entry)) {
      pending = { entry, length: state.length, tier: state.tier };
      mode = 'name';
      $('hiscoreLine').textContent = `${entry.scored}-${entry.conceded}: number ${placeOf(highscores.table(state.length, state.tier), entry)} on the ${LENGTHS[state.length].label} ${TIERS[state.tier].label} board`;
      $('hiscore').classList.remove('hidden');
      nameEntry.start(lastName());
      return;
    }
  }
  quitToMenu();
}

const nameEntry = new NameEntry($('hiscoreLetters'), (name) => {
  try {
    localStorage.setItem('webfiba.name', name);
  } catch { /* private mode */ }
  const place = highscores.add(pending.length, pending.tier, { ...pending.entry, name });
  $('hiscore').classList.add('hidden');
  settings.length = pending.length;
  settings.tier = pending.tier;
  pending = null;
  quitToMenu();
  renderScores(settings.length, settings.tier, place);
  syncScores();
});

for (let slot = 0; slot < NAME_LENGTH; slot++) {
  for (const [row, by, label] of [['hiscoreUp', -1, '▲'], ['hiscoreDown', 1, '▼']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => {
      nameEntry.slot = slot;
      nameEntry.cycle(by);
      nameEntry.render();
      button.blur();
    });
    $(row).appendChild(button);
  }
}
$('hiscoreLetters').addEventListener('click', (e) => {
  const at = [...e.currentTarget.children].indexOf(e.target);
  if (at < 0) return;
  nameEntry.slot = at;
  nameEntry.render();
});
$('hiscoreOk').addEventListener('click', () => nameEntry.confirm());
addEventListener('keydown', (e) => {
  if (mode !== 'name') return;
  if (nameEntry.type(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

function lastName() {
  try {
    return localStorage.getItem('webfiba.name') || 'AAA';
  } catch {
    return 'AAA';
  }
}

function renderScores(length, tier, fresh = 0) {
  $('scoresLevel').textContent = `${LENGTHS[length].label} · ${TIERS[tier].label}`;
  const body = $('scoresBody');
  body.innerHTML = '';
  const rows = highscores.table(length, tier);
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i + 1 === fresh) tr.className = 'fresh';
    const extra = [r.dunks ? `${r.dunks} DNK` : '', r.ot ? 'OT' : ''].filter(Boolean).join(' ');
    for (const [cls, text] of [['place', `${i + 1}`], ['name', r.name], ['result', `${r.scored}-${r.conceded}`], ['extra', extra]]) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  });
  $('scoresNote').textContent = rows.length ? '' : 'Nobody yet. Beat the CPU and the first line is yours.';
}

async function syncScores() {
  const url = boardFor(location);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board: highscores.all() }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.board) return false;
    highscores.absorb(data.board);
    if (mode === 'menu') renderScores(settings.length, settings.tier);
    return true;
  } catch {
    return false;
  }
}

// Debug and screenshot hooks.
window.webfiba = {
  get state() { return state; },
  get renderer() { return renderer; },
  startGame,
  setQuality: (q) => renderer.setQuality(q),
  input,
  /** For screenshots: put a big man on the wing with the ball and send him at the ring. */
  stage(kind = 'dunk') {
    const s = state;
    const big = s.players[kind === 'jumper' ? 0 : 2];
    s.phase = 'live';
    s.needsClear = false;
    s.possession = 0;
    for (const p of s.players) {
      p.act = null;
    }
    big.x = kind === 'jumper' ? -1.5 : 2.0;
    big.z = kind === 'jumper' ? 7.4 : 2.9;
    big.face = Math.atan2(-big.x, -big.z);
    const d = Math.hypot(big.x, big.z);
    big.vx = kind === 'jumper' ? 0 : (-big.x / d) * 6.5;
    big.vz = kind === 'jumper' ? 0 : (-big.z / d) * 6.5;
    s.ball.holder = big.id;
    s.ball.mode = 'held';
    s.controlled = big.id;
    s.players[5].x = -2;
    s.players[5].z = 1;
    const t = input.touch;
    t.mx = -0.4;
    t.my = 0.8;
    t.sprint = true;
    if (kind === 'jumper') {
      t.mx = 0;
      t.my = 0;
      t.sprint = false;
    }
    t.shoot = true;
    setTimeout(() => { t.shoot = false; t.mx = 0; t.my = 0; t.sprint = false; }, kind === 'jumper' ? 1100 : 900);
  },
};

boot().catch((err) => {
  console.error(err);
  $('loadingText').textContent = `COULD NOT START: ${err.message}`;
});
