/**
 * Sound, synthesised.
 *
 * No audio files, for the same reason there are no image files: the whole build
 * is 216KB and a single decent sample would be a large fraction of that again.
 * Everything here is oscillators and noise through envelopes, which costs bytes
 * in the hundreds rather than the hundreds of thousands.
 *
 * Three rules this has to obey and most web-game audio does not:
 *
 *   1. A browser will not start audio before a gesture. The context is created
 *      on the first real press and not a moment sooner, so nothing is broken by
 *      autoplay policy and nothing warns in the console.
 *   2. It must survive not existing. Every call is a no-op when the context
 *      failed, is suspended, or the player muted it - a game that throws
 *      because a phone declined to play a beep is a worse game.
 *   3. It must never queue unboundedly. Gathering can fire dozens of times a
 *      second at a high pull radius, so voices are rate-limited per cue rather
 *      than played per event.
 */

export type Cue =
  | 'step'
  | 'pull'
  | 'absorb'
  | 'craft'
  | 'cast'
  | 'hit'
  | 'hurt'
  | 'kill'
  | 'warn'
  | 'level'
  | 'ui';

/** Minimum seconds between two of the same cue, so nothing machine-guns. */
const THROTTLE: Record<Cue, number> = {
  step: 0.26,
  pull: 0.1,
  absorb: 0.05,
  craft: 0.2,
  cast: 0.08,
  hit: 0.05,
  hurt: 0.25,
  kill: 0.06,
  warn: 1,
  level: 1,
  ui: 0.08,
};

const STORAGE_KEY = 'maelstrom.muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** The per-biome bed, and the filter its mood is shaped with. */
  private bed: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private lastAt = new Map<Cue, number>();
  private muted = false;
  private failed = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      // A blocked store is not worth refusing to make noise over.
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Same: the setting simply will not persist.
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : 1;
    return this.muted;
  }

  /**
   * Called from a real user gesture. Everything before this is silent by
   * design rather than by accident.
   */
  unlock(): void {
    if (this.ctx || this.failed) {
      void this.ctx?.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      void this.ctx.resume();
    } catch {
      this.failed = true;
    }
  }

  // ---------------------------------------------------------------- cues

  play(cue: Cue, strength = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const last = this.lastAt.get(cue) ?? -Infinity;
    if (now - last < THROTTLE[cue]) return;
    this.lastAt.set(cue, now);

    switch (cue) {
      // A footfall is a short filtered noise thud, not a tone.
      case 'step':
        this.noise(now, 0.07, 420, 0.05 * strength);
        break;

      // The gauntlets reaching: a quiet rising sine, because the pull is a
      // continuous verb and a click would turn it into a slot machine.
      case 'pull':
        this.tone(now, 'sine', 320, 520, 0.16, 0.035 * strength);
        break;

      case 'absorb':
        this.tone(now, 'triangle', 640, 980, 0.1, 0.045 * strength);
        break;

      // Crafting is the one permanent change in the game, so it gets a chord
      // rather than a blip.
      case 'craft':
        this.tone(now, 'triangle', 392, 392, 0.5, 0.06);
        this.tone(now + 0.07, 'triangle', 523, 523, 0.5, 0.055);
        this.tone(now + 0.14, 'triangle', 659, 659, 0.6, 0.05);
        break;

      case 'cast':
        this.tone(now, 'sawtooth', 220, 660, 0.3, 0.05);
        this.noise(now, 0.22, 1800, 0.03);
        break;

      case 'hit':
        this.noise(now, 0.09, 900, 0.07 * strength);
        this.tone(now, 'square', 180, 90, 0.09, 0.035 * strength);
        break;

      case 'hurt':
        this.tone(now, 'sawtooth', 180, 70, 0.3, 0.075);
        break;

      case 'kill':
        this.tone(now, 'square', 320, 60, 0.26, 0.05);
        this.noise(now, 0.2, 500, 0.05);
        break;

      // Canon calls the warning unmistakable, so this is the loudest thing in
      // the game and the only one that is deliberately unpleasant.
      case 'warn':
        this.tone(now, 'sawtooth', 110, 110, 0.6, 0.09);
        this.tone(now + 0.3, 'sawtooth', 98, 98, 0.8, 0.09);
        break;

      case 'level':
        this.tone(now, 'triangle', 523, 523, 0.3, 0.06);
        this.tone(now + 0.1, 'triangle', 659, 659, 0.3, 0.06);
        this.tone(now + 0.2, 'triangle', 784, 784, 0.5, 0.065);
        break;

      case 'ui':
        this.tone(now, 'sine', 880, 880, 0.06, 0.03);
        break;
    }
  }

  /**
   * The ambient bed under a region.
   *
   * One detuned oscillator through a low-pass, retuned when the player crosses
   * a border: a Data-Center hums, a Wetland sits low and muffled, and the open
   * Plains barely sound at all. Anything richer would be a music system, which
   * this game does not have and should not fake.
   */
  setBiome(hue: number, brightness: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.failed) return;

    if (!this.bed) {
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        filter.type = 'lowpass';
        gain.gain.value = 0;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        osc.start();
        this.bed = { osc, gain, filter };
      } catch {
        return;
      }
    }

    const now = ctx.currentTime;
    // Long ramps: a bed that snaps when you cross a line is a bed you notice.
    this.bed.osc.frequency.linearRampToValueAtTime(Math.max(30, hue), now + 1.5);
    this.bed.filter.frequency.linearRampToValueAtTime(Math.max(80, brightness), now + 1.5);
    this.bed.gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(0.04, level)), now + 1.5);
  }

  dispose(): void {
    try {
      this.bed?.osc.stop();
      void this.ctx?.close();
    } catch {
      // Already gone.
    }
    this.bed = null;
    this.ctx = null;
    this.master = null;
  }

  // ---------------------------------------------------------------- voices

  /** One enveloped oscillator, swept from `from` to `to`. */
  private tone(at: number, type: OscillatorType, from: number, to: number, life: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, at);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + life);
      // Attack is 12ms rather than instant: a square wave starting at full
      // amplitude clicks, and the click is what makes cheap audio sound cheap.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + life);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(at);
      osc.stop(at + life + 0.02);
    } catch {
      // A voice that will not start is not worth a crash.
    }
  }

  /** Filtered white noise: impacts, footfalls, anything without a pitch. */
  private noise(at: number, life: number, cutoff: number, peak: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    try {
      const frames = Math.max(1, Math.floor(ctx.sampleRate * life));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) {
        // Shaped as it is generated, so no separate envelope node is needed.
        data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
      }
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      gain.gain.value = peak;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(at);
    } catch {
      // As above.
    }
  }
}
