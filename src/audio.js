/**
 * Every sound in the building, synthesised: nothing is recorded and nothing is
 * downloaded.
 *
 * What makes it sound like a gym rather than a synthesiser is the room. All of
 * it goes through a convolution reverb whose impulse is generated noise with a
 * long decay - a big hard hall - and the dry and wet are balanced per sound: a
 * dribble is mostly dry and close, the buzzer is mostly the room.
 */

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.crowdLevel = 0.25;
    this.hype = 0;
  }

  /** Must be called from a user gesture: browsers will not start sound otherwise. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.6, 2.2);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.verb.connect(this.wet).connect(this.master);
    this.noise = this.noiseBuffer(2);
    this.startCrowd();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // Early reflections: a few distinct slaps off the walls, then the tail.
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.004 ? 2 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A gain node routed to the room: `wet` of it reverberant. */
  out(wet = 0.3, pan = 0) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let node = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      node = p;
    }
    const d = ctx.createGain();
    d.gain.value = 1 - wet * 0.5;
    const w = ctx.createGain();
    w.gain.value = wet;
    node.connect(d).connect(this.dry);
    node.connect(w).connect(this.verb);
    return g;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  ok() {
    return this.ctx && this.enabled && this.ctx.state === 'running';
  }

  // --- the sounds --------------------------------------------------------------------------------

  /** The ball on hardwood: a deep thump with a slap on top. */
  bounce(power = 1, pan = 0) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = Math.min(1, power);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.09);
    const g = this.out(0.22, pan);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.22);
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    f.Q.value = 0.9;
    const ng = this.out(0.25, pan);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(f).connect(ng);
    n.start(t);
    n.stop(t + 0.06);
  }

  /** Rubber on a polished floor: a short chirp with a wobble. */
  squeak(pan = 0) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const base = 2200 + Math.random() * 1400;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.07);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 55 + Math.random() * 40;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = base;
    f.Q.value = 6;
    const g = this.out(0.35, pan);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(f).connect(g);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.12);
    lfo.stop(t + 0.12);
  }

  /** Nylon: a breathy rush that rises then falls. */
  swish(power = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.7;
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(5200, t + 0.08);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    const g = this.out(0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.55 * power, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    n.connect(f).connect(g);
    n.start(t);
    n.stop(t + 0.36);
  }

  /** Iron: inharmonic partials that ring, and a clank on the front. */
  rim(power = 1) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const v = Math.min(1, 0.25 + power * 0.25);
    const g = this.out(0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    for (const [f, a] of [[412, 1], [1013, 0.6], [1588, 0.45], [2470, 0.3], [3350, 0.18]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const og = ctx.createGain();
      og.gain.setValueAtTime(a, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25 + 0.6 / (f / 400));
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1);
    }
    this.thud(0.5 * v, 300);
  }

  /** Glass and the frame behind it. */
  board(power = 1) {
    if (!this.ok()) return;
    this.thud(0.7 * Math.min(1, power), 180, 0.35);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3000;
    const g = this.out(0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    n.connect(f).connect(g);
    n.start(t);
    n.stop(t + 0.3);
  }

  thud(v = 1, freq = 120, wet = 0.3) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + 0.15);
    const g = this.out(wet);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** The slam: the ring, the glass, a boom under it all, and the building going up. */
  slam() {
    if (!this.ok()) return;
    this.rim(4);
    this.board(1.5);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const g = this.out(0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g);
    o.start(t);
    o.stop(t + 1);
    this.cheer(1.6, 3.5);
  }

  /** Two pea whistles slightly apart, trilling. */
  whistle(long = false) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = long ? 0.75 : 0.42;
    const g = this.out(0.45);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
    g.gain.setValueAtTime(0.2, t + dur - 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const f of [2750, 2890]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const trill = ctx.createOscillator();
      trill.frequency.value = 28;
      const tg = ctx.createGain();
      tg.gain.value = 90;
      trill.connect(tg).connect(o.frequency);
      o.connect(g);
      o.start(t);
      trill.start(t);
      o.stop(t + dur);
      trill.stop(t + dur);
    }
  }

  buzzer() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = this.out(0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
    g.gain.setValueAtTime(0.28, t + 1.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    f.connect(g);
    for (const fr of [196, 247, 294]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.connect(f);
      o.start(t);
      o.stop(t + 1.35);
    }
  }

  /** A short beep: the shot clock's last five. */
  beep(high = false) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 1320 : 880;
    const g = this.out(0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Interface tick. */
  tick() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.05);
  }

  // --- the crowd ----------------------------------------------------------------------------------

  /**
   * The bed: filtered noise in a few bands with slow, independent swells, which
   * at a distance is what thousands of people talking sounds like.
   */
  startCrowd() {
    const ctx = this.ctx;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    this.crowdGain.connect(this.wet);
    const toDry = ctx.createGain();
    toDry.gain.value = 0.35;
    this.crowdGain.connect(toDry).connect(this.dry);
    for (const [freq, q, amp] of [[350, 0.8, 0.5], [800, 1.2, 0.35], [1600, 1.5, 0.18], [3000, 2, 0.06]]) {
      const n = this.noiseSrc();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = amp;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.1 + Math.random() * 0.3;
      const lg = ctx.createGain();
      lg.gain.value = amp * 0.35;
      lfo.connect(lg).connect(g.gain);
      n.connect(f).connect(g).connect(this.crowdGain);
      n.start();
      lfo.start();
    }
    this.crowdGain.gain.setTargetAtTime(this.crowdLevel, ctx.currentTime, 1.5);
  }

  /** The crowd's level follows the game: louder in a close finish, roaring on a dunk. */
  setHype(h) {
    if (!this.ctx || !this.crowdGain) return;
    this.hype = h;
    const level = (0.18 + h * 0.4) * (this.enabled ? 1 : 0);
    this.crowdGain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4);
  }

  /** A cheer: a swell of brighter noise with a lot of voices in it. */
  cheer(amount = 1, length = 2.2) {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1300, t + 0.4);
    f.Q.value = 0.6;
    const g = this.out(0.8);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * amount, t + 0.25);
    g.gain.setTargetAtTime(0.0001, t + length * 0.4, length * 0.3);
    // Voices: a rough vibrato makes it a crowd and not a hiss.
    const am = ctx.createOscillator();
    am.frequency.value = 7;
    const amg = ctx.createGain();
    amg.gain.value = 0.12 * amount;
    am.connect(amg).connect(g.gain);
    n.connect(f).connect(g);
    n.start(t);
    am.start(t);
    n.stop(t + length + 1);
    am.stop(t + length + 1);
  }

  /** The "oooh" of a miss that nearly went in: a formant sweeping down. */
  ooh() {
    if (!this.ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this.noiseSrc();
    const g = this.out(0.85);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    for (const [a, b] of [[500, 320], [1000, 700]]) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 5;
      f.frequency.setValueAtTime(a, t);
      f.frequency.exponentialRampToValueAtTime(b, t + 1.1);
      n.connect(f).connect(g);
    }
    n.start(t);
    n.stop(t + 1.4);
  }
}
